import { describe, it, expect } from "vitest";
import { calculateDailyStudyCushion } from "./cushionCalculator";
import type { CustomCalendarEvent, DailyStudyTask, ScheduleSlot } from "../state/types";

describe("cushionCalculator — deterministic study capacity and deficit detection", () => {
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

  it("calculates healthy study cushion when available time exceeds tasks", () => {
    // 2026-10-19 is Monday
    // Waking hours: 15.0h
    // Committed: 3.0h (slot) + 1.5h (event) = 4.5h
    // Available: 15.0 - 4.5 = 10.5h
    // Tasks: 2.0h + 1.5h = 3.5h
    // Cushion: 10.5 - 3.5 = +7.0h
    const tasks: DailyStudyTask[] = [
      {
        id: "t1",
        key: "t1",
        assessmentId: "a1",
        title: "Study Chapter 1",
        topicTitle: "Chapter 1",
        topicIndex: 0,
        dayOffset: 0,
        targetDateIso: "2026-10-19",
        estimatedHours: 2.0,
        priorityRank: 1,
        completed: false,
        reasoning: "Review concepts",
      },
      {
        id: "t2",
        key: "t2",
        assessmentId: "a1",
        title: "Practice Exercises",
        topicTitle: "Exercises",
        topicIndex: 1,
        dayOffset: 0,
        targetDateIso: "2026-10-19",
        estimatedHours: 1.5,
        priorityRank: 2,
        completed: false,
        reasoning: "Homework",
      },
    ];

    const cushion = calculateDailyStudyCushion(
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

  it("detects study deficit when tasks exceed available hours", () => {
    // Waking hours: 15.0h
    // Committed: 4.5h -> Available: 10.5h
    // Tasks: 12.0h -> Deficit: 1.5h
    const heavyTasks: DailyStudyTask[] = [
      {
        id: "t1",
        key: "t1",
        assessmentId: "a1",
        title: "Cramming Exam",
        topicTitle: "Full Syllabus",
        topicIndex: 0,
        dayOffset: 0,
        targetDateIso: "2026-10-19",
        estimatedHours: 12.0,
        priorityRank: 1,
        completed: false,
        reasoning: "Exam tomorrow",
      },
    ];

    const cushion = calculateDailyStudyCushion(
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

  it("withholds cushion honestly when any task lacks an estimate", () => {
    const unestimatedTasks: DailyStudyTask[] = [
      {
        id: "t1",
        key: "t1",
        assessmentId: "a1",
        title: "Unestimated task",
        topicTitle: "Topic",
        topicIndex: 0,
        dayOffset: 0,
        targetDateIso: "2026-10-19",
        estimatedHours: null,
        priorityRank: 1,
        completed: false,
        reasoning: "No estimate",
      },
    ];

    const cushion = calculateDailyStudyCushion(
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
    expect(cushion.warningNote).toBe("Cushion calculation unavailable: 1 task lacks hour estimates");
  });
});
