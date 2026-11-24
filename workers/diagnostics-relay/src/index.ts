/**
 * QuizRadar Privacy-First Diagnostics & 6-Event Activation Funnel Worker
 *
 * Strictly zero-PII, first-party Cloudflare Worker authorized by the
 * 2026-11-22 Maintainer Override in AGENTS.md:
 * - Accepts ONLY allowlisted event names and strictly typed enum/numeric fields.
 * - Rejects any Authorization header, unknown keys, or PII-shaped strings.
 * - Aggregates UTC-day counters in KV (90-day TTL); stores ZERO IPs, ZERO user IDs,
 *   ZERO course names, ZERO assessment titles, and ZERO cookies.
 */

export interface DiagnosticsEnv {
  DIAGNOSTICS_KV?: KVNamespace;
  ALLOWED_ORIGINS?: string;
}

export const ALLOWED_EVENTS = new Set([
  "app_opened",
  "syllabus_imported",
  "onboarding_finished",
  "course_link_shared",
  "course_link_imported",
  "day_7_return",
  "crash_report",
]);

const ALLOWED_PLATFORMS = new Set(["desktop", "web", "android", "ios"]);
const ALLOWED_AI_MODES = new Set(["trial", "byok", "off"]);
const ALLOWED_DURATION_BUCKETS = new Set(["<30s", "30-60s", "1-3m", ">3m"]);

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://thedragonsoft.github.io",
  "https://quizradar.app",
  "https://www.quizradar.app",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

const PII_PATTERN = /(@|bearer\s|gocsp[xX]-|AIza|https?:\/\/)/i;
const MAX_BODY_BYTES = 4096;
const COUNTER_TTL_SECS = 90 * 24 * 60 * 60; // 90 days

function isAllowedOrigin(origin: string | null, env: DiagnosticsEnv): boolean {
  if (!origin) return true; // native desktop/mobile clients may omit Origin
  const trimmed = origin.trim();
  if (
    trimmed.startsWith("http://localhost") ||
    trimmed.startsWith("http://127.0.0.1") ||
    DEFAULT_ALLOWED_ORIGINS.has(trimmed)
  ) {
    return true;
  }
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(trimmed);
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function sanitizeVersion(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const trimmed = raw.trim();
  return /^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9]+)?$/.test(trimmed) ? trimmed : "unknown";
}

function sanitizeCrashCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 80 || PII_PATTERN.test(trimmed)) return null;
  return /^[a-zA-Z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

const ALLOWED_KEYS = new Set([
  "event",
  "platform",
  "version",
  "mode",
  "fileCount",
  "success",
  "durationBucket",
  "courseCountBucket",
  "errorCode",
]);

export function validateEventPayload(raw: unknown):
  | {
      ok: true;
      event: string;
      platform: string;
      version: string;
      bucketTag: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_JSON", message: "Expected a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        code: "UNKNOWN_FIELD",
        message: `Field '${key}' is not allowlisted for zero-PII diagnostics.`,
      };
    }
    const val = obj[key];
    if (typeof val === "string" && PII_PATTERN.test(val)) {
      return {
        ok: false,
        code: "PII_REJECTED",
        message: "Payload rejected because it matched a PII or credential pattern.",
      };
    }
  }

  const event = typeof obj.event === "string" ? obj.event.trim() : "";
  if (!ALLOWED_EVENTS.has(event)) {
    return {
      ok: false,
      code: "UNKNOWN_EVENT",
      message: "Event is not on the 6-event + crash allowlist.",
    };
  }

  const platform =
    typeof obj.platform === "string" && ALLOWED_PLATFORMS.has(obj.platform) ? obj.platform : "web";
  const version = sanitizeVersion(obj.version);

  let bucketTag = "default";
  if (event === "syllabus_imported") {
    const mode = typeof obj.mode === "string" && ALLOWED_AI_MODES.has(obj.mode) ? obj.mode : "off";
    const outcome = obj.success === false ? "err" : "ok";
    bucketTag = `${mode}:${outcome}`;
  } else if (event === "onboarding_finished") {
    bucketTag =
      typeof obj.durationBucket === "string" && ALLOWED_DURATION_BUCKETS.has(obj.durationBucket)
        ? obj.durationBucket
        : "unknown";
  } else if (event === "crash_report") {
    bucketTag = sanitizeCrashCode(obj.errorCode) ?? "unclassified";
  }

  return { ok: true, event, platform, version, bucketTag };
}

export default {
  async fetch(request: Request, env: DiagnosticsEnv): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (!isAllowedOrigin(origin, env)) {
      return jsonResponse({ ok: false, error: "ORIGIN_FORBIDDEN" }, 403, null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: "quizradar-diagnostics-relay",
          zeroPii: true,
          allowlistedEvents: [...ALLOWED_EVENTS],
        },
        200,
        origin,
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/events") {
      if (request.headers.get("Authorization")) {
        return jsonResponse({ ok: false, error: "AUTH_HEADER_FORBIDDEN" }, 400, origin);
      }

      const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413, origin);
      }

      const rawText = await request.text();
      if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
        return jsonResponse({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413, origin);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return jsonResponse({ ok: false, error: "INVALID_JSON" }, 400, origin);
      }

      const validated = validateEventPayload(parsed);
      if (!validated.ok) {
        return jsonResponse(
          { ok: false, error: validated.code, message: validated.message },
          400,
          origin,
        );
      }

      if (env.DIAGNOSTICS_KV) {
        const day = utcDateKey();
        const key = `agg:${day}:${validated.event}:${validated.platform}:${validated.bucketTag}`;
        const prev = Number((await env.DIAGNOSTICS_KV.get(key)) ?? "0");
        const next = (Number.isFinite(prev) ? prev : 0) + 1;
        await env.DIAGNOSTICS_KV.put(key, String(next), {
          expirationTtl: COUNTER_TTL_SECS,
        });
      }

      return jsonResponse({ ok: true, accepted: validated.event }, 202, origin);
    }

    return jsonResponse({ ok: false, error: "NOT_FOUND" }, 404, origin);
  },
};
