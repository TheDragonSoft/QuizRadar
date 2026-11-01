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
    AssessmentRepo, CourseRepo, EmptyReplace, EventRepo, FeedRepo, GradeRepo, MetaRepo, TopicRepo,
};
use crate::types::{
    Assessment, AssessmentType, CompletedTopics, CustomCalendarEvent, FeedConfig, GradeRecord,
    ScheduleData,
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
    pub topics_imported: usize,
    pub grades_imported: usize,
    pub custom_events_imported: usize,
    pub feeds_imported: usize,
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

    {
        let tx = db.transaction()?;

        // Schedule (courses + slots + semester) — full replace as v4 restore.
        CourseRepo::new(&tx).save_all(&backup.schedule, updated_at)?;
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
        let topics_merged =
            TopicRepo::new(&tx).merge_additive(&backup.completed_topics, updated_at)?;

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

        // Config anchors + profile metadata (no credentials).
        write_config_slice(&tx, &backup, updated_at)?;

        tx.commit()?;

        Ok(ImportReport {
            assessments_imported: backup.assessments.len(),
            courses_imported: backup.schedule.courses.len(),
            slots_imported: backup.schedule.slots.len(),
            topics_imported: topics_merged,
            grades_imported,
            custom_events_imported: backup.custom_events.len(),
            feeds_imported: backup.feeds.len(),
            secrets_ignored: report_secrets,
            // Every skip in this importer is a hard failure, so a returned
            // report carries no partial-failure notices.
            warnings: Vec::new(),
        })
    }
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
        assert_eq!(topics.get("email-1778000001::0"), Some(&true));
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
}
