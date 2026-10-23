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
pub mod db;
pub mod exporter;
pub mod importer;
pub mod repo;

use std::path::Path;
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
        let db = tokio::task::spawn_blocking(move || db::Db::open(path.as_ref()))
            .await
            .map_err(flatten_join)?;
        Ok(Self::wrap(db?))
    }

    /// In-memory store for tests and scratch shells.
    pub async fn open_in_memory() -> Result<Self, StoreError> {
        let db = tokio::task::spawn_blocking(db::Db::open_in_memory)
            .await
            .map_err(flatten_join)?;
        Ok(Self::wrap(db?))
    }

    fn wrap(db: db::Db) -> Self {
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
            let result = tokio::task::spawn_blocking(move || {
                let mut guard = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                operation(&mut guard)
            })
            .await;
            match result {
                Ok(inner) => inner,
                Err(join_err) => Err(flatten_join(join_err)),
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
}
