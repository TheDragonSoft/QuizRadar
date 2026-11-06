/**
 * Privacy-preserving, local-first analytics client for QuizRadar using PostHog.
 *
 * PRIVACY GUARANTEES:
 * - Autocapture is explicitly DISABLED (no DOM clicks, no input values, no student data).
 * - Session recording is explicitly DISABLED (no video-like screen recording).
 * - Pageview capturing is explicitly DISABLED (no URL query strings or sensitive paths).
 * - Respects the user's Do Not Track (DNT) browser setting.
 * - Respects the user's explicit opt-out toggle stored in localStorage.
 * - If VITE_POSTHOG_KEY is not supplied, this module is a complete zero-overhead no-op.
 */

import posthog from "posthog-js";

const OPT_OUT_STORAGE_KEY = "quizradar_telemetry_opt_out";
const POSTHOG_KEY = (import.meta.env.VITE_POSTHOG_KEY || "").trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com").trim();

let isInitialized = false;

export function initAnalytics(): void {
  if (typeof window === "undefined" || isInitialized || !POSTHOG_KEY) {
    return;
  }

  const isOptedOut = localStorage.getItem(OPT_OUT_STORAGE_KEY) === "true";

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    respect_dnt: true,
    persistence: "localStorage",
    loaded: (ph) => {
      if (isOptedOut) {
        ph.opt_out_capturing();
      }
    },
  });

  isInitialized = true;
}

export function isAnalyticsConfigured(): boolean {
  return Boolean(POSTHOG_KEY);
}

export function isAnalyticsOptedOut(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(OPT_OUT_STORAGE_KEY) === "true";
}

export function setAnalyticsOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(OPT_OUT_STORAGE_KEY, optOut ? "true" : "false");
  if (!isInitialized) return;

  if (optOut) {
    posthog.opt_out_capturing();
  } else {
    posthog.opt_in_capturing();
  }
}

export function trackEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (typeof window === "undefined" || !isInitialized || isAnalyticsOptedOut()) {
    return;
  }
  posthog.capture(eventName, properties);
}

// ---------------------------------------------------------------------------
// Typed convenience helpers for QuizRadar lifecycle events
// ---------------------------------------------------------------------------

export const analytics = {
  onboardingStep(stepNumber: number, action: string): void {
    trackEvent("onboarding_step", { step: stepNumber, action });
  },

  onboardingCompleted(enrolledCoursesCount: number, rhythm: string): void {
    trackEvent("onboarding_completed", { courses_count: enrolledCoursesCount, rhythm });
  },

  scanCompleted(payload: {
    source: string;
    assessmentCount: number;
    durationMs?: number;
    success: boolean;
  }): void {
    trackEvent("scan_completed", {
      source: payload.source,
      assessment_count: payload.assessmentCount,
      duration_ms: payload.durationMs,
      success: payload.success,
    });
  },

  practiceQuizStarted(mode: "ai" | "local_fallback", topicCount: number): void {
    trackEvent("practice_quiz_started", { mode, topic_count: topicCount });
  },

  practiceQuizCompleted(mode: "ai" | "local_fallback", score: number, total: number): void {
    trackEvent("practice_quiz_completed", { mode, score, total });
  },

  pomodoroFinished(durationMinutes: number, linkedToTopic: boolean): void {
    trackEvent("pomodoro_completed", { duration_minutes: durationMinutes, linked_to_topic: linkedToTopic });
  },

  calendarExport(target: "gcal" | "ics", count: number): void {
    trackEvent("calendar_exported", { target, count });
  },

  conflictDismissed(): void {
    trackEvent("conflict_dismissed");
  },

  backupAction(action: "export" | "import" | "reset"): void {
    trackEvent("backup_action", { action });
  },
};
