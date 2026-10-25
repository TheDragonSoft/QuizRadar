//! AI commands (`02` §6, `04` §4.2, `05` AI plan).
//!
//! Exposes timetable image vision extraction, study plan optimization, practice quiz
//! generation with local fallback, and honest BYOK Gemini API key validation.

use std::sync::Arc;

use quizradar_core::ai::gemini::GeminiProvider;
use quizradar_core::ai::practice_fallback::generate_practice_locally;
use quizradar_core::ai::provider::{AiModel, AiProvider, QuotaLedger, StructuredPrompt};
use quizradar_core::ai::tasks::{
    extract_timetable, generate_practice, optimize_plan, ExtractedTimetable, PracticeQuizPayload,
};
use quizradar_core::plan::tasks::StudyTasksPayload;
use quizradar_core::types::ScheduleData;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::keyring::KEY_GEMINI_API_KEY;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValidationResult {
    pub valid: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopExtractedTimetable {
    pub schedule: ScheduleData,
    pub dropped_courses: usize,
    pub dropped_slots: usize,
}

impl From<ExtractedTimetable> for DesktopExtractedTimetable {
    fn from(e: ExtractedTimetable) -> Self {
        Self {
            schedule: e.schedule,
            dropped_courses: e.dropped_courses,
            dropped_slots: e.dropped_slots,
        }
    }
}

#[tauri::command]
pub async fn validate_gemini_key(
    state: State<'_, AppState>,
    key: String,
) -> Result<KeyValidationResult, String> {
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Ok(KeyValidationResult {
            valid: false,
            error: Some("API key cannot be empty".to_string()),
        });
    }

    let clock = Arc::new(chrono::Utc::now);
    let provider = GeminiProvider::production(Some(trimmed.clone()), clock, None)
        .map_err(|e| format!("Failed to initialize Gemini provider: {e}"))?;

    let prompt = StructuredPrompt::new(
        AiModel::FlashLite,
        0.1,
        "Respond with valid JSON: {\"status\": \"ok\"}",
    );

    let ping_result = provider.chat_json(prompt).await;

    match ping_result {
        Ok(_) => {
            state.keyring.set_secret(KEY_GEMINI_API_KEY, &trimmed)?;
            Ok(KeyValidationResult {
                valid: true,
                error: None,
            })
        }
        Err(err) => Ok(KeyValidationResult {
            valid: false,
            error: Some(err.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn extract_schedule(
    app: AppHandle,
    state: State<'_, AppState>,
    image: String,
) -> Result<DesktopExtractedTimetable, String> {
    let key = state.get_gemini_api_key()?.ok_or_else(|| {
        "No Gemini API key found in keyring. Please add your key in Settings.".to_string()
    })?;

    let clock = Arc::new(chrono::Utc::now);
    let ledger = Arc::new(QuotaLedger::new(Arc::new(state.store.quota_kv()), None));
    let provider = GeminiProvider::production(Some(key), clock, Some(ledger))
        .map_err(|e| format!("Failed to initialize Gemini: {e}"))?;

    let _ = app.emit(
        "ai-progress",
        "Analyzing timetable image with Gemini vision...",
    );

    let mime = if image.starts_with("data:image/jpeg") {
        "image/jpeg"
    } else if image.starts_with("data:image/webp") {
        "image/webp"
    } else {
        "image/png"
    };

    let extracted = extract_timetable(&provider, &image, mime)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit("ai-progress", "Timetable parsed successfully.");

    Ok(DesktopExtractedTimetable::from(extracted))
}

#[tauri::command]
pub async fn optimize_tasks(state: State<'_, AppState>) -> Result<StudyTasksPayload, String> {
    let key = state.get_gemini_api_key()?.ok_or_else(|| {
        "No Gemini API key found in keyring. Please add your key in Settings.".to_string()
    })?;

    let today = state.today();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read store state: {e}"))?;

    let clock = Arc::new(chrono::Utc::now);
    let ledger = Arc::new(QuotaLedger::new(Arc::new(state.store.quota_kv()), None));
    let provider = GeminiProvider::production(Some(key), clock, Some(Arc::clone(&ledger)))
        .map_err(|e| format!("Failed to initialize Gemini: {e}"))?;

    let optimized = optimize_plan(
        &provider,
        &snapshot.assessments,
        &snapshot.schedule,
        &snapshot.completed_topics,
        today,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(optimized)
}

#[tauri::command]
pub async fn practice_generate(
    state: State<'_, AppState>,
    assessment_id: String,
) -> Result<PracticeQuizPayload, String> {
    let today = state.today();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read store state: {e}"))?;

    let assessment = snapshot
        .assessments
        .iter()
        .find(|a| a.id == assessment_id)
        .cloned()
        .ok_or_else(|| format!("Assessment with ID {assessment_id} not found"))?;

    // Try AI generation if key is present
    if let Ok(Some(key)) = state.get_gemini_api_key() {
        let clock = Arc::new(chrono::Utc::now);
        let ledger = Arc::new(QuotaLedger::new(Arc::new(state.store.quota_kv()), None));
        if let Ok(provider) =
            GeminiProvider::production(Some(key), clock, Some(Arc::clone(&ledger)))
        {
            if let Ok(quiz) = generate_practice(&provider, &assessment).await {
                return Ok(quiz);
            }
        }
    }

    // Honest on-device deterministic fallback
    let fallback = generate_practice_locally(&assessment);
    Ok(fallback)
}
