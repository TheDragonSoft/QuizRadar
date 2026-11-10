//! Typed local storage (phase 04, `prompts/p04-core-store-backup.md`):
//! - [`db`] — one SQLite schema (rusqlite, bundled) replacing the v4
//!   JSON-file sprawl; `room` stays `NULL`-representable everywhere
//! - [`repo`] — typed repositories (course/slot schedule save, custom events
//!   CRUD, topic toggle, grade partial-update with explicit-null-clears,
//!   feeds CRUD with https-only validation) + the GET-state snapshot that
//!   ships derived dashboard/tasks so shells never re-derive
//! - [`importer`] — v4 backup importer (typed structs, v4-enum mapping,
//!   tokens dropped, one transaction per import)
//! - [`backup`] — Drive-appDataFolder data-only backup with additive merge
//!   rules; the payload type structurally cannot carry tokens (`03` §B6)
//! - [`Store`] — the async facade: one `spawn_blocking` call per operation
//!   so every shell awaits without blocking its runtime thread
//!
//! Secrets never live here: OAuth tokens/keys are platform-side (OS keyring,
//! EncryptedSharedPreferences, memory-only PWA tokens). v5 deleted v4's
//! calendar-fallback sync channel — the Drive file is the only cloud store.

pub mod backup;
pub mod crypto;
pub mod db;
pub mod exporter;
pub mod importer;
pub mod repo;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::NaiveDate;

use db::StoreError;

/// A blocking task that panics surfaces as an honest error string (no
/// re-panic across the runtime boundary).
fn flatten_join(join_err: tokio::task::JoinError) -> StoreError {
    StoreError::Validation(format!("store task abandoned: {join_err}"))
}

/// The async store handle every shell binds. Cheap to clone (one mutex per
/// instance wrapping a single connection — writes serialize as in v4's
/// `Arc<RwLock>` global state, but now inside one SQLite transaction each).
#[derive(Clone)]
pub struct Store {
    db: Arc<Mutex<db::Db>>,
}

impl Store {
    /// Opens (and migrates) the store file: one SQLite file per device.
    pub async fn open(path: impl AsRef<Path> + Send + 'static) -> Result<Self, StoreError> {
        Self::open_with_key(path, None).await
    }

    /// Opens the store file, optionally with an OS keyring-held encryption key.
    pub async fn open_with_key(
        path: impl AsRef<Path> + Send + 'static,
        key: Option<crypto::DbEncryptionKey>,
    ) -> Result<Self, StoreError> {
        let path_buf: PathBuf = path.as_ref().to_path_buf();
        let db = if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::spawn_blocking(move || db::Db::open_with_key(&path_buf, key.as_ref()))
                .await
                .map_err(flatten_join)??
        } else {
            db::Db::open_with_key(&path_buf, key.as_ref())?
        };
        Ok(Self::wrap(db))
    }

    /// In-memory store for tests and scratch shells.
    pub async fn open_in_memory() -> Result<Self, StoreError> {
        let db = if tokio::runtime::Handle::try_current().is_ok() {
            tokio::task::spawn_blocking(db::Db::open_in_memory)
                .await
                .map_err(flatten_join)??
        } else {
            db::Db::open_in_memory()?
        };
        Ok(Self::wrap(db))
    }

    pub(crate) fn wrap(db: db::Db) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
        }
    }

    /// Runs `operation` (which borrows the sync [`db::Db`]) on the blocking
    /// thread pool. A poisoned mutex is recovered honestly — a panicking
    /// operation must never brick the store.
    fn run<R>(
        &self,
        operation: impl FnOnce(&db::Db) -> Result<R, StoreError> + Send + 'static,
    ) -> impl std::future::Future<Output = Result<R, StoreError>>
    where
        R: Send + 'static,
    {
        let db = Arc::clone(&self.db);
        async move {
            if tokio::runtime::Handle::try_current().is_ok() {
                let result = tokio::task::spawn_blocking(move || {
                    let mut guard = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                    operation(&mut guard)
                })
                .await;
                match result {
                    Ok(inner) => inner,
                    Err(join_err) => Err(flatten_join(join_err)),
                }
            } else {
                let mut guard = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                operation(&mut guard)
            }
        }
    }

    /// GET-state equivalent: full snapshot + derived dashboard/tasks at the
    /// caller's reference date (desktop `Local::now().date_naive()`,
    /// Android `LocalDate.now()`, PWA the browser's date — `plan` docs).
    pub async fn load_state(
        &self,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::load_state(db, reference_date))
            .await
    }

    /// Whole-timetable replace (`/api/schedule/save`).
    pub async fn save_schedule(
        &self,
        schedule: crate::types::ScheduleData,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::save_schedule(db, &schedule, &updated_at, reference_date))
            .await
    }

    /// Course upsert + its slot replacement (`/api/schedule/courses`).
    pub async fn upsert_course(
        &self,
        course: crate::types::Course,
        slots: Vec<crate::types::ScheduleSlot>,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| {
            repo::ops::upsert_course(db, &course, &slots, &updated_at, reference_date)
        })
        .await
    }

    /// Course + slot deletion (ASCII-case-insensitive).
    pub async fn delete_course(
        &self,
        code: String,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::delete_course(db, &code, &updated_at, reference_date))
            .await
    }

    /// Scan-pipeline entry: fresh radar replaces the old, user-owned fields
    /// survive reannouncement (phase 05 calls this per scan).
    ///
    /// An empty result is REFUSED here: a scan that found nothing must not
    /// wipe the radar.
    pub async fn replace_assessments(
        &self,
        assessments: Vec<crate::types::Assessment>,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| {
            repo::ops::replace_assessments(db, &assessments, &updated_at, reference_date)
        })
        .await
    }

    /// Explicit, caller-driven replace: an empty list really does mean "the
    /// radar is empty now" (a user-requested reset, the Android shell
    /// clearing the radar). Only a caller that says so may clear it — the
    /// scan path uses [`Store::replace_assessments`], which refuses.
    pub async fn replace_assessments_allowing_empty(
        &self,
        assessments: Vec<crate::types::Assessment>,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| {
            repo::ops::replace_assessments_allowing_empty(
                db,
                &assessments,
                &updated_at,
                reference_date,
            )
        })
        .await
    }

    /// Custom event upsert (`/api/events/custom`, id required).
    pub async fn upsert_custom_event(
        &self,
        event: crate::types::CustomCalendarEvent,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::upsert_custom_event(db, &event, &updated_at, reference_date))
            .await
    }

    /// Custom event delete (`/api/events/custom/:id`).
    pub async fn delete_custom_event(
        &self,
        id: String,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::delete_custom_event(db, &id, &updated_at, reference_date))
            .await
    }

    /// Assessment upsert (manual creation / edit).
    pub async fn upsert_assessment(
        &self,
        assessment: crate::types::Assessment,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| {
            repo::ops::upsert_assessment(db, &assessment, &updated_at, reference_date)
        })
        .await
    }

    /// Assessment delete.
    pub async fn delete_assessment(
        &self,
        id: String,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::delete_assessment(db, &id, &updated_at, reference_date))
            .await
    }

    /// Topic toggle (`/api/study/toggle`).
    pub async fn set_topic_done(
        &self,
        key: String,
        done: bool,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::set_topic_done(db, &key, done, &updated_at, reference_date))
            .await
    }

    /// Grade partial update (explicit-null-clears semantics).
    pub async fn update_grade(
        &self,
        id: String,
        change: repo::GradeChange,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::update_grade(db, &id, &change, &updated_at, reference_date))
            .await
    }

    /// Feed save (https-only validated, ≤10).
    pub async fn save_feed(
        &self,
        feed: crate::types::FeedConfig,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::save_feed(db, &feed, &updated_at, reference_date))
            .await
    }

    /// Feed delete.
    pub async fn delete_feed(
        &self,
        id: String,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::delete_feed(db, &id, &updated_at, reference_date))
            .await
    }

    pub async fn record_attendance(
        &self,
        entry: crate::types::AttendanceEntry,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::record_attendance(db, &entry, reference_date))
            .await
    }

    pub async fn set_course_absence_limit(
        &self,
        course_id: String,
        max_absences: Option<u32>,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| {
            repo::ops::set_course_absence_limit(
                db,
                &course_id,
                max_absences,
                &updated_at,
                reference_date,
            )
        })
        .await
    }

    pub async fn log_study_session(
        &self,
        session: crate::types::StudySessionRecord,
        reference_date: NaiveDate,
    ) -> Result<repo::AppSnapshot, StoreError> {
        self.run(move |db| repo::ops::log_study_session(db, &session, reference_date))
            .await
    }

    pub async fn get_study_analytics(
        &self,
        reference_date: NaiveDate,
    ) -> Result<crate::types::StudyAnalytics, StoreError> {
        self.run(move |db| repo::ops::get_study_analytics(db, reference_date))
            .await
    }

    pub async fn save_quiz_attempt(
        &self,
        attempt: crate::types::QuizAttempt,
        mistakes: Vec<crate::types::MistakeRecord>,
        updated_at: String,
    ) -> Result<(), StoreError> {
        self.run(move |db| repo::ops::save_quiz_attempt(db, &attempt, &mistakes, &updated_at))
            .await
    }

    pub async fn list_mistakes(
        &self,
        assessment_id: Option<String>,
    ) -> Result<Vec<crate::types::MistakeRecord>, StoreError> {
        self.run(move |db| repo::ops::list_mistakes(db, assessment_id.as_deref()))
            .await
    }

    pub async fn resolve_mistake(
        &self,
        mistake_id: String,
        updated_at: String,
    ) -> Result<bool, StoreError> {
        self.run(move |db| repo::ops::resolve_mistake(db, &mistake_id, &updated_at))
            .await
    }

    pub async fn upsert_flashcard(
        &self,
        card: crate::types::Flashcard,
        updated_at: String,
    ) -> Result<crate::types::Flashcard, StoreError> {
        self.run(move |db| repo::ops::upsert_flashcard(db, &card, &updated_at))
            .await
    }

    pub async fn list_flashcards(
        &self,
        course_id: Option<String>,
    ) -> Result<Vec<crate::types::Flashcard>, StoreError> {
        self.run(move |db| repo::ops::list_flashcards(db, course_id.as_deref()))
            .await
    }

    pub async fn delete_flashcard(&self, id: String) -> Result<bool, StoreError> {
        self.run(move |db| repo::ops::delete_flashcard(db, &id))
            .await
    }

    pub async fn review_flashcard(
        &self,
        id: String,
        correct: bool,
        today: NaiveDate,
        updated_at: String,
    ) -> Result<Option<crate::types::Flashcard>, StoreError> {
        self.run(move |db| repo::ops::review_flashcard(db, &id, correct, today, &updated_at))
            .await
    }

    /// Dismiss the conflict banner (`/api/conflicts/dismiss`).
    pub async fn dismiss_conflicts(&self) -> Result<(), StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.set_bool("dismiss_conflict_banner", true)
        })
        .await
    }

    /// Read whether the conflict banner has been dismissed.
    pub async fn get_dismiss_conflict_banner(&self) -> Result<bool, StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.dismiss_conflict_banner()
        })
        .await
    }

    /// The persisted Google-Calendar idempotency map (`assessment id → event
    /// id`). A mapped id is a PUT (update), an unmapped id a POST (create) —
    /// without persisting it, every push re-creates every event.
    pub async fn synced_gcal_map(
        &self,
    ) -> Result<std::collections::HashMap<String, String>, StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.synced_gcal_map()
        })
        .await
    }

    /// Persist the gcal idempotency map returned by a push report.
    pub async fn set_synced_gcal_map(
        &self,
        map: std::collections::HashMap<String, String>,
    ) -> Result<(), StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.set_synced_gcal_map(&map)
        })
        .await
    }

    /// Read a boolean configuration property.
    pub async fn get_config_bool(&self, key: String, default: bool) -> Result<bool, StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.get_bool(&key, default)
        })
        .await
    }

    /// Read a boolean configuration property without applying a default:
    /// `None` means "the user never set this", which is different from an
    /// explicit `false`. Shells use it for source toggles whose sensible
    /// default depends on what the user has connected.
    pub async fn get_config_bool_opt(&self, key: String) -> Result<Option<bool>, StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            Ok(config.get_raw(&key)?.and_then(|value| value.as_bool()))
        })
        .await
    }

    /// Read an optional string configuration property.
    pub async fn get_config_string(&self, key: String) -> Result<Option<String>, StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.get_string(&key)
        })
        .await
    }

    /// Write a boolean configuration property.
    pub async fn set_config_bool(&self, key: String, value: bool) -> Result<(), StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.set_bool(&key, value)
        })
        .await
    }

    /// Write an optional string configuration property.
    pub async fn set_config_string(
        &self,
        key: String,
        value: Option<String>,
    ) -> Result<(), StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            config.set_string(&key, value.as_deref())
        })
        .await
    }

    /// Deletes several string configuration keys in one write — used by the
    /// logout flows to wipe the signed-out account's identity, not just its
    /// tokens.
    pub async fn clear_profile_keys(&self, keys: Vec<String>) -> Result<(), StoreError> {
        self.run(move |db| {
            let conn = db.conn();
            let config = repo::ConfigRepo::new(conn);
            for key in &keys {
                config.set_string(key, None)?;
            }
            Ok(())
        })
        .await
    }

    // ---- Sync stamps (`kv_meta`, the canonical home per the store contract) ----
    //
    // These are dataset-level metadata, not user settings: they travel with
    // the v4 backup export/import round-trip (`exporter`/`importer` read and
    // write the same keys) and they are what a shell shows as "Last synced".
    // A shell must only write a stamp when a real fetch actually happened.

    /// When a source scan last completed successfully (`last_gmail_sync`).
    pub async fn get_last_gmail_sync(&self) -> Result<Option<String>, StoreError> {
        self.run(move |db| repo::MetaRepo::new(db.conn()).last_gmail_sync())
            .await
    }

    /// Stamps the last successful source scan.
    pub async fn set_last_gmail_sync(&self, stamp: String) -> Result<(), StoreError> {
        self.run(move |db| repo::MetaRepo::new(db.conn()).set_last_gmail_sync(&stamp))
            .await
    }

    /// When assessments were last pushed to Google Calendar (`last_gcal_sync`).
    pub async fn get_last_gcal_sync(&self) -> Result<Option<String>, StoreError> {
        self.run(move |db| repo::MetaRepo::new(db.conn()).last_gcal_sync())
            .await
    }

    /// Stamps the last successful Google Calendar push.
    pub async fn set_last_gcal_sync(&self, stamp: String) -> Result<(), StoreError> {
        self.run(move |db| repo::MetaRepo::new(db.conn()).set_last_gcal_sync(&stamp))
            .await
    }

    /// When the Drive backup was last pushed (`last_backup_push`).
    pub async fn get_last_backup_push(&self) -> Result<Option<String>, StoreError> {
        self.run(move |db| repo::MetaRepo::new(db.conn()).last_backup_push())
            .await
    }

    /// Stamps the last successful Drive backup push.
    pub async fn set_last_backup_push(&self, stamp: String) -> Result<(), StoreError> {
        self.run(move |db| repo::MetaRepo::new(db.conn()).set_last_backup_push(&stamp))
            .await
    }

    /// Loads all announcement emails cached on this device.
    pub async fn load_cached_emails(&self) -> Result<Vec<crate::types::CachedEmail>, StoreError> {
        self.run(repo::ops::load_cached_emails).await
    }

    /// Persists announcement emails to the local device cache.
    pub async fn save_cached_emails(
        &self,
        emails: Vec<crate::types::CachedEmail>,
        updated_at: String,
    ) -> Result<(), StoreError> {
        self.run(move |db| repo::ops::save_cached_emails(db, &emails, &updated_at))
            .await
    }

    /// Fetches an AI assessment extraction by its email content hash.
    pub async fn get_email_ai_extraction(
        &self,
        cache_key: &str,
    ) -> Result<Option<crate::ai::tasks::ExtractedAssessment>, StoreError> {
        let key = cache_key.to_string();
        self.run(move |db| repo::ops::get_email_ai_extraction(db, &key))
            .await
    }

    /// Persists an AI assessment extraction result.
    pub async fn save_email_ai_extraction(
        &self,
        cache_key: &str,
        email_id: &str,
        extraction: &crate::ai::tasks::ExtractedAssessment,
        model_id: &str,
        created_at: String,
    ) -> Result<(), StoreError> {
        let key = cache_key.to_string();
        let id = email_id.to_string();
        let ext = extraction.clone();
        let mid = model_id.to_string();
        self.run(move |db| {
            repo::ops::save_email_ai_extraction(db, &key, &id, &ext, &mid, &created_at)
        })
        .await
    }

    /// Prunes AI assessment extractions older than `max_age_days` relative to `now_iso`.
    pub async fn prune_email_ai_extractions_by_age(
        &self,
        now_iso: impl Into<String>,
        max_age_days: i64,
    ) -> Result<usize, StoreError> {
        let now_iso = now_iso.into();
        self.run(move |db| repo::ops::prune_email_ai_extractions_by_age(db, &now_iso, max_age_days))
            .await
    }

    /// Rotates AI assessment extractions to only retain entries belonging to the active semester.
    pub async fn rotate_email_ai_extractions_semester(
        &self,
        active_semester: impl Into<String>,
    ) -> Result<usize, StoreError> {
        let active_semester = active_semester.into();
        self.run(move |db| repo::ops::rotate_email_ai_extractions_semester(db, &active_semester))
            .await
    }

    /// Permanently wipes all tables and records, recreating a clean database state.
    pub async fn reset_all(&self) -> Result<(), StoreError> {
        self.run(move |db| {
            // One transaction: an autocommit-per-statement wipe that fails
            // halfway leaves a half-erased database, not "all data reset".
            let tx = db.transaction()?;
            tx.execute_batch(
                "DELETE FROM assessments;
                 DELETE FROM courses;
                 DELETE FROM slots;
                 DELETE FROM topics_done;
                 DELETE FROM grades;
                 DELETE FROM events;
                 DELETE FROM feeds;
                 DELETE FROM config_kv;
                 DELETE FROM tokens_meta;
                 DELETE FROM kv_meta;
                 DELETE FROM attendance;
                 DELETE FROM flashcards;
                 DELETE FROM quiz_attempts;
                 DELETE FROM mistake_bank;
                 DELETE FROM study_sessions;
                 DELETE FROM cached_emails;
                 DELETE FROM email_ai_extractions;",
            )?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// v4 backup import (one transaction; secrets dropped, documented).
    /// `reference_date` is pinned in the surface for future derived-field
    /// stamping but unused today (rows keep their stored derived values).
    #[allow(unused_variables)]
    pub async fn import_v4_backup(
        &self,
        backup_json: String,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<importer::ImportReport, StoreError> {
        self.run(move |db| importer::import_v4_backup_json(db, &backup_json, &updated_at))
            .await
    }

    /// Local backup export in the v4 file shape (`01` §4 backup modal):
    /// user-restorable JSON with no credentials in it, structurally.
    pub async fn export_v4_backup_json(
        &self,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<String, StoreError> {
        self.run(move |db| exporter::serialize_v4_backup(db, &updated_at, reference_date))
            .await
    }

    /// Build the current [`backup::BackupPayload`] (data-only, token-free).
    pub async fn build_backup_payload(
        &self,
        device_id: String,
        updated_at: String,
    ) -> Result<backup::BackupPayload, StoreError> {
        self.run(move |db| backup::build_backup_payload(db, &device_id, &updated_at))
            .await
    }

    /// Merge a pulled [`backup::BackupPayload`] (additive rules).
    pub async fn merge_backup(
        &self,
        payload: backup::BackupPayload,
        updated_at: String,
        reference_date: NaiveDate,
    ) -> Result<backup::MergeReport, StoreError> {
        // The reference date is unused today (merge is stamp-based only) but
        // pinned in the surface so later rules can derive honestly.
        let _ = reference_date;
        self.run(move |db| backup::merge_backup_payload(db, &payload, &updated_at))
            .await
    }

    /// The BYOK AI layer's usage-ledger kv seam (phase 06): the
    /// [`crate::ai::provider::QuotaLedger`] persists its Pacific-day call
    /// counters through this adapter into `config_kv` — counts only, never
    /// keys or tokens. Constructing it is cheap; the ledger holds the
    /// parsed record, not this handle.
    pub fn quota_kv(&self) -> crate::ai::provider::StoreQuotaKv {
        crate::ai::provider::StoreQuotaKv(Arc::clone(&self.db))
    }
}
