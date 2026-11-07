import { describe, it, expect } from "vitest";
import { getIsoWeekNumber, getWeekParity, slotMatchesDate, slotMatchesParity } from "./weekParity";
import type { ScheduleSlot } from "../state/types";

describe("weekParity — ISO 8601 week calculations and alternating timetable matching", () => {
  it("computes ISO week numbers matching core parity tests", () => {
    // 2026-10-19: Monday of ISO week 43
    expect(getIsoWeekNumber("2026-10-19")).toBe(43);
    expect(getWeekParity("2026-10-19")).toBe("week_a");

    // 2026-10-26: Monday of ISO week 44
    expect(getIsoWeekNumber("2026-10-26")).toBe(44);
    expect(getWeekParity("2026-10-26")).toBe("week_b");
  });

  it("matches slots based on parity and filter override", () => {
    const slotAll: ScheduleSlot = {
      id: "s1",
      day: "Monday",
      dayIndex: 1,
      courseId: "CS101",
      courseName: "CS101",
      type: "Lecture",
      startTime: "09:00",
      endTime: "10:30",
      displayTime: "09:00 - 10:30",
      weekParity: "all",
    };

    const slotA: ScheduleSlot = {
      ...slotAll,
      id: "s2",
      weekParity: "week_a",
    };

    const slotB: ScheduleSlot = {
      ...slotAll,
      id: "s3",
      weekParity: "week_b",
    };

    // 2026-10-19 is Monday in week_a
    expect(slotMatchesDate(slotAll, "2026-10-19")).toBe(true);
    expect(slotMatchesDate(slotA, "2026-10-19")).toBe(true);
    expect(slotMatchesDate(slotB, "2026-10-19")).toBe(false);

    // 2026-10-26 is Monday in week_b
    expect(slotMatchesDate(slotAll, "2026-10-26")).toBe(true);
    expect(slotMatchesDate(slotA, "2026-10-26")).toBe(false);
    expect(slotMatchesDate(slotB, "2026-10-26")).toBe(true);

    // Tuesday on week_a -> false because wrong day
    expect(slotMatchesDate(slotA, "2026-10-20")).toBe(false);

    // Overrides
    expect(slotMatchesParity(slotA, "2026-10-26", "all")).toBe(true);
    expect(slotMatchesParity(slotB, "2026-10-19", "all")).toBe(true);
  });
});
