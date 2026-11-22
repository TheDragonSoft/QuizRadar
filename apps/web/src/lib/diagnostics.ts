/**
 * Privacy-first, zero-PII diagnostics & 6-event anonymous activation funnel
 * (authorized by the 2026-11-22 Maintainer Override in AGENTS.md).
 *
 * Guarantees:
 * - Opt-out at any time in Settings -> Privacy (`quizradar_diagnostics_enabled`).
 * - Strictly allowlisted event names and enum/numeric metadata only.
 * - Zero course names, zero assessment titles, zero emails, zero OAuth tokens,
 *   zero cookies, and zero third-party analytics or ad SDKs.
 * - Fire-and-forget: never throws, never blocks UI, never degrades offline mode.
 */

export const DIAGNOSTICS_STORAGE_KEY = "quizradar_diagnostics_enabled";
const FIRST_SEEN_STORAGE_KEY = "quizradar_first_seen_day";
const DAY7_SENT_STORAGE_KEY = "quizradar_day7_sent";

const envDiagnosticsUrl =
  typeof import.meta !== "undefined"
    ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        ?.VITE_DIAGNOSTICS_URL
    : undefined;

export const DEFAULT_DIAGNOSTICS_URL =
  (envDiagnosticsUrl ?? "").trim() || "https://diagnostics.quizradar.workers.dev/v1/events";

export type ActivationEventName =
  | "app_opened"
  | "syllabus_imported"
  | "onboarding_finished"
  | "course_link_shared"
  | "course_link_imported"
  | "day_7_return"
  | "crash_report";

export type DiagnosticsPlatform = "desktop" | "web" | "android" | "ios";

export interface DiagnosticsPayload {
  event: ActivationEventName;
  platform?: DiagnosticsPlatform;
  version?: string;
  mode?: "trial" | "byok" | "off";
  success?: boolean;
  durationBucket?: "<30s" | "30-60s" | "1-3m" | ">3m";
  errorCode?: string;
}

export function isDiagnosticsEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
    return raw !== "false";
  } catch {
    return false;
  }
}

export function setDiagnosticsEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore storage quota / private mode failures
  }
}

export function sanitizeCrashCode(raw: unknown): string {
  const text =
    raw instanceof Error ? raw.name || "Error" : typeof raw === "string" ? raw : "UnknownError";
  const cleaned = text
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, 64)
    .trim();
  return cleaned || "UnknownError";
}

function detectPlatform(): DiagnosticsPlatform {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return "desktop";
  }
  return "web";
}

export async function trackActivationEvent(
  payload: DiagnosticsPayload,
  fetchImpl: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined,
): Promise<boolean> {
  if (!isDiagnosticsEnabled() || !fetchImpl) return false;
  // Never emit live network pings during automated test runs unless a custom fetch is injected.
  const isDefaultFetch = typeof fetch === "function" && fetchImpl === fetch;
  if (
    isDefaultFetch &&
    typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === "test"
  ) {
    return false;
  }

  const body: DiagnosticsPayload = {
    event: payload.event,
    platform: payload.platform ?? detectPlatform(),
    ...(payload.version ? { version: payload.version } : {}),
    ...(payload.mode ? { mode: payload.mode } : {}),
    ...(typeof payload.success === "boolean" ? { success: payload.success } : {}),
    ...(payload.durationBucket ? { durationBucket: payload.durationBucket } : {}),
    ...(payload.errorCode ? { errorCode: sanitizeCrashCode(payload.errorCode) } : {}),
  };

  try {
    const res = await fetchImpl(DEFAULT_DIAGNOSTICS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Emits a single anonymous `day_7_return` counter once at least 7 calendar days
 * have elapsed since first app open on this device (stored locally only).
 */
export async function checkAndEmitDay7Return(
  now: Date = new Date(),
  version?: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  if (!isDiagnosticsEnabled()) return false;
  try {
    if (typeof localStorage === "undefined") return false;
    if (localStorage.getItem(DAY7_SENT_STORAGE_KEY) === "true") return false;
    const todayIso = now.toISOString().slice(0, 10);
    const firstSeen = localStorage.getItem(FIRST_SEEN_STORAGE_KEY);
    if (!firstSeen) {
      localStorage.setItem(FIRST_SEEN_STORAGE_KEY, todayIso);
      return false;
    }
    const diffDays = Math.floor(
      (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${firstSeen}T00:00:00Z`)) / 86_400_000,
    );
    if (diffDays >= 7) {
      const ok = await trackActivationEvent({ event: "day_7_return", version }, fetchImpl);
      if (ok) {
        localStorage.setItem(DAY7_SENT_STORAGE_KEY, "true");
      }
      return ok;
    }
    return false;
  } catch {
    return false;
  }
}
