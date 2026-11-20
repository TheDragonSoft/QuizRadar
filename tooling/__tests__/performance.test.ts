import { describe, expect, it } from "vitest";
import {
  comparePerformanceResults,
  renderPerformanceMarkdown,
  summarizeSamples,
} from "../lib/performance.mjs";

const thresholds = {
  defaults: {
    core: { samples: 3, maxRegressionPercent: 10, minAbsoluteDeltaMs: 1 },
  },
  scenarios: {
    "core.tuned": { maxRegressionPercent: 25, minAbsoluteDeltaMs: 2 },
  },
};

function result(samples: number[], id = "parser", revision = "rev") {
  return {
    schemaVersion: 1,
    surface: "core",
    revision,
    scenarios: [{ id, samples }],
  };
}

function compare(base: unknown, head: unknown) {
  return comparePerformanceResults({ base, head, thresholds, surface: "core" });
}

describe("performance statistics and regression gate", () => {
  it("summarizes median, p95, extrema, and mean without sorting the caller's array", () => {
    const samples = [4, 1, 3, 2];
    const summary = summarizeSamples(samples);
    expect(summary).toMatchObject({ count: 4, min: 1, p50: 2.5, max: 4, mean: 2.5 });
    expect(summary.p95).toBeCloseTo(3.85, 12);
    expect(samples).toEqual([4, 1, 3, 2]);
  });

  it("rejects empty, negative, and non-finite samples", () => {
    expect(() => summarizeSamples([])).toThrow("non-empty");
    expect(() => summarizeSamples([-1])).toThrow("non-negative");
    expect(() => summarizeSamples([Number.NaN])).toThrow("finite");
    expect(() => summarizeSamples([Number.POSITIVE_INFINITY])).toThrow("finite");
  });

  it("passes an unchanged result", () => {
    const comparison = compare(
      result([10, 10, 10], "parser", "base"),
      result([10, 10, 10], "parser", "head"),
    );
    expect(comparison.passed).toBe(true);
    expect(comparison.scenarios[0]).toMatchObject({ status: "pass", deltaMs: 0 });
  });

  it("fails only when both the relative and absolute regression limits are crossed", () => {
    expect(compare(result([100, 100, 100]), result([110, 110, 110])).scenarios[0].status).toBe(
      "pass",
    );
    expect(compare(result([100, 100, 100]), result([112, 112, 112])).scenarios[0].status).toBe(
      "regression",
    );
    expect(compare(result([10, 10, 10]), result([11, 11, 11])).scenarios[0].status).toBe("pass");
  });

  it("reports improvements without treating them as regressions", () => {
    const comparison = compare(result([100, 100, 100]), result([80, 80, 80]));
    expect(comparison.passed).toBe(true);
    expect(comparison.scenarios[0].status).toBe("improvement");
  });

  it("fails missing or extra scenarios instead of silently dropping them", () => {
    const missing = compare(result([1, 1, 1]), {
      ...result([1, 1, 1], "other"),
    });
    expect(missing.passed).toBe(false);
    expect(missing.scenarios.map((scenario) => scenario.status)).toEqual(["error", "error"]);
  });

  it("fails insufficient or malformed samples with the scenario id", () => {
    const short = compare(result([10, 10]), result([10, 10, 10]));
    expect(short.passed).toBe(false);
    expect(short.scenarios[0]).toMatchObject({ id: "parser", status: "error" });
    expect(short.scenarios[0].reason).toContain("requires 3 samples");
    expect(compare(result([10, 10, 10]), result([10, Number.NaN, 10])).passed).toBe(false);
  });

  it("honors per-scenario threshold overrides", () => {
    const comparison = compare(result([100, 100, 100], "tuned"), result([120, 120, 120], "tuned"));
    expect(comparison.passed).toBe(true);
    expect(comparison.scenarios[0].threshold).toMatchObject({
      maxRegressionPercent: 25,
      minAbsoluteDeltaMs: 2,
    });
  });

  it("renders a review report with medians, deltas, and the failing scenario", () => {
    const comparison = compare(result([100, 100, 100]), result([120, 120, 120]));
    const markdown = renderPerformanceMarkdown(comparison);
    expect(markdown).toContain("REVIEW REQUIRED");
    expect(markdown).toContain("`parser`");
    expect(markdown).toContain("+20.00%");
    expect(markdown).toContain("REGRESSION");
  });
});
