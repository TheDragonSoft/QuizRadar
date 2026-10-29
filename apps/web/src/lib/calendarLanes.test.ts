import { describe, it, expect } from "vitest";
import {
  computeBlockPosition,
  assignOverlapLanes,
  getClampedDayWindow,
  formatCompactTime,
  hourLabel,
  stripRoomPrefix,
  hexToRgba,
  toIsoLocal,
  matchesGlobalSearch,
  START_HOUR,
  END_HOUR,
  HOUR_HEIGHT,
  type CalendarLaneItem,
} from "./calendarLanes";

describe("calendarLanes: pure layout and coordinate math", () => {
  it("uses the v4 week window constants (8 AM – 8 PM, 56px rows)", () => {
    expect(START_HOUR).toBe(8);
    expect(END_HOUR).toBe(20);
    expect(HOUR_HEIGHT).toBe(56);
  });

  it("computes pixel top and height with minimum 45m duration guard", () => {
    // 08:00 to 09:30 => 1.5 hours => top = 1px, height = 84 - 3 = 81px (56px rows)
    const pos1 = computeBlockPosition("08:00", "09:30");
    expect(pos1.topPx).toBe(1);
    expect(pos1.heightPx).toBe(81);

    // Short event: 09:00 to 09:15 => clamped to 0.75h (45m)
    const pos2 = computeBlockPosition("09:00", "09:15");
    expect(pos2.topPx).toBe(57);
    expect(pos2.heightPx).toBe(39); // 42px - 3 = 39px
  });

  it("assigns single lane to non-overlapping items", () => {
    const items: CalendarLaneItem[] = [
      { id: "a", topPx: 10, heightPx: 50 },
      { id: "b", topPx: 70, heightPx: 50 },
      { id: "c", topPx: 130, heightPx: 50 },
    ];

    const result = assignOverlapLanes(items);
    expect(result.length).toBe(3);
    result.forEach((item) => {
      expect(item.laneCount).toBe(1);
      expect(item.laneIndex).toBe(0);
    });
  });

  it("assigns distinct lanes to overlapping items in a cluster", () => {
    // Two overlapping items: 10-70 and 20-80
    const items: CalendarLaneItem[] = [
      { id: "a", topPx: 10, heightPx: 60 },
      { id: "b", topPx: 20, heightPx: 60 },
    ];

    const result = assignOverlapLanes(items);
    expect(result[0].laneCount).toBe(2);
    expect(result[1].laneCount).toBe(2);
    expect(result[0].laneIndex).toBe(0);
    expect(result[1].laneIndex).toBe(1);
  });

  it("packs staggered overlapping items into minimal lanes", () => {
    // Item A: 10 to 60 (ends at 70)
    // Item B: 20 to 60 (ends at 80)
    // Item C: 75 to 40 (starts after A ends, can reuse lane 0)
    const items: CalendarLaneItem[] = [
      { id: "a", topPx: 10, heightPx: 60 },
      { id: "b", topPx: 20, heightPx: 60 },
      { id: "c", topPx: 75, heightPx: 40 },
    ];

    const result = assignOverlapLanes(items);
    const itemA = result.find((x) => x.id === "a")!;
    const itemB = result.find((x) => x.id === "b")!;
    const itemC = result.find((x) => x.id === "c")!;

    expect(itemA.laneIndex).toBe(0);
    expect(itemB.laneIndex).toBe(1);
    expect(itemC.laneIndex).toBe(0); // Reused lane 0!
  });

  it("clamps mobile 3-day window following selected date within current week", () => {
    const weekStart = new Date("2026-10-18T00:00:00"); // Sunday

    // Sunday selected => offset 0, count 3
    const winSun = getClampedDayWindow(weekStart, new Date("2026-10-18T00:00:00"), true);
    expect(winSun).toEqual({ dayOffset: 0, dayCount: 3 });

    // Wednesday selected (diff 3) => offset 3, count 3
    const winWed = getClampedDayWindow(weekStart, new Date("2026-10-21T00:00:00"), true);
    expect(winWed).toEqual({ dayOffset: 3, dayCount: 3 });

    // Saturday selected (diff 6) => clamped to max offset 4
    const winSat = getClampedDayWindow(weekStart, new Date("2026-10-24T00:00:00"), true);
    expect(winSat).toEqual({ dayOffset: 4, dayCount: 3 });

    // Desktop mode (isNarrow = false) => always 7 days from offset 0
    const winDesktop = getClampedDayWindow(weekStart, new Date("2026-10-24T00:00:00"), false);
    expect(winDesktop).toEqual({ dayOffset: 0, dayCount: 7 });
  });
});

describe("calendarLanes: v4 display helpers", () => {
  it("formats compact 12-hour times exactly like v4", () => {
    expect(formatCompactTime("09:00")).toBe("9am");
    expect(formatCompactTime("09:30")).toBe("9:30am");
    expect(formatCompactTime("13:05")).toBe("1:05pm");
    expect(formatCompactTime("00:00")).toBe("12am");
    expect(formatCompactTime("12:00")).toBe("12pm");
    expect(formatCompactTime(null)).toBe("");
  });

  it("labels gutter hours in 12-hour format", () => {
    expect(hourLabel(8)).toBe("8 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(hourLabel(20)).toBe("8 PM");
  });

  it("strips the Room prefix and renders an honest dash for a missing room", () => {
    expect(stripRoomPrefix("Room 301")).toBe("301");
    expect(stripRoomPrefix("Room Room 12")).toBe("12");
    expect(stripRoomPrefix("301")).toBe("301");
    // Honesty rule: an unknown room is never presented as a known one.
    expect(stripRoomPrefix(null)).toBe("—");
    expect(stripRoomPrefix("")).toBe("—");
  });

  it("derives dark-mode card tints from a solid hex", () => {
    expect(hexToRgba("#1a73e8", 0.22)).toBe("rgba(26, 115, 232, 0.22)");
    expect(hexToRgba("db2777", 0.22)).toBe("rgba(219, 39, 119, 0.22)");
    // Non 6-digit values fall back to the accent instead of throwing.
    expect(hexToRgba("#1a73e855", 0.22)).toBe("rgba(26, 115, 232, 0.22)");
  });

  it("builds local-calendar ISO dates (never UTC-shifted)", () => {
    const d = new Date(2026, 9, 25, 0, 30); // 00:30 local on Oct 25
    expect(toIsoLocal(d)).toBe("2026-10-25");
    const d2 = new Date(2026, 0, 5, 23, 59);
    expect(toIsoLocal(d2)).toBe("2026-01-05");
  });

  it("matches the global search query case-insensitively across fields", () => {
    expect(matchesGlobalSearch("", "anything")).toBe(true);
    expect(matchesGlobalSearch("  ", "anything")).toBe(true);
    expect(matchesGlobalSearch("cse", "CSE241", "Digital Design", "Quiz 1")).toBe(true);
    expect(matchesGlobalSearch("quiz", "CSE241", "Digital Design", "Quiz 1")).toBe(true);
    expect(matchesGlobalSearch("moodle", "CSE241", "Digital Design", "Quiz 1")).toBe(false);
  });
});
