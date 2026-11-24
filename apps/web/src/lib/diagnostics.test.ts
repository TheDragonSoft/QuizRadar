import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAndEmitDay7Return,
  isDiagnosticsEnabled,
  sanitizeCrashCode,
  setDiagnosticsEnabled,
  trackActivationEvent,
} from "./diagnostics";

describe("Privacy-First Zero-PII Diagnostics Client", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to enabled and honors instant opt-out with zero network traffic", async () => {
    expect(isDiagnosticsEnabled()).toBe(true);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    const sent = await trackActivationEvent(
      { event: "syllabus_imported", mode: "trial", success: true, version: "5.20.0" },
      mockFetch as unknown as typeof fetch,
    );
    expect(sent).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    setDiagnosticsEnabled(false);
    expect(isDiagnosticsEnabled()).toBe(false);

    const blocked = await trackActivationEvent(
      { event: "app_opened", version: "5.20.0" },
      mockFetch as unknown as typeof fetch,
    );
    expect(blocked).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes crash codes and strips unsafe characters", () => {
    expect(sanitizeCrashCode(new TypeError("cannot read email@univ.edu"))).toBe("TypeError");
    expect(sanitizeCrashCode("ERR_WASM: failed /home/alice")).toBe("ERR_WASM:_failed__home_alice");
  });

  it("emits day_7_return once after 7 elapsed days", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const day0 = new Date("2026-11-01T10:00:00Z");
    const day3 = new Date("2026-11-04T10:00:00Z");
    const day8 = new Date("2026-11-09T10:00:00Z");

    expect(await checkAndEmitDay7Return(day0, "5.20.0", mockFetch as unknown as typeof fetch)).toBe(
      false,
    );
    expect(await checkAndEmitDay7Return(day3, "5.20.0", mockFetch as unknown as typeof fetch)).toBe(
      false,
    );
    expect(await checkAndEmitDay7Return(day8, "5.20.0", mockFetch as unknown as typeof fetch)).toBe(
      true,
    );
    // Second call after day 7 is deduplicated.
    expect(await checkAndEmitDay7Return(day8, "5.20.0", mockFetch as unknown as typeof fetch)).toBe(
      false,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
