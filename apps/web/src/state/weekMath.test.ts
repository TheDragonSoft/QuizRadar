import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore, getWeekStart, initialFullState } from "./store";

/**
 * Regression coverage for the "week starts on Saturday" defect: the week
 * anchor was computed by parsing a local midnight and formatting it back with
 * `toISOString()`, which moves the day for every user east or west of UTC.
 * Calendar-week math must be pure calendar-date arithmetic.
 */
describe("week anchor math", () => {
  beforeEach(() => {
    useAppStore.setState({
      data: { ...initialFullState },
      toasts: [],
    });
  });

  it("anchors the week on Sunday", () => {
    expect(getWeekStart("2026-10-25")).toBe("2026-10-25"); // Sunday
    expect(getWeekStart("2026-10-29")).toBe("2026-10-25"); // Thursday -> same Sunday
    expect(getWeekStart("2026-10-31")).toBe("2026-10-25"); // Saturday -> same Sunday
    expect(getWeekStart("2026-11-01")).toBe("2026-11-01"); // next Sunday anchors itself
    expect(getWeekStart("2026-11-02")).toBe("2026-11-01"); // Monday -> previous Sunday
  });

  it("crosses month and year boundaries without drifting", () => {
    expect(getWeekStart("2026-12-31")).toBe("2026-12-27");
    expect(getWeekStart("2027-01-01")).toBe("2026-12-27");
    expect(getWeekStart("2026-03-01")).toBe("2026-03-01"); // Sunday
    expect(getWeekStart("2026-02-23")).toBe("2026-02-22"); // Monday -> previous Sunday
  });

  it("shifts the week by whole weeks and keeps the Sunday anchor", () => {
    useAppStore.setState({ currentWeekStart: "2026-10-25" });

    useAppStore.getState().shiftWeek(1);
    expect(useAppStore.getState().currentWeekStart).toBe("2026-11-01");

    useAppStore.getState().shiftWeek(-2);
    expect(useAppStore.getState().currentWeekStart).toBe("2026-10-18");
  });
});
