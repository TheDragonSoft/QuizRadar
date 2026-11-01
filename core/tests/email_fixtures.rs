//! Golden email-parser fixtures (phase 02): every `tests/fixtures/email/*.json`
//! case runs through `parse_emails` against the shared schedule fixture and
//! asserts the recorded honest output. These are the acceptance pins for the
//! announcement pipeline; extend by adding a case file (and real
//! expectations, cross-checkable via
//! `cargo test --test email_fixtures dump_email_outputs -- --ignored --nocapture`).

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout
)]

use chrono::NaiveDate;
use quizradar_core::parse::email::parse_emails;
use quizradar_core::types::{Assessment, CachedEmail, ScheduleData};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

fn load_schedule() -> ScheduleData {
    let text = fs::read_to_string(fixtures_dir().join("schedule").join("schedule.json"))
        .expect("schedule fixture");
    serde_json::from_str(&text).expect("schedule fixture parses")
}

fn assert_item(actual: &Assessment, exp: &Value, case: &str, index: usize) {
    let at = |key: &str| exp.get(key);
    let cmp_opt = |key: &str, actual_value: Option<String>| {
        if let Some(expected) = at(key) {
            let expected: Option<String> = if expected.is_null() {
                None
            } else {
                Some(
                    expected
                        .as_str()
                        .unwrap_or_else(|| {
                            panic!("{case}[{index}]: {key} must be a string or null")
                        })
                        .to_string(),
                )
            };
            assert_eq!(
                actual_value.as_deref(),
                expected.as_deref(),
                "{case}[{index}]: mismatched {key}"
            );
        }
    };

    cmp_opt("course", actual.course_id.clone());
    cmp_opt("course_name", actual.course_name.clone());
    cmp_opt("title", Some(actual.title.clone()));
    cmp_opt("type", Some(actual.assessment_type.as_str().to_string()));
    cmp_opt(
        "date",
        actual.date.map(|d| d.format("%Y-%m-%d").to_string()),
    );
    cmp_opt("day_name", actual.day_name.clone());
    cmp_opt(
        "start_time",
        actual.start_time.map(|t| t.format("%H:%M").to_string()),
    );
    cmp_opt(
        "end_time",
        actual.end_time.map(|t| t.format("%H:%M").to_string()),
    );
    cmp_opt("room", actual.room.clone());
    cmp_opt("group", actual.group.clone());
    cmp_opt("instructor", actual.instructor.clone());
    cmp_opt("url", actual.elearning_url.clone());

    if let Some(prefix) = at("note_startswith").and_then(|v| v.as_str()) {
        let note = actual.ai_inference_note.as_deref().unwrap_or_default();
        assert!(
            note.starts_with(prefix),
            "{case}[{index}]: note should start with {prefix:?} — got {note:?}"
        );
    }
    if let Some(fragment) = at("note_contains").and_then(|v| v.as_str()) {
        let note = actual.ai_inference_note.as_deref().unwrap_or_default();
        assert!(
            note.contains(fragment),
            "{case}[{index}]: note should contain {fragment:?} — got {note:?}"
        );
    }
    if let Some(fragment) = at("note_contains2").and_then(|v| v.as_str()) {
        let note = actual.ai_inference_note.as_deref().unwrap_or_default();
        assert!(
            note.contains(fragment),
            "{case}[{index}]: note should contain {fragment:?} — got {note:?}"
        );
    }
    if let Some(fragment) = at("plan_contains").and_then(|v| v.as_str()) {
        let plan = actual.ai_study_plan.as_deref().unwrap_or_default();
        assert!(
            plan.contains(fragment),
            "{case}[{index}]: plan should contain {fragment:?} — got {plan:?}"
        );
    }
    if let Some(expected) = at("days_until") {
        if expected.is_null() {
            assert!(
                actual.days_until.is_none(),
                "{case}[{index}]: days_until should be None"
            );
        } else {
            assert_eq!(
                actual.days_until,
                Some(expected.as_i64().expect("days_until number") as i32),
                "{case}[{index}]: mismatched days_until"
            );
        }
    }
    if let Some(expected) = at("upcoming") {
        assert_eq!(
            actual.is_upcoming,
            expected.as_bool().unwrap(),
            "{case}[{index}]: upcoming"
        );
    }
    if let Some(expected) = at("urgency") {
        assert_eq!(
            actual.urgency_level,
            serde_json::from_value::<quizradar_core::types::UrgencyLevel>(expected.clone())
                .expect("urgency enum"),
            "{case}[{index}]: urgency"
        );
    }
    if let Some(expected) = at("warning_count") {
        assert_eq!(
            actual.warnings.len(),
            expected.as_u64().expect("count") as usize,
            "{case}[{index}]: warning count"
        );
    }
    if let Some(expected) = at("topics_count") {
        assert_eq!(
            actual.topics.len(),
            expected.as_u64().expect("count") as usize,
            "{case}[{index}]: topics count"
        );
    }
    if let Some(expected) = at("hours") {
        assert_eq!(
            actual.estimated_study_hours,
            Some(expected.as_f64().expect("hours") as f32),
            "{case}[{index}]: hours"
        );
    }
}

fn load_case(path: &Path) -> (String, NaiveDate, Vec<CachedEmail>, Value) {
    let text = fs::read_to_string(path).expect("case file reads");
    let case: Value = serde_json::from_str(&text).expect("valid case JSON");
    let case_name = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .expect("file stem")
        .to_string();
    let ref_date = NaiveDate::parse_from_str(
        case.get("ref_date")
            .and_then(|v| v.as_str())
            .expect("ref_date"),
        "%Y-%m-%d",
    )
    .expect("ref_date parses");
    let emails: Vec<CachedEmail> =
        serde_json::from_value(case.get("emails").cloned().expect("emails array"))
            .expect("emails parse as CachedEmail");
    let expected = case.get("expected").cloned().expect("expected object");
    (case_name, ref_date, emails, expected)
}

fn list_json_cases(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .expect("fixture dir exists")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    entries.sort();
    entries
}

#[test]
fn email_fixtures_match_golden() {
    let dir = fixtures_dir().join("email");
    let schedule = load_schedule();
    let mut checked = 0usize;
    for path in list_json_cases(&dir) {
        let (case_name, ref_date, emails, expected) = load_case(&path);
        let (items, stats) = parse_emails(&emails, &schedule, ref_date);

        let expected_stats = expected.get("stats").expect("stats object");
        assert_eq!(
            stats.scanned,
            expected_stats
                .get("scanned")
                .and_then(|v| v.as_u64())
                .unwrap() as usize,
            "{case_name}: scanned"
        );
        assert_eq!(
            stats.candidates,
            expected_stats
                .get("candidates")
                .and_then(|v| v.as_u64())
                .unwrap() as usize,
            "{case_name}: candidates"
        );
        assert_eq!(
            stats.parsed,
            expected_stats
                .get("parsed")
                .and_then(|v| v.as_u64())
                .unwrap() as usize,
            "{case_name}: parsed"
        );
        assert_eq!(
            stats.skipped_duplicates,
            expected_stats
                .get("skipped_duplicates")
                .and_then(|v| v.as_u64())
                .unwrap() as usize,
            "{case_name}: skipped_duplicates"
        );
        // The recency window's skips are counted, never hidden (the key is
        // optional: cases without a stale message simply omit it).
        if let Some(expected) = expected_stats.get("skipped_stale").and_then(|v| v.as_u64()) {
            assert_eq!(
                stats.skipped_stale, expected as usize,
                "{case_name}: skipped_stale"
            );
        }

        let expected_items = expected
            .get("items")
            .and_then(|v| v.as_array())
            .expect("items array");
        assert_eq!(items.len(), expected_items.len(), "{case_name}: item count");
        for (index, exp) in expected_items.iter().enumerate() {
            let actual_id = exp.get("id").and_then(|v| v.as_str()).expect("expected id");
            let actual = items
                .iter()
                .find(|item| item.id == actual_id)
                .unwrap_or_else(|| panic!("{case_name}: no item with id {actual_id:?}"));
            assert_item(actual, exp, &case_name, index);
        }
        checked += 1;
    }
    assert!(
        checked >= 12,
        "expected at least 12 email fixture cases, ran {checked}"
    );
}

/// Dumper (ignored by default): prints the actual parse output for every case
/// as JSON so new/updated cases can be cross-checked before pinning.
#[test]
#[ignore]
fn dump_email_outputs() {
    let schedule = load_schedule();
    let dir = fixtures_dir().join("email");
    for path in list_json_cases(&dir) {
        let (case_name, ref_date, emails, _) = load_case(&path);
        let (items, stats) = parse_emails(&emails, &schedule, ref_date);
        println!(
            "--- {case_name} ---  scanned={} candidates={} parsed={} dupes={}",
            stats.scanned, stats.candidates, stats.parsed, stats.skipped_duplicates
        );
        for item in &items {
            let summary = serde_json::json!({
                "id": item.id,
                "course": item.course_id,
                "course_name": item.course_name,
                "title": item.title,
                "type": item.assessment_type.as_str(),
                "date": item.date.map(|d| d.format("%Y-%m-%d").to_string()),
                "day_name": item.day_name,
                "start_time": item.start_time.map(|t| t.format("%H:%M").to_string()),
                "end_time": item.end_time.map(|t| t.format("%H:%M").to_string()),
                "room": item.room,
                "group": item.group,
                "instructor": item.instructor,
                "days_until": item.days_until,
                "upcoming": item.is_upcoming,
                "urgency": item.urgency_level,
                "priority": item.priority_score,
                "topics": item.topics,
                "warnings": item.warnings,
                "hours": item.estimated_study_hours,
                "url": item.elearning_url,
                "note": item.ai_inference_note,
                "plan": item.ai_study_plan,
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&summary).expect("serializes")
            );
        }
    }
}
