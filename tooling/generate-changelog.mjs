#!/usr/bin/env node
/**
 * Generates CHANGELOG.md and GitHub Release notes from SemVer tag ranges,
 * rolled-up agent summaries, and conventional git commits.
 *
 * Usage:
 *   node tooling/generate-changelog.mjs [--notes-only] [--from <ref>] [--to <ref>] [--version <ver>] [--root <dir>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareSemver,
  findPreviousSemverTag,
  listFragments,
  parseCliArgs,
  parseSemver,
  runGit,
} from "./lib/agent-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { flags } = parseCliArgs(process.argv.slice(2));
const repoRoot = flags.root
  ? path.resolve(process.cwd(), String(flags.root))
  : path.resolve(scriptDir, "..");

const versionJson = JSON.parse(readFileSync(path.join(repoRoot, "tooling/version.json"), "utf8"));
const version = typeof flags.version === "string" ? flags.version.trim() : versionJson.version;
const toRef = typeof flags.to === "string" ? flags.to.trim() : "HEAD";
const todayIso =
  typeof flags.date === "string" ? flags.date.trim() : new Date().toISOString().split("T")[0];

// Resolve the previous release tag strictly below `version` so post-5.0 releases
// diff `v5.0.0..HEAD` rather than re-dumping all history since `v4-final`.
let fromRef = typeof flags.from === "string" ? flags.from.trim() : null;
if (!fromRef) {
  fromRef = findPreviousSemverTag(repoRoot, version, { toRef, inclusive: false });
}
if (!fromRef) {
  const hasV4Final =
    runGit(repoRoot, ["rev-parse", "--verify", "v4-final"], { allowFailure: true }) !== null;
  if (hasV4Final) fromRef = "v4-final";
}

const rangeArgs = fromRef
  ? ["log", `${fromRef}..${toRef}`, "--pretty=format:%h %s"]
  : ["log", toRef, "--pretty=format:%h %s"];
const logOutput = runGit(repoRoot, rangeArgs, { allowFailure: true }) ?? "";
const lines = logOutput
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const phases = [];
const features = [];
const fixes = [];
const docs = [];
const chores = [];
const other = [];

for (const line of lines) {
  const match = /^([0-9a-f]+)\s+(.+)$/.exec(line);
  if (!match) continue;
  const [, hash, msg] = match;
  // Skip automated release-rollup noise commits in human-facing release notes
  if (/^chore\(release\):/i.test(msg)) continue;

  const item = `- \`${hash}\` ${msg}`;
  if (/^phase\(\d+\):/i.test(msg)) {
    phases.push(item);
  } else if (/^feat(\([^)]+\))?!?:/i.test(msg)) {
    features.push(item);
  } else if (/^(fix|perf|revert)(\([^)]+\))?!?:/i.test(msg)) {
    fixes.push(item);
  } else if (/^docs(\([^)]+\))?!?:/i.test(msg)) {
    docs.push(item);
  } else if (/^(chore|ci|build|test|refactor|style)(\([^)]+\))?!?:/i.test(msg)) {
    chores.push(item);
  } else {
    other.push(item);
  }
}

/**
 * Collect agent summaries already rolled into CHANGELOG.md for versions in
 * `(fromVersion, version]` plus any unconsumed `changes/*.md` fragments.
 */
function collectAgentHighlights() {
  const highlights = [];
  for (const frag of listFragments(repoRoot)) {
    if (!frag.valid) continue;
    const surf = frag.surfaces.length > 0 ? `**[${frag.surfaces.join(", ")}]** ` : "";
    highlights.push(`- ${surf}${frag.summary.split("\n")[0]}`);
  }

  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return highlights;

  const fromSemver = fromRef ? parseSemver(fromRef) : null;
  const targetSemver = parseSemver(version);
  if (!targetSemver) return highlights;

  const content = readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
  const sectionRegex = /^## \[([^\]]+)\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm;
  let m;
  while ((m = sectionRegex.exec(content)) !== null) {
    const secVer = parseSemver(m[1]);
    if (!secVer) continue;
    if (compareSemver(secVer, targetSemver) > 0) continue;
    if (fromSemver && compareSemver(secVer, fromSemver) <= 0) continue;

    const summaryMatch =
      /### 🤝 Agent & Contributor Summaries\n+([\s\S]*?)(?=\n### |\n## |(?![\s\S]))/.exec(m[2]);
    if (summaryMatch) {
      for (const bullet of summaryMatch[1].split("\n").map((s) => s.trim())) {
        if (bullet.startsWith("- ") && !highlights.includes(bullet)) {
          highlights.push(bullet);
        }
      }
    }
  }
  return highlights;
}

const agentHighlights = collectAgentHighlights();
const notesSections = [];

notesSections.push(`## [${version}] — ${todayIso}`);
notesSections.push("");
notesSections.push(
  `**QuizRadar** is a local-first, zero-server academic radar and calendar for university students.`,
);
notesSections.push(
  `It automatically detects quizzes, exams, and homework deadlines from university sources`,
);
notesSections.push(
  `(Gmail, Microsoft Teams, Moodle, and Google Classroom) and cross-references them against`,
);
notesSections.push(
  `your weekly timetable without requiring any central backend server or cloud relay.`,
);
notesSections.push("");

if (fromRef) {
  notesSections.push(`_Changes since \`${fromRef}\`:_`);
  notesSections.push("");
}

if (agentHighlights.length > 0) {
  notesSections.push("### 🤝 Highlights");
  notesSections.push(...agentHighlights);
  notesSections.push("");
}

if (phases.length > 0) {
  notesSections.push("### 🏗 Rebuild Milestones (Phases)");
  notesSections.push(...phases);
  notesSections.push("");
}

if (features.length > 0) {
  notesSections.push("### 🚀 New Features");
  notesSections.push(...features);
  notesSections.push("");
}

if (fixes.length > 0) {
  notesSections.push("### 🐛 Fixes & Hardening");
  notesSections.push(...fixes);
  notesSections.push("");
}

if (docs.length > 0) {
  notesSections.push("### 📚 Documentation & Parity");
  notesSections.push(...docs);
  notesSections.push("");
}

if (chores.length > 0 && features.length === 0 && fixes.length === 0 && phases.length === 0) {
  notesSections.push("### 🔧 Maintenance & Tooling");
  notesSections.push(...chores);
  notesSections.push("");
}

notesSections.push("### 🔒 Privacy, Secrets & Honesty Doctrine");
notesSections.push(
  "- **100% Local Processing**: Tokens, cached announcements, grades, and custom events stay strictly on the device.",
);
notesSections.push(
  "- **Zero Backend Server**: Direct HTTPS requests via PKCE OAuth to Google and Microsoft APIs; no relay, no tracking.",
);
notesSections.push(
  '- **Honesty First**: Missing rooms display as `"—"` rather than invented hall numbers. Undated announcements stay in drafts.',
);
notesSections.push(
  "- **BYOK Gemini Option**: AI features use the user's Google AI Studio key via `x-goog-api-key` header with explicit consent.",
);
notesSections.push("");

notesSections.push("### 📦 Available Artifacts & Downloads");
notesSections.push(
  `- 🪟 **Desktop (Windows)**: \`QuizRadar_${version}_x64-setup.exe\` (NSIS setup) & \`QuizRadar-Portable-win-x64.zip\``,
);
notesSections.push(
  `- 📱 **Mobile (Android)**: \`QuizRadar-v${version}.apk\` (Signed release APK with Glance 2x1 widget & notifications)`,
);
notesSections.push(
  `- 🌐 **Web PWA Companion**: Hosted on GitHub Pages at [https://thedragonsoft.github.io/QuizRadar/](https://thedragonsoft.github.io/QuizRadar/)`,
);
notesSections.push(
  `- 🔐 **Checksums & Signatures**: Verified against \`SHA256SUMS.txt\` and updater \`latest.json\``,
);
notesSections.push("");

notesSections.push("### 👨‍💻 Maintainer Notes");
notesSections.push(`- Release built automatically from tag \`v${version}\` via GitHub Actions.`);
notesSections.push(
  "- Desktop updates verified with minisign public key configured in `tauri.conf.json`.",
);
notesSections.push("- Android release signed with release keystore and verified with `apksigner`.");

const releaseBody = notesSections.join("\n");

if (flags["notes-only"]) {
  process.stdout.write(releaseBody + "\n");
  process.exit(0);
}

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const header =
  "# Changelog\n\nAll notable changes to QuizRadar will be documented in this file.\n\n";
const existingChangelog = existsSync(changelogPath)
  ? readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n")
  : header;

// Idempotent replace if `## [<version>]` already exists; otherwise prepend cleanly.
const changelogLines = existingChangelog.split("\n");
const escapedVer = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const existingIdx = changelogLines.findIndex((l) => new RegExp(`^## \\[${escapedVer}\\]`).test(l));

let fullChangelog;
if (existingIdx !== -1) {
  let endIdx = changelogLines.length;
  for (let i = existingIdx + 1; i < changelogLines.length; i += 1) {
    if (/^## \[/.test(changelogLines[i])) {
      endIdx = i;
      break;
    }
  }
  const before = changelogLines.slice(0, existingIdx).join("\n").trimEnd();
  const after = changelogLines.slice(endIdx).join("\n").trimStart();
  fullChangelog = `${before}\n\n${releaseBody}\n${after ? `\n${after}` : ""}`.trimEnd() + "\n";
} else {
  const rest = existingChangelog.replace(
    /^# Changelog\n+All notable changes to QuizRadar will be documented in this file\.\n*/,
    "",
  );
  fullChangelog = `${header}${releaseBody}\n\n${rest}`.trimEnd() + "\n";
}

writeFileSync(changelogPath, fullChangelog, "utf8");
console.log(
  `Generated CHANGELOG.md for version ${version} (range: ${fromRef ? `${fromRef}..${toRef}` : toRef}, ${lines.length} commits scanned).`,
);
