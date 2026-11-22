//! AI commands (`02` §6, `04` §4.2, `05` AI plan).
//!
//! Exposes timetable image vision extraction, study plan optimization, practice quiz
//! generation with local fallback, and honest BYOK Gemini API key validation.

use std::sync::Arc;

use quizradar_core::ai::gemini::GeminiProvider;
use quizradar_core::ai::practice_fallback::generate_practice_locally;
use quizradar_core::ai::provider::{
    AiModel, AiProvider, QuotaLedger, StructuredPrompt, TrialQuotaStatus,
};
use quizradar_core::ai::tasks::{
    extract_announcement_from_document, extract_syllabus, extract_timetable, generate_practice,
    merge_extracted_syllabi, optimize_plan, ExtractedSyllabusAssessment, ExtractedTimetable,
    PracticeQuizPayload,
};
use quizradar_core::parse::email::parse_shared_announcement as parse_shared_announcement_core;
use quizradar_core::plan::tasks::StudyTasksPayload;
use quizradar_core::types::{Assessment, ScheduleData};
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

/// The device's real AI usage for today (the Pacific quota day) plus active mode
/// and Starter Trial allowance when using Zero-Key Trial AI Relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQuotaUsage {
    /// Total provider calls recorded today.
    pub calls_today: u32,
    /// Per-model breakdown (`gemini-3.5-flash-lite` → 2, …).
    pub per_model: std::collections::BTreeMap<String, u32>,
    /// Active AI mode: `"byok"`, `"trial"`, or `"off"`.
    pub mode: String,
    /// Remaining daily starter relay calls, if observed from relay headers.
    pub trial_remaining: Option<u32>,
    /// Daily starter relay limit, if observed from relay headers.
    pub trial_limit: Option<u32>,
    /// UTC ISO reset timestamp reported by the starter relay.
    pub trial_reset_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopExtractedTimetable {
    pub schedule: ScheduleData,
    pub dropped_courses: usize,
    pub dropped_slots: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyllabusDocumentInput {
    pub name: String,
    pub data_url: String,
    #[serde(default)]
    pub mime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopExtractedSyllabi {
    pub schedule: ScheduleData,
    pub assessments: Vec<ExtractedSyllabusAssessment>,
    pub dropped_courses: usize,
    pub dropped_slots: usize,
    pub dropped_assessments: usize,
    pub model: String,
    pub file_errors: Vec<String>,
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

/// Reads today's AI usage ledger, active AI mode, and any persisted starter relay quota.
pub async fn ai_quota_usage_inner(state: &AppState) -> Result<AiQuotaUsage, String> {
    let ledger = QuotaLedger::new(Arc::new(state.store.quota_kv()), None);
    let snapshot = ledger
        .usage(chrono::Utc::now())
        .await
        .map_err(|e| format!("Failed to read the AI usage ledger: {e}"))?;

    let consent = gemini_consent(state).await.unwrap_or(false);
    let has_byok = state.get_gemini_api_key().ok().flatten().is_some();
    let trial_enabled = state.ai_trial_enabled().await;
    let mode = if !consent {
        "off"
    } else if has_byok {
        "byok"
    } else if trial_enabled {
        "trial"
    } else {
        "off"
    }
    .to_string();

    let trial_quota = state
        .store
        .get_config_string("ai_trial_quota_json".to_string())
        .await
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<TrialQuotaStatus>(&raw).ok());

    Ok(AiQuotaUsage {
        calls_today: snapshot.total(),
        per_model: snapshot.counts,
        mode,
        trial_remaining: trial_quota.as_ref().map(|q| q.remaining),
        trial_limit: trial_quota.as_ref().map(|q| q.limit),
        trial_reset_iso: trial_quota.and_then(|q| q.reset_iso),
    })
}

/// The device's AI usage for today, read from the store-backed ledger.
/// The Settings panel shows this instead of a hardcoded counter.
#[tauri::command]
pub async fn ai_quota_usage(state: State<'_, AppState>) -> Result<AiQuotaUsage, String> {
    ai_quota_usage_inner(&state).await
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

pub(crate) async fn persist_trial_quota_if_any(state: &AppState, provider: &GeminiProvider) {
    if let Some(quota) = provider.last_trial_quota() {
        if let Ok(raw) = serde_json::to_string(&quota) {
            let _ = state
                .store
                .set_config_string("ai_trial_quota_json".to_string(), Some(raw))
                .await;
        }
    }
}

pub(crate) async fn build_consented_provider(
    state: &AppState,
    base_url_override: Option<&str>,
    api_key_override: Option<String>,
) -> Result<GeminiProvider, String> {
    let clock = Arc::new(chrono::Utc::now);
    let ledger = Arc::new(QuotaLedger::new(Arc::new(state.store.quota_kv()), None));

    let explicit_key = api_key_override
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    let trial_enabled = state.ai_trial_enabled().await;
    let stored_key = if explicit_key.is_some() {
        explicit_key
    } else {
        match state.get_gemini_api_key() {
            Ok(key) => key,
            // Zero-Key Trial AI requires no stored secret; an unavailable OS
            // keyring (e.g. headless Linux without Secret Service) must not
            // block an explicitly opted-in starter relay call.
            Err(_) if trial_enabled => None,
            Err(err) => return Err(err),
        }
    };

    if let Some(key) = stored_key {
        return match base_url_override {
            Some(url) => {
                let client = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(
                        quizradar_core::ai::gemini::CONNECT_TIMEOUT_SECS,
                    ))
                    .timeout(std::time::Duration::from_secs(
                        quizradar_core::ai::gemini::TOTAL_TIMEOUT_SECS,
                    ))
                    .build()
                    .map_err(|e| format!("Failed to initialize Gemini HTTP client: {e}"))?;
                Ok(GeminiProvider::new(
                    client,
                    Some(key),
                    url,
                    clock,
                    Some(ledger),
                ))
            }
            None => GeminiProvider::production(Some(key), clock, Some(ledger))
                .map_err(|e| format!("Failed to initialize Gemini: {e}")),
        };
    }

    if trial_enabled {
        let install_id = state.get_or_create_trial_install_id().await;
        let stored_url = state.effective_trial_relay_url().await;
        let relay_url = base_url_override
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or(stored_url);
        return GeminiProvider::production_trial_relay(
            relay_url.as_deref(),
            install_id,
            "desktop",
            clock,
            Some(ledger),
        )
        .map_err(|e| format!("Failed to initialize Free Starter AI: {e}"));
    }

    Err(
        "No Gemini API key found. Add one in Settings, enable Free Starter AI, or set \
         QUIZRADAR_GEMINI_API_KEY / place a gemini.key file next to the app."
            .to_string(),
    )
}

pub(crate) async fn build_optional_ai_provider(state: &AppState) -> Option<GeminiProvider> {
    if !gemini_consent(state).await.unwrap_or(false) {
        return None;
    }
    build_consented_provider(state, None, None).await.ok()
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
    let provider = build_consented_provider(&state, None, None).await?;

    let _ = app.emit(
        "ai-progress",
        "Analyzing timetable image with Gemini vision...",
    );

    let mime = if image.starts_with("data:application/pdf") {
        "application/pdf"
    } else if image.starts_with("data:image/jpeg") {
        "image/jpeg"
    } else if image.starts_with("data:image/webp") {
        "image/webp"
    } else {
        "image/png"
    };

    let extracted_res = extract_timetable(&provider, &image, mime).await;
    persist_trial_quota_if_any(&state, &provider).await;
    let extracted = extracted_res.map_err(|e| e.to_string())?;

    let _ = app.emit("ai-progress", "Timetable parsed successfully.");

    Ok(DesktopExtractedTimetable::from(extracted))
}

const MAX_SYLLABI_BATCH: usize = 6;
const MAX_SYLLABUS_BASE64_LEN: usize = 21_000_000;

fn detect_document_mime(doc: &SyllabusDocumentInput) -> &'static str {
    if let Some(ref explicit) = doc.mime {
        let lower = explicit.trim().to_ascii_lowercase();
        if lower == "application/pdf" {
            return "application/pdf";
        }
        if lower == "image/jpeg" || lower == "image/jpg" {
            return "image/jpeg";
        }
        if lower == "image/webp" {
            return "image/webp";
        }
        if lower == "image/png" {
            return "image/png";
        }
    }
    let lower_data = doc.data_url.trim().to_ascii_lowercase();
    if lower_data.starts_with("data:application/pdf") {
        return "application/pdf";
    }
    if lower_data.starts_with("data:image/jpeg") || lower_data.starts_with("data:image/jpg") {
        return "image/jpeg";
    }
    if lower_data.starts_with("data:image/webp") {
        return "image/webp";
    }
    if lower_data.starts_with("data:image/png") {
        return "image/png";
    }
    if doc.name.trim().to_ascii_lowercase().ends_with(".pdf") {
        "application/pdf"
    } else {
        "image/png"
    }
}

pub async fn extract_syllabi_with_base_url(
    state: &AppState,
    documents: Vec<SyllabusDocumentInput>,
    base_url: Option<&str>,
    api_key_override: Option<String>,
    progress_emit: Option<Arc<dyn Fn(String) + Send + Sync>>,
) -> Result<DesktopExtractedSyllabi, String> {
    if !gemini_consent(state).await? {
        return Err(
            "AI features are turned off in Settings, so this request cannot leave the device. \
             Turn Gemini back on to import course syllabi."
                .to_string(),
        );
    }

    if documents.is_empty() {
        return Err("Pick at least one syllabus PDF or image first.".to_string());
    }
    if documents.len() > MAX_SYLLABI_BATCH {
        return Err(format!(
            "Import up to {MAX_SYLLABI_BATCH} syllabi at once (got {}).",
            documents.len()
        ));
    }

    let provider = build_consented_provider(state, base_url, api_key_override).await?;

    let total = documents.len();
    let mut extracted_items = Vec::new();
    let mut file_errors = Vec::new();

    for (idx, doc) in documents.into_iter().enumerate() {
        let label = if doc.name.trim().is_empty() {
            format!("Syllabus {}", idx + 1)
        } else {
            doc.name.trim().to_string()
        };
        if doc.data_url.trim().is_empty() {
            file_errors.push(format!("{label}: file was empty."));
            continue;
        }
        if doc.data_url.len() > MAX_SYLLABUS_BASE64_LEN {
            file_errors.push(format!("{label}: exceeds 15 MB per-file limit."));
            continue;
        }
        if let Some(ref emit) = progress_emit {
            emit(format!(
                "Reading syllabus {} of {total} ({label})...",
                idx + 1
            ));
        }

        let mime = detect_document_mime(&doc);
        match extract_syllabus(&provider, &doc.data_url, mime).await {
            Ok(item) => extracted_items.push(item),
            Err(err) => file_errors.push(format!("{label}: {err}")),
        }
        persist_trial_quota_if_any(state, &provider).await;
    }

    if extracted_items.is_empty() {
        return Err(if file_errors.is_empty() {
            "Could not read any course syllabus from the selected files.".to_string()
        } else {
            file_errors.join(" | ")
        });
    }

    let merged = merge_extracted_syllabi(extracted_items);
    if let Some(ref emit) = progress_emit {
        emit("Syllabi parsed successfully.".to_string());
    }

    Ok(DesktopExtractedSyllabi {
        schedule: merged.schedule,
        assessments: merged.assessments,
        dropped_courses: merged.dropped_courses,
        dropped_slots: merged.dropped_slots,
        dropped_assessments: merged.dropped_assessments,
        model: merged.model,
        file_errors,
    })
}

#[tauri::command]
pub async fn extract_syllabi(
    app: AppHandle,
    state: State<'_, AppState>,
    documents: Vec<SyllabusDocumentInput>,
) -> Result<DesktopExtractedSyllabi, String> {
    let app_handle = app.clone();
    let emit: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |msg| {
        let _ = app_handle.emit("ai-progress", msg);
    });
    extract_syllabi_with_base_url(&state, documents, None, None, Some(emit)).await
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
    let provider = build_consented_provider(&state, None, None).await?;

    let today = state.today();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read store state: {e}"))?;

    let opt_res = optimize_plan(
        &provider,
        &snapshot.assessments,
        &snapshot.schedule,
        &snapshot.completed_topics,
        today,
    )
    .await;
    persist_trial_quota_if_any(&state, &provider).await;
    let optimized = opt_res.map_err(|e| e.to_string())?;

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

    // Try AI generation only when the user's consent toggle allows it (BYOK
    // first, then opt-in starter trial); anything else falls back cleanly.
    if gemini_consent(state).await.unwrap_or(false) {
        if let Ok(provider) = build_consented_provider(state, None, None).await {
            let gen_res = generate_practice(&provider, &assessment).await;
            persist_trial_quota_if_any(state, &provider).await;
            if let Ok(quiz) = gen_res {
                return Ok(quiz);
            }
        }
    }

    // Honest on-device deterministic fallback
    let fallback = generate_practice_locally(&assessment);
    Ok(fallback)
}

/// Deterministic offline parser for pasted/shared WhatsApp, Telegram, Discord,
/// or portal announcement text anchored against the student's timetable.
#[tauri::command]
pub async fn parse_shared_announcement(
    state: State<'_, AppState>,
    subject: Option<String>,
    text: String,
) -> Result<Assessment, String> {
    parse_shared_announcement_inner(&state, subject.as_deref(), &text).await
}

pub async fn parse_shared_announcement_inner(
    state: &AppState,
    subject: Option<&str>,
    text: &str,
) -> Result<Assessment, String> {
    let today = state.today();
    let schedule = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read schedule: {e}"))?
        .schedule;
    parse_shared_announcement_core(subject, text, &schedule, today)
}

/// Extracts a single announcement from a shared screenshot (`image/*`) or PDF
/// notice using BYOK Gemini or the opt-in Zero-Key Trial AI Relay.
#[tauri::command]
pub async fn extract_announcement_media(
    state: State<'_, AppState>,
    document: SyllabusDocumentInput,
) -> Result<Assessment, String> {
    extract_announcement_media_with_base_url(&state, document, None, None).await
}

pub async fn extract_announcement_media_with_base_url(
    state: &AppState,
    document: SyllabusDocumentInput,
    base_url_override: Option<&str>,
    api_key_override: Option<String>,
) -> Result<Assessment, String> {
    if !gemini_consent(state).await? {
        return Err(
            "AI features are turned off in Settings, so this screenshot cannot leave the device. \
             Turn Gemini back on in Settings (or paste the announcement text) to capture it."
                .to_string(),
        );
    }

    let mime = document
        .mime
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .or_else(|| {
            document
                .data_url
                .strip_prefix("data:")
                .and_then(|rest| rest.split(';').next())
                .map(str::trim)
                .filter(|m| !m.is_empty())
        })
        .unwrap_or("image/png");

    let provider = build_consented_provider(state, base_url_override, api_key_override).await?;
    let today = state.today();
    let schedule = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read schedule: {e}"))?
        .schedule;

    let res =
        extract_announcement_from_document(&provider, &document.data_url, mime, &schedule, today)
            .await;
    persist_trial_quota_if_any(state, &provider).await;
    res.map_err(|e| e.to_string())
}
