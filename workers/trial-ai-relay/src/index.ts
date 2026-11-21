/**
 * QuizRadar Zero-Key Trial AI Relay (Cloudflare Worker).
 *
 * Stateless edge proxy authorized by AGENTS.md (2026-11-21 Maintainer Override):
 * - Injects `env.GEMINI_API_KEY` into `x-goog-api-key` on the edge so first-run
 *   users can import syllabi / try AI with zero API-key setup.
 * - Stores ZERO user payloads, ZERO course/assessment data, ZERO OAuth tokens,
 *   and ZERO PII. Rate-limit keys are daily salted SHA-256 hashes of the
 *   anonymous device install id / IP and expire automatically via KV TTL.
 * - Rejects `Authorization` headers so OAuth tokens can never cross the relay.
 */

export const ALLOWED_MODELS: ReadonlySet<string> = new Set([
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
]);

export const DEFAULT_TRIAL_DAILY_LIMIT = 10;
export const DEFAULT_TRIAL_IP_DAILY_LIMIT = 30;
export const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const DEFAULT_GEMINI_UPSTREAM_BASE = "https://generativelanguage.googleapis.com/v1beta";

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const GENERATE_PATH_RE = /^\/v1beta\/models\/([A-Za-z0-9._-]+):generateContent$/;
const KV_TTL_SECONDS = 90_000;
const MEMORY_FALLBACK_MAX_KEYS = 10_000;

export interface QuotaKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  GEMINI_API_KEY?: string;
  TRIAL_DAILY_LIMIT?: string;
  TRIAL_IP_DAILY_LIMIT?: string;
  MAX_PAYLOAD_BYTES?: string;
  GEMINI_UPSTREAM_BASE?: string;
  ALLOWED_ORIGINS?: string;
  TRIAL_QUOTA_KV?: QuotaKvLike;
}

export interface ExecutionContextLike {
  waitUntil?(promise: Promise<unknown>): void;
}

export interface TrialQuotaState {
  limit: number;
  used: number;
  remaining: number;
  resetIso: string;
}

export interface WorkerDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  memoryQuota?: Map<string, number>;
}

const STATIC_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://thedragonsoft.github.io",
  "https://quizradar.app",
  "https://www.quizradar.app",
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
]);

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return true;
  if (STATIC_ALLOWED_ORIGINS.has(origin) || isLoopbackOrigin(origin)) {
    return true;
  }
  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function buildCorsHeaders(origin: string | null, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (origin && isOriginAllowed(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, x-quizradar-install-id, x-quizradar-client";
    headers["Access-Control-Expose-Headers"] =
      "X-QuizRadar-Trial-Remaining, X-QuizRadar-Trial-Limit, X-QuizRadar-Trial-Reset, Retry-After";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
  env: Env,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCorsHeaders(origin, env),
      ...extraHeaders,
    },
  });
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDayInfo(now: Date): { dayKey: string; resetIso: string; retryAfterSec: number } {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const nextMidnightMs = Date.UTC(year, now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  const retryAfterSec = Math.max(1, Math.ceil((nextMidnightMs - now.getTime()) / 1000));
  return {
    dayKey: `${year}-${month}-${day}`,
    resetIso: new Date(nextMidnightMs).toISOString(),
    retryAfterSec,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readCounter(
  kv: QuotaKvLike | undefined,
  memory: Map<string, number>,
  key: string,
): Promise<number> {
  if (kv) {
    const raw = await kv.get(key);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return memory.get(key) ?? 0;
}

async function writeCounter(
  kv: QuotaKvLike | undefined,
  memory: Map<string, number>,
  key: string,
  nextValue: number,
): Promise<void> {
  if (kv) {
    await kv.put(key, String(nextValue), { expirationTtl: KV_TTL_SECONDS });
    return;
  }
  if (memory.size >= MEMORY_FALLBACK_MAX_KEYS && !memory.has(key)) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, nextValue);
}

function trialHeaders(quota: TrialQuotaState): Record<string, string> {
  return {
    "X-QuizRadar-Trial-Limit": String(quota.limit),
    "X-QuizRadar-Trial-Remaining": String(quota.remaining),
    "X-QuizRadar-Trial-Reset": quota.resetIso,
  };
}

function scrubSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function validateGeminiPayload(raw: unknown): raw is {
  contents: unknown[];
  generationConfig: { responseMimeType: string };
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.contents) || record.contents.length === 0) return false;
  const genCfg = record.generationConfig;
  if (!genCfg || typeof genCfg !== "object" || Array.isArray(genCfg)) return false;
  const mime = (genCfg as Record<string, unknown>).responseMimeType;
  return mime === "application/json";
}

export function createWorkerHandler(deps: WorkerDependencies = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowFn = deps.now ?? (() => new Date());
  const defaultMemoryQuota = deps.memoryQuota ?? new Map<string, number>();

  return async function handleRequest(
    request: Request,
    env: Env,
    _ctx?: ExecutionContextLike,
  ): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (!isOriginAllowed(origin, env)) {
      return jsonResponse(
        {
          error: {
            code: 403,
            status: "ORIGIN_FORBIDDEN",
            message: "Origin is not allowlisted for QuizRadar Trial AI Relay.",
          },
        },
        403,
        origin,
        env,
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin, env),
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const configured = Boolean(env.GEMINI_API_KEY?.trim());
      return jsonResponse(
        {
          ok: true,
          service: "quizradar-trial-ai-relay",
          stateless: true,
          configured,
        },
        200,
        origin,
        env,
      );
    }

    const devLimit = parsePositiveInt(env.TRIAL_DAILY_LIMIT, DEFAULT_TRIAL_DAILY_LIMIT);
    const ipLimit = parsePositiveInt(env.TRIAL_IP_DAILY_LIMIT, DEFAULT_TRIAL_IP_DAILY_LIMIT);
    const maxPayloadBytes = parsePositiveInt(env.MAX_PAYLOAD_BYTES, DEFAULT_MAX_PAYLOAD_BYTES);
    const day = utcDayInfo(nowFn());

    if (request.method === "GET" && url.pathname === "/v1/trial/status") {
      const installId = (request.headers.get("x-quizradar-install-id") ?? "").trim();
      if (!INSTALL_ID_RE.test(installId)) {
        return jsonResponse(
          {
            error: {
              code: 400,
              status: "INVALID_INSTALL_ID",
              message: "Missing or malformed x-quizradar-install-id header.",
            },
          },
          400,
          origin,
          env,
        );
      }
      const devKey = `dev:${day.dayKey}:${await sha256Hex(installId)}`;
      const devUsed = await readCounter(env.TRIAL_QUOTA_KV, defaultMemoryQuota, devKey);
      const quota: TrialQuotaState = {
        limit: devLimit,
        used: devUsed,
        remaining: Math.max(0, devLimit - devUsed),
        resetIso: day.resetIso,
      };
      return jsonResponse(quota, 200, origin, env, trialHeaders(quota));
    }

    const match = GENERATE_PATH_RE.exec(url.pathname);
    if (request.method !== "POST" || !match) {
      return jsonResponse(
        {
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: "Route not supported by QuizRadar Trial AI Relay.",
          },
        },
        404,
        origin,
        env,
      );
    }

    if (request.headers.has("Authorization")) {
      return jsonResponse(
        {
          error: {
            code: 400,
            status: "AUTH_HEADER_FORBIDDEN",
            message: "Trial AI relay never accepts OAuth or Authorization headers.",
          },
        },
        400,
        origin,
        env,
      );
    }

    const apiKey = env.GEMINI_API_KEY?.trim() ?? "";
    if (!apiKey) {
      return jsonResponse(
        {
          error: {
            code: 503,
            status: "RELAY_UNCONFIGURED",
            message:
              "Free starter AI relay key is not configured yet. Add your own free Gemini API key in Settings.",
          },
        },
        503,
        origin,
        env,
      );
    }

    const modelId = match[1];
    if (!ALLOWED_MODELS.has(modelId)) {
      return jsonResponse(
        {
          error: {
            code: 400,
            status: "MODEL_NOT_ALLOWED",
            message: `Model "${modelId}" is not enabled on QuizRadar Trial AI Relay.`,
          },
        },
        400,
        origin,
        env,
      );
    }

    const installId = (request.headers.get("x-quizradar-install-id") ?? "").trim();
    if (!INSTALL_ID_RE.test(installId)) {
      return jsonResponse(
        {
          error: {
            code: 400,
            status: "INVALID_INSTALL_ID",
            message: "Missing or malformed x-quizradar-install-id header.",
          },
        },
        400,
        origin,
        env,
      );
    }

    const contentLengthHeader = request.headers.get("Content-Length");
    if (contentLengthHeader) {
      const advertised = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(advertised) && advertised > maxPayloadBytes) {
        return jsonResponse(
          {
            error: {
              code: 413,
              status: "PAYLOAD_TOO_LARGE",
              message: `Request exceeds the ${maxPayloadBytes}-byte Trial AI Relay limit.`,
            },
          },
          413,
          origin,
          env,
        );
      }
    }

    const rawBytes = new Uint8Array(await request.arrayBuffer());
    if (rawBytes.byteLength === 0 || rawBytes.byteLength > maxPayloadBytes) {
      return jsonResponse(
        {
          error: {
            code: rawBytes.byteLength === 0 ? 400 : 413,
            status: rawBytes.byteLength === 0 ? "EMPTY_BODY" : "PAYLOAD_TOO_LARGE",
            message:
              rawBytes.byteLength === 0
                ? "Request body cannot be empty."
                : `Request exceeds the ${maxPayloadBytes}-byte Trial AI Relay limit.`,
          },
        },
        rawBytes.byteLength === 0 ? 400 : 413,
        origin,
        env,
      );
    }

    const bodyText = new TextDecoder().decode(rawBytes);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return jsonResponse(
        {
          error: {
            code: 400,
            status: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        },
        400,
        origin,
        env,
      );
    }

    if (!validateGeminiPayload(parsedBody)) {
      return jsonResponse(
        {
          error: {
            code: 400,
            status: "INVALID_PAYLOAD_SHAPE",
            message:
              'Trial AI Relay requires structured JSON mode (non-empty "contents" and generationConfig.responseMimeType = "application/json").',
          },
        },
        400,
        origin,
        env,
      );
    }

    const devKey = `dev:${day.dayKey}:${await sha256Hex(installId)}`;
    const clientIp = (request.headers.get("CF-Connecting-IP") ?? "").trim();
    const ipKey = clientIp ? `ip:${day.dayKey}:${await sha256Hex(clientIp)}` : null;

    const devUsed = await readCounter(env.TRIAL_QUOTA_KV, defaultMemoryQuota, devKey);
    const ipUsed = ipKey ? await readCounter(env.TRIAL_QUOTA_KV, defaultMemoryQuota, ipKey) : 0;

    if (devUsed >= devLimit || (ipKey !== null && ipUsed >= ipLimit)) {
      const exhaustedQuota: TrialQuotaState = {
        limit: devLimit,
        used: devLimit,
        remaining: 0,
        resetIso: day.resetIso,
      };
      return jsonResponse(
        {
          error: {
            code: 429,
            status: "TRIAL_EXHAUSTED",
            message: `Free starter AI limit reached (${devLimit}/${devLimit} calls used today). Add your own free Gemini API key in Settings for unlimited free-tier usage.`,
            trial: exhaustedQuota,
          },
        },
        429,
        origin,
        env,
        {
          ...trialHeaders(exhaustedQuota),
          "Retry-After": String(day.retryAfterSec),
        },
      );
    }

    const upstreamBase = (env.GEMINI_UPSTREAM_BASE?.trim() || DEFAULT_GEMINI_UPSTREAM_BASE).replace(
      /\/+$/,
      "",
    );
    const upstreamUrl = `${upstreamBase}/models/${encodeURIComponent(modelId)}:generateContent`;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetchImpl(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: bodyText,
      });
    } catch {
      return jsonResponse(
        {
          error: {
            code: 502,
            status: "UPSTREAM_UNREACHABLE",
            message: "Could not reach Gemini API from Trial AI Relay.",
          },
        },
        502,
        origin,
        env,
      );
    }

    const upstreamText = scrubSecret(await upstreamResponse.text(), apiKey);

    if (!upstreamResponse.ok) {
      const currentQuota: TrialQuotaState = {
        limit: devLimit,
        used: devUsed,
        remaining: Math.max(0, devLimit - devUsed),
        resetIso: day.resetIso,
      };
      return new Response(upstreamText, {
        status: upstreamResponse.status,
        headers: {
          "Content-Type":
            upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
          ...buildCorsHeaders(origin, env),
          ...trialHeaders(currentQuota),
        },
      });
    }

    const nextDevUsed = devUsed + 1;
    await Promise.all([
      writeCounter(env.TRIAL_QUOTA_KV, defaultMemoryQuota, devKey, nextDevUsed),
      ...(ipKey ? [writeCounter(env.TRIAL_QUOTA_KV, defaultMemoryQuota, ipKey, ipUsed + 1)] : []),
    ]);

    const updatedQuota: TrialQuotaState = {
      limit: devLimit,
      used: nextDevUsed,
      remaining: Math.max(0, devLimit - nextDevUsed),
      resetIso: day.resetIso,
    };

    return new Response(upstreamText, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type":
          upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
        ...buildCorsHeaders(origin, env),
        ...trialHeaders(updatedQuota),
      },
    });
  };
}

const handler = createWorkerHandler();

export default {
  fetch: (request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> =>
    handler(request, env, ctx),
};
