import { describe, expect, it } from "vitest";
import worker, { validateEventPayload } from "./index";

describe("QuizRadar Zero-PII Diagnostics Worker", () => {
  it("reports healthy zero-PII status on GET /health", async () => {
    const res = await worker.fetch(
      new Request("https://diagnostics.quizradar.workers.dev/health"),
      {},
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.zeroPii).toBe(true);
  });

  it("accepts allowlisted funnel events and increments aggregate KV counter without PII", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
    } as unknown as KVNamespace;

    const req = new Request("https://diagnostics.quizradar.workers.dev/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://thedragonsoft.github.io",
      },
      body: JSON.stringify({
        event: "syllabus_imported",
        platform: "web",
        version: "5.20.0",
        mode: "trial",
        success: true,
      }),
    });

    const res = await worker.fetch(req, { DIAGNOSTICS_KV: kv });
    expect(res.status).toBe(202);
    expect(store.size).toBe(1);
    const [key, val] = [...store.entries()][0];
    expect(key).toContain(":syllabus_imported:web:trial:ok");
    expect(val).toBe("1");
  });

  it("rejects Authorization headers, unknown fields, and PII-shaped values", async () => {
    const authRes = await worker.fetch(
      new Request("https://diagnostics.quizradar.workers.dev/v1/events", {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify({ event: "app_opened", platform: "desktop" }),
      }),
      {},
    );
    expect(authRes.status).toBe(400);

    expect(validateEventPayload({ event: "app_opened", email: "student@univ.edu" }).ok).toBe(false);
    expect(validateEventPayload({ event: "crash_report", errorCode: "user@univ.edu" }).ok).toBe(
      false,
    );
    expect(validateEventPayload({ event: "arbitrary_custom_event" }).ok).toBe(false);
  });
});
