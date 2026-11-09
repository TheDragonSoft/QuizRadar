/**
 * GPA and Course Grade Center calculation engine (01 §4.2, R2).
 *
 * Implements deterministic grading scale evaluations and credit-weighted GPA calculation
 * matching core/src/plan/gpa.rs:
 * - "4.0": US standard scale (A: 4.0 ... F: 0.0)
 * - "uk_honors": UK First Class Honours (>=70% First Class, 60-69% 2:1, 50-59% 2:2, 40-49% 3rd, <40% Fail)
 * - "ects": European Credit Transfer System (A: 4.0, B: 3.5, C: 3.0, D: 2.5, E: 2.0, F: 0.0)
 * - "percentage": 0.0 to 100.0% raw percentage
 */

import type { Assessment, Course, CourseGradeSummary, GpaSummary } from "../state/types";

export type GradingScaleKey = "4.0" | "uk_honors" | "ects" | "percentage";

export interface ScaleEvaluation {
  gradePoint: number;
  letterGrade: string;
  scaleMax: number;
}

/**
 * Evaluates a percentage grade (0-100) according to the selected grading scale.
 */
export function evaluateScale(percentage: number, scale: string = "4.0"): ScaleEvaluation {
  const p = Math.max(0, Math.min(100, percentage));
  const normalizedScale = scale.trim().toLowerCase();

  switch (normalizedScale) {
    case "uk_honors":
    case "uk": {
      const scaleMax = 4.0;
      if (p >= 70.0) return { gradePoint: 4.0, letterGrade: "First Class (1st)", scaleMax };
      if (p >= 60.0) return { gradePoint: 3.3, letterGrade: "Upper Second (2:1)", scaleMax };
      if (p >= 50.0) return { gradePoint: 2.7, letterGrade: "Lower Second (2:2)", scaleMax };
      if (p >= 40.0) return { gradePoint: 2.0, letterGrade: "Third Class (3rd)", scaleMax };
      return { gradePoint: 0.0, letterGrade: "Fail", scaleMax };
    }
    case "ects": {
      const scaleMax = 4.0;
      if (p >= 90.0) return { gradePoint: 4.0, letterGrade: "A (Excellent)", scaleMax };
      if (p >= 80.0) return { gradePoint: 3.5, letterGrade: "B (Very Good)", scaleMax };
      if (p >= 70.0) return { gradePoint: 3.0, letterGrade: "C (Good)", scaleMax };
      if (p >= 60.0) return { gradePoint: 2.5, letterGrade: "D (Satisfactory)", scaleMax };
      if (p >= 50.0) return { gradePoint: 2.0, letterGrade: "E (Sufficient)", scaleMax };
      return { gradePoint: 0.0, letterGrade: "F (Fail)", scaleMax };
    }
    case "percentage":
    case "percent": {
      const rounded = Math.round(p * 10) / 10;
      return { gradePoint: rounded, letterGrade: `${rounded.toFixed(1)}%`, scaleMax: 100.0 };
    }
    default: {
      // US 4.0 standard scale
      const scaleMax = 4.0;
      if (p >= 93.0) return { gradePoint: 4.0, letterGrade: "A", scaleMax };
      if (p >= 90.0) return { gradePoint: 3.7, letterGrade: "A-", scaleMax };
      if (p >= 87.0) return { gradePoint: 3.3, letterGrade: "B+", scaleMax };
      if (p >= 83.0) return { gradePoint: 3.0, letterGrade: "B", scaleMax };
      if (p >= 80.0) return { gradePoint: 2.7, letterGrade: "B-", scaleMax };
      if (p >= 77.0) return { gradePoint: 2.3, letterGrade: "C+", scaleMax };
      if (p >= 73.0) return { gradePoint: 2.0, letterGrade: "C", scaleMax };
      if (p >= 70.0) return { gradePoint: 1.7, letterGrade: "C-", scaleMax };
      if (p >= 67.0) return { gradePoint: 1.3, letterGrade: "D+", scaleMax };
      if (p >= 60.0) return { gradePoint: 1.0, letterGrade: "D", scaleMax };
      return { gradePoint: 0.0, letterGrade: "F", scaleMax };
    }
  }
}

export interface AssessmentGradeValues {
  achievedScore?: number | null;
  maxScore?: number | null;
  weightagePercent?: number | null;
}

/**
 * Calculates grade progress and semester GPA across all enrolled courses.
 */
export function calculateGpa(
  courses: Course[],
  assessments: Assessment[],
  grades?: Record<string, AssessmentGradeValues>,
  scale: string = "4.0",
): GpaSummary {
  const courseSummaries: CourseGradeSummary[] = [];
  let weightedGpaSum = 0.0;
  let gradedCreditsSum = 0.0;
  let totalCreditsSum = 0.0;
  const defaultScaleMax =
    scale.trim().toLowerCase() === "percentage" || scale.trim().toLowerCase() === "percent"
      ? 100.0
      : 4.0;
  let scaleMax = defaultScaleMax;

  for (const course of courses) {
    const credits = course.credits !== undefined && course.credits !== null ? Math.max(0.1, course.credits) : 1.0;
    totalCreditsSum += credits;

    const matchingAssessments = assessments.filter(
      (a) =>
        (a.courseId && a.courseId.toLowerCase() === course.id.toLowerCase()) ||
        (a.course_id && a.course_id.toLowerCase() === course.id.toLowerCase()),
    );

    interface GradedItem {
      ratio: number;
      achieved: number;
      max: number;
      weight?: number;
    }

    const gradedItems: GradedItem[] = [];

    for (const assessment of matchingAssessments) {
      const grade = grades?.[assessment.id];
      const achieved = grade?.achievedScore ?? assessment.achievedScore ?? assessment.achieved_score;
      const max = grade?.maxScore ?? assessment.maxScore ?? assessment.max_score;
      const weight = grade?.weightagePercent ?? assessment.weightagePercent ?? assessment.weightage_percent;

      if (achieved !== undefined && achieved !== null && max !== undefined && max !== null && max > 0) {
        const ratio = Math.max(0, Math.min(2.0, achieved / max));
        gradedItems.push({
          ratio,
          achieved,
          max,
          weight: weight !== undefined && weight !== null && weight > 0 ? weight : undefined,
        });
      }
    }

    let accumulatedPoints = 0.0;
    let totalWeightage = 0.0;
    let percentage: number | null = null;

    if (gradedItems.length > 0) {
      const explicitWeights = gradedItems.filter((g) => g.weight !== undefined);
      const unweightedCount = gradedItems.length - explicitWeights.length;

      if (explicitWeights.length === 0) {
        // All unweighted: raw points fallback
        const rawAchieved = gradedItems.reduce((acc, g) => acc + g.achieved, 0);
        const rawMax = gradedItems.reduce((acc, g) => acc + g.max, 0);
        accumulatedPoints = rawAchieved;
        totalWeightage = rawMax;
        if (rawMax > 0) {
          percentage = Math.round((rawAchieved / rawMax) * 1000) / 10;
        }
      } else if (unweightedCount === 0) {
        // All weighted
        for (const item of gradedItems) {
          const w = item.weight ?? 0;
          accumulatedPoints += item.ratio * w;
          totalWeightage += w;
        }
        if (totalWeightage > 0) {
          percentage = Math.round((accumulatedPoints / totalWeightage) * 1000) / 10;
        }
      } else {
        // Mixed: some have explicit weights, some do not.
        // Distribute remaining (or average) weight to unweighted items so they are not dropped.
        const explicitSum = explicitWeights.reduce((acc, g) => acc + (g.weight ?? 0), 0);
        const unweightedWeight =
          explicitSum < 100.0
            ? (100.0 - explicitSum) / unweightedCount
            : explicitSum / explicitWeights.length;

        for (const item of gradedItems) {
          const w = item.weight ?? unweightedWeight;
          accumulatedPoints += item.ratio * w;
          totalWeightage += w;
        }
        if (totalWeightage > 0) {
          percentage = Math.round((accumulatedPoints / totalWeightage) * 1000) / 10;
        }
      }
    }

    let gradePoint: number | null = null;
    let letterGrade: string | null = null;

    if (percentage !== null) {
      const evaluation = evaluateScale(percentage, scale);
      scaleMax = evaluation.scaleMax;
      gradePoint = evaluation.gradePoint;
      letterGrade = evaluation.letterGrade;
      weightedGpaSum += gradePoint * credits;
      gradedCreditsSum += credits;
    }

    const accPts = Math.round(accumulatedPoints * 10) / 10;
    const totWgt = Math.round(totalWeightage * 10) / 10;

    courseSummaries.push({
      courseId: course.id,
      courseName: course.name,
      credits: course.credits ?? null,
      accumulatedPoints: accPts,
      totalWeightage: totWgt,
      percentage,
      gradePoint,
      letterGrade,
      course_id: course.id,
      course_name: course.name,
      accumulated_points: accPts,
      total_weightage: totWgt,
      grade_point: gradePoint,
      letter_grade: letterGrade,
    });
  }

  const semesterGpa =
    gradedCreditsSum > 0 ? Math.round((weightedGpaSum / gradedCreditsSum) * 100) / 100 : null;

  return {
    scale,
    scaleMax,
    totalCredits: Math.round(totalCreditsSum * 10) / 10,
    semesterGpa,
    courses: courseSummaries,
    scale_max: scaleMax,
    total_credits: Math.round(totalCreditsSum * 10) / 10,
    semester_gpa: semesterGpa,
  };
}

/**
 * Returns points breakdown for horizontal progress bar rendering:
 * - securedPercent: percentage of secured points earned relative to 100%
 * - pendingPercent: percentage of remaining weight not yet assessed
 * - passingThreshold: target passing grade line (e.g. 60% US / 70% UK 1st)
 */
export function getAccumulatedPointsBreakdown(
  accumulatedPoints: number,
  totalWeightage: number,
  scale: string = "4.0",
): {
  securedPercent: number;
  pendingPercent: number;
  unassignedPercent: number;
  passingThresholdPercent: number;
} {
  const securedPercent = Math.max(0, Math.min(100, Math.round(accumulatedPoints * 10) / 10));
  const evaluatedWeight = Math.max(0, Math.min(100, Math.round(totalWeightage * 10) / 10));
  const pendingPercent = Math.max(0, Math.round((evaluatedWeight - accumulatedPoints) * 10) / 10);
  const unassignedPercent = Math.max(0, Math.round((100 - evaluatedWeight) * 10) / 10);

  const passingThresholdPercent = scale === "uk_honors" || scale === "uk" ? 70.0 : 60.0;

  return {
    securedPercent,
    pendingPercent,
    unassignedPercent,
    passingThresholdPercent,
  };
}
