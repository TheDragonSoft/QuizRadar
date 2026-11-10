//! State & data commands (`02` §4 table, `04` §4.2).
//!
//! Provides type-safe async commands for reading and mutating full application
//! state, timetable schedule, courses, custom events, grades, topic completions,
//! and study blocks.

use std::collections::HashMap;

use quizradar_core::plan::dashboard::{topic_key_for_text, DashboardSummary};
use quizradar_core::plan::study_blocks::{block_date_for, block_id_for, study_block_candidates};
use quizradar_core::plan::tasks::StudyTasksPayload;
use quizradar_core::store::repo::{FieldUpdate, GradeChange};
use quizradar_core::types::{
    Assessment, Course, CustomCalendarEvent, FeedConfig, ScheduleData, ScheduleSlot,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::keyring::{KEY_GEMINI_API_KEY, KEY_GOOGLE_REFRESH_TOKEN, KEY_MICROSOFT_REFRESH_TOKEN};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub auto_sync_gcal: bool,
    pub sync_weekly_classes_to_gcal: bool,
    pub gemini_enabled: bool,
    pub onboarding_completed: bool,
    /// The onboarding "academic rhythm" preset (`01` §4.1: the
    /// track/rhythm chips are **persisted**). `None` means the user never
    /// chose one — the UI shows that honestly instead of inventing a default.
    pub academic_track: Option<String>,
    pub teams_enabled: bool,
    pub teams_client_id: Option<String>,
    pub teams_account_name: Option<String>,
    pub teams_account_email: Option<String>,
    pub google_client_id: Option<String>,
    pub moodle_enabled: bool,
    pub moodle_url: Option<String>,
    pub moodle_ical_url: Option<String>,
    pub classroom_enabled: bool,
    pub dismiss_conflict_banner: bool,
    pub synced_gcal_map: HashMap<String, String>,
    pub feeds: Vec<FeedConfig>,
    pub custom_events: Vec<CustomCalendarEvent>,
    pub last_gmail_sync: Option<String>,
    pub last_gcal_sync: Option<String>,
    pub last_backup_push: Option<String>,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub user_picture: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthProfile {
    pub authenticated: bool,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub has_gmail_scope: bool,
    pub has_calendar_scope: bool,
    pub has_teams_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetStatePayload {
    pub config: DesktopConfig,
    pub auth: DesktopAuthProfile,
    pub schedule: ScheduleData,
    pub assessments: Vec<Assessment>,
    pub dashboard: DashboardSummary,
    #[serde(rename = "studyTasksPayload", alias = "study_tasks_payload")]
    pub study_tasks_payload: StudyTasksPayload,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdate {
    pub auto_sync_gcal: Option<bool>,
    pub sync_weekly_classes_to_gcal: Option<bool>,
    pub gemini_enabled: Option<bool>,
    pub onboarding_completed: Option<bool>,
    pub academic_track: Option<String>,
    pub teams_enabled: Option<bool>,
    pub teams_client_id: Option<String>,
    pub teams_account_name: Option<String>,
    pub teams_account_email: Option<String>,
    pub google_client_id: Option<String>,
    pub moodle_enabled: Option<bool>,
    pub moodle_url: Option<String>,
    pub moodle_ical_url: Option<String>,
    pub classroom_enabled: Option<bool>,
    pub dismiss_conflict_banner: Option<bool>,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub user_picture: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGradeInput {
    pub assessment_id: String,
    #[serde(default)]
    pub achieved_score: Option<Option<f64>>,
    #[serde(default)]
    pub max_score: Option<Option<f64>>,
    #[serde(default)]
    pub weightage_percent: Option<Option<f64>>,
}

fn to_field_update<T>(opt: Option<Option<T>>) -> FieldUpdate<T> {
    match opt {
        None => FieldUpdate::Keep,
        Some(None) => FieldUpdate::Clear,
        Some(Some(v)) => FieldUpdate::Set(v),
    }
}

/// Assembles the complete state payload (safe, no secrets).
pub async fn build_full_state(state: &AppState) -> Result<GetStatePayload, String> {
    let today = state.today();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read store state: {e}"))?;

    let has_google_keyring = state
        .keyring
        .get_secret(KEY_GOOGLE_REFRESH_TOKEN)
        .unwrap_or(None)
        .is_some();
    let has_google_mem = state.google_token.read().await.is_some();
    let has_google_auth = has_google_keyring || has_google_mem;

    let has_teams_keyring = state
        .keyring
        .get_secret(KEY_MICROSOFT_REFRESH_TOKEN)
        .unwrap_or(None)
        .is_some();
    let has_teams_mem = state.microsoft_token.read().await.is_some();
    let has_teams_auth = has_teams_keyring || has_teams_mem;

    let user_email = state
        .store
        .get_config_string("user_email".to_string())
        .await
        .unwrap_or(None);
    let user_name = state
        .store
        .get_config_string("user_name".to_string())
        .await
        .unwrap_or(None);
    let user_picture = state
        .store
        .get_config_string("user_picture".to_string())
        .await
        .unwrap_or(None);

    let auth = DesktopAuthProfile {
        authenticated: has_google_auth,
        email: user_email.clone(),
        name: user_name.clone(),
        picture: user_picture.clone(),
        has_gmail_scope: has_google_auth,
        has_calendar_scope: has_google_auth,
        has_teams_auth,
    };

    let config = DesktopConfig {
        auto_sync_gcal: state
            .store
            .get_config_bool("auto_sync_gcal".to_string(), false)
            .await
            .unwrap_or(false),
        sync_weekly_classes_to_gcal: state
            .store
            .get_config_bool("sync_weekly_classes_to_gcal".to_string(), false)
            .await
            .unwrap_or(false),
        // `get_gemini_api_key` accepts the keyring value AND the documented
        // private-install seeds (`QUIZRADAR_GEMINI_API_KEY`, `gemini.key`) —
        // keyring-only presence reported AI as permanently off for seeded
        // installs while the AI commands actually worked.
        gemini_enabled: state.get_gemini_api_key().ok().flatten().is_some()
            && state
                .store
                .get_config_bool("gemini_enabled".to_string(), true)
                .await
                .unwrap_or(true),
        onboarding_completed: state
            .store
            .get_config_bool("onboarding_completed".to_string(), false)
            .await
            .unwrap_or(false),
        academic_track: state
            .store
            .get_config_string("academic_track".to_string())
            .await
            .unwrap_or(None),
        teams_enabled: has_teams_auth
            && state
                .store
                .get_config_bool("teams_enabled".to_string(), true)
                .await
                .unwrap_or(true),
        teams_client_id: Some(
            state
                .effective_microsoft_client_id()
                .await
                .unwrap_or_else(|_| crate::state::DEFAULT_MICROSOFT_CLIENT_ID.to_string()),
        ),
        teams_account_name: state
            .store
            .get_config_string("teams_account_name".to_string())
            .await
            .unwrap_or(None),
        teams_account_email: state
            .store
            .get_config_string("teams_account_email".to_string())
            .await
            .unwrap_or(None),
        // `None` means "no Google client id configured" — the UI shows the
        // setup hint instead of pretending sign-in is ready.
        google_client_id: state.effective_google_client_id().await.ok(),
        moodle_enabled: state
            .store
            .get_config_bool("moodle_enabled".to_string(), false)
            .await
            .unwrap_or(false),
        moodle_url: state
            .store
            .get_config_string("moodle_url".to_string())
            .await
            .unwrap_or(None),
        moodle_ical_url: state
            .store
            .get_config_string("moodle_ical_url".to_string())
            .await
            .unwrap_or(None),
        // The Classroom toggle follows its account unless the user set it:
        // never set means "on while Google is connected" (same rule the scan
        // uses), an explicit `false` means the user turned it off.
        classroom_enabled: match state
            .store
            .get_config_bool_opt("classroom_enabled".to_string())
            .await
            .unwrap_or(None)
        {
            Some(explicit) => explicit,
            None => has_google_auth,
        },
        dismiss_conflict_banner: state
            .store
            .get_dismiss_conflict_banner()
            .await
            .unwrap_or(false),
        // The real Calendar idempotency map: without it the UI's push report
        // and the next push would both believe nothing was ever synced.
        synced_gcal_map: state.store.synced_gcal_map().await.unwrap_or_default(),
        feeds: snapshot.feeds.clone(),
        custom_events: snapshot.custom_events.clone(),
        // The real sync stamps (`kv_meta`): written by the scan / Calendar
        // push / Drive backup only after a fetch that actually happened.
        last_gmail_sync: state.store.get_last_gmail_sync().await.unwrap_or(None),
        last_gcal_sync: state.store.get_last_gcal_sync().await.unwrap_or(None),
        last_backup_push: state.store.get_last_backup_push().await.unwrap_or(None),
        user_email,
        user_name,
        user_picture,
    };

    Ok(GetStatePayload {
        config,
        auth,
        schedule: snapshot.schedule,
        assessments: snapshot.assessments,
        dashboard: snapshot.derived.dashboard,
        study_tasks_payload: snapshot.derived.tasks,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_state(state: State<'_, AppState>) -> Result<GetStatePayload, String> {
    build_full_state(&state).await
}

#[tauri::command]
pub async fn save_schedule(
    state: State<'_, AppState>,
    schedule: ScheduleData,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .save_schedule(schedule, now, today)
        .await
        .map_err(|e| format!("Failed to save schedule: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn upsert_course(
    state: State<'_, AppState>,
    course: Course,
    slots: Option<Vec<ScheduleSlot>>,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    let slots = slots.unwrap_or_default();
    state
        .store
        .upsert_course(course, slots, now, today)
        .await
        .map_err(|e| format!("Failed to upsert course: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn delete_course(
    state: State<'_, AppState>,
    code: String,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .delete_course(code, now, today)
        .await
        .map_err(|e| format!("Failed to delete course: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn update_config(
    state: State<'_, AppState>,
    update: ConfigUpdate,
) -> Result<GetStatePayload, String> {
    if let Some(v) = update.auto_sync_gcal {
        state
            .store
            .set_config_bool("auto_sync_gcal".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.sync_weekly_classes_to_gcal {
        state
            .store
            .set_config_bool("sync_weekly_classes_to_gcal".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.gemini_enabled {
        state
            .store
            .set_config_bool("gemini_enabled".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.onboarding_completed {
        state
            .store
            .set_config_bool("onboarding_completed".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.academic_track {
        // The track is a preset the user picked, not a free-text field: an
        // unknown value is stored as-is (the UI falls back to "unknown"),
        // but an empty one is not stored — "no choice" stays `None`.
        let trimmed = v.trim().to_string();
        let value = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
        state
            .store
            .set_config_string("academic_track".to_string(), value)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.teams_enabled {
        state
            .store
            .set_config_bool("teams_enabled".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.teams_client_id {
        state
            .store
            .set_config_string("teams_client_id".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.teams_account_name {
        state
            .store
            .set_config_string("teams_account_name".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.teams_account_email {
        state
            .store
            .set_config_string("teams_account_email".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.google_client_id {
        state
            .store
            .set_config_string("google_client_id".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.moodle_enabled {
        state
            .store
            .set_config_bool("moodle_enabled".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.moodle_url {
        state
            .store
            .set_config_string("moodle_url".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.moodle_ical_url {
        state
            .store
            .set_config_string("moodle_ical_url".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.classroom_enabled {
        state
            .store
            .set_config_bool("classroom_enabled".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.dismiss_conflict_banner {
        state
            .store
            .set_config_bool("dismiss_conflict_banner".to_string(), v)
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.user_email {
        state
            .store
            .set_config_string("user_email".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.user_name {
        state
            .store
            .set_config_string("user_name".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(v) = update.user_picture {
        state
            .store
            .set_config_string("user_picture".to_string(), Some(v))
            .await
            .map_err(|e| e.to_string())?;
    }
    build_full_state(&state).await
}

#[tauri::command]
pub async fn upsert_feed(
    state: State<'_, AppState>,
    feed: FeedConfig,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .save_feed(feed, now, today)
        .await
        .map_err(|e| format!("Failed to upsert feed: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn delete_feed(
    state: State<'_, AppState>,
    id: String,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .delete_feed(id, now, today)
        .await
        .map_err(|e| format!("Failed to delete feed: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn reset_database(state: State<'_, AppState>) -> Result<GetStatePayload, String> {
    state
        .store
        .reset_all()
        .await
        .map_err(|e| format!("Failed to reset database: {e}"))?;
    state.clear_memory_tokens().await;
    // "Reset all local data" must also drop the OS-keyring secrets: wiping
    // only the SQLite rows left the app signed in to Google/Teams with the
    // Gemini key still stored - a reset that leaves the keys behind is not a
    // reset. The bundled Google client-secret override is configuration, not
    // user data, so it stays (the app falls back to its compiled default).
    for key in [
        KEY_GOOGLE_REFRESH_TOKEN,
        KEY_MICROSOFT_REFRESH_TOKEN,
        KEY_GEMINI_API_KEY,
    ] {
        if let Err(err) = state.keyring.delete_secret(key) {
            // A keyring that refuses to delete must fail loudly - claiming a
            // clean reset while the secret survives would be a lie.
            return Err(format!("Failed to clear keyring entry {key}: {err}"));
        }
    }
    build_full_state(&state).await
}

#[tauri::command]
pub async fn add_custom_event(
    state: State<'_, AppState>,
    event: CustomCalendarEvent,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .upsert_custom_event(event, now, today)
        .await
        .map_err(|e| format!("Failed to add custom event: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn delete_custom_event(
    state: State<'_, AppState>,
    id: String,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .delete_custom_event(id, now, today)
        .await
        .map_err(|e| format!("Failed to delete custom event: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn upsert_assessment(
    state: State<'_, AppState>,
    assessment: Assessment,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .upsert_assessment(assessment, now, today)
        .await
        .map_err(|e| format!("Failed to upsert assessment: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn delete_assessment(
    state: State<'_, AppState>,
    id: String,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    state
        .store
        .delete_assessment(id, now, today)
        .await
        .map_err(|e| format!("Failed to delete assessment: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn toggle_topic(
    state: State<'_, AppState>,
    assessment_id: String,
    topic_idx: usize,
    // The UI sends the value it optimistically applied; a read-modify-write
    // here loses one of two overlapping toggles. `None` keeps the legacy
    // invert behavior for callers that don't send it.
    completed: Option<bool>,
) -> Result<GetStatePayload, String> {
    let today = state.today();
    let now = state.now_iso();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read state: {e}"))?;

    // Topic keys are content-addressed (`{id}::h{hash}`): resolve the
    // requested index through the assessment's CURRENT topics so a rescan
    // that reorders the list can never move someone's checkmark onto a
    // different topic.
    let topic_text = snapshot
        .assessments
        .iter()
        .find(|assessment| assessment.id == assessment_id)
        .and_then(|assessment| assessment.topics.get(topic_idx))
        .cloned()
        .ok_or_else(|| {
            format!(
                "Topic {} no longer exists for this assessment — refresh and try again.",
                topic_idx + 1
            )
        })?;
    let key = topic_key_for_text(&assessment_id, &topic_text);
    let next_done = match completed {
        Some(explicit) => explicit,
        None => {
            let current_done = snapshot
                .completed_topics
                .get(&key)
                .copied()
                .unwrap_or(false);
            !current_done
        }
    };

    state
        .store
        .set_topic_done(key, next_done, now, today)
        .await
        .map_err(|e| format!("Failed to toggle topic: {e}"))?;

    build_full_state(&state).await
}

#[tauri::command]
pub async fn save_grade(
    state: State<'_, AppState>,
    assessment_id: String,
    achieved_score: Option<Option<f64>>,
    max_score: Option<Option<f64>>,
    weightage_percent: Option<Option<f64>>,
) -> Result<GetStatePayload, String> {
    let now = state.now_iso();
    let today = state.today();
    let change = GradeChange {
        achieved_score: to_field_update(achieved_score),
        max_score: to_field_update(max_score),
        weightage_percent: to_field_update(weightage_percent),
    };

    state
        .store
        .update_grade(assessment_id, change, now, today)
        .await
        .map_err(|e| format!("Failed to update grade: {e}"))?;

    build_full_state(&state).await
}

#[tauri::command]
pub async fn dismiss_conflicts(
    state: State<'_, AppState>,
    pair_keys: Option<Vec<String>>,
) -> Result<GetStatePayload, String> {
    let _ = pair_keys;
    state
        .store
        .dismiss_conflicts()
        .await
        .map_err(|e| format!("Failed to dismiss conflicts: {e}"))?;
    build_full_state(&state).await
}

#[tauri::command]
pub async fn export_ics(
    state: State<'_, AppState>,
    assessment_id: Option<String>,
) -> Result<String, String> {
    let today = state.today();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read state: {e}"))?;

    match assessment_id {
        Some(id) => {
            let assessment = snapshot
                .assessments
                .into_iter()
                .find(|a| a.id == id)
                .ok_or_else(|| format!("Assessment not found: {id}"))?;
            quizradar_core::cal::ics::export_ics_single(&assessment)
                .map_err(|e| format!("Failed to export ICS: {e}"))
        }
        None => Ok(quizradar_core::cal::ics::export_ics_all(
            &snapshot.assessments,
        )),
    }
}

#[tauri::command]
pub async fn schedule_study_blocks(
    state: State<'_, AppState>,
    assessment_id: Option<String>,
) -> Result<GetStatePayload, String> {
    let today = state.today();
    let now = state.now_iso();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read state: {e}"))?;

    let target_assessments: Vec<&Assessment> = match &assessment_id {
        Some(id) => snapshot
            .assessments
            .iter()
            .filter(|a| a.id == *id)
            .collect(),
        None => snapshot
            .assessments
            .iter()
            // The same seven-day window the "Next 7 days" KPI counts
            // (today + six) - the old `0..=7` was eight days long.
            .filter(|a| a.is_upcoming && a.days_until.is_some_and(|d| (0..=6).contains(&d)))
            .collect(),
    };

    for a in target_assessments {
        let block_id = block_id_for(&a.id);
        if snapshot.custom_events.iter().any(|e| e.id == block_id) {
            continue;
        }

        // Undated assessments are unschedulable: inventing "tomorrow" would
        // fabricate an exam eve the radar itself says is unconfirmed.
        let Some(exam_date) = a.date else {
            continue;
        };
        let block_date = block_date_for(exam_date);
        let candidates =
            study_block_candidates(&snapshot.schedule, &snapshot.custom_events, block_date);

        if let Some(candidate) = candidates.first() {
            let event = CustomCalendarEvent {
                id: block_id,
                title: format!("Study: {}", a.title),
                course_id: a.course_id.clone(),
                event_type: Some("Study Session".to_string()),
                date: Some(candidate.date),
                start_time: Some(candidate.start),
                end_time: Some(candidate.end),
                room: None,
                notes: Some(format!("Smart study block for {}", a.title)),
                color: Some("#10b981".to_string()),
            };

            // A failed write must fail loudly - the UI reports what actually
            // happened, so a swallowed error would claim a block that is not
            // there.
            state
                .store
                .upsert_custom_event(event, now.clone(), today)
                .await
                .map_err(|e| format!("Failed to save the study block: {e}"))?;
        }
    }

    build_full_state(&state).await
}
