//! Weighted grade target calculator (`01` §4.2 Grade Center).
//!
//! Answers the student's real question — "what do I still need to score to
//! reach my target grade?" — from the SAME graded-item data the GPA engine
//! reads: both call [`crate::plan::gpa::resolve_course_weighting`], so the
//! Grade Center percentage and the what-if projection can never disagree
//! about what has been earned.
//!
//! Honesty rules (AGENTS §3):
//! - Unknown weights fall back to the GPA engine's OWN rule (raw points, or
//!   an equal share of the course weight the explicit weights leave behind)
//!   and the result carries `equal_weight_assumed = true` plus a
//!   plain-language `note` — the calculator never silently pretends the
//!   weights were known.
//! - The remaining weight is the weight of the STILL-UNGRADED items. When
//!   their weight is unknown the remaining share is reported as `None` — and
//!   so is the requirement — instead of an invented number.
//! - A target that is already secured, or that can no longer be reached,
//!   reports `achievable = false` with a note instead of a fabricated
//!   number.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::plan::gpa::{resolve_course_weighting, GradedContribution, WeightingMode};
use crate::types::{Assessment, GradeRecord};

/// The weighted-grade-target result for one course.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GradeTargetResult {
    pub course_id: String,
    /// The split below is exact: every graded item carried an explicit weight
    /// and the remaining share is known.
    pub weights_known: bool,
    /// A fallback assumption produced the split (raw points or an equal
    /// share) and the `note` says so.
    pub equal_weight_assumed: bool,
    /// Explicit weight already graded (percentage points).
    pub graded_weight: f64,
    /// Weight still ungraded, under the rule in force. `None` when the
    /// still-ungraded items carry no recorded weight, so the remaining share
    /// cannot be derived without inventing one.
    pub remaining_weight: Option<f64>,
    /// The weighted percentage earned so far — the very number the GPA
    /// engine reports for the course. `None` when nothing is graded.
    pub current_percentage: Option<f64>,
    /// The requested target letter (as passed in, matched case-insensitively).
    pub target_letter: String,
    /// The minimum percentage the requested letter requires on `scale`.
    pub target_percentage: f64,
    /// Average percentage needed on the remaining weight to reach the
    /// target. `None` = already secured, impossible, or not computable
    /// without inventing a weighting — the `note` distinguishes which.
    pub required_average_on_remaining: Option<f64>,
    /// `false` when the target is already secured or can no longer be
    /// reached (see `note`).
    pub achievable: bool,
    /// Plain-language honesty note: what was assumed and what the numbers
    /// mean. Never empty.
    pub note: String,
}

/// The minimum percentage a letter grade requires on `scale`.
///
/// Mirrors [`evaluate_scale`]'s thresholds exactly — the two functions must
/// never disagree about what a "B" means.
#[must_use]
pub fn minimum_percentage_for_letter(scale: &str, letter: &str) -> Option<f64> {
    let letter = letter.trim().to_ascii_lowercase();
    let threshold = match scale.trim().to_ascii_lowercase().as_str() {
        "uk_honors" | "uk" => match letter.as_str() {
            s if s.starts_with("first") || s == "1st" => 70.0,
            s if s.contains("upper") || s == "2:1" => 60.0,
            s if s.contains("lower") || s == "2:2" => 50.0,
            s if s.contains("third") || s == "3rd" => 40.0,
            _ => return None,
        },
        "ects" => match letter.as_str() {
            "a" => 90.0,
            "b" => 80.0,
            "c" => 70.0,
            "d" => 60.0,
            "e" => 50.0,
            _ => return None,
        },
        "percentage" | "percent" => letter.parse::<f64>().ok()?,
        // "4.0" US scale (default)
        _ => match letter.as_str() {
            "a" => 93.0,
            "a-" => 90.0,
            "b+" => 87.0,
            "b" => 83.0,
            "b-" => 80.0,
            "c+" => 77.0,
            "c" => 73.0,
            "c-" => 70.0,
            "d+" => 67.0,
            "d" => 60.0,
            _ => return None,
        },
    };
    Some(threshold)
}

/// Computes the weighted grade target for one course.
///
/// `assessments` may contain other courses' items — they are filtered by
/// `course_id` the same case-insensitive way the GPA engine matches.
#[must_use]
pub fn calculate_grade_target(
    course_id: &str,
    assessments: &[Assessment],
    grades: &HashMap<String, GradeRecord>,
    scale: &str,
    target_letter: &str,
) -> GradeTargetResult {
    let target = target_letter.trim().to_string();
    let target_percentage = minimum_percentage_for_letter(scale, &target).unwrap_or_default();

    // The course's own items, matched the way the GPA engine matches them.
    let course_items: Vec<&Assessment> = assessments
        .iter()
        .filter(|a| {
            a.course_id
                .as_deref()
                .unwrap_or("")
                .eq_ignore_ascii_case(course_id)
        })
        .collect();

    let mut graded: Vec<GradedContribution> = Vec::new();
    let mut ungraded: Vec<Option<f64>> = Vec::new();
    for assessment in &course_items {
        let grade = grades.get(&assessment.id);
        let achieved = grade
            .and_then(|g| g.achieved_score)
            .or(assessment.achieved_score);
        let max = grade.and_then(|g| g.max_score).or(assessment.max_score);
        let weight = grade
            .and_then(|g| g.weightage_percent)
            .or(assessment.weightage_percent)
            .filter(|&w| w > 0.0);
        match (achieved, max) {
            (Some(ach), Some(mx)) if mx > 0.0 => graded.push(GradedContribution {
                ratio: (ach / mx).clamp(0.0, 2.0),
                achieved: ach,
                max: mx,
                weight,
            }),
            // Not marked yet (or not markable): it decides how much weight
            // is still left, but never the earned percentage.
            _ => ungraded.push(weight),
        }
    }

    // The SAME weighting the GPA engine applies to the SAME graded items.
    let weighting = resolve_course_weighting(&graded);
    let current_percentage = weighting.percentage;
    let earned_points = weighting.accumulated_points;
    let graded_weight = weighting.explicit_sum;

    let ungraded_count = ungraded.len();
    let ungraded_all_weighted = ungraded_count > 0 && ungraded.iter().all(|w| w.is_some());
    let ungraded_weight_sum: f64 = ungraded.iter().filter_map(|w| *w).sum();

    // The remaining weight is the weight of the STILL-UNGRADED items, derived
    // from the rule in force.
    let (remaining_weight, remaining_note) = match weighting.mode {
        WeightingMode::Empty => (None, String::new()),
        WeightingMode::RawPoints => {
            if ungraded_count == 0 {
                (Some(0.0), String::new())
            } else {
                (
                    None,
                    format!(
                        "The {ungraded_count} item(s) still to be marked have no recorded weight, so the remaining share is unknown."
                    ),
                )
            }
        }
        WeightingMode::Explicit => {
            if ungraded_count == 0 {
                (Some((100.0 - graded_weight).max(0.0)), String::new())
            } else if ungraded_all_weighted {
                (
                    Some(ungraded_weight_sum),
                    format!(
                        "The {ungraded_count} item(s) still to be marked carry {ungraded_weight_sum:.1}% of the course."
                    ),
                )
            } else {
                (
                    None,
                    format!(
                        "The {ungraded_count} item(s) still to be marked have no recorded weight, so the remaining share is unknown."
                    ),
                )
            }
        }
        WeightingMode::Mixed => {
            if ungraded_count == 0 {
                (
                    Some((100.0 - weighting.total_weightage).max(0.0)),
                    String::new(),
                )
            } else {
                (
                    None,
                    format!(
                        "The {ungraded_count} item(s) still to be marked have no recorded share, so the remaining weight is unknown."
                    ),
                )
            }
        }
    };

    let note_weight = match weighting.mode {
        WeightingMode::Empty => {
            "No graded work yet, so there is nothing to project from.".to_string()
        }
        WeightingMode::RawPoints => format!(
            "{} graded item(s) have no recorded weight, so the projection assumes all items count equally (by their recorded points) — enter their weights in the Grade Center for exact numbers.",
            weighting.unweighted_count
        ),
        WeightingMode::Explicit => "Every graded item has an explicit weight.".to_string(),
        WeightingMode::Mixed => format!(
            "{} graded item(s) have no recorded weight, so the projection assumes all items count equally and splits the course weight the explicit weights leave behind — enter their weights in the Grade Center for exact numbers.",
            weighting.unweighted_count
        ),
    };

    let (required, achievable, note_target) = if current_percentage.is_none() {
        (
            None,
            true,
            "Nothing is graded yet — the first score will anchor the projection.".to_string(),
        )
    } else if let Some(remaining) = remaining_weight {
        // The course total the target threshold applies to, in the weight
        // space of the rule in force.
        let total = match weighting.mode {
            WeightingMode::Explicit => graded_weight + remaining,
            WeightingMode::Mixed | WeightingMode::RawPoints => {
                weighting.total_weightage + remaining
            }
            WeightingMode::Empty => 0.0,
        };
        let needed_points = target_percentage / 100.0 * total;
        let current = current_percentage.unwrap_or(0.0);
        if remaining <= 0.0 {
            // Everything the course weighs is graded: the target is either
            // secured or out of reach — never a fabricated requirement.
            let done = earned_points >= needed_points;
            (
                None,
                false,
                if done {
                    format!(
                        "All the course weight is graded: the course stands at {current:.1}%, already at or above the {target_percentage:.1}% needed for {target}."
                    )
                } else {
                    format!(
                        "All the course weight is graded: the course stands at {current:.1}%, below the {target_percentage:.1}% needed for {target} — nothing remains that could raise it."
                    )
                },
            )
        } else if earned_points >= needed_points {
            (
                None,
                false,
                format!(
                    "The target is already secured — the graded work already reaches the {target_percentage:.1}% needed for {target}."
                ),
            )
        } else {
            let required = (needed_points - earned_points) / remaining * 100.0;
            if required > 100.0 {
                (
                    None,
                    false,
                    format!(
                        "{target} needs more than 100% on the remaining {remaining:.1}% — it is no longer reachable."
                    ),
                )
            } else {
                (
                    Some((required * 10.0).round() / 10.0),
                    true,
                    format!(
                        "Average at least {required:.1}% on the remaining {remaining:.1}% to reach {target}."
                    ),
                )
            }
        }
    } else {
        (
            None,
            true,
            format!(
                "The remaining weight is unknown, so the score needed for {target} cannot be calculated without inventing a weighting."
            ),
        )
    };

    let equal_weight_assumed = matches!(
        weighting.mode,
        WeightingMode::RawPoints | WeightingMode::Mixed
    );
    let weights_known = !equal_weight_assumed && remaining_weight.is_some();

    let mut note = note_weight;
    if !remaining_note.is_empty() {
        note.push(' ');
        note.push_str(&remaining_note);
    }
    note.push(' ');
    note.push_str(&note_target);

    GradeTargetResult {
        course_id: course_id.to_string(),
        weights_known,
        equal_weight_assumed,
        graded_weight: (graded_weight * 10.0).round() / 10.0,
        remaining_weight: remaining_weight.map(|w| (w * 10.0).round() / 10.0),
        current_percentage,
        target_letter: target,
        target_percentage,
        required_average_on_remaining: required,
        achievable,
        note,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Assessment;

    fn assessment(
        id: &str,
        course: &str,
        achieved: Option<f64>,
        max: Option<f64>,
        weight: Option<f64>,
    ) -> Assessment {
        let mut item =
            crate::plan::fixtures::assessment_on(id, Some(course), "Quiz 1", None, vec![]);
        item.achieved_score = achieved;
        item.max_score = max;
        item.weightage_percent = weight;
        item
    }

    fn course(id: &str) -> crate::types::Course {
        crate::types::Course {
            id: id.to_string(),
            name: format!("Course {id}"),
            color: "#4f46e5".to_string(),
            bg: None,
            border: None,
            credits: Some(3.0),
            max_absences: None,
        }
    }

    /// The course percentage the GPA engine reports for the same items.
    fn gpa_percentage(assessments: &[Assessment], course_id: &str) -> Option<f64> {
        let summary = crate::plan::gpa::calculate_gpa(
            &[course(course_id)],
            assessments,
            &HashMap::new(),
            "4.0",
        );
        summary.courses[0].percentage
    }

    #[test]
    fn explicit_weights_project_the_remaining_requirement() {
        let items = vec![
            assessment("a1", "CSE241", Some(80.0), Some(100.0), Some(30.0)),
            assessment("a2", "CSE241", Some(90.0), Some(100.0), Some(20.0)),
        ];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
        assert!(result.weights_known);
        assert!(!result.equal_weight_assumed);
        assert_eq!(result.graded_weight, 50.0);
        assert_eq!(result.remaining_weight, Some(50.0));
        // earned = 0.8*30 + 0.9*20 = 42; needed = 0.83*100 = 83 → 41/50 = 82%
        assert_eq!(result.required_average_on_remaining, Some(82.0));
        assert!(result.achievable);
    }

    #[test]
    fn unknown_weights_are_labeled_equal_weight() {
        let items = vec![
            assessment("a1", "CSE241", Some(60.0), Some(100.0), None),
            assessment("a2", "CSE241", Some(60.0), Some(100.0), None),
        ];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "A");
        assert!(!result.weights_known);
        assert!(result.equal_weight_assumed);
        assert!(
            result.note.contains("assumes all items count equally"),
            "{}",
            result.note
        );
    }

    #[test]
    fn a_lost_target_says_so_instead_of_inventing_a_number() {
        let items = vec![assessment(
            "a1",
            "CSE241",
            Some(10.0),
            Some(100.0),
            Some(100.0),
        )];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "A");
        assert!(!result.achievable);
        assert_eq!(result.required_average_on_remaining, None);
    }

    #[test]
    fn other_courses_items_are_ignored() {
        let items = vec![assessment(
            "a1",
            "MATH101",
            Some(80.0),
            Some(100.0),
            Some(30.0),
        )];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
        assert_eq!(result.current_percentage, None);
    }

    #[test]
    fn all_unweighted_graded_items_report_a_real_percentage() {
        let items = vec![
            assessment("a1", "CSE241", Some(60.0), Some(100.0), None),
            assessment("a2", "CSE241", Some(80.0), Some(100.0), None),
        ];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
        // Raw points, exactly like the GPA engine: 140/200 = 70.0%.
        assert_eq!(result.current_percentage, Some(70.0));
        assert_eq!(result.current_percentage, gpa_percentage(&items, "CSE241"));
        assert!(
            !result.note.contains("Nothing is graded yet"),
            "{}",
            result.note
        );
    }

    #[test]
    fn mixed_weights_agree_with_the_gpa_engine() {
        let items = vec![
            assessment("a1", "CSE241", Some(80.0), Some(100.0), Some(50.0)),
            assessment("a2", "CSE241", Some(100.0), Some(100.0), None),
        ];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
        // (0.8*50 + 1.0*50) / 100 = 90.0%
        assert_eq!(result.current_percentage, Some(90.0));
        assert_eq!(result.current_percentage, gpa_percentage(&items, "CSE241"));
    }

    #[test]
    fn parity_with_gpa_engine_on_every_branch() {
        let cases: Vec<Vec<Assessment>> = vec![
            // nothing graded at all
            vec![assessment("a1", "CSE241", None, None, Some(50.0))],
            // every graded item unweighted -> raw points
            vec![
                assessment("a1", "CSE241", Some(60.0), Some(100.0), None),
                assessment("a2", "CSE241", Some(45.0), Some(50.0), None),
            ],
            // every graded item explicitly weighted
            vec![
                assessment("a1", "CSE241", Some(80.0), Some(100.0), Some(30.0)),
                assessment("a2", "CSE241", Some(90.0), Some(100.0), Some(20.0)),
            ],
            // mixed explicit / unweighted
            vec![
                assessment("a1", "CSE241", Some(80.0), Some(100.0), Some(50.0)),
                assessment("a2", "CSE241", Some(100.0), Some(100.0), None),
            ],
        ];
        for items in cases {
            let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
            assert_eq!(
                result.current_percentage,
                gpa_percentage(&items, "CSE241"),
                "the grade target and the GPA engine disagree"
            );
        }
    }

    #[test]
    fn ungraded_items_are_accounted_for_in_the_remaining_weight() {
        let items = vec![
            assessment("a1", "CSE241", Some(80.0), Some(100.0), Some(40.0)),
            assessment("a2", "CSE241", None, None, Some(30.0)),
        ];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
        // The still-ungraded item carries 30% of the course.
        assert_eq!(result.remaining_weight, Some(30.0));
        // earned 32 of the 70 accounted points; B needs 83% → (58.1-32)/30 = 87%
        assert_eq!(result.required_average_on_remaining, Some(87.0));
        assert!(result.achievable);

        // Without a recorded weight the remaining share is unknown, not invented.
        let unknown = vec![
            assessment("a1", "CSE241", Some(80.0), Some(100.0), Some(40.0)),
            assessment("a2", "CSE241", None, None, None),
        ];
        let unknown_result =
            calculate_grade_target("CSE241", &unknown, &HashMap::new(), "4.0", "B");
        assert_eq!(unknown_result.remaining_weight, None);
        assert_eq!(unknown_result.required_average_on_remaining, None);
        assert!(
            unknown_result.note.contains("remaining share is unknown"),
            "{}",
            unknown_result.note
        );
    }

    #[test]
    fn a_secured_target_says_so_instead_of_inventing_a_number() {
        let items = vec![assessment(
            "a1",
            "CSE241",
            Some(95.0),
            Some(100.0),
            Some(100.0),
        )];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "A");
        assert_eq!(result.current_percentage, Some(95.0));
        assert!(!result.achievable);
        assert_eq!(result.required_average_on_remaining, None);
        assert!(result.note.contains("already"), "{}", result.note);
    }

    #[test]
    fn an_unreachable_target_says_so_instead_of_inventing_a_number() {
        let items = vec![
            assessment("a1", "CSE241", Some(10.0), Some(100.0), Some(50.0)),
            assessment("a2", "CSE241", None, None, Some(50.0)),
        ];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "4.0", "B");
        // earned 5 of 100 accounted points; B needs 83 → (83-5)/50 = 156% on the rest.
        assert!(!result.achievable);
        assert_eq!(result.required_average_on_remaining, None);
        assert!(
            result.note.contains("no longer reachable"),
            "{}",
            result.note
        );
    }

    #[test]
    fn the_percentage_scale_accepts_a_numeric_target() {
        let items = vec![assessment(
            "a1",
            "CSE241",
            Some(60.0),
            Some(100.0),
            Some(100.0),
        )];
        let result = calculate_grade_target("CSE241", &items, &HashMap::new(), "percentage", "75");
        assert_eq!(result.target_percentage, 75.0);
        // Everything is graded and 60% is below the 75% asked for.
        assert!(!result.achievable);
        assert_eq!(result.required_average_on_remaining, None);
    }
}
