import { describe, expect, it } from "vitest";
import { COURSE_PALETTE_PRESETS, coursePalette } from "./coursePalette";

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
