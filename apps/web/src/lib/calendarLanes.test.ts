import { describe, it, expect } from "vitest";
import {
  computeBlockPosition,
  assignOverlapLanes,
  getClampedDayWindow,
  type CalendarLaneItem,
} from "./calendarLanes";

describe("calendarLanes: pure layout and coordinate math", () => {
  it("computes pixel top and height with minimum 45m duration guard", () => {
    // 08:00 to 09:30 => 1.5 hours => top = 1px, height = 90 - 3 = 87px
    const pos1 = computeBlockPosition("08:00", "09:30");
    expect(pos1.topPx).toBe(1);
    expect(pos1.heightPx).toBe(87);

    // Short event: 09:00 to 09:15 => clamped to 0.75h (45m)
    const pos2 = computeBlockPosition("09:00", "09:15");
    expect(pos2.topPx).toBe(61);
    expect(pos2.heightPx).toBe(42); // 45px - 3 = 42px
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
