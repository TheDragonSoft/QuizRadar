#!/usr/bin/env node
/**
 * Roll up conflict-free agent fragments (`changes/*.md`) + conventional commits
 * into a single atomic SemVer release bump on `main`.
 *
 * Usage:
 *   node tooling/version-rollup.mjs --dry-run
 *   node tooling/version-rollup.mjs --apply [--bump patch|minor|major] [--date YYYY-MM-DD]
 *
 * What `--apply` updates:
 *   1. `tooling/version.json` + all 5 version sinks via `generate-version.mjs` (when bump != none)
 *   2. Workspace crate versions in `Cargo.lock` (`quizradar-core`, `quizradar-desktop`, `quizradar-wasm`)
 *   3. `docs/STATUS.md` live version header (if present)
 *   4. `CHANGELOG.md` (prepends/replaces `## [X.Y.Z] — YYYY-MM-DD` with agent summaries + commits)
 *   5. `apps/web/public/sw.js` (restamps the version strings baked into the tracked
 *      PWA service worker so its cache names follow the release; when bump != none)
 *   6. `docs/worklog/YYYY-MM.md` (archives full agent verification & handoff notes)
 *   7. Deletes consumed `changes/*.md` fragments so `changes/` starts clean for the next cycle.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bumpSemver,
  classifyCommitsBump,
  findPreviousSemverTag,
  listFragments,
  maxBump,
  parseCliArgs,
  runGit,
  VALID_BUMPS,
} from "./lib/agent-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { flags } = parseCliArgs(process.argv.slice(2));
const repoRoot = flags.root
  ? path.resolve(process.cwd(), String(flags.root))
  : path.resolve(scriptDir, "..");

const apply = Boolean(flags.apply);
const createTag = Boolean(flags.tag);
const todayIso =
  typeof flags.date === "string" && flags.date.trim()
    ? flags.date.trim()
    : new Date().toISOString().slice(0, 10);

const versionJsonPath = path.join(repoRoot, "tooling/version.json");
const currentVersion = JSON.parse(readFileSync(versionJsonPath, "utf8")).version;

const fragments = listFragments(repoRoot);
const invalidFragments = fragments.filter((f) => !f.valid);
if (invalidFragments.length > 0) {
  console.error("Cannot roll up: invalid fragment(s) in changes/:");
  for (const f of invalidFragments) {
    console.error(`  - changes/${f.fileName}: ${f.errors.join("; ")}`);
  }
  process.exit(1);
}

// Determine baseline commit for conventional-commit scanning:
// Priority: explicit `--since` -> whichever ancestor of HEAD is MORE RECENT between
// the last commit modifying `tooling/version.json` and the latest `v*` SemVer tag.
// (Handles tags cut after `version.json` was already stamped, AND auto-bumps between tags.)
let baselineRef = typeof flags.since === "string" ? flags.since.trim() : null;
if (!baselineRef) {
  const versionCommit = runGit(
    repoRoot,
    ["log", "-n", "1", "--format=%H", "--", "tooling/version.json"],
    { allowFailure: true },
  );
  const tagRef = findPreviousSemverTag(repoRoot, currentVersion, {
    toRef: "HEAD",
    inclusive: true,
  });
  const tagCommit = tagRef
    ? runGit(repoRoot, ["rev-list", "-n", "1", tagRef], { allowFailure: true })
    : null;

  if (versionCommit && tagCommit) {
    // If versionCommit is an ancestor of tagCommit, tagCommit is newer (or equal).
    const versionOlderOrEqual =
      runGit(repoRoot, ["merge-base", "--is-ancestor", versionCommit, tagCommit], {
        allowFailure: true,
      }) !== null;
    baselineRef = versionOlderOrEqual ? tagRef : versionCommit;
  } else {
    baselineRef = versionCommit || tagRef;
  }
}

let commits = [];
if (baselineRef) {
  const raw = runGit(
    repoRoot,
    ["log", `${baselineRef}..HEAD`, "--pretty=format:%h\x1f%s\x1f%b\x1e"],
    { allowFailure: true },
  );
  if (raw) {
    commits = raw
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, subject, body = ""] = entry.split("\x1f");
        return { hash: hash.trim(), subject: (subject ?? "").trim(), body: body.trim() };
      })
      .filter((c) => c.hash && !/^chore\(release\):/i.test(c.subject));
  }
}

let computedBump = classifyCommitsBump(commits);
for (const f of fragments) {
  computedBump = maxBump(computedBump, f.bump);
}

if (typeof flags.bump === "string" && flags.bump.trim()) {
  const forced = flags.bump.trim().toLowerCase();
  if (!VALID_BUMPS.includes(forced)) {
    console.error(`Invalid --bump "${forced}" (expected ${VALID_BUMPS.join("|")}).`);
    process.exit(1);
  }
  computedBump = maxBump(computedBump, forced);
}

const nextVersion = bumpSemver(currentVersion, computedBump);
const hasWork = computedBump !== "none" || fragments.length > 0;

function renderChangelogSection(version, dateStr, usedFragments, usedCommits) {
  const lines = [`## [${version}] — ${dateStr}`, ""];

  if (usedFragments.length > 0) {
    lines.push("### 🤝 Agent & Contributor Summaries");
    lines.push("");
    for (const [index, f] of usedFragments.entries()) {
      // Keep exactly one blank line between fragment bullet blocks: Prettier
      // requires it once a bullet carries indented continuation lines.
      if (index > 0 && lines[lines.length - 1] !== "") lines.push("");
      const surfaceTag = f.surfaces.length > 0 ? `**[${f.surfaces.join(", ")}]** ` : "";
      const summaryLines = f.summary.split("\n");
      lines.push(`- ${surfaceTag}${summaryLines[0]}`);
      for (const extra of summaryLines.slice(1)) {
        lines.push(extra ? `  ${extra}` : "");
      }
    }
    lines.push("");
  }

  const feats = [];
  const fixes = [];
  const other = [];
  for (const c of usedCommits) {
    const bullet = `- \`${c.hash}\` ${c.subject}`;
    if (/^feat(\([^)]+\))?!?:/.test(c.subject)) feats.push(bullet);
    else if (/^(fix|perf|revert)(\([^)]+\))?!?:/.test(c.subject)) fixes.push(bullet);
    else other.push(bullet);
  }

  if (feats.length > 0) {
    lines.push("### 🚀 New Features");
    lines.push("");
    lines.push(...feats);
    lines.push("");
  }
  if (fixes.length > 0) {
    lines.push("### 🐛 Fixes & Performance");
    lines.push("");
    lines.push(...fixes);
    lines.push("");
  }
  if (other.length > 0) {
    lines.push("### 🔧 Maintenance, Docs & Tests");
    lines.push("");
    lines.push(...other);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function upsertChangelogSection(existingContent, version, sectionMarkdown) {
  const header =
    "# Changelog\n\nAll notable changes to QuizRadar will be documented in this file.\n\n";
  const normalized = existingContent ? existingContent.replace(/\r\n/g, "\n") : header;

  const escapedVer = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existingSectionRe = new RegExp(
    `^## \\[${escapedVer}\\][^\\n]*\\n[\\s\\S]*?(?=^## \\[|\\Z)`,
    "m",
  );
  // JavaScript RegExp doesn't support \Z; match until next `## [` or end-of-string cleanly:
  const lines = normalized.split("\n");
  const startIdx = lines.findIndex((l) => new RegExp(`^## \\[${escapedVer}\\]`).test(l));
  if (startIdx !== -1) {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      if (/^## \[/.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    const before = lines.slice(0, startIdx).join("\n").trimEnd();
    const after = lines.slice(endIdx).join("\n").trimStart();
    return `${before}\n\n${sectionMarkdown}\n${after ? `\n${after}` : ""}`;
  }
  void existingSectionRe;

  const strippedBody = normalized.replace(
    /^# Changelog\n+All notable changes to QuizRadar will be documented in this file\.\n*/,
    "",
  );
  return `${header}${sectionMarkdown}\n\n${strippedBody}`.trimEnd() + "\n";
}

function renderWorklogEntries(version, dateStr, usedFragments) {
  const blocks = [];
  for (const f of usedFragments) {
    blocks.push(`## ${dateStr} — \`${f.slug}\` (v${version})`);
    blocks.push("");
    blocks.push(
      `- **Agent:** \`${f.agent}\` | **Branch:** \`${f.branch || "n/a"}\` | **Bump:** \`${f.bump}\` | **Surfaces:** \`${f.surfaces.join(", ")}\``,
    );
    blocks.push("");
    blocks.push("### Summary");
    blocks.push("");
    blocks.push(f.summary);
    if (f.verification) {
      blocks.push("");
      blocks.push("### Verification");
      blocks.push("");
      blocks.push(f.verification);
    }
    if (f.handoff) {
      blocks.push("");
      blocks.push("### Handoff / Follow-ups");
      blocks.push("");
      blocks.push(f.handoff);
    }
    blocks.push("");
  }
  return blocks.join("\n");
}

/**
 * Restamp the version strings baked into the tracked PWA service worker
 * (`apps/web/public/sw.js`).
 *
 * The service worker is a minified Vite bundle built from `apps/web/src/sw.ts`
 * by `tooling/build-sw.mjs`, so it embeds the release version through the
 * generated `version.ts` sink. A release bump that skips it leaves the
 * previous release's precache active, which fails the PWA precache test
 * (`apps/web/src/pwa.test.tsx`). The bundle is minified, so its variable
 * names (`W`, `m`, …) may change on any rebuild — only the version STRINGS
 * are patched, never identifiers.
 *
 * Returns the patched content, or the input unchanged when it embeds neither
 * the old plain version nor the old `quizradar-v<old>` cache-name string
 * (a future service worker may stop embedding a version — the caller decides
 * whether that is an expected no-op or a warning).
 */
export function patchServiceWorkerVersion(content, oldVersion, nextVersion) {
  const oldCacheName = `quizradar-v${oldVersion}`;
  const nextCacheName = `quizradar-v${nextVersion}`;
  if (!content.includes(oldVersion) && !content.includes(oldCacheName)) {
    return content;
  }
  // The cache-name string contains the plain version, so replace it first;
  // the plain pass then catches the remaining bare version occurrences.
  return content.split(oldCacheName).join(nextCacheName).split(oldVersion).join(nextVersion);
}

const changelogPreview =
  computedBump !== "none" ? renderChangelogSection(nextVersion, todayIso, fragments, commits) : "";

const summaryPayload = {
  hasWork,
  currentVersion,
  nextVersion,
  bump: computedBump,
  baselineRef,
  fragmentCount: fragments.length,
  fragments: fragments.map((f) => f.fileName),
  commitCount: commits.length,
  applied: false,
};

if (!apply) {
  if (flags.json) {
    console.log(JSON.stringify({ ...summaryPayload, changelogPreview }, null, 2));
    process.exit(0);
  }
  if (!hasWork) {
    console.log(
      `No version bump or pending fragments to roll up (current: v${currentVersion}, baseline: ${baselineRef?.slice(0, 7) ?? "none"}).`,
    );
    process.exit(0);
  }
  console.log(`Dry-run rollup: v${currentVersion} -> v${nextVersion} (bump=${computedBump})`);
  console.log(
    `  Fragments (${fragments.length}): ${fragments.map((f) => f.fileName).join(", ") || "none"}`,
  );
  console.log(`  Commits since ${baselineRef?.slice(0, 7) ?? "root"}: ${commits.length}`);
  if (changelogPreview) {
    console.log("\n--- CHANGELOG preview ---\n" + changelogPreview);
  }
  process.exit(0);
}

if (!hasWork) {
  if (flags.json) {
    console.log(JSON.stringify(summaryPayload, null, 2));
  } else {
    console.log(`Nothing to roll up (v${currentVersion}).`);
  }
  process.exit(0);
}

if (computedBump !== "none") {
  // 1. Write tooling/version.json + stamp all 5 sinks via generate-version.mjs
  writeFileSync(versionJsonPath, JSON.stringify({ version: nextVersion }, null, 2) + "\n", "utf8");
  execFileSync(
    process.execPath,
    [path.join(scriptDir, "generate-version.mjs"), "--root", repoRoot],
    {
      encoding: "utf8",
      stdio: "inherit",
    },
  );

  // 2. Keep workspace package versions in Cargo.lock synchronized without requiring cargo on runner
  const cargoLockPath = path.join(repoRoot, "Cargo.lock");
  if (existsSync(cargoLockPath)) {
    const lockContent = readFileSync(cargoLockPath, "utf8");
    const updatedLock = lockContent.replace(
      /(name = "quizradar-(?:core|desktop|wasm)"\r?\nversion = ")[^"]*(")/g,
      `$1${nextVersion}$2`,
    );
    if (updatedLock !== lockContent) {
      writeFileSync(cargoLockPath, updatedLock, "utf8");
    }
  }

  // 3. Update live version badge in docs/STATUS.md if present
  const statusPath = path.join(repoRoot, "docs/STATUS.md");
  if (existsSync(statusPath)) {
    const statusText = readFileSync(statusPath, "utf8");
    const updatedStatus = statusText.replace(
      /^(- \*\*Current Version:\*\* )`[^`]+`/m,
      `$1\`${nextVersion}\``,
    );
    if (updatedStatus !== statusText) {
      writeFileSync(statusPath, updatedStatus, "utf8");
    }
  }

  // 4. Prepend / update CHANGELOG.md
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const existingChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  const updatedChangelog = upsertChangelogSection(existingChangelog, nextVersion, changelogPreview);
  writeFileSync(changelogPath, updatedChangelog, "utf8");

  // 5. Restamp the tracked PWA service worker so its baked-in cache names
  //    follow the release (it is a minified bundle that embeds the version
  //    strings from the generated version.ts sink; only strings are patched).
  const swPath = path.join(repoRoot, "apps/web/public/sw.js");
  if (existsSync(swPath)) {
    const originalSw = readFileSync(swPath, "utf8");
    const patchedSw = patchServiceWorkerVersion(originalSw, currentVersion, nextVersion);
    if (patchedSw !== originalSw) {
      // Honest guard: the release must never ship a service worker that is
      // still stamped with the previous version (it would fail the PWA
      // precache test and serve a stale offline cache).
      if (patchedSw.includes(currentVersion) || !patchedSw.includes(nextVersion)) {
        console.error(
          `Restamping apps/web/public/sw.js did not take effect: ${currentVersion} is still present or ${nextVersion} is missing — refusing to complete the rollup.`,
        );
        process.exit(1);
      }
      writeFileSync(swPath, patchedSw, "utf8");
      console.log(
        `Restamped apps/web/public/sw.js -> ${nextVersion} (cache prefix quizradar-v${nextVersion}).`,
      );
    } else if (originalSw.includes(nextVersion)) {
      console.log(`apps/web/public/sw.js is already stamped ${nextVersion} — nothing to do.`);
    } else {
      console.warn(
        `WARNING: apps/web/public/sw.js embeds neither ${currentVersion} nor quizradar-v${currentVersion} — leaving it untouched (did tooling/build-sw.mjs change shape?).`,
      );
    }
  } else {
    console.warn(
      "WARNING: apps/web/public/sw.js not found — skipping the tracked service worker restamp.",
    );
  }
}

// 6. Archive consumed fragments into docs/worklog/YYYY-MM.md and delete from changes/
if (fragments.length > 0) {
  const monthKey = todayIso.slice(0, 7);
  const worklogDir = path.join(repoRoot, "docs/worklog");
  mkdirSync(worklogDir, { recursive: true });
  const worklogPath = path.join(worklogDir, `${monthKey}.md`);
  const existingWorklog = existsSync(worklogPath)
    ? readFileSync(worklogPath, "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n\n"
    : `# Agent Worklog — ${monthKey}\n\n_Automatically archived from \`changes/*.md\` during main-branch rollups._\n\n`;
  const entriesMd = renderWorklogEntries(nextVersion, todayIso, fragments);
  writeFileSync(worklogPath, existingWorklog + entriesMd, "utf8");

  for (const f of fragments) {
    unlinkSync(f.path);
  }
}

let createdGitTag = null;
if (createTag && computedBump !== "none") {
  try {
    runGit(repoRoot, ["tag", "-a", `v${nextVersion}`, "-m", `Release v${nextVersion}`]);
    createdGitTag = `v${nextVersion}`;
  } catch (err) {
    console.error(`Failed to create git tag v${nextVersion}: ${err.message}`);
  }
}

summaryPayload.applied = true;
if (createdGitTag) {
  summaryPayload.tag = createdGitTag;
}
if (flags.json) {
  console.log(JSON.stringify(summaryPayload, null, 2));
} else if (computedBump !== "none") {
  console.log(
    `Rolled up ${fragments.length} fragment(s) and ${commits.length} commit(s): bumped v${currentVersion} -> v${nextVersion}${createdGitTag ? ` (tagged ${createdGitTag})` : ""}.`,
  );
} else {
  console.log(
    `Archived ${fragments.length} non-release fragment(s) into docs/worklog/ (version remains v${currentVersion}).`,
  );
}
