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

/// The device's real AI usage for today (the Pacific quota day).
///
/// The counters come from the store-backed ledger, so the Settings line
/// reports what this device actually spent — never a hardcoded zero.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQuotaUsage {
    /// Total provider calls recorded today.
    pub calls_today: u32,
    /// Per-model breakdown (`gemini-3.5-flash-lite` → 2, …).
    pub per_model: std::collections::BTreeMap<String, u32>,
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
    // The validation ping is a real provider call, so it runs against the
    // same ledger as every other call: it counts against the day's quota.
    let ledger = Arc::new(QuotaLedger::new(Arc::new(state.store.quota_kv()), None));
    let provider = GeminiProvider::production(Some(trimmed.clone()), clock, Some(ledger))
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

/// The device's AI usage for today, read from the store-backed ledger.
/// The Settings panel shows this instead of a hardcoded counter.
#[tauri::command]
pub async fn ai_quota_usage(state: State<'_, AppState>) -> Result<AiQuotaUsage, String> {
    let ledger = QuotaLedger::new(Arc::new(state.store.quota_kv()), None);
    let snapshot = ledger
        .usage(chrono::Utc::now())
        .await
        .map_err(|e| format!("Failed to read the AI usage ledger: {e}"))?;
    Ok(AiQuotaUsage {
        calls_today: snapshot.total(),
        per_model: snapshot.counts,
    })
}

/// The device's AI consent flag (`05` §5.1). The Settings toggle promises
/// "Turn off to stay fully local", so the off state is enforced HERE at the
/// command boundary — the UI hiding AI entry points alone would still let a
/// scripted IPC call send topics or timetable images to Gemini. Default
/// mirrors the state reader (`state.rs`): a desktop user who seeded their own
/// key has opted in; the v4 importer and the PWA force it off explicitly.
pub(crate) async fn gemini_consent(state: &AppState) -> Result<bool, String> {
    state
        .store
        .get_config_bool("gemini_enabled".to_string(), true)
        .await
        .map_err(|e| format!("Failed to read the AI consent toggle: {e}"))
}

#[tauri::command]
pub async fn extract_schedule(
    app: AppHandle,
    state: State<'_, AppState>,
    image: String,
) -> Result<DesktopExtractedTimetable, String> {
    if !gemini_consent(&state).await? {
        return Err(
            "AI features are turned off in Settings, so this request cannot leave the device. \
             Turn Gemini back on to import a timetable image."
                .to_string(),
        );
    }
    let key = state.get_gemini_api_key()?.ok_or_else(|| {
        "No Gemini API key found. Add one in Settings, or set QUIZRADAR_GEMINI_API_KEY / place a \
         gemini.key file next to the app."
            .to_string()
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
    if !gemini_consent(&state).await? {
        return Err(
            "AI features are turned off in Settings, so the study plan stays deterministic. \
             Turn Gemini back on to optimize the roadmap."
                .to_string(),
        );
    }
    let key = state.get_gemini_api_key()?.ok_or_else(|| {
        "No Gemini API key found. Add one in Settings, or set QUIZRADAR_GEMINI_API_KEY / place a \
         gemini.key file next to the app."
            .to_string()
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
    practice_generate_inner(&state, &assessment_id).await
}

/// Testable body of `practice_generate` (consent boundary + fallback ladder).
pub async fn practice_generate_inner(
    state: &AppState,
    assessment_id: &str,
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

    // Try AI generation only when the user's consent toggle allows it; with
    // consent off (or no key) the honest on-device fallback below runs — the
    // quiz is still generated, just labeled `authored_locally`.
    if gemini_consent(state).await.unwrap_or(false) {
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
    }

    // Honest on-device deterministic fallback
    let fallback = generate_practice_locally(&assessment);
    Ok(fallback)
}
