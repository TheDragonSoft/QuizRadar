import type { Assessment } from "../state/types";

export interface WhatIfProjection {
  projectedAvg: number;
  gradedCount: number;
  isFirstGraded: boolean;
  scoreColorClass: string;
}

/**
 * Pure what-if projector arithmetic (v4 parity):
 * Computes the projected course percentage if this assessment scores `planScorePct`.
 * Uses only recorded grades for the same course; honest equal-weight assumption.
 */
export function calculateWhatIf(
  activeAssessment: Assessment,
  allAssessments: Assessment[],
  planScorePct: number,
): WhatIfProjection {
  const planPct = Math.min(100, Math.max(0, isNaN(planScorePct) ? 0 : planScorePct));

  const gradedElsewhere = allAssessments.filter(
    (x) =>
      x &&
      x.courseId === activeAssessment.courseId &&
      x.id !== activeAssessment.id &&
      x.achievedScore != null &&
      x.maxScore != null &&
      Number(x.maxScore) > 0,
  );

  const otherPcts = gradedElsewhere
    .map((x) => (Number(x.achievedScore) / Number(x.maxScore)) * 100)
    .filter((n) => Number.isFinite(n));

  const totalItems = otherPcts.length + 1;
  const sumScores = otherPcts.reduce((sum, n) => sum + n, 0) + planPct;
  const projected = Math.round(sumScores / totalItems);

  let scoreColorClass = "text-rose-700 dark:text-rose-400";
  if (projected >= 80) {
    scoreColorClass = "text-emerald-700 dark:text-emerald-400";
  } else if (projected >= 50) {
    scoreColorClass = "text-amber-700 dark:text-amber-400";
  }

  return {
    projectedAvg: projected,
    gradedCount: otherPcts.length,
    isFirstGraded: otherPcts.length === 0,
    scoreColorClass,
  };
}
