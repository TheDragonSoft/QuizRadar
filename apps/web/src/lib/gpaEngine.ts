/**
 * Engine-derived GPA (01 §4.2, R2).
 *
 * The grading-scale tables, clamps and credit-weighted math live in exactly
 * one place: `core/src/plan/gpa.rs`, reached here through the WASM engine's
 * `calculate_gpa` export (`core/bindings/wasm/src/lib.rs:284`). This module
 * is only the async bridge + wire mapping — no scale logic lives in TS, so
 * the two tiers can never drift again.
 */

import { getWasmEngine } from "../pwadapters/wasmBridge";
import type { Assessment, Course, CourseGradeSummary, GpaSummary } from "../state/types";
import { gpaSummaryFromCore, toCoreAssessments, toCoreCourse } from "./coreWire";

/** One recorded grade, as the store keeps it (`02` §3.2). */
export interface AssessmentGradeValues {
  achievedScore?: number | null;
  maxScore?: number | null;
  weightagePercent?: number | null;
}

/**
 * Calculates course grade progress and semester GPA across all enrolled
 * courses, exactly as the Rust core does. Async because the WASM engine
 * initializes on first use; callers should hold the last good summary while
 * a re-computation is in flight.
 */
export async function calculateGpaCore(
  courses: Course[],
  assessments: Assessment[],
  grades?: Record<string, AssessmentGradeValues>,
  scale: string = "4.0",
): Promise<GpaSummary> {
  const engine = await getWasmEngine();

  const gradesPayload: Record<string, Record<string, number | null>> = {};
  for (const [assessmentId, grade] of Object.entries(grades ?? {})) {
    gradesPayload[assessmentId] = {
      achieved_score: grade.achievedScore ?? null,
      max_score: grade.maxScore ?? null,
      weightage_percent: grade.weightagePercent ?? null,
    };
  }

  const raw = engine.calculate_gpa(
    JSON.stringify(courses.map(toCoreCourse)),
    JSON.stringify(toCoreAssessments(assessments)),
    JSON.stringify(gradesPayload),
    scale,
  );
  return gpaSummaryFromCore(JSON.parse(raw) as Record<string, unknown>);
}

/** An honest empty summary: nothing computed yet, nothing invented. */
export function emptyGpaSummary(scale: string = "4.0"): GpaSummary {
  const scaleMax = scale.trim().toLowerCase().startsWith("percentage") ? 100.0 : 4.0;
  const courses: CourseGradeSummary[] = [];
  return {
    scale,
    scaleMax,
    totalCredits: 0,
    semesterGpa: null,
    courses,
  };
}
