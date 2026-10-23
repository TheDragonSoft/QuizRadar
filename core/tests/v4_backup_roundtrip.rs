//! Phase 04 acceptance fixture (`prompts/p04-core-store-backup.md` §7):
//! a real-shaped v4 export round-trips through the v5 store —
//! import → v4 export → import — and stays consistent, while every
//! secret-carrying field is dropped and reported.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use quizradar_core::store::Store;
use quizradar_core::types::{Assessment, AssessmentType, Course, ScheduleSlot};

const FIXTURE: &str = include_str!("fixtures/v4_backup.json");

fn reference() -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 10, 24).unwrap()
}

#[test]
fn fixture_parses_and_carries_all_realms() {
    let backup = quizradar_core::store::importer::parse_v4_backup(FIXTURE).unwrap();
    assert_eq!(backup.assessments.len(), 3);
    assert_eq!(backup.schedule.courses.len(), 2);
    assert_eq!(backup.schedule.slots.len(), 2);
    assert_eq!(backup.grades.len(), 1);
    assert_eq!(backup.custom_events.len(), 1);
    assert_eq!(backup.feeds.len(), 1);
}

#[tokio::test]
async fn import_export_import_is_idempotent() {
    let first_device = Store::open_in_memory().await.unwrap();
    let first_report = first_device
        .import_v4_backup(
            FIXTURE.to_string(),
            "2026-10-24T08:00:00Z".into(),
            reference(),
        )
        .await
        .unwrap();
    assert_eq!(first_report.assessments_imported, 3);
    assert_eq!(
        first_report.secrets_ignored.len(),
        6,
        "six v4 secret keys present, six ignored"
    );

    // Export back into the v4 file shape.
    let exported = first_device
        .export_v4_backup_json("2026-10-24T09:00:00Z".into(), reference())
        .await
        .unwrap();
    assert!(
        !exported.contains("teams_token") && !exported.contains("gemini_api_key"),
        "the exported file must never surface the v4 secret keys"
    );

    // A second device restoring that export.
    let second_device = Store::open_in_memory().await.unwrap();
    let second_report = second_device
        .import_v4_backup(exported, "2026-10-24T10:00:00Z".into(), reference())
        .await
        .unwrap();
    assert_eq!(
        second_report.assessments_imported,
        first_report.assessments_imported
    );
    assert_eq!(
        second_report.courses_imported,
        first_report.courses_imported
    );
    assert_eq!(second_report.slots_imported, first_report.slots_imported);
    assert_eq!(second_report.topics_imported, first_report.topics_imported);
    assert_eq!(second_report.grades_imported, first_report.grades_imported);
    assert_eq!(second_report.custom_events_imported, 1);
    assert_eq!(second_report.feeds_imported, 1);
    assert!(
        second_report.secrets_ignored.is_empty(),
        "the exported file is v5-data only"
    );

    // Both devices now hold the same user realm.
    let a = first_device.load_state(reference()).await.unwrap();
    let b = second_device.load_state(reference()).await.unwrap();
    assert_same_user_realm(&a.assessments, &b.assessments);
    assert_eq!(a.schedule.semester, b.schedule.semester);
    assert_eq!(
        course_signatures(&a.schedule.courses),
        course_signatures(&b.schedule.courses)
    );
    assert_eq!(
        slot_signatures(&a.schedule.slots),
        slot_signatures(&b.schedule.slots)
    );
    assert_eq!(a.completed_topics, b.completed_topics);
    assert_eq!(a.grades, b.grades);
    assert_eq!(a.custom_events, b.custom_events);
    assert_eq!(a.feeds, b.feeds);
}

fn assert_same_user_realm(a: &[Assessment], b: &[Assessment]) {
    let signature = |assessment: &Assessment| {
        (
            assessment.id.clone(),
            assessment.assessment_type,
            assessment.date.map(|d| d.to_string()),
            assessment.achieved_score,
            assessment.max_score,
            assessment.weightage_percent,
        )
    };
    let a_rows: Vec<_> = a.iter().map(signature).collect();
    let b_rows: Vec<_> = b.iter().map(signature).collect();
    assert_eq!(
        a_rows, b_rows,
        "radar survives the round trip (including grades)"
    );
}

fn course_signatures(courses: &[Course]) -> Vec<String> {
    let mut ids: Vec<String> = courses.iter().map(|c| c.id.to_string()).collect();
    ids.sort();
    ids
}

fn slot_signatures(slots: &[ScheduleSlot]) -> Vec<(String, u8, String, String, bool)> {
    let mut rows: Vec<(String, u8, String, String, bool)> = slots
        .iter()
        .map(|s| {
            (
                s.course_id.clone(),
                s.day_index,
                s.start_time.format("%H:%M").to_string(),
                s.end_time.format("%H:%M").to_string(),
                s.has_quiz,
            )
        })
        .collect();
    rows.sort();
    rows
}

#[tokio::test]
async fn round_trip_preserves_the_normalized_fuzzy_type() {
    let device = Store::open_in_memory().await.unwrap();
    device
        .import_v4_backup(FIXTURE.to_string(), "stamp".into(), reference())
        .await
        .unwrap();
    let snapshot = device.load_state(reference()).await.unwrap();
    let teams = snapshot
        .assessments
        .iter()
        .find(|a| a.id == "teams-880123004")
        .unwrap();
    assert_eq!(teams.assessment_type, AssessmentType::ClassQuiz);
    assert!(
        teams.warnings.iter().any(|w| w.contains("normalized")),
        "the honesty warning rides on the row so the UI can label the inference"
    );
}

#[tokio::test]
async fn reimport_replaces_never_accumulates() {
    let device = Store::open_in_memory().await.unwrap();
    device
        .import_v4_backup(FIXTURE.to_string(), "s1".into(), reference())
        .await
        .unwrap();
    device
        .import_v4_backup(FIXTURE.to_string(), "s2".into(), reference())
        .await
        .unwrap();
    let snapshot = device.load_state(reference()).await.unwrap();
    // v4 restore semantics: replace, never multiply.
    assert_eq!(snapshot.assessments.len(), 3);
    assert_eq!(snapshot.schedule.courses.len(), 2);
    assert_eq!(snapshot.schedule.slots.len(), 2);
    assert_eq!(snapshot.completed_topics.len(), 3);
    assert_eq!(snapshot.feeds.len(), 1);
    assert_eq!(snapshot.custom_events.len(), 1);
}
