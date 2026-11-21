import { describe, expect, it } from "vitest";
import { createWorkerHandler, type Env, type QuotaKvLike } from "./index";

class MemoryKv implements QuotaKvLike {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

const VALID_BODY = JSON.stringify({
  contents: [{ parts: [{ text: "Extract courses" }] }],
  generationConfig: {
    temperature: 0.1,
    responseMimeType: "application/json",
  },
});

const TEST_INSTALL_ID = "qr_install_1234567890abcdef";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GEMINI_API_KEY: "test-edge-gemini-secret-value",
    TRIAL_DAILY_LIMIT: "2",
    TRIAL_IP_DAILY_LIMIT: "5",
    MAX_PAYLOAD_BYTES: "4096",
    ...overrides,
  };
}

describe("QuizRadar Trial AI Relay Worker", () => {
  it("answers GET /health without exposing secrets", async () => {
    const handler = createWorkerHandler();
    const res = await handler(new Request("https://trial.example/health"), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      service: "quizradar-trial-ai-relay",
      stateless: true,
      configured: true,
    });
  });

  it("enforces CORS origin allowlist and handles OPTIONS preflight", async () => {
    const handler = createWorkerHandler();
    const okPreflight = await handler(
      new Request("https://trial.example/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "OPTIONS",
        headers: { Origin: "https://thedragonsoft.github.io" },
      }),
      makeEnv(),
    );
    expect(okPreflight.status).toBe(204);
    expect(okPreflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://thedragonsoft.github.io",
    );

    const blocked = await handler(
      new Request("https://trial.example/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
          "x-quizradar-install-id": TEST_INSTALL_ID,
        },
        body: VALID_BODY,
      }),
      makeEnv(),
    );
    expect(blocked.status).toBe(403);
  });

  it("rejects Authorization headers, disallowed models, and non-JSON payloads", async () => {
    const handler = createWorkerHandler();
    const env = makeEnv();

    const authRejected = await handler(
      new Request("https://trial.example/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer oauth-should-never-pass",
          "x-quizradar-install-id": TEST_INSTALL_ID,
        },
        body: VALID_BODY,
      }),
      env,
    );
    expect(authRejected.status).toBe(400);

    const modelRejected = await handler(
      new Request("https://trial.example/v1beta/models/gemini-ultra-pro-max:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-quizradar-install-id": TEST_INSTALL_ID,
        },
        body: VALID_BODY,
      }),
      env,
    );
    expect(modelRejected.status).toBe(400);

    const nonJsonMode = await handler(
      new Request("https://trial.example/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-quizradar-install-id": TEST_INSTALL_ID,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "hello" }] }],
          generationConfig: { responseMimeType: "text/plain" },
        }),
      }),
      env,
    );
    expect(nonJsonMode.status).toBe(400);
  });

  it("forwards valid requests with x-goog-api-key, tracks KV quota, and returns 429 on exhaustion", async () => {
    const kv = new MemoryKv();
    let forwardedCount = 0;
    let sawApiKeyHeader = "";
    const handler = createWorkerHandler({
      now: () => new Date("2026-11-21T10:00:00.000Z"),
      fetchImpl: async (_url, init) => {
        forwardedCount += 1;
        sawApiKeyHeader = new Headers(init?.headers).get("x-goog-api-key") ?? "";
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"courses":[]}' }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const env = makeEnv({ TRIAL_QUOTA_KV: kv });

    const req = () =>
      new Request("https://trial.example/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-quizradar-install-id": TEST_INSTALL_ID,
          "x-quizradar-client": "web",
        },
        body: VALID_BODY,
      });

    const first = await handler(req(), env);
    expect(first.status).toBe(200);
    expect(sawApiKeyHeader).toBe("test-edge-gemini-secret-value");
    expect(first.headers.get("X-QuizRadar-Trial-Limit")).toBe("2");
    expect(first.headers.get("X-QuizRadar-Trial-Remaining")).toBe("1");

    const second = await handler(req(), env);
    expect(second.status).toBe(200);
    expect(second.headers.get("X-QuizRadar-Trial-Remaining")).toBe("0");

    const statusRes = await handler(
      new Request("https://trial.example/v1/trial/status", {
        headers: { "x-quizradar-install-id": TEST_INSTALL_ID },
      }),
      env,
    );
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toMatchObject({ limit: 2, used: 2, remaining: 0 });

    const third = await handler(req(), env);
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toBe("50400");
    expect(forwardedCount).toBe(2);
    const errBody = await third.json();
    expect(errBody.error.status).toBe("TRIAL_EXHAUSTED");
  });

  it("does not consume trial quota on upstream 404/503 and scrubs any key echo", async () => {
    const kv = new MemoryKv();
    const handler = createWorkerHandler({
      fetchImpl: async () =>
        new Response("Error near test-edge-gemini-secret-value model retired", { status: 404 }),
    });
    const env = makeEnv({ TRIAL_QUOTA_KV: kv });

    const res = await handler(
      new Request("https://trial.example/v1beta/models/gemini-3.8-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-quizradar-install-id": TEST_INSTALL_ID,
        },
        body: VALID_BODY,
      }),
      env,
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("test-edge-gemini-secret-value");
    expect(text).toContain("[redacted]");
    expect(res.headers.get("X-QuizRadar-Trial-Remaining")).toBe("2");
  });
});
