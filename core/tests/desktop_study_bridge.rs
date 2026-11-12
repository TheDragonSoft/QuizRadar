//! Desktop study bridge (`apps/desktop` `study_*` commands): whole-collection
//! replace / purge writes over the existing repos.
//!
//! Contract under test:
//! 1. `replace_study_collections` REPLACES all four study collections and
//!    restores the transparent stats passthrough — inside ONE transaction.
//! 2. The replace is all-or-nothing: a record that fails validation mid-way
//!    leaves the previous collections exactly as they were (the webview only
//!    stamps its migration marker after this returns Ok).
//! 3. A shape-invalid stats ledger is skipped (reported), never fatal.
//! 4. `purge_study_collections` clears all four and reports the counts.
//! 5. Single-record deletes exist for the purge-race contract the web store
//!    already enforces on the IDB tier.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use quizradar_core::store::importer::STUDY_STATS_CONFIG_KEY;
use quizradar_core::store::repo::StudyCollectionsReport;
use quizradar_core::store::Store;
use quizradar_core::types::{Flashcard, MistakeRecord, QuizAttempt, StudySessionRecord};

fn card(id: &str) -> Flashcard {
    Flashcard {
        id: id.into(),
        course_id: Some("CS201".into()),
        assessment_id: None,
        topic: None,
        front: format!("front {id}"),
        back: format!("back {id}"),
        box_level: 1,
        next_review_iso: Some("2026-11-12".into()),
        last_reviewed_iso: None,
    }
}

fn attempt(id: &str) -> QuizAttempt {
    QuizAttempt {
        id: id.into(),
        assessment_id: "midterm-1".into(),
        course_id: Some("CS201".into()),
        timestamp: "2026-11-10T12:00:00Z".into(),
        score: 8,
        total_questions: 10,
        passed: true,
    }
}

fn mistake(id: &str) -> MistakeRecord {
    MistakeRecord {
        id: id.into(),
        attempt_id: Some("attempt-1".into()),
        assessment_id: "midterm-1".into(),
        course_id: Some("CS201".into()),
        question_id: "q1".into(),
        question_text: "Which complexity is binary search?".into(),
        options: vec!["O(n)".into(), "O(log n)".into()],
        selected_index: 0,
        correct_index: 1,
        explanation: String::new(),
        timestamp: "2026-11-10T12:00:00Z".into(),
        resolved: false,
    }
}

fn session(id: &str) -> StudySessionRecord {
    StudySessionRecord {
        id: id.into(),
        course_id: Some("CS201".into()),
        assessment_id: None,
        topic: None,
        duration_minutes: 25,
        timestamp: "2026-11-10T12:00:00Z".into(),
        date_iso: chrono::NaiveDate::from_ymd_opt(2026, 11, 10).unwrap(),
    }
}

fn valid_stats() -> serde_json::Value {
    serde_json::json!({
        "totalMinutes": 50,
        "totalSessions": 2,
        "dailyMinutes": { "2026-11-10": 25 },
        "lastUpdated": "2026-11-10"
    })
}

#[tokio::test]
async fn replace_swaps_every_collection_and_restores_the_stats_passthrough() {
    let store = Store::open_in_memory().await.unwrap();

    // Pre-existing data that a full replace must clear.
    store
        .upsert_flashcard(card("old"), "t0".into())
        .await
        .unwrap();
    store
        .save_quiz_attempt(attempt("old-attempt"), vec![], "t0".into())
        .await
        .unwrap();
    store
        .save_mistake(mistake("old-mistake"), "t0".into())
        .await
        .unwrap();

    let report = store
        .replace_study_collections(
            vec![card("new-1"), card("new-2")],
            vec![attempt("new-attempt")],
            vec![mistake("new-mistake")],
            vec![session("new-session")],
            Some(valid_stats()),
            "t1".into(),
        )
        .await
        .unwrap();

    assert_eq!(
        report,
        StudyCollectionsReport {
            flashcards: 2,
            quiz_attempts: 1,
            mistakes: 1,
            study_sessions: 1,
            study_stats_restored: true,
        }
    );
    let cards = store.list_flashcards(None).await.unwrap();
    assert_eq!(
        cards.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        vec!["new-1", "new-2"]
    );
    assert_eq!(
        store.list_quiz_attempts().await.unwrap()[0].id,
        "new-attempt"
    );
    assert_eq!(
        store.list_mistakes(None).await.unwrap()[0].id,
        "new-mistake"
    );

    // The ledger round-trips verbatim for the backup exporter (config_kv).
    let raw = store
        .get_config_raw(STUDY_STATS_CONFIG_KEY.to_string())
        .await
        .unwrap();
    assert_eq!(raw, Some(valid_stats()));
}

#[tokio::test]
async fn a_failing_record_rolls_the_whole_replace_back() {
    let store = Store::open_in_memory().await.unwrap();
    store
        .upsert_flashcard(card("kept"), "t0".into())
        .await
        .unwrap();
    store
        .save_quiz_attempt(attempt("kept-attempt"), vec![], "t0".into())
        .await
        .unwrap();

    // One invalid card (empty front) between two valid records: the whole
    // transaction must abort — no half-migrated state may exist, because the
    // webview stamps its migration marker ONLY on Ok.
    let mut bad = card("bad");
    bad.front = "   ".into();
    let result = store
        .replace_study_collections(
            vec![card("good"), bad],
            vec![attempt("new-attempt")],
            vec![mistake("new-mistake")],
            vec![],
            None,
            "t1".into(),
        )
        .await;

    assert!(result.is_err(), "an invalid record must fail the migration");
    // Nothing was replaced: the old collections survive intact.
    assert_eq!(
        store
            .list_flashcards(None)
            .await
            .unwrap()
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        vec!["kept"]
    );
    assert_eq!(
        store
            .list_quiz_attempts()
            .await
            .unwrap()
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        vec!["kept-attempt"]
    );
}

#[tokio::test]
async fn a_shape_invalid_stats_ledger_is_skipped_not_fatal() {
    let store = Store::open_in_memory().await.unwrap();
    let report = store
        .replace_study_collections(
            vec![card("c1")],
            vec![],
            vec![],
            vec![],
            Some(serde_json::json!({ "totalMinutes": "fifty" })),
            "t0".into(),
        )
        .await
        .unwrap();
    assert!(
        !report.study_stats_restored,
        "a malformed ledger is skipped"
    );
    assert_eq!(report.flashcards, 1, "the collections still migrated");
    assert!(store.list_flashcards(None).await.unwrap().len() == 1);
}

#[tokio::test]
async fn purge_clears_every_collection_and_reports_the_counts() {
    let store = Store::open_in_memory().await.unwrap();
    store
        .replace_study_collections(
            vec![card("c1"), card("c2")],
            vec![attempt("a1")],
            vec![mistake("m1")],
            vec![session("s1")],
            Some(valid_stats()),
            "t0".into(),
        )
        .await
        .unwrap();

    let report = store.purge_study_collections().await.unwrap();
    assert_eq!(report.flashcards, 2);
    assert_eq!(report.quiz_attempts, 1);
    assert_eq!(report.mistakes, 1);
    assert_eq!(report.study_sessions, 1);
    assert!(store.list_flashcards(None).await.unwrap().is_empty());
    assert!(store.list_quiz_attempts().await.unwrap().is_empty());
    assert!(store.list_mistakes(None).await.unwrap().is_empty());
}

#[tokio::test]
async fn single_record_deletes_report_whether_a_row_vanished() {
    let store = Store::open_in_memory().await.unwrap();
    store
        .save_quiz_attempt(attempt("a1"), vec![mistake("m1")], "t0".into())
        .await
        .unwrap();

    assert!(store.delete_quiz_attempt("a1".into()).await.unwrap());
    assert!(!store.delete_quiz_attempt("a1".into()).await.unwrap());
    assert!(store.delete_mistake("m1".into()).await.unwrap());
    assert!(!store.delete_mistake("m1".into()).await.unwrap());
    assert!(store.list_quiz_attempts().await.unwrap().is_empty());
    assert!(store.list_mistakes(None).await.unwrap().is_empty());
}
