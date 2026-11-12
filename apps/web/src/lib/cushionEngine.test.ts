import { describe, it, expect } from "vitest";
import { calculateDailyStudyCushionCore } from "./cushionEngine";
import type { CustomCalendarEvent, DailyStudyTask, ScheduleSlot } from "../state/types";

/**
 * Golden cases for the ENGINE-derived study cushion (`lib/cushionEngine.ts`
 * → `core/src/plan/cushion.rs` via WASM). These are the ported assertions of
 * the former TS duplicate (`lib/cushionCalculator.ts`), so the TS-tier
 * golden coverage survives the deduplication — now they pin the CORE as the
 * single implementation against the same benchmarks the Rust unit tests
 * (`core/src/plan/cushion.rs` tests) assert.
 */
describe("cushionEngine — core-derived study capacity and deficit detection", () => {
  const sampleSlot: ScheduleSlot = {
    id: "slot-1",
    day: "Monday",
    dayIndex: 1,
    courseId: "CS101",
    courseName: "CS101",
    type: "Lecture",
    startTime: "09:00",
    endTime: "12:00", // 3.0 hours
    displayTime: "09:00 - 12:00",
    weekParity: "all",
  };

  const sampleEvent: CustomCalendarEvent = {
    id: "event-1",
    title: "Team Meeting",
    dateIso: "2026-10-19",
    startTime: "14:00",
    endTime: "15:30", // 1.5 hours
  };

  const task = (overrides: Partial<DailyStudyTask>): DailyStudyTask => ({
    id: "t1",
    key: "t1",
    assessmentId: "a1",
    title: "Study Chapter 1",
    topicTitle: "Chapter 1",
    topicIndex: 0,
    dayOffset: 0,
    targetDateIso: "2026-10-19",
    priorityRank: 1,
    completed: false,
    reasoning: "Review concepts",
    ...overrides,
  });

  it("calculates healthy study cushion when available time exceeds tasks", async () => {
    // 2026-10-19 is Monday
    // Committed: 3.0h (slot) + 1.5h (event) = 4.5h
    // Available: 15.0 - 4.5 = 10.5h; Tasks: 2.0h + 1.5h = 3.5h → +7.0h cushion
    const tasks = [
      task({ estimatedHours: 2.0 }),
      task({ id: "t2", key: "t2", estimatedHours: 1.5 }),
    ];

    const cushion = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [sampleSlot],
      [sampleEvent],
      [],
      tasks,
      15.0,
    );

    expect(cushion.committedHours).toBe(4.5);
    expect(cushion.availableHours).toBe(10.5);
    expect(cushion.requiredHours).toBe(3.5);
    expect(cushion.cushionHours).toBe(7.0);
    expect(cushion.isDeficit).toBe(false);
    expect(cushion.deficitHours).toBeNull();
  });

  it("detects study deficit when tasks exceed available hours", async () => {
    const heavyTasks = [task({ estimatedHours: 12.0, reasoning: "Exam tomorrow" })];

    const cushion = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [sampleSlot],
      [sampleEvent],
      [],
      heavyTasks,
      15.0,
    );

    expect(cushion.availableHours).toBe(10.5);
    expect(cushion.requiredHours).toBe(12.0);
    expect(cushion.cushionHours).toBe(-1.5);
    expect(cushion.isDeficit).toBe(true);
    expect(cushion.deficitHours).toBe(1.5);
    expect(cushion.warningNote).toContain("Study deficit of 1.5h detected");
  });

  it("withholds cushion honestly when any task lacks an estimate", async () => {
    const unestimatedTasks = [task({ estimatedHours: null })];

    const cushion = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [sampleSlot],
      [],
      [],
      unestimatedTasks,
      15.0,
    );

    expect(cushion.requiredHours).toBeNull();
    expect(cushion.cushionHours).toBeNull();
    expect(cushion.isDeficit).toBe(false);
    expect(cushion.warningNote).toBe(
      "Cushion calculation unavailable: 1 task lacks hour estimates",
    );
  });

  it("merges overlapping commitments as interval union without untimed fabrication", async () => {
    // Slot: 09:00-12:00 (3.0h); Exam: 11:00-13:00 → union 09:00-13:00 (4.0h);
    // Custom event: 14:00-15:30 (1.5h). Total 5.5h, NOT 8.5h.
    const untimedAssessment = {
      id: "a-untimed",
      title: "Homework Due",
      courseId: "CS101",
      assessmentType: "Assignment",
      dateIso: "2026-10-19",
      isUpcoming: true,
      urgencyLevel: "upcoming" as const,
      priorityScore: 50,
      topics: [],
      warnings: [],
      source: "CUSTOM",
    };

    const cushion = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [sampleSlot],
      [sampleEvent],
      [
        untimedAssessment,
        { ...untimedAssessment, id: "a-timed", startTime: "11:00", endTime: "13:00" },
      ],
      [],
      15.0,
    );

    expect(cushion.committedHours).toBe(5.5);
    expect(cushion.availableHours).toBe(9.5);
  });

  it("honors week parity when matching timetable slots", async () => {
    // 2026-10-19 is Monday of ISO week 43 (odd → week_a).
    const weekASlot: ScheduleSlot = { ...sampleSlot, weekParity: "week_a" };
    const weekBSlot: ScheduleSlot = { ...sampleSlot, weekParity: "week_b" };

    const withA = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [weekASlot],
      [],
      [],
      [task({ estimatedHours: 1.0 })],
      15.0,
    );
    expect(withA.committedHours).toBe(3.0);

    const withB = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [weekBSlot],
      [],
      [],
      [task({ estimatedHours: 1.0 })],
      15.0,
    );
    expect(withB.committedHours).toBe(0.0);
  });

  it("skips a time-less slot instead of inventing a default time", async () => {
    // Honesty doctrine (AGENTS §3.1): missing times are never defaulted — a
    // slot the user has not timed yet cannot silently cost study capacity.
    const timelessSlot: ScheduleSlot = {
      ...sampleSlot,
      startTime: "" as unknown as string,
      endTime: "" as unknown as string,
    };

    const cushion = await calculateDailyStudyCushionCore(
      "2026-10-19",
      [timelessSlot],
      [],
      [],
      [task({ estimatedHours: 1.0 })],
      15.0,
    );
    expect(cushion.committedHours).toBe(0.0);
    expect(cushion.availableHours).toBe(15.0);
  });
});
