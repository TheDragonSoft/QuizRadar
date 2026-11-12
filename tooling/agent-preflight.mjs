#!/usr/bin/env node
/**
 * Multi-Agent Preflight & Conflict Radar (`pnpm agent:preflight`).
 *
 * Run at the start of every AI agent session so the agent immediately knows:
 *   1. Current SemVer (`tooling/version.json`), sink freshness, and commits since last release tag.
 *   2. Current branch, dirty files, ahead/behind drift vs `main`, and `main`-branch safety warning.
 *   3. All active `git worktree` checkouts, what surfaces/files parallel agents are touching,
 *      and explicit FILE OVERLAP warnings when two branches/worktrees touch the same file.
 *   4. All pending `changes/*.md` handoff notes (both in this checkout and sibling worktrees).
 *   5. Exact verification commands required for the files modified so far.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bumpSemver,
  classifyCommitsBump,
  findPreviousSemverTag,
  inferSurfacesFromPaths,
  listFragments,
  maxBump,
  parseCliArgs,
  runGit,
} from "./lib/agent-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { flags } = parseCliArgs(process.argv.slice(2));
const repoRoot = flags.root
  ? path.resolve(process.cwd(), String(flags.root))
  : path.resolve(scriptDir, "..");

function checkVersionSinks(root) {
  try {
    execFileSync(
      process.execPath,
      [path.join(scriptDir, "generate-version.mjs"), "--root", root, "--check"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { inSync: true, message: "all 5 sinks in sync" };
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    return { inSync: false, message: stderr.trim() || "version sinks stale" };
  }
}

function parseWorktrees(porcelain) {
  if (!porcelain) return [];
  const blocks = porcelain.replace(/\r\n/g, "\n").trim().split("\n\n");
  const out = [];
  for (const block of blocks) {
    const entry = { path: "", head: "", branch: "detached", bare: false };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length).trim().slice(0, 7);
      else if (line.startsWith("branch refs/heads/"))
        entry.branch = line.slice("branch refs/heads/".length).trim();
      else if (line === "bare") entry.bare = true;
    }
    if (entry.path && !entry.bare) out.push(entry);
  }
  return out;
}

function getModifiedFiles(root, baseRef, targetBranchOrWorktree) {
  const files = new Set();
  if (baseRef && targetBranchOrWorktree.branch && targetBranchOrWorktree.branch !== "detached") {
    const committed = runGit(
      root,
      ["diff", "--name-only", `${baseRef}...${targetBranchOrWorktree.branch}`],
      { allowFailure: true },
    );
    if (committed) {
      for (const f of committed
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)) {
        files.add(f);
      }
    }
  }
  if (targetBranchOrWorktree.path && existsSync(targetBranchOrWorktree.path)) {
    const status = runGit(targetBranchOrWorktree.path, ["status", "--porcelain"], {
      allowFailure: true,
    });
    if (status) {
      for (const line of status.split("\n")) {
        if (!line.trim()) continue;
        const rel = line.slice(3).trim().replace(/^"|"$/g, "");
        if (rel) files.add(rel);
      }
    }
  }
  return [...files].sort();
}

const versionJsonPath = path.join(repoRoot, "tooling/version.json");
const currentVersion = existsSync(versionJsonPath)
  ? JSON.parse(readFileSync(versionJsonPath, "utf8")).version
  : "unknown";
const sinkCheck = checkVersionSinks(repoRoot);

const currentBranch =
  runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) || "detached";
const headSha =
  runGit(repoRoot, ["rev-parse", "--short", "HEAD"], { allowFailure: true }) || "unknown";

const baseRef =
  runGit(repoRoot, ["rev-parse", "--verify", "main"], { allowFailure: true }) !== null
    ? "main"
    : runGit(repoRoot, ["rev-parse", "--verify", "origin/main"], { allowFailure: true }) !== null
      ? "origin/main"
      : null;

let aheadMain = 0;
let behindMain = 0;
if (baseRef && currentBranch !== baseRef) {
  const counts = runGit(repoRoot, ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`], {
    allowFailure: true,
  });
  if (counts) {
    const [behind, ahead] = counts.split(/\s+/).map(Number);
    behindMain = behind || 0;
    aheadMain = ahead || 0;
  }
}

const latestTag = findPreviousSemverTag(repoRoot, currentVersion, {
  toRef: "HEAD",
  inclusive: true,
});
let commitsSinceTag = [];
if (latestTag) {
  const rawLog = runGit(repoRoot, ["log", `${latestTag}..HEAD`, "--pretty=format:%h\t%s"], {
    allowFailure: true,
  });
  if (rawLog) {
    commitsSinceTag = rawLog
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, subject] = line.split("\t");
        return { hash, subject, body: "" };
      });
  }
}

const localStatusRaw = runGit(repoRoot, ["status", "--porcelain"], { allowFailure: true }) ?? "";
const dirtyLines = localStatusRaw.split("\n").filter((l) => l.trim().length > 0);

const worktreesRaw = runGit(repoRoot, ["worktree", "list", "--porcelain"], { allowFailure: true });
const rawWorktrees = parseWorktrees(worktreesRaw);
const normalizedRoot = path.resolve(repoRoot).toLowerCase();

const myFiles = getModifiedFiles(repoRoot, baseRef, {
  path: repoRoot,
  branch: currentBranch,
});
const myFileSet = new Set(myFiles);
const mySurfaces = inferSurfacesFromPaths(myFiles);

const worktrees = rawWorktrees.map((wt) => {
  const isCurrent = path.resolve(wt.path).toLowerCase() === normalizedRoot;
  const files = isCurrent ? myFiles : getModifiedFiles(repoRoot, baseRef, wt);
  const surfaces = inferSurfacesFromPaths(files);
  const dirtyRaw = existsSync(wt.path)
    ? (runGit(wt.path, ["status", "--porcelain"], { allowFailure: true }) ?? "")
    : "";
  const dirtyCount = dirtyRaw.split("\n").filter((l) => l.trim().length > 0).length;
  const fragments = existsSync(wt.path) ? listFragments(wt.path) : [];
  const overlappingFiles = isCurrent
    ? []
    : files.filter((f) => myFileSet.has(f) && !f.startsWith("changes/"));
  return {
    ...wt,
    isCurrent,
    dirtyCount,
    surfaces,
    modifiedCount: files.length,
    overlappingFiles,
    fragments: fragments.map((f) => ({
      fileName: f.fileName,
      bump: f.bump,
      surfaces: f.surfaces,
      agent: f.agent,
      branch: f.branch,
      summary: f.summary.split("\n")[0],
      handoff: f.handoff,
      valid: f.valid,
    })),
  };
});

const localFragments = listFragments(repoRoot);
let plannedBump = classifyCommitsBump(commitsSinceTag);
for (const f of localFragments) {
  if (f.valid && f.bump) plannedBump = maxBump(plannedBump, f.bump);
}
const nextVersionPreview =
  plannedBump !== "none" && currentVersion !== "unknown"
    ? bumpSemver(currentVersion, plannedBump)
    : currentVersion;

// Determine required verification gates from touched files
const requiredGates = ["node tooling/generate-version.mjs --check"];
if (mySurfaces.includes("core") || mySurfaces.includes("desktop")) {
  requiredGates.push("cargo fmt --all --check");
  requiredGates.push("cargo clippy --workspace --all-targets -- -D warnings");
  requiredGates.push("cargo test --workspace");
}
if (myFiles.some((f) => f.startsWith("core/src/types") || f.startsWith("core/src/ffi"))) {
  requiredGates.push("node apps/web/src/contract/regenerate.mjs --check");
  requiredGates.push("cd apps/mobile-android; .\\gradlew.bat uniffiGenerate");
}
if (mySurfaces.includes("web") || mySurfaces.includes("tooling")) {
  requiredGates.push("pnpm --dir apps/web build:wasm");
  requiredGates.push("pnpm format:check");
  requiredGates.push("pnpm lint");
  requiredGates.push("pnpm typecheck");
  requiredGates.push("pnpm test");
}
if (mySurfaces.includes("desktop")) {
  // The Tauri shell is a workspace member; `cargo test --workspace` above
  // already covers it — this targeted pass gives faster feedback on
  // desktop-only branches.
  requiredGates.push("cargo test -p quizradar-desktop");
}
if (mySurfaces.includes("ci")) {
  requiredGates.push("pnpm test:tooling");
}
if (mySurfaces.includes("android")) {
  requiredGates.push("cd apps/mobile-android; .\\gradlew.bat ktlintCheck testDebugUnitTest");
}

const warnings = [];
if (currentBranch === "main" || currentBranch === "master") {
  warnings.push(
    "You are directly on `main`. Create an isolated feature branch or worktree before editing code.",
  );
}
if (!sinkCheck.inSync) {
  warnings.push(`Version sinks are out of sync: ${sinkCheck.message}`);
}
if (behindMain > 0) {
  warnings.push(
    `Current branch is ${behindMain} commit(s) behind \`${baseRef}\`. Consider rebasing/merging \`${baseRef}\` before touching shared files.`,
  );
}
for (const wt of worktrees) {
  if (!wt.isCurrent && (wt.branch === "main" || wt.branch === "master") && wt.dirtyCount > 0) {
    warnings.push(
      `Peer worktree (${wt.path}) has ${wt.dirtyCount} uncommitted file(s) directly on \`${wt.branch}\`.`,
    );
  }
  if (!wt.isCurrent && wt.overlappingFiles.length > 0) {
    warnings.push(
      `CONFLICT RADAR: Sibling worktree \`${wt.branch}\` (${wt.path}) also modifies: ${wt.overlappingFiles.slice(0, 6).join(", ")}${wt.overlappingFiles.length > 6 ? "..." : ""}`,
    );
  }
}
// Mirrors agent-gate.mjs: CI workflows, gate/tooling scripts and shipped code
// all require a branch-owned handoff fragment before merge.
const touchesCoordinationSurface = myFiles.some(
  (f) =>
    f.startsWith("core/") ||
    f.startsWith("apps/") ||
    f.startsWith(".github/") ||
    f.startsWith("tooling/"),
);
if (touchesCoordinationSurface && localFragments.length === 0) {
  warnings.push(
    "Shipped code (`core/`, `apps/`) or coordination surface (`.github/`, `tooling/`) is modified on this branch, but no `changes/<slug>.md` handoff note exists yet. Run `pnpm agent:note ...` before pushing.",
  );
}

const report = {
  version: {
    current: currentVersion,
    sinksInSync: sinkCheck.inSync,
    latestTag,
    commitsSinceTag: commitsSinceTag.length,
    inferredBump: plannedBump,
    nextVersionPreview,
  },
  workspace: {
    repoRoot,
    branch: currentBranch,
    head: headSha,
    baseRef,
    aheadMain,
    behindMain,
    dirtyCount: dirtyLines.length,
    touchedSurfaces: mySurfaces,
    modifiedFilesCount: myFiles.length,
  },
  worktrees,
  pendingFragments: localFragments.map((f) => ({
    fileName: f.fileName,
    valid: f.valid,
    bump: f.bump,
    surfaces: f.surfaces,
    agent: f.agent,
    branch: f.branch,
    summary: f.summary,
    handoff: f.handoff,
    errors: f.errors,
  })),
  requiredGates,
  warnings,
};

if (flags.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log("=== QuizRadar Multi-Agent Preflight ===");
console.log(
  `Version:   v${currentVersion} (${sinkCheck.inSync ? "5/5 sinks in sync" : "STALE SINKS"}) | Last tag: ${latestTag ?? "none"} (+${commitsSinceTag.length} commits) | Pending bump: ${plannedBump} -> v${nextVersionPreview}`,
);
console.log(
  `Workspace: branch=${currentBranch} (${headSha}) | vs ${baseRef ?? "main"}: +${aheadMain}/-${behindMain} | dirty=${dirtyLines.length} file(s) | surfaces=[${mySurfaces.join(", ") || "clean"}]`,
);

if (worktrees.length > 0) {
  console.log(`\nActive Git Worktrees (${worktrees.length}):`);
  for (const wt of worktrees) {
    const marker = wt.isCurrent ? "* [HERE]" : "  [PEER]";
    const surf = wt.surfaces.length > 0 ? wt.surfaces.join(",") : "clean";
    console.log(
      `${marker} ${wt.branch} (${wt.head}) — dirty=${wt.dirtyCount}, changed=${wt.modifiedCount} [${surf}] @ ${wt.path}`,
    );
    for (const frag of wt.fragments) {
      console.log(
        `         note: changes/${frag.fileName} (${frag.bump}, ${frag.agent}): ${frag.summary}`,
      );
      if (frag.handoff && frag.handoff !== "- None.") {
        console.log(`         handoff: ${frag.handoff.replace(/\n/g, " | ")}`);
      }
    }
  }
}

if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`  ! ${w}`);
  }
}

console.log("\nRequired Verification Gates Before Handoff:");
for (const gate of requiredGates) {
  console.log(`  $ ${gate}`);
}
