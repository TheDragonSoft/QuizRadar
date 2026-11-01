//! UniFFI binding module for Android and Kotlin integration.

use crate::auth::pkce::{random_state, PkceChallenge};
use crate::auth::providers::{
    google_authorize_url, google_token_exchange_params, google_union_scopes,
    microsoft_authorize_url, microsoft_token_exchange_params, microsoft_union_scopes,
    AuthorizeRequest, GoogleCapability, MicrosoftCapability, TokenExchangeRequest,
    GOOGLE_TOKEN_URL, MICROSOFT_TOKEN_URL,
};
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
}
