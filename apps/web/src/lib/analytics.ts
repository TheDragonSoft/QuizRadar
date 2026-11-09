import { useEffect, useState } from "react";

const OPT_OUT_STORAGE_KEY = "quizradar_telemetry_opt_out";

let isInitialized = false;

export type ClientPlatform = "desktop_tauri" | "web_pwa" | "browser";

export function detectPlatform(): ClientPlatform {
  if (typeof window === "undefined") return "browser";
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
    return "desktop_tauri";
  }
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true
  ) {
    return "web_pwa";
  }
  return "browser";
}

export function detectTheme(): "dark" | "light" {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  return "light";
}

export function initAnalytics(): void {
  if (typeof window === "undefined" || isInitialized) {
    return;
  }
  isInitialized = true;
}

export function isAnalyticsConfigured(): boolean {
  return false;
}

export function isAnalyticsOptedOut(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(OPT_OUT_STORAGE_KEY) === "true";
}

export function setAnalyticsOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(OPT_OUT_STORAGE_KEY, optOut ? "true" : "false");
}

export function updateAnalyticsSuperProperties(_props?: Record<string, unknown>): void {
  void _props;
}

export function trackEvent(
  _eventName?: string,
  _properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  void _eventName;
  void _properties;
}

export function isFeatureEnabled(_flagKey: string, defaultValue = false): boolean {
  void _flagKey;
  return defaultValue;
}

export function getFeatureFlagPayload<T = unknown>(_flagKey: string): T | null {
  void _flagKey;
  return null;
}

export function onFeatureFlags(_callback?: (flags: string[]) => void): () => void {
  void _callback;
  return () => {};
}

export function useFeatureFlag(_flagKey: string, defaultValue = false): boolean {
  const [enabled] = useState<boolean>(defaultValue);
  useEffect(() => {}, [_flagKey, defaultValue]);
  return enabled;
}

export function useFeatureFlagPayload<T = unknown>(_flagKey: string): T | null {
  const [payload] = useState<T | null>(null);
  useEffect(() => {}, [_flagKey]);
  return payload;
}

export const analytics = {
  onboardingStep(_stepNumber?: number, _action?: string): void {
    void _stepNumber;
    void _action;
  },
  onboardingCompleted(_enrolledCoursesCount?: number, _rhythm?: string): void {
    void _enrolledCoursesCount;
    void _rhythm;
  },
  scanCompleted(_payload?: {
    source: string;
    assessmentCount: number;
    durationMs?: number;
    success: boolean;
  }): void {
    void _payload;
  },
  practiceQuizStarted(
    _mode?: "ai" | "local_fallback",
    _topicCount?: number,
  ): void {
    void _mode;
    void _topicCount;
  },
  practiceQuizCompleted(
    _mode?: "ai" | "local_fallback",
    _score?: number,
    _total?: number,
  ): void {
    void _mode;
    void _score;
    void _total;
  },
  pomodoroFinished(_durationMinutes?: number, _linkedToTopic?: boolean): void {
    void _durationMinutes;
    void _linkedToTopic;
  },
  calendarExport(_target?: "gcal" | "ics", _count?: number): void {
    void _target;
    void _count;
  },
  conflictDismissed(): void {},
  backupAction(_action?: "export" | "import" | "reset"): void {
    void _action;
  },
};
