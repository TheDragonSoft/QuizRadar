/**
 * View-side GPA rendering helper (01 §4.2, R2).
 *
 * The GPA DOMAIN RULES (grading scales, clamps, credit-weighted semester
 * math) live in the Rust core (`core/src/plan/gpa.rs`) and are reached
 * through the WASM engine via `lib/gpaEngine.ts` — this module used to
 * duplicate them line-for-line and was removed so the tiers cannot drift.
 *
 * What remains is pure progress-bar VIEW math with no Rust counterpart:
 * `getAccumulatedPointsBreakdown` turns an already-computed course summary
 * into percentage segments for the horizontal secured/pending bar.
 */

export interface AssessmentGradeValues {
  achievedScore?: number | null;
  maxScore?: number | null;
  weightagePercent?: number | null;
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
