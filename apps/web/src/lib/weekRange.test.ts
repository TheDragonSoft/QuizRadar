import { describe, expect, it } from "vitest";
import { formatIsoShortDate, formatWeekRange, parseIsoDate } from "./weekRange";

describe("week range formatting", () => {
  it("parses an ISO date without a UTC shift", () => {
    const parsed = parseIsoDate("2026-11-01");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(10);
    expect(parsed?.getDate()).toBe(1);
  });

  it("returns null for a malformed date instead of an Invalid Date", () => {
    expect(parseIsoDate("not-a-date")).toBeNull();
    expect(parseIsoDate("2026-11")).toBeNull();
  });

  it("prints a short date, optionally with the weekday and the year", () => {
    expect(formatIsoShortDate("2026-11-01")).toBe("Nov 1");
    expect(formatIsoShortDate("2026-11-01", { weekday: true })).toBe("Sun, Nov 1");
    expect(formatIsoShortDate("2026-11-01", { weekday: true, year: true })).toBe(
      "Sun, Nov 1, 2026",
    );
  });

  it("never prints a raw ISO string for an unparsable input", () => {
    expect(formatIsoShortDate("garbage")).toBe("garbage");
  });

  it("names the seven days of the week it starts on", () => {
    expect(formatWeekRange("2026-11-01")).toBe("Nov 1 – Nov 7");
    expect(formatWeekRange("2026-10-25")).toBe("Oct 25 – Oct 31");
  });

  it("adds the year only when the week spans two of them", () => {
    expect(formatWeekRange("2026-12-28")).toBe("Dec 28 – Jan 3, 2027");
    expect(formatWeekRange("2026-11-01")).not.toMatch(/2026/);
  });
});
