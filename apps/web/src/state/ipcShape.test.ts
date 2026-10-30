import { describe, it, expect, beforeEach } from "vitest";
import {
  aliasDeep,
  normalizeStatePayload,
  isStatePayload,
  toRustEvent,
  toRustSchedule,
  toRustSlots,
} from "./ipcShape";
import { setRpcMockHandler } from "./rpc";
import { useAppStore, initialFullState } from "./store";
import type { GetStatePayload, ScheduleSlot } from "./types";

/**
 * The desktop shell speaks the core's snake_case JSON (`course_id`,
 * `day_index`, `date_iso`, …) while the React views read camelCase. These
 * tests pin the adapter that bridges the two — the bug that made "add a
 * class" fail (`missing field 'course_id'`) and left the week calendar
 * permanently empty.
 */

const desktopSlot = {
  id: "slot-1",
  day: "Friday",
  day_index: 5,
  course_id: "CSE241",
  course_name: "Digital Design",
  type: "Lecture",
  group: "Sec 1",
  room: "Room 301",
  start_time: "09:00",
  end_time: "10:30",
  display_time: "09:00 – 10:30",
  has_quiz: false,
  quiz_title: null,
};

const desktopPayload = {
  config: { onboarding_completed: true, google_client_id: null, teams_client_id: null },
  auth: { authenticated: false, has_teams_auth: false },
  schedule: {
    semester: "Fall 2026",
    courses: [{ id: "CSE241", name: "Digital Design", color: "#1a73e8" }],
    slots: [desktopSlot],
  },
  assessments: [
    {
      id: "gmail-1",
      course_id: "CSE241",
      course_name: "Digital Design",
      title: "Quiz 1",
      assessment_type: "Class Quiz",
      date_iso: "2026-10-23",
      start_time: "09:00",
      end_time: "09:45",
      room: null,
      is_upcoming: true,
      days_until: 2,
      urgency_level: "critical",
      priority_score: 85,
      topics: [],
    },
  ],
  dashboard: {
    reference_date: "2026-10-21",
    next_up: null,
    upcoming_this_week: [],
    all_upcoming: [],
    exam_type_counts: {},
    study_recommendations: [],
    total_topics_count: 0,
    completed_topics_count: 0,
    readiness_percent: 0,
    conflict_alerts: [],
    sources_count: {},
  },
  studyTasksPayload: { days: [], total_tasks: 0, pending_tasks: 0, completed_tasks: 0 },
};

describe("ipcShape — core ↔ web contract", () => {
  beforeEach(() => {
    setRpcMockHandler(null);
  });

  it("recognizes a desktop state payload", () => {
    expect(isStatePayload(desktopPayload)).toBe(true);
    expect(isStatePayload({ ok: true })).toBe(false);
  });

  it("normalizes a snake_case desktop payload into the camelCase shape the UI reads", () => {
    const normalized = normalizeStatePayload(desktopPayload as unknown as GetStatePayload);

    const slot = normalized.schedule.slots[0] as unknown as Record<string, unknown>;
    expect(slot.dayIndex).toBe(5);
    expect(slot.courseId).toBe("CSE241");
    expect(slot.courseName).toBe("Digital Design");
    expect(slot.startTime).toBe("09:00");
    expect(slot.endTime).toBe("10:30");
    expect(slot.displayTime).toBe("09:00 – 10:30");
    expect(slot.hasQuiz).toBe(false);

    const assessment = normalized.assessments[0] as unknown as Record<string, unknown>;
    expect(assessment.courseId).toBe("CSE241");
    expect(assessment.assessmentType).toBe("Class Quiz");
    expect(assessment.dateIso).toBe("2026-10-23");
    expect(assessment.daysUntil).toBe(2);
  });

  it("is idempotent: normalizing twice changes nothing", () => {
    const once = normalizeStatePayload(desktopPayload as unknown as GetStatePayload);
    const twice = normalizeStatePayload(once);
    expect(twice.schedule.slots[0]).toEqual(once.schedule.slots[0]);
  });

  it("adds snake_case twins to outgoing slot payloads (what the core parses)", () => {
    const camelSlot: ScheduleSlot = {
      id: "slot-1",
      day: "Friday",
      dayIndex: 5,
      courseId: "CSE241",
      courseName: "Digital Design",
      type: "Lecture",
      room: "Room 301",
      startTime: "09:00",
      endTime: "10:30",
      displayTime: "09:00 – 10:30",
    };

    const [rustSlot] = toRustSlots([camelSlot]) as unknown as Record<string, unknown>[];
    expect(rustSlot.course_id).toBe("CSE241");
    expect(rustSlot.course_name).toBe("Digital Design");
    expect(rustSlot.day_index).toBe(5);
    expect(rustSlot.start_time).toBe("09:00");
    expect(rustSlot.end_time).toBe("10:30");
    expect(rustSlot.display_time).toBe("09:00 – 10:30");
    // The core's wire name for the slot kind stays `type`.
    expect(rustSlot.type).toBe("Lecture");
  });

  it("adds the snake_case date twin to custom events", () => {
    const rustEvent = toRustEvent({
      id: "custom-1",
      title: "Study Session",
      eventType: "Study Session",
      dateIso: "2026-10-23",
      startTime: "18:00",
      endTime: "19:30",
      room: null,
    }) as unknown as Record<string, unknown>;

    expect(rustEvent.date_iso).toBe("2026-10-23");
    expect(rustEvent.event_type).toBe("Study Session");
    expect(rustEvent.start_time).toBe("18:00");
  });

  it("keeps a schedule round-trippable", () => {
    const schedule = {
      semester: "Fall 2026",
      courses: [{ id: "CSE241", name: "Digital Design", color: "#1a73e8" }],
      slots: [desktopSlot],
    };
    const rust = toRustSchedule(schedule as never) as unknown as Record<string, unknown>;
    const slots = rust.slots as Record<string, unknown>[];
    expect(slots[0].course_id).toBe("CSE241");
    expect(slots[0].day_index).toBe(5);
  });

  it("aliases nested objects without touching unrelated keys", () => {
    const aliased = aliasDeep({ nested: { course_id: "CSE241" }, untouched: "value" }) as Record<
      string,
      unknown
    >;
    const nested = aliased.nested as Record<string, unknown>;
    expect(nested.courseId).toBe("CSE241");
    expect(aliased.untouched).toBe("value");
  });
});

describe("store → desktop round trip", () => {
  beforeEach(() => {
    setRpcMockHandler(null);
    useAppStore.setState({ data: JSON.parse(JSON.stringify(initialFullState)) });
  });

  it("sends snake_case twins and stores the normalized schedule after saving a class", async () => {
    const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];

    setRpcMockHandler(<T>(fn: string, args?: Record<string, unknown>): Promise<T> | null => {
      calls.push({ fn, args });
      if (fn === "upsert_course") {
        // The desktop shell answers with the core's snake_case payload.
        return Promise.resolve(desktopPayload as unknown as T);
      }
      return null;
    });

    await useAppStore
      .getState()
      .upsertCourse({ id: "CSE241", name: "Digital Design", color: "#1a73e8" }, [
        {
          id: "slot-1",
          day: "Friday",
          dayIndex: 5,
          courseId: "CSE241",
          courseName: "Digital Design",
          type: "Lecture",
          room: "Room 301",
          startTime: "09:00",
          endTime: "10:30",
          displayTime: "09:00 – 10:30",
        },
      ]);

    const upsert = calls.find((c) => c.fn === "upsert_course");
    expect(upsert).toBeTruthy();
    const sentSlots = (upsert?.args?.slots as Record<string, unknown>[]) ?? [];
    expect(sentSlots[0].course_id).toBe("CSE241");
    expect(sentSlots[0].day_index).toBe(5);
    expect(sentSlots[0].start_time).toBe("09:00");

    // The store now holds the camelCase shape the calendar reads.
    const storedSlot = useAppStore.getState().data.schedule.slots[0];
    expect(storedSlot.courseId).toBe("CSE241");
    expect(storedSlot.dayIndex).toBe(5);
    expect(storedSlot.startTime).toBe("09:00");
  });

  it("keeps the browser tier's slot persistence honest (slots are not dropped)", async () => {
    // The browser adapter used to drop the slots on `upsert_course`, so a
    // saved class never appeared in the week calendar.
    const { setupMockIndexedDb } = await import("../test/mockIndexedDb");
    const { pwaRpcHandler } = await import("../pwadapters/rpcAdapter");
    const teardownIdb = setupMockIndexedDb();

    try {
      const state = await pwaRpcHandler<GetStatePayload>("upsert_course", {
        course: { id: "CSE241", name: "Digital Design", color: "#1a73e8" },
        slots: [
          {
            id: "slot-1",
            day: "Friday",
            dayIndex: 5,
            courseId: "CSE241",
            courseName: "Digital Design",
            type: "Lecture",
            room: "Room 301",
            startTime: "09:00",
            endTime: "10:30",
            displayTime: "09:00 – 10:30",
          },
        ],
      });

      expect(state.schedule.courses.map((c) => c.id)).toContain("CSE241");
      expect(state.schedule.slots).toHaveLength(1);
      expect(state.schedule.slots[0].courseId).toBe("CSE241");
      expect(state.schedule.slots[0].dayIndex).toBe(5);
      expect(state.schedule.slots[0].startTime).toBe("09:00");
    } finally {
      teardownIdb();
    }
  });
});

// Sweep regression (2026-10-29): the desktop shell returns customEvents as
// the core's snake_case structs nested inside the camelCase DesktopConfig.
// Without normalization here, CalendarView's `ev.dateIso === dateIso` reads
// undefined and no custom event or auto study block ever renders.
describe("normalizeStatePayload: config.customEvents", () => {
  it("aliases the core's snake_case event keys inside the camelCase config", () => {
    const payload = {
      ...initialFullState,
      config: {
        ...initialFullState.config,
        customEvents: [
          {
            id: "custom-1",
            title: "QA Session",
            course_id: "GSE211",
            event_type: "Study Session",
            date_iso: "2026-10-29",
            start_time: "10:00",
            end_time: "11:30",
            room: null,
            notes: null,
            color: null,
          },
        ],
      },
    } as unknown as GetStatePayload;

    const state = normalizeStatePayload(payload);
    const event = state.config.customEvents[0];
    expect(event.dateIso).toBe("2026-10-29");
    expect(event.startTime).toBe("10:00");
    expect(event.endTime).toBe("11:30");
    expect(event.eventType).toBe("Study Session");
    expect(event.courseId).toBe("GSE211");
  });
});
