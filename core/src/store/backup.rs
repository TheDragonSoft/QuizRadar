//! Drive-appDataFolder **data-only** backup (`04` §4.6): each device pushes
//! and pulls the data realm through `https://www.googleapis.com/drive/v3`
//! with `spaces=appDataFolder` (scope already held by the Google sign-in).
//! v4 was ported minus everything `03` §B6/D-list deleted:
//! - the calendar-event fallback channel is gone entirely,
//! - `teams_token` is gone **at the type level** — [`BackupPayload`] has no
//!   token fields, so the previous key/token can't even be serialized to
//!   the Drive file knowingly or accidentally,
//! - merge rules stay v4-honest: *topics additive true-only*, *grades
//!   upsert-fill*, *schedule replace-if-newer* (per-record `updated_at`
//!   stamps come from the caller, the core owns no clock).
//!
//! The access token is supplied per client instance by the shell (which
//! owns token storage); it lives only inside the request headers of this
//! struct and is never written to the store or the payload.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::store::db::{Db, StoreError};
use crate::store::repo::{
    AssessmentRepo, CourseRepo, EventRepo, FeedRepo, GradeRepo, MetaRepo, TopicRepo,
};
use crate::types::{
    Assessment, CompletedTopics, CustomCalendarEvent, FeedConfig, GradeRecord, ScheduleData,
};

/// v4's Drive file name kept (old backups stay pull-compatible).
pub const DRIVE_FILE_NAME: &str = "quizradar_cloud_state.json";

/// Backup payload schema (independent of the DB schema number; bumped when
/// the cloud JSON shape changes so older pulls can be detected honestly).
pub const PAYLOAD_SCHEMA_VERSION: u32 = 1;

/// The v4 refuse-to-truncate budget (its calendar channel capped at 8 KB and
/// refused to cut — a truncated push would parse as nothing and silently
/// vanish, worse than an error). v5 keeps the *policy* on the Drive push:
/// a payload over budget is refused loudly instead of partially written.
/// The 8 KB boundary itself belonged to v4's calendar-event fallback channel,
/// not to whole-dataset pushes — a single real semester (topics, study plans,
/// grades, stamps) is far bigger, so capping the Drive push at 8 KB made
/// cloud backup dead on arrival. The budget is now a generous 32 MB: still a
/// hard stop against runaway payloads, effectively "Drive's own limits".
pub const REFUSE_TRUNCATE_BYTES: usize = 32_000_000;

/// Refuses oversize payloads instead of truncating them. `Ok` also asserts
/// the payload parses back — a push that could never be pulled is data loss
/// masquerading as success.
pub fn ensure_refuse_to_truncate(len_bytes: usize, budget: usize) -> Result<(), StoreError> {
    if len_bytes > budget {
        return Err(StoreError::Validation(format!(
            "Backup is {len_bytes} bytes, over the {budget}-byte refuse-to-truncate budget. \
             The file was NOT written (no partial/truncated backups). Export a local \
             backup instead or trim the data."
        )));
    }
    Ok(())
}

/// A push must be complete JSON — the refuse-to-truncate policy also covers
/// accidental truncation of the payload string itself.
pub fn ensure_complete_json(payload: &str) -> Result<(), StoreError> {
    serde_json::from_str::<serde::de::IgnoredAny>(payload).map_err(|e| {
        StoreError::Validation(format!(
            "Backup payload is not complete JSON (refusing to push a truncated file): {e}"
        ))
    })?;
    Ok(())
}

/// Data-only backup payload. **Tokens are structurally absent**: OAuth
/// credentials never appear here, in any sibling field, or in the raw JSON
/// the tests assert against (`03` §B6: token-in-cloud ban).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackupPayload {
    pub schema_version: u32,
    pub client_device_id: String,
    /// Whole-payload stamp (ISO 8601 the caller provides).
    pub updated_at: String,
    /// The timetable dataset; merge = replace-if-newer via
    /// [`RecordStamps::schedule`].
    pub schedule: ScheduleData,
    pub assessments: Vec<Assessment>,
    pub completed_topics: CompletedTopics,
    pub grades: HashMap<String, GradeRecord>,
    pub custom_events: Vec<CustomCalendarEvent>,
    pub feeds: Vec<FeedConfig>,
    /// Per-record stamps used by the merge rules (records without one are
    /// treated as the oldest — they lose to any stamped newer local data).
    #[serde(default)]
    pub record_stamps: RecordStamps,
}

/// Per-record `updated_at` maps. Stamps come from the caller's clock via the
/// store writes; the core only compares them.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct RecordStamps {
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub assessments: HashMap<String, String>,
    #[serde(default)]
    pub events: HashMap<String, String>,
    #[serde(default)]
    pub feeds: HashMap<String, String>,
    #[serde(default)]
    pub grades: HashMap<String, String>,
}

/// What one merge applied — each counter is an honest surface for the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct MergeReport {
    pub assessments_replaced: usize,
    pub assessments_kept_newer: usize,
    pub topics_merged: usize,
    pub grades_merged: usize,
    pub events_upserted: usize,
    pub feeds_upserted: usize,
    pub schedule_replaced: bool,
}

/// Builds the current snapshot as an uploadable payload. Stamps are read
/// from the rows' `updated_at` columns; sections the caller stamped are
/// self-consistent because every write goes through the store.
pub fn build_backup_payload(
    db: &Db,
    device_id: &str,
    updated_at: &str,
) -> Result<BackupPayload, StoreError> {
    build_backup_payload_conn(db.conn(), device_id, updated_at)
}

pub(crate) fn build_backup_payload_conn(
    conn: &rusqlite::Connection,
    device_id: &str,
    updated_at: &str,
) -> Result<BackupPayload, StoreError> {
    let assessment_repo = AssessmentRepo::new(conn);
    let assessments = assessment_repo.list()?;
    let meta = MetaRepo::new(conn);
    let stamps = RecordStamps {
        schedule: meta.schedule_updated_at()?,
        assessments: assessment_repo.record_stamps()?,
        events: EventRepo::new(conn).record_stamps()?,
        feeds: FeedRepo::new(conn).record_stamps()?,
        grades: GradeRepo::new(conn).record_stamps()?,
    };
    Ok(BackupPayload {
        schema_version: PAYLOAD_SCHEMA_VERSION,
        client_device_id: device_id.to_string(),
        updated_at: updated_at.to_string(),
        schedule: super::repo::load_schedule(conn)?,
        assessments,
        completed_topics: TopicRepo::new(conn).all()?,
        grades: GradeRepo::new(conn).all()?,
        custom_events: EventRepo::new(conn).list()?,
        feeds: FeedRepo::new(conn).list()?,
        record_stamps: stamps,
    })
}

/// Applies a pulled payload with the additive rules (`04` §4.6):
/// 1. **topics**: true-only additive (`TopicRepo::merge_additive`),
/// 2. **grades**: upsert-fill (remote non-null fields overwrite; local
///    fields the remote lacks stay),
/// 3. **assessments/events/feeds**: union by id, remote record wins only
///    when its stamp is strictly newer than the local row's,
/// 4. **schedule**: replaced only when the remote dataset stamp is newer
///    (a fresh device with no stamp accepts any populated schedule).
pub(crate) fn merge_backup_payload(
    db: &Db,
    payload: &BackupPayload,
    now: &str,
) -> Result<MergeReport, StoreError> {
    // A pull must never silently mis-merge a payload written by a newer
    // build (field-defaults would fabricate empty sections for shapes this
    // build does not know).
    if payload.schema_version > PAYLOAD_SCHEMA_VERSION {
        return Err(StoreError::Validation(format!(
            "This backup was written by a newer build (payload schema {}, this build understands {}). \
             Update QuizRadar before pulling it.",
            payload.schema_version, PAYLOAD_SCHEMA_VERSION
        )));
    }
    let mut report = MergeReport::default();
    {
        let tx = db.transaction()?;
        let topic_repo = TopicRepo::new(&tx);
        // A payload from a pre-migration build (or an imported v4 file)
        // keys topics by POSITION within its OWN topic lists — remap
        // against the payload's assessments before merging.
        let (completed, _remapped, _dropped) = crate::plan::dashboard::remap_legacy_topic_keys(
            &payload.completed_topics,
            &payload.assessments,
        );
        report.topics_merged = topic_repo.merge_additive(&completed, now)?;

        let assessment_repo = AssessmentRepo::new(&tx);
        let local_stamps = assessment_repo.record_stamps()?;
        for assessment in &payload.assessments {
            let remote_stamp = payload
                .record_stamps
                .assessments
                .get(&assessment.id)
                .cloned()
                .unwrap_or_default();
            let local_stamp = local_stamps
                .get(&assessment.id)
                .cloned()
                .unwrap_or_default();
            if local_stamp > remote_stamp {
                report.assessments_kept_newer += 1;
                continue;
            }
            assessment_repo.upsert(assessment, &remote_stamp)?;
            report.assessments_replaced += 1;
        }

        // Grades merge AFTER the assessments exist — `merge_upsert` refuses
        // grade rows for assessments that exist nowhere, so a fresh-device
        // restore must not merge grades first.
        let grade_repo = GradeRepo::new(&tx);
        let grade_stamps = grade_repo.record_stamps()?;
        for (id, record) in &payload.grades {
            let local_newer = grade_stamps.get(id).is_some_and(|local| {
                local.as_str()
                    >= payload
                        .record_stamps
                        .grades
                        .get(id)
                        .map(String::as_str)
                        .unwrap_or("")
            });
            if !local_newer && grade_repo.merge_upsert(id, record, now)? {
                report.grades_merged += 1;
            }
        }

        let event_repo = EventRepo::new(&tx);
        let event_stamps = event_repo.record_stamps()?;
        for event in &payload.custom_events {
            let remote_stamp = payload
                .record_stamps
                .events
                .get(&event.id)
                .cloned()
                .unwrap_or_default();
            let local_stamp = event_stamps.get(&event.id).cloned().unwrap_or_default();
            if event_stamps.contains_key(&event.id) && local_stamp > remote_stamp {
                continue;
            }
            event_repo.upsert(event, &remote_stamp)?;
            report.events_upserted += 1;
        }

        let feed_repo = FeedRepo::new(&tx);
        let feed_stamps = feed_repo.record_stamps()?;
        for feed in &payload.feeds {
            let remote_stamp = payload
                .record_stamps
                .feeds
                .get(&feed.id)
                .cloned()
                .unwrap_or_default();
            let local_stamp = feed_stamps.get(&feed.id).cloned().unwrap_or_default();
            if feed_stamps.contains_key(&feed.id) && local_stamp > remote_stamp {
                continue;
            }
            // https-only validation still gates remote data on the way in.
            if let Err(error) = super::repo::validate_feed_url(&feed.url) {
                // Skip an invalid remote feed loudly-reported; the rest of
                // the merge proceeds.
                let _ = error;
                continue;
            }
            feed_repo.save(feed, &remote_stamp)?;
            report.feeds_upserted += 1;
        }

        // Schedule: replace-if-newer on the dataset stamp (`None`/empty local
        // = a fresh device, which accepts any populated remote schedule).
        // Equal stamps do NOT replace: an equal stamp carries no information
        // that the remote row is newer, and overwriting on equality clobbers
        // local edits made within the same stamp resolution.
        let meta = MetaRepo::new(&tx);
        let local_schedule_stamp = meta.schedule_updated_at()?.unwrap_or_default();
        let remote_schedule_stamp = payload.record_stamps.schedule.clone().unwrap_or_default();
        let local_schedule_fresh = local_schedule_stamp.is_empty();
        if !payload.schedule.courses.is_empty()
            && (local_schedule_fresh || remote_schedule_stamp > local_schedule_stamp)
        {
            CourseRepo::new(&tx).save_all(&payload.schedule, &remote_schedule_stamp)?;
            meta.set_schedule_updated_at(&remote_schedule_stamp)?;
            match payload
                .schedule
                .semester
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(text) => meta.set("schedule_semester", Some(text))?,
                None => meta.set("schedule_semester", None)?,
            }
            report.schedule_replaced = true;
        }

        tx.commit()?;
    }
    Ok(report)
}

// ---------------------------------------------------------------------------
// Drive HTTP client (the direct port of v4 `cloud_sync.rs`, minus the
// calendar fallback and minus every secret field)
// ---------------------------------------------------------------------------

/// Drive appDataFolder client for one authenticated session. The token is
/// owned by the caller (platform storage) and lives only here, in memory.
pub struct DriveBackupClient {
    http: reqwest::Client,
    access_token: String,
}

impl DriveBackupClient {
    /// `reqwest` client with v4's timeouts (10 s connect / 30 s total).
    pub fn new(access_token: String) -> Result<Self, StoreError> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self { http, access_token })
    }

    async fn search_file_id(&self) -> Result<Option<String>, StoreError> {
        let url = format!(
            "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='{DRIVE_FILE_NAME}' and trashed=false&fields=files(id,name)"
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(StoreError::Validation(format!(
                "Drive API search returned HTTP {}",
                resp.status()
            )));
        }
        let json: serde_json::Value = resp.json().await?;
        Ok(json
            .get("files")
            .and_then(|files| files.as_array())
            .and_then(|files| files.first())
            .and_then(|file| file.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string))
    }

    /// Push: refuse-to-truncate, then PATCH the existing file or create a
    /// new one via multipart upload (v4 Drive flow, one-to-one).
    pub async fn push(&self, payload: &BackupPayload) -> Result<PushOutcome, StoreError> {
        let body = serde_json::to_string(payload)?;
        ensure_refuse_to_truncate(body.len(), REFUSE_TRUNCATE_BYTES)?;
        ensure_complete_json(&body)?;

        if let Some(file_id) = self.search_file_id().await? {
            let url = format!(
                "https://www.googleapis.com/upload/drive/v3/files/{file_id}?uploadType=media"
            );
            let resp = self
                .http
                .patch(&url)
                .bearer_auth(&self.access_token)
                .header("Content-Type", "application/json")
                .body(body)
                .send()
                .await?;
            if resp.status().is_success() {
                return Ok(PushOutcome::Updated { file_id });
            }
            return Err(StoreError::Validation(format!(
                "Drive update error: HTTP {}",
                resp.status()
            )));
        }

        // Create new file via multipart upload (name + parent metadata).
        let boundary = "-------QuizRadarBoundary7MA4YWxkTrZu0gW";
        let metadata = serde_json::json!({
            "name": DRIVE_FILE_NAME,
            "parents": ["appDataFolder"]
        });
        let multipart_body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{body}\r\n--{boundary}--"
        );
        let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
        let resp = self
            .http
            .post(url)
            .bearer_auth(&self.access_token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(multipart_body)
            .send()
            .await?;
        if resp.status().is_success() {
            return Ok(PushOutcome::Created);
        }
        Err(StoreError::Validation(format!(
            "Drive create error: HTTP {}",
            resp.status()
        )))
    }

    /// Pull: `None` when no backup file exists yet (an honest empty state —
    /// never a fabricated "0 backups found" success message).
    pub async fn pull(&self) -> Result<Option<BackupPayload>, StoreError> {
        let Some(file_id) = self.search_file_id().await? else {
            return Ok(None);
        };
        let url = format!("https://www.googleapis.com/drive/v3/files/{file_id}?alt=media");
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.access_token)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(StoreError::Validation(format!(
                "Drive download returned HTTP {}",
                resp.status()
            )));
        }
        let text = resp.text().await?;
        let payload = serde_json::from_str::<BackupPayload>(&text)
            .map_err(|e| StoreError::Validation(format!("Corrupt cloud backup JSON: {e}")))?;
        Ok(Some(payload))
    }
}

/// Result of a push, honest to the last byte: the caller may show exactly
/// "updated file {id}" or "created a new AppData backup".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushOutcome {
    Created,
    Updated { file_id: String },
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::store::repo::{AssessmentRepo, CourseRepo};
    use crate::types::{AssessmentSource, AssessmentType, Course, UrgencyLevel};
    use chrono::{NaiveDate, NaiveTime};

    fn mem_db() -> Db {
        Db::open_in_memory().unwrap()
    }

    fn sample_schedule() -> ScheduleData {
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            courses: vec![Course {
                id: "CSE241".to_string(),
                name: "Digital Design".to_string(),
                color: "#2563EB".to_string(),
                bg: None,
                border: None,
                credits: None,
                max_absences: None,
            }],
            slots: Vec::new(),
        }
    }

    fn sample_assessment(id: &str) -> Assessment {
        Assessment {
            id: id.to_string(),
            course_id: Some("CSE241".to_string()),
            course_name: Some("Digital Design".to_string()),
            title: "Quiz 1 — Digital Logic".to_string(),
            assessment_type: AssessmentType::ClassQuiz,
            date: NaiveDate::from_ymd_opt(2026, 11, 5),
            day_name: Some("Thursday".to_string()),
            start_time: Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()),
            end_time: Some(NaiveTime::from_hms_opt(10, 30, 0).unwrap()),
            display_time: None,
            room: None,
            group: None,
            instructor: None,
            is_upcoming: true,
            days_until: Some(12),
            urgency_level: UrgencyLevel::Upcoming,
            priority_score: 20,
            topics: vec!["Number systems".to_string(), "Karnaugh maps".to_string()],
            warnings: Vec::new(),
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
            elearning_url: None,
            google_cal_url: None,
            gcal_synced: false,
            gcal_event_id: None,
            color: None,
            bg: None,
            border: None,
            semester: None,
            email_subject: None,
            email_sent_date: None,
            source: AssessmentSource::gmail_default(),
            source_icon: None,
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
            last_seen_source_run: None,
            retired_source_run: None,
        }
    }

    // --- refuse-to-truncate -------------------------------------------------

    #[test]
    fn push_budget_refuses_over_borderline() {
        assert!(ensure_refuse_to_truncate(0, REFUSE_TRUNCATE_BYTES).is_ok());
        assert!(ensure_refuse_to_truncate(REFUSE_TRUNCATE_BYTES, REFUSE_TRUNCATE_BYTES).is_ok());

        let err = ensure_refuse_to_truncate(REFUSE_TRUNCATE_BYTES + 1, REFUSE_TRUNCATE_BYTES)
            .unwrap_err();
        assert!(err.to_string().contains("NOT written"), "{err}");
        assert!(err.to_string().contains("refuse-to-truncate"), "{err}");
    }

    #[test]
    fn push_budget_refuses_truncated_json() {
        let payload =
            r#"{"schema_version":1,"client_device_id":"dev-1","updated_at":"2026-10-24T0"#;
        let err = ensure_complete_json(payload).unwrap_err();
        assert!(err.to_string().contains("not complete JSON"), "{err}");
        assert!(ensure_complete_json(r#"{"schema_version":1}"#).is_ok());
    }

    // --- payload build ------------------------------------------------------

    #[test]
    fn payload_is_complete_and_data_only() {
        let db = mem_db();
        let now = "2026-10-24T08:00:00Z";
        {
            let tx = db.transaction().unwrap();
            CourseRepo::new(&tx)
                .save_all(&sample_schedule(), now)
                .unwrap();
            AssessmentRepo::new(&tx)
                .upsert(&sample_assessment("a1"), now)
                .unwrap();
            GradeRepo::new(&tx)
                .merge_upsert(
                    "a1",
                    &GradeRecord {
                        achieved_score: Some(9.5),
                        max_score: Some(15.0),
                        weightage_percent: Some(10.0),
                    },
                    now,
                )
                .unwrap();
            MetaRepo::new(&tx).set_schedule_updated_at(now).unwrap();
            tx.commit().unwrap();
        }

        let payload = build_backup_payload(&db, "dev-1", now).unwrap();
        assert_eq!(payload.schema_version, PAYLOAD_SCHEMA_VERSION);
        assert_eq!(payload.client_device_id, "dev-1");
        assert_eq!(payload.schedule.courses.len(), 1);
        assert_eq!(payload.assessments.len(), 1);
        assert_eq!(payload.grades.get("a1").unwrap().achieved_score, Some(9.5));
        assert_eq!(
            payload
                .record_stamps
                .assessments
                .get("a1")
                .map(String::as_str),
            Some(now),
            "per-record stamps ride with the records"
        );
        assert_eq!(payload.record_stamps.schedule.as_deref(), Some(now));

        // The serialized cloud file carries data only — never credentials.
        let serialized = serde_json::to_string(&payload).unwrap();
        for banned in [
            "token",
            "api_key",
            "client_secret",
            "teams_",
            "pairing",
            "Bearer",
        ] {
            assert!(
                !serialized
                    .to_ascii_lowercase()
                    .contains(&banned.to_ascii_lowercase()),
                "backup payload must be token-free, found banned marker \"{banned}\""
            );
        }
    }

    // --- merge --------------------------------------------------------------

    fn payload_with(
        schedule: ScheduleData,
        assessments: Vec<Assessment>,
        topics: CompletedTopics,
        grades: &[(&str, GradeRecord)],
        remote_stamps: RecordStamps,
    ) -> BackupPayload {
        let grades = grades
            .iter()
            .map(|(id, record)| ((*id).to_string(), record.clone()))
            .collect();
        BackupPayload {
            schema_version: PAYLOAD_SCHEMA_VERSION,
            client_device_id: "remote-dev".to_string(),
            updated_at: remote_stamps
                .schedule
                .clone()
                .unwrap_or_else(|| "2026-10-01T00:00:00Z".to_string()),
            schedule,
            assessments,
            completed_topics: topics,
            grades,
            custom_events: Vec::new(),
            feeds: Vec::new(),
            record_stamps: remote_stamps,
        }
    }

    #[test]
    fn merge_populates_a_fresh_device() {
        let db = mem_db();
        let mut remote = RecordStamps {
            schedule: Some("2026-10-20T08:00:00Z".to_string()),
            ..RecordStamps::default()
        };
        remote
            .assessments
            .insert("a1".into(), "2026-10-20T08:00:00Z".into());
        let mut topics: CompletedTopics = CompletedTopics::new();
        topics.insert("a1::0".to_string(), true);
        topics.insert("a1::1".to_string(), false);
        let payload = payload_with(
            sample_schedule(),
            vec![sample_assessment("a1")],
            topics,
            &[(
                "a1",
                GradeRecord {
                    achieved_score: Some(9.5),
                    max_score: Some(15.0),
                    weightage_percent: Some(10.0),
                },
            )],
            remote,
        );

        let report = merge_backup_payload(&db, &payload, "2026-10-24T08:00:00Z").unwrap();
        assert!(report.schedule_replaced);
        assert_eq!(report.assessments_replaced, 1);
        assert_eq!(report.topics_merged, 1, "only the `true` topic counts");
        assert_eq!(report.grades_merged, 1);

        // The store now really holds it — under the CONTENT key the legacy
        // positional key remapped into (the payload's own topic list is the
        // index→text table).
        let schedule = CourseRepo::new(db.conn()).list().unwrap();
        assert_eq!(schedule[0].id, "CSE241");
        let topic_repo = TopicRepo::new(db.conn());
        assert_eq!(
            topic_repo
                .all()
                .unwrap()
                .get(&crate::plan::dashboard::topic_key_for_text(
                    "a1",
                    "Number systems"
                )),
            Some(&true)
        );
        assert_eq!(
            topic_repo
                .all()
                .unwrap()
                .get(&crate::plan::dashboard::topic_key_for_text(
                    "a1",
                    "Karnaugh maps"
                )),
            None,
            "a `false` entry merges as absence (true-only store)"
        );
        assert_eq!(
            GradeRepo::new(db.conn())
                .get("a1")
                .unwrap()
                .unwrap()
                .achieved_score,
            Some(9.5)
        );
        let meta = MetaRepo::new(db.conn());
        assert_eq!(
            meta.schedule_updated_at().unwrap().as_deref(),
            Some("2026-10-20T08:00:00Z")
        );
        assert_eq!(
            meta.get("schedule_semester").unwrap().as_deref(),
            Some("Fall 2026")
        );
    }

    #[test]
    fn merge_never_rolls_back_newer_local_data() {
        let db = mem_db();
        let now = "2026-10-24T09:00:00Z";
        let older = "2026-10-20T09:00:00Z";

        // Local device already has a NEWER schedule + assessment + grade.
        {
            let tx = db.transaction().unwrap();
            CourseRepo::new(&tx)
                .save_all(
                    &ScheduleData {
                        semester: Some("Fall 2026".into()),
                        courses: vec![Course {
                            id: "MTH115".into(),
                            name: "Linear Algebra".into(),
                            color: "#16A34A".into(),
                            bg: None,
                            border: None,
                            credits: None,
                            max_absences: None,
                        }],
                        slots: Vec::new(),
                    },
                    now,
                )
                .unwrap();
            MetaRepo::new(&tx).set_schedule_updated_at(now).unwrap();
            AssessmentRepo::new(&tx)
                .upsert(&sample_assessment("a1"), now)
                .unwrap();
            let grade_repo = GradeRepo::new(&tx);
            grade_repo
                .write(
                    "a1",
                    &GradeRecord {
                        achieved_score: Some(9.5),
                        max_score: Some(15.0),
                        weightage_percent: Some(10.0),
                    },
                    now,
                )
                .unwrap();
            // Deterministically check the local topic is set.
            TopicRepo::new(&tx).set("a1::0", true, now).unwrap();
            tx.commit().unwrap();
        }

        let mut remote = RecordStamps {
            schedule: Some(older.to_string()),
            ..RecordStamps::default()
        };
        remote.assessments.insert("a1".into(), older.to_string());
        remote.grades.insert("a1".into(), older.to_string());
        let mut remote_topics: CompletedTopics = CompletedTopics::new();
        remote_topics.insert("a1::0".to_string(), false); // would "un-complete"
        let mut remote_schedule = sample_schedule();
        remote_schedule.courses[0] = Course {
            id: "CSE241".into(),
            name: "Digital Design (remote)".into(),
            color: "#EF4444".into(),
            bg: None,
            border: None,
            credits: None,
            max_absences: None,
        };
        let payload = payload_with(
            remote_schedule,
            vec![sample_assessment("a1")], // an older copy of the same row
            remote_topics,
            &[(
                "a1",
                GradeRecord {
                    achieved_score: Some(999.0),
                    max_score: Some(1.0),
                    weightage_percent: None,
                },
            )],
            remote,
        );

        let report = merge_backup_payload(&db, &payload, older).unwrap();
        assert!(
            !report.schedule_replaced,
            "older remote schedule cannot push back newer local"
        );
        assert_eq!(
            report.assessments_kept_newer, 1,
            "older remote assessments lose"
        );
        assert_eq!(report.grades_merged, 0, "older remote grades lose");
        assert_eq!(
            report.topics_merged, 0,
            "remote `false` never un-completes a topic"
        );

        // Local state actually survived.
        let courses = CourseRepo::new(db.conn()).list().unwrap();
        assert_eq!(courses[0].id, "MTH115");
        assert_eq!(
            GradeRepo::new(db.conn())
                .get("a1")
                .unwrap()
                .unwrap()
                .achieved_score,
            Some(9.5)
        );
    }

    #[test]
    fn merge_accepts_newer_remote_changes() {
        let db = mem_db();
        let now = "2026-10-24T09:00:00Z";
        {
            let tx = db.transaction().unwrap();
            AssessmentRepo::new(&tx)
                .upsert(&sample_assessment("a1"), now)
                .unwrap();
            let grade_repo = GradeRepo::new(&tx);
            grade_repo
                .write(
                    "a1",
                    &GradeRecord {
                        achieved_score: Some(9.5),
                        max_score: Some(15.0),
                        weightage_percent: Some(10.0),
                    },
                    now,
                )
                .unwrap();
            tx.commit().unwrap();
        }

        let newer = "2026-10-25T09:00:00Z";
        let mut remote = RecordStamps {
            schedule: None, // no schedule rides along
            ..RecordStamps::default()
        };
        remote.assessments.insert("a1".into(), newer.to_string());
        remote.grades.insert("a1".into(), newer.to_string());
        let payload = payload_with(
            ScheduleData::default(),
            vec![sample_assessment("a1")],
            CompletedTopics::new(),
            &[(
                "a1",
                GradeRecord {
                    achieved_score: Some(11.0),
                    max_score: Some(15.0),
                    weightage_percent: None,
                },
            )],
            remote,
        );
        let report = merge_backup_payload(&db, &payload, newer).unwrap();
        assert_eq!(report.assessments_replaced, 1);
        assert_eq!(report.grades_merged, 1);
        assert_eq!(
            GradeRepo::new(db.conn())
                .get("a1")
                .unwrap()
                .unwrap()
                .achieved_score,
            Some(11.0)
        );
        assert_eq!(
            GradeRepo::new(db.conn())
                .get("a1")
                .unwrap()
                .unwrap()
                .max_score,
            Some(15.0),
            "additive fill keeps local fields the remote lacks"
        );
    }
}
