import { describe, expect, it } from "vitest";
import { APP_VERSION, SW_CACHE_KEY_PREFIX } from "./generated/version";

describe("generated version surface", () => {
  it("carries a semver-shaped APP_VERSION (stamped by tooling)", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.\-+]+)?$/);
  });

  it("derives the SW cache key from APP_VERSION (phase 11 consumes it)", () => {
    expect(SW_CACHE_KEY_PREFIX).toBe(`quizradar-v${APP_VERSION}`);
  });

  it("matches the vite-baked __APP_VERSION__ define", () => {
    expect(__APP_VERSION__).toBe(APP_VERSION);
  });
});
