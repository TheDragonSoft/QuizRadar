//! Property-based tests for the academic engines
//! (`core/src/plan/gpa.rs`, `grade_target.rs`, `cushion.rs`, `parity.rs`).
//!
//! Properties, all driven through the crate's public API only:
//!
//! - **P1 — grading scale sanity.** Every percentage stays clamped to its
//!   scale, produces a non-empty letter, and is monotonic: a higher/equal
//!   percentage never yields a lower grade point.
//! - **P2 — GPA honesty.** A graded course has a percentage inside the
//!   extra-credit bounds and a grade point inside the scale; an ungraded
//!   course contributes no grade point; the semester GPA never exceeds the
//!   scale and never counts ungraded credits.
//! - **P3 — target agreement.** The Grade Center what-if projection uses the
//!   same percentage as the GPA engine, labels unknown weights honestly, and
//!   never invents a required average above 100% or a non-empty note-less
//!   result.
//! - **P4 — cushion arithmetic.** Overlapping commitments are unioned, not
//!   summed twice; availability and deficit fields agree with the merged
//!   committed hours; a pending task without an estimate honestly disables
//!   the projection.
//! - **P5 — parity matching.** A slot runs on a date exactly when its
//!   weekday matches and its configured parity matches; unknown parity is
//!   treated as "all", and anchored parity alternates week to week.
//!
//! Deterministic controls pin each property's interesting boundaries so the
//! generated cases cannot pass vacuously. All clocks and reference dates are
//! injected; no test reads a wall clock.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout
)]

use chrono::{Datelike, Duration, NaiveDate};
use proptest::prelude::*;
use quizradar_core::parse::util::{weekday_index, weekday_to_index};
use quizradar_core::plan::cushion::calculate_daily_cushion;
use quizradar_core::plan::gpa::{calculate_gpa, evaluate_scale};
use quizradar_core::plan::grade_target::calculate_grade_target;
use quizradar_core::plan::parity::{date_week_parity, slot_matches_date};
use quizradar_core::plan::tasks::DailyStudyTask;
use quizradar_core::types::{Assessment, Course, CustomCalendarEvent, ScheduleData, ScheduleSlot};
use serde_json::json;
use std::collections::HashMap;

const SCALES: &[&str] = &["4.0", "uk_honors", "ects", "percentage"];
const WEEK_STARTS: &[&str] = &[
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];
const PARITIES: &[Option<&str>] = &[
    None,
    Some("all"),
    Some("week_a"),
    Some("week_b"),
    Some("bogus"),
];
const DAYS: &[&str] = &["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 17).expect("fixed reference date")
}

fn date_at(days: i64) -> NaiveDate {
    ref_date() + Duration::days(days)
}

fn arb_percent() -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(0.0),
        Just(100.0),
        (0.0f64..=100.0),
        (69.999f64..=70.001),
        (92.999f64..=93.001),
    ]
}

fn course(id: &str, credits: f64) -> Course {
    serde_json::from_value(json!({
        "id": id,
        "name": format!("Course {id}"),
        "color": "#4285f4",
        "credits": credits,
        "aliases": []
    }))
    .expect("Course constructs from JSON")
}

fn assessment(
    id: &str,
    course_id: &str,
    achieved: f64,
    max: f64,
    weight: Option<f64>,
    date: Option<NaiveDate>,
) -> Assessment {
    serde_json::from_value(json!({
        "id": id,
        "course_id": course_id,
        "title": format!("Quiz {id}"),
        "assessment_type": "Class Quiz",
        "date_iso": date.map(|value| value.format("%Y-%m-%d").to_string()),
        "topics": ["Streams", "Buffers"],
        "warnings": [],
        "source": "Gmail",
        "weightage_percent": weight,
        "achieved_score": achieved,
        "max_score": max
    }))
    .expect("Assessment constructs from JSON")
}

fn slot(day: &str, parity: Option<&str>, start_minutes: u32, end_minutes: u32) -> ScheduleSlot {
    serde_json::from_value(json!({
        "id": format!("slot-{start_minutes}-{end_minutes}-{parity:?}"),
        "day": day,
        "day_index": weekday_index(day).unwrap_or(0),
        "course_id": "CSE241",
        "course_name": "Embedded Systems",
        "slot_type": "Lecture",
        "start_time": format!("{:02}:{:02}", start_minutes / 60, start_minutes % 60),
        "end_time": format!("{:02}:{:02}", end_minutes / 60, end_minutes % 60),
        "display_time": "",
        "has_quiz": false,
        "week_parity": parity
    }))
    .expect("ScheduleSlot constructs from JSON")
}

fn event(date: NaiveDate, start_minutes: u32, end_minutes: u32) -> CustomCalendarEvent {
    serde_json::from_value(json!({
        "id": format!("event-{start_minutes}-{end_minutes}"),
        "title": "Benchmark study session",
        "date_iso": date.format("%Y-%m-%d").to_string(),
        "start_time": format!("{:02}:{:02}", start_minutes / 60, start_minutes % 60),
        "end_time": format!("{:02}:{:02}", end_minutes / 60, end_minutes % 60)
    }))
    .expect("CustomCalendarEvent constructs from JSON")
}

fn task(date: NaiveDate, hours: Option<f32>) -> DailyStudyTask {
    serde_json::from_value(json!({
        "id": "task-1",
        "key": "assessment-1::Streams",
        "assessment_id": "assessment-1",
        "course_id": "CSE241",
        "assessment_title": "Quiz 1",
        "assessment_type": "Class Quiz",
        "topic": "Streams",
        "day_offset": 0,
        "target_date_iso": date.format("%Y-%m-%d").to_string(),
        "display_day": "Today",
        "priority_rank": 50,
        "urgency": "Critical",
        "estimated_hours": hours,
        "ai_reasoning": "Fixed benchmark input",
        "completed": false,
        "days_until_assessment": 1,
        "assessment_date_iso": date.format("%Y-%m-%d").to_string()
    }))
    .expect("DailyStudyTask constructs from JSON")
}

// ---------------------------------------------------------------------------
// P1 — grading scale sanity.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p1_scales_are_clamped_monotonic_and_labeled(
        scale in prop::sample::select(SCALES),
        low in arb_percent(),
        high in arb_percent(),
    ) {
        let (low_point, low_letter, low_max) = evaluate_scale(low.min(high), scale);
        let (high_point, high_letter, high_max) = evaluate_scale(low.max(high), scale);
        prop_assert!(high_max == 4.0 || high_max == 100.0);
        prop_assert!(low_point >= 0.0 && low_point <= low_max);
        prop_assert!(high_point >= 0.0 && high_point <= high_max);
        prop_assert!(!low_letter.trim().is_empty());
        prop_assert!(!high_letter.trim().is_empty());
        prop_assert!(high_point >= low_point, "{scale}: {low:.3} -> {low_point} but {high:.3} -> {high_point}");
    }
}

// ---------------------------------------------------------------------------
// P2/P3 — GPA and target agreement.
// ---------------------------------------------------------------------------

fn arb_course_load() -> impl Strategy<Value = (Vec<Course>, Vec<Assessment>)> {
    (
        1usize..=4,
        prop::collection::vec((1.0f64..=6.0, 0.0f64..=2.0, 5.0f64..=50.0), 1..=4),
    )
        .prop_map(|(count, items)| {
            let mut courses = Vec::new();
            let mut assessments = Vec::new();
            for (index, (credits, ratio, weight)) in items.into_iter().take(count).enumerate() {
                let id = format!("CSE{index}");
                courses.push(course(&id, credits));
                assessments.push(assessment(
                    &format!("assessment-{index}"),
                    &id,
                    ratio * 100.0,
                    100.0,
                    Some(weight),
                    Some(date_at(index as i64)),
                ));
            }
            (courses, assessments)
        })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p2_gpa_reports_only_graded_credits_inside_the_scale(
        (courses, assessments) in arb_course_load(),
        scale in prop::sample::select(SCALES),
    ) {
        let summary = calculate_gpa(&courses, &assessments, &HashMap::new(), scale);
        let scale_max = if scale.eq_ignore_ascii_case("percentage") { 100.0 } else { 4.0 };
        prop_assert_eq!(summary.scale_max, scale_max);

        let mut graded_credits = 0.0;
        for (course, summary) in courses.iter().zip(&summary.courses) {
            prop_assert_eq!(&course.id, &summary.course_id);
            match summary.percentage {
                Some(percentage) => {
                    prop_assert!((0.0..=200.0).contains(&percentage));
                    prop_assert!((0.0..=scale_max).contains(&summary.grade_point.expect("graded course grade point")));
                    graded_credits += course.credits.unwrap_or(1.0);
                }
                None => {
                    prop_assert!(summary.grade_point.is_none());
                    prop_assert!(summary.letter_grade.is_none());
                }
            }
        }
        prop_assert_eq!(summary.total_credits, (courses.iter().map(|c| c.credits.unwrap_or(1.0)).sum::<f64>() * 10.0).round() / 10.0);
        if graded_credits <= 0.0 {
            prop_assert!(summary.semester_gpa.is_none());
        } else {
            prop_assert!((0.0..=scale_max).contains(&summary.semester_gpa.expect("graded semester GPA")));
        }
    }

    #[test]
    fn p3_target_agrees_with_gpa_and_honestly_labels_weights(
        (courses, assessments) in arb_course_load(),
        scale in prop::sample::select(SCALES),
    ) {
        let summary = calculate_gpa(&courses, &assessments, &HashMap::new(), scale);
        for (course_summary, course) in summary.courses.iter().zip(&courses) {
            let target = calculate_grade_target(
                &course.id,
                &assessments,
                &HashMap::new(),
                scale,
                "B",
            );
            prop_assert_eq!(course_summary.percentage, target.current_percentage);
            prop_assert!(!target.note.trim().is_empty());
            if let Some(required) = target.required_average_on_remaining {
                prop_assert!((0.0..=100.0).contains(&required));
                prop_assert!(target.achievable);
            }
            if target.weights_known {
                prop_assert!(!target.equal_weight_assumed);
            }
            if target.equal_weight_assumed {
                prop_assert!(target.note.contains("assumes all items count equally"));
            }
        }
    }

    #[test]
    fn p3_unknown_weights_are_always_labeled_equal_weight(
        ratio in 0.0f64..=2.0,
        count in 1usize..=4,
    ) {
        let assessments = (0..count)
            .map(|index| assessment(&format!("assessment-{index}"), "CSE0", ratio * 100.0, 100.0, None, Some(date_at(index as i64))))
            .collect::<Vec<_>>();
        let target = calculate_grade_target("CSE0", &assessments, &HashMap::new(), "4.0", "B");
        prop_assert!(target.equal_weight_assumed);
        prop_assert!(!target.weights_known);
    }
}

#[test]
fn control_target_projection_is_exact_for_explicit_weights() {
    let items = vec![
        assessment("assessment-0", "CSE241", 80.0, 100.0, Some(30.0), None),
        assessment("assessment-1", "CSE241", 90.0, 100.0, Some(20.0), None),
    ];
    let target = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
    assert_eq!(target.graded_weight, 50.0);
    assert_eq!(target.remaining_weight, Some(50.0));
    assert_eq!(target.required_average_on_remaining, Some(82.0));
    assert!(target.achievable);
    assert!(!target.equal_weight_assumed);
}

// ---------------------------------------------------------------------------
// P4 — cushion arithmetic.
// ---------------------------------------------------------------------------

#[allow(clippy::type_complexity)]
fn arb_busy_intervals() -> impl Strategy<Value = (Vec<(u32, u32)>, Vec<(u32, u32)>)> {
    (
        prop::collection::vec((0u32..1439, 1u32..1440), 0..=3),
        prop::collection::vec((0u32..1439, 1u32..1440), 0..=3),
    )
        .prop_map(|(slot_windows, event_windows)| {
            let normalize = |window: &(u32, u32)| {
                let start = window.0;
                // NaiveTime's last valid minute is 23:59 (1439).
                let end = (start + window.1).min(1439);
                (start, end)
            };
            (
                slot_windows.iter().map(normalize).collect(),
                event_windows.iter().map(normalize).collect(),
            )
        })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p4_overlapping_commitments_are_unioned_not_double_counted(
        (slot_windows, event_windows) in arb_busy_intervals(),
        waking in 1.0f32..=24.0,
    ) {
        let date = ref_date();
        let weekday = DAYS[usize::from(weekday_to_index(date.weekday()))];
        let slots = slot_windows
            .iter()
            .map(|(start, end)| slot(weekday, None, *start, *end))
            .collect::<Vec<_>>();
        let events = event_windows
            .iter()
            .map(|(start, end)| event(date, *start, *end))
            .collect::<Vec<_>>();
        let tasks = vec![task(date, Some(1.5)), task(date, Some(2.0))];
        let raw_sum: i64 = slot_windows
            .iter()
            .chain(&event_windows)
            .map(|(start, end)| i64::from(end - start))
            .sum();

        let cushion = calculate_daily_cushion(date, &slots, &events, &[], &tasks, Some(waking));
        // `committed_hours` is rounded to one decimal hour; allow that
        // documented display rounding, not a real union/sum mismatch.
        prop_assert!(cushion.committed_hours * 60.0 <= raw_sum as f32 + 3.01);
        prop_assert_eq!(cushion.available_hours, ((waking - cushion.committed_hours).max(0.0) * 10.0).round() / 10.0);
        prop_assert_eq!(cushion.required_hours, Some(3.5));
        prop_assert_eq!(cushion.cushion_hours, Some(((cushion.available_hours - 3.5) * 10.0).round() / 10.0));
        prop_assert_eq!(cushion.is_deficit, cushion.cushion_hours < Some(0.0));
        prop_assert_eq!(cushion.deficit_hours, cushion.is_deficit.then(|| -cushion.cushion_hours.unwrap()));
    }

    #[test]
    fn p4_a_missing_estimate_disables_the_projection_without_a_default(
        required in 0.5f32..=8.0,
    ) {
        let date = ref_date();
        let tasks = vec![
            task(date, Some(required)),
            task(date, None),
            task(date, None),
        ];
        let cushion = calculate_daily_cushion(date, &[], &[], &[], &tasks, None);
        prop_assert_eq!(cushion.required_hours, None);
        prop_assert_eq!(cushion.cushion_hours, None);
        prop_assert!(!cushion.is_deficit);
        prop_assert_eq!(cushion.deficit_hours, None);
        prop_assert!(cushion.warning_note.expect("honest warning").contains("2 tasks lack hour estimates"));
    }
}

#[test]
fn control_overlapping_windows_form_their_union() {
    let date = ref_date();
    let slots = vec![slot("Sat", None, 9 * 60, 12 * 60)];
    let events = vec![event(date, 10 * 60, 11 * 60 + 30)];
    let cushion = calculate_daily_cushion(date, &slots, &events, &[], &[], Some(15.0));
    assert_eq!(cushion.committed_hours, 3.0);
    assert_eq!(cushion.available_hours, 12.0);
}

// ---------------------------------------------------------------------------
// P5 — parity matching.
// ---------------------------------------------------------------------------

fn arb_slot_match() -> impl Strategy<Value = (ScheduleSlot, NaiveDate)> {
    (
        prop::sample::select(DAYS),
        prop::sample::select(PARITIES),
        -400i64..=400,
    )
        .prop_map(|(day, parity, offset)| {
            let date = date_at(offset);
            let slot = slot(day, parity, 9 * 60, 10 * 60 + 30);
            (slot, date)
        })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p5_slot_matches_only_its_weekday_and_parity(
        (slot, date) in arb_slot_match(),
        week_start in prop::sample::select(WEEK_STARTS),
    ) {
        let schedule = ScheduleData {
            academic_week_start: Some(week_start.to_string()),
            ..ScheduleData::default()
        };
        let expected_day = weekday_index(&slot.day) == Some(weekday_to_index(date.weekday()));
        let expected_parity = match slot.week_parity.as_deref().unwrap_or("all") {
            "week_a" => date_week_parity(date) == "week_a",
            "week_b" => date_week_parity(date) == "week_b",
            // "all", blank and unknown labels never silently hide a class.
            _ => true,
        };
        prop_assert_eq!(slot_matches_date(&slot, date), expected_day && expected_parity);
        let _ = schedule;
    }

    #[test]
    fn p5_anchored_parity_alternates_every_seven_days(
        offset in -400i64..=393,
        week_start in prop::sample::select(WEEK_STARTS),
    ) {
        let date = date_at(offset);
        let schedule = ScheduleData {
            academic_week_start: Some(week_start.to_string()),
            ..ScheduleData::default()
        };
        let this_week = quizradar_core::plan::parity::date_week_parity_for_schedule(date, &schedule);
        let next_week = quizradar_core::plan::parity::date_week_parity_for_schedule(date + Duration::days(7), &schedule);
        prop_assert_ne!(this_week, next_week);
    }
}

#[test]
fn control_unknown_parity_still_matches_but_known_parity_gates() {
    let monday = date_at(2); // fixed Saturday reference: 2026-10-19 is Monday
    let unknown = slot("Mon", Some("bogus"), 540, 630);
    assert!(slot_matches_date(&unknown, monday));
    let week_b = slot("Mon", Some("week_b"), 540, 630);
    assert_eq!(
        slot_matches_date(&week_b, monday),
        date_week_parity(monday) == "week_b"
    );
}
