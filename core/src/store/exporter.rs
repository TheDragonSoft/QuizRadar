//! Local backup export in the v4 file shape — the honest twin of v4's
//! `app.js exportLocalBackup` (which deleted `gemini_api_key`, `teams_token`,
//! `moodle_token`, `moodle_ical_url` before serializing). v5 goes further:
//! the export type structurally has no secret fields at all, so nothing can
//! leak even if a future maintainer forgets the scrub list.
//!
//! Used by the v4 fixture round-trip test and by the desktop/PWA export
//! flows (`01` §4 backup modal).

use chrono::NaiveDate;
use rusqlite::Connection;

use crate::store::db::{Db, StoreError};

use super::importer::V4BackupFile;
use super::repo::{read_snapshot, ConfigRepo, EventRepo, FeedRepo, GradeRepo, TopicRepo};

/// Assembles the current data realm as a v4-readable backup file. The
/// snapshot (for derived fields on `assessments`) is refreshed at
/// `reference_date`, exactly how v4 exported its live state.
pub fn build_v4_backup(
    db: &Db,
    updated_at: &str,
    reference_date: NaiveDate,
) -> Result<V4BackupFile, StoreError> {
    build_v4_backup_conn(db.conn(), updated_at, reference_date)
}

pub(crate) fn build_v4_backup_conn(
    conn: &Connection,
    updated_at: &str,
    reference_date: NaiveDate,
) -> Result<V4BackupFile, StoreError> {
    let snapshot = read_snapshot(conn, reference_date)?;
    let config = ConfigRepo::new(conn);
    let meta = super::repo::MetaRepo::new(conn);
    let topic_repo = TopicRepo::new(conn);
    let grade_repo = GradeRepo::new(conn);

    Ok(V4BackupFile {
        generated_at: Some(updated_at.to_string()),
        // The assessments refresh keeps derived fields honest at export time.
        assessments: snapshot.assessments.clone(),
        schedule: snapshot.schedule.clone(),
        completed_topics: topic_repo.all()?,
        grades: grade_repo.all()?,
        custom_events: EventRepo::new(conn).list()?,
        feeds: FeedRepo::new(conn).list()?,
        user_email: config.get_string("user_email")?,
        user_name: config.get_string("user_name")?,
        user_picture: config.get_string("user_picture")?,
        onboarding_completed: Some(config.onboarding_completed()?),
        auto_sync_gcal: Some(config.auto_sync_gcal()?),
        sync_weekly_classes_to_gcal: config
            .get_bool("sync_weekly_classes_to_gcal", false)?
            .into(),
        gemini_enabled: config.get_raw("gemini_enabled")?.and_then(|v| v.as_bool()),
        teams_enabled: config.get_raw("teams_enabled")?.and_then(|v| v.as_bool()),
        moodle_enabled: config.get_raw("moodle_enabled")?.and_then(|v| v.as_bool()),
        classroom_enabled: config
            .get_raw("classroom_enabled")?
            .and_then(|v| v.as_bool()),
        moodle_url: config.get_string("moodle_url")?,
        dismiss_conflict_banner: Some(config.dismiss_conflict_banner()?),
        last_gmail_sync: meta.last_gmail_sync()?,
        last_gcal_sync: meta.last_gcal_sync()?,
        synced_gcal_map: config.synced_gcal_map()?,
    })
}

/// Serialized bytes of the local backup file (UTF-8 JSON, v4-compatible).
pub fn serialize_v4_backup(
    db: &Db,
    updated_at: &str,
    reference_date: NaiveDate,
) -> Result<String, StoreError> {
    serde_json::to_string(&build_v4_backup(db, updated_at, reference_date)?)
        .map_err(StoreError::Json)
}
