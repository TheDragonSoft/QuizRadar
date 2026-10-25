import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, SW_CACHE_KEY_PREFIX } from "./generated/version";

describe("Version Pipeline Integrity (Phase 15)", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  const versionJsonPath = path.join(repoRoot, "tooling/version.json");
  const versionJson = JSON.parse(readFileSync(versionJsonPath, "utf8"));

  it("stamps APP_VERSION matching tooling/version.json exactly", () => {
    expect(APP_VERSION).toBe(versionJson.version);
    expect(SW_CACHE_KEY_PREFIX).toBe(`quizradar-v${versionJson.version}`);
  });

  it("calculates versionCode monotonically from semver", () => {
    const semver = /^(\d+)\.(\d+)\.(\d+)/.exec(versionJson.version);
    expect(semver).not.toBeNull();
    const [, major, minor, patch] = semver!;
    const expectedCode = Number(major) * 10000 + Number(minor) * 100 + Number(patch);

    // Verify build.gradle.kts has this exact versionCode
    const gradle = readFileSync(
      path.join(repoRoot, "apps/mobile-android/app/build.gradle.kts"),
      "utf8",
    );
    const codeMatch = /versionCode = (\d+)/.exec(gradle);
    expect(codeMatch).not.toBeNull();
    expect(Number(codeMatch![1])).toBe(expectedCode);
  });

  it("node tooling/generate-version.mjs --check passes on clean sinks", () => {
    const output = execSync("node tooling/generate-version.mjs --check", {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(output).toContain("all 5 sinks in sync");
  });

  it("node tooling/generate-version.mjs --check fails when a sink is tampered (self-test)", () => {
    const cargoTomlPath = path.join(repoRoot, "Cargo.toml");
    const original = readFileSync(cargoTomlPath, "utf8");
    try {
      const tampered = original.replace(/version = "[^"]*"/, 'version = "9.9.99"');
      let failed = false;
      try {
        writeFileSync(cargoTomlPath, tampered, "utf8");
        execSync("node tooling/generate-version.mjs --check", {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      writeFileSync(cargoTomlPath, original, "utf8");
    }
  });
});
