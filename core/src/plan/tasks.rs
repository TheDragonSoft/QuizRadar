//! The deterministic "Daily Study Roadmap" (`01` §4.4, v4
//! `build_study_tasks` ported): a 14-day-horizon planner that spreads each
//! upcoming assessment's topics over the days left before it (≤5 prep
//! days, round-robin `topic_index % (prep_days + 1)`), clamps per-topic
//! hour estimates to 0.5–2.5 when the assessment carries one, and emits
//! per-assessment readiness cards.
//!
//! Honesty rules encoded here (`AGENTS.md` §3, `03` §A8):
//! - `ai_generated` is always `false` — this is the deterministic default
//!   planner; AI optimization is an explicit, labeled layer above it
//!   (`05` AI design), never silently replacing it.
//! - per-topic hours exist *only* when the assessment itself carries an
//!   `estimated_study_hours` value; they stay `None` instead of a default,
//!   and day/payload hour totals are `None` when any covered task lacks an
//!   estimate, so no day understates its work.
//! - undated assessments (no verifiable date) are excluded: a
//!   deadline-driven roadmap cannot schedule around an unknown deadline,
//!   and inventing one would fake countdowns.
//! - task urgency runs the **unified ladder** (`01` §3: critical ≤2d,
//!   high ≤5d, medium ≤14d) through `parse::util::urgency_for`, not v4's
//!   divergent "critical ≤1 / high ≤4 / normal" table (`03` §A-series:
//!   ladders must be unified; the reasoning copy below keeps v4's honest
//!   day-boundaries so nothing says "in a few hours" two days out).
//! - the three fallback topics scaffold an assessment-without-topics into
//!   a plannable state; they are generic study work — no course-specific
//!   fabrication (v4's per-course demo plans/hours die with the demo
//!   universe). Priority scoring still counts only the *real* topics.
//!
//! Reference date injection: "today" is an explicit `NaiveDate` argument;
//! see `plan::mod` docs for the platform boundary where it comes from.
//! Priority scores are recomputed here from the injected date
//! (`parse::util::compute_priority_score`) so a stale scan still plans
//! against today and the day-rollover semantics hold.

use std::collections::HashMap;

use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::parse::util::{compute_priority_score, urgency_for};
use crate::plan::dashboard::{readiness_percent, topic_key};
use crate::types::{Assessment, AssessmentType, CompletedTopics, UrgencyLevel};

/// Generic scaffold topics for an assessment the sources posted without a
/// topic list (deterministic, non-course-specific plannability — the only
/// honest fallback path; per-course demo plans are deleted).
const FALLBACK_TOPICS: [&str; 3] = [
    "Core Lecture Concepts & Slides Review",
    "Practice Problem Sets & Exercises",
    "Mock Revision & Key Formula Summary",
];

/// 14-day max horizon (v4 `days_until <= 14`).
const HORIZON_DAYS: i64 = 14;

/// Maximum prep days per assessment (v4); an assessment landing today
/// keeps everything on day 0.
const MAX_PREP_DAYS: i32 = 5;

/// One checkbox on a day card (the same `"{assessment_id}::{topic_index}"`
/// key the dashboard writes back into `completed_topics`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DailyStudyTask {
    /// `task-{assessment_id}-{topic_index}-{day_offset}` (stable per plan).
    pub id: String,
    /// The `completed_topics` key this checkbox writes.
    pub key: String,
    pub assessment_id: String,
    pub course_id: Option<String>,
    pub course_name: Option<String>,
    pub assessment_title: String,
    pub assessment_type: AssessmentType,
    pub topic: String,
    /// 0 = today, growing towards the assessment (≤ `MAX_PREP_DAYS`).
    pub day_offset: i32,
    /// The concrete target calendar date (`ref + day_offset`).
    #[serde(rename = "target_date_iso", with = "crate::types::iso_date_req")]
    pub target_date: NaiveDate,
    /// Honest day label: `Today · Fri, Oct 23` / `Tomorrow · …` / plain
    /// short date. Always carries the real date (never a bare "Day 3").
    pub display_day: String,
    /// Card score demoted by how far away the work sits (later slots rank
    /// under earlier ones when both land inside one sort bucket).
    pub priority_rank: u8,
    /// Unified ladder in task scope: critical / high / medium inside the
    /// 14-day horizon.
    pub urgency: UrgencyLevel,
    /// Per-topic estimate, only when the assessment has one (0.5–2.5 h
    /// clamp, tenth-rounded); `None` renders "—" — never a default.
    pub estimated_hours: Option<f32>,
    /// Deterministic reasoning label of the default planner.
    pub ai_reasoning: String,
    pub completed: bool,
    pub color: Option<String>,
    pub days_until_assessment: i32,
    #[serde(rename = "assessment_date_iso", with = "crate::types::iso_date_req")]
    pub assessment_date: NaiveDate,
}

/// A tasks-view day group (`01` §4.4 "Daily Study Roadmap"; `is_today`
/// drives the pulsing ring).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DailyStudyDayGroup {
    pub day_offset: i32,
    #[serde(rename = "date_iso", with = "crate::types::iso_date_req")]
    pub date: NaiveDate,
    pub display_day: String,
    pub is_today: bool,
    /// Sum of the day's known estimates; `None` when any task on this day
    /// lacks an estimate (never a partial understatement).
    pub total_estimated_hours: Option<f32>,
    /// Uncompleted first, then `priority_rank` descending (v4 sort).
    pub tasks: Vec<DailyStudyTask>,
}

/// Per-assessment readiness card (`01` §4.4 readiness grid; the UI draws
/// its "avg" badge from this grid).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExamReadinessCard {
    pub assessment_id: String,
    pub course_id: Option<String>,
    pub course_name: Option<String>,
    pub title: String,
    pub assessment_type: AssessmentType,
    #[serde(rename = "date_iso", with = "crate::types::iso_date_req")]
    pub date: NaiveDate,
    /// The parser's full display string (`None` renders "—").
    pub display_date: Option<String>,
    pub days_until: i32,
    pub readiness_percent: u32,
    pub completed_count: usize,
    pub total_count: usize,
    pub priority_score: u8,
    pub color: Option<String>,
    /// The first unchecked topic — or the all-done line.
    pub recommended_focus: String,
}

/// The tasks payload (`02` §3.4 `StudyTasksPayload`), always the honest
/// deterministic default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StudyTasksPayload {
    pub days: Vec<DailyStudyDayGroup>,
    pub readiness_cards: Vec<ExamReadinessCard>,
    pub total_tasks: usize,
    pub pending_tasks: usize,
    pub completed_tasks: usize,
    /// Only known when *every* roadmap task carries an estimate.
    pub total_hours: Option<f32>,
    /// Constant `false`: the deterministic planner fills this payload; an
    /// AI-optimized plan would be its own, explicitly labeled payload.
    pub ai_generated: bool,
}

/// Honest day label (v4 `study_day_display`): Today/Tomorrow always carry
/// their real calendar date, so a roadmap is never ambiguous about which
/// day it plans.
#[must_use]
pub fn study_day_display(offset: i32, date: NaiveDate) -> String {
    let short = date.format("%a, %b %-d").to_string();
    match offset {
        0 => format!("Today · {short}"),
        1 => format!("Tomorrow · {short}"),
        _ => short,
    }
}

/// Per-topic hours from the assessment's own estimate, clamped 0.5–2.5 h
/// and rounded to a tenth. `None` hours → `None` (never a default).
#[must_use]
pub fn per_topic_hours(estimated_study_hours: Option<f32>, topic_count: usize) -> Option<f32> {
    estimated_study_hours.map(|hours| {
        let per_topic = hours / topic_count.max(1) as f32;
        let clamped = per_topic.clamp(0.5, 2.5);
        (clamped * 10.0).round() / 10.0
    })
}

/// Deterministic reasoning copy (v4 wording, honest day boundaries).
fn reasoning_for_days(days: i32) -> String {
    match days {
        0 => "Immediate exam deadline in a few hours — high grade impact.".to_string(),
        1 => "Immediate exam deadline in 24 hours — high grade impact.".to_string(),
        2..=5 => "High-priority preparation. Master foundational problem sets before final review."
            .to_string(),
        _ => "Structured early revision to build retention and confidence.".to_string(),
    }
}

/// Build the deterministic roadmap (`01` §4.4). Pure: inputs are data plus
/// the injected reference date; no clock, no IO, no fabricated stats.
#[must_use]
pub fn build_study_tasks(
    assessments: &[Assessment],
    completed_topics: &CompletedTopics,
    reference_date: NaiveDate,
) -> StudyTasksPayload {
    let mut horizon: Vec<(&Assessment, i64)> = assessments
        .iter()
        .filter_map(|assessment| {
            let days = (assessment.date? - reference_date).num_days();
            (0..=HORIZON_DAYS)
                .contains(&days)
                .then_some((assessment, days))
        })
        .collect();

    // Days ascending, then priority descending, then title/id — v4's key
    // made fully deterministic.
    horizon.sort_by(|(left, left_days), (right, right_days)| {
        let left_priority =
            compute_priority_score(Some(*left_days), left.assessment_type, left.topics.len());
        let right_priority =
            compute_priority_score(Some(*right_days), right.assessment_type, right.topics.len());
        left_days
            .cmp(right_days)
            .then_with(|| right_priority.cmp(&left_priority))
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut readiness_cards = Vec::new();
    let mut all_tasks = Vec::new();

    for (assessment, days_i64) in horizon {
        let days = i32::try_from(days_i64).unwrap_or(0);
        let topic_list: Vec<String> = if assessment.topics.is_empty() {
            FALLBACK_TOPICS
                .iter()
                .map(|topic| (*topic).to_string())
                .collect()
        } else {
            assessment.topics.clone()
        };
        let total_count = topic_list.len();

        // ≤5 prep days; an assessment landing today keeps one day group.
        let prep_days = (days.max(1) - 1).min(MAX_PREP_DAYS);

        let hours = per_topic_hours(assessment.estimated_study_hours, total_count);
        let urgency = urgency_for(Some(days_i64));
        let reasoning = reasoning_for_days(days);
        let priority = compute_priority_score(
            Some(days_i64),
            assessment.assessment_type,
            assessment.topics.len(),
        );

        let mut completed_count = 0usize;
        let mut first_uncompleted: Option<String> = None;

        for (index, topic) in topic_list.iter().enumerate() {
            let key = topic_key(&assessment.id, index);
            let completed = completed_topics.get(&key).copied().unwrap_or(false);
            if completed {
                completed_count += 1;
            } else if first_uncompleted.is_none() {
                first_uncompleted = Some(topic.clone());
            }

            let day_offset = (index as i32) % (prep_days + 1);
            let priority_rank = priority.saturating_sub((day_offset as u8) * 5);

            let target_date = reference_date + Duration::days(i64::from(day_offset));
            all_tasks.push(DailyStudyTask {
                id: format!("task-{}-{index}-{day_offset}", assessment.id),
                key,
                assessment_id: assessment.id.clone(),
                course_id: assessment.course_id.clone(),
                course_name: assessment.course_name.clone(),
                assessment_title: assessment.title.clone(),
                assessment_type: assessment.assessment_type,
                topic: topic.clone(),
                day_offset,
                target_date,
                display_day: study_day_display(day_offset, target_date),
                priority_rank,
                urgency,
                estimated_hours: hours,
                ai_reasoning: reasoning.clone(),
                completed,
                color: assessment.color.clone(),
                days_until_assessment: days,
                assessment_date: assessment.date.unwrap_or_default(),
            });
        }

        readiness_cards.push(ExamReadinessCard {
            assessment_id: assessment.id.clone(),
            course_id: assessment.course_id.clone(),
            course_name: assessment.course_name.clone(),
            title: assessment.title.clone(),
            assessment_type: assessment.assessment_type,
            date: assessment.date.unwrap_or_default(),
            display_date: assessment.display_time.clone(),
            days_until: days,
            readiness_percent: readiness_percent(completed_count, total_count),
            completed_count,
            total_count,
            priority_score: priority,
            color: assessment.color.clone(),
            recommended_focus: first_uncompleted
                .unwrap_or_else(|| "All topics mastered! Complete mock revision.".to_string()),
        });
    }

    // Day groups: today and tomorrow always exist ("nothing planned today"
    // is a statement, not a missing row — v4 kept both days).
    let mut grouped: HashMap<i32, Vec<DailyStudyTask>> = HashMap::new();
    for task in all_tasks {
        grouped.entry(task.day_offset).or_default().push(task);
    }
    let mut offsets: Vec<i32> = grouped.keys().copied().collect();
    for fixed_offset in [0, 1] {
        if !offsets.contains(&fixed_offset) {
            offsets.push(fixed_offset);
        }
    }
    offsets.sort_unstable();

    let mut days = Vec::new();
    for offset in &offsets {
        let mut day_tasks = grouped.remove(offset).unwrap_or_default();
        day_tasks.sort_by(|left, right| {
            left.completed
                .cmp(&right.completed)
                .then_with(|| right.priority_rank.cmp(&left.priority_rank))
        });
        let total_estimated_hours = if day_tasks.iter().all(|task| task.estimated_hours.is_some()) {
            let sum: f32 = day_tasks
                .iter()
                .map(|task| task.estimated_hours.unwrap_or_default())
                .sum();
            Some((sum * 10.0).round() / 10.0)
        } else {
            None
        };
        days.push(DailyStudyDayGroup {
            day_offset: *offset,
            date: reference_date + Duration::days(i64::from(*offset)),
            display_day: study_day_display(
                *offset,
                reference_date + Duration::days(i64::from(*offset)),
            ),
            is_today: *offset == 0,
            total_estimated_hours,
            tasks: day_tasks,
        });
    }

    let total_tasks: usize = days.iter().map(|group| group.tasks.len()).sum::<usize>();
    let completed_tasks = days
        .iter()
        .flat_map(|group| group.tasks.iter())
        .filter(|task| task.completed)
        .count();
    let every_task_estimated = days
        .iter()
        .flat_map(|group| group.tasks.iter())
        .all(|task| task.estimated_hours.is_some());
    let total_hours = if every_task_estimated {
        let sum: f32 = days
            .iter()
            .flat_map(|group| group.tasks.iter())
            .map(|task| task.estimated_hours.unwrap_or_default())
            .sum();
        Some((sum * 10.0).round() / 10.0)
    } else {
        None
    };

    StudyTasksPayload {
        days,
        readiness_cards,
        total_tasks,
        pending_tasks: total_tasks - completed_tasks,
        completed_tasks,
        total_hours,
        ai_generated: false,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::plan::fixtures::{assessment_on, ref_date};

    fn day(offset: i64) -> NaiveDate {
        ref_date() + Duration::days(offset)
    }

    fn all_topics(tasks: &[DailyStudyTask]) -> Vec<(String, i32)> {
        tasks
            .iter()
            .map(|task| (task.topic.clone(), task.day_offset))
            .collect()
    }

    #[test]
    fn horizon_is_0_to_14_and_excludes_undated_and_day_15() {
        let fit = assessment_on("gmail-1", None, "Day 14", Some(day(14)), vec!["Alpha"]);
        let too_far = assessment_on("gmail-2", None, "Day 15", Some(day(15)), vec!["Alpha"]);
        let undated = assessment_on("gmail-3", None, "No date", None, vec!["Alpha"]);
        let past = assessment_on("gmail-4", None, "Old", Some(day(-2)), vec!["Alpha"]);
        let payload = build_study_tasks(
            &[fit, too_far, undated, past],
            &CompletedTopics::new(),
            ref_date(),
        );
        assert_eq!(payload.readiness_cards.len(), 1);
        assert_eq!(payload.readiness_cards[0].assessment_id, "gmail-1");
        assert_eq!(payload.readiness_cards[0].days_until, 14);
    }

    #[test]
    fn topics_distribute_round_robin_over_at_most_five_prep_days() {
        // 5 days out, 7 topics: prep days = min(5-1, 5) = 4 → slots cycle 0..4.
        let far = assessment_on(
            "gmail-1",
            None,
            "Quiz",
            Some(day(5)),
            vec!["a", "b", "c", "d", "e", "f", "g"],
        );
        let payload = build_study_tasks(&[far], &CompletedTopics::new(), ref_date());
        let mut spread = Vec::new();
        for group in &payload.days {
            spread.push((group.day_offset, group.tasks.len()));
        }
        // 7 topics over 5 slots: 0→2 topics, 1→2, 2→1, 3→1, 4→1.
        assert_eq!(spread[0], (0, 2));
        assert_eq!(spread[1], (1, 2));
        assert_eq!(spread[2], (2, 1));
        assert_eq!(spread[3], (3, 1));
        assert_eq!(spread[4], (4, 1));
        assert_eq!(payload.total_tasks, 7);
    }

    #[test]
    fn day_1_assessment_crunches_every_topic_today() {
        let tomorrow = assessment_on(
            "gmail-1",
            None,
            "Crunch quiz",
            Some(day(1)),
            vec!["a", "b", "c", "d"],
        );
        let payload = build_study_tasks(&[tomorrow], &CompletedTopics::new(), ref_date());
        // prep_days = 0 → every topic slot-day 0; nothing planned beyond it.
        let offset_holders: Vec<i32> = payload
            .days
            .iter()
            .flat_map(|group| group.tasks.iter())
            .map(|task| task.day_offset)
            .collect();
        assert!(offset_holders.iter().all(|offset| *offset == 0));
        let today = &payload.days[0];
        assert_eq!(today.tasks.len(), 4);
        assert!(today.is_today);
    }

    #[test]
    fn hours_clamp_to_05_through_25_with_tenth_rounding() {
        assert_eq!(per_topic_hours(Some(20.0), 4), Some(2.5));
        assert_eq!(per_topic_hours(Some(1.0), 3), Some(0.5));
        assert_eq!(per_topic_hours(Some(2.0), 2), Some(1.0));
        assert_eq!(per_topic_hours(Some(2.0), 3), Some(0.7));
        assert_eq!(per_topic_hours(None, 3), None, "no estimate → no hours");
        assert_eq!(
            per_topic_hours(Some(2.0), 0),
            Some(2.0),
            "0 topics divides by 1"
        );
    }

    #[test]
    fn unknown_hours_never_fabricate_day_or_payload_totals() {
        let mut planned = assessment_on(
            "gmail-1",
            None,
            "Estimated quiz",
            Some(day(3)),
            vec!["a", "b"],
        );
        planned.estimated_study_hours = Some(4.0);
        let unplanned = assessment_on("gmail-2", None, "Raw quiz", Some(day(1)), vec!["x", "y"]);
        let payload = build_study_tasks(&[planned, unplanned], &CompletedTopics::new(), ref_date());
        assert!(
            payload.total_hours.is_none(),
            "one task without an estimate must hide the payload total"
        );
        let day0 = &payload.days[0];
        let day1 = &payload.days[1];
        assert!(
            day0.total_estimated_hours.is_none(),
            "day 0 mixes estimated and unknown hours → omitted"
        );
        // Day 1: the estimated assessment's second topic (4.0 / 2 = 2.0 h).
        assert_eq!(day1.total_estimated_hours, Some(2.0));
        let mixed: Vec<Option<f32>> = payload
            .days
            .iter()
            .flat_map(|group| group.tasks.iter())
            .map(|task| task.estimated_hours)
            .collect();
        assert!(mixed.contains(&Some(2.0)) && mixed.contains(&None));
    }

    #[test]
    fn day_groups_always_carry_today_and_tomorrow_with_honest_labels() {
        let one = assessment_on("gmail-1", None, "Later quiz", Some(day(4)), vec!["one"]);
        let payload = build_study_tasks(&[one], &CompletedTopics::new(), ref_date());
        assert_eq!(payload.days.len(), 2);
        assert!(payload.days[0].is_today);
        assert!(payload.days[1].tasks.is_empty());
        assert_eq!(payload.days[0].display_day, "Today · Fri, Oct 23");
        assert_eq!(payload.days[1].display_day, "Tomorrow · Sat, Oct 24");
        assert_eq!(payload.days[0].date.to_string(), "2026-10-23");
    }

    #[test]
    fn unified_urgency_ladder_2_5_14_in_tasks() {
        let items: Vec<Assessment> = [2, 3, 5, 6, 14]
            .into_iter()
            .enumerate()
            .map(|(index, days)| {
                assessment_on(
                    &format!("gmail-{index}"),
                    None,
                    "Quiz",
                    Some(day(days)),
                    vec!["topic"],
                )
            })
            .collect();
        let payload = build_study_tasks(&items, &CompletedTopics::new(), ref_date());
        let ladder: std::collections::HashMap<i32, UrgencyLevel> = payload
            .days
            .iter()
            .flat_map(|group| group.tasks.iter())
            .map(|task| (task.days_until_assessment, task.urgency))
            .collect();
        assert_eq!(ladder[&2], UrgencyLevel::Critical);
        assert_eq!(ladder[&3], UrgencyLevel::High);
        assert_eq!(ladder[&5], UrgencyLevel::High);
        assert_eq!(ladder[&6], UrgencyLevel::Medium);
        assert_eq!(ladder[&14], UrgencyLevel::Medium);
    }

    #[test]
    fn reasoning_copy_keeps_honest_day_boundaries() {
        let items: Vec<Assessment> = [0, 1, 2, 6]
            .into_iter()
            .enumerate()
            .map(|(index, days)| {
                assessment_on(
                    &format!("gmail-{index}"),
                    None,
                    "Quiz",
                    Some(day(days)),
                    vec!["topic"],
                )
            })
            .collect();
        let payload = build_study_tasks(&items, &CompletedTopics::new(), ref_date());
        let reasoning: std::collections::HashMap<i32, String> = payload
            .days
            .iter()
            .flat_map(|group| group.tasks.iter())
            .map(|task| (task.days_until_assessment, task.ai_reasoning.clone()))
            .collect();
        assert_eq!(
            reasoning[&0],
            "Immediate exam deadline in a few hours — high grade impact."
        );
        assert_eq!(
            reasoning[&1],
            "Immediate exam deadline in 24 hours — high grade impact."
        );
        assert_eq!(
            reasoning[&2],
            "High-priority preparation. Master foundational problem sets before final review."
        );
        assert_eq!(
            reasoning[&6],
            "Structured early revision to build retention and confidence."
        );
    }

    #[test]
    fn completed_topics_flow_into_tasks_cards_and_pending_counts() {
        let quiz = assessment_on(
            "gmail-1",
            None,
            "Quiz",
            Some(day(3)),
            vec!["Alpha", "Beta", "Gamma"],
        );
        let mut done = CompletedTopics::new();
        done.insert(topic_key("gmail-1", 1), true);
        let payload = build_study_tasks(&[quiz], &done, ref_date());
        assert_eq!(payload.total_tasks, 3);
        assert_eq!(payload.completed_tasks, 1);
        assert_eq!(payload.pending_tasks, 2);
        let card = &payload.readiness_cards[0];
        assert_eq!(card.completed_count, 1);
        assert_eq!(card.total_count, 3);
        assert_eq!(card.readiness_percent, 33);
        assert_eq!(card.recommended_focus, "Alpha");
        assert!(!payload.ai_generated);
    }

    #[test]
    fn fallback_topics_scaffold_topicless_assessments_honestly() {
        let bare = assessment_on("gmail-1", None, "No topics posted", Some(day(2)), vec![]);
        let payload = build_study_tasks(
            std::slice::from_ref(&bare),
            &CompletedTopics::new(),
            ref_date(),
        );
        assert_eq!(payload.total_tasks, 3);
        let card = &payload.readiness_cards[0];
        assert_eq!(card.total_count, 3);
        assert_eq!(
            card.recommended_focus,
            "Core Lecture Concepts & Slides Review"
        );
        // Now complete every fallback topic: the focus line switches.
        let mut done = CompletedTopics::new();
        for index in 0..3 {
            done.insert(topic_key("gmail-1", index), true);
        }
        let payload = build_study_tasks(&[bare], &done, ref_date());
        assert_eq!(
            payload.readiness_cards[0].recommended_focus,
            "All topics mastered! Complete mock revision."
        );
        assert_eq!(payload.readiness_cards[0].readiness_percent, 100);
        assert_eq!(payload.pending_tasks, 0);
    }

    #[test]
    fn ordering_within_a_day_and_across_assessments_is_deterministic() {
        // Nearer assessment first in the readiness grid (days ascending
        // regardless of the input list order); within one day, uncompleted
        // tasks come first, then `priority_rank` descending.
        let nearer = assessment_on("gmail-1", None, "Beta", Some(day(1)), vec!["t1"]);
        let farther = assessment_on("gmail-2", None, "Alpha", Some(day(4)), vec!["t2"]);
        let payload = build_study_tasks(&[farther, nearer], &CompletedTopics::new(), ref_date());
        let cards: Vec<&str> = payload
            .readiness_cards
            .iter()
            .map(|card| card.assessment_id.as_str())
            .collect();
        assert_eq!(cards, vec!["gmail-1", "gmail-2"]);
        let day0 = &payload.days[0];
        assert_eq!(
            day0.tasks
                .iter()
                .map(|task| task.completed)
                .collect::<Vec<_>>(),
            vec![false, false],
            "both assessments' first slots land on day 0, uncompleted"
        );
        assert_eq!(
            all_topics(&day0.tasks),
            vec![("t1".to_string(), 0), ("t2".to_string(), 0)]
        );
    }

    #[test]
    fn priority_scores_recomputed_from_injected_reference_date() {
        let mut midterm = assessment_on("gmail-1", None, "Midterm", Some(day(3)), vec![]);
        midterm.assessment_type = AssessmentType::MidtermExam;
        let payload = build_study_tasks(&[midterm], &CompletedTopics::new(), ref_date());
        // days=3: urgency base 84 + midterm bonus 12 + 0 topics = 96.
        assert_eq!(payload.readiness_cards[0].priority_score, 96);

        // The same assessment re-planned against a later "today": the two
        // days that passed since parsing shrink the horizon (base 95 + 12
        // stays capped at 100 on day 1, so a day-3 slot is used here).
        let later_today = ref_date() + Duration::days(2);
        let mut same_midterm = assessment_on("gmail-1", None, "Midterm", Some(day(5)), vec![]);
        same_midterm.assessment_type = AssessmentType::MidtermExam;
        let payload = build_study_tasks(&[same_midterm], &CompletedTopics::new(), later_today);
        assert_eq!(payload.readiness_cards[0].days_until, 3);
        assert_eq!(payload.readiness_cards[0].priority_score, 96);
    }
}
