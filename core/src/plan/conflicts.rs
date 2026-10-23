//! 48-hour exam-overload detection (`01` §3 "Conflict alert"):
//! two *dated* assessments landing within two calendar days of each other
//! are a load cluster — the same day is critical (their individual start
//! times may differ, but the student faces a same-day stack), adjacent days
//! are a warning. A `study-block-{assessment_id}` prep event mitigates the
//! pair it covers (the prep session has moved the load, so the alert only
//! reports the remaining risk).
//!
//! The window is calendar-day based on purpose: assessment times are often
//! unknown or unreliable across sources, so the cluster math never
//! pretends hour-precision beyond the two fixed gap labels (`4h` same-day,
//! `26h` adjacent-day, desktop v4 semantics). Copy only ever cites course
//! ids and titles — never an instructor or room.
//!
//! Pure: no clock, no IO. Callers pass assessments already in radar order
//! ([`crate::plan::dashboard::radar_order`]); earlier order = earlier alert.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::types::{Assessment, CustomCalendarEvent};

/// Severity of an overload pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictSeverity {
    #[serde(rename = "critical")]
    Critical,
    #[serde(rename = "warning")]
    Warning,
}

/// One detonated cluster (`02` §3.2 `ConflictAlert`). `title_a/b` are v5
/// additions (defaulted on import from v4 dumps) used for per-assessment
/// chips; everything else mirrors v4.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConflictAlert {
    pub assessment_id_a: String,
    pub assessment_id_b: String,
    pub title_a: String,
    pub title_b: String,
    pub course_a: Option<String>,
    pub course_b: Option<String>,
    #[serde(with = "crate::types::iso_date_req")]
    pub date_a: NaiveDate,
    #[serde(with = "crate::types::iso_date_req")]
    pub date_b: NaiveDate,
    /// Same-day pairs report the fixed 4h simulated gap; adjacent-day
    /// pairs 26h (both desktop v4 labels — never a computed clock math).
    pub gap_hours: i32,
    pub severity: ConflictSeverity,
    pub message: String,
    /// True when a `study-block-` event already covers either assessment.
    pub is_mitigated: bool,
}

impl ConflictAlert {
    /// The human label of one side: `"{course} ({title})"`, or just the
    /// title for course-less assessments (no fabricated course names).
    #[must_use]
    pub fn side_label(&self, side: ConflictSide) -> String {
        let (course, title) = match side {
            ConflictSide::A => (&self.course_a, &self.title_a),
            ConflictSide::B => (&self.course_b, &self.title_b),
        };
        match course.as_deref().filter(|course| !course.trim().is_empty()) {
            Some(course) => format!("{course} ({title})"),
            None => title.clone(),
        }
    }
}

/// Which side of an alert a label is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictSide {
    A,
    B,
}

/// Detect overload pairs among the passed (radar-ordered) upcoming
/// assessments. Undated items never pair (they have no schedulable date);
/// everything dates >1 day apart is outside the 48h cluster window.
#[must_use]
pub fn detect_conflicts(
    ordered_upcoming: &[Assessment],
    custom_events: &[CustomCalendarEvent],
) -> Vec<ConflictAlert> {
    let block_ids: Vec<&str> = study_block_suffixes(custom_events)
        .map(|(_, suffix)| suffix)
        .collect();

    // (radar position, date), date-sorted; stable for equal dates.
    let mut dated: Vec<(usize, NaiveDate, &Assessment)> = ordered_upcoming
        .iter()
        .enumerate()
        .filter_map(|(position, assessment)| {
            assessment.date.map(|date| (position, date, assessment))
        })
        .collect();
    dated.sort_by_key(|(position, date, _)| (*date, *position));

    let mut alerts: Vec<(usize, usize, ConflictAlert)> = Vec::new();
    for left in 0..dated.len() {
        for right in (left + 1)..dated.len() {
            let (position_a, date_a, first) = dated[left];
            let (position_b, date_b, second) = dated[right];
            let diff_days = (date_b - date_a).num_days();
            if diff_days < 0 {
                continue;
            }
            if diff_days > 1 {
                break;
            }

            let same_day = diff_days == 0;
            let (gap_hours, severity) = if same_day {
                (4, ConflictSeverity::Critical)
            } else {
                (26, ConflictSeverity::Warning)
            };
            let a1 = first;
            let a2 = second;
            let message = format!(
                "Exam schedule cluster: {} and {} occur within {} hours! \
                 Review early to balance your study load.",
                side_label_parts(a1),
                side_label_parts(a2),
                gap_hours
            );
            let is_mitigated =
                block_ids.contains(&a1.id.as_str()) || block_ids.contains(&a2.id.as_str());
            alerts.push((
                position_a,
                position_b,
                ConflictAlert {
                    assessment_id_a: a1.id.clone(),
                    assessment_id_b: a2.id.clone(),
                    title_a: a1.title.clone(),
                    title_b: a2.title.clone(),
                    course_a: a1.course_id.clone(),
                    course_b: a2.course_id.clone(),
                    date_a,
                    date_b,
                    gap_hours,
                    severity,
                    message,
                    is_mitigated,
                },
            ));
        }
    }
    alerts.sort_by_key(|(first_position, second_position, _)| (*first_position, *second_position));
    alerts.into_iter().map(|(_, _, alert)| alert).collect()
}

fn side_label_parts(assessment: &Assessment) -> String {
    match assessment
        .course_id
        .as_deref()
        .filter(|course| !course.trim().is_empty())
    {
        Some(course) => format!("{course} ({})", assessment.title),
        None => assessment.title.clone(),
    }
}

/// Extract the assessment-id suffix of every `study-block-` event
/// (`study-block-gmail-123` → `gmail-123`).
pub fn study_block_suffixes(
    custom_events: &[CustomCalendarEvent],
) -> impl Iterator<Item = (String, &'_ str)> {
    custom_events.iter().filter_map(|event| {
        let suffix = event
            .id
            .strip_prefix("study-block-")
            .filter(|suffix| !suffix.is_empty())?;
        Some((event.id.clone(), suffix))
    })
}

/// Per-assessment chip copy (`01` §4.3 timeline rows): one short honest
/// line per assessment involved in an *unmitigated* cluster, first alert
/// wins. Mitigated pairs carry no chip — the study block already answers
/// them (the banner reports the mitigation instead).
#[must_use]
pub fn conflict_chips(alerts: &[ConflictAlert]) -> BTreeMap<String, String> {
    let mut chips: BTreeMap<String, String> = BTreeMap::new();
    for alert in alerts.iter().filter(|alert| !alert.is_mitigated) {
        chips
            .entry(alert.assessment_id_a.clone())
            .or_insert_with(|| {
                format!(
                    "Exam schedule cluster with {} on {} (within {} hours).",
                    alert.side_label(ConflictSide::B),
                    alert.date_b.format("%Y-%m-%d"),
                    alert.gap_hours
                )
            });
        chips
            .entry(alert.assessment_id_b.clone())
            .or_insert_with(|| {
                format!(
                    "Exam schedule cluster with {} on {} (within {} hours).",
                    alert.side_label(ConflictSide::A),
                    alert.date_a.format("%Y-%m-%d"),
                    alert.gap_hours
                )
            });
    }
    chips
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use chrono::{Duration, NaiveTime};

    use super::*;
    use crate::plan::fixtures::{assessment_on, ref_date};

    fn event(
        id: &str,
        date: Option<NaiveDate>,
        start: Option<NaiveTime>,
        end: Option<NaiveTime>,
    ) -> CustomCalendarEvent {
        CustomCalendarEvent {
            id: id.to_string(),
            title: "Block".to_string(),
            course_id: None,
            event_type: Some("Study Session".to_string()),
            date,
            start_time: start,
            end_time: end,
            room: None,
            notes: None,
            color: None,
        }
    }

    #[test]
    fn same_day_is_critical_with_simulated_gap() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let first = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(day), Vec::new());
        let second = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Final Exam",
            Some(day),
            Vec::new(),
        );
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&first, ref_date()),
                crate::plan::dashboard::refresh_assessment(&second, ref_date()),
            ],
            &[],
        );
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, ConflictSeverity::Critical);
        assert_eq!(alerts[0].gap_hours, 4);
    }

    #[test]
    fn adjacent_day_is_warning_and_clamped_pair_order_is_deterministic() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let first = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(day), Vec::new());
        let second = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Final Exam",
            Some(day + Duration::days(1)),
            Vec::new(),
        );
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&first, ref_date()),
                crate::plan::dashboard::refresh_assessment(&second, ref_date()),
            ],
            &[],
        );
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].severity, ConflictSeverity::Warning);
        assert_eq!(alerts[0].gap_hours, 26);
        assert_eq!(alerts[0].assessment_id_a, "gmail-1");
        assert_eq!(alerts[0].assessment_id_b, "gmail-2");
    }

    #[test]
    fn pair_two_days_apart_is_outside_the_48h_window() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let first = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(day), Vec::new());
        let second = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Final Exam",
            Some(day + Duration::days(2)),
            Vec::new(),
        );
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&first, ref_date()),
                crate::plan::dashboard::refresh_assessment(&second, ref_date()),
            ],
            &[],
        );
        assert!(
            alerts.is_empty(),
            "two calendar days apart (or undefined hours) is not an overload alert"
        );
    }

    #[test]
    fn mitigated_by_block_event_for_either_assessment() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let first = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(day), Vec::new());
        let second = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Final Exam",
            Some(day),
            Vec::new(),
        );
        let block = event(
            "study-block-gmail-1",
            Some(day - Duration::days(1)),
            Some(NaiveTime::from_hms_opt(17, 0, 0).unwrap()),
            Some(NaiveTime::from_hms_opt(18, 30, 0).unwrap()),
        );
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&first, ref_date()),
                crate::plan::dashboard::refresh_assessment(&second, ref_date()),
            ],
            &[block],
        );
        assert_eq!(alerts.len(), 1);
        assert!(
            alerts[0].is_mitigated,
            "the pair still exists but the block mitigates it"
        );
        assert!(
            conflict_chips(&alerts).is_empty(),
            "mitigated pairs carry no per-assessment chip"
        );
    }

    #[test]
    fn chip_copy_for_both_sides_honest_labels_and_dates() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let first = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(day), Vec::new());
        let second = assessment_on("gmail-2", None, "Portfolio Review", Some(day), Vec::new());
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&first, ref_date()),
                crate::plan::dashboard::refresh_assessment(&second, ref_date()),
            ],
            &[],
        );
        assert_eq!(alerts.len(), 1);
        assert_eq!(
            alerts[0].message,
            "Exam schedule cluster: CSE241 (Quiz 1) and Portfolio Review occur within 4 hours! \
             Review early to balance your study load."
        );
        let chips = conflict_chips(&alerts);
        assert_eq!(
            chips.get("gmail-1").map(String::as_str),
            Some("Exam schedule cluster with Portfolio Review on 2026-11-02 (within 4 hours).")
        );
        assert_eq!(
            chips.get("gmail-2").map(String::as_str),
            Some("Exam schedule cluster with CSE241 (Quiz 1) on 2026-11-02 (within 4 hours).")
        );
    }

    #[test]
    fn undated_entries_never_pair_and_semester_fields_stay_ignored() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let undated = assessment_on("gmail-1", None, "Unscheduled draft", None, Vec::new());
        let dated = assessment_on("gmail-2", None, "Midterm Exam", Some(day), Vec::new());
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&undated, ref_date()),
                crate::plan::dashboard::refresh_assessment(&dated, ref_date()),
            ],
            &[],
        );
        assert!(
            alerts.is_empty(),
            "undated items carry no date and can never form a cluster"
        );
    }

    #[test]
    fn three_same_day_assessments_yield_three_alerts_in_radar_order() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let one = assessment_on("gmail-1", Some("CSE241"), "Quiz 1", Some(day), Vec::new());
        let two = assessment_on(
            "gmail-2",
            Some("MATH101"),
            "Midterm Exam",
            Some(day),
            Vec::new(),
        );
        let three = assessment_on("gmail-3", Some("DATA201"), "Quiz 2", Some(day), Vec::new());
        let alerts = detect_conflicts(
            &[
                crate::plan::dashboard::refresh_assessment(&one, ref_date()),
                crate::plan::dashboard::refresh_assessment(&two, ref_date()),
                crate::plan::dashboard::refresh_assessment(&three, ref_date()),
            ],
            &[],
        );
        assert_eq!(alerts.len(), 3);
        assert_eq!(
            (
                alerts[0].assessment_id_a.as_str(),
                alerts[0].assessment_id_b.as_str()
            ),
            ("gmail-1", "gmail-2")
        );
        assert_eq!(
            (
                alerts[1].assessment_id_a.as_str(),
                alerts[1].assessment_id_b.as_str()
            ),
            ("gmail-1", "gmail-3")
        );
        assert_eq!(
            (
                alerts[2].assessment_id_a.as_str(),
                alerts[2].assessment_id_b.as_str()
            ),
            ("gmail-2", "gmail-3")
        );
        assert_eq!(alerts[0].date_a, day);
        assert_eq!(alerts[0].date_b, day);
    }
}
