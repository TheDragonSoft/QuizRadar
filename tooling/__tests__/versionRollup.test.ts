import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The rollup script needs itself, its import and the generator beside it
 * inside the sandbox (scriptDir-relative lookups), so the sandbox mirrors the
 * `tooling/` layout instead of pointing `--root` at a bare tree that would let
 * the child re-resolve into the real repo.
 */
const TOOLING_FILES = [
  "tooling/version-rollup.mjs",
  "tooling/generate-version.mjs",
  "tooling/lib/agent-utils.mjs",
  "tooling/version.json",
] as const;

/** Every sink the generator stamps, copied verbatim from the real repo. */
const SINK_PATHS = [
  "apps/web/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "Cargo.toml",
  "apps/mobile-android/app/build.gradle.kts",
  "apps/web/src/generated/version.ts",
] as const;

const FIXTURE_FILES = [
  ...TOOLING_FILES,
  ...SINK_PATHS,
  "Cargo.lock",
  "docs/STATUS.md",
  "CHANGELOG.md",
] as const;

const FRAGMENT = [
  "---",
  "bump: patch",
  "surfaces: [tooling]",
  "agent: version-rollup-test",
  "branch: fixture",
  "date: 2026-01-01",
  "---",
  "",
  "### Summary",
  "",
  "Throwaway fixture fragment driving the rollup against a sandbox tree.",
  "",
  "### Verification",
  "",
  "- sandbox-only apply; the real working tree is never written",
  "",
  "### Handoff / Follow-ups",
  "",
  "- None.",
  "",
].join("\n");

/** Minified-bundle shape: version strings inlined, variable names arbitrary. */
function swBundle(version: string): string {
  const head =
    'const W = "' +
    version +
    '", m = "quizradar-v' +
    version +
    '", p = `${m}-shell`, g = `${m}-cross-origin`, y = ["./", "./index.html"];\n';
  return head + 'self.addEventListener("install", () => {});\n';
}

const NO_VERSION_SW = 'self.addEventListener("install", () => {});\n';

describe("Version rollup restamps the tracked service worker", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const sandboxes: string[] = [];

  afterEach(() => {
    while (sandboxes.length > 0) {
      rmSync(sandboxes.pop()!, { recursive: true, force: true });
    }
  });

  /**
   * Build a throwaway tree holding the rollup script, its imports, every
   * version sink and a patch-bump fragment — everything `--apply` touches.
   * The service worker content is synthetic (the real one is a minified Vite
   * artifact); only the embedded version strings matter for the restamp.
   */
  function makeSandbox(swMode: "current" | "next" | "noVersion" | "missing"): {
    root: string;
    version: string;
    nextVersion: string;
  } {
    const sandbox = mkdtempSync(path.join(tmpdir(), "quizradar-rollup-"));
    sandboxes.push(sandbox);
    for (const rel of FIXTURE_FILES) {
      const dest = path.join(sandbox, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(repoRoot, rel), dest);
    }
    mkdirSync(path.join(sandbox, "docs/worklog"), { recursive: true });
    mkdirSync(path.join(sandbox, "changes"), { recursive: true });
    writeFileSync(path.join(sandbox, "changes", "rollup-fixture.md"), FRAGMENT, "utf8");

    const version = (
      JSON.parse(readFileSync(path.join(repoRoot, "tooling/version.json"), "utf8")) as {
        version: string;
      }
    ).version;
    const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    expect(semver).not.toBeNull();
    const nextVersion = `${semver![1]}.${semver![2]}.${Number(semver![3]) + 1}`;

    if (swMode !== "missing") {
      const swPath = path.join(sandbox, "apps/web/public/sw.js");
      mkdirSync(path.dirname(swPath), { recursive: true });
      const swContent =
        swMode === "noVersion"
          ? NO_VERSION_SW
          : swBundle(swMode === "current" ? version : nextVersion);
      writeFileSync(swPath, swContent, "utf8");
    }
    return { root: sandbox, version, nextVersion };
  }

  /** Run `--apply` in the sandbox; returns merged stdout+stderr (warnings go to stderr). */
  function apply(root: string): string {
    const res = spawnSync(
      process.execPath,
      [path.join(root, "tooling/version-rollup.mjs"), "--apply", "--root", root],
      { encoding: "utf8" },
    );
    expect(res.status, `${res.stdout ?? ""}${res.stderr ?? ""}`).toBe(0);
    return `${res.stdout ?? ""}${res.stderr ?? ""}`;
  }

  function readSw(root: string): string {
    return readFileSync(path.join(root, "apps/web/public/sw.js"), "utf8");
  }

  it("restamps apps/web/public/sw.js with the bumped version during --apply", () => {
    const { root, version, nextVersion } = makeSandbox("current");
    expect(readSw(root)).toContain(version);

    const output = apply(root);

    expect(output).toContain(`Restamped apps/web/public/sw.js -> ${nextVersion}`);
    const sw = readSw(root);
    expect(sw).toContain(`quizradar-v${nextVersion}`);
    expect(sw).toContain(nextVersion);
    expect(sw).not.toContain(`quizradar-v${version}`);
    expect(sw).not.toContain(version);
  });

  it("treats an already-restamped service worker as a no-op, not an error", () => {
    const { root, version, nextVersion } = makeSandbox("next");
    expect(readSw(root)).not.toContain(version);

    const output = apply(root);

    expect(output).toContain(`already stamped ${nextVersion}`);
    expect(readSw(root)).toBe(swBundle(nextVersion));
    // The bump itself still happened — only the worker was already current.
    expect(
      (
        JSON.parse(readFileSync(path.join(root, "tooling/version.json"), "utf8")) as {
          version: string;
        }
      ).version,
    ).toBe(nextVersion);
  });

  it("warns and continues when the service worker embeds no version at all", () => {
    const { root, nextVersion } = makeSandbox("noVersion");

    const output = apply(root);

    expect(output).toContain("embeds neither");
    expect(readSw(root)).toBe(NO_VERSION_SW);
    // The rest of the rollup still completed.
    expect(
      (
        JSON.parse(readFileSync(path.join(root, "tooling/version.json"), "utf8")) as {
          version: string;
        }
      ).version,
    ).toBe(nextVersion);
  });

  it("warns and continues when the tracked service worker is missing", () => {
    const { root, nextVersion } = makeSandbox("missing");
    expect(existsSync(path.join(root, "apps/web/public/sw.js"))).toBe(false);

    const output = apply(root);

    expect(output).toContain("not found");
    expect(
      (
        JSON.parse(readFileSync(path.join(root, "tooling/version.json"), "utf8")) as {
          version: string;
        }
      ).version,
    ).toBe(nextVersion);
  });
});
