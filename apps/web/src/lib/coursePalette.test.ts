import { describe, expect, it } from "vitest";
import { COURSE_PALETTE_PRESETS, courseDisplayName, coursePalette } from "./coursePalette";

describe("coursePalette derivation", () => {
  it("stays deterministic for a given course id", () => {
    const first = coursePalette("CSE241");
    const second = coursePalette("CSE241");
    expect(first).toEqual(second);
  });

  it("derives v4-style translucent bg/border from the accent color", () => {
    const colors = coursePalette(0);
    expect(colors.color).toBe(COURSE_PALETTE_PRESETS[0]);
    expect(colors.bg).toBe(`${colors.color}18`);
    expect(colors.border).toBe(`${colors.color}55`);
  });

  it("keeps only the 8 v4 preset accents (01 §6)", () => {
    expect(COURSE_PALETTE_PRESETS).toHaveLength(8);
  });
});

describe("courseDisplayName (phase-19: raw id slugs never render as labels)", () => {
  const courses = [{ id: "cs301", name: "CS 301 · Algorithms & Data Structures" }];

  it("prefers the enrolled course name over the id", () => {
    expect(courseDisplayName("cs301", courses)).toBe("CS 301 · Algorithms & Data Structures");
  });

  it("falls back to the id for an unenrolled course — never invents a name", () => {
    expect(courseDisplayName("ghost999", courses)).toBe("ghost999");
  });

  it("renders an em dash when there is no course id", () => {
    expect(courseDisplayName(null, courses)).toBe("—");
    expect(courseDisplayName(undefined, courses)).toBe("—");
    expect(courseDisplayName("", courses)).toBe("—");
  });

  it("accepts a Map lookup (the calendar lanes pass coursesById)", () => {
    const map = new Map([
      ["cs301", { id: "cs301", name: "CS 301 · Algorithms & Data Structures" }],
    ]);
    expect(courseDisplayName("cs301", map)).toBe("CS 301 · Algorithms & Data Structures");
    expect(courseDisplayName("nope", map)).toBe("nope");
  });
});
