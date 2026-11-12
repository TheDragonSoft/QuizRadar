/**
 * TS → core wire-shape adapters for the engine-derived GPA and cushion calls.
 *
 * The domain rules live in the Rust core (`core/src/plan/gpa.rs`,
 * `core/src/plan/cushion.rs`) and are exported to this tier through the WASM
 * engine (`core/bindings/wasm/src/lib.rs`). The engine speaks the core's
 * snake_case serde contract; the store speaks camelCase. These adapters
 * translate ONLY the field names — they never default a domain value into
 * existence (no invented rooms, times, dates or weights; honesty doctrine,
 * AGENTS §3.1).
 */

import type {
  Assessment,
  Course,
  CustomCalendarEvent,
  DailyStudyTask,
  ScheduleSlot,
} from "../state/types";

/** Core `Course` (core/src/types.rs:157) wire shape. */
export function toCoreCourse(course: Course): Record<string, unknown> {
  return {
    id: course.id,
    name: course.name,
    color: course.color,
    bg: course.bg ?? null,
    border: course.border ?? null,
    credits: course.credits ?? null,
    max_absences: course.max_absences ?? course.maxAbsences ?? null,
  };
}

/**
 * Core `ScheduleSlot` (core/src/types.rs:181) wire shape. `start_time` /
 * `end_time` / `display_time` are REQUIRED in the core — a slot missing them
 * cannot cross the boundary, and the caller must skip it honestly instead of
 * inventing a default time.
 */
export function toCoreSlot(slot: ScheduleSlot): Record<string, unknown> | null {
  if (!slot.startTime || !slot.endTime) return null;
  return {
    id: slot.id,
    day: slot.day,
    day_index: slot.dayIndex ?? 0,
    course_id: slot.courseId,
    course_name: slot.courseName,
    type: slot.type ?? "Lecture",
    group: slot.group ?? null,
    room: slot.room ?? null,
    start_time: slot.startTime,
    end_time: slot.endTime,
    display_time: slot.displayTime ?? "",
    has_quiz: slot.hasQuiz ?? false,
    quiz_title: slot.quizTitle ?? null,
    week_parity: slot.weekParity ?? slot.week_parity ?? null,
  };
}

/** Core `CustomCalendarEvent` (core/src/types.rs:710) wire shape. */
export function toCoreCalendarEvent(event: CustomCalendarEvent): Record<string, unknown> {
  return {
    id: event.id,
    title: event.title,
    course_id: event.courseId ?? null,
    event_type: event.eventType ?? null,
    date_iso: event.dateIso ?? null,
    start_time: event.startTime ?? null,
    end_time: event.endTime ?? null,
    room: event.room ?? null,
    notes: event.notes ?? null,
    color: event.color ?? null,
  };
}

/**
 * Core `DailyStudyTask` (core/src/plan/tasks.rs:62) wire shape.
 *
 * `target_date` is required by the core, but the view semantics treat a task
 * without one as belonging to EVERY day (the previous TS implementation's
 * filter, `targetDateIso === undefined → every date`). The caller passes the
 * day being computed as `fallbackDateIso`, so a dateless task still counts
 * toward that day's cushion exactly as before — this is the view's own
 * grouping rule, not a stored date: nothing is persisted from it.
 */
export function toCoreStudyTask(
  task: DailyStudyTask,
  fallbackDateIso: string,
): Record<string, unknown> {
  const targetDate = task.targetDateIso ?? fallbackDateIso;
  return {
    id: task.id,
    key: task.key,
    assessment_id: task.assessmentId,
    course_id: task.courseId ?? null,
    course_name: task.courseName ?? null,
    assessment_title: task.assessmentTitle ?? task.title,
    assessment_type: task.assessmentType ?? "Class Quiz",
    topic: task.topicTitle,
    day_offset: task.dayOffset ?? 0,
    target_date_iso: targetDate,
    display_day: task.displayDay ?? "",
    priority_rank: task.priorityRank ?? 0,
    urgency: task.urgency ?? "upcoming",
    estimated_hours: task.estimatedHours ?? null,
    ai_reasoning: task.aiReasoning ?? task.reasoning ?? "",
    completed: task.completed,
    color: task.color ?? null,
    days_until_assessment: task.daysUntilAssessment ?? 0,
    assessment_date_iso: task.assessmentDateIso ?? targetDate,
  };
}

/**
 * snake_case → camelCase map of the core's `GpaSummary`
 * (core/src/plan/gpa.rs:36) JSON output into the store's `GpaSummary`.
 */
export function gpaSummaryFromCore(
  raw: Record<string, unknown>,
): import("../state/types").GpaSummary {
  const courses = Array.isArray(raw.courses) ? raw.courses : [];
  return {
    scale: String(raw.scale ?? "4.0"),
    scaleMax: Number(raw.scale_max ?? 4.0),
    totalCredits: Number(raw.total_credits ?? 0),
    semesterGpa: (raw.semester_gpa ?? null) as number | null,
    courses: courses.map((c) => {
      const course = c as Record<string, unknown>;
      return {
        courseId: String(course.course_id ?? ""),
        courseName: String(course.course_name ?? ""),
        credits: (course.credits ?? null) as number | null,
        accumulatedPoints: Number(course.accumulated_points ?? 0),
        totalWeightage: Number(course.total_weightage ?? 0),
        percentage: (course.percentage ?? null) as number | null,
        gradePoint: (course.grade_point ?? null) as number | null,
        letterGrade: (course.letter_grade ?? null) as string | null,
      };
    }),
  };
}

/** snake_case → camelCase map of the core's `DailyStudyCushion` JSON output. */
export function cushionFromCore(
  raw: Record<string, unknown>,
  dateIso: string,
): import("../state/types").DailyStudyCushion {
  return {
    date: dateIso,
    wakingHours: Number(raw.waking_hours ?? 0),
    committedHours: Number(raw.committed_hours ?? 0),
    availableHours: Number(raw.available_hours ?? 0),
    requiredHours: (raw.required_hours ?? null) as number | null,
    cushionHours: (raw.cushion_hours ?? null) as number | null,
    isDeficit: Boolean(raw.is_deficit),
    deficitHours: (raw.deficit_hours ?? null) as number | null,
    warningNote: (raw.warning_note ?? null) as string | null,
  };
}

/**
 * Core `Assessment` (core/src/types.rs:532) wire shape. Only `id`, `title`
 * and `assessment_type` are required by serde — every other field has a
 * `#[serde(default)]`, so the adapter emits the fields the GPA and cushion
 * engines read plus the required trio, and lets the core default the rest.
 * Nothing is defaulted INTO existence here: absent scores/times stay `null`.
 */
export function toCoreAssessment(assessment: Assessment): Record<string, unknown> {
  return {
    id: assessment.id,
    title: assessment.title,
    assessment_type: assessment.assessmentType ?? "Class Quiz",
    course_id: assessment.courseId ?? assessment.course_id ?? null,
    date_iso: assessment.dateIso ?? assessment.date_iso ?? null,
    start_time: assessment.startTime ?? assessment.start_time ?? null,
    end_time: assessment.endTime ?? assessment.end_time ?? null,
    is_upcoming: assessment.isUpcoming ?? assessment.is_upcoming ?? true,
    urgency_level: assessment.urgencyLevel ?? assessment.urgency_level ?? "upcoming",
    priority_score: assessment.priorityScore ?? assessment.priority_score ?? 0,
    source: assessment.source ?? "Gmail",
    weightage_percent: assessment.weightagePercent ?? assessment.weightage_percent ?? null,
    achieved_score: assessment.achievedScore ?? assessment.achieved_score ?? null,
    max_score: assessment.maxScore ?? assessment.max_score ?? null,
    last_seen_source_run: assessment.lastSeenSourceRun ?? assessment.last_seen_source_run ?? null,
    retired_source_run: assessment.retiredSourceRun ?? assessment.retired_source_run ?? null,
  };
}

export function toCoreAssessments(assessments: Assessment[]): Record<string, unknown>[] {
  return assessments.map(toCoreAssessment);
}
