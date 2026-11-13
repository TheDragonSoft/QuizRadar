//! GPA and Course Grade Center calculation engine (`01` §4.2, R2).
//!
//! Evaluates course grade points across 4 standard grading scales:
//! - "4.0": US 4.0 standard scale (A: 4.0, A-: 3.7, B+: 3.3, B: 3.0, B-: 2.7, C+: 2.3, C: 2.0, C-: 1.7, D+: 1.3, D: 1.0, F: 0.0)
//! - "uk_honors": UK First Class Honours (>=70%: 1st/4.0, 60-69%: 2:1/3.3, 50-59%: 2:2/2.7, 40-49%: 3rd/2.0, <40%: Fail/0.0)
//! - "ects": European Credit Transfer System (A: 4.0, B: 3.5, C: 3.0, D: 2.5, E: 2.0, F: 0.0)
//! - "percentage": 0.0 to 100.0% raw percentage
//!
//! Credit-weighted semester GPA calculation:
//! Semester GPA = sum(course_grade_point * credits) / sum(credits)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::types::{Assessment, Course, GradeRecord};

/// Grade summary for an individual course.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CourseGradeSummary {
    pub course_id: String,
    pub course_name: String,
    #[serde(default)]
    pub credits: Option<f64>,
    pub accumulated_points: f64,
    pub total_weightage: f64,
    #[serde(default)]
    pub percentage: Option<f64>,
    #[serde(default)]
    pub grade_point: Option<f64>,
    #[serde(default)]
    pub letter_grade: Option<String>,
}

/// Comprehensive semester GPA calculation across enrolled courses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GpaSummary {
    pub scale: String,
    pub scale_max: f64,
    pub total_credits: f64,
    #[serde(default)]
    pub semester_gpa: Option<f64>,
    pub courses: Vec<CourseGradeSummary>,
}

/// Evaluates a percentage grade on a designated scale.
/// Returns `(grade_point, letter_grade, scale_max)`.
#[must_use]
pub fn evaluate_scale(percentage: f64, scale: &str) -> (f64, String, f64) {
    let p = percentage.clamp(0.0, 100.0);
    match scale.trim().to_ascii_lowercase().as_str() {
        "uk_honors" | "uk" => {
            let scale_max = 4.0;
            if p >= 70.0 {
                (4.0, "First Class (1st)".to_string(), scale_max)
            } else if p >= 60.0 {
                (3.3, "Upper Second (2:1)".to_string(), scale_max)
            } else if p >= 50.0 {
                (2.7, "Lower Second (2:2)".to_string(), scale_max)
            } else if p >= 40.0 {
                (2.0, "Third Class (3rd)".to_string(), scale_max)
            } else {
                (0.0, "Fail".to_string(), scale_max)
            }
        }
        "ects" => {
            let scale_max = 4.0;
            if p >= 90.0 {
                (4.0, "A (Excellent)".to_string(), scale_max)
            } else if p >= 80.0 {
                (3.5, "B (Very Good)".to_string(), scale_max)
            } else if p >= 70.0 {
                (3.0, "C (Good)".to_string(), scale_max)
            } else if p >= 60.0 {
                (2.5, "D (Satisfactory)".to_string(), scale_max)
            } else if p >= 50.0 {
                (2.0, "E (Sufficient)".to_string(), scale_max)
            } else {
                (0.0, "F (Fail)".to_string(), scale_max)
            }
        }
        "percentage" | "percent" => (p, format!("{p:.1}%"), 100.0),
        // Default: "4.0" (US Scale)
        _ => {
            let scale_max = 4.0;
            if p >= 93.0 {
                (4.0, "A".to_string(), scale_max)
            } else if p >= 90.0 {
                (3.7, "A-".to_string(), scale_max)
            } else if p >= 87.0 {
                (3.3, "B+".to_string(), scale_max)
            } else if p >= 83.0 {
                (3.0, "B".to_string(), scale_max)
            } else if p >= 80.0 {
                (2.7, "B-".to_string(), scale_max)
            } else if p >= 77.0 {
                (2.3, "C+".to_string(), scale_max)
            } else if p >= 73.0 {
                (2.0, "C".to_string(), scale_max)
            } else if p >= 70.0 {
                (1.7, "C-".to_string(), scale_max)
            } else if p >= 67.0 {
                (1.3, "D+".to_string(), scale_max)
            } else if p >= 60.0 {
                (1.0, "D".to_string(), scale_max)
            } else {
                (0.0, "F".to_string(), scale_max)
            }
        }
    }
}

/// One graded assessment contribution, shared by the GPA engine and the
/// grade-target calculator so both apply the SAME weighting rules.
#[derive(Debug, Clone, Copy)]
pub struct GradedContribution {
    /// Achieved ÷ max, clamped to `0.0..=2.0` (a little extra credit allowed).
    pub ratio: f64,
    /// Points achieved on the item.
    pub achieved: f64,
    /// Points the item is worth.
    pub max: f64,
    /// The weight the course records for the item, when it records one.
    pub weight: Option<f64>,
}

/// Which weighting rule produced the course total.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WeightingMode {
    /// Nothing is graded yet.
    Empty,
    /// Every graded item is unweighted: the raw points decide the percentage.
    RawPoints,
    /// Every graded item carries an explicit weight.
    Explicit,
    /// Explicitly weighted and unweighted graded items are mixed.
    Mixed,
}

/// The resolved weighting of one course's graded items.
#[derive(Debug, Clone)]
pub struct CourseWeighting {
    /// The rule that produced the numbers below.
    pub mode: WeightingMode,
    /// The weight every graded item contributes under the rule in force.
    pub item_weights: Vec<f64>,
    /// Earned weight points under the rule in force.
    pub accumulated_points: f64,
    /// The course total weight under the rule in force.
    pub total_weightage: f64,
    /// The weighted percentage earned so far, rounded to ONE decimal.
    pub percentage: Option<f64>,
    /// The share every unweighted graded item received in the mixed case.
    pub unweighted_share: f64,
    /// The sum of the explicit weights of the graded items.
    pub explicit_sum: f64,
    /// How many graded items carry an explicit weight.
    pub explicit_count: usize,
    /// How many graded items have no explicit weight.
    pub unweighted_count: usize,
}

/// Resolves the course weighting from its graded items — the SINGLE source of
/// truth for the GPA percentage AND the Grade Center what-if projection
/// (`crate::plan::grade_target`), so the two views can never disagree.
///
/// The course's own rules, applied to the graded items only:
/// - no graded item -> no percentage;
/// - every graded item unweighted -> raw points (`Σ achieved / Σ max`);
/// - every graded item weighted -> `Σ (ratio × weight) / Σ weight`;
/// - mixed -> every unweighted item takes `(100 − Σ explicit weights) / count`
///   (or `Σ explicit weights / explicit count` when the explicit weights
///   already reach 100), so the course total is exactly 100.
///
/// Every percentage is rounded to ONE decimal, exactly like the GPA summary.
#[must_use]
pub fn resolve_course_weighting(items: &[GradedContribution]) -> CourseWeighting {
    let explicit_count = items.iter().filter(|i| i.weight.is_some()).count();
    let unweighted_count = items.len() - explicit_count;
    let explicit_sum: f64 = items.iter().filter_map(|i| i.weight).sum();

    let mode = if items.is_empty() {
        WeightingMode::Empty
    } else if explicit_count == 0 {
        WeightingMode::RawPoints
    } else if unweighted_count == 0 {
        WeightingMode::Explicit
    } else {
        WeightingMode::Mixed
    };

    let mut item_weights = Vec::with_capacity(items.len());
    let mut accumulated_points = 0.0;
    let mut total_weightage = 0.0;
    let mut unweighted_share = 0.0;

    match mode {
        WeightingMode::Empty => {}
        WeightingMode::RawPoints => {
            // All unweighted: the raw points fallback.
            accumulated_points = items.iter().map(|i| i.achieved).sum();
            total_weightage = items.iter().map(|i| i.max).sum();
            item_weights = items.iter().map(|i| i.max).collect();
        }
        WeightingMode::Explicit => {
            // All items have explicit weights.
            for item in items {
                let w = item.weight.unwrap_or(0.0);
                accumulated_points += item.ratio * w;
                total_weightage += w;
                item_weights.push(w);
            }
        }
        WeightingMode::Mixed => {
            // Mixed: the unweighted items split the course weight the
            // explicit weights leave behind (or their average weight when the
            // explicit weights already reach 100).
            unweighted_share = if explicit_sum < 100.0 {
                (100.0 - explicit_sum) / (unweighted_count as f64)
            } else {
                explicit_sum / (explicit_count as f64)
            };
            for item in items {
                let w = item.weight.unwrap_or(unweighted_share);
                accumulated_points += item.ratio * w;
                total_weightage += w;
                item_weights.push(w);
            }
        }
    }

    let percentage = if total_weightage > 0.0 {
        Some(((accumulated_points / total_weightage) * 100.0 * 10.0).round() / 10.0)
    } else {
        None
    };

    CourseWeighting {
        mode,
        item_weights,
        accumulated_points,
        total_weightage,
        percentage,
        unweighted_share,
        explicit_sum,
        explicit_count,
        unweighted_count,
    }
}

/// Calculates course grade progress and semester GPA across all enrolled courses.
#[must_use]
pub fn calculate_gpa(
    courses: &[Course],
    assessments: &[Assessment],
    grades: &HashMap<String, GradeRecord>,
    scale: &str,
) -> GpaSummary {
    let mut course_summaries = Vec::with_capacity(courses.len());
    let mut weighted_gpa_sum = 0.0;
    let mut graded_credits_sum = 0.0;
    let mut total_credits_sum = 0.0;
    let default_scale_max = match scale.trim().to_ascii_lowercase().as_str() {
        "percentage" | "percent" => 100.0,
        _ => 4.0,
    };
    let mut scale_max = default_scale_max;

    for course in courses {
        let credits = course.credits.unwrap_or(1.0).max(0.1);
        total_credits_sum += credits;

        // Find all assessments matching this course
        let matching_assessments: Vec<&Assessment> = assessments
            .iter()
            .filter(|a| {
                a.course_id
                    .as_deref()
                    .unwrap_or("")
                    .eq_ignore_ascii_case(&course.id)
            })
            .collect();

        let mut graded_items: Vec<GradedContribution> = Vec::new();

        for assessment in matching_assessments {
            let grade = grades.get(&assessment.id);
            let achieved = grade
                .and_then(|g| g.achieved_score)
                .or(assessment.achieved_score);
            let max = grade.and_then(|g| g.max_score).or(assessment.max_score);
            let weight = grade
                .and_then(|g| g.weightage_percent)
                .or(assessment.weightage_percent);

            if let (Some(ach), Some(mx)) = (achieved, max) {
                if mx > 0.0 {
                    let ratio = (ach / mx).clamp(0.0, 2.0); // allow slight extra credit
                    graded_items.push(GradedContribution {
                        ratio,
                        achieved: ach,
                        max: mx,
                        weight: weight.filter(|&w| w > 0.0),
                    });
                }
            }
        }

        // The ONE weighting rule the GPA summary and the Grade Center what-if
        // projection share, so the two views can never disagree.
        let weighting = resolve_course_weighting(&graded_items);
        let accumulated_points = weighting.accumulated_points;
        let total_weightage = weighting.total_weightage;
        let percentage = weighting.percentage;

        let (grade_point, letter_grade) = if let Some(p) = percentage {
            let (gp, letter, max_s) = evaluate_scale(p, scale);
            scale_max = max_s;
            weighted_gpa_sum += gp * credits;
            graded_credits_sum += credits;
            (Some(gp), Some(letter))
        } else {
            (None, None)
        };

        course_summaries.push(CourseGradeSummary {
            course_id: course.id.clone(),
            course_name: course.name.clone(),
            credits: course.credits,
            accumulated_points: (accumulated_points * 10.0).round() / 10.0,
            total_weightage: (total_weightage * 10.0).round() / 10.0,
            percentage,
            grade_point,
            letter_grade,
        });
    }

    let semester_gpa = if graded_credits_sum > 0.0 {
        Some(((weighted_gpa_sum / graded_credits_sum) * 100.0).round() / 100.0)
    } else {
        None
    };

    GpaSummary {
        scale: scale.to_string(),
        scale_max,
        total_credits: (total_credits_sum * 10.0).round() / 10.0,
        semester_gpa,
        courses: course_summaries,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AssessmentType;

    fn sample_course(id: &str, credits: Option<f64>) -> Course {
        Course {
            id: id.to_string(),
            name: format!("Course {id}"),
            color: "#4f46e5".to_string(),
            bg: None,
            border: None,
            credits,
            max_absences: None,
        }
    }

    fn sample_assessment(
        id: &str,
        course_id: &str,
        achieved: f64,
        max: f64,
        weight: f64,
    ) -> Assessment {
        let a = Assessment {
            id: id.to_string(),
            course_id: Some(course_id.to_string()),
            course_name: Some(format!("Course {course_id}")),
            title: format!("Quiz {id}"),
            assessment_type: AssessmentType::ClassQuiz,
            date: None,
            day_name: None,
            start_time: None,
            end_time: None,
            display_time: None,
            room: None,
            group: None,
            instructor: None,
            is_upcoming: false,
            days_until: None,
            urgency_level: crate::types::UrgencyLevel::Upcoming,
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
            source: crate::types::AssessmentSource::Custom,
            source_icon: None,
            weightage_percent: Some(weight),
            achieved_score: Some(achieved),
            max_score: Some(max),
            conflict_warning: None,
            last_seen_source_run: None,
            retired_source_run: None,
        };
        a
    }

    #[test]
    fn scale_evaluations_match_benchmarks() {
        // 4.0 scale
        assert_eq!(evaluate_scale(95.0, "4.0"), (4.0, "A".to_string(), 4.0));
        assert_eq!(evaluate_scale(91.0, "4.0"), (3.7, "A-".to_string(), 4.0));
        assert_eq!(evaluate_scale(85.0, "4.0"), (3.0, "B".to_string(), 4.0));
        assert_eq!(evaluate_scale(75.0, "4.0"), (2.0, "C".to_string(), 4.0));
        assert_eq!(evaluate_scale(62.0, "4.0"), (1.0, "D".to_string(), 4.0));
        assert_eq!(evaluate_scale(50.0, "4.0"), (0.0, "F".to_string(), 4.0));

        // UK Honours
        assert_eq!(
            evaluate_scale(75.0, "uk_honors"),
            (4.0, "First Class (1st)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(65.0, "uk_honors"),
            (3.3, "Upper Second (2:1)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(55.0, "uk_honors"),
            (2.7, "Lower Second (2:2)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(45.0, "uk_honors"),
            (2.0, "Third Class (3rd)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(35.0, "uk_honors"),
            (0.0, "Fail".to_string(), 4.0)
        );

        // ECTS
        assert_eq!(
            evaluate_scale(92.0, "ects"),
            (4.0, "A (Excellent)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(82.0, "ects"),
            (3.5, "B (Very Good)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(72.0, "ects"),
            (3.0, "C (Good)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(62.0, "ects"),
            (2.5, "D (Satisfactory)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(52.0, "ects"),
            (2.0, "E (Sufficient)".to_string(), 4.0)
        );
        assert_eq!(
            evaluate_scale(42.0, "ects"),
            (0.0, "F (Fail)".to_string(), 4.0)
        );

        // Percentage
        assert_eq!(
            evaluate_scale(88.4, "percentage"),
            (88.4, "88.4%".to_string(), 100.0)
        );
    }

    #[test]
    fn credit_weighted_gpa_calculation() {
        let courses = vec![
            sample_course("CS101", Some(3.0)), // gets 95% -> 4.0
            sample_course("CS102", Some(4.0)), // gets 85% -> 3.0
        ];
        let assessments = vec![
            sample_assessment("a1", "CS101", 95.0, 100.0, 100.0),
            sample_assessment("a2", "CS102", 85.0, 100.0, 100.0),
        ];
        let grades = HashMap::new();

        let summary = calculate_gpa(&courses, &assessments, &grades, "4.0");

        // (3.0 * 4.0 + 4.0 * 3.0) / (3.0 + 4.0) = (12.0 + 12.0) / 7.0 = 24.0 / 7.0 = 3.4285... -> 3.43
        assert_eq!(summary.total_credits, 7.0);
        assert_eq!(summary.semester_gpa, Some(3.43));
        assert_eq!(summary.courses.len(), 2);
        assert_eq!(summary.courses[0].percentage, Some(95.0));
        assert_eq!(summary.courses[0].grade_point, Some(4.0));
        assert_eq!(summary.courses[1].percentage, Some(85.0));
        assert_eq!(summary.courses[1].grade_point, Some(3.0));
    }

    #[test]
    fn scale_max_defaults_to_scale_ceiling_when_no_grades() {
        let courses = vec![sample_course("CS101", Some(3.0))];
        let summary_pct = calculate_gpa(&courses, &[], &HashMap::new(), "percentage");
        assert_eq!(summary_pct.scale_max, 100.0);
        assert_eq!(summary_pct.semester_gpa, None);

        let summary_4 = calculate_gpa(&courses, &[], &HashMap::new(), "4.0");
        assert_eq!(summary_4.scale_max, 4.0);
    }

    #[test]
    fn mixed_weights_do_not_drop_unweighted_assessments() {
        let courses = vec![sample_course("CS101", Some(3.0))];
        // Midterm: 80/100, weight 50%
        // Quiz: 100/100, unweighted (should be assigned remaining 50%)
        // Result: (0.80 * 50 + 1.0 * 50) / 100 = 90.0%
        let a1 = sample_assessment("a1", "CS101", 80.0, 100.0, 50.0);
        let mut a2 = sample_assessment("a2", "CS101", 100.0, 100.0, 0.0);
        a2.weightage_percent = None;

        let summary = calculate_gpa(&courses, &[a1, a2], &HashMap::new(), "4.0");
        assert_eq!(summary.courses[0].percentage, Some(90.0));
    }
}
