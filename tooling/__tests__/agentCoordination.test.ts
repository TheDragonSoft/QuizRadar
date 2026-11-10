import { execFileSync } from "node:child_process";
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

const SINK_PATHS = [
  "apps/web/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "Cargo.toml",
  "apps/mobile-android/app/build.gradle.kts",
  "apps/web/src/generated/version.ts",
] as const;

describe("Multi-Agent Versioning & Coordination Suite", { timeout: 30_000 }, () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const agentNote = path.join(repoRoot, "tooling/agent-note.mjs");
  const agentGate = path.join(repoRoot, "tooling/agent-gate.mjs");
  const agentPreflight = path.join(repoRoot, "tooling/agent-preflight.mjs");
  const versionRollup = path.join(repoRoot, "tooling/version-rollup.mjs");
  const generateVersion = path.join(repoRoot, "tooling/generate-version.mjs");
  const generateChangelog = path.join(repoRoot, "tooling/generate-changelog.mjs");

  const sandboxes: string[] = [];

  afterEach(() => {
    while (sandboxes.length > 0) {
      rmSync(sandboxes.pop()!, { recursive: true, force: true });
    }
  });

  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  }

  function runNode(
    script: string,
    args: string[],
    envOverrides: Record<string, string> = {},
  ): { ok: boolean; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [script, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...envOverrides },
      });
      return { ok: true, stdout, stderr: "" };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return {
        ok: false,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
  }

  /**
   * Build an isolated temporary git repository initialized at `v5.0.0` on `main`
   * with all 5 version sinks, minimal Cargo.lock, STATUS.md, and changes/ templates.
   */
  function makeGitSandbox(): string {
    const sandbox = mkdtempSync(path.join(tmpdir(), "quizradar-agent-coord-"));
    sandboxes.push(sandbox);

    const copyFromRepo = (rel: string) => {
      const dest = path.join(sandbox, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(repoRoot, rel), dest);
    };

    writeFileSync(
      path.join(sandbox, "tooling/version.json"),
      (() => {
        mkdirSync(path.join(sandbox, "tooling"), { recursive: true });
        return JSON.stringify({ version: "5.0.0" }, null, 2) + "\n";
      })(),
      "utf8",
    );
    for (const sink of SINK_PATHS) copyFromRepo(sink);
    // Ensure sandbox sinks match 5.0.0 regardless of what main advances to in the future
    execFileSync(process.execPath, [generateVersion, "--root", sandbox], { stdio: "pipe" });

    writeFileSync(
      path.join(sandbox, "Cargo.lock"),
      [
        "[[package]]",
        'name = "quizradar-core"',
        'version = "5.0.0"',
        "",
        "[[package]]",
        'name = "quizradar-desktop"',
        'version = "5.0.0"',
        "",
        "[[package]]",
        'name = "quizradar-wasm"',
        'version = "5.0.0"',
        "",
        "[[package]]",
        'name = "serde"',
        'version = "1.0.210"',
        "",
      ].join("\n"),
      "utf8",
    );

    mkdirSync(path.join(sandbox, "docs"), { recursive: true });
    writeFileSync(
      path.join(sandbox, "docs/STATUS.md"),
      "# STATUS\n\n- **Current Version:** `5.0.0`\n",
      "utf8",
    );

    mkdirSync(path.join(sandbox, "changes"), { recursive: true });
    writeFileSync(path.join(sandbox, "changes/README.md"), "# Changes\n", "utf8");
    writeFileSync(path.join(sandbox, "changes/_TEMPLATE.md"), "# Template\n", "utf8");

    git(sandbox, ["init", "-b", "main"]);
    git(sandbox, ["config", "user.name", "Test Bot"]);
    git(sandbox, ["config", "user.email", "bot@example.com"]);

    // Seed historical v4-final commit so tag-range tests prove v4-final is NOT re-dumped
    writeFileSync(path.join(sandbox, "LEGACY.txt"), "v4 legacy\n", "utf8");
    git(sandbox, ["add", "LEGACY.txt"]);
    git(sandbox, ["commit", "-m", "chore: legacy v4 final"]);
    git(sandbox, ["tag", "v4-final"]);

    git(sandbox, ["add", "-A"]);
    git(sandbox, ["commit", "-m", "chore(release): v5.0.0 baseline"]);
    git(sandbox, ["tag", "v5.0.0"]);

    return sandbox;
  }

  it("creates, lists, and validates conflict-free branch fragments via agent-note.mjs", () => {
    const sandbox = makeGitSandbox();
    git(sandbox, ["checkout", "-b", "feature/non-ai-suite"]);

    const createRes = runNode(agentNote, [
      "--root",
      sandbox,
      "--bump",
      "minor",
      "--surfaces",
      "core,web",
      "--agent",
      "antigravity",
      "--date",
      "2026-11-08",
      "--summary",
      "Add deterministic non-AI fallback suite across parser and roadmap",
      "--verify",
      "cargo test --workspace; pnpm test",
      "--handoff",
      "Android Compose badge uses existing provenance string",
    ]);
    expect(createRes.ok).toBe(true);
    expect(existsSync(path.join(sandbox, "changes/feature-non-ai-suite.md"))).toBe(true);

    const valRes = runNode(agentNote, ["--root", sandbox, "--validate"]);
    expect(valRes.ok).toBe(true);

    const listRes = runNode(agentNote, ["--root", sandbox, "--list", "--json"]);
    expect(listRes.ok).toBe(true);
    const parsed = JSON.parse(listRes.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      slug: "feature-non-ai-suite",
      bump: "minor",
      surfaces: ["core", "web"],
      agent: "antigravity",
      branch: "feature/non-ai-suite",
      valid: true,
    });
  });

  it("rejects malformed or TODO-placeholder fragments during validation", () => {
    const sandbox = makeGitSandbox();
    writeFileSync(
      path.join(sandbox, "changes/bad-note.md"),
      "---\nbump: supermajor\nsurfaces: [mars]\n---\n\n### Summary\nTODO fill in\n",
      "utf8",
    );
    const valRes = runNode(agentNote, ["--root", sandbox, "--validate"]);
    expect(valRes.ok).toBe(false);
    expect(valRes.stderr).toContain("Invalid or missing `bump");
    expect(valRes.stderr).toContain("Unknown surface(s): mars");
    expect(valRes.stderr).toContain("placeholder text");
  });

  it("enforces Conventional Commits, STATUS line cap, secret hygiene, and PR fragment presence in agent-gate.mjs", () => {
    const sandbox = makeGitSandbox();

    // 1. commit-msg check
    const badMsg = path.join(sandbox, "BAD_COMMIT_MSG");
    writeFileSync(badMsg, "updated stuff randomly\n", "utf8");
    expect(runNode(agentGate, ["--root", sandbox, "--hook", "commit-msg", badMsg]).ok).toBe(false);

    const goodMsg = path.join(sandbox, "GOOD_COMMIT_MSG");
    writeFileSync(goodMsg, "feat(web): add multi-agent conflict radar\n", "utf8");
    expect(runNode(agentGate, ["--root", sandbox, "--hook", "commit-msg", goodMsg]).ok).toBe(true);

    // 2. Feature branch touching core/ without a changes/*.md fragment fails CI gate
    const baseSha = git(sandbox, ["rev-parse", "HEAD"]);
    git(sandbox, ["checkout", "-b", "feat/missing-fragment"]);
    mkdirSync(path.join(sandbox, "core/src"), { recursive: true });
    writeFileSync(path.join(sandbox, "core/src/example.rs"), "pub fn ok() -> bool { true }\n");
    git(sandbox, ["add", "core/src/example.rs"]);
    git(sandbox, ["commit", "-m", "feat(core): add helper check"]);
    const headMissing = git(sandbox, ["rev-parse", "HEAD"]);

    const ciMissing = runNode(agentGate, [
      "--root",
      sandbox,
      "--ci",
      "--base",
      baseSha,
      "--head",
      headMissing,
    ]);
    expect(ciMissing.ok).toBe(false);
    expect(ciMissing.stderr).toContain("Missing agent handoff & version fragment");
    expect(ciMissing.stderr).toContain("pnpm agent:note");

    // 3. Adding the fragment satisfies the CI gate
    expect(
      runNode(agentNote, [
        "--root",
        sandbox,
        "--bump",
        "minor",
        "--surfaces",
        "core",
        "--agent",
        "claude",
        "--summary",
        "Add helper check in core crate",
        "--verify",
        "cargo test -p quizradar-core",
      ]).ok,
    ).toBe(true);
    git(sandbox, ["add", "changes/"]);
    git(sandbox, ["commit", "-m", "docs(changes): record core helper handoff"]);
    const headWithFragment = git(sandbox, ["rev-parse", "HEAD"]);

    const ciPass = runNode(agentGate, [
      "--root",
      sandbox,
      "--ci",
      "--base",
      baseSha,
      "--head",
      headWithFragment,
    ]);
    expect(ciPass.ok).toBe(true);

    // 4. STATUS.md bloat guard (> 250 lines) blocks regressions back to 2,000-line dumps
    writeFileSync(
      path.join(sandbox, "docs/STATUS.md"),
      Array.from({ length: 265 }, (_, i) => `Line ${i + 1}`).join("\n"),
      "utf8",
    );
    const bloatRes = runNode(agentGate, ["--root", sandbox, "--hook", "pre-commit"]);
    expect(bloatRes.ok).toBe(false);
    expect(bloatRes.stderr).toContain("docs/STATUS.md is 265 lines (limit: 250)");
  });

  it("rolls up parallel agent fragments, bumps 5 sinks + Cargo.lock, writes CHANGELOG & worklog, and cleans changes/", () => {
    const sandbox = makeGitSandbox();

    // Agent 1 commits a patch fragment
    runNode(agentNote, [
      "--root",
      sandbox,
      "--slug",
      "fix-ics-timezone",
      "--bump",
      "patch",
      "--surfaces",
      "core",
      "--agent",
      "jules",
      "--branch",
      "fix/ics-timezone",
      "--date",
      "2026-11-08",
      "--summary",
      "Preserve floating local timestamps on all-day ICS exports",
      "--verify",
      "cargo test -p quizradar-core",
    ]);
    git(sandbox, ["add", "changes/fix-ics-timezone.md"]);
    git(sandbox, ["commit", "-m", "fix(core): preserve floating local timestamps on ICS export"]);

    // Agent 2 commits a minor fragment in parallel
    runNode(agentNote, [
      "--root",
      sandbox,
      "--slug",
      "feat-landing-hero",
      "--bump",
      "minor",
      "--surfaces",
      "web,desktop",
      "--agent",
      "antigravity",
      "--branch",
      "feat/landing-hero",
      "--date",
      "2026-11-08",
      "--summary",
      "Ship responsive radar overview card on web and desktop shells",
      "--verify",
      "pnpm lint; pnpm test",
      "--handoff",
      "Android Glance widget already displays the equivalent badge",
    ]);
    git(sandbox, ["add", "changes/feat-landing-hero.md"]);
    git(sandbox, ["commit", "-m", "feat(web): ship responsive radar overview card"]);

    // Dry-run verifies max(patch, minor) = minor (5.0.0 -> 5.1.0) without mutating files
    const dryRes = runNode(versionRollup, ["--root", sandbox, "--dry-run", "--json"]);
    expect(dryRes.ok).toBe(true);
    const dryPlan = JSON.parse(dryRes.stdout);
    expect(dryPlan).toMatchObject({
      hasWork: true,
      currentVersion: "5.0.0",
      nextVersion: "5.1.0",
      bump: "minor",
      fragmentCount: 2,
      applied: false,
    });

    // Apply rollup
    const applyRes = runNode(versionRollup, ["--root", sandbox, "--apply", "--date", "2026-11-08"]);
    expect(applyRes.ok).toBe(true);

    // 1. Version JSON + all 5 sinks match 5.1.0
    expect(
      JSON.parse(readFileSync(path.join(sandbox, "tooling/version.json"), "utf8")).version,
    ).toBe("5.1.0");
    expect(runNode(generateVersion, ["--root", sandbox, "--check"]).ok).toBe(true);

    // 2. Cargo.lock workspace crates bumped to 5.1.0 while external serde stayed 1.0.210
    const cargoLock = readFileSync(path.join(sandbox, "Cargo.lock"), "utf8");
    expect(cargoLock).toContain('name = "quizradar-core"\nversion = "5.1.0"');
    expect(cargoLock).toContain('name = "quizradar-desktop"\nversion = "5.1.0"');
    expect(cargoLock).toContain('name = "quizradar-wasm"\nversion = "5.1.0"');
    expect(cargoLock).toContain('name = "serde"\nversion = "1.0.210"');

    // 3. STATUS.md badge updated
    expect(readFileSync(path.join(sandbox, "docs/STATUS.md"), "utf8")).toContain(
      "- **Current Version:** `5.1.0`",
    );

    // 4. CHANGELOG.md contains [5.1.0] with both agent summaries
    const changelog = readFileSync(path.join(sandbox, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## [5.1.0] — 2026-11-08");
    expect(changelog).toContain("**[web, desktop]** Ship responsive radar overview card");
    expect(changelog).toContain("**[core]** Preserve floating local timestamps");

    // 5. Worklog archived with handoff notes & fragments cleaned up (templates kept!)
    const worklog = readFileSync(path.join(sandbox, "docs/worklog/2026-11.md"), "utf8");
    expect(worklog).toContain("Android Glance widget already displays the equivalent badge");
    expect(existsSync(path.join(sandbox, "changes/fix-ics-timezone.md"))).toBe(false);
    expect(existsSync(path.join(sandbox, "changes/feat-landing-hero.md"))).toBe(false);
    expect(existsSync(path.join(sandbox, "changes/README.md"))).toBe(true);
    expect(existsSync(path.join(sandbox, "changes/_TEMPLATE.md"))).toBe(true);

    // Commit the release rollup as GitHub Actions does, then verify tag-aware release notes!
    git(sandbox, ["add", "-A"]);
    git(sandbox, ["commit", "-m", "chore(release): bump version to v5.1.0"]);

    // 6. Tag-aware generate-changelog.mjs diffs v5.0.0..HEAD (NOT v4-final..HEAD) and skips chore(release)
    const notesRes = runNode(generateChangelog, ["--root", sandbox, "--notes-only"]);
    expect(notesRes.ok).toBe(true);
    expect(notesRes.stdout).toContain("_Changes since `v5.0.0`:_");
    expect(notesRes.stdout).toContain("Ship responsive radar overview card");
    expect(notesRes.stdout).not.toContain("legacy v4 final");
    expect(notesRes.stdout).not.toContain("chore(release): bump version to v5.1.0");

    // 7. Re-running generate-changelog.mjs without --notes-only replaces [5.1.0] idempotently (never duplicates!)
    expect(runNode(generateChangelog, ["--root", sandbox, "--date", "2026-11-08"]).ok).toBe(true);
    expect(runNode(generateChangelog, ["--root", sandbox, "--date", "2026-11-08"]).ok).toBe(true);
    const afterTwoRuns = readFileSync(path.join(sandbox, "CHANGELOG.md"), "utf8");
    const headerMatches = afterTwoRuns.match(/^## \[5\.1\.0\]/gm) ?? [];
    expect(headerMatches).toHaveLength(1);
  });

  it("runs agent-preflight.mjs --json cleanly against the live repository", () => {
    const res = runNode(agentPreflight, ["--json"]);
    expect(res.ok).toBe(true);
    const payload = JSON.parse(res.stdout);
    expect(payload.version.sinksInSync).toBe(true);
    expect(Array.isArray(payload.worktrees)).toBe(true);
    expect(Array.isArray(payload.requiredGates)).toBe(true);
  });

  it("creates a git tag when --tag is passed with --apply", () => {
    const sandbox = makeGitSandbox();

    runNode(agentNote, [
      "--root",
      sandbox,
      "--slug",
      "feat-tag-test",
      "--bump",
      "minor",
      "--surfaces",
      "core",
      "--agent",
      "antigravity",
      "--branch",
      "feat/tag-test",
      "--date",
      "2026-11-10",
      "--summary",
      "Add auto tag capability on rollup",
      "--verify",
      "pnpm test:tooling",
    ]);

    const res = runNode(versionRollup, [
      "--root",
      sandbox,
      "--apply",
      "--tag",
      "--date",
      "2026-11-10",
    ]);
    expect(res.ok).toBe(true);

    const tags = git(sandbox, ["tag", "-l"]);
    expect(tags).toContain("v5.1.0");
  });
});
