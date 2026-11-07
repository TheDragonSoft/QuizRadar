//! Adversarial empirical test harness for Milestone 1 algorithms:
//! 1. Study Cushion & Deficit (`core/src/plan/cushion.rs`)
//! 2. GPA Calculator (`core/src/plan/gpa.rs`)
//! 3. Alternating Timetable Parity (`core/src/plan/parity.rs`)

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::too_many_arguments
)]

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate, NaiveTime};
use quizradar_core::plan::cushion::{calculate_daily_cushion, DEFAULT_WAKING_HOURS};
use quizradar_core::plan::gpa::{calculate_gpa, evaluate_scale};
use quizradar_core::plan::parity::{date_week_parity, slot_matches_date, slot_matches_parity};
use quizradar_core::plan::tasks::DailyStudyTask;
use quizradar_core::types::{
    Assessment, AssessmentSource, AssessmentType, Course, CustomCalendarEvent, ScheduleSlot,
    UrgencyLevel,
};

fn helper_slot(
    id: &str,
    day: &str,
    start_h: u32,
    start_m: u32,
    end_h: u32,
    end_m: u32,
    parity: Option<&str>,
) -> ScheduleSlot {
    ScheduleSlot {
        id: id.to_string(),
        day: day.to_string(),
        day_index: 1,
        course_id: "CS101".to_string(),
        course_name: "Test Course".to_string(),
        slot_type: "Lecture".to_string(),
        group: None,
        room: None,
        start_time: NaiveTime::from_hms_opt(start_h, start_m, 0).unwrap(),
        end_time: NaiveTime::from_hms_opt(end_h, end_m, 0).unwrap(),
        display_time: format!("{start_h:02}:{start_m:02}–{end_h:02}:{end_m:02}"),
        has_quiz: false,
        quiz_title: None,
        week_parity: parity.map(str::to_string),
    }
}

fn helper_event(
    id: &str,
    date: NaiveDate,
    start_h: u32,
    start_m: u32,
    end_h: u32,
    end_m: u32,
) -> CustomCalendarEvent {
    CustomCalendarEvent {
        id: id.to_string(),
        title: "Test Event".to_string(),
        course_id: None,
        event_type: Some("Meeting".to_string()),
        date: Some(date),
        start_time: Some(NaiveTime::from_hms_opt(start_h, start_m, 0).unwrap()),
        end_time: Some(NaiveTime::from_hms_opt(end_h, end_m, 0).unwrap()),
        room: None,
        notes: None,
        color: None,
    }
}

fn helper_assessment(
    id: &str,
    course_id: &str,
    date: Option<NaiveDate>,
    start_time: Option<NaiveTime>,
    end_time: Option<NaiveTime>,
    achieved: Option<f64>,
    max: Option<f64>,
    weight: Option<f64>,
) -> Assessment {
    Assessment {
        id: id.to_string(),
        course_id: Some(course_id.to_string()),
        course_name: Some(format!("Course {course_id}")),
        title: format!("Assessment {id}"),
        assessment_type: AssessmentType::ClassQuiz,
        date,
        day_name: None,
        start_time,
        end_time,
        display_time: None,
        room: None,
        group: None,
        instructor: None,
        is_upcoming: false,
        days_until: None,
        urgency_level: UrgencyLevel::Upcoming,
        priority_score: 0,
        topics: vec![],
        warnings: vec![],
        ai_inference_note: None,
        ai_study_plan: None,
        estimated_study_hours: None,
        elearning_url: None,
        google_cal_url: None,
        gcal_synced: false,
        gcal_event_id: None,
        color: None,
        bg: None,
        border: None,
        semester: None,
        email_subject: None,
        email_sent_date: None,
        source: AssessmentSource::Custom,
        source_icon: None,
        weightage_percent: weight,
        achieved_score: achieved,
        max_score: max,
        conflict_warning: None,
        last_seen_source_run: None,
        retired_source_run: None,
    }
}

fn helper_task(id: &str, date: NaiveDate, hours: Option<f32>, completed: bool) -> DailyStudyTask {
    DailyStudyTask {
        id: id.to_string(),
        key: format!("k-{id}"),
        assessment_id: "ass-1".to_string(),
        course_id: Some("CS101".to_string()),
        course_name: Some("Test Course".to_string()),
        assessment_title: "Quiz 1".to_string(),
        assessment_type: AssessmentType::ClassQuiz,
        topic: "Topic".to_string(),
        day_offset: 0,
        target_date: date,
        display_day: "Today".to_string(),
        priority_rank: 50,
        urgency: UrgencyLevel::Critical,
        estimated_hours: hours,
        ai_reasoning: "Reasoning".to_string(),
        completed,
        color: None,
        days_until_assessment: 1,
        assessment_date: date,
    }
}

// ===========================================================================
// SECTION 1: STUDY CUSHION & DEFICIT TESTS
// ===========================================================================

#[test]
fn adversarial_cushion_extreme_commitments_exceeding_waking_hours() {
    let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(); // Monday
                                                               // Slot from 06:00 to 22:00 = 16.0 hours committed (exceeds default 15.0h)
    let slots = vec![helper_slot("s1", "Mon", 6, 0, 22, 0, None)];

    // Case 1A: 0 tasks scheduled
    let cushion_0_tasks = calculate_daily_cushion(date, &slots, &[], &[], &[], None);
    assert_eq!(cushion_0_tasks.waking_hours, DEFAULT_WAKING_HOURS);
    assert_eq!(cushion_0_tasks.committed_hours, 16.0);
    assert_eq!(cushion_0_tasks.available_hours, 0.0);
    assert_eq!(cushion_0_tasks.required_hours, Some(0.0));
    // Note behavior when required is 0:
    println!(
        "[EMPIRICAL] Extreme commitments (16h) with 0 tasks: cushion_hours={:?}, is_deficit={}, deficit_hours={:?}",
        cushion_0_tasks.cushion_hours, cushion_0_tasks.is_deficit, cushion_0_tasks.deficit_hours
    );

    // Case 1B: Tasks with 2.0h required
    let tasks = vec![helper_task("t1", date, Some(2.0), false)];
    let cushion_with_task = calculate_daily_cushion(date, &slots, &[], &[], &tasks, None);
    assert_eq!(cushion_with_task.committed_hours, 16.0);
    assert_eq!(cushion_with_task.available_hours, 0.0);
    assert_eq!(cushion_with_task.required_hours, Some(2.0));
    assert_eq!(cushion_with_task.cushion_hours, Some(-2.0));
    assert!(cushion_with_task.is_deficit);
    assert_eq!(cushion_with_task.deficit_hours, Some(2.0));
    println!(
        "[EMPIRICAL] Extreme commitments (16h) with 2h tasks: cushion_hours={:?}, is_deficit={}, deficit_hours={:?}",
        cushion_with_task.cushion_hours, cushion_with_task.is_deficit, cushion_with_task.deficit_hours
    );

    // Case 1C: Multiple commitment sources combining to 18.0 hours
    // Slot 08:00–16:00 (8h), Custom Event 16:00–22:00 (6h), Exam 22:00–24:00 (2h) + Untimed Exam (2h) = 18h
    let exam1 = helper_assessment(
        "ex1",
        "CS101",
        Some(date),
        Some(NaiveTime::from_hms_opt(22, 0, 0).unwrap()),
        Some(NaiveTime::from_hms_opt(23, 59, 0).unwrap()),
        None,
        None,
        None,
    );
    let exam2_untimed = helper_assessment("ex2", "CS101", Some(date), None, None, None, None, None);
    let event = helper_event("ev1", date, 16, 0, 22, 0);
    let multi_slots = vec![helper_slot("s2", "Mon", 8, 0, 16, 0, None)];
    let cushion_multi = calculate_daily_cushion(
        date,
        &multi_slots,
        &[event],
        &[exam1, exam2_untimed],
        &tasks,
        Some(15.0),
    );
    // 8h + 6h + 119m (~2.0h) + 120m (2.0h) = ~18.0h
    assert!(cushion_multi.committed_hours >= 17.9);
    assert_eq!(cushion_multi.available_hours, 0.0);
    assert!(cushion_multi.is_deficit);
}

#[test]
fn adversarial_cushion_exact_zero_boundary() {
    let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
    // 10.0 hours committed out of 15.0h waking = 5.0h available
    let slots = vec![helper_slot("s1", "Mon", 8, 0, 18, 0, None)];

    // Exact match: required = 5.0h -> cushion = 0.0h
    let tasks_exact = vec![
        helper_task("t1", date, Some(3.0), false),
        helper_task("t2", date, Some(2.0), false),
    ];
    let res_exact = calculate_daily_cushion(date, &slots, &[], &[], &tasks_exact, Some(15.0));
    assert_eq!(res_exact.available_hours, 5.0);
    assert_eq!(res_exact.required_hours, Some(5.0));
    assert_eq!(res_exact.cushion_hours, Some(0.0));
    assert!(
        !res_exact.is_deficit,
        "Exact zero cushion must NOT be flagged as deficit"
    );
    assert_eq!(res_exact.deficit_hours, None);
    assert_eq!(res_exact.warning_note, None);

    // Barely over capacity: required = 5.05h -> rounds to 5.1h -> cushion = -0.1h
    let tasks_over = vec![
        helper_task("t1", date, Some(3.0), false),
        helper_task("t2", date, Some(2.05), false),
    ];
    let res_over = calculate_daily_cushion(date, &slots, &[], &[], &tasks_over, Some(15.0));
    assert_eq!(res_over.required_hours, Some(5.1));
    assert_eq!(res_over.cushion_hours, Some(-0.1));
    assert!(res_over.is_deficit);
    assert_eq!(res_over.deficit_hours, Some(0.1));
    assert!(res_over
        .warning_note
        .unwrap()
        .contains("Study deficit of 0.1h"));

    // Barely under capacity: required = 4.94h -> rounds to 4.9h -> cushion = 0.1h
    let tasks_under = vec![
        helper_task("t1", date, Some(3.0), false),
        helper_task("t2", date, Some(1.94), false),
    ];
    let res_under = calculate_daily_cushion(date, &slots, &[], &[], &tasks_under, Some(15.0));
    assert_eq!(res_under.required_hours, Some(4.9));
    assert_eq!(res_under.cushion_hours, Some(0.1));
    assert!(!res_under.is_deficit);
    assert_eq!(res_under.deficit_hours, None);
}

#[test]
fn adversarial_cushion_missing_estimates_honesty_doctrine() {
    let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();

    // Mixture: 1 estimated, 1 unestimated
    let tasks_mix = vec![
        helper_task("t1", date, Some(2.0), false),
        helper_task("t2", date, None, false),
    ];
    let res_mix = calculate_daily_cushion(date, &[], &[], &[], &tasks_mix, None);
    assert_eq!(res_mix.required_hours, None);
    assert_eq!(res_mix.cushion_hours, None);
    assert!(!res_mix.is_deficit);
    assert_eq!(res_mix.deficit_hours, None);
    assert_eq!(
        res_mix.warning_note,
        Some("Cushion calculation unavailable: 1 task lacks hour estimates".to_string())
    );

    // Mixture: 1 estimated, 3 unestimated
    let tasks_multi_none = vec![
        helper_task("t1", date, Some(2.0), false),
        helper_task("t2", date, None, false),
        helper_task("t3", date, None, false),
        helper_task("t4", date, None, false),
    ];
    let res_multi = calculate_daily_cushion(date, &[], &[], &[], &tasks_multi_none, None);
    assert_eq!(
        res_multi.warning_note,
        Some("Cushion calculation unavailable: 3 tasks lack hour estimates".to_string())
    );

    // Completed task with None must NOT poison the calculation
    let tasks_completed_none = vec![
        helper_task("t1", date, Some(2.0), false),
        helper_task("t2", date, None, true), // completed!
    ];
    let res_completed = calculate_daily_cushion(date, &[], &[], &[], &tasks_completed_none, None);
    assert_eq!(res_completed.required_hours, Some(2.0));
    assert_eq!(res_completed.cushion_hours, Some(13.0));
    assert!(!res_completed.is_deficit);
    assert_eq!(res_completed.warning_note, None);
}

#[test]
fn adversarial_cushion_waking_hours_clamping() {
    let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
    // Negative or zero waking hours clamped to 1.0
    let res_zero = calculate_daily_cushion(date, &[], &[], &[], &[], Some(0.0));
    assert_eq!(res_zero.waking_hours, 1.0);

    let res_neg = calculate_daily_cushion(date, &[], &[], &[], &[], Some(-5.0));
    assert_eq!(res_neg.waking_hours, 1.0);

    // Excessive waking hours clamped to 24.0
    let res_excess = calculate_daily_cushion(date, &[], &[], &[], &[], Some(30.0));
    assert_eq!(res_excess.waking_hours, 24.0);
}

// ===========================================================================
// SECTION 2: GPA CALCULATOR TESTS
// ===========================================================================

#[test]
fn adversarial_gpa_all_4_scales_boundary_scores() {
    // 1. UK Honors Scale
    // First Class >= 70.0% -> 4.0
    assert_eq!(evaluate_scale(70.0, "uk_honors").0, 4.0);
    assert_eq!(evaluate_scale(69.9, "uk_honors").0, 3.3);
    assert_eq!(evaluate_scale(69.99, "uk_honors").0, 3.3);

    // Upper Second 60.0 - 69.9% -> 3.3
    assert_eq!(evaluate_scale(60.0, "uk_honors").0, 3.3);
    assert_eq!(evaluate_scale(59.9, "uk_honors").0, 2.7);

    // Lower Second 50.0 - 59.9% -> 2.7
    assert_eq!(evaluate_scale(50.0, "uk_honors").0, 2.7);
    assert_eq!(evaluate_scale(49.9, "uk_honors").0, 2.0);

    // Third Class 40.0 - 49.9% -> 2.0
    assert_eq!(evaluate_scale(40.0, "uk_honors").0, 2.0);
    assert_eq!(evaluate_scale(39.9, "uk_honors").0, 0.0);
    assert_eq!(evaluate_scale(0.0, "uk_honors").0, 0.0);

    // 2. ECTS Scale
    // A: >= 90.0% -> 4.0
    assert_eq!(evaluate_scale(90.0, "ects").0, 4.0);
    assert_eq!(evaluate_scale(89.9, "ects").0, 3.5);

    // B: 80.0 - 89.9% -> 3.5
    assert_eq!(evaluate_scale(80.0, "ects").0, 3.5);
    assert_eq!(evaluate_scale(79.9, "ects").0, 3.0);

    // C: 70.0 - 79.9% -> 3.0
    assert_eq!(evaluate_scale(70.0, "ects").0, 3.0);
    assert_eq!(evaluate_scale(69.9, "ects").0, 2.5);

    // D: 60.0 - 69.9% -> 2.5
    assert_eq!(evaluate_scale(60.0, "ects").0, 2.5);
    assert_eq!(evaluate_scale(59.9, "ects").0, 2.0);

    // E: 50.0 - 59.9% -> 2.0
    assert_eq!(evaluate_scale(50.0, "ects").0, 2.0);
    assert_eq!(evaluate_scale(49.9, "ects").0, 0.0);
    assert_eq!(evaluate_scale(0.0, "ects").0, 0.0);

    // 3. US 4.0 Scale
    // A: >= 93.0% -> 4.0
    assert_eq!(evaluate_scale(93.0, "4.0").0, 4.0);
    assert_eq!(evaluate_scale(92.9, "4.0").0, 3.7);

    // A-: 90.0 - 92.9% -> 3.7
    assert_eq!(evaluate_scale(90.0, "4.0").0, 3.7);
    assert_eq!(evaluate_scale(89.9, "4.0").0, 3.3);

    // B+: 87.0 - 89.9% -> 3.3
    assert_eq!(evaluate_scale(87.0, "4.0").0, 3.3);
    assert_eq!(evaluate_scale(86.9, "4.0").0, 3.0);

    // B: 83.0 - 86.9% -> 3.0
    assert_eq!(evaluate_scale(83.0, "4.0").0, 3.0);
    assert_eq!(evaluate_scale(82.9, "4.0").0, 2.7);

    // B-: 80.0 - 82.9% -> 2.7
    assert_eq!(evaluate_scale(80.0, "4.0").0, 2.7);
    assert_eq!(evaluate_scale(79.9, "4.0").0, 2.3);

    // C+: 77.0 - 79.9% -> 2.3
    assert_eq!(evaluate_scale(77.0, "4.0").0, 2.3);
    assert_eq!(evaluate_scale(76.9, "4.0").0, 2.0);

    // C: 73.0 - 76.9% -> 2.0
    assert_eq!(evaluate_scale(73.0, "4.0").0, 2.0);
    assert_eq!(evaluate_scale(72.9, "4.0").0, 1.7);

    // C-: 70.0 - 72.9% -> 1.7
    assert_eq!(evaluate_scale(70.0, "4.0").0, 1.7);
    assert_eq!(evaluate_scale(69.9, "4.0").0, 1.3);

    // D+: 67.0 - 69.9% -> 1.3
    assert_eq!(evaluate_scale(67.0, "4.0").0, 1.3);
    assert_eq!(evaluate_scale(66.9, "4.0").0, 1.0);

    // D: 60.0 - 66.9% -> 1.0
    assert_eq!(evaluate_scale(60.0, "4.0").0, 1.0);
    assert_eq!(evaluate_scale(59.9, "4.0").0, 0.0);
    assert_eq!(evaluate_scale(0.0, "4.0").0, 0.0);

    // 4. Percentage Scale
    assert_eq!(
        evaluate_scale(0.0, "percentage"),
        (0.0, "0.0%".to_string(), 100.0)
    );
    assert_eq!(
        evaluate_scale(69.9, "percentage"),
        (69.9, "69.9%".to_string(), 100.0)
    );
    assert_eq!(
        evaluate_scale(70.0, "percentage"),
        (70.0, "70.0%".to_string(), 100.0)
    );
    assert_eq!(
        evaluate_scale(100.0, "percentage"),
        (100.0, "100.0%".to_string(), 100.0)
    );
    // Clamping on percentage
    assert_eq!(
        evaluate_scale(-5.0, "percentage"),
        (0.0, "0.0%".to_string(), 100.0)
    );
    assert_eq!(
        evaluate_scale(105.0, "percentage"),
        (100.0, "100.0%".to_string(), 100.0)
    );
}

#[test]
fn adversarial_gpa_zero_credits_and_empty_scenarios() {
    let grades = HashMap::new();

    // 1. Completely empty courses
    let summary_empty = calculate_gpa(&[], &[], &grades, "4.0");
    assert_eq!(summary_empty.total_credits, 0.0);
    assert_eq!(summary_empty.semester_gpa, None);
    assert!(summary_empty.courses.is_empty());

    // 2. Course with explicit credits = 0.0
    let c_zero = Course {
        id: "AUDIT101".to_string(),
        name: "Audit Seminar".to_string(),
        color: "#123456".to_string(),
        bg: None,
        border: None,
        credits: Some(0.0),
        max_absences: None,
    };
    let a_zero = helper_assessment(
        "a1",
        "AUDIT101",
        None,
        None,
        None,
        Some(95.0),
        Some(100.0),
        Some(100.0),
    );
    let summary_zero = calculate_gpa(&[c_zero], &[a_zero], &grades, "4.0");
    println!(
        "[EMPIRICAL] Course with credits=Some(0.0): total_credits={}, semester_gpa={:?}",
        summary_zero.total_credits, summary_zero.semester_gpa
    );
    // Observe: Rust code has `course.credits.unwrap_or(1.0).max(0.1)`!
    // So 0.0 becomes 0.1!
    assert_eq!(summary_zero.total_credits, 0.1);
    assert_eq!(summary_zero.semester_gpa, Some(4.0));

    // 3. Course with NO assessments
    let c_no_ass = Course {
        id: "MATH201".to_string(),
        name: "Calculus".to_string(),
        color: "#654321".to_string(),
        bg: None,
        border: None,
        credits: Some(3.0),
        max_absences: None,
    };
    let summary_no_ass = calculate_gpa(&[c_no_ass], &[], &grades, "4.0");
    assert_eq!(summary_no_ass.total_credits, 3.0);
    assert_eq!(summary_no_ass.semester_gpa, None);
    assert_eq!(summary_no_ass.courses[0].percentage, None);
    assert_eq!(summary_no_ass.courses[0].grade_point, None);
    assert_eq!(summary_no_ass.courses[0].letter_grade, None);
    assert_eq!(summary_no_ass.courses[0].accumulated_points, 0.0);
    assert_eq!(summary_no_ass.courses[0].total_weightage, 0.0);

    // 4. Course with 0 achieved score (0/100)
    let c_fail = Course {
        id: "PHYS101".to_string(),
        name: "Physics".to_string(),
        color: "#abcdef".to_string(),
        bg: None,
        border: None,
        credits: Some(4.0),
        max_absences: None,
    };
    let a_fail = helper_assessment(
        "a2",
        "PHYS101",
        None,
        None,
        None,
        Some(0.0),
        Some(100.0),
        Some(100.0),
    );
    let summary_fail = calculate_gpa(&[c_fail], &[a_fail], &grades, "4.0");
    assert_eq!(summary_fail.total_credits, 4.0);
    assert_eq!(summary_fail.courses[0].percentage, Some(0.0));
    assert_eq!(summary_fail.courses[0].grade_point, Some(0.0));
    assert_eq!(summary_fail.courses[0].letter_grade, Some("F".to_string()));
    assert_eq!(summary_fail.semester_gpa, Some(0.0));
}

// ===========================================================================
// SECTION 3: ALTERNATING TIMETABLE PARITY TESTS
// ===========================================================================

#[test]
fn adversarial_parity_year_end_boundaries_week_52_53() {
    // A. Normal year with 52 ISO weeks (2025):
    // 2025-12-28 is Sunday of ISO week 52 of 2025 (52 is even -> week_b)
    let d_2025_w52 = NaiveDate::from_ymd_opt(2025, 12, 28).unwrap();
    assert_eq!(d_2025_w52.iso_week().week(), 52);
    assert_eq!(date_week_parity(d_2025_w52), "week_b");

    // 2025-12-29 is Monday of ISO week 1 of 2026 (1 is odd -> week_a)
    let d_2025_w1 = NaiveDate::from_ymd_opt(2025, 12, 29).unwrap();
    assert_eq!(d_2025_w1.iso_week().week(), 1);
    assert_eq!(date_week_parity(d_2025_w1), "week_a");

    // 2025-12-31 is Wednesday of ISO week 1 of 2026 (1 is odd -> week_a)
    let d_2025_dec31 = NaiveDate::from_ymd_opt(2025, 12, 31).unwrap();
    assert_eq!(d_2025_dec31.iso_week().week(), 1);
    assert_eq!(date_week_parity(d_2025_dec31), "week_a");

    // 2026-01-01 is Thursday of ISO week 1 of 2026 (1 is odd -> week_a)
    let d_2026_jan1 = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    assert_eq!(d_2026_jan1.iso_week().week(), 1);
    assert_eq!(date_week_parity(d_2026_jan1), "week_a");

    // B. Year with 53 ISO weeks (2026):
    // 2026-12-27 is Sunday of ISO week 52 of 2026 (52 is even -> week_b)
    let d_2026_w52 = NaiveDate::from_ymd_opt(2026, 12, 27).unwrap();
    assert_eq!(d_2026_w52.iso_week().week(), 52);
    assert_eq!(date_week_parity(d_2026_w52), "week_b");

    // 2026-12-28 is Monday of ISO week 53 of 2026 (53 is odd -> week_a)
    let d_2026_w53_mon = NaiveDate::from_ymd_opt(2026, 12, 28).unwrap();
    assert_eq!(d_2026_w53_mon.iso_week().week(), 53);
    assert_eq!(date_week_parity(d_2026_w53_mon), "week_a");

    // 2026-12-31 is Thursday of ISO week 53 of 2026 (53 is odd -> week_a)
    let d_2026_w53_thu = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
    assert_eq!(d_2026_w53_thu.iso_week().week(), 53);
    assert_eq!(date_week_parity(d_2026_w53_thu), "week_a");

    // 2027-01-01 is Friday of ISO week 53 of 2026 (53 is odd -> week_a)
    let d_2027_jan1 = NaiveDate::from_ymd_opt(2027, 1, 1).unwrap();
    assert_eq!(d_2027_jan1.iso_week().week(), 53);
    assert_eq!(date_week_parity(d_2027_jan1), "week_a");

    // 2027-01-03 is Sunday of ISO week 53 of 2026 (53 is odd -> week_a)
    let d_2027_jan3 = NaiveDate::from_ymd_opt(2027, 1, 3).unwrap();
    assert_eq!(d_2027_jan3.iso_week().week(), 53);
    assert_eq!(date_week_parity(d_2027_jan3), "week_a");

    // 2027-01-04 is Monday of ISO week 1 of 2027 (1 is odd -> week_a)
    let d_2027_jan4 = NaiveDate::from_ymd_opt(2027, 1, 4).unwrap();
    assert_eq!(d_2027_jan4.iso_week().week(), 1);
    assert_eq!(date_week_parity(d_2027_jan4), "week_a");

    println!(
        "[EMPIRICAL] Year 2026->2027 transition: Week 52={:?}, Week 53={:?}, Next Year Week 1={:?}",
        date_week_parity(d_2026_w52),
        date_week_parity(d_2026_w53_mon),
        date_week_parity(d_2027_jan4)
    );
}

#[test]
fn adversarial_parity_slot_matching_edge_cases() {
    let date_a = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(); // Monday of week 43 -> week_a
    let date_b = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(); // Monday of week 44 -> week_b

    let slot_none = helper_slot("s1", "Mon", 9, 0, 10, 0, None);
    let slot_all = helper_slot("s2", "Mon", 9, 0, 10, 0, Some("all"));
    let slot_empty = helper_slot("s3", "Mon", 9, 0, 10, 0, Some(""));
    let slot_space = helper_slot("s4", "Mon", 9, 0, 10, 0, Some("   "));
    let slot_upper_a = helper_slot("s5", "Mon", 9, 0, 10, 0, Some("WEEK_A"));
    let slot_upper_b = helper_slot("s6", "Mon", 9, 0, 10, 0, Some("WEEK_B"));
    let slot_unknown = helper_slot("s7", "Mon", 9, 0, 10, 0, Some("unknown_val"));

    // All defaults match both weeks
    assert!(slot_matches_parity(&slot_none, date_a));
    assert!(slot_matches_parity(&slot_none, date_b));
    assert!(slot_matches_parity(&slot_all, date_a));
    assert!(slot_matches_parity(&slot_all, date_b));
    assert!(slot_matches_parity(&slot_empty, date_a));
    assert!(slot_matches_parity(&slot_empty, date_b));
    assert!(slot_matches_parity(&slot_space, date_a));
    assert!(slot_matches_parity(&slot_space, date_b));
    assert!(slot_matches_parity(&slot_unknown, date_a));
    assert!(slot_matches_parity(&slot_unknown, date_b));

    // Case-insensitive parity
    assert!(slot_matches_parity(&slot_upper_a, date_a));
    assert!(!slot_matches_parity(&slot_upper_a, date_b));
    assert!(!slot_matches_parity(&slot_upper_b, date_a));
    assert!(slot_matches_parity(&slot_upper_b, date_b));

    // Weekday match
    assert!(slot_matches_date(&slot_upper_a, date_a));
    let tuesday_a = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
    assert!(!slot_matches_date(&slot_upper_a, tuesday_a));
}
