//! UniFFI binding module for Android and Kotlin integration.

use crate::cal::ics::{export_ics_all, export_ics_single};
use crate::parse::email::parse_email_announcement;
use crate::parse::ics::{parse_ics_assessments, IcsOrigin};
use crate::plan::conflicts::detect_conflicts;
use crate::plan::dashboard::{build_dashboard_summary, radar_order};
use crate::plan::study_blocks::{block_date_for, block_id_for, study_block_candidates};
use crate::plan::tasks::build_study_tasks;
use crate::sources::merge_preserving_user_fields;
use crate::store::Store;
use crate::types::{
    Assessment, CachedEmail, CompletedTopics, Course, CustomCalendarEvent, ScheduleData,
    ScheduleSlot,
};
use crate::CORE_VERSION;
use chrono::{FixedOffset, NaiveDate};
use std::sync::Arc;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum QuizRadarFfiError {
    #[error("Store error: {msg}")]
    Store { msg: String },
    #[error("Parse error: {msg}")]
    Parse { msg: String },
    #[error("Validation error: {msg}")]
    Validation { msg: String },
    #[error("Serialization error: {msg}")]
    Serialization { msg: String },
}

impl From<crate::store::db::StoreError> for QuizRadarFfiError {
    fn from(err: crate::store::db::StoreError) -> Self {
        QuizRadarFfiError::Store {
            msg: err.to_string(),
        }
    }
}

impl From<serde_json::Error> for QuizRadarFfiError {
    fn from(err: serde_json::Error) -> Self {
        QuizRadarFfiError::Serialization {
            msg: err.to_string(),
        }
    }
}

fn parse_ref_date(ref_date_iso: &str) -> Result<NaiveDate, QuizRadarFfiError> {
    NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d").map_err(|e| QuizRadarFfiError::Validation {
        msg: format!("Invalid date '{ref_date_iso}': {e}"),
    })
}

#[uniffi::export]
pub fn core_version() -> String {
    CORE_VERSION.to_string()
}

#[uniffi::export]
pub fn parse_email(
    email_json: String,
    schedule_json: String,
    ref_date_iso: String,
) -> Result<String, QuizRadarFfiError> {
    let email: CachedEmail = serde_json::from_str(&email_json)?;
    let schedule: ScheduleData = serde_json::from_str(&schedule_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let parsed = parse_email_announcement(&email, &schedule, ref_date);
    Ok(serde_json::to_string(&parsed)?)
}

#[uniffi::export]
pub fn parse_ics(
    content: String,
    schedule_json: String,
    ref_date_iso: String,
) -> Result<String, QuizRadarFfiError> {
    let schedule: ScheduleData = serde_json::from_str(&schedule_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let origin = IcsOrigin::Moodle { portal_url: None };
    let offset = FixedOffset::east_opt(0).expect("0 is valid offset");
    let (assessments, _stats) =
        parse_ics_assessments(&content, &schedule, &origin, ref_date, offset);
    Ok(serde_json::to_string(&assessments)?)
}

#[uniffi::export]
pub fn radar_order_list(
    assessments_json: String,
    ref_date_iso: String,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let ordered = radar_order(&assessments, ref_date);
    Ok(serde_json::to_string(&ordered)?)
}

#[uniffi::export]
pub fn derive_dashboard_summary(
    assessments_json: String,
    topics_json: String,
    events_json: String,
    ref_date_iso: String,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let topics: CompletedTopics = serde_json::from_str(&topics_json)?;
    let events: Vec<CustomCalendarEvent> = serde_json::from_str(&events_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let summary = build_dashboard_summary(&assessments, &topics, &events, ref_date);
    Ok(serde_json::to_string(&summary)?)
}

#[uniffi::export]
pub fn derive_study_tasks(
    assessments_json: String,
    topics_json: String,
    ref_date_iso: String,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let topics: CompletedTopics = serde_json::from_str(&topics_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let tasks = build_study_tasks(&assessments, &topics, ref_date);
    Ok(serde_json::to_string(&tasks)?)
}

#[uniffi::export]
pub fn detect_schedule_conflicts(
    assessments_json: String,
    events_json: String,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let events: Vec<CustomCalendarEvent> = serde_json::from_str(&events_json)?;
    let conflicts = detect_conflicts(&assessments, &events);
    Ok(serde_json::to_string(&conflicts)?)
}

#[uniffi::export]
pub fn generate_study_blocks_for_exam(
    assessment_json: String,
    schedule_json: String,
    events_json: String,
    today_iso: String,
) -> Result<String, QuizRadarFfiError> {
    let assessment: Assessment = serde_json::from_str(&assessment_json)?;
    let schedule: ScheduleData = serde_json::from_str(&schedule_json)?;
    let events: Vec<CustomCalendarEvent> = serde_json::from_str(&events_json)?;
    let today = parse_ref_date(&today_iso)?;

    let block_id = block_id_for(&assessment.id);
    if events.iter().any(|e| e.id == block_id) {
        return Ok("[]".to_string());
    }

    let exam_date = assessment
        .date
        .unwrap_or_else(|| today + chrono::Duration::days(1));
    let block_date = block_date_for(exam_date);
    let candidates = study_block_candidates(&schedule, &events, block_date);

    let mut generated = Vec::new();
    if let Some(candidate) = candidates.first() {
        let event = CustomCalendarEvent {
            id: block_id,
            title: format!("Study: {}", assessment.title),
            course_id: assessment.course_id.clone(),
            event_type: Some("Study Session".to_string()),
            date: Some(candidate.date),
            start_time: Some(candidate.start),
            end_time: Some(candidate.end),
            room: None,
            notes: Some(format!("Smart study block for {}", assessment.title)),
            color: Some("#10b981".to_string()),
        };
        generated.push(event);
    }

    Ok(serde_json::to_string(&generated)?)
}

#[uniffi::export]
pub fn export_ics_calendar(
    assessments_json: String,
    assessment_id: Option<String>,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let ics = match assessment_id {
        Some(id) => {
            let target = assessments.iter().find(|a| a.id == id).ok_or_else(|| {
                QuizRadarFfiError::Validation {
                    msg: format!("Assessment {id} not found"),
                }
            })?;
            export_ics_single(target)
                .map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?
        }
        None => export_ics_all(&assessments),
    };
    Ok(ics)
}

#[uniffi::export]
pub fn generate_practice_mcq(assessment_json: String) -> Result<String, QuizRadarFfiError> {
    let assessment: Assessment = serde_json::from_str(&assessment_json)?;
    let quiz = crate::ai::practice_fallback::generate_practice_locally(&assessment);
    Ok(serde_json::to_string(&quiz)?)
}

#[uniffi::export]
pub fn merge_sync_assessments(
    existing_json: String,
    incoming_json: String,
) -> Result<String, QuizRadarFfiError> {
    let existing: Vec<Assessment> = serde_json::from_str(&existing_json)?;
    let incoming: Vec<Assessment> = serde_json::from_str(&incoming_json)?;
    let (merged, counts) = merge_preserving_user_fields(&existing, incoming);
    let payload = serde_json::json!({
        "merged": merged,
        "counts": {
            "added": counts.added,
            "updated": counts.updated,
            "unchanged": counts.unchanged,
        }
    });
    Ok(serde_json::to_string(&payload)?)
}

/// Thread-safe NativeStore handle wrapping core `Store`.
#[derive(uniffi::Object)]
pub struct NativeStore {
    inner: Store,
}

#[uniffi::export]
pub fn open_native_store(db_path: String) -> Result<Arc<NativeStore>, QuizRadarFfiError> {
    let db = crate::store::db::Db::open(std::path::Path::new(&db_path))?;
    let store = Store::wrap(db);
    Ok(Arc::new(NativeStore { inner: store }))
}

#[uniffi::export]
pub fn open_in_memory_native_store() -> Result<Arc<NativeStore>, QuizRadarFfiError> {
    let db = crate::store::db::Db::open_in_memory()?;
    let store = Store::wrap(db);
    Ok(Arc::new(NativeStore { inner: store }))
}

#[uniffi::export]
impl NativeStore {
    pub async fn get_state(&self, ref_date_iso: String) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self.inner.load_state(ref_date).await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn save_schedule(
        &self,
        schedule_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let schedule: ScheduleData = serde_json::from_str(&schedule_json)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .save_schedule(schedule, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn upsert_course(
        &self,
        course_json: String,
        slots_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let course: Course = serde_json::from_str(&course_json)?;
        let slots: Vec<ScheduleSlot> = serde_json::from_str(&slots_json)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .upsert_course(course, slots, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn delete_course(
        &self,
        code: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self.inner.delete_course(code, updated_at, ref_date).await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn replace_assessments(
        &self,
        assessments_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .replace_assessments(assessments, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn toggle_topic(
        &self,
        topic_key: String,
        done: bool,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .set_topic_done(topic_key, done, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn update_grade(
        &self,
        assessment_id: String,
        achieved: Option<f64>,
        max: Option<f64>,
        weightage: Option<f64>,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let change = crate::store::repo::GradeChange {
            achieved_score: achieved
                .map(crate::store::repo::FieldUpdate::Set)
                .unwrap_or(crate::store::repo::FieldUpdate::Keep),
            max_score: max
                .map(crate::store::repo::FieldUpdate::Set)
                .unwrap_or(crate::store::repo::FieldUpdate::Keep),
            weightage_percent: weightage
                .map(crate::store::repo::FieldUpdate::Set)
                .unwrap_or(crate::store::repo::FieldUpdate::Keep),
        };
        let snapshot = self
            .inner
            .update_grade(assessment_id, change, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn upsert_custom_event(
        &self,
        event_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let event: CustomCalendarEvent = serde_json::from_str(&event_json)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .upsert_custom_event(event, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn delete_custom_event(
        &self,
        id: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .delete_custom_event(id, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn set_config_string(
        &self,
        key: String,
        value: Option<String>,
    ) -> Result<(), QuizRadarFfiError> {
        self.inner.set_config_string(key, value).await?;
        Ok(())
    }

    pub async fn get_config_string(
        &self,
        key: String,
    ) -> Result<Option<String>, QuizRadarFfiError> {
        let val = self.inner.get_config_string(key).await?;
        Ok(val)
    }

    pub async fn set_config_bool(&self, key: String, value: bool) -> Result<(), QuizRadarFfiError> {
        self.inner.set_config_bool(key, value).await?;
        Ok(())
    }

    pub async fn get_config_bool(
        &self,
        key: String,
        default: bool,
    ) -> Result<bool, QuizRadarFfiError> {
        let val = self.inner.get_config_bool(key, default).await?;
        Ok(val)
    }

    pub async fn export_backup(
        &self,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let json = self
            .inner
            .export_v4_backup_json(updated_at, ref_date)
            .await?;
        Ok(json)
    }

    pub async fn import_backup(
        &self,
        backup_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let report = self
            .inner
            .import_v4_backup(backup_json, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&report)?)
    }
}
