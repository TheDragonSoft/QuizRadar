/**
 * Shape adapter between the Rust core and the web tier.
 *
 * The core keeps v4's snake_case JSON schema (`course_id`, `date_iso`,
 * `start_time`, …) — that is the storage/backup contract and it does not
 * change. The web tier's view model is camelCase (`courseId`, `dateIso`,
 * `startTime`, …).
 *
 * Without an adapter the two sides silently disagree: the desktop shell
 * rejected every saved class with `missing field 'course_id'`, and the
 * returned schedule arrived with `course_id`/`day_index` keys the UI never
 * read — so the week calendar stayed empty even with an enrolled course.
 *
 * The adapter is deliberately symmetric and idempotent:
 *   - responses: every snake_case key gets its camelCase twin (and back),
 *   - requests: every camelCase key gets its snake_case twin (and back).
 *
 * Rust's serde ignores the unknown twin key, the WASM engine reads the
 * snake_case one, and the React components read the camelCase one — so the
 * same payload satisfies all three consumers without duplicating a schema.
 */

import type {
  Assessment,
  CustomCalendarEvent,
  GetStatePayload,
  ScheduleData,
  ScheduleSlot,
} from "./types";

type Rec = Record<string, unknown>;

/** camelCase <-> snake_case key twins used across the core's JSON shapes. */
const KEY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // Schedule slots
  ["dayIndex", "day_index"],
  ["courseId", "course_id"],
  ["courseName", "course_name"],
  ["startTime", "start_time"],
  ["endTime", "end_time"],
  ["displayTime", "display_time"],
  ["hasQuiz", "has_quiz"],
  ["quizTitle", "quiz_title"],
  // Assessments
  ["assessmentId", "assessment_id"],
  ["assessmentType", "assessment_type"],
  ["dateIso", "date_iso"],
  ["dayName", "day_name"],
  ["daysUntil", "days_until"],
  ["urgencyLevel", "urgency_level"],
  ["priorityScore", "priority_score"],
  ["weightagePercent", "weightage_percent"],
  ["achievedScore", "achieved_score"],
  ["maxScore", "max_score"],
  ["isUpcoming", "is_upcoming"],
  ["aiInferenceNote", "ai_inference_note"],
  ["aiStudyPlan", "ai_study_plan"],
  ["estimatedStudyHours", "estimated_study_hours"],
  ["elearningUrl", "elearning_url"],
  ["googleCalUrl", "google_cal_url"],
  ["gcalSynced", "gcal_synced"],
  ["gcalEventId", "gcal_event_id"],
  ["emailSubject", "email_subject"],
  ["emailSentDate", "email_sent_date"],
  ["sourceIcon", "source_icon"],
  ["conflictWarning", "conflict_warning"],
  ["lastSeenSourceRun", "last_seen_source_run"],
  ["retiredSourceRun", "retired_source_run"],
  // Dashboard summary
  ["referenceDate", "reference_date"],
  ["nextUp", "next_up"],
  ["upcomingThisWeek", "upcoming_this_week"],
  ["allUpcoming", "all_upcoming"],
  ["examTypeCounts", "exam_type_counts"],
  ["studyRecommendations", "study_recommendations"],
  ["totalTopicsCount", "total_topics_count"],
  ["completedTopicsCount", "completed_topics_count"],
  ["readinessPercent", "readiness_percent"],
  ["conflictAlerts", "conflict_alerts"],
  ["sourcesCount", "sources_count"],
  ["whyStudyNow", "why_study_now"],
  ["urgencyBadge", "urgency_badge"],
  ["progressPercent", "progress_percent"],
  ["topicIndex", "topic_index"],
  // Conflicts
  // The core's ConflictAlert spells these `assessment_id_a` / `gap_hours` —
  // the old twins (`assessment_a_id` / `hours_between`) were never sent, so
  // the conflict banner rendered "undefined and undefined" for every pair.
  ["assessmentAId", "assessment_id_a"],
  ["assessmentBId", "assessment_id_b"],
  ["titleA", "title_a"],
  ["titleB", "title_b"],
  ["courseA", "course_a"],
  ["courseB", "course_b"],
  ["dateA", "date_a"],
  ["dateB", "date_b"],
  ["hoursBetween", "gap_hours"],
  ["isMitigated", "is_mitigated"],
  // Study tasks
  ["dayOffset", "day_offset"],
  ["displayDay", "display_day"],
  ["isToday", "is_today"],
  ["totalEstimatedHours", "total_estimated_hours"],
  ["targetDateIso", "target_date_iso"],
  ["priorityRank", "priority_rank"],
  ["estimatedHours", "estimated_hours"],
  ["aiReasoning", "ai_reasoning"],
  ["daysUntilAssessment", "days_until_assessment"],
  ["assessmentDateIso", "assessment_date_iso"],
  ["assessmentTitle", "assessment_title"],
  ["readinessCards", "readiness_cards"],
  ["displayDate", "display_date"],
  ["completedCount", "completed_count"],
  ["totalCount", "total_count"],
  ["recommendedFocus", "recommended_focus"],
  ["totalTasks", "total_tasks"],
  ["pendingTasks", "pending_tasks"],
  ["completedTasks", "completed_tasks"],
  ["totalHours", "total_hours"],
  ["aiGenerated", "ai_generated"],
  // Custom calendar events
  ["eventType", "event_type"],
];

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Adds the missing twin key for every known alias pair (both directions). */
function aliasObject(source: Rec): Rec {
  const out: Rec = { ...source };
  for (const [camel, snake] of KEY_ALIASES) {
    if (out[camel] === undefined && out[snake] !== undefined) {
      out[camel] = out[snake];
    } else if (out[snake] === undefined && out[camel] !== undefined) {
      out[snake] = out[camel];
    }
  }
  return out;
}

/** Recursively aliases every object in a payload tree. */
export function aliasDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => aliasDeep(item)) as unknown as T;
  }
  if (isRecord(value)) {
    const out: Rec = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = aliasDeep(item);
    }
    return aliasObject(out) as unknown as T;
  }
  return value;
}

function asRec(value: unknown): Rec {
  return isRecord(value) ? value : {};
}

function toJsSlot(raw: unknown): Rec {
  const slot = aliasDeep(asRec(raw));
  // The core serializes the slot kind as `type`; keep `slotType` in sync too.
  if (slot.slotType === undefined && typeof slot.type === "string") {
    slot.slotType = slot.type;
  }
  return slot;
}

function toJsAssessment(raw: unknown): Rec {
  const assessment = aliasDeep(asRec(raw));
  // The core now serializes `UrgencyLevel` lower-case (serde rename_all),
  // matching the mirror's declared union. This fold is kept as an idempotent
  // safety net for payloads that predate the fix (old IDB rows, old backups).
  if (typeof assessment.urgencyLevel === "string") {
    assessment.urgencyLevel = assessment.urgencyLevel.toLowerCase();
  }
  return assessment;
}

function toJsRecommendation(raw: unknown): Rec {
  const rec = aliasDeep(asRec(raw));
  const topics = Array.isArray(rec.topics) ? rec.topics : [];
  rec.topics = topics.map((topic, index) => {
    const item = aliasDeep(asRec(topic));
    // The core calls the topic text `topic`; the UI calls it `title`.
    if (item.title === undefined && typeof item.topic === "string") {
      item.title = item.topic;
    }
    if (item.topicIndex === undefined) {
      item.topicIndex = index;
      // Keep the snake twin in sync here: the alias pass already ran, so the
      // next normalize call would otherwise grow a `topic_index` key that
      // this pass did not have (idempotence).
      if (item.topic_index === undefined) {
        item.topic_index = index;
      }
    }
    return item;
  });
  return rec;
}

function toJsDashboard(raw: unknown): Rec {
  const dashboard = aliasDeep(asRec(raw));
  const recommendations = Array.isArray(dashboard.studyRecommendations)
    ? dashboard.studyRecommendations
    : [];
  dashboard.studyRecommendations = recommendations.map(toJsRecommendation);
  return dashboard;
}

function toJsTask(raw: unknown): Rec {
  const task = aliasDeep(asRec(raw));
  // The core calls the topic text `topic`; the UI calls it `topicTitle`.
  if (task.topicTitle === undefined && typeof task.topic === "string") {
    task.topicTitle = task.topic;
  }
  // The core sends the *assessment's* title as `assessment_title` and the
  // planner's explanation as `ai_reasoning`; the roadmap row reads
  // `task.title` / `task.reasoning`. Without these two lines the roadmap
  // rendered an empty title and an empty reason on every row.
  if (task.title === undefined && typeof task.assessmentTitle === "string") {
    task.title = task.assessmentTitle;
  }
  if (task.reasoning === undefined && typeof task.aiReasoning === "string") {
    task.reasoning = task.aiReasoning;
  }
  return task;
}

function toJsDayGroup(raw: unknown): Rec {
  const day = aliasDeep(asRec(raw));
  // The core serializes the day as `date_iso`; the UI reads `date`.
  if (day.date === undefined && typeof day.date_iso === "string") {
    day.date = day.date_iso;
  }
  const tasks = Array.isArray(day.tasks) ? day.tasks : [];
  day.tasks = tasks.map(toJsTask);
  return day;
}

function toJsTasks(raw: unknown): Rec {
  const payload = aliasDeep(asRec(raw));
  const days = Array.isArray(payload.days) ? payload.days : [];
  payload.days = days.map(toJsDayGroup);
  return payload;
}

/**
 * Normalizes a state payload that came back from the desktop shell (or the
 * browser adapter) into the camelCase shape the React views read.
 */
export function normalizeStatePayload(payload: GetStatePayload): GetStatePayload {
  const source = asRec(payload);
  const schedule = asRec(source.schedule);
  const slots = Array.isArray(schedule.slots) ? schedule.slots : [];
  const config = asRec(source.config);
  const customEvents = Array.isArray(config.customEvents) ? config.customEvents : [];

  return {
    ...(source as unknown as GetStatePayload),
    // The shell serializes DesktopConfig camelCase, but its `customEvents`
    // entries are the CORE's structs — snake_case (`date_iso`, `start_time`).
    // Without aliasing them here the week calendar's `ev.dateIso` reads
    // undefined and no custom event or study block ever renders (desktop tier).
    config: {
      ...(config as unknown as GetStatePayload["config"]),
      customEvents: customEvents.map((event) =>
        aliasDeep(asRec(event)),
      ) as unknown as GetStatePayload["config"]["customEvents"],
    },
    schedule: {
      ...(schedule as unknown as ScheduleData),
      slots: slots.map(toJsSlot) as unknown as ScheduleSlot[],
    },
    assessments: (Array.isArray(source.assessments) ? source.assessments : []).map(
      toJsAssessment,
    ) as unknown as Assessment[],
    dashboard: toJsDashboard(source.dashboard) as unknown as GetStatePayload["dashboard"],
    studyTasksPayload: toJsTasks(
      source.studyTasksPayload,
    ) as unknown as GetStatePayload["studyTasksPayload"],
  };
}

/** True when a value looks like a full state payload (safe to normalize). */
export function isStatePayload(value: unknown): value is GetStatePayload {
  return isRecord(value) && ("schedule" in value || "dashboard" in value);
}

// ---------------------------------------------------------------------------
// Request direction — the desktop shell parses the core's snake_case schema.
// ---------------------------------------------------------------------------

/** A schedule the desktop shell can parse (snake_case twins included). */
export function toRustSchedule(schedule: ScheduleData): ScheduleData {
  return aliasDeep(schedule);
}

/** Slots the desktop shell can parse (snake_case twins included). */
export function toRustSlots(slots: ScheduleSlot[] | undefined): ScheduleSlot[] | undefined {
  if (!slots) return undefined;
  return aliasDeep(slots);
}

/** A custom event the desktop shell can parse (snake_case twins included). */
export function toRustEvent(event: CustomCalendarEvent): CustomCalendarEvent {
  return aliasDeep(event);
}
