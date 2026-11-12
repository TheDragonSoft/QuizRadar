//! Study-collection bridge commands (`04` §4.2, thin shell rule).
//!
//! The desktop webview used to keep the study collections (flashcards, quiz
//! history, mistake bank) in browser-side IndexedDB that the Rust core can
//! never read — desktop study writes bypassed the authoritative SQLite store
//! and a backup round-trip needed a webview merge wrapper. These commands
//! route every study read/write to the core repos so SQLite is the single
//! authoritative store on this tier; the PWA keeps its IndexedDB adapters
//! (the web `studyBridge` selects the backend per environment).
//!
//! Wire shapes are camelCase DTO twins of the core types (same pattern as
//! `SaveGradeInput`) — no parallel schema: every field maps 1:1 onto
//! `quizradar_core::types`.

use quizradar_core::types::{Flashcard, MistakeRecord, QuizAttempt, StudySessionRecord};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

fn err_string<E: std::fmt::Display>(e: E) -> String {
    format!("Study store operation failed: {e}")
}

// ---------------------------------------------------------------------------
// camelCase DTO twins of the core study types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyCardDto {
    pub id: String,
    pub course_id: Option<String>,
    pub assessment_id: Option<String>,
    pub topic: Option<String>,
    pub front: String,
    pub back: String,
    #[serde(default = "default_box_level")]
    pub box_level: u8,
    pub next_review_iso: Option<String>,
    pub last_reviewed_iso: Option<String>,
}

fn default_box_level() -> u8 {
    1
}

impl From<StudyCardDto> for Flashcard {
    fn from(dto: StudyCardDto) -> Self {
        Flashcard {
            id: dto.id,
            course_id: dto.course_id,
            assessment_id: dto.assessment_id,
            topic: dto.topic,
            front: dto.front,
            back: dto.back,
            box_level: dto.box_level.clamp(1, 5),
            next_review_iso: dto.next_review_iso,
            last_reviewed_iso: dto.last_reviewed_iso,
        }
    }
}

impl From<Flashcard> for StudyCardDto {
    fn from(card: Flashcard) -> Self {
        StudyCardDto {
            id: card.id,
            course_id: card.course_id,
            assessment_id: card.assessment_id,
            topic: card.topic,
            front: card.front,
            back: card.back,
            box_level: card.box_level,
            next_review_iso: card.next_review_iso,
            last_reviewed_iso: card.last_reviewed_iso,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizAttemptDto {
    pub id: String,
    pub assessment_id: String,
    pub course_id: Option<String>,
    pub timestamp: String,
    pub score: u32,
    pub total_questions: u32,
    pub passed: bool,
}

impl From<QuizAttemptDto> for QuizAttempt {
    fn from(dto: QuizAttemptDto) -> Self {
        QuizAttempt {
            id: dto.id,
            assessment_id: dto.assessment_id,
            course_id: dto.course_id,
            timestamp: dto.timestamp,
            score: dto.score,
            total_questions: dto.total_questions,
            passed: dto.passed,
        }
    }
}

impl From<QuizAttempt> for QuizAttemptDto {
    fn from(a: QuizAttempt) -> Self {
        QuizAttemptDto {
            id: a.id,
            assessment_id: a.assessment_id,
            course_id: a.course_id,
            timestamp: a.timestamp,
            score: a.score,
            total_questions: a.total_questions,
            passed: a.passed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MistakeDto {
    pub id: String,
    pub attempt_id: Option<String>,
    pub assessment_id: String,
    pub course_id: Option<String>,
    pub question_id: String,
    pub question_text: String,
    #[serde(default)]
    pub options: Vec<String>,
    pub selected_index: usize,
    pub correct_index: usize,
    #[serde(default)]
    pub explanation: String,
    pub timestamp: String,
    #[serde(default)]
    pub resolved: bool,
}

impl From<MistakeDto> for MistakeRecord {
    fn from(dto: MistakeDto) -> Self {
        MistakeRecord {
            id: dto.id,
            attempt_id: dto.attempt_id,
            assessment_id: dto.assessment_id,
            course_id: dto.course_id,
            question_id: dto.question_id,
            question_text: dto.question_text,
            options: dto.options,
            selected_index: dto.selected_index,
            correct_index: dto.correct_index,
            explanation: dto.explanation,
            timestamp: dto.timestamp,
            resolved: dto.resolved,
        }
    }
}

impl From<MistakeRecord> for MistakeDto {
    fn from(m: MistakeRecord) -> Self {
        MistakeDto {
            id: m.id,
            attempt_id: m.attempt_id,
            assessment_id: m.assessment_id,
            course_id: m.course_id,
            question_id: m.question_id,
            question_text: m.question_text,
            options: m.options,
            selected_index: m.selected_index,
            correct_index: m.correct_index,
            explanation: m.explanation,
            timestamp: m.timestamp,
            resolved: m.resolved,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySessionDto {
    pub id: String,
    pub course_id: Option<String>,
    pub assessment_id: Option<String>,
    pub topic: Option<String>,
    pub duration_minutes: u32,
    pub timestamp: String,
    pub date_iso: String,
}

impl TryFrom<StudySessionDto> for StudySessionRecord {
    type Error = String;

    fn try_from(dto: StudySessionDto) -> Result<Self, Self::Error> {
        let date_iso = chrono::NaiveDate::parse_from_str(dto.date_iso.trim(), "%Y-%m-%d")
            .map_err(|e| format!("Study session {} has an invalid date_iso: {e}", dto.id))?;
        Ok(StudySessionRecord {
            id: dto.id,
            course_id: dto.course_id,
            assessment_id: dto.assessment_id,
            topic: dto.topic,
            duration_minutes: dto.duration_minutes,
            timestamp: dto.timestamp,
            date_iso,
        })
    }
}

impl From<StudySessionRecord> for StudySessionDto {
    fn from(s: StudySessionRecord) -> Self {
        StudySessionDto {
            id: s.id,
            course_id: s.course_id,
            assessment_id: s.assessment_id,
            topic: s.topic,
            duration_minutes: s.duration_minutes,
            timestamp: s.timestamp,
            date_iso: s.date_iso.format("%Y-%m-%d").to_string(),
        }
    }
}

/// One hydration read: the three collections the desktop webview keeps in
/// memory (the focus-minutes ledger stays a webview localStorage concern).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyCollectionsDto {
    pub flashcards: Vec<StudyCardDto>,
    pub quiz_attempts: Vec<QuizAttemptDto>,
    pub mistakes: Vec<MistakeDto>,
}

/// The one-time migration payload the webview pushes after its first study
/// action on this tier: its browser-local collections (web-shaped records)
/// plus the raw focus-minutes ledger (passthrough, never interpreted here).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyMigratePayload {
    #[serde(default)]
    pub flashcards: Vec<StudyCardDto>,
    #[serde(default)]
    pub quiz_attempts: Vec<QuizAttemptDto>,
    #[serde(default)]
    pub mistake_bank: Vec<MistakeDto>,
    #[serde(default)]
    pub study_sessions: Vec<StudySessionDto>,
    #[serde(default)]
    pub study_stats: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn study_list(state: State<'_, AppState>) -> Result<StudyCollectionsDto, String> {
    let flashcards = state
        .store
        .list_flashcards(None)
        .await
        .map_err(err_string)?
        .into_iter()
        .map(StudyCardDto::from)
        .collect();
    let quiz_attempts = state
        .store
        .list_quiz_attempts()
        .await
        .map_err(err_string)?
        .into_iter()
        .map(QuizAttemptDto::from)
        .collect();
    let mistakes = state
        .store
        .list_mistakes(None)
        .await
        .map_err(err_string)?
        .into_iter()
        .map(MistakeDto::from)
        .collect();
    Ok(StudyCollectionsDto {
        flashcards,
        quiz_attempts,
        mistakes,
    })
}

#[tauri::command]
pub async fn study_upsert_card(
    state: State<'_, AppState>,
    card: StudyCardDto,
) -> Result<StudyCardDto, String> {
    let now = state.now_iso();
    let stored = state
        .store
        .upsert_flashcard(card.into(), now)
        .await
        .map_err(err_string)?;
    Ok(StudyCardDto::from(stored))
}

/// The Leitner review runs in CORE (`plan::study::apply_leitner_review`) —
/// one implementation of the box math. Returns the canonical updated card
/// (`None` when the id is unknown), which the webview adopts over its own
/// optimistic computation.
#[tauri::command]
pub async fn study_review_card(
    state: State<'_, AppState>,
    id: String,
    correct: bool,
) -> Result<Option<StudyCardDto>, String> {
    let now = state.now_iso();
    let today = state.today();
    let reviewed = state
        .store
        .review_flashcard(id, correct, today, now)
        .await
        .map_err(err_string)?;
    Ok(reviewed.map(StudyCardDto::from))
}

#[tauri::command]
pub async fn study_delete_card(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.store.delete_flashcard(id).await.map_err(err_string)
}

#[tauri::command]
pub async fn study_save_quiz_attempt(
    state: State<'_, AppState>,
    attempt: QuizAttemptDto,
) -> Result<(), String> {
    let now = state.now_iso();
    state
        .store
        .save_quiz_attempt(attempt.into(), vec![], now)
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn study_delete_quiz_attempt(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    state
        .store
        .delete_quiz_attempt(id)
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn study_upsert_mistake(
    state: State<'_, AppState>,
    mistake: MistakeDto,
) -> Result<(), String> {
    let now = state.now_iso();
    state
        .store
        .save_mistake(mistake.into(), now)
        .await
        .map_err(err_string)
}

#[tauri::command]
pub async fn study_delete_mistake(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.store.delete_mistake(id).await.map_err(err_string)
}

#[tauri::command]
pub async fn study_resolve_mistake(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    let now = state.now_iso();
    state
        .store
        .resolve_mistake(id, now)
        .await
        .map_err(err_string)
}

/// One-time IDB → SQLite migration write: whole-collection replace of the
/// four study collections plus the raw stats passthrough, in ONE transaction
/// (the webview stamps its "migrated" marker only after this returns Ok).
#[tauri::command]
pub async fn study_migrate(
    state: State<'_, AppState>,
    payload: StudyMigratePayload,
) -> Result<quizradar_core::store::repo::StudyCollectionsReport, String> {
    let now = state.now_iso();
    let sessions = payload
        .study_sessions
        .into_iter()
        .map(StudySessionRecord::try_from)
        .collect::<Result<Vec<_>, _>>()
        .map_err(err_string)?;
    state
        .store
        .replace_study_collections(
            payload
                .flashcards
                .into_iter()
                .map(Flashcard::from)
                .collect(),
            payload
                .quiz_attempts
                .into_iter()
                .map(QuizAttempt::from)
                .collect(),
            payload
                .mistake_bank
                .into_iter()
                .map(MistakeRecord::from)
                .collect(),
            sessions,
            payload.study_stats,
            now,
        )
        .await
        .map_err(err_string)
}

/// Whole-collection purge (used by "Reset Everything" recovery paths); the
/// desktop `reset_database` command wipes these tables itself.
#[tauri::command]
pub async fn study_purge(
    state: State<'_, AppState>,
) -> Result<quizradar_core::store::repo::StudyCollectionsReport, String> {
    state
        .store
        .purge_study_collections()
        .await
        .map_err(err_string)
}
