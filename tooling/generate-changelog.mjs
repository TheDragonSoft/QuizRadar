#!/usr/bin/env node
/**
 * Generates CHANGELOG.md and release notes from conventional git commits.
 *
 * Usage:
 *   node tooling/generate-changelog.mjs [--write] [--notes-only]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionJson = JSON.parse(readFileSync(path.join(repoRoot, "tooling/version.json"), "utf8"));
const version = versionJson.version;
const todayIso = new Date().toISOString().split("T")[0];

// Determine commit range: since v4-final if exists, or entire history
let logOutput = "";
try {
  logOutput = execSync('git log v4-final..HEAD --pretty=format:"%h %s"', {
    cwd: repoRoot,
    encoding: "utf8",
  });
} catch {
  logOutput = execSync('git log --pretty=format:"%h %s"', {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const lines = logOutput.trim().split("\n").filter(Boolean);

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
  const item = `- \`${hash}\` ${msg}`;

  if (/^phase\(\d+\):/i.test(msg)) {
    phases.push(item);
  } else if (/^feat(\([^)]+\))?:/i.test(msg)) {
    features.push(item);
  } else if (/^fix(\([^)]+\))?:/i.test(msg)) {
    fixes.push(item);
  } else if (/^docs(\([^)]+\))?:/i.test(msg)) {
    docs.push(item);
  } else if (/^chore(\([^)]+\))?:/i.test(msg)) {
    chores.push(item);
  } else {
    other.push(item);
  }
}

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

if (process.argv.includes("--notes-only")) {
  process.stdout.write(releaseBody + "\n");
  process.exit(0);
}

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
let existingChangelog = "";
try {
  existingChangelog = readFileSync(changelogPath, "utf8");
} catch {
  existingChangelog =
    "# Changelog\n\nAll notable changes to QuizRadar will be documented in this file.\n\n";
}

// Prepend or update version section
const fullChangelog =
  `# Changelog\n\nAll notable changes to QuizRadar will be documented in this file.\n\n${releaseBody}\n\n` +
  existingChangelog.replace(
    /^# Changelog\n\nAll notable changes to QuizRadar will be documented in this file\.\n\n/,
    "",
  );

writeFileSync(changelogPath, fullChangelog);
console.log(`Generated CHANGELOG.md for version ${version} (${lines.length} commits summarized).`);
