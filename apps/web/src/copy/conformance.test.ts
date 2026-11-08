/**
 * Conformance test for the typed copy module (`apps/web/src/copy.ts`).
 *
 * AGENTS.md §3 (honesty doctrine) makes `copy.ts` the single source of truth
 * for every user-facing string in the web tier. These assertions keep the
 * module itself honest:
 *
 *   1. no empty strings,
 *   2. no placeholder smell (`undefined`, `NaN`, `[object Object]`, `TODO`,
 *      `FIXME`, `Lorem ipsum`, an un-interpolated `${`),
 *   3. no promise the product does not actually keep,
 *   4. every template function returns a real, non-empty string,
 *   5. the free-tier AI disclosure is present and matches the spec text.
 *
 * The copy tree is walked as a *runtime* value (it is `as const`, so the
 * shape is typed, but the values are only knowable at runtime).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { copy } from "../copy";

type CopyFn = (...args: unknown[]) => string;

interface CopyLeaf {
  path: string;
  value: string | CopyFn;
}

/** Recursively collect every leaf (static string or template function). */
function collectLeaves(node: unknown, path: string, out: CopyLeaf[]): void {
  if (typeof node === "string") {
    out.push({ path, value: node });
    return;
  }
  if (typeof node === "function") {
    out.push({ path, value: node as CopyFn });
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      collectLeaves(child, path ? `${path}.${key}` : key, out);
    }
  }
}

const leaves: CopyLeaf[] = [];
collectLeaves(copy, "", leaves);

const staticLeaves = leaves.filter(
  (leaf): leaf is { path: string; value: string } => typeof leaf.value === "string",
);
const functionLeaves = leaves.filter(
  (leaf): leaf is { path: string; value: CopyFn } => typeof leaf.value === "function",
);

/**
 * Every template function in `copy.ts`, with the arguments it is called with
 * in production. A new template function MUST be added here (the "table is
 * complete" assertion below fails otherwise) so it can never ship without a
 * proven, non-empty result.
 */
const FUNCTION_SAMPLES: ReadonlyArray<{ path: string; args: unknown[] }> = [
  { path: "topBar.syncSyncedSummary", args: [2, 5] },
  { path: "topBar.updateProgress", args: ["42%"] },
  { path: "topBar.updateFailed", args: ["Release channel not configured"] },
  { path: "sidebar.syncFooter.radarActive", args: [3] },
  { path: "sidebar.syncFooter.lastSynced", args: ["2026-10-29 14:00"] },
  { path: "sidebar.weekExamsRange", args: ["Oct 25", "Oct 31"] },
  { path: "urgency.inDays", args: [4] },
  { path: "scan.scanSummary", args: [1, 0] },
  { path: "scan.sourcesRunning", args: [1] },
  { path: "dashboard.heroUpNext", args: ["Today"] },
  { path: "dashboard.heroInDays", args: [2] },
  { path: "dashboard.kpiReadinessCounts", args: [3, 8] },
  { path: "dashboard.searchFilterActive", args: ["bio"] },
  { path: "dashboard.timelineEmptySearchBody", args: ["bio"] },
  { path: "dashboard.studyEmptySearchBody", args: ["bio"] },
  { path: "dashboard.kpiSyncActive", args: [2] },
  { path: "dashboard.conflictBanner.unresolvedTitle", args: [2] },
  { path: "dashboard.conflictBanner.mitigatedTitle", args: [1] },
  { path: "dashboard.conflictBanner.mitigatedBody", args: [1] },
  { path: "dashboard.conflictBanner.partiallyMitigatedNote", args: [2] },
  { path: "dashboard.conflictBanner.blocksCreated", args: [2] },
  { path: "dashboard.conflictBanner.balancedPathCreated", args: [3] },
  { path: "dashboard.conflictBanner.blocksSkippedUndated", args: [1] },
  { path: "dashboard.topicsCompletedProgress", args: [1, 4] },
  { path: "tasks.summaryLine", args: [3, 2, 4.5] },
  { path: "tasks.summaryLine", args: [3, 2, null] },
  { path: "tasks.prepDay", args: [1, 3] },
  { path: "tasks.estHours", args: [1] },
  { path: "assessmentDetail.topicsProgress", args: [2, 5] },
  { path: "assessmentDetail.recordedStatus", args: [18, 20, 10] },
  { path: "assessmentDetail.recordedStatus", args: [18, 20, null] },
  { path: "assessmentDetail.whatIfResult", args: [72.5] },
  { path: "assessmentDetail.whatIfEqualWeight", args: [3] },
  { path: "ai.quotaText", args: [7] },
  { path: "ai.quotaText", args: [null] },
  { path: "ai.quotaTextSession", args: [2] },
  { path: "settings.connectedAs", args: ["student@example.edu"] },
  { path: "settings.redirectUriLabel", args: ["http://127.0.0.1"] },
  { path: "search.noResults", args: ["quiz"] },
  { path: "pomodoro.topicMarkedDone", args: ["Cell Division"] },
  { path: "cloudSync.mergedSummary", args: [2, 5, 1, 3, true] },
  { path: "cloudSync.pushFailed", args: ["Drive returned 403"] },
  { path: "cloudSync.pullFailed", args: ["Drive returned 404"] },
  { path: "practice.questionProgress", args: [1, 5] },
  { path: "practice.score", args: [4, 5] },
  { path: "schedulePreview.coursesCount", args: [2] },
  { path: "schedulePreview.slotsCount", args: [6] },
  { path: "schedulePreview.droppedWarning", args: [1, 2] },
  { path: "schedulePreview.replacesCurrent", args: [3, 7] },
  { path: "courseModal.colorOption", args: ["#1a73e8"] },
  { path: "courseModal.slotField", args: [2, "Start time"] },
  { path: "courseModal.slotRemove", args: [2] },
  { path: "dashboard.topicsCount", args: [3] },
  { path: "dashboard.rulesCount", args: [2] },
  { path: "dashboard.kpiWeekRange", args: ["Thu, Oct 29", "Thu, Nov 5, 2026"] },
  { path: "dashboard.countdownShort", args: [4] },
  { path: "dashboard.roomLabel", args: ["N4-102"] },
  { path: "dashboard.dueAt", args: ["09:00"] },
];

/** Resolve a dotted path inside the copy tree. */
function leafAt(path: string): CopyLeaf | undefined {
  return leaves.find((leaf) => leaf.path === path);
}

/**
 * Markers that betray an unfinished string. `NaN` is matched case-sensitively
 * on purpose: "tenant"/"Provenance" contain a lowercase "nan" and are fine.
 */
const PLACEHOLDER_MARKERS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "undefined", pattern: /undefined/ },
  { id: "NaN", pattern: /NaN/ },
  { id: "[object Object]", pattern: /\[object Object\]/ },
  { id: "TODO", pattern: /TODO/i },
  { id: "FIXME", pattern: /FIXME/i },
  { id: "Lorem ipsum", pattern: /Lorem ipsum/i },
  { id: "un-interpolated template marker", pattern: /\$\{/ },
];

/**
 * Promises the product must never make (v4 shipped several of these and
 * lost trust because of them).
 *
 * `copy.brand.tagline` is EXEMPT from the "never miss" check only: it is the
 * marketing tagline ("Never miss a quiz, lab assessment, or midterm …"),
 * not a factual promise about the sync engine. Every other leaf must stay
 * free of it.
 */
const BANNED_PROMISES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "auto-sync is on", pattern: /auto-sync is on/i },
  { id: "guaranteed", pattern: /guaranteed/i },
  { id: "never miss", pattern: /never miss/i },
  { id: "always connected", pattern: /always connected/i },
  { id: "100% accurate", pattern: /100% accurate/i },
];

const PROMISE_EXEMPTIONS: ReadonlyArray<{ path: string; promiseId: string; reason: string }> = [
  {
    path: "brand.tagline",
    promiseId: "never miss",
    reason:
      "Marketing tagline only ('Never miss a quiz, lab assessment, or midterm …'). It is not a factual claim about the scan engine, which reports honest per-source outcomes.",
  },
];

/** The free-tier disclosure, quoted from docs/rebuild/05-ai-features-plan.md §5.1. */
const AI_DISCLOSURE_PHRASES: readonly string[] = [
  "Your email announcements and timetable images are sent to Google's Gemini API when AI is used.",
  "On Google's free tier, Google may use that content to improve its products.",
];

/**
 * Walk up from the working directory until the repository-relative file is
 * found. (`import.meta.url` is an http URL under the Vitest dev server, so
 * it cannot be turned into a filesystem path.)
 */
function findRepoFile(relativePath: string): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${relativePath} above ${process.cwd()}`);
}

const AI_SPEC_PATH = findRepoFile("docs/rebuild/05-ai-features-plan.md");
const AI_SPEC_TEXT = readFileSync(AI_SPEC_PATH, "utf8");

describe("copy module conformance", () => {
  it("walks a non-trivial copy tree (the walker itself is not vacuous)", () => {
    expect(staticLeaves.length).toBeGreaterThan(50);
    expect(functionLeaves.length).toBeGreaterThan(0);
    expect(leaves.length).toBe(staticLeaves.length + functionLeaves.length);
  });

  it("has no empty strings", () => {
    const empty = staticLeaves.filter((leaf) => leaf.value.trim() === "").map((leaf) => leaf.path);
    expect(empty).toEqual([]);
  });

  it("has no placeholder smell in static strings or in template results", () => {
    const offenders: string[] = [];

    const check = (path: string, text: string) => {
      for (const marker of PLACEHOLDER_MARKERS) {
        if (marker.pattern.test(text)) {
          offenders.push(`${path}: ${marker.id}`);
        }
      }
    };

    for (const leaf of staticLeaves) {
      check(leaf.path, leaf.value);
    }
    for (const sample of FUNCTION_SAMPLES) {
      const leaf = leafAt(sample.path);
      if (!leaf || typeof leaf.value !== "function") continue;
      const result = leaf.value(...sample.args);
      check(`${leaf.path}(${sample.args.map((a) => JSON.stringify(a)).join(", ")})`, result);
    }

    expect(offenders).toEqual([]);
  });

  it("makes no promise the product does not keep", () => {
    const offenders: string[] = [];

    const check = (path: string, text: string) => {
      for (const promise of BANNED_PROMISES) {
        const exempt = PROMISE_EXEMPTIONS.some(
          (e) => e.path === path && e.promiseId === promise.id,
        );
        if (exempt) continue;
        if (promise.pattern.test(text)) {
          offenders.push(`${path}: "${promise.id}"`);
        }
      }
    };

    for (const leaf of staticLeaves) {
      check(leaf.path, leaf.value);
    }
    for (const sample of FUNCTION_SAMPLES) {
      const leaf = leafAt(sample.path);
      if (!leaf || typeof leaf.value !== "function") continue;
      check(leaf.path, leaf.value(...sample.args));
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the marketing tagline exempt only for the 'never miss' promise", () => {
    // The exemption is scoped: the tagline must still be free of every other
    // banned promise, and no other leaf may claim "never miss".
    const tagline = copy.brand.tagline;
    expect(tagline).toMatch(/never miss/i);

    const exemptions = PROMISE_EXEMPTIONS.filter((e) => e.path === "brand.tagline");
    expect(exemptions.map((e) => e.promiseId)).toEqual(["never miss"]);
    for (const exemption of exemptions) {
      expect(exemption.reason.trim().length).toBeGreaterThan(0);
    }

    const otherNeverMiss = staticLeaves.filter(
      (leaf) => leaf.path !== "brand.tagline" && /never miss/i.test(leaf.value),
    );
    expect(otherNeverMiss.map((leaf) => leaf.path)).toEqual([]);
  });

  it("calls every template function with plausible arguments and gets a string back", () => {
    const results: string[] = [];

    for (const sample of FUNCTION_SAMPLES) {
      const leaf = leafAt(sample.path);
      if (!leaf || typeof leaf.value !== "function") {
        results.push(`${sample.path}: not a function leaf`);
        continue;
      }
      let value: unknown;
      try {
        value = leaf.value(...sample.args);
      } catch (err) {
        results.push(`${sample.path}: threw ${String(err)}`);
        continue;
      }
      if (typeof value !== "string") {
        results.push(`${sample.path}: returned ${typeof value}`);
        continue;
      }
      if (value.trim() === "") {
        results.push(`${sample.path}: returned an empty string`);
      }
    }

    expect(results).toEqual([]);
  });

  it("keeps the sample-argument table complete and free of stale entries", () => {
    const functionPaths = new Set(functionLeaves.map((leaf) => leaf.path));
    const sampledPaths = new Set(FUNCTION_SAMPLES.map((sample) => sample.path));

    const unsampled = [...functionPaths].filter((path) => !sampledPaths.has(path));
    expect(unsampled).toEqual([]);

    const stale = [...sampledPaths].filter((path) => !functionPaths.has(path));
    expect(stale).toEqual([]);
  });

  it("ships the free-tier AI disclosure required by the spec", () => {
    expect(typeof copy.ai.disclosure).toBe("string");
    expect(copy.ai.disclosure.trim().length).toBeGreaterThan(0);

    for (const phrase of AI_DISCLOSURE_PHRASES) {
      expect(copy.ai.disclosure).toContain(phrase);
      // The copy must stay in sync with the spec it quotes.
      expect(AI_SPEC_TEXT).toContain(phrase);
    }

    // The disclosure ships with its "stay fully local" counterpart.
    expect(copy.ai.turnOff).toContain("Turn off to stay fully local.");
    expect(AI_SPEC_TEXT).toContain(copy.ai.turnOff);
  });
});
