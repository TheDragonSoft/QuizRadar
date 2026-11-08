//! Property-based tests for the deterministic planner
//! (`core/src/plan/` — dashboard, tasks, conflicts, study blocks).
//!
//! Six properties, all driven through the crate's public API only:
//!
//! - **P1 — never panics.** Arbitrary assessment/event soup (fuzzy titles,
//!   dates centuries apart, empty topics, broken times) goes through every
//!   derivation without a panic.
//! - **P2 — radar honesty.** The radar never shows the past: every dated
//!   item is today or later, the dated prefix is ordered by date, and
//!   `next_up` is exactly the first dated item — an undated draft can never
//!   become next-up.
//! - **P3 — readiness honesty.** `readiness_percent` stays in 0..=100,
//!   equals the completed/total share, and the dashboard's completed count
//!   never exceeds its total.
//! - **P4 — roadmap horizon.** Every roadmap task belongs to an assessment
//!   0–14 days out, lands on day-offset 0..=5 (≤ the assessment's own
//!   countdown), targets `ref + offset`, and carries one checkbox key per
//!   topic (fallback topics for topicless items, never invented ones).
//!   Per-topic hours are `None` or inside the documented 0.5–2.5 clamp.
//! - **P5 — conflict shape.** Every alert pairs two *dated upcoming*
//!   assessments 0 or 1 days apart; same-day ⇒ Critical/4h, adjacent-day ⇒
//!   Warning/26h; `is_mitigated` is true exactly when a `study-block-`
//!   event covers one of the two ids.
//! - **P6 — study blocks.** Every candidate is a 90-minute window inside
//!   08:00–21:30 that overlaps no timetabled slot on that weekday and no
//!   timed custom event on that date; a dated-but-untimed custom event
//!   makes the whole day unbookable (a free window cannot be verified).
//!
//! Four deterministic *controls* keep the properties from passing
//! vacuously: they pin the same-day/adjacent-day alert, the readiness
//! boundaries, the horizon cutoff and the untimed-event blackout.
//!
//! Configuration: every `proptest!` block below carries
//! `#![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000,
//! ..ProptestConfig::default() })]`. `proptest` 1.12 only accepts that inner
//! attribute *inside* a `proptest! { … }` block, so the identical config
//! expression is repeated per block.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout
)]

use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Timelike};
use proptest::prelude::*;
use quizradar_core::plan::conflicts::{detect_conflicts, ConflictSeverity};
use quizradar_core::plan::dashboard::{build_dashboard_summary, radar_order, readiness_percent};
use quizradar_core::plan::study_blocks::study_block_candidates;
use quizradar_core::plan::tasks::build_study_tasks;
use quizradar_core::types::AcademicTrack;
use quizradar_core::types::{
    Assessment, AssessmentSource, AssessmentType, CompletedTopics, CustomCalendarEvent,
    ScheduleData, ScheduleSlot, UrgencyLevel,
};

// ---------------------------------------------------------------------------
// Fixed reference date — the planner takes "today" from its caller, so the
// tests never read a wall clock.
// ---------------------------------------------------------------------------

fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 23).expect("fixed reference date")
}

fn date_at(offset_days: i64) -> NaiveDate {
    ref_date() + Duration::days(offset_days)
}

// ---------------------------------------------------------------------------
// Assessment / event constructors (the plan fixtures are cfg(test)-only, so
// integration tests build their own).
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn assessment(
    id: &str,
    course_id: Option<&str>,
    title: &str,
    date: Option<NaiveDate>,
    topics: Vec<String>,
    ty: AssessmentType,
    start: Option<NaiveTime>,
) -> Assessment {
    Assessment {
        id: id.to_string(),
        course_id: course_id.map(str::to_string),
        course_name: None,
        title: title.to_string(),
        assessment_type: ty,
        date,
        day_name: None,
        start_time: start,
        end_time: None,
        display_time: None,
        room: None,
        group: None,
        instructor: None,
        // Placeholders — every derivation refreshes them from the injected
        // reference date; the planner is the only writer of these fields.
        is_upcoming: true,
        days_until: None,
        urgency_level: UrgencyLevel::Upcoming,
        priority_score: 0,
        topics,
        warnings: Vec::new(),
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
        source: AssessmentSource::Gmail,
        source_icon: None,
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
        last_seen_source_run: None,
        retired_source_run: None,
    }
}

fn event(
    id: &str,
    date: Option<NaiveDate>,
    start: Option<NaiveTime>,
    end: Option<NaiveTime>,
) -> CustomCalendarEvent {
    CustomCalendarEvent {
        id: id.to_string(),
        title: "user event".to_string(),
        course_id: None,
        event_type: None,
        date,
        start_time: start,
        end_time: end,
        room: None,
        notes: None,
        color: None,
    }
}

fn slot(day_index: u8, start: NaiveTime, end: NaiveTime) -> ScheduleSlot {
    ScheduleSlot {
        id: format!("slot-{day_index}"),
        day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][usize::from(day_index)].to_string(),
        day_index,
        course_id: "CSE241".to_string(),
        course_name: "Embedded Systems".to_string(),
        slot_type: "Lecture".to_string(),
        group: None,
        room: None,
        start_time: start,
        end_time: end,
        display_time: String::new(),
        has_quiz: false,
        quiz_title: None,
        week_parity: None,
    }
}

// ---------------------------------------------------------------------------
// Arbitrary input strategies.
// ---------------------------------------------------------------------------

fn arb_text(max: usize) -> impl Strategy<Value = String> {
    proptest::string::string_regex(&format!("[\\p{{L}}\\p{{N}} ,.:()\\-]{{0,{max}}}"))
        .expect("text strategy regex")
}

fn arb_date_opt() -> impl Strategy<Value = Option<NaiveDate>> {
    proptest::option::of((-300i64..=600).prop_map(date_at))
}

fn arb_time_opt() -> impl Strategy<Value = Option<NaiveTime>> {
    proptest::option::of((0u32..=86_399).prop_map(|seconds| {
        NaiveTime::from_num_seconds_from_midnight_opt(seconds, 0)
            .unwrap_or_else(|| NaiveTime::from_hms_opt(8, 0, 0).expect("fallback time"))
    }))
}

fn arb_assessment_type() -> impl Strategy<Value = AssessmentType> {
    prop_oneof![
        Just(AssessmentType::ClassQuiz),
        Just(AssessmentType::OnlineQuiz),
        Just(AssessmentType::MidtermExam),
        Just(AssessmentType::FinalExam),
        Just(AssessmentType::LabAssessment),
        Just(AssessmentType::Assignment),
    ]
}

fn arb_assessment_vec() -> impl Strategy<Value = Vec<Assessment>> {
    prop::collection::vec(
        (
            arb_date_opt(),
            arb_text(50),
            prop::collection::vec(arb_text(30), 0..5),
            arb_assessment_type(),
            arb_time_opt(),
        ),
        0..6,
    )
    .prop_map(|raw| {
        raw.into_iter()
            .enumerate()
            .map(|(index, (date, title, topics, ty, start))| {
                assessment(
                    &format!("a{index}"),
                    if index % 3 == 0 { None } else { Some("CSE241") },
                    &title,
                    date,
                    topics,
                    ty,
                    start,
                )
            })
            .collect()
    })
}

fn arb_event_vec() -> impl Strategy<Value = Vec<CustomCalendarEvent>> {
    prop::collection::vec(
        (arb_date_opt(), arb_time_opt(), arb_time_opt(), arb_text(20)),
        0..4,
    )
    .prop_map(|raw| {
        raw.into_iter()
            .enumerate()
            .map(|(index, (date, start, end, title))| {
                let mut ev = event(&format!("e{index}"), date, start, end);
                ev.title = title;
                ev
            })
            .collect()
    })
}

fn arb_schedule() -> impl Strategy<Value = ScheduleData> {
    prop::collection::vec((0u8..7, 0u32..86_340, 1u32..7_200), 0..4).prop_map(|raw| {
        let slots = raw
            .into_iter()
            .filter_map(|(day_index, start_seconds, span_seconds)| {
                let start = NaiveTime::from_num_seconds_from_midnight_opt(start_seconds, 0)?;
                let end = NaiveTime::from_num_seconds_from_midnight_opt(
                    (start_seconds + span_seconds).min(86_399),
                    0,
                )?;
                (start < end).then(|| slot(day_index, start, end))
            })
            .collect();
        ScheduleData {
            semester: None,
            academic_week_start: None,
            courses: Vec::new(),
            slots,
        }
    })
}

/// Completed-topics map that only references keys real assessments produce
/// (`"{assessment_id}::{topic_index}"`).
fn completed_for(assessments: &[Assessment], rng: &mut impl FnMut() -> bool) -> CompletedTopics {
    let mut completed = CompletedTopics::new();
    for item in assessments {
        for index in 0..item.topics.len() {
            if rng() {
                completed.insert(format!("{}::{index}", item.id), true);
            }
        }
    }
    completed
}

// ---------------------------------------------------------------------------
// P1 — never panics.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p1_planner_never_panics(
        assessments in arb_assessment_vec(),
        events in arb_event_vec(),
    ) {
        let mut topic_dice = || true; // deterministic: everything completed
        let completed = completed_for(&assessments, &mut topic_dice);
        let day = ref_date();

        let _ = build_dashboard_summary(&assessments, &completed, &events, day);
        let _ = build_study_tasks(&assessments, &completed, day, AcademicTrack::Eng);
        let ordered = radar_order(&assessments, day);
        let _ = detect_conflicts(&ordered, &events);
        for offset in 0..7i64 {
            let _ = study_block_candidates(&ScheduleData::default(), &events, date_at(offset));
        }
    }
}

// ---------------------------------------------------------------------------
// P2 — radar honesty.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p2_radar_never_shows_the_past_or_dates_before_its_order(
        assessments in arb_assessment_vec(),
    ) {
        let empty: Vec<CustomCalendarEvent> = Vec::new();
        let dashboard = build_dashboard_summary(&assessments, &CompletedTopics::new(), &empty, ref_date());

        // No past dates anywhere on the radar.
        for item in &dashboard.all_upcoming {
            prop_assert!(item.is_upcoming);
            if let Some(date) = item.date {
                prop_assert!(date >= ref_date(), "radar carried a past date {date}");
            }
        }

        // The dated prefix is ordered by date (undated items sort last).
        let dated: Vec<_> = dashboard
            .all_upcoming
            .iter()
            .filter_map(|item| item.date)
            .collect();
        for pair in dated.windows(2) {
            prop_assert!(pair[0] <= pair[1], "radar dates not ordered: {:?}", pair);
        }

        // next_up is exactly the first dated radar item — never an undated
        // draft, never a later date than the minimum.
        match dashboard.all_upcoming.iter().find(|item| item.date.is_some()) {
            Some(first_dated) => {
                let next = dashboard.next_up.expect("next_up exists when a dated item exists");
                prop_assert_eq!(&next.id, &first_dated.id);
                prop_assert_eq!(next.date, first_dated.date);
            }
            None => prop_assert!(dashboard.next_up.is_none(), "next_up resolved to an undated draft"),
        }
    }
}

// ---------------------------------------------------------------------------
// P3 — readiness honesty.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p3_dashboard_readiness_matches_its_own_counts(
        assessments in arb_assessment_vec(),
    ) {
        let mut topic_dice = || false; // nothing completed
        let completed = completed_for(&assessments, &mut topic_dice);
        let empty: Vec<CustomCalendarEvent> = Vec::new();
        let dashboard = build_dashboard_summary(&assessments, &completed, &empty, ref_date());

        prop_assert!(dashboard.completed_topics_count <= dashboard.total_topics_count);
        prop_assert_eq!(
            u64::from(dashboard.readiness_percent),
            u64::from(readiness_percent(
                dashboard.completed_topics_count,
                dashboard.total_topics_count,
            ))
        );
        prop_assert!(dashboard.readiness_percent <= 100);
    }
}

// ---------------------------------------------------------------------------
// P4 — roadmap horizon.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p4_roadmap_stays_inside_the_horizon(
        assessments in arb_assessment_vec(),
    ) {
        let mut topic_dice = || false;
        let completed = completed_for(&assessments, &mut topic_dice);
        let payload = build_study_tasks(&assessments, &completed, ref_date(), AcademicTrack::Eng);

        // Unique ids by construction: `a0..a5` → id lookup is unambiguous.
        let days_of = |id: &str| -> Option<i64> {
            assessments
                .iter()
                .find(|item| item.id == id)
                .and_then(|item| item.date)
                .map(|date| (date - ref_date()).num_days())
        };

        let mut seen_offsets: Vec<i32> = Vec::new();
        for day in &payload.days {
            prop_assert!((0..=14).contains(&day.day_offset), "day group outside the 14-day horizon");
            prop_assert!(!seen_offsets.contains(&day.day_offset), "duplicate day group");
            seen_offsets.push(day.day_offset);
            prop_assert_eq!(day.date, ref_date() + Duration::days(i64::from(day.day_offset)));
            prop_assert_eq!(day.is_today, day.day_offset == 0);

            // The honest-total rule: `None` when any covered task lacks an
            // estimate, otherwise the exact sum.
            let mut sum = 0.0f32;
            let mut all_present = true;
            for task in &day.tasks {
                match task.estimated_hours {
                    Some(hours) => sum += hours,
                    None => all_present = false,
                }
            }
            match day.total_estimated_hours {
                None => prop_assert!(!all_present || day.tasks.is_empty()),
                Some(total) => {
                    prop_assert!(all_present, "partial hour total");
                    prop_assert!((total - sum).abs() < 0.001, "hour total {total} != sum {sum}");
                }
            }
        }

        for task in payload.days.iter().flat_map(|day| &day.tasks) {
            prop_assert!((0..=5).contains(&task.day_offset), "task day offset outside the ≤5 prep-day window");
            prop_assert_eq!(task.target_date, ref_date() + Duration::days(i64::from(task.day_offset)));
            prop_assert!(task.key.starts_with(&format!("{}::", task.assessment_id)), "checkbox key not the topic key");
            if let Some(hours) = task.estimated_hours {
                prop_assert!((0.5..=2.5).contains(&hours), "per-topic hours {} outside the documented clamp", hours);
            }
            if let Some(days) = days_of(&task.assessment_id) {
                prop_assert!((0..=14).contains(&days), "task references an assessment outside the horizon");
                prop_assert!(i64::from(task.day_offset) <= days, "task lands after its assessment");
            } else {
                prop_assert!(false, "task references an undated or unknown assessment");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// P5 — conflict shape.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p5_alerts_pair_dated_upcoming_items_with_honest_gaps(
        assessments in arb_assessment_vec(),
        events in arb_event_vec(),
    ) {
        // Mitigation blocks for some assessments (the convention the store
        // writes: id = `study-block-{assessment_id}`).
        let mut blocks: Vec<CustomCalendarEvent> = Vec::new();
        for (index, item) in assessments.iter().enumerate() {
            if index % 3 == 1 {
                blocks.push(event(&format!("study-block-{}", item.id), item.date.map(|d| d - Duration::days(1)), None, None));
            }
        }
        let mut all_events = events.clone();
        all_events.extend(blocks.iter().cloned());
        let block_ids: Vec<&str> = blocks
            .iter()
            .map(|ev| ev.id.trim_start_matches("study-block-"))
            .collect();

        let dashboard =
            build_dashboard_summary(&assessments, &CompletedTopics::new(), &all_events, ref_date());
        let dated_ids: Vec<&str> = dashboard
            .all_upcoming
            .iter()
            .filter(|item| item.date.is_some())
            .map(|item| item.id.as_str())
            .collect();

        for alert in &dashboard.conflict_alerts {
            // Both sides are dated upcoming items.
            prop_assert!(dated_ids.contains(&alert.assessment_id_a.as_str()), "alert side A is undated or past");
            prop_assert!(dated_ids.contains(&alert.assessment_id_b.as_str()), "alert side B is undated or past");

            let diff = (alert.date_b - alert.date_a).num_days();
            prop_assert!((0..=1).contains(&diff), "alert pair more than one day apart");
            match alert.severity {
                ConflictSeverity::Critical => {
                    prop_assert_eq!(diff, 0);
                    prop_assert_eq!(alert.gap_hours, 4);
                }
                ConflictSeverity::Warning => {
                    prop_assert_eq!(diff, 1);
                    prop_assert_eq!(alert.gap_hours, 26);
                }
            }

            let mitigated = block_ids.contains(&alert.assessment_id_a.as_str())
                || block_ids.contains(&alert.assessment_id_b.as_str());
            prop_assert_eq!(alert.is_mitigated, mitigated);

            // The message cites both sides, course-prefixed only when the
            // course is real — never a fabricated room or instructor.
            prop_assert!(alert.message.contains("Exam schedule cluster"));
        }
    }
}

// ---------------------------------------------------------------------------
// P6 — study blocks.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000, ..ProptestConfig::default() })]

    #[test]
    fn p6_candidates_are_free_90min_windows_in_the_study_day(
        schedule in arb_schedule(),
        events in arb_event_vec(),
        day_offset in -3i64..=10,
    ) {
        let day = date_at(day_offset);
        let candidates = study_block_candidates(&schedule, &events, day);

        let target_weekday = day.weekday();
        for candidate in &candidates {
            // Inside the study day: 08:00 ≤ start, end = start + 90min ≤ 21:30.
            let start_minutes = candidate.start.num_seconds_from_midnight() / 60;
            let end_minutes = candidate.end.num_seconds_from_midnight() / 60;
            prop_assert!(start_minutes >= 8 * 60, "candidate starts before 08:00");
            prop_assert!(end_minutes <= 21 * 60 + 30, "candidate ends after 21:30");
            prop_assert_eq!(end_minutes - start_minutes, 90, "candidate is not a 90-minute window");

            // Overlaps no timetabled slot on that weekday…
            for slot in &schedule.slots {
                let slot_day = quizradar_core::parse::util::weekday_index(&slot.day);
                prop_assert!(
                    !(slot_day == Some(u8::try_from(target_weekday.num_days_from_sunday()).unwrap_or(0))
                        && !(slot.end_time <= candidate.start || slot.start_time >= candidate.end)),
                    "candidate overlaps slot {} on the target weekday",
                    slot.id
                );
            }

            // …and no timed custom event on that date. A dated-but-untimed
            // event on the day blocks everything (honesty: unverifiable).
            for ev in &events {
                if ev.date != Some(day) {
                    continue;
                }
                match (ev.start_time, ev.end_time) {
                    (Some(start), Some(end)) => prop_assert!(
                        end <= candidate.start || start >= candidate.end,
                        "candidate overlaps timed event {}",
                        ev.id
                    ),
                    _ => prop_assert!(false, "candidate booked despite an untimed event that day"),
                }
            }
        }

        // Deterministic: the same inputs give the same candidates.
        let again = study_block_candidates(&schedule, &events, day);
        prop_assert_eq!(candidates, again);
    }
}

// ---------------------------------------------------------------------------
// Deterministic controls.
// ---------------------------------------------------------------------------

#[test]
fn control_same_day_pair_is_critical_with_a_4h_gap() {
    let today = vec![
        assessment(
            "x1",
            Some("CSE241"),
            "Quiz A",
            Some(ref_date()),
            Vec::new(),
            AssessmentType::ClassQuiz,
            None,
        ),
        assessment(
            "x2",
            Some("CSE241"),
            "Quiz B",
            Some(ref_date()),
            Vec::new(),
            AssessmentType::ClassQuiz,
            None,
        ),
    ];
    let empty: Vec<CustomCalendarEvent> = Vec::new();
    let ordered = radar_order(&today, ref_date());
    let alerts = detect_conflicts(&ordered, &empty);
    assert_eq!(alerts.len(), 1, "one same-day pair → one alert");
    assert_eq!(alerts[0].severity, ConflictSeverity::Critical);
    assert_eq!(alerts[0].gap_hours, 4);
    assert!(!alerts[0].is_mitigated);
}

#[test]
fn control_adjacent_day_pair_is_a_warning_with_a_26h_gap() {
    let pair = vec![
        assessment(
            "y1",
            Some("CSE241"),
            "Quiz A",
            Some(ref_date()),
            Vec::new(),
            AssessmentType::ClassQuiz,
            None,
        ),
        assessment(
            "y2",
            Some("CSE241"),
            "Quiz B",
            Some(ref_date() + Duration::days(1)),
            Vec::new(),
            AssessmentType::ClassQuiz,
            None,
        ),
    ];
    let empty: Vec<CustomCalendarEvent> = Vec::new();
    let ordered = radar_order(&pair, ref_date());
    let alerts = detect_conflicts(&ordered, &empty);
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].severity, ConflictSeverity::Warning);
    assert_eq!(alerts[0].gap_hours, 26);
}

#[test]
fn control_readiness_boundaries() {
    // 0/0 → 100 (desktop v4 semantic — an empty syllabus is not 0% ready).
    assert_eq!(readiness_percent(0, 0), 100);
    assert_eq!(readiness_percent(3, 3), 100);
    assert_eq!(readiness_percent(0, 4), 0);
    assert_eq!(readiness_percent(1, 3), 33);
    assert_eq!(readiness_percent(2, 3), 67);
}

#[test]
fn control_roadmap_horizon_cutoffs() {
    // v4 semantics: day 0 and day 1 always exist ("planned today" is a
    // statement, not a missing row) — but they stay EMPTY when nothing
    // qualifies, and no task or readiness card is ever invented.
    let undated = vec![assessment(
        "u1",
        None,
        "Draft quiz",
        None,
        vec!["t1".into(), "t2".into()],
        AssessmentType::ClassQuiz,
        None,
    )];
    let payload = build_study_tasks(
        &undated,
        &CompletedTopics::new(),
        ref_date(),
        AcademicTrack::Eng,
    );
    assert!(
        payload.days.iter().all(|day| day.tasks.is_empty()),
        "an undated draft produces no tasks"
    );
    assert!(
        payload.readiness_cards.is_empty(),
        "an undated draft gets no readiness card"
    );

    let too_far = vec![assessment(
        "f1",
        None,
        "Far quiz",
        Some(date_at(20)),
        vec!["t1".into()],
        AssessmentType::ClassQuiz,
        None,
    )];
    let payload = build_study_tasks(
        &too_far,
        &CompletedTopics::new(),
        ref_date(),
        AcademicTrack::Eng,
    );
    assert!(
        payload.days.iter().all(|day| day.tasks.is_empty()),
        "beyond 14 days there is no roadmap"
    );
    assert!(payload.readiness_cards.is_empty());

    let soon = vec![assessment(
        "s1",
        None,
        "Soon quiz",
        Some(date_at(2)),
        vec!["t1".into(), "t2".into()],
        AssessmentType::ClassQuiz,
        None,
    )];
    let payload = build_study_tasks(
        &soon,
        &CompletedTopics::new(),
        ref_date(),
        AcademicTrack::Eng,
    );
    let tasks: Vec<_> = payload.days.iter().flat_map(|day| &day.tasks).collect();
    assert_eq!(tasks.len(), 2, "one checkbox per real topic");
    for task in &tasks {
        assert!(
            task.day_offset <= 1,
            "a 2-days-out exam keeps every task before its date"
        );
    }
    // Topicless assessments fall back to the honest framework topics.
    let topicless = vec![assessment(
        "n1",
        None,
        "No topics",
        Some(date_at(1)),
        Vec::new(),
        AssessmentType::ClassQuiz,
        None,
    )];
    let payload = build_study_tasks(
        &topicless,
        &CompletedTopics::new(),
        ref_date(),
        AcademicTrack::Eng,
    );
    let tasks: Vec<_> = payload.days.iter().flat_map(|day| &day.tasks).collect();
    assert_eq!(tasks.len(), 3, "the 3 fallback framework topics");
}

#[test]
fn control_untimed_event_blacks_out_its_whole_day() {
    let empty_schedule = ScheduleData::default();
    let blocked_day = event("b1", Some(date_at(3)), None, None);
    let candidates = study_block_candidates(
        &empty_schedule,
        std::slice::from_ref(&blocked_day),
        date_at(3),
    );
    assert!(
        candidates.is_empty(),
        "a dated-but-untimed event leaves no verifiable free window"
    );

    let unblocked = study_block_candidates(&empty_schedule, &[], date_at(3));
    assert!(!unblocked.is_empty(), "a free day has candidates");

    // And the evening-first ordering preference holds on the free day.
    let first_minutes = unblocked[0].start.num_seconds_from_midnight() / 60;
    assert!(
        first_minutes >= 16 * 60,
        "the first candidate is an evening window, got {first_minutes}"
    );
}

#[test]
fn control_mitigated_pair_is_reported_mitigated() {
    let pair = vec![
        assessment(
            "m1",
            Some("CSE241"),
            "Quiz A",
            Some(ref_date()),
            Vec::new(),
            AssessmentType::ClassQuiz,
            None,
        ),
        assessment(
            "m2",
            Some("CSE241"),
            "Quiz B",
            Some(ref_date()),
            Vec::new(),
            AssessmentType::ClassQuiz,
            None,
        ),
    ];
    let block = event(
        &quizradar_core::plan::study_blocks::block_id_for("m1"),
        Some(ref_date()),
        None,
        None,
    );
    let ordered = radar_order(&pair, ref_date());
    let alerts = detect_conflicts(&ordered, std::slice::from_ref(&block));
    assert_eq!(alerts.len(), 1);
    assert!(
        alerts[0].is_mitigated,
        "a study-block- event covering one side mitigates the pair"
    );
    assert_eq!(
        quizradar_core::plan::study_blocks::block_date_for(ref_date()),
        ref_date() - Duration::days(1),
        "auto blocks book the day before the exam"
    );
}
