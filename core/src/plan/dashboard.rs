//! `DashboardSummary` derivation (`01` §4.3): the whole dashboard is
//! *derived* — nothing here mutates state, touches a clock or invents a stat.
//!
//! Given the stored assessments, the user's topic-check state, their custom
//! events and an injected reference date ("today"), this module produces:
//! - `next_up` — the earliest *dated* upcoming assessment (undated drafts
//!   cannot carry a countdown, so they never hold this slot)
//! - `upcoming_this_week` — the 7-day window from the reference date (today
//!   plus the next six days; the KPI label says "Next 7 days")
//! - `all_upcoming` — upcoming assessments in the canonical radar order
//! - `exam_type_counts` / `sources_count` — pure tallies (sorted maps so the
//!   serialization is stable). `exam_type_counts` counts the SAME seven-day
//!   window as `upcoming_this_week` (the pills sit under that KPI);
//!   `sources_count` tallies every upcoming assessment per source.
//! - readiness % — completed topic checkmarks ÷ tracked topics, both from
//!   real data (a dashboard with zero tracked topics means "nothing
//!   pending"; the desktop v4 semantic — no synthetic activity stats, `03`
//!   §A8)
//! - `study_recommendations` — one card per upcoming assessment with
//!   deterministic `why_study_now` phrasing and topic-check items keyed
//!   `"{assessment_id}::{topic_index}"` (the exact key shape the UI writes
//!   back into `completed_topics`).
//!
//! Reference-relative fields (`days_until`, `is_upcoming`, `urgency_level`,
//! `priority_score`) are recomputed at derive time (day-rollover semantics —
//! desktop v4's `recalculateAssessmentDeadlines`), so a scan performed days
//! ago still reports honest countdowns today. The input slice is never
//! mutated; date-derived display strings from the parsers (`day_name`,
//! `display_time`) are honored as-is.
//!
//! Unmitigated conflict alerts also surface as the per-assessment
//! `conflict_warning` chip (`01` §4.3 timeline rows) — mitigated pairs only
//! change the banner state, since a scheduled study block already answers
//! them.

use std::collections::BTreeMap;

use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

use crate::parse::util::{compute_priority_score, days_until, format_12h, urgency_for};
use crate::plan::conflicts::{self, ConflictAlert};
use crate::types::{Assessment, AssessmentType, CompletedTopics, CustomCalendarEvent};

/// Badge copy for a countdown (`"TODAY"` / `"TOMORROW"` / `"IN N DAYS"`;
/// past dates carry `"PAST"`). Undated items have no badge — none is
/// fabricated.
#[must_use]
pub fn urgency_badge(days_until: Option<i32>) -> Option<String> {
    match days_until {
        None => None,
        Some(0) => Some("TODAY".to_string()),
        Some(1) => Some("TOMORROW".to_string()),
        Some(days) if days > 1 => Some(format!("IN {days} DAYS")),
        Some(_) => Some("PAST".to_string()),
    }
}

/// Global/per-card readiness: completed topics ÷ tracked topics, from data
/// only. `0 / 0` means nothing is tracked, so nothing is pending — the
/// desktop v4 semantic.
#[must_use]
pub fn readiness_percent(completed: usize, total: usize) -> u32 {
    if total == 0 {
        100
    } else {
        ((completed as f32 / total as f32) * 100.0).round() as u32
    }
}

/// Topic-check key: the single write/read shape for `completed_topics` and
/// every topic checkbox (`01` §3 topic key).
///
/// The key is **content-addressed**: `"{assessment_id}::h{fnv1a64 of the
/// normalized topic text}"`. Earlier builds keyed by the topic's *position*
/// (`"{assessment_id}::{index}"`), so a rescan that reordered an
/// announcement's topic list silently reattached the user's checkmarks to
/// whatever now sat at that index. Addressing the topic's own (normalized)
/// text makes completion survive reordering; a topic the sources reword
/// loses its check — the same trade-off as before, but only on a real
/// content change. Identical normalized topics inside one assessment share
/// a key and therefore one done-state (they are indistinguishable strings).
#[must_use]
pub fn topic_key_for_text(assessment_id: &str, topic_text: &str) -> String {
    format!(
        "{assessment_id}::h{:016x}",
        crate::parse::util::fnv1a64(normalize_topic_text(topic_text).as_bytes())
    )
}

/// Whitespace/case normalization for topic addressing: trim, collapse
/// internal whitespace runs to one space, casefold. Deterministic and
/// locale-independent (`to_lowercase`, never a locale-aware collation).
#[must_use]
fn normalize_topic_text(topic_text: &str) -> String {
    let mut normalized = String::with_capacity(topic_text.len());
    let mut in_whitespace = false;
    for character in topic_text.trim().chars() {
        if character.is_whitespace() {
            in_whitespace = true;
        } else {
            if in_whitespace && !normalized.is_empty() {
                normalized.push(' ');
            }
            in_whitespace = false;
            normalized.extend(character.to_lowercase());
        }
    }
    normalized
}

/// The pre-v5.0.1 positional key (`"{assessment_id}::{index}"`), if this key
/// is one. Migration and the backup/import merge boundaries use this to
/// carry completion state into the content-addressed shape; the `h` prefix
/// on new keys keeps the two shapes structurally distinct.
#[must_use]
pub fn parse_legacy_topic_key(key: &str) -> Option<(String, usize)> {
    let (assessment_id, index) = key.rsplit_once("::")?;
    if assessment_id.is_empty() || index.is_empty() {
        return None;
    }
    // Legacy suffixes are pure decimal; content keys carry the `h` prefix.
    index.parse::<usize>().ok().map(|parsed| (assessment_id.to_string(), parsed))
}

/// Rewrites legacy positional keys in a `completed_topics` map into
/// content-addressed keys, using each assessment's CURRENT topic list as the
/// index→text table. Entries whose assessment or index no longer resolve are
/// dropped and counted (the positional scheme had already lost them; this
/// just stops carrying the dead rows). Content keys pass through untouched.
/// Returns `(remapped map, remapped count, dropped count)`.
#[must_use]
pub fn remap_legacy_topic_keys(
    map: &CompletedTopics,
    assessments: &[Assessment],
) -> (CompletedTopics, usize, usize) {
    let mut remapped = CompletedTopics::new();
    let mut remapped_count = 0usize;
    let mut dropped_count = 0usize;
    for (key, done) in map {
        match parse_legacy_topic_key(key) {
            Some((assessment_id, index)) => {
                let topic = assessments
                    .iter()
                    .find(|assessment| assessment.id == assessment_id)
                    .and_then(|assessment| assessment.topics.get(index));
                match topic {
                    Some(topic_text) => {
                        let new_key = topic_key_for_text(&assessment_id, topic_text);
                        // Two positional keys may address the same content
                        // (duplicate topic texts): a `true` wins over a
                        // `false`, and identity wins over nothing.
                        let entry = remapped.entry(new_key).or_insert(*done);
                        if *done {
                            *entry = true;
                        }
                        remapped_count += 1;
                    }
                    None => dropped_count += 1,
                }
            }
            None => {
                remapped.insert(key.clone(), *done);
            }
        }
    }
    (remapped, remapped_count, dropped_count)
}

/// One checklist item inside a recommendation card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TopicCheckItem {
    /// The content-addressed `completed_topics` key
    /// (`"{assessment_id}::h{hash}"` — see [`topic_key_for_text`]).
    pub key: String,
    pub topic: String,
    pub completed: bool,
}

/// A numbered "What Should I Study?" card (`01` §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StudyRecommendation {
    pub assessment_id: String,
    pub course_id: Option<String>,
    pub course_name: Option<String>,
    pub title: String,
    pub assessment_type: AssessmentType,
    #[serde(rename = "date_iso", with = "crate::types::iso_date", default)]
    pub date: Option<NaiveDate>,
    pub display_time: Option<String>,
    pub days_until: Option<i32>,
    pub urgency_badge: Option<String>,
    pub priority_score: u8,
    /// Deterministic phrasing (never AI, never a fabricated room/time):
    /// the time/room/hours clauses appear only when the data established
    /// them.
    pub why_study_now: String,
    pub ai_study_plan: Option<String>,
    pub topics: Vec<TopicCheckItem>,
    pub warnings: Vec<String>,
    pub color: Option<String>,
    /// Completed-topics share for this card (`100` when it has no topics).
    pub progress_percent: u32,
}

/// The dashboard payload (`02` §3.1 `DashboardSummary`).
///
/// v4's `grade_stats` block is intentionally absent: grading lives on the
/// assessment/store layer (phase 04) and v4's letter-standing guesswork was
/// not one of `01` §4.3's dashboard KPIs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DashboardSummary {
    /// The injected reference date itself, so the dashboard can be replayed
    /// stable for any chosen "today".
    #[serde(with = "crate::types::iso_date_req")]
    pub reference_date: NaiveDate,
    pub next_up: Option<Assessment>,
    pub upcoming_this_week: Vec<Assessment>,
    pub all_upcoming: Vec<Assessment>,
    pub exam_type_counts: BTreeMap<String, usize>,
    pub study_recommendations: Vec<StudyRecommendation>,
    pub total_topics_count: usize,
    pub completed_topics_count: usize,
    pub readiness_percent: u32,
    pub conflict_alerts: Vec<ConflictAlert>,
    pub sources_count: BTreeMap<String, usize>,
}

/// Recompute the reference-relative fields of one assessment for the given
/// "today" (day-rollover semantics). Dated items get a fresh countdown,
/// urgency and priority; undated items stay radar placeholders without a
/// countdown (`compute_priority_score(None, …)` orders them below dated
/// items). Nothing is ever trusted over the stored calendar date.
#[must_use]
pub fn refresh_assessment(assessment: &Assessment, reference_date: NaiveDate) -> Assessment {
    let mut refreshed = assessment.clone();
    let days_i32 = days_until(assessment.date, reference_date);
    let days_i64 = days_i32.map(i64::from);
    refreshed.days_until = days_i32;
    refreshed.is_upcoming = match days_i64 {
        Some(days) => days >= 0,
        None => true,
    } && assessment.retired_source_run.is_none();
    refreshed.urgency_level = urgency_for(days_i64);
    refreshed.priority_score = compute_priority_score(
        days_i64,
        assessment.assessment_type,
        assessment.topics.len(),
    );
    refreshed
}

/// Canonical radar order for upcoming assessments: dated first (date, then
/// start time, then title, then id — fully deterministic, unlike v4's
/// dependence on caller pre-sorting), undated radar placeholders after,
/// past items excluded. Past assessments stay in the store; they simply
/// have no place on the radar.
#[must_use]
pub fn radar_order(assessments: &[Assessment], reference_date: NaiveDate) -> Vec<Assessment> {
    let mut upcoming: Vec<Assessment> = assessments
        .iter()
        .filter_map(|assessment| {
            let refreshed = refresh_assessment(assessment, reference_date);
            refreshed.is_upcoming.then_some(refreshed)
        })
        .collect();
    upcoming.sort_by_key(radar_key);
    upcoming
}

fn radar_key(
    assessment: &Assessment,
) -> (u8, Option<NaiveDate>, Option<NaiveTime>, String, String) {
    let tied = format!(
        "{course}|{}",
        assessment.title,
        course = assessment.course_id.clone().unwrap_or_default()
    );
    if let Some(date) = assessment.date {
        (
            0,
            Some(date),
            assessment.start_time,
            assessment.title.clone(),
            assessment.id.clone(),
        )
    } else {
        (1, None, None, tied, assessment.id.clone())
    }
}

/// Deterministic `why_study_now` copy (`01` §4.3). Ladders off the
/// recomputed countdown; time/room/estimated-hours clauses appear only when
/// the data established them, so the copy never invents facts:
/// - ≤1 day → "Immediate priority! … is today/tomorrow …"
/// - ≤5 days → "Scheduled this week …"
/// - later → "Major milestone in N days …"
/// - undated → "Date not confirmed yet — no countdown until a date is set."
#[must_use]
pub fn why_study_now(assessment: &Assessment, completed_topics: &CompletedTopics) -> String {
    let total = assessment.topics.len();
    let remaining = assessment
        .topics
        .iter()
        .filter(|topic| {
            !completed_topics
                .get(&topic_key_for_text(&assessment.id, topic))
                .copied()
                .unwrap_or(false)
        })
        .count();

    let with_review_tail = |remaining: usize| {
        if total == 0 {
            "No topics recorded yet — add topics in the assessment detail to track progress."
                .to_string()
        } else {
            format!("{remaining} of {total} topics still need review.")
        }
    };

    match assessment.days_until {
        None => {
            let mut text =
                String::from("Date not confirmed yet — no countdown until a date is set.");
            if total == 0 {
                text.push_str(" No topics recorded yet.");
            } else {
                text.push_str(&format!(" {review}", review = with_review_tail(remaining)));
            }
            text
        }
        // The past arm MUST come first: `days <= 1` also matches negative
        // countdowns, which used to render "… is tomorrow" for past exams.
        Some(days) if days < 0 => {
            let mut text = format!("{} already took place", assessment.title);
            if let Some(start) = assessment.start_time {
                text.push_str(&format!(" at {}", format_12h(start)));
            }
            text
        }
        Some(days) if days <= 1 => {
            let mut text = format!(
                "Immediate priority! {} is {}",
                assessment.title,
                if days == 0 { "today" } else { "tomorrow" }
            );
            if let Some(start) = assessment.start_time {
                text.push_str(&format!(" at {}", format_12h(start)));
            }
            if let Some(room) = assessment.room.as_deref().filter(|r| !r.trim().is_empty()) {
                text.push_str(&format!(" in {room}"));
            }
            text.push_str(". ");
            text.push_str(&with_review_tail(remaining));
            text
        }
        Some(days) if days <= 5 => {
            let mut text = String::from("Scheduled this week");
            if let Some(day_name) = assessment
                .day_name
                .as_deref()
                .filter(|day| !day.trim().is_empty())
            {
                text.push_str(&format!(" on {day_name}"));
            }
            if let Some(start) = assessment.start_time {
                text.push_str(&format!(" at {}", format_12h(start)));
            }
            if let Some(room) = assessment.room.as_deref().filter(|r| !r.trim().is_empty()) {
                text.push_str(&format!(" in {room}"));
            }
            text.push_str(". ");
            if total == 0 {
                text.push_str(
                    "No topics recorded yet — add topics in the assessment detail to track progress.",
                );
            } else if let Some(hours) = assessment.estimated_study_hours {
                text.push_str(&format!(
                    "Est. {hours:.1} hrs needed across {total} topics."
                ));
            } else {
                text.push_str(&with_review_tail(remaining));
            }
            text
        }
        Some(days) => {
            let mut text = String::from("Major milestone in ");
            text.push_str(&days.to_string());
            text.push_str(" days (");
            text.push_str(
                &assessment
                    .date
                    .map(|date| date.format("%Y-%m-%d").to_string())
                    .unwrap_or_default(),
            );
            text.push_str("). ");
            if total == 0 {
                text.push_str(
                    "No topics recorded yet — add topics in the assessment detail to track progress.",
                );
            } else {
                text.push_str(&format!("Start early revision across {total} topics."));
            }
            text
        }
    }
}

/// Build one recommendation card (topic-check items carry the
/// content-addressed keys the UI writes back).
#[must_use]
pub fn build_recommendation(
    assessment: &Assessment,
    completed_topics: &CompletedTopics,
) -> StudyRecommendation {
    let mut topic_items = Vec::with_capacity(assessment.topics.len());
    let mut completed_for_this = 0usize;
    for topic in &assessment.topics {
        let key = topic_key_for_text(&assessment.id, topic);
        let completed = completed_topics.get(&key).copied().unwrap_or(false);
        if completed {
            completed_for_this += 1;
        }
        topic_items.push(TopicCheckItem {
            key,
            topic: topic.clone(),
            completed,
        });
    }
    StudyRecommendation {
        assessment_id: assessment.id.clone(),
        course_id: assessment.course_id.clone(),
        course_name: assessment.course_name.clone(),
        title: assessment.title.clone(),
        assessment_type: assessment.assessment_type,
        date: assessment.date,
        display_time: assessment.display_time.clone(),
        days_until: assessment.days_until,
        urgency_badge: urgency_badge(assessment.days_until),
        priority_score: assessment.priority_score,
        why_study_now: why_study_now(assessment, completed_topics),
        ai_study_plan: assessment.ai_study_plan.clone(),
        topics: topic_items,
        warnings: assessment.warnings.clone(),
        color: assessment.color.clone(),
        progress_percent: readiness_percent(completed_for_this, assessment.topics.len()),
    }
}

/// Derive the full dashboard (`01` §4.3). Every input is data; the only
/// "environment" is the injected `reference_date`. Pure: no IO, no clock,
/// no fabricated stats — an empty radar stays honestly empty.
#[must_use]
pub fn build_dashboard_summary(
    assessments: &[Assessment],
    completed_topics: &CompletedTopics,
    custom_events: &[CustomCalendarEvent],
    reference_date: NaiveDate,
) -> DashboardSummary {
    let mut upcoming = radar_order(assessments, reference_date);
    let conflict_alerts = conflicts::detect_conflicts(&upcoming, custom_events);

    let chip_map = conflicts::conflict_chips(&conflict_alerts);
    for assessment in upcoming.iter_mut() {
        assessment.conflict_warning = chip_map.get(&assessment.id).cloned();
    }

    let next_up = upcoming.iter().find(|a| a.date.is_some()).cloned();
    // The "next 7 days" KPI (01 §4.3) covers SEVEN calendar days: today
    // plus the next six. The old `0..=7` window was eight days long, so the
    // count contradicted the label it was rendered under.
    let upcoming_this_week: Vec<Assessment> = upcoming
        .iter()
        .filter(|a| matches!(a.days_until, Some(0..=6)))
        .cloned()
        .collect();

    // The type pills sit UNDER the "Next 7 days" KPI card (01 §4.3), so they
    // must count the same window the card counts. They used to tally every
    // upcoming assessment, which made the pills contradict the headline
    // number beside them.
    let exam_type_counts = upcoming_this_week.iter().fold(
        BTreeMap::new(),
        |mut counts: BTreeMap<String, usize>, assessment| {
            *counts
                .entry(assessment.assessment_type.as_str().to_string())
                .or_insert(0) += 1;
            counts
        },
    );

    let sources_count = upcoming.iter().fold(
        BTreeMap::new(),
        |mut counts: BTreeMap<String, usize>, assessment| {
            *counts
                .entry(assessment.source.as_str().to_string())
                .or_insert(0) += 1;
            counts
        },
    );

    let mut total_topics_count = 0usize;
    let mut completed_topics_count = 0usize;
    for assessment in &upcoming {
        total_topics_count += assessment.topics.len();
        completed_topics_count += assessment
            .topics
            .iter()
            .filter(|topic| {
                completed_topics
                    .get(&topic_key_for_text(&assessment.id, topic))
                    .copied()
                    .unwrap_or(false)
            })
            .count();
    }

    DashboardSummary {
        reference_date,
        next_up,
        upcoming_this_week,
        all_upcoming: upcoming.clone(),
        exam_type_counts,
        study_recommendations: upcoming
            .iter()
            .map(|assessment| build_recommendation(assessment, completed_topics))
            .collect(),
        total_topics_count,
        completed_topics_count,
        readiness_percent: readiness_percent(completed_topics_count, total_topics_count),
        conflict_alerts,
        sources_count,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use std::collections::HashMap;

    use chrono::{Duration, NaiveDate, NaiveTime};

    use super::*;
    use crate::plan::fixtures::{assessment_on, ref_date};
    use crate::plan::study_blocks::block_id_for;
    use crate::types::{AssessmentSource, UrgencyLevel};

    fn day(offset: i64) -> NaiveDate {
        ref_date() + Duration::days(offset)
    }

    fn time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    fn completed_map(keys: &[(&str, &str)]) -> CompletedTopics {
        // Seeded by topic TEXT (production keys are content-addressed).
        let mut map = HashMap::new();
        for (assessment_id, topic) in keys {
            map.insert(topic_key_for_text(assessment_id, topic), true);
        }
        map
    }

    #[test]
    fn empty_inputs_yield_honest_empty_dashboard() {
        let summary = build_dashboard_summary(&[], &completed_map(&[]), &[], ref_date());
        assert!(summary.next_up.is_none());
        assert!(summary.upcoming_this_week.is_empty());
        assert!(summary.all_upcoming.is_empty());
        assert!(summary.study_recommendations.is_empty());
        assert!(summary.exam_type_counts.is_empty());
        assert!(summary.sources_count.is_empty());
        assert!(summary.conflict_alerts.is_empty());
        assert_eq!(summary.total_topics_count, 0);
        assert_eq!(summary.completed_topics_count, 0);
        // 0 / 0 = nothing pending (desktop v4 semantic, tested to document it).
        assert_eq!(summary.readiness_percent, 100);
        assert_eq!(summary.reference_date, ref_date());
    }

    #[test]
    fn readiness_is_completed_div_total_from_data_only() {
        let one = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(day(3)),
            vec!["Sensor Stack", "Memory Map", "Build Pipeline"],
        );
        let two = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Midterm Exam",
            Some(day(6)),
            vec!["Graphs", "Trees"],
        );
        let done = completed_map(&[
            ("gmail-1", "Sensor Stack"),
            ("gmail-1", "Memory Map"),
            ("gmail-2", "Graphs"),
        ]);
        let summary = build_dashboard_summary(&[one, two], &done, &[], ref_date());
        assert_eq!(summary.total_topics_count, 5);
        assert_eq!(summary.completed_topics_count, 3);
        assert_eq!(summary.readiness_percent, 60);
        // Per-card progress is also derived: 2/3 ≈ 67, 1/2 = 50.
        let cards: Vec<u32> = summary
            .study_recommendations
            .iter()
            .map(|card| card.progress_percent)
            .collect();
        assert_eq!(cards, vec![67, 50]);
        // Topic-check items live on the exact key shape the UI writes back.
        assert_eq!(
            summary.study_recommendations[0].topics[0],
            TopicCheckItem {
                key: topic_key_for_text("gmail-1", "Sensor Stack"),
                topic: "Sensor Stack".to_string(),
                completed: true,
            }
        );
    }

    #[test]
    fn urgency_badge_boundaries_2_5_14_days_and_gaps() {
        assert_eq!(urgency_badge(Some(0)).as_deref(), Some("TODAY"));
        assert_eq!(urgency_badge(Some(1)).as_deref(), Some("TOMORROW"));
        assert_eq!(urgency_badge(Some(2)).as_deref(), Some("IN 2 DAYS"));
        assert_eq!(urgency_badge(Some(5)).as_deref(), Some("IN 5 DAYS"));
        assert_eq!(urgency_badge(Some(14)).as_deref(), Some("IN 14 DAYS"));
        assert_eq!(urgency_badge(Some(15)).as_deref(), Some("IN 15 DAYS"));
        assert_eq!(urgency_badge(Some(-1)).as_deref(), Some("PAST"));
        assert_eq!(urgency_badge(None), None);
    }

    #[test]
    fn topic_key_is_assessment_id_hash_of_normalized_text() {
        let key = topic_key_for_text("gmail-3", "Sensor Stack");
        assert!(key.starts_with("gmail-3::h"), "content-addressed shape: {key}");
        assert_eq!(key.len(), "gmail-3::h".len() + 16, "64-bit hash as 16 hex chars");
        assert_eq!(
            topic_key_for_text("gmail-3", "Sensor Stack"),
            key,
            "deterministic across calls"
        );
        // The legacy positional shape is recognized (and only that shape).
        assert_eq!(parse_legacy_topic_key("gmail-3::2"), Some(("gmail-3".into(), 2)));
        assert_eq!(parse_legacy_topic_key(&key), None, "content keys are not legacy");
        assert_eq!(parse_legacy_topic_key("no-separator"), None);
    }

    #[test]
    fn reference_date_injection_moves_the_window_without_wall_clock() {
        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(day(5)),
            vec!["Single topic"],
        );
        let blank = completed_map(&[]);

        // Today is the fixture Friday: 5 days out → inside the 0–7 window.
        let summary =
            build_dashboard_summary(std::slice::from_ref(&assessment), &blank, &[], ref_date());
        assert_eq!(
            summary.next_up.as_ref().map(|a| a.id.as_str()),
            Some("gmail-1")
        );
        assert_eq!(summary.upcoming_this_week.len(), 1);
        assert_eq!(
            summary.all_upcoming[0].days_until,
            Some(5),
            "countdown recomputed from the injected reference date"
        );

        // Injected "today" a week earlier: 12 days out → outside the window.
        let earlier = build_dashboard_summary(
            std::slice::from_ref(&assessment),
            &blank,
            &[],
            ref_date() - Duration::days(7),
        );
        assert!(earlier.upcoming_this_week.is_empty());
        assert_eq!(earlier.all_upcoming.len(), 1);
        assert_eq!(earlier.all_upcoming[0].days_until, Some(12));

        // Injected "today" after the date: the item falls off the radar.
        let after =
            build_dashboard_summary(&[assessment], &blank, &[], ref_date() + Duration::days(7));
        assert!(after.all_upcoming.is_empty());
        assert!(after.next_up.is_none());
        assert_eq!(after.total_topics_count, 0);
    }

    #[test]
    fn next_up_skips_undated_and_land_order_is_deterministic() {
        let undated = assessment_on("gmail-9", None, "Draft: date not confirmed", None, vec![]);
        let timed = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Beta quiz",
            Some(day(1)),
            vec![],
        );
        let timeless = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Alpha quiz",
            Some(day(1)),
            vec![],
        );
        let later = assessment_on("gmail-3", None, "Zeta quiz", Some(day(2)), vec![]);
        let summary = build_dashboard_summary(
            &[undated, timed, timeless, later],
            &completed_map(&[]),
            &[],
            ref_date(),
        );
        assert_eq!(
            summary.next_up.as_ref().map(|a| a.id.as_str()),
            Some("gmail-1"),
            "earliest dated item wins; same-day ties break on (time unknown first, title)"
        );
        let ordered_ids: Vec<&str> = summary.all_upcoming.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(
            ordered_ids,
            vec!["gmail-1", "gmail-2", "gmail-3", "gmail-9"]
        );
    }

    #[test]
    fn undated_assessments_carry_no_countdown_but_count_towards_readiness() {
        let undated = assessment_on(
            "gmail-8",
            None,
            "Unscheduled quiz",
            None,
            vec!["Chapter 1", "Chapter 2"],
        );
        let done = completed_map(&[("gmail-8", "Chapter 1")]);
        let summary = build_dashboard_summary(&[undated], &done, &[], ref_date());
        assert_eq!(summary.next_up, None);
        let card = &summary.study_recommendations[0];
        assert_eq!(card.urgency_badge, None);
        assert_eq!(card.days_until, None);
        assert_eq!(
            card.why_study_now,
            "Date not confirmed yet — no countdown until a date is set. 1 of 2 topics still need review."
        );
        assert_eq!(summary.total_topics_count, 2);
        assert_eq!(summary.completed_topics_count, 1);
        assert_eq!(summary.readiness_percent, 50);
    }

    #[test]
    fn exam_type_counts_use_the_same_seven_day_window_as_the_kpi() {
        // Day 6 is the last day of the "next 7 days" window; day 7 is not.
        let inside = assessment_on("gmail-1", None, "Quiz 1", Some(day(6)), vec![]);
        let outside = assessment_on("gmail-2", None, "Quiz 2", Some(day(7)), vec![]);
        let summary =
            build_dashboard_summary(&[inside, outside], &completed_map(&[]), &[], ref_date());
        assert_eq!(summary.upcoming_this_week.len(), 1);
        assert_eq!(summary.all_upcoming.len(), 2);
        // The pills sit under the 7-day KPI, so they must not count the
        // assessment the KPI does not show.
        assert_eq!(summary.exam_type_counts.get("Class Quiz"), Some(&1));
    }

    #[test]
    fn exam_type_and_source_counts_are_pure_tallies() {
        let mut first = assessment_on("gmail-1", None, "Quiz 1", Some(day(1)), vec![]);
        first.source = AssessmentSource::Gmail;
        let mut second = assessment_on("gmail-2", None, "Quiz 2", Some(day(2)), vec![]);
        second.source = AssessmentSource::Gmail;
        second.assessment_type = AssessmentType::MidtermExam;
        let mut third = assessment_on("custom-1", None, "Review session", Some(day(3)), vec![]);
        third.source = AssessmentSource::Custom;
        third.assessment_type = AssessmentType::MidtermExam;
        let summary = build_dashboard_summary(
            &[first, second, third],
            &completed_map(&[]),
            &[],
            ref_date(),
        );
        let mut expected_types = BTreeMap::new();
        expected_types.insert("Class Quiz".to_string(), 1);
        expected_types.insert("Midterm Exam".to_string(), 2);
        assert_eq!(summary.exam_type_counts, expected_types);
        let mut expected_sources = BTreeMap::new();
        expected_sources.insert("Gmail".to_string(), 2);
        expected_sources.insert("Custom".to_string(), 1);
        assert_eq!(summary.sources_count, expected_sources);
    }

    #[test]
    fn copy_ladders_inject_time_room_hours_only_when_the_data_has_them() {
        let blank = completed_map(&[]);
        let three_topics = vec!["Alpha", "Beta", "Gamma"];

        let today = assessment_on(
            "gmail-1",
            None,
            "Midterm Exam",
            Some(day(0)),
            three_topics.clone(),
        );
        let mut today = today;
        // today has no topics completed → "3 of 3" — start_time and room on.
        today.start_time = Some(time(9, 0));
        today.room = Some("Hall B-204".to_string());
        let summary = build_dashboard_summary(&[today], &blank, &[], ref_date());
        assert_eq!(
            summary.study_recommendations[0].why_study_now,
            "Immediate priority! Midterm Exam is today at 9:00 AM in Hall B-204. 3 of 3 topics still need review."
        );

        let tomorrow_plain = assessment_on(
            "gmail-2",
            None,
            "Class Quiz",
            Some(day(1)),
            three_topics.clone(),
        );
        let summary = build_dashboard_summary(&[tomorrow_plain], &blank, &[], ref_date());
        assert_eq!(
            summary.study_recommendations[0].why_study_now,
            "Immediate priority! Class Quiz is tomorrow. 3 of 3 topics still need review."
        );

        let mut in_four = assessment_on(
            "gmail-3",
            Some("CSE241"),
            "Quiz",
            Some(day(4)),
            three_topics.clone(),
        );
        in_four.estimated_study_hours = Some(5.0);
        in_four.start_time = Some(time(14, 0));
        in_four.room = Some("Lab C".to_string());
        let summary = build_dashboard_summary(&[in_four], &blank, &[], ref_date());
        assert_eq!(
            summary.study_recommendations[0].why_study_now,
            "Scheduled this week on Tuesday at 2:00 PM in Lab C. Est. 5.0 hrs needed across 3 topics."
        );

        // No time/room/estimate: the copy omits those clauses entirely.
        let bare = assessment_on(
            "gmail-4",
            Some("CSE241"),
            "Quiz",
            Some(day(4)),
            three_topics.clone(),
        );
        let done = completed_map(&[("gmail-4", "Alpha")]);
        let summary = build_dashboard_summary(&[bare], &done, &[], ref_date());
        assert_eq!(
            summary.study_recommendations[0].why_study_now,
            "Scheduled this week on Tuesday. 2 of 3 topics still need review."
        );
    }

    #[test]
    fn milestone_copy_dates_long_hypes_dishonestly() {
        let blank = completed_map(&[]);
        let in_nine = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Finale quiz",
            Some(day(9)),
            vec!["Alpha", "Beta", "Gamma"],
        );
        let summary = build_dashboard_summary(&[in_nine], &blank, &[], ref_date());
        assert_eq!(
            summary.study_recommendations[0].why_study_now,
            "Major milestone in 9 days (2026-11-01). Start early revision across 3 topics."
        );
        // No zero-topic milestone copy ever invents work.
        let empty = assessment_on(
            "gmail-2",
            Some("CSE241"),
            "Finale quiz",
            Some(day(9)),
            vec![],
        );
        let summary = build_dashboard_summary(&[empty], &blank, &[], ref_date());
        assert_eq!(
            summary.study_recommendations[0].why_study_now,
            "Major milestone in 9 days (2026-11-01). No topics recorded yet — add topics in the assessment detail to track progress."
        );
    }

    #[test]
    fn empty_topic_assessments_never_fabricate_review_copy_or_stats() {
        let blank = completed_map(&[]);
        let today = assessment_on("gmail-1", None, "Quiz", Some(day(0)), vec![]);
        let summary = build_dashboard_summary(&[today], &blank, &[], ref_date());
        let card = &summary.study_recommendations[0];
        assert!(
            !card.why_study_now.contains("still need review"),
            "no topics == no review claim: {card:?}"
        );
        assert!(
            card.why_study_now.contains("No topics recorded yet"),
            "the card says no topics exist: {card:?}"
        );
        assert_eq!(card.progress_percent, 100);
        assert_eq!(summary.readiness_percent, 100);
        assert_eq!(summary.total_topics_count, 0);
        assert_eq!(summary.completed_topics_count, 0);
    }

    #[test]
    fn conflict_alerts_surface_in_dashboard_and_chips_clear_when_mitigated() {
        let block_day = day(3);
        let one = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(block_day), vec![]);
        let two = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Midterm Exam",
            Some(block_day),
            vec![],
        );
        let blank = completed_map(&[]);

        let unmitigated =
            build_dashboard_summary(&[one.clone(), two.clone()], &blank, &[], ref_date());
        assert_eq!(unmitigated.conflict_alerts.len(), 1);
        assert_eq!(
            unmitigated
                .all_upcoming
                .iter()
                .filter(|a| a.conflict_warning.is_some())
                .count(),
            2,
            "both assessments of an unmitigated cluster carry the chip"
        );

        let block = CustomCalendarEvent {
            id: block_id_for("gmail-1"),
            title: "Study Block: Quiz 1".to_string(),
            course_id: Some("CSE241".to_string()),
            event_type: Some("Study Session".to_string()),
            date: Some(block_day - Duration::days(1)),
            start_time: Some(time(17, 0)),
            end_time: Some(time(18, 30)),
            room: None,
            notes: None,
            color: None,
        };
        let mitigated = build_dashboard_summary(
            &[one, two],
            &blank,
            std::slice::from_ref(&block),
            ref_date(),
        );
        assert_eq!(mitigated.conflict_alerts.len(), 1);
        assert!(mitigated.conflict_alerts[0].is_mitigated);
        assert!(
            mitigated
                .all_upcoming
                .iter()
                .all(|a| a.conflict_warning.is_none()),
            "mitigated clusters clear every per-assessment chip"
        );
    }

    #[test]
    fn upcoming_window_is_exactly_seven_days_inclusive() {
        let blank = completed_map(&[]);
        let edge6 = assessment_on("gmail-1", None, "Day 6", Some(day(6)), vec![]);
        let edge7 = assessment_on("gmail-2", None, "Day 7", Some(day(7)), vec![]);
        let summary = build_dashboard_summary(&[edge6, edge7], &blank, &[], ref_date());
        // Today + six more days = seven days, matching the "Next 7 days"
        // label the KPI is rendered under.
        assert_eq!(summary.upcoming_this_week.len(), 1);
        assert_eq!(summary.upcoming_this_week[0].id, "gmail-1");
        assert_eq!(summary.all_upcoming.len(), 2);
    }

    #[test]
    fn refresh_recomputes_stale_countdowns_from_a_previous_scan_date() {
        // Assessment parsed on Oct 18 with days_until=5 (Oct 23 target),
        // rendered on the Oct 23 fixture day: the countdown is 0 today.
        let stale = assessment_on("gmail-1", None, "Quiz", Some(day(0)), vec!["Alpha"]);
        let stale_scan_day = ref_date() - Duration::days(5);
        let refreshed = refresh_assessment(&stale, ref_date());
        assert_eq!(refreshed.days_until, Some(0));
        assert!(refreshed.is_upcoming);
        assert_eq!(refreshed.urgency_level, UrgencyLevel::Critical);
        let _ = stale_scan_day;
        // Undated placeholder: no countdown invented.
        let undated = assessment_on("gmail-2", None, "Draft", None, vec![]);
        let refreshed = refresh_assessment(&undated, ref_date());
        assert_eq!(refreshed.days_until, None);
        assert!(refreshed.is_upcoming);
        assert_eq!(refreshed.urgency_level, UrgencyLevel::Upcoming);
        // Past: excluded from is_upcoming, ranked "past".
        let past = assessment_on("gmail-3", None, "Old quiz", Some(day(-2)), vec![]);
        let refreshed = refresh_assessment(&past, ref_date());
        assert!(!refreshed.is_upcoming);
        assert_eq!(refreshed.urgency_level, UrgencyLevel::Past);
        assert_eq!(refreshed.priority_score, 10);
    }

    #[test]
    fn topic_keys_are_content_addressed_and_reorder_safe() {
        // THE regression this change exists for: a completion recorded
        // against "Memory Map" must survive the source announcing the same
        // topics in a different order (the positional key scheme attached
        // the checkmark to whatever moved into that index).
        let before = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(day(3)),
            vec!["Sensor Stack", "Memory Map", "Build Pipeline"],
        );
        let mut reordered = before.clone();
        reordered.topics = vec![
            "Build Pipeline".to_string(),
            "Sensor Stack".to_string(),
            "Memory Map".to_string(),
        ];

        let done = completed_map(&[("gmail-1", "Memory Map")]);
        let card_before = build_recommendation(&before, &done);
        let card_after = build_recommendation(&reordered, &done);

        assert_eq!(card_before.topics[1].key, card_after.topics[2].key);
        assert!(card_before.topics[1].completed);
        assert!(card_after.topics[2].completed);
        assert!(!card_after.topics[0].completed);
        assert!(!card_after.topics[1].completed);
    }

    #[test]
    fn topic_keys_normalize_case_and_whitespace_but_not_wording() {
        let base = topic_key_for_text("a1", "  Sensor   Stack ");
        assert_eq!(base, topic_key_for_text("a1", "sensor stack"));
        assert_ne!(base, topic_key_for_text("a1", "Sensor Stacks"));
        // Different assessments never share a key, identical texts do.
        assert_ne!(base, topic_key_for_text("a2", "Sensor Stack"));
        assert_eq!(
            topic_key_for_text("a1", "Memory Map"),
            topic_key_for_text("a1", "Memory Map")
        );
        assert!(base.starts_with("a1::h"), "content-addressed shape: {base}");
        assert!(parse_legacy_topic_key(&base).is_none());
    }

    #[test]
    fn remap_carries_positional_completion_through_reorder_and_drops_dead_rows() {
        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(day(3)),
            vec!["Sensor Stack", "Memory Map", "Build Pipeline"],
        );
        // v4/pre-migration shape: indexes into the ORIGINAL topic order.
        let legacy: CompletedTopics = [
            ("gmail-1::1", true),  // "Memory Map" → must survive
            ("gmail-1::2", false), // false entries pass through as false
            ("gmail-1::9", true),  // out of range → dropped
            ("gone::0", true),     // unknown assessment → dropped
            ("gmail-1::h0badbeef0badbeef", true), // already content key → untouched
        ]
        .into_iter()
        .map(|(key, done)| (key.to_string(), done))
        .collect();

        let (remapped, moved, dropped) = remap_legacy_topic_keys(&legacy, &[assessment]);

        assert_eq!(moved, 2, "the two in-range legacy keys; the content key passes through uncounted");
        assert_eq!(dropped, 2);
        assert_eq!(
            remapped.get(&topic_key_for_text("gmail-1", "Memory Map")),
            Some(&true)
        );
        assert_eq!(
            remapped.get(&topic_key_for_text("gmail-1", "Build Pipeline")),
            Some(&false)
        );
        assert_eq!(
            remapped.get("gmail-1::h0badbeef0badbeef"),
            Some(&true),
            "content keys pass through untouched"
        );
        assert!(!remapped.contains_key("gmail-1::9"));
        assert!(!remapped.contains_key("gone::0"));
    }
}
