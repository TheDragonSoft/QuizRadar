//! Golden ICS-parser fixtures (phase 02): the `tests/fixtures/ics/*.ics`
//! exports run through `parse_ics_assessments` against the shared schedule
//! fixture in three origin/portal configurations. No hidden clock: the UTC
//! offset is explicit and deterministic (`FixedOffset::east_opt(0)`), and the
//! reference date is pinned to 2026-10-17.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use chrono::FixedOffset;
use quizradar_core::parse::ics::{parse_ics_assessments, IcsOrigin};
use quizradar_core::types::{AssessmentSource, AssessmentType, ScheduleData, UrgencyLevel};
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

fn load_ics(name: &str) -> String {
    fs::read_to_string(fixtures_dir().join("ics").join(name))
        .unwrap_or_else(|error| panic!("ics fixture {name}: {error}"))
}

const REF_DATE: &str = "2026-10-17";

fn utc() -> FixedOffset {
    FixedOffset::east_opt(0).unwrap()
}

#[test]
fn moodle_export_fixture_with_portal() {
    let schedule = load_schedule();
    let ics = load_ics("moodle-export.ics");
    let origin = IcsOrigin::Moodle {
        portal_url: Some("https://moodle.uni-eg.net".to_string()),
    };
    let ref_date = chrono::NaiveDate::parse_from_str(REF_DATE, "%Y-%m-%d").unwrap();
    let (items, stats) = parse_ics_assessments(&ics, &schedule, &origin, ref_date, utc());

    assert_eq!(stats.scanned, 3);
    assert_eq!(stats.candidates, 2, "the lecture event stays filtered");
    assert_eq!(stats.parsed, 2);
    assert_eq!(stats.skipped_duplicates, 0);

    let quiz = &items[0];
    assert_eq!(quiz.id, "moodle-quiz123_moodle.uni-eg.net");
    assert_eq!(quiz.course_id.as_deref(), Some("CSE241"));
    assert_eq!(
        quiz.course_name.as_deref(),
        Some("Object-Oriented Programming")
    );
    assert_eq!(quiz.title, "CSE241 Quiz 1, Chapter 1-2");
    assert_eq!(quiz.assessment_type, AssessmentType::OnlineQuiz);
    assert_eq!(
        quiz.date.unwrap().format("%Y-%m-%d").to_string(),
        "2026-10-18"
    );
    assert_eq!(
        quiz.start_time.unwrap().format("%H:%M").to_string(),
        "10:00"
    );
    assert_eq!(quiz.end_time.unwrap().format("%H:%M").to_string(), "12:00");
    assert_eq!(quiz.room.as_deref(), Some("Lab A"));
    assert_eq!(quiz.group, None, "no All Sections fabrication");
    assert_eq!(quiz.instructor, None, "no Course Faculty fabrication");
    assert_eq!(
        quiz.elearning_url.as_deref(),
        Some("https://e-learning.uni-eg.net/mod/quiz/view.php?id=55")
    );
    assert_eq!(quiz.warnings.len(), 3, "base + timed + password");
    assert_eq!(quiz.source, AssessmentSource::Moodle);
    assert_eq!(quiz.topics[0], "Lecture 1 - Basics");
    assert_eq!(quiz.topics[1], "Chapter 2 - Functions");
    assert_eq!(
        quiz.urgency_level,
        UrgencyLevel::Critical,
        "+1d is Critical on the unified ladder"
    );
    let note = quiz.ai_inference_note.as_deref().unwrap_or_default();
    assert!(note.starts_with("Parsed from calendar event:"));
    assert!(note.contains("matched to CSE241 by id-matching"));
    assert!(note.contains("UTC start converted to local time."));

    let midterm = &items[1];
    assert_eq!(midterm.id, "moodle-midterm_moodle.uni-eg.net");
    assert_eq!(
        midterm.course_id.as_deref(),
        Some("CSE241"),
        "matched by course NAME (Object-Oriented Programming)"
    );
    assert_eq!(midterm.assessment_type, AssessmentType::MidtermExam);
    assert_eq!(
        midterm.date.unwrap().format("%Y-%m-%d").to_string(),
        "2026-10-19"
    );
    assert_eq!(
        midterm.start_time.unwrap().format("%H:%M").to_string(),
        "08:00"
    );
    assert_eq!(
        midterm.end_time.unwrap().format("%H:%M").to_string(),
        "10:00"
    );
    assert_eq!(
        midterm.room.as_deref(),
        Some("Lab A"),
        "v4 first-known-room parity"
    );
    assert_eq!(
        midterm.elearning_url.as_deref(),
        Some("https://moodle.uni-eg.net/calendar/view.php?view=upcoming"),
        "portal fallback applies on Moodle origin"
    );
    let note = midterm.ai_inference_note.as_deref().unwrap_or_default();
    assert!(note.contains("matched to CSE241 by name-matching"));
    assert_eq!(
        items[0].priority_score, 100,
        "critical + topics tops the cap"
    );
    assert_eq!(items[1].priority_score, 100);
}

#[test]
fn moodle_export_fixture_without_portal() {
    let schedule = load_schedule();
    let ics = load_ics("moodle-export.ics");
    let origin = IcsOrigin::Moodle { portal_url: None };
    let ref_date = chrono::NaiveDate::parse_from_str(REF_DATE, "%Y-%m-%d").unwrap();
    let (items, _) = parse_ics_assessments(&ics, &schedule, &origin, ref_date, utc());

    assert_eq!(
        items[1].elearning_url, None,
        "no portal configured means honest None (v4 moodle.org hero-link deleted)"
    );
    assert_eq!(
        items[0].elearning_url.as_deref(),
        Some("https://e-learning.uni-eg.net/mod/quiz/view.php?id=55")
    );
}

#[test]
fn feed_date_only_fixture() {
    let schedule = load_schedule();
    let ics = load_ics("feed-date-only.ics");
    let origin = IcsOrigin::Feed {
        name: "CompSci Calendar".to_string(),
        feed_url: Some("https://feeds.uni-eg.net/compsci.ics".to_string()),
    };
    let ref_date = chrono::NaiveDate::parse_from_str(REF_DATE, "%Y-%m-%d").unwrap();
    let (items, stats) = parse_ics_assessments(&ics, &schedule, &origin, ref_date, utc());

    assert_eq!(stats.scanned, 3);
    assert_eq!(
        stats.candidates, 2,
        "the guest lecture is not an assessment"
    );
    assert_eq!(stats.parsed, 2);

    let quiz = &items[0];
    assert_eq!(
        quiz.id, "feed-q1_feeds.uni-eg.net",
        "feed- prefix, sanitized uid"
    );
    assert_eq!(
        quiz.source,
        AssessmentSource::Feed("CompSci Calendar".to_string())
    );
    assert_eq!(quiz.source_icon.as_deref(), Some("calendar"));
    assert_eq!(
        quiz.course_id, None,
        "Machine Learning is not enrolled, so no match"
    );
    assert_eq!(quiz.room, None);
    assert_eq!(
        quiz.start_time, None,
        "date-only means time None, no 09:00 default"
    );
    assert_eq!(quiz.end_time, None);
    assert_eq!(quiz.title, "Machine Learning Quiz 2");
    assert_eq!(
        quiz.date.unwrap().format("%Y-%m-%d").to_string(),
        "2026-10-20"
    );
    assert_eq!(quiz.days_until, Some(3));
    assert_eq!(
        quiz.elearning_url, None,
        "generic feeds honestly keep no fallback link"
    );
    assert_eq!(
        quiz.warnings[0],
        "📅 Synced from your subscribed calendar feed \"CompSci Calendar\"."
    );
    assert_eq!(items[0].urgency_level, UrgencyLevel::High, "3d out");

    let session = &items[1];
    assert_eq!(
        session.id.len(),
        "feed-".len() + 16,
        "uid-less feed events get content-hash ids"
    );
    assert_eq!(session.title, "Quiz 3 Review Session");
    assert_eq!(
        session.date.unwrap().format("%Y-%m-%d").to_string(),
        "2026-10-21"
    );
    assert_eq!(session.start_time, None);
    assert_eq!(
        session.topics[0],
        "Review all materials for \"Quiz 3 Review Session\"."
    );
}
