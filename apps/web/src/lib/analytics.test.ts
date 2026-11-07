import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initAnalytics,
  isAnalyticsConfigured,
  isAnalyticsOptedOut,
  setAnalyticsOptOut,
  trackEvent,
  isFeatureEnabled,
  onFeatureFlags,
  analytics,
} from "./analytics";

describe("analytics module", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("reports configuration status based on environment variable", () => {
    const hasKey = Boolean(import.meta.env.VITE_POSTHOG_KEY?.trim());
    expect(isAnalyticsConfigured()).toBe(hasKey);
  });

  it("handles opt-out state correctly via localStorage", () => {
    expect(isAnalyticsOptedOut()).toBe(false);

    setAnalyticsOptOut(true);
    expect(isAnalyticsOptedOut()).toBe(true);
    expect(localStorage.getItem("quizradar_telemetry_opt_out")).toBe("true");

    setAnalyticsOptOut(false);
    expect(isAnalyticsOptedOut()).toBe(false);
    expect(localStorage.getItem("quizradar_telemetry_opt_out")).toBe("false");
  });

  it("safely handles init and event calls when unconfigured without throwing", () => {
    expect(() => initAnalytics()).not.toThrow();
    expect(() => trackEvent("test_event", { foo: "bar" })).not.toThrow();
    expect(() => analytics.onboardingStep(1, "open")).not.toThrow();
    expect(() => analytics.onboardingCompleted(4, "Standard")).not.toThrow();
    expect(() =>
      analytics.scanCompleted({
        source: "gmail",
        assessmentCount: 3,
        durationMs: 450,
        success: true,
      }),
    ).not.toThrow();
    expect(() => analytics.practiceQuizStarted("ai", 5)).not.toThrow();
    expect(() => analytics.practiceQuizCompleted("local_fallback", 4, 5)).not.toThrow();
    expect(() => analytics.pomodoroFinished(25, true)).not.toThrow();
    expect(() => analytics.calendarExport("gcal", 2)).not.toThrow();
    expect(() => analytics.conflictDismissed()).not.toThrow();
    expect(() => analytics.backupAction("export")).not.toThrow();
    expect(isFeatureEnabled("test_flag", true)).toBe(true);
    expect(isFeatureEnabled("test_flag", false)).toBe(false);
    expect(() => onFeatureFlags(() => {})).not.toThrow();
  });
});
