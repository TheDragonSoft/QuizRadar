#!/usr/bin/env node
/**
 * Unified Multi-Agent Hygiene & Versioning Gate (`tooling/agent-gate.mjs`).
 *
 * Modes:
 *   node tooling/agent-gate.mjs --hook pre-commit [--root <dir>]
 *   node tooling/agent-gate.mjs --hook commit-msg <msg-file> [--root <dir>]
 *   node tooling/agent-gate.mjs --hook pre-push [--root <dir>]
 *   node tooling/agent-gate.mjs --ci [--base <ref>] [--head <ref>] [--root <dir>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCommitsBump,
  inferSurfacesFromPaths,
  listFragments,
  parseCliArgs,
  runGit,
  validateConventionalCommit,
} from "./lib/agent-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { flags, positionals } = parseCliArgs(process.argv.slice(2));
const repoRoot = flags.root
  ? path.resolve(process.cwd(), String(flags.root))
  : path.resolve(scriptDir, "..");

const STATUS_MAX_LINES = 250;

const FORBIDDEN_FILE_PATTERNS = [
  /(^|\/)\.env(\..+)?$/i,
  /\.(keystore|jks|pem|p12|db|sqlite)$/i,
  /(^|\/)(token|microsoft_token|credentials)\.json$/i,
  /(^|\/)client_secret[^/]*\.json$/i,
];

// Documented maintainer exception in AGENTS.md §3.2 (desktop shell only).
const SECRET_SCAN_ALLOWLIST = new Set(["apps/desktop/src-tauri/src/state.rs"]);

function isAllowedEnvExample(relPath) {
  return /(^|\/)\.env\.example$/i.test(relPath);
}

function checkVersionSinks(errors) {
  try {
    execFileSync(
      process.execPath,
      [path.join(scriptDir, "generate-version.mjs"), "--root", repoRoot, "--check"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    errors.push(
      `Version sinks out of sync with tooling/version.json.\n  ${stderr.trim() || "Run `node tooling/generate-version.mjs --apply`."}`,
    );
  }
}

function checkStatusLineCap(errors) {
  const statusPath = path.join(repoRoot, "docs/STATUS.md");
  if (!existsSync(statusPath)) return;
  const lineCount = readFileSync(statusPath, "utf8").replace(/\r\n/g, "\n").split("\n").length;
  if (lineCount > STATUS_MAX_LINES) {
    errors.push(
      `docs/STATUS.md is ${lineCount} lines (limit: ${STATUS_MAX_LINES}). Keep STATUS.md concise and record per-task handoffs in \`changes/<slug>.md\` via \`pnpm agent:note\`.`,
    );
  }
}

function checkFragmentsValidity(errors) {
  const fragments = listFragments(repoRoot);
  for (const f of fragments) {
    if (!f.valid) {
      errors.push(`Invalid fragment changes/${f.fileName}: ${f.errors.join(" ")}`);
    }
  }
  return fragments;
}

function checkSecretHygiene(relPaths, errors) {
  for (const rel of relPaths) {
    const norm = rel.replace(/\\/g, "/");
    if (isAllowedEnvExample(norm)) continue;
    if (FORBIDDEN_FILE_PATTERNS.some((re) => re.test(norm))) {
      errors.push(
        `Forbidden credential/database file staged: \`${norm}\` (AGENTS.md §3.2 / §3.8).`,
      );
      continue;
    }
    if (SECRET_SCAN_ALLOWLIST.has(norm)) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(norm) || norm.startsWith("core/tests/")) continue;

    const full = path.join(repoRoot, norm);
    if (!existsSync(full)) continue;
    let content = "";
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (/AIzaSy[A-Za-z0-9_-]{33}/.test(content)) {
      errors.push(`Potential Google API key literal detected in \`${norm}\` (AGENTS.md §3.2).`);
    }
    if (/GOCSPX-[A-Za-z0-9_-]{20,}/.test(content)) {
      errors.push(
        `OAuth client_secret literal detected in \`${norm}\` outside the sole AGENTS.md §3.2 exception.`,
      );
    }
  }
}

function resolveBaseRef(explicitBase) {
  if (explicitBase) return explicitBase;
  for (const candidate of ["origin/main", "main"]) {
    if (runGit(repoRoot, ["rev-parse", "--verify", candidate], { allowFailure: true }) !== null) {
      return candidate;
    }
  }
  return null;
}

function checkBranchRange({ baseRef, headRef, errors }) {
  const fragments = checkFragmentsValidity(errors);
  if (!baseRef) return;

  const mergeBase = runGit(repoRoot, ["merge-base", baseRef, headRef], { allowFailure: true });
  if (
    !mergeBase ||
    mergeBase === runGit(repoRoot, ["rev-parse", headRef], { allowFailure: true })
  ) {
    return;
  }

  const rawCommits =
    runGit(repoRoot, ["log", `${mergeBase}..${headRef}`, "--pretty=format:%h\x1f%s\x1f%b\x1e"], {
      allowFailure: true,
    }) ?? "";

  const commits = rawCommits
    .split("\x1e")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const [hash, subject = "", body = ""] = e.split("\x1f");
      return { hash: hash.trim(), subject: subject.trim(), body: body.trim() };
    });

  let hasSkipNote = false;
  let isReleaseCommitOnly = commits.length > 0;

  for (const c of commits) {
    if (/\[skip-note\]/i.test(`${c.subject}\n${c.body}`)) hasSkipNote = true;
    if (!/^chore\(release\):/i.test(c.subject)) isReleaseCommitOnly = false;
    const verdict = validateConventionalCommit(`${c.subject}\n${c.body}`);
    if (!verdict.ok) {
      errors.push(`Commit ${c.hash}: ${verdict.reason}`);
    }
  }

  if (
    /\[skip-note\]/i.test(process.env.PR_TITLE ?? "") ||
    /\[skip-note\]/i.test(process.env.PR_BODY ?? "") ||
    process.env.GITHUB_ACTOR === "dependabot[bot]" ||
    process.env.GITHUB_ACTOR === "github-actions[bot]" ||
    isReleaseCommitOnly
  ) {
    hasSkipNote = true;
  }

  const diffRaw =
    runGit(repoRoot, ["diff", "--name-only", `${mergeBase}...${headRef}`], {
      allowFailure: true,
    }) ?? "";
  const changedFiles = diffRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  checkSecretHygiene(changedFiles, errors);

  const touchesShippedCode = changedFiles.some(
    (f) => f.startsWith("core/") || f.startsWith("apps/"),
  );
  const inferredBump = classifyCommitsBump(commits);
  const needsFragment = (touchesShippedCode || inferredBump !== "none") && !hasSkipNote;

  if (needsFragment && fragments.length === 0) {
    const suggestedBump = inferredBump !== "none" ? inferredBump : "patch";
    const surfaces = inferSurfacesFromPaths(changedFiles);
    const surfArg = surfaces.length > 0 ? surfaces.join(",") : "core";
    errors.push(
      [
        "Missing agent handoff & version fragment in `changes/<slug>.md`.",
        "  Parallel agents communicate changes through per-branch fragments instead of editing STATUS.md or version.json.",
        "  Create one now with:",
        `    pnpm agent:note --bump ${suggestedBump} --surfaces ${surfArg} --summary "<what changed & why>" --verify "<commands run>"`,
        "  (Or include `[skip-note]` in the commit/PR body for trivial non-release housekeeping.)",
      ].join("\n"),
    );
  }
}

const hook = flags.hook ? String(flags.hook) : null;
const errors = [];

if (hook === "commit-msg") {
  const msgFile = positionals[0];
  if (!msgFile || !existsSync(msgFile)) {
    console.error("commit-msg hook requires path to commit message file.");
    process.exit(1);
  }
  const raw = readFileSync(msgFile, "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();

  const res = validateConventionalCommit(raw);
  if (!res.ok) {
    console.error(`\n[agent-gate] Invalid commit message:\n  ${res.reason}`);
    console.error(
      "  Examples: `feat(web): add landing hero`, `fix(core): handle empty ICS feed`, `docs(agents): clarify worktree handoff`\n",
    );
    process.exit(1);
  }
  process.exit(0);
}

if (hook === "pre-commit") {
  checkVersionSinks(errors);
  checkStatusLineCap(errors);
  checkFragmentsValidity(errors);

  const stagedRaw =
    runGit(repoRoot, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      allowFailure: true,
    }) ?? "";
  const stagedFiles = stagedRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  checkSecretHygiene(stagedFiles, errors);

  const currentBranch =
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || "";
  if (
    stagedFiles.includes("tooling/version.json") &&
    currentBranch !== "main" &&
    currentBranch !== "master" &&
    process.env.ALLOW_DIRECT_VERSION_EDIT !== "1"
  ) {
    errors.push(
      [
        "`tooling/version.json` is staged on a non-main branch.",
        "  To prevent 5-sink merge conflicts across parallel agents, leave `tooling/version.json` untouched on branches",
        "  and create `changes/<slug>.md` via `pnpm agent:note` — GitHub Actions bumps SemVer automatically on merge to `main`.",
        "  (Set `ALLOW_DIRECT_VERSION_EDIT=1` only when intentionally cutting a manual release branch.)",
      ].join("\n"),
    );
  }
} else if (hook === "pre-push") {
  checkVersionSinks(errors);
  checkStatusLineCap(errors);
  const currentBranch =
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || "";
  if (currentBranch !== "main" && currentBranch !== "master") {
    const baseRef = resolveBaseRef(flags.base ? String(flags.base) : null);
    checkBranchRange({ baseRef, headRef: "HEAD", errors });
  } else {
    checkFragmentsValidity(errors);
  }
} else if (flags.ci) {
  checkVersionSinks(errors);
  checkStatusLineCap(errors);
  const headRef = typeof flags.head === "string" ? flags.head : "HEAD";
  const baseRef = resolveBaseRef(typeof flags.base === "string" ? flags.base : null);
  if (baseRef && flags.base) {
    checkBranchRange({ baseRef, headRef, errors });
  } else {
    checkFragmentsValidity(errors);
  }
} else {
  console.error(
    "Specify `--hook <pre-commit|commit-msg|pre-push>` or `--ci [--base <sha> --head <sha>]`.",
  );
  process.exit(1);
}

if (errors.length > 0) {
  console.error(`\n[agent-gate] ${errors.length} check(s) failed:\n`);
  for (const err of errors) {
    console.error(`- ${err}\n`);
  }
  process.exit(1);
}

if (flags.ci) {
  console.log("[agent-gate] All multi-agent hygiene, commit, and version checks passed.");
}
