//! v4 backup importer (`04` §4.4): reads the exact JSON shape v4 wrote —
//! `assessments[]`, `schedule.courses[]`/`slots[]`, `completed_topics`,
//! `grades`, `custom_events`, `feeds`, config flags — into the v5 store in
//! **one transaction**.
//!
//! Compatibility rules, all outlined in `02` §3:
//! - validation via typed structs (`serde_json` with unknown fields
//!   tolerated; `assessments` + `schedule.courses` presence required —
//!   v4's own restore guard, `app.js:9717-9725`),
//! - old enum labels map to v5 enums; fuzzy `assessment_type` labels
//!   normalize with an explicit warning on the imported row (honesty
//!   doctrine: the inference is always labeled, never silently imposed),
//! - v4 secret fields (`gemini_api_key`, `teams_token`, `moodle_token`,
//!   `moodle_ical_url`, `pairing_pin`, `teams_client_id`, …) **cannot enter
//!   the store**: the import type has no such fields, and their presence is
//!   reported back honestly (`03` §B6, AGENTS §3),
//! - the Teams/Moodle account *names* (non-secret anchors) become
//!   `tokens_meta` profiles so the UI can show "signed in as …" before the
//!   user re-authenticates on this device.

use std::collections::HashMap;

use crate::store::db::{Db, StoreError};
use crate::store::repo::{
    AssessmentRepo, ConfigRepo, CourseRepo, EmptyReplace, EventRepo, FeedRepo, FlashcardRepo,
    GradeRepo, MetaRepo, MistakeRepo, QuizAttemptRepo, StudySessionRepo, TopicRepo,
};
use crate::types::{
    Assessment, AssessmentType, CompletedTopics, CustomCalendarEvent, FeedConfig, Flashcard,
    GradeRecord, MistakeRecord, QuizAttempt, ScheduleData, StudySessionRecord,
};

/// One v4 export file as typed v5 structs. **Secret-carrying v4 fields are
/// deliberately absent** — `teams_token`, `moodle_token`, `gemini_api_key`
/// etc. have no destination in the v5 data realm; the struct is the
/// compile-level scrub list (the exporter mirrors this).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct V4BackupFile {
    pub assessments: Vec<Assessment>,
    pub schedule: ScheduleData,
    pub completed_topics: CompletedTopics,
    pub grades: HashMap<String, GradeRecord>,
    pub custom_events: Vec<CustomCalendarEvent>,
    pub feeds: Vec<FeedConfig>,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub user_picture: Option<String>,
    pub onboarding_completed: Option<bool>,
    pub auto_sync_gcal: Option<bool>,
    pub sync_weekly_classes_to_gcal: Option<bool>,
    pub gemini_enabled: Option<bool>,
    pub teams_enabled: Option<bool>,
    pub moodle_enabled: Option<bool>,
    pub classroom_enabled: Option<bool>,
    pub moodle_url: Option<String>,
    pub dismiss_conflict_banner: Option<bool>,
    pub last_gmail_sync: Option<String>,
    pub last_gcal_sync: Option<String>,
    pub synced_gcal_map: HashMap<String, String>,
    /// Export stamp (v5-added; absent in original v4 exports).
    pub generated_at: Option<String>,
    // --- v5 study collections (`None` = the file simply does not carry the
    // section, e.g. an original v4 export; `Some(list)` = a full replace on
    // restore). A present-but-EMPTY list is meaningful: it means the exporting
    // tier really had no flashcards/attempts/mistakes, so a restore must clear
    // the local ones instead of merging stale records in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flashcards: Option<Vec<Flashcard>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quiz_attempts: Option<Vec<QuizAttempt>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mistake_bank: Option<Vec<MistakeRecord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub study_sessions: Option<Vec<StudySessionRecord>>,
    /// Non-domain metadata passthrough: the web tier's focus-minutes ledger
    /// (lib/studyStats.ts). Carried transparently — the core never
    /// interprets it, it only round-trips it so a cross-tier move cannot
    /// silently drop it. `None` = section absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub study_stats: Option<serde_json::Value>,
    /// Non-domain metadata passthrough: schedule slots whose times the
    /// exporting tier could not honestly represent in the typed domain shape
    /// (the core's `ScheduleSlot` requires `HH:MM` times). Carried verbatim so
    /// a backup round-trip never fabricates times or silently drops the rows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unscheduled_slots: Vec<serde_json::Value>,
    /// Legacy v5.10 PWA exporters flagged slots whose 09:00/10:30 placeholder
    /// times the exporter itself had invented. On restore those slots are
    /// SKIPPED (with a warning) instead of applied — the placeholders were
    /// never real user data. Never re-serialized.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub invented_slot_times: Vec<String>,
}

/// v4 field names that hold credentials or credentials-adjacent secrets.
/// They are accepted (v4 files always carried them), never read into the
/// store, and their presence is reported so the audit trail is honest.
pub const V4_SECRET_KEYS: &[&str] = &[
    "gemini_api_key",
    "teams_token",
    "teams_client_id",
    "pairing_pin",
    "moodle_token",
    "moodle_ical_url",
];

/// `config_kv` key preserving a backup's non-domain `unscheduled_slots`
/// metadata so a backup round-trip can re-export the same rows instead of
/// dropping them (honesty doctrine: nothing silently vanishes).
pub const UNSCHEDULED_SLOTS_CONFIG_KEY: &str = "quizradar_unscheduled_slots_v1";

/// `config_kv` key mirroring the web tier's focus-minutes ledger
/// (`lib/studyStats.ts` `STUDY_STATS_STORAGE_KEY`) so a cross-tier backup move
/// keeps the stats without the core interpreting them.
pub const STUDY_STATS_CONFIG_KEY: &str = "quizradar_local_study_stats_v1";

/// What one import did. Counts are the honest summary a success toast may
/// quote; `secrets_ignored` lists the v4 keys present-and-dropped.
/// camelCase wire: the desktop command serializes this struct verbatim and
/// the web contract (types.ts ImportReport) reads camelCase twins.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub assessments_imported: usize,
    pub courses_imported: usize,
    pub slots_imported: usize,
    /// Slots refused on restore (missing/placeholder times). They are never
    /// silently dropped: the honest count lands here and, when the file
    /// carried them as `unscheduled_slots` metadata, they are preserved in
    /// the store's non-domain config for a later re-export.
    #[serde(default)]
    pub slots_skipped: usize,
    pub topics_imported: usize,
    pub grades_imported: usize,
    pub custom_events_imported: usize,
    pub feeds_imported: usize,
    #[serde(default)]
    pub flashcards_imported: usize,
    #[serde(default)]
    pub quiz_attempts_imported: usize,
    #[serde(default)]
    pub mistakes_imported: usize,
    #[serde(default)]
    pub study_sessions_imported: usize,
    #[serde(default)]
    pub study_stats_restored: bool,
    pub secrets_ignored: Vec<String>,
    /// Partial-failure notices. The web ImportReport declares these; the v4
    /// importer keeps them empty because every skip there is fatal.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Parses + validates a v4 backup JSON string.
///
/// The v4 restore guard (`app.js:9717-9725`) demanded `assessments[]` and
/// `schedule.courses[]` before "Restore will REPLACE your current local
/// academic data with this backup file" — same rule here: a JSON file that
/// merely *looks* backup-ish (only grades, or a stray dashboard) is refused.
pub fn parse_v4_backup(json: &str) -> Result<V4BackupFile, StoreError> {
    let raw: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| StoreError::Validation(format!("Failed to parse backup JSON: {e}")))?;
    let assessments_ok = raw
        .get("assessments")
        .map(serde_json::Value::is_array)
        .unwrap_or(false);
    let courses_ok = raw
        .get("schedule")
        .and_then(|schedule| schedule.get("courses"))
        .map(serde_json::Value::is_array)
        .unwrap_or(false);
    if !assessments_ok || !courses_ok {
        return Err(StoreError::Validation(
            "This file is not a QuizRadar backup (missing assessments or schedule).".to_string(),
        ));
    }

    // The typed parse consumes `raw`; the fuzzy-label pass below needs the
    // original labels, so keep a cheap clone first.
    let raw_assessments = raw.get("assessments").cloned().unwrap_or_default();

    let mut backup: V4BackupFile = serde_json::from_value(raw).map_err(|e| {
        StoreError::Validation(format!("Backup file has invalid QuizRadar records: {e}"))
    })?;

    // Enum normalization: fuzzy assessment-type labels resolve to the v5
    // ladder here (after serde coercion) and every normalization is labeled
    // as a warning on the row itself.
    for (index, assessment) in backup.assessments.iter_mut().enumerate() {
        let Some(label) = raw_assessments
            .get(index)
            .and_then(|a| a.get("assessment_type"))
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        let (resolved, fuzzy) = AssessmentType::from_import_label(label);
        if fuzzy {
            assessment.warnings.push(format!(
                "Imported from v4: type “{label}” normalized to “{}”.",
                resolved.as_str()
            ));
        }
        assessment.assessment_type = resolved;
    }

    Ok(backup)
}

/// Full import: parse, then write everything in **one transaction** so a
/// partial import can never exist (a whole backup is all-or-nothing).
pub fn import_v4_backup_json(
    db: &Db,
    json: &str,
    updated_at: &str,
) -> Result<ImportReport, StoreError> {
    let backup = parse_v4_backup(json)?;
    let report_secrets = collect_secret_keys(json);

    // Legacy v5.10 PWA exporters flagged the slots whose 09:00/10:30 times the
    // exporter itself had invented. Those placeholders are NOT user data —
    // applying them here would re-fabricate a schedule that never existed —
    // so they are skipped into the honest warnings list.
    let mut warnings: Vec<String> = Vec::new();
    let mut schedule = backup.schedule.clone();
    let invented: std::collections::HashSet<&str> = backup
        .invented_slot_times
        .iter()
        .map(String::as_str)
        .collect();
    let original_slot_count = schedule.slots.len();
    if !invented.is_empty() {
        schedule.slots.retain(|slot| {
            if invented.contains(slot.id.as_str()) {
                warnings.push(format!(
                    "A class slot whose times were placeholder values in the backup was skipped ({}).",
                    slot.id
                ));
                false
            } else {
                true
            }
        });
    }
    let slots_skipped = original_slot_count - schedule.slots.len();

    {
        let tx = db.transaction()?;

        // Schedule (courses + slots + semester) — full replace as v4 restore.
        CourseRepo::new(&tx).save_all(&schedule, updated_at)?;

        // Preserve (not interpret) the backup's non-domain slot metadata so a
        // round-trip re-exports the same rows instead of dropping them.
        if !backup.unscheduled_slots.is_empty() {
            let payload = serde_json::to_value(&backup.unscheduled_slots)?;
            ConfigRepo::new(&tx).set_raw(UNSCHEDULED_SLOTS_CONFIG_KEY, &payload)?;
        }
        {
            let meta = MetaRepo::new(&tx);
            meta.set_schedule_updated_at(updated_at)?;
            match backup
                .schedule
                .semester
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(text) => meta.set("schedule_semester", Some(text))?,
                None => meta.set("schedule_semester", None)?,
            }
            match backup
                .schedule
                .academic_week_start
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(text) => meta.set("schedule_academic_week_start", Some(text))?,
                None => meta.set("schedule_academic_week_start", None)?,
            }
        }

        // Radar replacement: v4's assessments arrive as the scanned snapshot.
        // A restore is an explicit full replace — the user asked for this
        // backup, so an empty backup legitimately clears the radar
        // (`EmptyReplace::Allow`; a scan would refuse the same emptiness).
        AssessmentRepo::new(&tx).replace_all(
            &backup.assessments,
            updated_at,
            EmptyReplace::Allow,
        )?;

        // Completed topics: additive, true-only (v4 map may contain false
        // entries — they are ignored; absence already means incomplete).
        // v4 (and pre-migration v5) backups key completion by topic POSITION;
        // remap through the just-imported topics so a reordered announcement
        // keeps its checkmarks (the store is content-addressed from v5.0.1).
        let (completed, _remapped, _dropped) = crate::plan::dashboard::remap_legacy_topic_keys(
            &backup.completed_topics,
            &backup.assessments,
        );
        let topics_merged = TopicRepo::new(&tx).merge_additive(&completed, updated_at)?;

        // Grades: upsert-fill — non-null remote fields overwrite, nothing
        // is erased; validated so a corrupt v4 grade fails loudly here.
        let grade_repo = GradeRepo::new(&tx);
        let mut grades_imported = 0usize;
        for (id, record) in &backup.grades {
            validate_grade_for_import(id, record)?;
            grade_repo.merge_upsert(id, record, updated_at)?;
            grades_imported += 1;
        }

        // Custom events and feeds.
        let event_repo = EventRepo::new(&tx);
        for event in &backup.custom_events {
            event_repo.upsert(event, updated_at)?;
        }
        let feed_repo = FeedRepo::new(&tx);
        for feed in &backup.feeds {
            feed_repo.save(feed, updated_at)?;
        }

        // Study collections: `Some(list)` = full REPLACE (restore semantics —
        // merging would resurrect stale records over live data); `None` = the
        // file predates the section (v4) and the local collection stays
        // untouched. All inside the same all-or-nothing transaction.
        let flashcards_imported = match &backup.flashcards {
            Some(cards) => {
                FlashcardRepo::new(&tx).delete_all()?;
                for card in cards {
                    FlashcardRepo::new(&tx).upsert(card, updated_at)?;
                }
                cards.len()
            }
            None => 0,
        };
        let quiz_attempts_imported = match &backup.quiz_attempts {
            Some(attempts) => {
                QuizAttemptRepo::new(&tx).delete_all()?;
                for attempt in attempts {
                    QuizAttemptRepo::new(&tx).record(attempt)?;
                }
                attempts.len()
            }
            None => 0,
        };
        let mistakes_imported = match &backup.mistake_bank {
            Some(mistakes) => {
                MistakeRepo::new(&tx).delete_all()?;
                for mistake in mistakes {
                    MistakeRepo::new(&tx).record(mistake, updated_at)?;
                }
                mistakes.len()
            }
            None => 0,
        };
        let study_sessions_imported = match &backup.study_sessions {
            Some(sessions) => {
                StudySessionRepo::new(&tx).delete_all()?;
                for session in sessions {
                    StudySessionRepo::new(&tx).record(session)?;
                }
                sessions.len()
            }
            None => 0,
        };

        // Focus-minutes ledger (web tier's localStorage shape): validated,
        // then preserved verbatim as non-domain metadata. A malformed ledger
        // is skipped with a warning, never trusted.
        let mut study_stats_restored = false;
        if let Some(stats) = &backup.study_stats {
            if is_shape_valid_study_stats(stats) {
                ConfigRepo::new(&tx).set_raw(STUDY_STATS_CONFIG_KEY, stats)?;
                study_stats_restored = true;
            } else {
                warnings.push("A malformed study-stats entry was skipped.".to_string());
            }
        }

        // Config anchors + profile metadata (no credentials).
        write_config_slice(&tx, &backup, updated_at)?;

        tx.commit()?;

        Ok(ImportReport {
            assessments_imported: backup.assessments.len(),
            courses_imported: backup.schedule.courses.len(),
            slots_imported: schedule.slots.len(),
            slots_skipped,
            topics_imported: topics_merged,
            grades_imported,
            custom_events_imported: backup.custom_events.len(),
            feeds_imported: backup.feeds.len(),
            flashcards_imported,
            quiz_attempts_imported,
            mistakes_imported,
            study_sessions_imported,
            study_stats_restored,
            secrets_ignored: report_secrets,
            warnings,
        })
    }
}

/// Mirrors the web tier's ledger validation (`lib/studyStats.ts`): an object
/// with finite `totalMinutes`/`totalSessions` numbers and an object
/// `dailyMinutes`. The core never interprets the payload beyond this shape
/// gate — it is a passthrough, not a domain record.
pub(crate) fn is_shape_valid_study_stats(value: &serde_json::Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    let finite_number = |key: &str| {
        obj.get(key)
            .and_then(serde_json::Value::as_f64)
            .is_some_and(|v| v.is_finite())
    };
    finite_number("totalMinutes")
        && finite_number("totalSessions")
        && obj
            .get("dailyMinutes")
            .map(serde_json::Value::is_object)
            .unwrap_or(false)
}

fn write_config_slice(
    conn: &rusqlite::Connection,
    backup: &V4BackupFile,
    updated_at: &str,
) -> Result<(), StoreError> {
    use crate::store::repo::ConfigRepo;
    let config = ConfigRepo::new(conn);
    let meta = MetaRepo::new(conn);

    if let Some(value) = backup.onboarding_completed {
        config.set_bool("onboarding_completed", value)?;
    }
    // v5 honesty rule (`03` §C1): auto_sync_gcal defaults false and stays
    // false until this device actually earns the scope — a v4 file's `true`
    // (its *pre-auth default*) is never carried over; the user opts in
    // again on settings. Recorded as an explicit `false`, not an omission,
    // so a later v4 re-import can't resurrect the old default.
    config.set_bool("auto_sync_gcal", false)?;
    if let Some(value) = backup.sync_weekly_classes_to_gcal {
        config.set_bool("sync_weekly_classes_to_gcal", value)?;
    }
    if let Some(value) = backup.gemini_enabled {
        // Only the flag: the API key itself was dropped with v4's file and
        // re-entry happens in platform storage (BYOK policy).
        config.set_bool("gemini_enabled", false)?;
        let _ = value;
    }
    for (key, value) in [
        ("teams_enabled", backup.teams_enabled),
        ("moodle_enabled", backup.moodle_enabled),
        ("classroom_enabled", backup.classroom_enabled),
    ] {
        if let Some(enabled) = value {
            config.set_bool(key, enabled)?;
        }
    }
    if backup.moodle_url.is_some() && backup.moodle_url.as_deref().map(str::trim) != Some("") {
        config.set_string("moodle_url", backup.moodle_url.as_deref().map(|u| u.trim()))?;
    }
    if let Some(value) = backup.dismiss_conflict_banner {
        config.set_bool("dismiss_conflict_banner", value)?;
    }
    config.set_string("user_email", backup.user_email.as_deref())?;
    config.set_string("user_name", backup.user_name.as_deref())?;
    config.set_string("user_picture", backup.user_picture.as_deref())?;
    if !backup.synced_gcal_map.is_empty() {
        config.set_synced_gcal_map(&backup.synced_gcal_map)?;
    }
    if let Some(stamp) = backup
        .last_gmail_sync
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        meta.set_last_gmail_sync(stamp)?;
    }
    if let Some(stamp) = backup
        .last_gcal_sync
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        meta.set_last_gcal_sync(stamp)?;
    }

    // Profile anchors: v4's `user_*` belonged to the Google account; the
    // Teams account names to the Microsoft one. Metadata only.
    meta.set_profile(
        "google",
        backup.user_name.as_deref(),
        backup.user_email.as_deref(),
        backup.user_picture.as_deref(),
        updated_at,
    )?;
    if backup.teams_enabled == Some(true) {
        // The account names came through as config anchors in v4
        // (teams_account_*), but v5 binds the Teams profile at the next
        // sign-in on this device — stored empty rather than assuming an
        // email v4 never mirrored into the config slice we consume.
        meta.set_profile("teams", None, None, None, updated_at)?;
    }
    Ok(())
}

fn validate_grade_for_import(id: &str, record: &GradeRecord) -> Result<(), StoreError> {
    if record
        .achieved_score
        .is_some_and(|v| !v.is_finite() || v < 0.0)
    {
        return Err(StoreError::Validation(format!(
            "Backup grade for {id} has an invalid achieved_score."
        )));
    }
    if record.max_score.is_some_and(|v| !v.is_finite() || v <= 0.0) {
        return Err(StoreError::Validation(format!(
            "Backup grade for {id} has an invalid max_score."
        )));
    }
    if record
        .weightage_percent
        .is_some_and(|v| !v.is_finite() || v < 0.0)
    {
        return Err(StoreError::Validation(format!(
            "Backup grade for {id} has an invalid weightage_percent."
        )));
    }
    Ok(())
}

/// Lists which of v4's secret-bearing keys were present in this file (and
/// therefore silently ignored, honestly reported to the caller).
fn collect_secret_keys(json: &str) -> Vec<String> {
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let top_level_and_config = |key: &&'static str| -> bool {
        raw.get(*key).is_some() || raw.get("config").and_then(|cfg| cfg.get(*key)).is_some()
    };
    V4_SECRET_KEYS
        .iter()
        .copied()
        .filter(top_level_and_config)
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::store::repo::{AssessmentRepo, ConfigRepo, MetaRepo, TopicRepo};
    use crate::types::{AssessmentType, ScheduleData};

    const FIXTURE: &str = include_str!("../../tests/fixtures/v4_backup.json");

    fn mem_db() -> Db {
        Db::open_in_memory().unwrap()
    }

    fn minimal_ok(json_assessments: &str) -> String {
        format!(
            r##"{{ "assessments": {json_assessments}, "schedule": {{ "courses": [{{ "id": "CSE241", "name": "Digital Design", "color": "#2563EB" }}] }} }}"##
        )
    }

    #[test]
    fn parse_refuses_files_without_a_radar_or_schedule() {
        let grades_only = r#" { "grades": { "a": {} } } "#;
        let err = parse_v4_backup(grades_only).unwrap_err();
        assert!(
            err.to_string().contains("missing assessments or schedule"),
            "{err}"
        );

        // Missing schedule courses (v4 restore guard demands both).
        let no_schedule = r#" { "assessments": [] } "#;
        let err = parse_v4_backup(no_schedule).unwrap_err();
        assert!(
            err.to_string().contains("missing assessments or schedule"),
            "{err}"
        );

        // Not JSON at all.
        let err = parse_v4_backup("not json at all").unwrap_err();
        assert!(
            err.to_string().contains("Failed to parse backup JSON"),
            "{err}"
        );
    }

    #[test]
    fn parse_maps_fuzzy_type_labels_with_a_warning() {
        let backup = parse_v4_backup(&minimal_ok(
            r#"[{ "id": "e1", "title": "Surprise quiz", "assessment_type": "Quiz", "is_upcoming": true, "urgency_level": "Upcoming", "priority_score": 10 }]"#,
        ))
        .unwrap();
        assert_eq!(
            backup.assessments[0].assessment_type,
            AssessmentType::ClassQuiz
        );
        assert!(
            backup.assessments[0]
                .warnings
                .iter()
                .any(|w| w.contains("Quiz") && w.contains("Class Quiz")),
            "the normalization is labeled on the row: {:?}",
            backup.assessments[0].warnings
        );

        // An exact label imports clean, without a warning.
        let backup = parse_v4_backup(&minimal_ok(
            r#"[{ "id": "e1", "title": "Final", "assessment_type": "Final Exam", "is_upcoming": true, "urgency_level": "Upcoming", "priority_score": 10 }]"#,
        ))
        .unwrap();
        assert_eq!(
            backup.assessments[0].assessment_type,
            AssessmentType::FinalExam
        );
        assert!(backup.assessments[0].warnings.is_empty());
    }

    #[test]
    fn fixture_imports_every_realm_and_reports_the_honest_counts() {
        let db = mem_db();
        let report = import_v4_backup_json(&db, FIXTURE, "2026-10-24T08:00:00Z").unwrap();

        assert_eq!(report.assessments_imported, 3);
        assert_eq!(report.courses_imported, 2);
        assert_eq!(report.slots_imported, 2);
        assert_eq!(
            report.topics_imported, 3,
            "the `false` entry is ignored by the additive merge"
        );
        assert_eq!(report.grades_imported, 1);
        assert_eq!(report.custom_events_imported, 1);
        assert_eq!(report.feeds_imported, 1);
        assert_eq!(
            report.secrets_ignored,
            Vec::from([
                "gemini_api_key",
                "teams_token",
                "teams_client_id",
                "pairing_pin",
                "moodle_token",
                "moodle_ical_url",
            ]),
            "every secret key present in the fixture is named in the report"
        );

        // Schedule landed (courses + slots + semester stamp).
        let schedule = ScheduleData {
            semester: None,
            academic_week_start: None,
            courses: Vec::new(),
            slots: Vec::new(),
        };
        let _ = schedule;
        let courses = CourseRepo::new(db.conn()).list().unwrap();
        assert_eq!(courses.len(), 2);
        let slots = CourseRepo::new(db.conn()).all_slots().unwrap();
        assert_eq!(slots.len(), 2);

        // Radar landed with the fuzzy label normalized + labeled.
        let radar = AssessmentRepo::new(db.conn()).list().unwrap();
        assert_eq!(radar.len(), 3);
        let teams = radar.iter().find(|a| a.id == "teams-880123004").unwrap();
        assert_eq!(teams.assessment_type, AssessmentType::ClassQuiz);
        assert!(
            teams.warnings.iter().any(|w| w.contains("normalized")),
            "honesty note attached to the imported row"
        );

        // Grades + topics.
        let grades = GradeRepo::new(db.conn()).all().unwrap();
        assert_eq!(
            grades.get("email-1778000001").unwrap().achieved_score,
            Some(9.5)
        );
        let topics = TopicRepo::new(db.conn()).all().unwrap();
        assert_eq!(topics.len(), 3);
        // v4's positional keys remapped into content keys through the
        // imported topics (fixture topic index 0 = "Number systems").
        assert_eq!(
            topics.get(&crate::plan::dashboard::topic_key_for_text(
                "email-1778000001",
                "Number systems"
            )),
            Some(&true)
        );
        assert!(
            topics
                .keys()
                .all(|key| crate::plan::dashboard::parse_legacy_topic_key(key).is_none()),
            "no positional key survives the import: {topics:?}"
        );
    }

    #[test]
    fn import_never_stores_secrets_and_resets_the_push_default() {
        let db = mem_db();
        let _report = import_v4_backup_json(&db, FIXTURE, "t").unwrap();

        let config = ConfigRepo::new(db.conn());
        // v4's pre-auth `auto_sync_gcal: true` must NOT survive: the default
        // here is false until this device earns the scope again.
        assert!(!config.auto_sync_gcal().unwrap());
        assert!(
            !config.get_bool("gemini_enabled", false).unwrap(),
            "the flag alone is imported, and the v4 value stays off"
        );
        assert!(config.get_string("moodle_url").unwrap().is_some());

        // No secret key ever reached the database.
        let mut stmt = db.conn().prepare("SELECT count(*) FROM config_kv WHERE key LIKE '%token%' OR key LIKE '%api_key%' OR key LIKE '%pin%'").unwrap();
        let leaked: i64 = stmt.query_row([], |row| row.get(0)).unwrap();
        assert_eq!(leaked, 0, "store is scan-clean of credential-shaped keys");

        // The last_gmail_sync stamp is a stamp, not a secret.
        let meta = MetaRepo::new(db.conn());
        assert_eq!(
            meta.last_gmail_sync().unwrap().as_deref(),
            Some("2026-08-15T05:30:00.000Z")
        );
    }

    #[test]
    fn import_validates_corrupt_grades_loudly() {
        let json = r#"{ "assessments": [], "schedule": { "courses": [] },
            "grades": { "ghost": { "max_score": 0 } } }"#;
        let err = import_v4_backup_json(&mem_db(), json, "t").unwrap_err();
        assert!(err.to_string().contains("invalid max_score"), "{err}");
    }

    #[test]
    fn import_keeps_feeds_https_honest() {
        let json = r#"{ "assessments": [], "schedule": { "courses": [] },
            "feeds": [ { "id": "f1", "name": "Broken", "url": "http://cleartext.example.edu/ics" } ] }"#;
        let result = import_v4_backup_json(&mem_db(), json, "t");
        assert!(
            result.is_err(),
            "v4 restore parity: an http:// feed cannot sneak in"
        );
    }

    #[test]
    fn import_is_all_or_nothing() {
        let json = r#"{ "assessments": [], "schedule": { "courses": [] },
            "feeds": [ { "id": "f", "name": "n", "url": "http://x.example.edu/ics" },
                       { "id": "f2", "name": "ok", "url": "https://ok.example.edu/ics" } ] }"#;
        let db = mem_db();
        let err = import_v4_backup_json(&db, json, "t");
        assert!(err.is_err());
        // Nothing may half-land: schedule rows from the failed tx are gone.
        let courses = CourseRepo::new(db.conn()).list().unwrap();
        assert!(
            courses.is_empty(),
            "a failed import wrote nothing (one transaction)"
        );
    }

    // --- cross-tier study collections (PWA ⇄ desktop contract) --------------

    #[test]
    fn pwa_backup_shape_imports_study_collections_and_never_applies_invented_times() {
        // The PWA export shape (`apps/web/src/pwadapters/rpcAdapter.ts`):
        // dual-named study records, non-domain `unscheduled_slots` metadata,
        // a transparent `study_stats` ledger, and (from v5.10 exporters only)
        // the legacy `invented_slot_times` flag.
        let json = r##"{
            "schema_version": 1,
            "tier": "pwa",
            "schedule": {
                "semester": "Fall 2026",
                "courses": [{ "id": "CSE241", "name": "Digital Design", "color": "#2563EB" }],
                "slots": [
                    { "id": "slot-1", "day": "Thursday", "day_index": 4, "course_id": "CSE241",
                      "course_name": "Digital Design", "type": "Lecture",
                      "start_time": "09:30", "end_time": "10:45", "display_time": "" }
                ]
            },
            "assessments": [],
            "flashcards": [
                { "id": "card-1", "front": "f", "back": "b", "boxLevel": 2,
                  "courseId": "CSE241", "course_id": "CSE241" }
            ],
            "quiz_attempts": [
                { "id": "attempt-1", "assessmentId": "a-1", "assessment_id": "a-1",
                  "timestamp": "2026-11-11T10:00:00.000Z", "score": 3,
                  "totalQuestions": 5, "total_questions": 5, "percentage": 60, "passed": false }
            ],
            "mistake_bank": [
                { "id": "m-1", "assessmentId": "a-1", "assessment_id": "a-1",
                  "questionId": "q-1", "question_id": "q-1", "questionText": "q",
                  "question_text": "q", "options": ["a"], "selectedIndex": 1, "selected_index": 1,
                  "correctIndex": 0, "correct_index": 0, "explanation": "e",
                  "timestamp": "2026-11-11T10:00:00.000Z", "resolved": false }
            ],
            "study_stats": { "totalMinutes": 50, "totalSessions": 2, "dailyMinutes": {}, "lastUpdated": "2026-11-11" },
            "unscheduled_slots": [
                { "id": "slot-timeless", "day": "Monday", "course_id": "CSE241",
                  "start_time": null, "end_time": null }
            ],
            "invented_slot_times": ["slot-legacy"]
        }"##;
        // The legacy flagged slot still carries its (invented) times in the
        // domain schedule — applying it would re-fabricate a schedule.
        let json = json.replace(
            r#""start_time": "09:30", "end_time": "10:45", "display_time": "" }"#,
            r#""start_time": "09:30", "end_time": "10:45", "display_time": "" },
                    { "id": "slot-legacy", "day": "Friday", "day_index": 5, "course_id": "CSE241",
                      "course_name": "Digital Design", "type": "Lecture",
                      "start_time": "09:00", "end_time": "10:30", "display_time": "" }"#,
        );

        let db = mem_db();
        let report = import_v4_backup_json(&db, &json, "2026-11-11T08:00:00Z").unwrap();

        assert_eq!(report.flashcards_imported, 1);
        assert_eq!(report.quiz_attempts_imported, 1);
        assert_eq!(report.mistakes_imported, 1);
        assert!(report.study_stats_restored);
        assert_eq!(report.slots_imported, 1, "only the honest slot lands");
        assert_eq!(
            report.slots_skipped, 1,
            "the invented placeholder slot is skipped"
        );
        assert!(
            report
                .warnings
                .iter()
                .any(|w| w.contains("placeholder values")),
            "the skip is named: {:?}",
            report.warnings
        );

        // The store really holds the collections and the passthrough metadata.
        use crate::store::repo::{FlashcardRepo, MistakeRepo, QuizAttemptRepo};
        assert_eq!(FlashcardRepo::new(db.conn()).list_all().unwrap().len(), 1);
        assert_eq!(QuizAttemptRepo::new(db.conn()).list_all().unwrap().len(), 1);
        assert_eq!(MistakeRepo::new(db.conn()).list_all().unwrap().len(), 1);
        let config = ConfigRepo::new(db.conn());
        let stats = config.get_raw(STUDY_STATS_CONFIG_KEY).unwrap().unwrap();
        assert_eq!(stats["totalSessions"], 2);
        let unscheduled = config
            .get_raw(UNSCHEDULED_SLOTS_CONFIG_KEY)
            .unwrap()
            .unwrap();
        assert_eq!(unscheduled.as_array().unwrap().len(), 1);
        assert_eq!(unscheduled[0]["id"], "slot-timeless");
        // ...and never the invented slot.
        assert_ne!(unscheduled[0]["id"], "slot-legacy");
    }

    #[test]
    fn v4_file_without_study_sections_leaves_local_collections_untouched() {
        use crate::store::repo::FlashcardRepo;
        use crate::types::Flashcard;
        let db = mem_db();
        FlashcardRepo::new(db.conn())
            .upsert(
                &Flashcard {
                    id: "local-1".to_string(),
                    course_id: None,
                    assessment_id: None,
                    topic: None,
                    front: "keep me".to_string(),
                    back: "b".to_string(),
                    box_level: 1,
                    next_review_iso: None,
                    last_reviewed_iso: None,
                },
                "t",
            )
            .unwrap();

        import_v4_backup_json(
            &db,
            r#"{ "assessments": [], "schedule": { "courses": [] } }"#,
            "t",
        )
        .unwrap();

        assert_eq!(
            FlashcardRepo::new(db.conn()).list_all().unwrap().len(),
            1,
            "an absent study section (v4 file) never clears local data"
        );
    }

    #[test]
    fn v4_backup_export_import_round_trips_study_collections() {
        use crate::store::exporter::build_v4_backup;
        use crate::store::repo::{FlashcardRepo, MistakeRepo, QuizAttemptRepo, StudySessionRepo};
        use crate::types::{Flashcard, MistakeRecord, QuizAttempt, StudySessionRecord};

        let db = mem_db();
        let now = "2026-11-11T08:00:00Z";
        {
            let tx = db.transaction().unwrap();
            FlashcardRepo::new(&tx)
                .upsert(
                    &Flashcard {
                        id: "c1".to_string(),
                        course_id: Some("CSE241".to_string()),
                        assessment_id: None,
                        topic: None,
                        front: "front".to_string(),
                        back: "back".to_string(),
                        box_level: 3,
                        next_review_iso: Some("2026-11-15".to_string()),
                        last_reviewed_iso: Some("2026-11-11".to_string()),
                    },
                    now,
                )
                .unwrap();
            QuizAttemptRepo::new(&tx)
                .record(&QuizAttempt {
                    id: "a1".to_string(),
                    assessment_id: "a-1".to_string(),
                    course_id: None,
                    timestamp: "2026-11-11T09:00:00.000Z".to_string(),
                    score: 7,
                    total_questions: 10,
                    passed: true,
                })
                .unwrap();
            MistakeRepo::new(&tx)
                .record(
                    &MistakeRecord {
                        id: "m1".to_string(),
                        attempt_id: Some("a1".to_string()),
                        assessment_id: "a-1".to_string(),
                        course_id: None,
                        question_id: "q1".to_string(),
                        question_text: "q".to_string(),
                        options: vec!["a".to_string(), "b".to_string()],
                        selected_index: 1,
                        correct_index: 0,
                        explanation: "e".to_string(),
                        timestamp: "2026-11-11T09:00:00.000Z".to_string(),
                        resolved: false,
                    },
                    now,
                )
                .unwrap();
            StudySessionRepo::new(&tx)
                .record(&StudySessionRecord {
                    id: "s1".to_string(),
                    course_id: None,
                    assessment_id: None,
                    topic: None,
                    duration_minutes: 25,
                    timestamp: "2026-11-11T09:00:00.000Z".to_string(),
                    date_iso: chrono::NaiveDate::from_ymd_opt(2026, 11, 11).unwrap(),
                })
                .unwrap();
            ConfigRepo::new(&tx)
                .set_raw(
                    STUDY_STATS_CONFIG_KEY,
                    &serde_json::json!({
                        "totalMinutes": 90, "totalSessions": 4,
                        "dailyMinutes": {"2026-11-11": 25}, "lastUpdated": "2026-11-11"
                    }),
                )
                .unwrap();
            ConfigRepo::new(&tx)
                .set_raw(
                    UNSCHEDULED_SLOTS_CONFIG_KEY,
                    &serde_json::json!([{ "id": "slot-preserved", "start_time": null }]),
                )
                .unwrap();
            tx.commit().unwrap();
        }

        // Export (desktop → file) …
        let file = build_v4_backup(
            &db,
            now,
            chrono::NaiveDate::from_ymd_opt(2026, 11, 11).unwrap(),
        )
        .unwrap();
        let file_json = serde_json::to_string(&file).unwrap();
        // The exported file names every study collection (never drops it).
        for section in [
            "flashcards",
            "quiz_attempts",
            "mistake_bank",
            "study_sessions",
        ] {
            assert!(
                file_json.contains(section),
                "export must carry the {section} section"
            );
        }

        // … import into a FRESH device (desktop ← file): restore is a replace.
        let fresh = mem_db();
        // Seed stale local study rows: a restore must REPLACE, not merge.
        {
            let tx = fresh.transaction().unwrap();
            FlashcardRepo::new(&tx)
                .upsert(
                    &Flashcard {
                        id: "stale".to_string(),
                        course_id: None,
                        assessment_id: None,
                        topic: None,
                        front: "old".to_string(),
                        back: "old".to_string(),
                        box_level: 5,
                        next_review_iso: None,
                        last_reviewed_iso: None,
                    },
                    now,
                )
                .unwrap();
            tx.commit().unwrap();
        }
        let report = import_v4_backup_json(&fresh, &file_json, now).unwrap();
        assert_eq!(report.flashcards_imported, 1);
        assert_eq!(report.quiz_attempts_imported, 1);
        assert_eq!(report.mistakes_imported, 1);
        assert_eq!(report.study_sessions_imported, 1);
        assert!(report.study_stats_restored);

        let cards = FlashcardRepo::new(fresh.conn()).list_all().unwrap();
        assert_eq!(cards.len(), 1, "replace, not merge: the stale card is gone");
        assert_eq!(cards[0].id, "c1");
        assert_eq!(cards[0].box_level, 3);
        assert_eq!(
            QuizAttemptRepo::new(fresh.conn()).list_all().unwrap().len(),
            1
        );
        assert_eq!(MistakeRepo::new(fresh.conn()).list_all().unwrap().len(), 1);
        assert_eq!(
            StudySessionRepo::new(fresh.conn())
                .list_all()
                .unwrap()
                .len(),
            1
        );
        let config = ConfigRepo::new(fresh.conn());
        let stats = config.get_raw(STUDY_STATS_CONFIG_KEY).unwrap().unwrap();
        assert_eq!(stats["totalMinutes"], 90);
        let unscheduled = config
            .get_raw(UNSCHEDULED_SLOTS_CONFIG_KEY)
            .unwrap()
            .unwrap();
        assert_eq!(unscheduled[0]["id"], "slot-preserved");
    }
}
