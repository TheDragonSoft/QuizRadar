import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Every file the version generator stamps. The sandbox mirrors these paths so
 * the generator can be exercised against a throwaway tree — the test never
 * rewrites a tracked file in the working tree.
 */
const SINK_PATHS = [
  "apps/web/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "Cargo.toml",
  "apps/mobile-android/app/build.gradle.kts",
  "apps/web/src/generated/version.ts",
] as const;

describe("Version Pipeline Integrity (Phase 15)", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const generator = path.join(repoRoot, "tooling/generate-version.mjs");
  const versionJsonPath = path.join(repoRoot, "tooling/version.json");
  const versionJson = JSON.parse(readFileSync(versionJsonPath, "utf8"));
  const sandboxes: string[] = [];

  afterEach(() => {
    while (sandboxes.length > 0) {
      rmSync(sandboxes.pop()!, { recursive: true, force: true });
    }
  });

  /** Build a throwaway tree holding a copy of the version source + every sink. */
  function makeSandbox(): string {
    const sandbox = mkdtempSync(path.join(tmpdir(), "quizradar-version-"));
    sandboxes.push(sandbox);
    const copy = (rel: string) => {
      const dest = path.join(sandbox, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(repoRoot, rel), dest);
    };
    copy("tooling/version.json");
    for (const sink of SINK_PATHS) copy(sink);
    return sandbox;
  }

  function check(root: string): { ok: boolean; output: string } {
    try {
      const output = execSync(`node "${generator}" --root "${root}" --check`, {
        encoding: "utf8",
        stdio: "pipe",
      });
      return { ok: true, output };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  it("stamps version.ts with APP_VERSION and the SW cache key from tooling/version.json", () => {
    const versionTs = readFileSync(
      path.join(repoRoot, "apps/web/src/generated/version.ts"),
      "utf8",
    );
    const app = /export const APP_VERSION = "([^"]+)";/.exec(versionTs);
    expect(app).not.toBeNull();
    expect(app![1]).toBe(versionJson.version);
    const sw = /export const SW_CACHE_KEY_PREFIX = "([^"]+)";/.exec(versionTs);
    expect(sw).not.toBeNull();
    expect(sw![1]).toBe(`quizradar-v${versionJson.version}`);
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

  it("detects a stale sink in an isolated sandbox without touching the repo", () => {
    const sandbox = makeSandbox();
    expect(check(sandbox).ok).toBe(true);

    const cargoTomlPath = path.join(sandbox, "Cargo.toml");
    writeFileSync(
      cargoTomlPath,
      readFileSync(cargoTomlPath, "utf8").replace(
        /^(version = ")[^"]*(")$/m,
        (_m, head: string, tail: string) => `${head}9.9.99${tail}`,
      ),
      "utf8",
    );

    const failed = check(sandbox);
    expect(failed.ok).toBe(false);
    expect(failed.output).toContain("Cargo.toml");
  });

  /**
   * Perturb one sink so the staleness check must notice it, while keeping the
   * file structurally valid. A sink broken in a way the generator cannot parse
   * is a *different* failure mode and gets its own test below — mixing the two
   * would let one mask the other.
   */
  function tamper(sink: string, file: string): void {
    const original = readFileSync(file, "utf8");
    switch (sink) {
      case "apps/web/package.json":
      case "apps/desktop/src-tauri/tauri.conf.json": {
        const json = JSON.parse(original);
        json.version = "9.9.99";
        writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf8");
        return;
      }
      case "Cargo.toml":
        expect(original).toMatch(/^version = "[^"]*"$/m);
        writeFileSync(
          file,
          original.replace(
            /^(version = ")[^"]*(")$/m,
            (_m, head: string, tail: string) => `${head}9.9.99${tail}`,
          ),
          "utf8",
        );
        return;
      case "apps/mobile-android/app/build.gradle.kts":
        expect(original).toMatch(/^\s*versionName = "[^"]*"$/m);
        writeFileSync(
          file,
          original.replace(
            /^(\s*versionName = ")[^"]*(")$/m,
            (_m, head: string, tail: string) => `${head}9.9.99${tail}`,
          ),
          "utf8",
        );
        return;
      case "apps/web/src/generated/version.ts":
        writeFileSync(
          file,
          original.replace(
            /(APP_VERSION = ")[^"]*(")/,
            (_m, head: string, tail: string) => `${head}9.9.99${tail}`,
          ),
          "utf8",
        );
        return;
      default:
        throw new Error(`unknown sink ${sink}`);
    }
  }

  it.each(SINK_PATHS)("detects a tampered %s", (sink) => {
    const sandbox = makeSandbox();
    const sinkPath = path.join(sandbox, sink);
    tamper(sink, sinkPath);

    const failed = check(sandbox);
    expect(failed.ok).toBe(false);
    expect(failed.output).toContain(sink);
  });

  it("reports an unparseable sink by name instead of crashing the generator", () => {
    const sandbox = makeSandbox();
    writeFileSync(path.join(sandbox, "apps/web/package.json"), "{ not json", "utf8");

    const failed = check(sandbox);
    expect(failed.ok).toBe(false);
    // The sink must be named — a bare stack trace would leave the reader
    // guessing which of the five sinks went bad.
    expect(failed.output).toContain("apps/web/package.json");
  });

  it("re-stamps every sink from tooling/version.json", () => {
    const sandbox = makeSandbox();
    for (const sink of SINK_PATHS) {
      tamper(sink, path.join(sandbox, sink));
    }
    expect(check(sandbox).ok).toBe(false);

    execSync(`node "${generator}" --root "${sandbox}"`, { encoding: "utf8" });
    expect(check(sandbox).ok).toBe(true);
  });
});
