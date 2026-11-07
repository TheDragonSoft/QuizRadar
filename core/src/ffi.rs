//! UniFFI binding module for Android and Kotlin integration.

use crate::auth::pkce::{random_state, PkceChallenge};
use crate::auth::providers::{
    google_authorize_url, google_token_exchange_params, google_union_scopes,
    microsoft_authorize_url, microsoft_token_exchange_params, microsoft_union_scopes,
    AuthorizeRequest, GoogleCapability, MicrosoftCapability, ProviderCapability,
    TokenExchangeRequest, GOOGLE_TOKEN_URL, MICROSOFT_TOKEN_URL,
};
use crate::cal::gcal::{push_assessments_to_google_calendar, GCAL_API_BASE};
use crate::cal::ics::{export_ics_all, export_ics_single};
use crate::parse::email::parse_email_announcement;
use crate::parse::ics::{parse_ics_assessments, IcsOrigin};
use crate::plan::conflicts::detect_conflicts;
use crate::plan::dashboard::{build_dashboard_summary, radar_order};
use crate::plan::study_blocks::{block_date_for, block_id_for, study_block_candidates};
use crate::plan::tasks::build_study_tasks;
use crate::sources::merge_preserving_user_fields;
use crate::sources::sync::{run_sync as core_run_sync, SyncConfig, SyncInput};
use crate::sources::{SourceProgress, SourceStatus, TokenProvider};
use crate::store::backup::{DriveBackupClient, PushOutcome};
use crate::store::Store;
use crate::types::{
    AcademicTrack, Assessment, CachedEmail, CompletedTopics, Course, CustomCalendarEvent,
    ScheduleData, ScheduleSlot,
};
use crate::CORE_VERSION;
use chrono::{FixedOffset, NaiveDate};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
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
    let offset = FixedOffset::east_opt(0).unwrap_or_else(|| unreachable!());
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
    // The declared academic rhythm (`01` §4.1 track chips): tunes the
    // prep-day spread. Unknown/empty strings behave like the default.
    academic_track: String,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let topics: CompletedTopics = serde_json::from_str(&topics_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let track = AcademicTrack::from_config(Some(&academic_track));
    let tasks = build_study_tasks(&assessments, &topics, ref_date, track);
    Ok(serde_json::to_string(&tasks)?)
}

#[uniffi::export]
pub fn get_week_parity(date_iso: String) -> Result<String, QuizRadarFfiError> {
    let date = parse_ref_date(&date_iso)?;
    Ok(crate::plan::parity::date_week_parity(date).to_string())
}

#[uniffi::export]
pub fn calculate_gpa(
    courses_json: String,
    assessments_json: String,
    grades_json: String,
    scale: String,
) -> Result<String, QuizRadarFfiError> {
    let courses: Vec<crate::types::Course> = serde_json::from_str(&courses_json)?;
    let assessments: Vec<crate::types::Assessment> = serde_json::from_str(&assessments_json)?;
    let grades: std::collections::HashMap<String, crate::types::GradeRecord> =
        serde_json::from_str(&grades_json)?;
    let summary = crate::plan::gpa::calculate_gpa(&courses, &assessments, &grades, &scale);
    Ok(serde_json::to_string(&summary)?)
}

#[uniffi::export]
pub fn calculate_study_cushion(
    schedule_json: String,
    events_json: String,
    assessments_json: String,
    tasks_json: String,
    ref_date_iso: String,
    waking_hours: Option<f32>,
) -> Result<String, QuizRadarFfiError> {
    let schedule: crate::types::ScheduleData = serde_json::from_str(&schedule_json)?;
    let events: Vec<crate::types::CustomCalendarEvent> = serde_json::from_str(&events_json)?;
    let assessments: Vec<crate::types::Assessment> = serde_json::from_str(&assessments_json)?;
    let tasks: Vec<crate::plan::tasks::DailyStudyTask> = serde_json::from_str(&tasks_json)?;
    let ref_date = parse_ref_date(&ref_date_iso)?;
    let cushion = crate::plan::cushion::calculate_daily_cushion(
        ref_date,
        &schedule.slots,
        &events,
        &assessments,
        &tasks,
        waking_hours,
    );
    Ok(serde_json::to_string(&cushion)?)
}

/// The content-addressed topic-completion key for one topic
/// (`plan::dashboard::topic_key_for_text`). Shells toggle by this key; the
/// FORMAT lives here so no shell re-implements the hash.
#[uniffi::export]
pub fn topic_key(assessment_id: String, topic_text: String) -> String {
    crate::plan::dashboard::topic_key_for_text(&assessment_id, &topic_text)
}

#[uniffi::export]
pub fn detect_schedule_conflicts(
    assessments_json: String,
    events_json: String,
) -> Result<String, QuizRadarFfiError> {
    let assessments: Vec<Assessment> = serde_json::from_str(&assessments_json)?;
    let events: Vec<CustomCalendarEvent> = serde_json::from_str(&events_json)?;
    // A retired item (its source stopped announcing it) raises no conflict:
    // it is not on the radar any more.
    let live: Vec<Assessment> = assessments
        .into_iter()
        .filter(|assessment| assessment.retired_source_run.is_none())
        .collect();
    let conflicts = detect_conflicts(&live, &events);
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
    // Still parsed so a malformed reference date fails loudly; study blocks
    // are anchored on the assessment's own date, so today is otherwise unused.
    let _today = parse_ref_date(&today_iso)?;

    let block_id = block_id_for(&assessment.id);
    if events.iter().any(|e| e.id == block_id) {
        return Ok("[]".to_string());
    }

    // Undated assessments are unschedulable (`types.rs`): inventing "tomorrow"
    // fabricated an exam eve the radar explicitly says needs confirmation.
    let Some(exam_date) = assessment.date else {
        return Ok("[]".to_string());
    };
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

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OAuthUrlPayload {
    pub url: String,
    pub verifier: String,
    pub state: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OAuthTokensPayload {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
}

#[uniffi::export]
pub fn build_google_auth_url(
    client_id: String,
    redirect_uri: String,
) -> Result<String, QuizRadarFfiError> {
    let pkce = PkceChallenge::generate()
        .map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?;
    let verifier = pkce.verifier().to_string();
    let state = random_state().map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?;
    let scopes = google_union_scopes(&[
        GoogleCapability::GmailRead,
        GoogleCapability::UserProfile,
        GoogleCapability::CalendarEvents,
        GoogleCapability::DriveAppdata,
        GoogleCapability::ClassroomRead,
    ]);
    let req = AuthorizeRequest {
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        scopes: &scopes,
        state: &state,
        code_challenge: pkce.challenge(),
    };
    let url = google_authorize_url(&req)
        .map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?;
    let payload = OAuthUrlPayload {
        url,
        verifier,
        state,
    };
    Ok(serde_json::to_string(&payload)?)
}

#[uniffi::export]
pub fn build_microsoft_auth_url(
    client_id: String,
    redirect_uri: String,
) -> Result<String, QuizRadarFfiError> {
    let pkce = PkceChallenge::generate()
        .map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?;
    let verifier = pkce.verifier().to_string();
    let state = random_state().map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?;
    let scopes = microsoft_union_scopes(&[
        MicrosoftCapability::OfflineAccess,
        MicrosoftCapability::UserProfile,
        MicrosoftCapability::MailRead,
        MicrosoftCapability::CalendarsRead,
    ]);
    let req = AuthorizeRequest {
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        scopes: &scopes,
        state: &state,
        code_challenge: pkce.challenge(),
    };
    let url = microsoft_authorize_url(&req)
        .map_err(|e| QuizRadarFfiError::Validation { msg: e.to_string() })?;
    let payload = OAuthUrlPayload {
        url,
        verifier,
        state,
    };
    Ok(serde_json::to_string(&payload)?)
}

#[uniffi::export]
pub fn exchange_oauth_code(
    provider: String,
    client_id: String,
    code: String,
    redirect_uri: String,
    code_verifier: String,
    token_endpoint_override: Option<String>,
) -> Result<String, QuizRadarFfiError> {
    let exchange_req = TokenExchangeRequest {
        client_id: &client_id,
        code: &code,
        redirect_uri: &redirect_uri,
        code_verifier: &code_verifier,
        // The UniFFI tier exchanges public-client codes only; a confidential
        // client's secret never enters the core crate (and therefore never
        // reaches the WASM bundle). The desktop shell runs its own exchange
        // when a confidential Google client is in use.
        client_secret: None,
    };

    let (default_endpoint, form_params) = match provider.to_lowercase().as_str() {
        "google" => (
            GOOGLE_TOKEN_URL,
            google_token_exchange_params(&exchange_req),
        ),
        "microsoft" => (
            MICROSOFT_TOKEN_URL,
            microsoft_token_exchange_params(&exchange_req),
        ),
        other => {
            return Err(QuizRadarFfiError::Validation {
                msg: format!("Unsupported OAuth provider: {other}"),
            })
        }
    };

    let endpoint = token_endpoint_override
        .as_deref()
        .unwrap_or(default_endpoint);

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| QuizRadarFfiError::Store {
            msg: format!("Failed to create tokio runtime: {e}"),
        })?;

    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .post(endpoint)
            .form(&form_params)
            .send()
            .await
            .map_err(|e| QuizRadarFfiError::Store {
                msg: format!("OAuth token request failed: {e}"),
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(QuizRadarFfiError::Validation {
                msg: format!("OAuth token exchange returned {status}: {body}"),
            });
        }

        let token_json: serde_json::Value =
            resp.json()
                .await
                .map_err(|e| QuizRadarFfiError::Serialization {
                    msg: format!("Failed to parse token response: {e}"),
                })?;

        let access_token = token_json["access_token"]
            .as_str()
            .ok_or_else(|| QuizRadarFfiError::Validation {
                msg: "Missing access_token in token response".to_string(),
            })?
            .to_string();

        let refresh_token = token_json["refresh_token"].as_str().map(|s| s.to_string());
        let expires_in = token_json["expires_in"].as_u64();

        let payload = OAuthTokensPayload {
            access_token,
            refresh_token,
            expires_in,
        };
        Ok(serde_json::to_string(&payload)?)
    })
}

#[uniffi::export]
pub fn notification_id_for(assessment_id: String, kind: String) -> i32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in format!("{kind}::{assessment_id}").bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    (hash & 0x7fffffff) as i32
}

/// Thread-safe NativeStore handle wrapping core `Store`.
#[derive(uniffi::Object)]
pub struct NativeStore {
    inner: Store,
    /// Single-flight gate for scan/push runs (desktop `AppState.sync_in_flight`
    /// parity): two overlapping runs would both load the same gcal map and
    /// both POST the same assessments as new events.
    sync_in_flight: AtomicBool,
}

/// Releases the single-flight gate even when the run errors or the future is
/// dropped mid-await.
struct SyncFlightGuard<'a>(&'a AtomicBool);

impl Drop for SyncFlightGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl NativeStore {
    /// Claims the single-flight slot, mirroring the desktop command layer's
    /// compare-exchange guard.
    fn claim_sync_slot(&self) -> Result<SyncFlightGuard<'_>, QuizRadarFfiError> {
        if self
            .sync_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(QuizRadarFfiError::Validation {
                msg: "A sync operation is already in progress.".to_string(),
            });
        }
        Ok(SyncFlightGuard(&self.sync_in_flight))
    }
}

#[uniffi::export]
pub fn open_native_store(db_path: String) -> Result<Arc<NativeStore>, QuizRadarFfiError> {
    let db = crate::store::db::Db::open(std::path::Path::new(&db_path))?;
    let store = Store::wrap(db);
    Ok(Arc::new(NativeStore {
        inner: store,
        sync_in_flight: AtomicBool::new(false),
    }))
}

#[uniffi::export]
pub fn open_in_memory_native_store() -> Result<Arc<NativeStore>, QuizRadarFfiError> {
    let db = crate::store::db::Db::open_in_memory()?;
    let store = Store::wrap(db);
    Ok(Arc::new(NativeStore {
        inner: store,
        sync_in_flight: AtomicBool::new(false),
    }))
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

    /// Replaces the radar with `assessments_json`.
    ///
    /// This is an EXPLICIT, caller-driven write (the Android shell sets the
    /// radar and resets it), NOT the scan path: an empty list really does
    /// mean "the radar is empty now", so it is allowed to clear it. The scan
    /// path goes through the store's `replace_assessments`, which refuses an
    /// empty replace — a scan that found nothing must never wipe the radar.
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
            .replace_assessments_allowing_empty(assessments, updated_at, ref_date)
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

    #[allow(clippy::too_many_arguments)]
    pub async fn update_grade(
        &self,
        assessment_id: String,
        achieved: Option<f64>,
        max: Option<f64>,
        weightage: Option<f64>,
        clear_achieved: bool,
        clear_max: bool,
        clear_weightage: bool,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let change = crate::store::repo::GradeChange {
            achieved_score: if clear_achieved {
                crate::store::repo::FieldUpdate::Clear
            } else if let Some(val) = achieved {
                crate::store::repo::FieldUpdate::Set(val)
            } else {
                crate::store::repo::FieldUpdate::Keep
            },
            max_score: if clear_max {
                crate::store::repo::FieldUpdate::Clear
            } else if let Some(val) = max {
                crate::store::repo::FieldUpdate::Set(val)
            } else {
                crate::store::repo::FieldUpdate::Keep
            },
            weightage_percent: if clear_weightage {
                crate::store::repo::FieldUpdate::Clear
            } else if let Some(val) = weightage {
                crate::store::repo::FieldUpdate::Set(val)
            } else {
                crate::store::repo::FieldUpdate::Keep
            },
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

    pub async fn record_attendance(
        &self,
        slot_id: String,
        course_id: String,
        date_iso: String,
        status: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let date = parse_ref_date(&date_iso)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let att_status = match status.trim().to_ascii_lowercase().as_str() {
            "absent" => crate::types::AttendanceStatus::Absent,
            "excused" => crate::types::AttendanceStatus::Excused,
            _ => crate::types::AttendanceStatus::Attended,
        };
        let entry = crate::types::AttendanceEntry {
            id: format!("att-{slot_id}-{date_iso}"),
            slot_id,
            course_id,
            date_iso: date,
            status: att_status,
            updated_at,
        };
        let snapshot = self.inner.record_attendance(entry, ref_date).await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn set_course_absence_limit(
        &self,
        course_id: String,
        max_absences: Option<u32>,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self
            .inner
            .set_course_absence_limit(course_id, max_absences, updated_at, ref_date)
            .await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn log_study_session(
        &self,
        session_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let _ = updated_at;
        let session: crate::types::StudySessionRecord = serde_json::from_str(&session_json)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let snapshot = self.inner.log_study_session(session, ref_date).await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn get_study_analytics(
        &self,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let analytics = self.inner.get_study_analytics(ref_date).await?;
        Ok(serde_json::to_string(&analytics)?)
    }

    pub async fn save_quiz_attempt(
        &self,
        attempt_json: String,
        mistakes_json: String,
        updated_at: String,
        ref_date_iso: String,
    ) -> Result<String, QuizRadarFfiError> {
        let attempt: crate::types::QuizAttempt = serde_json::from_str(&attempt_json)?;
        let mistakes: Vec<crate::types::MistakeRecord> = serde_json::from_str(&mistakes_json)?;
        let ref_date = parse_ref_date(&ref_date_iso)?;
        self.inner
            .save_quiz_attempt(attempt, mistakes, updated_at)
            .await?;
        let snapshot = self.inner.load_state(ref_date).await?;
        Ok(serde_json::to_string(&snapshot)?)
    }

    pub async fn list_mistakes(
        &self,
        assessment_id: Option<String>,
    ) -> Result<String, QuizRadarFfiError> {
        let mistakes = self.inner.list_mistakes(assessment_id).await?;
        Ok(serde_json::to_string(&mistakes)?)
    }

    pub async fn resolve_mistake(
        &self,
        mistake_id: String,
        updated_at: String,
    ) -> Result<String, QuizRadarFfiError> {
        let resolved = self.inner.resolve_mistake(mistake_id, updated_at).await?;
        Ok(serde_json::to_string(
            &serde_json::json!({ "resolved": resolved }),
        )?)
    }

    pub async fn upsert_flashcard(
        &self,
        card_json: String,
        updated_at: String,
    ) -> Result<String, QuizRadarFfiError> {
        let card: crate::types::Flashcard = serde_json::from_str(&card_json)?;
        let updated = self.inner.upsert_flashcard(card, updated_at).await?;
        Ok(serde_json::to_string(&updated)?)
    }

    pub async fn list_flashcards(
        &self,
        course_id: Option<String>,
    ) -> Result<String, QuizRadarFfiError> {
        let cards = self.inner.list_flashcards(course_id).await?;
        Ok(serde_json::to_string(&cards)?)
    }

    pub async fn delete_flashcard(&self, card_id: String) -> Result<String, QuizRadarFfiError> {
        let deleted = self.inner.delete_flashcard(card_id).await?;
        Ok(serde_json::to_string(
            &serde_json::json!({ "deleted": deleted }),
        )?)
    }

    pub async fn review_flashcard(
        &self,
        card_id: String,
        correct: bool,
        ref_date_iso: String,
        updated_at: String,
    ) -> Result<String, QuizRadarFfiError> {
        let ref_date = parse_ref_date(&ref_date_iso)?;
        let card = self
            .inner
            .review_flashcard(card_id, correct, ref_date, updated_at)
            .await?;
        Ok(serde_json::to_string(&card)?)
    }

    /// The timetable vision import (`01` §4.1, `05` §4 task b).
    ///
    /// The shell owns the picker and the key; the core owns the prompt, the
    /// validation and the drop rules — so the desktop shell, the browser tier
    /// and Android all run the SAME extraction instead of three copies of it.
    ///
    /// The key is the user's own BYOK key: it travels in the `x-goog-api-key`
    /// header only, is never written to the store and never reaches an error
    /// string (the provider redacts it). The usage counter is the
    /// store-backed Pacific-day ledger, so an Android import is counted
    /// exactly like a desktop one.
    ///
    /// The response is JSON: `{"schedule": …, "dropped_courses": n,
    /// "dropped_slots": n}`. The dropped counts are honest — rows the model
    /// got wrong are counted, never repaired into existence.
    ///
    /// The `async_runtime = "tokio"` attribute is load-bearing: UniFFI 0.28
    /// polls exported async methods on the foreign thread, where no tokio
    /// reactor exists — the Gemini HTTP request would panic there. The
    /// attribute runs the future on the bundled async-compat global runtime
    /// instead. Same reason every async method that touches the network
    /// carries it.
    #[uniffi::method(async_runtime = "tokio")]
    pub async fn extract_timetable_from_image(
        &self,
        image_b64: String,
        mime: String,
        api_key: String,
    ) -> Result<String, QuizRadarFfiError> {
        let key = api_key.trim();
        if key.is_empty() {
            return Err(QuizRadarFfiError::Validation {
                msg: crate::ai::provider::AiError::NoKey.to_string(),
            });
        }
        let kv: std::sync::Arc<dyn crate::ai::provider::QuotaKv> =
            std::sync::Arc::new(self.inner.quota_kv());
        let ledger = std::sync::Arc::new(crate::ai::provider::QuotaLedger::new(kv, None));
        let provider = crate::ai::gemini::GeminiProvider::production(
            Some(key.to_string()),
            std::sync::Arc::new(chrono::Utc::now),
            Some(ledger),
        )
        .map_err(|e| QuizRadarFfiError::Validation { msg: e })?;

        let extracted = crate::ai::tasks::extract_timetable(&provider, &image_b64, &mime)
            .await
            .map_err(|e| QuizRadarFfiError::Validation { msg: e.reason() })?;

        let payload = serde_json::json!({
            "schedule": extracted.schedule,
            "dropped_courses": extracted.dropped_courses,
            "dropped_slots": extracted.dropped_slots,
        });
        Ok(serde_json::to_string(&payload)?)
    }
}

// ---------------------------------------------------------------------------
// Sync / calendar / backup engine (phase 08 Android parity with the desktop
// `commands/sync.rs` orchestration)
// ---------------------------------------------------------------------------

/// FFI mirror of [`ProviderCapability`] (`auth::providers`): tells the shell
/// WHICH capability a token is needed for, so it can serve/refresh the right
/// grant. One variant per capability — no stringly-typed plumbing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiProviderCapability {
    GoogleGmailRead,
    GoogleUserProfile,
    GoogleCalendarEvents,
    GoogleDriveAppdata,
    GoogleClassroomRead,
    MicrosoftOfflineAccess,
    MicrosoftUserProfile,
    MicrosoftMailRead,
    MicrosoftCalendarsRead,
    MicrosoftSignIn,
}

impl From<FfiProviderCapability> for ProviderCapability {
    fn from(capability: FfiProviderCapability) -> Self {
        match capability {
            FfiProviderCapability::GoogleGmailRead => GoogleCapability::GmailRead.into(),
            FfiProviderCapability::GoogleUserProfile => GoogleCapability::UserProfile.into(),
            FfiProviderCapability::GoogleCalendarEvents => GoogleCapability::CalendarEvents.into(),
            FfiProviderCapability::GoogleDriveAppdata => GoogleCapability::DriveAppdata.into(),
            FfiProviderCapability::GoogleClassroomRead => GoogleCapability::ClassroomRead.into(),
            FfiProviderCapability::MicrosoftOfflineAccess => {
                MicrosoftCapability::OfflineAccess.into()
            }
            FfiProviderCapability::MicrosoftUserProfile => MicrosoftCapability::UserProfile.into(),
            FfiProviderCapability::MicrosoftMailRead => MicrosoftCapability::MailRead.into(),
            FfiProviderCapability::MicrosoftCalendarsRead => {
                MicrosoftCapability::CalendarsRead.into()
            }
            FfiProviderCapability::MicrosoftSignIn => MicrosoftCapability::SignIn.into(),
        }
    }
}

impl From<ProviderCapability> for FfiProviderCapability {
    fn from(capability: ProviderCapability) -> Self {
        match capability {
            ProviderCapability::Google(GoogleCapability::GmailRead) => Self::GoogleGmailRead,
            ProviderCapability::Google(GoogleCapability::UserProfile) => Self::GoogleUserProfile,
            ProviderCapability::Google(GoogleCapability::CalendarEvents) => {
                Self::GoogleCalendarEvents
            }
            ProviderCapability::Google(GoogleCapability::DriveAppdata) => Self::GoogleDriveAppdata,
            ProviderCapability::Google(GoogleCapability::ClassroomRead) => {
                Self::GoogleClassroomRead
            }
            ProviderCapability::Microsoft(MicrosoftCapability::OfflineAccess) => {
                Self::MicrosoftOfflineAccess
            }
            ProviderCapability::Microsoft(MicrosoftCapability::UserProfile) => {
                Self::MicrosoftUserProfile
            }
            ProviderCapability::Microsoft(MicrosoftCapability::MailRead) => Self::MicrosoftMailRead,
            ProviderCapability::Microsoft(MicrosoftCapability::CalendarsRead) => {
                Self::MicrosoftCalendarsRead
            }
            ProviderCapability::Microsoft(MicrosoftCapability::SignIn) => Self::MicrosoftSignIn,
        }
    }
}

/// The shell's bearer supply (the platform half of the auth story, `04` §4.3).
///
/// Implement this over EncryptedSharedPreferences (refresh tokens) + in-memory
/// access tokens. Called synchronously from the Rust scan/push engine — the
/// implementation MAY block briefly (e.g. a silent refresh round-trip) but
/// must not call back into the core. Called again after a 401: return a
/// freshly refreshed token if possible, or the same one (the 401 then
/// surfaces honestly as a per-source failure).
///
/// Secrecy: the token travels ONLY in this return value, is never persisted
/// by the core, and never appears in a core error string. Return `None` when
/// no usable token exists for the capability — sources report that honestly
/// instead of pretending.
#[uniffi::export(callback_interface)]
pub trait FfiTokenProvider: Send + Sync {
    /// Current access token for `capability`, or `None` when unavailable.
    fn bearer_token(
        &self,
        capability: FfiProviderCapability,
    ) -> Result<Option<String>, QuizRadarFfiError>;
}

/// Real per-source progress pulses for the scan overlay (`03` §B3: no staged
/// fiction). `stage` is one of the machine-checkable labels the core emits:
/// `"connecting"`, `"searching"`, `"fetching"`, `"parsing"`, `"done"`,
/// `"skipped"`, `"failed"`. `found` counts items discovered so far, `done`
/// counts units of work completed. A source that was never enabled emits NO
/// pulses — never render a stage the core did not report.
#[uniffi::export(callback_interface)]
pub trait FfiSyncProgressListener: Send + Sync {
    fn on_progress(&self, source: String, stage: String, found: u32, done: u32);
}

/// Per-run scan toggles (the caller's controls, `01` §4.1). Feeds are NOT
/// here: they live in the store and are loaded per run.
///
/// Desktop derivation the Android shell should mirror (see
/// `run_native_sync` KDoc): `gmail_enabled` = signed in to Google;
/// `teams_enabled` = signed in to Microsoft AND the Teams toggle;
/// `classroom_enabled` = signed in to Google AND the Classroom toggle
/// (default: follow the Google account); `moodle_enabled` = the Moodle
/// toggle (default off).
#[derive(Debug, Clone, Default, uniffi::Record)]
pub struct FfiSyncConfig {
    pub gmail_enabled: bool,
    pub teams_enabled: bool,
    pub moodle_enabled: bool,
    pub classroom_enabled: bool,
    /// Moodle iCal channel URL. Empty/None = channel off.
    pub moodle_ical_url: Option<String>,
    /// Moodle REST base URL — only used together with `moodle_rest_token`
    /// (a half-configured pair is reported, not half-run).
    pub moodle_rest_url: Option<String>,
    /// Per-call Moodle web-service token. Runtime plumbing only: the core
    /// never stores it, logs it, or puts it in an error string.
    pub moodle_rest_token: Option<String>,
}

/// Bridges an [`FfiTokenProvider`] to the core's async [`TokenProvider`].
/// The callback is synchronous (a memory read or a short blocking refresh);
/// the async wrapper is what the sources await.
struct FfiTokenBridge {
    inner: Box<dyn FfiTokenProvider>,
}

impl FfiTokenBridge {
    fn capability_result(
        inner: &dyn FfiTokenProvider,
        capability: ProviderCapability,
    ) -> Result<String, String> {
        match inner.bearer_token(FfiProviderCapability::from(capability)) {
            Ok(Some(token)) if !token.trim().is_empty() => Ok(token),
            Ok(_) => Err(format!(
                "the device returned no token for {capability:?} — sign in to enable this source"
            )),
            Err(error) => Err(error.to_string()),
        }
    }
}

impl TokenProvider for FfiTokenBridge {
    fn bearer<'a>(
        &'a self,
        capability: ProviderCapability,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send + 'a>> {
        // The callback is synchronous by contract; there is nothing to await.
        Box::pin(std::future::ready(Self::capability_result(
            self.inner.as_ref(),
            capability,
        )))
    }
}

/// The caller's local-offset and stamps, one per method. The core owns no
/// clock: every timestamp in a persisted row comes from the caller.
fn parse_local_offset(offset_seconds: i32) -> Result<FixedOffset, QuizRadarFfiError> {
    FixedOffset::east_opt(offset_seconds).ok_or_else(|| QuizRadarFfiError::Validation {
        msg: format!("Invalid local UTC offset {offset_seconds}s (must be within ±24h)"),
    })
}

#[uniffi::export]
impl NativeStore {
    /// Runs the full source scan (Gmail/Teams/Moodle/Classroom/.ics feeds)
    /// and persists the merged radar — the Android twin of the desktop
    /// `run_sync` command.
    ///
    /// What it does, in order (identical to the desktop orchestration):
    /// 1. loads schedule + existing radar + feeds from this store,
    /// 2. runs every source enabled in `sync_config` concurrently — tokens
    ///    arrive only through the callback interfaces, only for sources that
    ///    are enabled AND signed in,
    /// 3. merges with user-field preservation (grades, gcal flags survive),
    ///    applies retire-unseen semantics for authoritative sources,
    /// 4. persists the merged radar through the store (an empty scan NEVER
    ///    wipes the radar), and stamps "Last synced" ONLY when at least one
    ///    source actually ran,
    /// 5. returns the honest report as JSON:
    ///    `{"success": true, "totalNew": n, "totalUpdated": n,
    ///      "notes": [...], "discoveredTeams": [Course...],
    ///      "perSource": [{"name", "status": "ran"|"skipped"|"failed",
    ///                     "detail": skip-reason-or-error|null, "found": n,
    ///                     "runId": id|null}, ...]}`.
    ///
    /// `discoveredTeams` are COURSE DISCOVERIES ONLY — adopting them into the
    /// schedule is always the user's explicit decision (use `upsertCourse`).
    ///
    /// Clock injection (core owns no wall clock): `todayIso` is the device's
    /// local date `YYYY-MM-DD`, `offsetSeconds` its UTC offset, `nowIso` the
    /// UTC RFC3339 stamp for row mutations, `localStamp` the human-readable
    /// "Last synced" stamp (desktop uses `yyyy-MM-dd HH:mm`).
    ///
    /// Single-flight: a second overlapping scan/push returns an error. There
    /// is no mid-scan cancel API — a dropped call still finishes its persist
    /// atomically, so the radar is never half-updated.
    #[uniffi::method(async_runtime = "tokio")]
    #[allow(clippy::too_many_arguments)]
    pub async fn run_native_sync(
        &self,
        sync_config: FfiSyncConfig,
        today_iso: String,
        offset_seconds: i32,
        now_iso: String,
        local_stamp: String,
        progress: Box<dyn FfiSyncProgressListener>,
        google_tokens: Option<Box<dyn FfiTokenProvider>>,
        microsoft_tokens: Option<Box<dyn FfiTokenProvider>>,
    ) -> Result<String, QuizRadarFfiError> {
        let _guard = self.claim_sync_slot()?;
        let today = parse_ref_date(&today_iso)?;
        let local = parse_local_offset(offset_seconds)?;

        let snapshot = self.inner.load_state(today).await?;
        let google: Option<Arc<dyn TokenProvider>> = google_tokens
            .map(|tokens| Arc::new(FfiTokenBridge { inner: tokens }) as Arc<dyn TokenProvider>);
        let microsoft: Option<Arc<dyn TokenProvider>> = microsoft_tokens
            .map(|tokens| Arc::new(FfiTokenBridge { inner: tokens }) as Arc<dyn TokenProvider>);

        let config = SyncConfig {
            gmail_enabled: sync_config.gmail_enabled,
            teams_enabled: sync_config.teams_enabled,
            moodle_enabled: sync_config.moodle_enabled,
            classroom_enabled: sync_config.classroom_enabled,
            feeds: snapshot.feeds.clone(),
            google,
            microsoft,
            moodle_ical_url: sync_config.moodle_ical_url,
            moodle_rest_url: sync_config.moodle_rest_url,
            moodle_rest_token: sync_config.moodle_rest_token,
        };
        let input = SyncInput {
            schedule: snapshot.schedule,
            // The store holds no announcement-email cache yet (desktop
            // parity): Gmail dedupes within this run only.
            emails_cache: Vec::new(),
            existing_assessments: snapshot.assessments,
            reference_date: today,
            local,
        };

        let progress_cb = move |pulse: SourceProgress| {
            progress.on_progress(
                pulse.name,
                pulse.stage.to_string(),
                u32::try_from(pulse.found).unwrap_or(u32::MAX),
                u32::try_from(pulse.done).unwrap_or(u32::MAX),
            );
        };

        let report = core_run_sync(&config, &input, None, &progress_cb)
            .await
            .map_err(|e| QuizRadarFfiError::Store { msg: e })?;

        // "Last synced" reflects real fetches only: a scan in which every
        // source was skipped or failed fetched nothing, so no stamp is
        // written (desktop parity).
        let fetched_anything = report
            .per_source
            .iter()
            .any(|run| matches!(run.status, SourceStatus::Ran));

        if !report.assessments.is_empty() {
            self.inner
                .replace_assessments(report.assessments, now_iso, today)
                .await?;
        }

        let mut notes = report.notes;
        if fetched_anything {
            if let Err(e) = self.inner.set_last_gmail_sync(local_stamp).await {
                // The scan itself succeeded; say so in the report instead of
                // pretending the whole scan failed (desktop parity).
                notes.push(format!(
                    "The scan finished, but the 'Last synced' stamp could not be saved: {e}"
                ));
            }
        }

        let discovered_teams = report
            .discovered_teams
            .map(|d| d.courses)
            .unwrap_or_default();
        let per_source: Vec<serde_json::Value> = report
            .per_source
            .iter()
            .map(|run| {
                let (status, detail) = match &run.status {
                    SourceStatus::Ran => ("ran", serde_json::Value::Null),
                    SourceStatus::Skipped { reason } => ("skipped", serde_json::json!(reason)),
                    SourceStatus::Failed { error } => ("failed", serde_json::json!(error)),
                };
                serde_json::json!({
                    "name": run.name,
                    "status": status,
                    "detail": detail,
                    "found": run.found,
                    "runId": run.run_id,
                })
            })
            .collect();

        let payload = serde_json::json!({
            "success": true,
            "totalNew": report.total_new,
            "totalUpdated": report.total_updated,
            "notes": notes,
            "discoveredTeams": discovered_teams,
            "perSource": per_source,
        });
        Ok(serde_json::to_string(&payload)?)
    }

    /// Pushes every dated upcoming assessment to the user's primary Google
    /// Calendar — the Android twin of the desktop `run_gcal_sync` command.
    ///
    /// Idempotency: the persisted `synced_gcal_map` is loaded, used (mapped
    /// id = PUT, unmapped = POST, 404 on PUT = re-create) and re-persisted
    /// with this run's pairs; the "Last synced" stamp is written only after a
    /// push that really reached Google Calendar. Scope refusals (401/403)
    /// surface as `needsScope` and mark NOTHING as synced. Returns JSON:
    /// `{"success", "created", "updated", "totalPushable", "failedIds": [...],
    /// "skippedUndated", "needsScope", "message", "syncedMap": {...}}`.
    ///
    /// `gcalBaseUrl`: override of the API root for recorded-fixture tests
    /// only — production passes `None` (the real Google Calendar endpoint).
    #[uniffi::method(async_runtime = "tokio")]
    pub async fn push_native_gcal(
        &self,
        today_iso: String,
        offset_seconds: i32,
        local_stamp: String,
        tokens: Box<dyn FfiTokenProvider>,
        gcal_base_url: Option<String>,
    ) -> Result<String, QuizRadarFfiError> {
        let _guard = self.claim_sync_slot()?;
        let today = parse_ref_date(&today_iso)?;
        let offset = parse_local_offset(offset_seconds)?;

        let snapshot = self.inner.load_state(today).await?;
        let provider = FfiTokenBridge { inner: tokens };
        let synced_map = self.inner.synced_gcal_map().await?;
        let offset_fn = move || offset;
        let client =
            crate::sources::http_client().map_err(|e| QuizRadarFfiError::Store { msg: e })?;
        let base_url = gcal_base_url
            .filter(|url| !url.trim().is_empty())
            .unwrap_or_else(|| GCAL_API_BASE.to_string());

        let report = push_assessments_to_google_calendar(
            &client,
            &base_url,
            &provider,
            &snapshot.assessments,
            &synced_map,
            &offset_fn,
        )
        .await;

        // The map MERGES with what was persisted (desktop parity): the report
        // holds only this run's pairs, and replacing wholesale would erase
        // assessments that were excluded from this run.
        if report.success && (!report.synced.is_empty() || !report.failed_ids.is_empty()) {
            let mut merged = synced_map;
            for (assessment_id, event_id) in report.synced.iter() {
                merged.insert(assessment_id.clone(), event_id.clone());
            }
            self.inner
                .set_synced_gcal_map(merged)
                .await
                .map_err(|e| QuizRadarFfiError::Store {
                    msg: format!(
                        "The calendar push finished, but the Calendar event map could not be saved: {e}"
                    ),
                })?;
            self.inner
                .set_last_gcal_sync(local_stamp)
                .await
                .map_err(|e| QuizRadarFfiError::Store {
                    msg: format!(
                        "The calendar push finished, but the 'Last synced' stamp could not be saved: {e}"
                    ),
                })?;
        }

        let synced_map_out = report.synced_map();
        let payload = serde_json::json!({
            "success": report.success,
            "created": report.created,
            "updated": report.updated,
            "totalPushable": report.total_pushable,
            "failedIds": report.failed_ids,
            "skippedUndated": report.skipped_undated,
            "needsScope": report.needs_scope,
            "message": report.message,
            "syncedMap": synced_map_out,
        });
        Ok(serde_json::to_string(&payload)?)
    }

    /// Pushes the data-only Drive-appDataFolder backup (`04` §4.6). The
    /// payload is built from THIS store and is token-free by construction
    /// (the payload type structurally cannot carry credentials); the access
    /// token arrives only through `tokens` and lives only in request headers.
    /// Returns JSON: `{"created": bool, "fileId": string|null}`.
    /// `deviceId` identifies the pushing device in the payload (e.g.
    /// `"quizradar-android"`).
    #[uniffi::method(async_runtime = "tokio")]
    pub async fn push_native_drive_backup(
        &self,
        device_id: String,
        now_iso: String,
        local_stamp: String,
        tokens: Box<dyn FfiTokenProvider>,
    ) -> Result<String, QuizRadarFfiError> {
        let device_id = device_id.trim();
        if device_id.is_empty() {
            return Err(QuizRadarFfiError::Validation {
                msg: "Backup needs a device id.".to_string(),
            });
        }
        let access_token = drive_access_token(tokens.as_ref())?;
        let client = DriveBackupClient::new(access_token)?;
        let payload = self
            .inner
            .build_backup_payload(device_id.to_string(), now_iso)
            .await?;
        let outcome = client.push(&payload).await?;
        self.inner.set_last_backup_push(local_stamp).await?;
        let body = match outcome {
            PushOutcome::Created => serde_json::json!({
                "created": true,
                "fileId": serde_json::Value::Null,
            }),
            PushOutcome::Updated { file_id } => serde_json::json!({
                "created": false,
                "fileId": file_id,
            }),
        };
        Ok(serde_json::to_string(&body)?)
    }

    /// Pulls the Drive-appDataFolder backup and merges it additively
    /// (topics true-only, grades upsert-fill, remote wins only when strictly
    /// newer, schedule replace-if-newer). Returns JSON:
    /// `{"found": bool, "mergeReport": {...}|null}` — `found: false` is the
    /// honest "no backup exists yet" state, never a fabricated success.
    #[uniffi::method(async_runtime = "tokio")]
    pub async fn pull_native_drive_backup(
        &self,
        today_iso: String,
        now_iso: String,
        tokens: Box<dyn FfiTokenProvider>,
    ) -> Result<String, QuizRadarFfiError> {
        let today = parse_ref_date(&today_iso)?;
        let access_token = drive_access_token(tokens.as_ref())?;
        let client = DriveBackupClient::new(access_token)?;
        let maybe_payload = client.pull().await?;
        let body = match maybe_payload {
            Some(payload) => {
                let merge_report = self.inner.merge_backup(payload, now_iso, today).await?;
                serde_json::json!({
                    "found": true,
                    "mergeReport": merge_report,
                })
            }
            None => serde_json::json!({
                "found": false,
                "mergeReport": serde_json::Value::Null,
            }),
        };
        Ok(serde_json::to_string(&body)?)
    }
}

/// Resolves the Drive token through the shell callback, honestly.
fn drive_access_token(tokens: &dyn FfiTokenProvider) -> Result<String, QuizRadarFfiError> {
    match tokens.bearer_token(FfiProviderCapability::GoogleDriveAppdata) {
        Ok(Some(token)) if !token.trim().is_empty() => Ok(token),
        Ok(_) => Err(QuizRadarFfiError::Validation {
            msg: "Not signed in to Google (no Drive backup token available) — sign in to enable cloud backup.".to_string(),
        }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod ffi_sync_tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::plan::fixtures::assessment_on;
    use std::sync::Mutex;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const TODAY_ISO: &str = "2026-10-23";
    const OFFSET_SECS: i32 = 0;
    const NOW_ISO: &str = "2026-10-23T09:00:00Z";
    const LOCAL_STAMP: &str = "2026-10-23 09:00";
    const FEED_FIXTURE: &str = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:CSE241 Quiz 3\nDTSTART:20261103T100000Z\nUID:q3@registrar\nEND:VEVENT\nEND:VCALENDAR\n";
    const EMPTY_CALENDAR: &str = "BEGIN:VCALENDAR\nEND:VCALENDAR\n";

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
    }

    /// Records the real progress pulses the engine emits.
    #[derive(Clone, Default)]
    #[allow(clippy::type_complexity)]
    struct PulseListener(Arc<Mutex<Vec<(String, String, u32, u32)>>>);

    impl FfiSyncProgressListener for PulseListener {
        fn on_progress(&self, source: String, stage: String, found: u32, done: u32) {
            self.0.lock().unwrap().push((source, stage, found, done));
        }
    }

    /// Shell-side token stand-in: a fixed token, none, or an error.
    struct FixedFfiTokens {
        token: Option<String>,
        error: Option<String>,
    }

    impl FixedFfiTokens {
        fn with_token(token: &str) -> Box<Self> {
            Box::new(Self {
                token: Some(token.to_string()),
                error: None,
            })
        }
        fn without_token() -> Box<Self> {
            Box::new(Self {
                token: None,
                error: None,
            })
        }
        fn with_error(error: &str) -> Box<Self> {
            Box::new(Self {
                token: None,
                error: Some(error.to_string()),
            })
        }
    }

    impl FfiTokenProvider for FixedFfiTokens {
        fn bearer_token(
            &self,
            _capability: FfiProviderCapability,
        ) -> Result<Option<String>, QuizRadarFfiError> {
            if let Some(error) = &self.error {
                return Err(QuizRadarFfiError::Validation { msg: error.clone() });
            }
            Ok(self.token.clone())
        }
    }

    fn fresh_store() -> NativeStore {
        let db = crate::store::db::Db::open_in_memory().unwrap();
        NativeStore {
            inner: Store::wrap(db),
            sync_in_flight: AtomicBool::new(false),
        }
    }

    /// The store's persistence gate is https-only by policy; wiremock serves
    /// loopback http, which the FETCH layer accepts for recorded tests (the
    /// loopback exception in `sources::enforce_https`). The fixture feed
    /// therefore rides in through raw SQL, bypassing only the store gate —
    /// the fetch path itself still enforces its own scheme rules.
    fn store_with_loopback_feed(url: &str) -> NativeStore {
        let db = crate::store::db::Db::open_in_memory().unwrap();
        {
            let tx = db.transaction().unwrap();
            tx.execute(
                "INSERT INTO feeds (id, name, url, enabled, updated_at) VALUES ('feed-1', 'Registrar', ?1, 1, ?2)",
                rusqlite::params![url, NOW_ISO],
            )
            .unwrap();
            tx.commit().unwrap();
        }
        NativeStore {
            inner: Store::wrap(db),
            sync_in_flight: AtomicBool::new(false),
        }
    }

    async fn save_assessment(store: &NativeStore, item: Assessment) {
        store
            .inner
            .replace_assessments(vec![item], NOW_ISO.to_string(), today())
            .await
            .unwrap();
    }

    async fn run_default_sync(store: &NativeStore, listener: PulseListener) -> serde_json::Value {
        let report = store
            .run_native_sync(
                FfiSyncConfig::default(),
                TODAY_ISO.to_string(),
                OFFSET_SECS,
                NOW_ISO.to_string(),
                LOCAL_STAMP.to_string(),
                Box::new(listener),
                None,
                None,
            )
            .await
            .unwrap();
        serde_json::from_str(&report).unwrap()
    }

    fn dated_upcoming(id: &str) -> Assessment {
        let mut item = assessment_on(
            id,
            Some("CSE241"),
            "Quiz 1",
            NaiveDate::from_ymd_opt(2026, 11, 3),
            vec!["Loops"],
        );
        item.start_time = chrono::NaiveTime::from_hms_opt(10, 0, 0);
        item.end_time = chrono::NaiveTime::from_hms_opt(11, 30, 0);
        item
    }

    // --- run_native_sync ----------------------------------------------------

    #[tokio::test]
    async fn zero_enabled_sources_is_truthful_and_persists_nothing() {
        let store = fresh_store();
        let value = run_default_sync(&store, PulseListener::default()).await;

        assert_eq!(value["success"], true, "{value}");
        assert_eq!(value["totalNew"].as_u64(), Some(0));
        assert_eq!(value["totalUpdated"].as_u64(), Some(0));
        let per_source = value["perSource"].as_array().unwrap();
        assert_eq!(per_source.len(), 5, "{value}");
        assert!(
            per_source
                .iter()
                .all(|run| run["status"] == "skipped" && run["runId"].is_null()),
            "{per_source:?}"
        );
        assert!(value["notes"].as_array().unwrap().iter().any(|note| note
            .as_str()
            .unwrap()
            .contains("No sources are configured")
            && note.as_str().unwrap().contains("0 found")));

        // Nothing was persisted: the radar stays empty and NO stamp is
        // written (a scan in which every source was skipped fetched nothing).
        let snapshot = store.inner.load_state(today()).await.unwrap();
        assert!(snapshot.assessments.is_empty());
        assert_eq!(store.inner.get_last_gmail_sync().await.unwrap(), None);
    }

    #[tokio::test]
    async fn feeds_only_run_merges_persists_and_stamps() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;
        let store = store_with_loopback_feed(&format!("{}/feed.ics", server.uri()));

        let value = run_default_sync(&store, PulseListener::default()).await;

        assert_eq!(value["totalNew"].as_u64(), Some(1), "{value}");
        let feeds_run = value["perSource"]
            .as_array()
            .unwrap()
            .iter()
            .find(|run| run["name"] == "Calendar feeds")
            .unwrap_or_else(|| panic!("feeds run missing from {value}"));
        assert_eq!(feeds_run["status"], "ran");
        assert!(
            feeds_run["runId"].is_string(),
            "a ran source carries its run id"
        );

        // The merged radar is persisted through the store.
        let snapshot = store.inner.load_state(today()).await.unwrap();
        assert_eq!(snapshot.assessments.len(), 1);
        assert_eq!(snapshot.assessments[0].id, "feed-q3_registrar");
        // A real fetch happened → the stamp was written.
        assert_eq!(
            store.inner.get_last_gmail_sync().await.unwrap().as_deref(),
            Some(LOCAL_STAMP)
        );
    }

    #[tokio::test]
    async fn progress_pulses_reach_the_ffi_listener() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;
        let store = store_with_loopback_feed(&format!("{}/feed.ics", server.uri()));

        let listener = PulseListener::default();
        let _value = run_default_sync(&store, listener.clone()).await;

        let pulses = listener.0.lock().unwrap();
        assert!(pulses
            .iter()
            .any(|(name, stage, _, _)| name == "Calendar feeds" && stage == "fetching"));
        assert!(pulses
            .iter()
            .any(|(name, stage, found, _)| name == "Calendar feeds"
                && stage == "done"
                && *found == 1));
        // A source that was not enabled emits no pulses at all — the overlay
        // must never be told a stage the core did not really run.
        assert!(pulses
            .iter()
            .all(|(name, _, _, _)| name == "Calendar feeds"));
    }

    #[tokio::test]
    async fn a_dropped_feed_item_is_retired_and_persisted_with_the_reason() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;
        let store = store_with_loopback_feed(&format!("{}/feed.ics", server.uri()));

        let first = run_default_sync(&store, PulseListener::default()).await;
        assert_eq!(first["totalNew"].as_u64(), Some(1), "{first}");

        // The feed stops carrying the announcement entirely.
        server.reset().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(EMPTY_CALENDAR))
            .mount(&server)
            .await;

        let second = run_default_sync(&store, PulseListener::default()).await;
        assert_eq!(second["totalNew"].as_u64(), Some(0), "{second}");
        assert!(second["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|note| note.as_str().unwrap().contains("retired")));

        // The retirement is PERSISTED, not just reported.
        let snapshot = store.inner.load_state(today()).await.unwrap();
        assert_eq!(snapshot.assessments.len(), 1, "retired, not deleted");
        assert!(snapshot.assessments[0].retired_source_run.is_some());
        assert!(!snapshot.assessments[0].is_upcoming);
        assert!(snapshot.assessments[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("did not report this announcement again")));
    }

    // --- push_native_gcal ---------------------------------------------------

    #[tokio::test]
    async fn push_native_gcal_creates_persists_the_map_and_stamps() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": "evt-1" })),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path("/calendars/primary/events/evt-1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": "evt-1" })),
            )
            .mount(&server)
            .await;
        let store = fresh_store();
        save_assessment(&store, dated_upcoming("gmail-1")).await;

        let first = store
            .push_native_gcal(
                TODAY_ISO.to_string(),
                OFFSET_SECS,
                LOCAL_STAMP.to_string(),
                FixedFfiTokens::with_token("tok"),
                Some(server.uri()),
            )
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&first).unwrap();
        assert_eq!(value["success"], true, "{value}");
        assert_eq!(value["created"].as_u64(), Some(1));
        assert_eq!(value["syncedMap"]["gmail-1"], "evt-1");
        assert_eq!(
            store
                .inner
                .synced_gcal_map()
                .await
                .unwrap()
                .get("gmail-1")
                .map(String::as_str),
            Some("evt-1"),
            "the idempotency map is persisted"
        );
        assert_eq!(
            store.inner.get_last_gcal_sync().await.unwrap().as_deref(),
            Some(LOCAL_STAMP)
        );

        // The second run must UPDATE via the persisted map, never re-create —
        // the v4 duplicate-events bug.
        let second = store
            .push_native_gcal(
                TODAY_ISO.to_string(),
                OFFSET_SECS,
                LOCAL_STAMP.to_string(),
                FixedFfiTokens::with_token("tok"),
                Some(server.uri()),
            )
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&second).unwrap();
        assert_eq!(value["created"].as_u64(), Some(0), "{value}");
        assert_eq!(value["updated"].as_u64(), Some(1));
        server.verify().await;
    }

    #[tokio::test]
    async fn push_native_gcal_scope_refusal_marks_nothing() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let store = fresh_store();
        save_assessment(&store, dated_upcoming("gmail-1")).await;

        let report = store
            .push_native_gcal(
                TODAY_ISO.to_string(),
                OFFSET_SECS,
                LOCAL_STAMP.to_string(),
                FixedFfiTokens::with_token("tok"),
                Some(server.uri()),
            )
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&report).unwrap();
        assert_eq!(value["success"], false, "{value}");
        assert_eq!(value["needsScope"], true);
        assert_eq!(value["failedIds"], serde_json::json!(["gmail-1"]));
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("reconnect your Google account"));

        // A refused push persists nothing: no map, no stamp.
        assert!(store.inner.synced_gcal_map().await.unwrap().is_empty());
        assert_eq!(store.inner.get_last_gcal_sync().await.unwrap(), None);
    }

    #[tokio::test]
    async fn push_native_gcal_undated_only_is_an_honest_zero() {
        let store = fresh_store();
        save_assessment(
            &store,
            assessment_on("gmail-2", None, "Draft", None, vec![]),
        )
        .await;

        let report = store
            .push_native_gcal(
                TODAY_ISO.to_string(),
                OFFSET_SECS,
                LOCAL_STAMP.to_string(),
                FixedFfiTokens::with_token("tok"),
                None,
            )
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&report).unwrap();
        assert_eq!(value["success"], true, "{value}");
        assert_eq!(value["totalPushable"].as_u64(), Some(0));
        assert_eq!(value["skippedUndated"].as_u64(), Some(1));
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("no confirmed date"));
        assert!(store.inner.synced_gcal_map().await.unwrap().is_empty());
        assert_eq!(store.inner.get_last_gcal_sync().await.unwrap(), None);
    }

    // --- drive backup -------------------------------------------------------

    #[tokio::test]
    async fn drive_push_without_a_token_fails_loudly_and_stamps_nothing() {
        let store = fresh_store();
        let error = store
            .push_native_drive_backup(
                "quizradar-android".to_string(),
                NOW_ISO.to_string(),
                LOCAL_STAMP.to_string(),
                FixedFfiTokens::without_token(),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("sign in"), "{error}");
        assert_eq!(store.inner.get_last_backup_push().await.unwrap(), None);
    }

    #[tokio::test]
    async fn drive_token_errors_surface_honestly() {
        let store = fresh_store();
        let error = store
            .push_native_drive_backup(
                "quizradar-android".to_string(),
                NOW_ISO.to_string(),
                LOCAL_STAMP.to_string(),
                FixedFfiTokens::with_error("refresh rejected"),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("refresh rejected"), "{error}");
        assert_eq!(store.inner.get_last_backup_push().await.unwrap(), None);
    }

    #[tokio::test]
    async fn drive_pull_without_a_token_fails_loudly() {
        let store = fresh_store();
        let error = store
            .pull_native_drive_backup(
                TODAY_ISO.to_string(),
                NOW_ISO.to_string(),
                FixedFfiTokens::without_token(),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("sign in"), "{error}");
        // The radar was not touched.
        let snapshot = store.inner.load_state(today()).await.unwrap();
        assert!(snapshot.assessments.is_empty());
    }
}
