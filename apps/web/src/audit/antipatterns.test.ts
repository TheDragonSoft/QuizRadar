/**
 * CI-enforceable version of the phase-16 "anti-checklist audit".
 *
 * AGENTS.md §3 rule 4 and `docs/rebuild/03-issues-and-pain-points.md` list the
 * v4 antipatterns that must never come back. This test scans the *source* of
 * `apps/web/src/**` as plain text and fails the build when one reappears.
 *
 * Rules of the scan:
 *   - test files are excluded (otherwise this file trips over itself),
 *   - `node_modules`, `dist` and `__snapshots__` are skipped,
 *   - `copy.ts` is NOT excluded: it is scanned like every other file. When a
 *     copy string legitimately has to contain a banned word, that single key
 *     is allow-listed below with a written reason, and the allow-list is
 *     self-validating (a stale entry fails the build).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { copy } from "../copy";

/** Directories that never contain first-party source. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "__snapshots__",
  "__tests__",
  ".git",
  "coverage",
  "build",
]);

/** File extensions that are scanned (source + assets that ship in the bundle). */
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".html",
  ".svg",
]);

interface BannedPattern {
  id: string;
  regex: RegExp;
  /** Literal text the allow-list validates a copy key against. */
  needle?: string;
  /** Why the antipattern is banned (shown in the failure message). */
  reason: string;
  /** Where the antipattern is documented. */
  source: string;
}

const BANNED_PATTERNS: ReadonlyArray<BannedPattern> = [
  {
    id: "hall-b-204",
    regex: /Hall B-204/i,
    needle: "Hall B-204",
    reason: "v4 printed a fabricated default room when the source had none.",
    source: "03-issues A8 / reference-v4-audit A8",
  },
  {
    id: "elearning-lab-online",
    regex: /E-Learning Lab \/ Online/i,
    needle: "E-Learning Lab / Online",
    reason: "v4 demo location string.",
    source: "03-issues demo-remnant list",
  },
  {
    id: "via-home-su25",
    regex: /\(via Home-Su25\)/i,
    needle: "(via Home-Su25)",
    reason: "v4 dev-mailbox provenance marker.",
    source: "03-issues A6 / reference-v4-audit A6",
  },
  {
    id: "auto-sync-gcal-default-true",
    regex: /\bauto_?sync_?gcal\b["']?\s*[:=]\s*["']?true/i,
    reason: "auto_sync_gcal must never default to true before a scope exists.",
    source: "03-issues C1 / AGENTS §3 rule 4",
  },
  {
    id: "teams-token-sync",
    regex: /teams_token/i,
    needle: "teams_token",
    reason: "v4 pushed the Teams token into Drive; only data may be synced.",
    source: "03-issues B6 / AGENTS §3 rule 4",
  },
  {
    id: "local-oauth-server",
    regex: /LocalOAuthServer/i,
    needle: "LocalOAuthServer",
    reason: "v4 shipped a third HTTP server on the device; there is no server in v5.",
    source: "03-issues A1/E3 / AGENTS §1",
  },
  {
    id: "demo-url-hack",
    regex: /[?&]demo\b/i,
    needle: "demo",
    reason: "the ?demo= URL hack mutated real user state in v4.",
    source: "03-issues A9 / reference-v4-audit A9",
  },
  {
    id: "demo-course-math101",
    regex: /\bMATH[\s_-]?101\b/i,
    needle: "101",
    reason: "v4 demo-universe course id.",
    source: "03-issues A6/B-section / AGENTS §3 rule 4",
  },
  {
    id: "demo-course-cs101",
    regex: /\bC[\s_-]?S[\s_-]?101\b/i,
    needle: "101",
    reason: "v4 demo-universe course id.",
    source: "03-issues A6/B-section / AGENTS §3 rule 4",
  },
  {
    id: "demo-course-data201",
    regex: /\bDATA[\s_-]?201\b/i,
    needle: "201",
    reason: "v4 demo-universe course id.",
    source: "03-issues A6/B-section / AGENTS §3 rule 4",
  },
  {
    id: "general-demo-course",
    regex: /GENERAL/,
    needle: "GENERAL",
    reason:
      "GENERAL is a v4 demo course id / palette-map key; a hardcoded GENERAL course (or a [GENERAL] chip) must never ship.",
    source: "03-issues A6/B-section / AGENTS §3 rule 4",
  },
  {
    id: "university-campus-placeholder",
    regex: /University Campus/i,
    needle: "University Campus",
    reason: "v4 demo campus placeholder.",
    source: "03-issues demo-remnant list",
  },
  {
    id: "smartphone-app-channel",
    regex: /smartphone_app/i,
    needle: "smartphone_app",
    reason: "the v4 smartphone_app source channel was deleted.",
    source: "AGENTS §3 rule 4 / 04-rebuild §5",
  },
  {
    id: "gmail-body-truncation",
    regex: /4,500|\b4500\b|\b4_500\b/,
    needle: "4,500",
    reason: "v4 truncated Gmail bodies at 4,500 chars before the engine saw them.",
    source: "03-issues C3",
  },
  {
    id: "oauth-client-secret-literal",
    regex: /client_secret/,
    needle: "client_secret",
    reason:
      "the web tier must never carry an OAuth client secret (PKCE only, no secret in the bundle).",
    source: "AGENTS §3 rule 2 / §8 security checklist",
  },
  {
    id: "oauth-secret-value-literal",
    regex: /GOCSPX-[A-Za-z0-9_-]{10,}/,
    reason: "a Google OAuth client secret value must never be committed.",
    source: "AGENTS §3 rule 2 / §8 security checklist",
  },
  {
    id: "google-api-key-literal",
    regex: /AIza/,
    needle: "AIza",
    reason: "a Google API key must never be committed (BYOK: the user pastes their own).",
    source: "AGENTS §3 rule 2 / §8 security checklist",
  },
  {
    id: "google-api-key-shaped-literal",
    regex: /AIza[0-9A-Za-z_-]{20,}/,
    reason: "a Google API key must never be committed (BYOK: the user pastes their own).",
    source: "AGENTS §3 rule 2 / §8 security checklist",
  },
];

interface AllowEntry {
  patternId: string;
  /** Path relative to `apps/web/src`, POSIX separators. */
  file: string;
  /** For `copy.ts` entries: the dotted copy key that owns the occurrence. */
  copyKey?: string;
  /** For source entries: the matched line must match this expression. */
  linePattern?: RegExp;
  /** Written reason — the allow-list must never be a blanket exclusion. */
  reason: string;
}

const ALLOW_LIST: ReadonlyArray<AllowEntry> = [
  {
    patternId: "google-api-key-literal",
    file: "copy.ts",
    copyKey: "ai.keyPlaceholder",
    reason:
      "The AI key input placeholder shows the Google key PREFIX ('AIzaSy…') so the user recognises the key format. It is not a key: no key material, no key-shaped literal (see the 'google-api-key-shaped-literal' pattern, which has no allow-list).",
  },
  {
    patternId: "oauth-client-secret-literal",
    file: "pwadapters/browserSources.ts",
    linePattern: /includes\(\s*["'`]client_secret["'`]\s*\)/,
    reason:
      "This is a substring check against a Google OAuth ERROR BODY ('invalid_request: client_secret is missing'), used to explain the provider error to the user. No secret value is involved.",
  },
  {
    patternId: "general-demo-course",
    file: "components/AssessmentDetailModal.tsx",
    linePattern: /coursePalette\([^)]*\|\|\s*["']GENERAL["']\s*\)/,
    reason:
      "Palette SEED for an assessment that has no course id. coursePalette() derives the accent from a hash of the course id (apps/web/src/lib/coursePalette.ts) — there is no hardcoded demo-course palette map and no question bank.",
  },
  {
    patternId: "general-demo-course",
    file: "views/dashboard/StudyRecommendationCard.tsx",
    linePattern: /coursePalette\([^)]*\|\|\s*["']GENERAL["']\s*\)/,
    reason:
      "Palette SEED for an assessment that has no course id. coursePalette() derives the accent from a hash of the course id (apps/web/src/lib/coursePalette.ts) — there is no hardcoded demo-course palette map and no question bank.",
  },
  {
    patternId: "general-demo-course",
    file: "views/dashboard/TimelineRow.tsx",
    linePattern: /coursePalette\([^)]*\|\|\s*["']GENERAL["']\s*\)/,
    reason:
      "Palette SEED for an assessment that has no course id. coursePalette() derives the accent from a hash of the course id (apps/web/src/lib/coursePalette.ts) — there is no hardcoded demo-course palette map and no question bank.",
  },
  {
    patternId: "general-demo-course",
    file: "views/TasksView.tsx",
    linePattern: /coursePalette\([^)]*\|\|\s*["']GENERAL["']\s*\)/,
    reason:
      "Palette SEED for an assessment that has no course id. coursePalette() derives the accent from a hash of the course id (apps/web/src/lib/coursePalette.ts) — there is no hardcoded demo-course palette map and no question bank.",
  },
];

interface Violation {
  patternId: string;
  file: string;
  line: number;
  column: number;
  text: string;
  lineText: string;
}

/** Find `apps/web/src` by walking up from the working directory. */
function findSrcDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidates = [
      resolve(dir, "src", "copy.ts"),
      resolve(dir, "apps", "web", "src", "copy.ts"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return dirname(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate apps/web/src above ${process.cwd()}`);
}

const SRC_DIR = findSrcDir();

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isTestFile(relativePath: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = toPosix(relative(SRC_DIR, full));
    if (isTestFile(relativePath)) continue;
    const dot = entry.name.lastIndexOf(".");
    const extension = dot === -1 ? "" : entry.name.slice(dot).toLowerCase();
    if (!SCANNED_EXTENSIONS.has(extension)) continue;
    out.push(full);
  }
  return out;
}

const SCANNED_FILES = collectSourceFiles(SRC_DIR).sort();

function scanFile(file: string): Violation[] {
  const absolute = file;
  const relativePath = toPosix(relative(SRC_DIR, absolute));
  const text = readFileSync(absolute, "utf8");
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];

  for (const pattern of BANNED_PATTERNS) {
    const global = new RegExp(
      pattern.regex.source,
      pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`,
    );
    for (const match of text.matchAll(global)) {
      if (match.index === undefined) continue;
      const before = text.slice(0, match.index);
      const lineNumber = before.split(/\r?\n/).length;
      const column = match.index - before.lastIndexOf("\n");
      violations.push({
        patternId: pattern.id,
        file: relativePath,
        line: lineNumber,
        column,
        text: match[0],
        lineText: (lines[lineNumber - 1] ?? "").trim(),
      });
    }
  }
  return violations;
}

const ALL_VIOLATIONS = SCANNED_FILES.flatMap(scanFile);

/** Resolve a dotted copy key (e.g. `ai.keyPlaceholder`). */
function copyValueAt(dottedPath: string): unknown {
  return dottedPath
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      copy,
    );
}

function allowEntryFor(violation: Violation): AllowEntry | undefined {
  return ALLOW_LIST.find((entry) => {
    if (entry.patternId !== violation.patternId) return false;
    if (entry.file !== violation.file) return false;
    if (entry.copyKey) {
      const value = copyValueAt(entry.copyKey);
      if (typeof value !== "string") return false;
      const pattern = BANNED_PATTERNS.find((p) => p.id === entry.patternId);
      if (!pattern?.needle || !value.includes(pattern.needle)) return false;
      // The occurrence must sit on the line that declares the allowed key.
      return violation.lineText.includes(entry.copyKey.split(".").pop() ?? entry.copyKey);
    }
    if (entry.linePattern) {
      return entry.linePattern.test(violation.lineText);
    }
    return false;
  });
}

const UNRESOLVED = ALL_VIOLATIONS.filter((violation) => !allowEntryFor(violation));

describe("v4 antipattern audit (apps/web/src)", () => {
  it("scans a real, non-trivial source tree", () => {
    expect(SCANNED_FILES.length).toBeGreaterThan(20);
    const relativePaths = SCANNED_FILES.map((file) => toPosix(relative(SRC_DIR, file)));
    expect(relativePaths).toContain("copy.ts");
    expect(relativePaths).toContain("App.tsx");
    expect(relativePaths).toContain("state/store.ts");
  });

  it("excludes test files and build folders from the scan", () => {
    const relativePaths = SCANNED_FILES.map((file) => toPosix(relative(SRC_DIR, file)));
    expect(relativePaths.some((path) => isTestFile(path))).toBe(false);
    expect(relativePaths.some((path) => path.includes("node_modules"))).toBe(false);
    expect(relativePaths.some((path) => path.includes("dist/"))).toBe(false);
    expect(relativePaths.some((path) => path.includes("__snapshots__"))).toBe(false);
  });

  it("contains no banned v4 antipattern", () => {
    const report = UNRESOLVED.map(
      (violation) =>
        `${violation.file}:${violation.line}:${violation.column} [${violation.patternId}] "${violation.text}" — ${violation.lineText}`,
    );
    expect(report).toEqual([]);
  });

  it("keeps every allow-list entry explicit, justified and still live", () => {
    const problems: string[] = [];

    for (const entry of ALLOW_LIST) {
      if (entry.reason.trim().length < 20) {
        problems.push(
          `${entry.patternId} / ${entry.file}: the allow-list entry needs a written reason.`,
        );
      }
      if (!entry.copyKey && !entry.linePattern) {
        problems.push(
          `${entry.patternId} / ${entry.file}: an allow-list entry must name the exact copy key or the exact line shape it allows.`,
        );
      }

      if (entry.copyKey) {
        const value = copyValueAt(entry.copyKey);
        if (typeof value !== "string") {
          problems.push(`${entry.copyKey}: the allow-listed copy key no longer exists.`);
          continue;
        }
        const pattern = BANNED_PATTERNS.find((p) => p.id === entry.patternId);
        if (!pattern?.needle || !value.includes(pattern.needle)) {
          problems.push(
            `${entry.copyKey}: the allow-listed copy key no longer contains "${pattern?.needle ?? entry.patternId}" — remove the stale allow-list entry.`,
          );
        }
      }

      if (!ALL_VIOLATIONS.some((violation) => allowEntryFor(violation) === entry)) {
        problems.push(
          `${entry.patternId} / ${entry.file}: the allow-list entry matches nothing any more — remove it.`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it("does not exclude copy.ts wholesale (it is scanned like every other file)", () => {
    const copyViolations = ALL_VIOLATIONS.filter((violation) => violation.file === "copy.ts");
    const unresolvedCopyViolations = copyViolations.filter(
      (violation) => !allowEntryFor(violation),
    );
    expect(unresolvedCopyViolations.map((violation) => violation.patternId)).toEqual([]);
  });

  it("scans real files (the scanner is not silently reading nothing)", () => {
    const totalBytes = SCANNED_FILES.reduce((sum, file) => sum + statSync(file).size, 0);
    expect(totalBytes).toBeGreaterThan(10_000);
  });
});
