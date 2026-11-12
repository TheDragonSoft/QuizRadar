/**
 * Study bridge — backend selection + one-time desktop migration contract.
 *
 * The desktop tier's study writes MUST reach the authoritative core SQLite
 * store (the `study_*` commands), the PWA's stay on IndexedDB, and the
 * one-time IDB → native migration stamps its marker ONLY after the native
 * write resolves durably (a failed migration loses nothing and retries).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRpcMockHandler } from "../state/rpc";
import {
  DESKTOP_STUDY_NATIVE_MARKER,
  __resetDesktopStudyMigrationForTests,
  ensureDesktopStudyMigrated,
  isDesktopNativeStudy,
  sanitizeStudySessions,
  studyBridges,
} from "./studyBridge";
import { loadFlashcardRecords, loadQuizAttemptRecords } from "./idbStore";
import { setupMockIndexedDb } from "../test/mockIndexedDb";
import { STUDY_STATS_STORAGE_KEY } from "../lib/studyStats";
import { resetStorageFailureDedup } from "../state/storage";

type RpcHandler = Parameters<typeof setRpcMockHandler>[0];

const tauriGlobals = window as unknown as Record<string, unknown>;

function goTauri(): void {
  tauriGlobals.__TAURI_INTERNALS__ = {};
}

function goBrowser(): void {
  delete tauriGlobals.__TAURI_INTERNALS__;
}

const card = (id: string) => ({
  id,
  courseId: "CS201",
  assessmentId: null,
  topic: null,
  front: `front ${id}`,
  back: `back ${id}`,
  boxLevel: 2,
  nextReviewIso: "2026-11-12",
  lastReviewedIso: null,
});

const attempt = (id: string) => ({
  id,
  assessmentId: "midterm-1",
  assessmentTitle: "Midterm 1",
  courseId: "CS201",
  timestamp: "2026-11-10T12:00:00Z",
  score: 8,
  totalQuestions: 10,
  percentage: 80,
  passed: true,
});

describe("idb study bridge (PWA tier)", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    goBrowser();
    teardownIdb = setupMockIndexedDb();
    window.localStorage.clear();
    resetStorageFailureDedup();
  });

  afterEach(() => {
    teardownIdb();
    setRpcMockHandler(null);
    vi.restoreAllMocks();
  });

  it("persists and lists cards through IndexedDB, never through rpc", async () => {
    const spy = vi.fn();
    setRpcMockHandler(spy as unknown as RpcHandler);

    await studyBridges.idb.upsertCard(card("c1"));
    const listed = await studyBridges.idb.list();

    expect(listed.flashcards.map((c) => c.id)).toEqual(["c1"]);
    expect((await loadFlashcardRecords()).map((c) => c.id)).toEqual(["c1"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("persists the computed review record and returns null (caller keeps its math)", async () => {
    const computed = { ...card("c1"), boxLevel: 3, lastReviewedIso: "2026-11-10" };
    await studyBridges.idb.upsertCard(card("c1"));
    const canonical = await studyBridges.idb.reviewCard("c1", true, computed as never);

    expect(canonical).toBeNull();
    expect((await loadFlashcardRecords())[0].boxLevel).toBe(3);
  });

  it("persists and deletes quiz attempts through IndexedDB", async () => {
    await studyBridges.idb.saveQuizAttempt(attempt("a1") as never);
    expect((await loadQuizAttemptRecords()).map((a) => a.id)).toEqual(["a1"]);

    await studyBridges.idb.deleteQuizAttempt("a1");
    expect(await loadQuizAttemptRecords()).toEqual([]);
  });
});

describe("native study bridge (desktop tier)", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    goTauri();
    teardownIdb = setupMockIndexedDb();
    window.localStorage.clear();
    resetStorageFailureDedup();
  });

  afterEach(() => {
    teardownIdb();
    setRpcMockHandler(null);
    delete tauriGlobals.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("routes every write to the study_* commands and adopts the canonical review", async () => {
    const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
    setRpcMockHandler(((fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "study_list") {
        return Promise.resolve({ flashcards: [card("native-1")], quizAttempts: [], mistakes: [] });
      }
      if (fn === "study_review_card") {
        return Promise.resolve({ ...card("native-1"), boxLevel: 4, reviewCount: 1 });
      }
      return Promise.resolve(null);
    }) as unknown as RpcHandler);

    await studyBridges.native.upsertCard(card("native-1"));
    await studyBridges.native.reviewCard("native-1", true, card("native-1") as never);
    await studyBridges.native.saveQuizAttempt(attempt("a1") as never);
    await studyBridges.native.upsertMistake({
      id: "m1",
      attemptId: null,
      assessmentId: "midterm-1",
      courseId: null,
      topic: null,
      questionId: "q1",
      questionText: "q",
      options: ["a", "b"],
      selectedIndex: 0,
      correctIndex: 1,
      explanation: "",
      timestamp: "2026-11-10T12:00:00Z",
      resolved: false,
    });
    await studyBridges.native.resolveMistake({
      id: "m1",
      attemptId: null,
      assessmentId: "midterm-1",
      courseId: null,
      topic: null,
      questionId: "q1",
      questionText: "q",
      options: ["a", "b"],
      selectedIndex: 0,
      correctIndex: 1,
      explanation: "",
      timestamp: "2026-11-10T12:00:00Z",
      resolved: true,
    });
    await studyBridges.native.deleteCard("native-1");
    await studyBridges.native.deleteQuizAttempt("a1");
    await studyBridges.native.deleteMistake("m1");

    expect(calls.map((c) => c.fn)).toEqual([
      "study_upsert_card",
      "study_review_card",
      "study_save_quiz_attempt",
      "study_upsert_mistake",
      "study_resolve_mistake",
      "study_delete_card",
      "study_delete_quiz_attempt",
      "study_delete_mistake",
    ]);
    // The native review returns the CORE-computed card; the caller adopts it.
    expect(
      await studyBridges.native.reviewCard("native-1", true, card("native-1") as never),
    ).toMatchObject({ boxLevel: 4 });
    const listed = await studyBridges.native.list();
    expect(listed.flashcards[0].id).toBe("native-1");
    // No IDB write ever happened on this tier.
    expect(await loadFlashcardRecords()).toEqual([]);
  });
});

describe("one-time IDB → native migration (marker only after durable success)", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    goTauri();
    teardownIdb = setupMockIndexedDb();
    window.localStorage.clear();
    resetStorageFailureDedup();
    __resetDesktopStudyMigrationForTests();
  });

  afterEach(() => {
    teardownIdb();
    setRpcMockHandler(null);
    delete tauriGlobals.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  const failures: Array<[string, string, unknown]> = [];
  const reportFailure = (op: string, key: string, error: unknown) => {
    failures.push([op, key, error]);
  };

  it("pushes the browser collections + stats ledger to study_migrate, then stamps the marker and clears the mirrors", async () => {
    const { putFlashcardRecord, putQuizAttemptRecord } = await import("./idbStore");
    await putFlashcardRecord(card("legacy-1") as never);
    await putQuizAttemptRecord(attempt("legacy-a1") as never);
    window.localStorage.setItem(
      STUDY_STATS_STORAGE_KEY,
      JSON.stringify({
        totalMinutes: 50,
        totalSessions: 2,
        dailyMinutes: { "2026-11-10": 25 },
        lastUpdated: "2026-11-10",
      }),
    );

    let migratePayload: unknown;
    setRpcMockHandler(((fn: string, args?: Record<string, unknown>) => {
      if (fn !== "study_migrate") return Promise.resolve(null);
      migratePayload = args?.payload;
      return Promise.resolve({
        flashcards: 1,
        quizAttempts: 1,
        mistakes: 0,
        studySessions: 0,
        studyStatsRestored: true,
      });
    }) as unknown as RpcHandler);

    await ensureDesktopStudyMigrated(reportFailure);

    expect(isDesktopNativeStudy()).toBe(true);
    expect(window.localStorage.getItem(DESKTOP_STUDY_NATIVE_MARKER)).not.toBeNull();
    const payload = migratePayload as {
      flashcards: Array<{ id: string }>;
      quizAttempts: Array<{ id: string }>;
      mistakeBank: unknown[];
      studySessions: unknown[];
      studyStats: { totalMinutes: number };
    };
    expect(payload.flashcards.map((c) => c.id)).toEqual(["legacy-1"]);
    expect(payload.quizAttempts.map((a) => a.id)).toEqual(["legacy-a1"]);
    expect(payload.mistakeBank).toEqual([]);
    expect(payload.studyStats.totalMinutes).toBe(50);
    // The browser mirrors are cleared: no path can re-read them as live data.
    expect(await loadFlashcardRecords()).toEqual([]);
    expect(await loadQuizAttemptRecords()).toEqual([]);
    // Re-running is a no-op (marker short-circuits, no second migrate call).
    migratePayload = undefined;
    await ensureDesktopStudyMigrated(reportFailure);
    expect(migratePayload).toBeUndefined();
  });

  it("never stamps the marker when the native write fails — data stays put and the next action retries", async () => {
    const { putFlashcardRecord } = await import("./idbStore");
    await putFlashcardRecord(card("keep-me") as never);

    let attempts = 0;
    setRpcMockHandler(((fn: string) => {
      if (fn !== "study_migrate") return Promise.resolve(null);
      attempts += 1;
      return Promise.reject(new Error("native store busy"));
    }) as unknown as RpcHandler);

    await expect(ensureDesktopStudyMigrated(reportFailure)).rejects.toThrow("native store busy");
    expect(isDesktopNativeStudy()).toBe(false);
    expect(window.localStorage.getItem(DESKTOP_STUDY_NATIVE_MARKER)).toBeNull();
    expect(attempts).toBe(1);
    // Nothing was lost: the browser copy is intact.
    expect((await loadFlashcardRecords()).map((c) => c.id)).toEqual(["keep-me"]);

    // A second call within the failing session dedupes (single report); after
    // the memo reset the next study action retries.
    __resetDesktopStudyMigrationForTests();
    setRpcMockHandler(((fn: string) => {
      if (fn !== "study_migrate") return Promise.resolve(null);
      attempts += 1;
      return Promise.resolve({
        flashcards: 1,
        quizAttempts: 0,
        mistakes: 0,
        studySessions: 0,
        studyStatsRestored: false,
      });
    }) as unknown as RpcHandler);
    await ensureDesktopStudyMigrated(reportFailure);
    expect(attempts).toBe(2);
    expect(isDesktopNativeStudy()).toBe(true);
  });

  it("never runs on the browser tier", async () => {
    goBrowser();
    const spy = vi.fn();
    setRpcMockHandler(spy as unknown as RpcHandler);
    await ensureDesktopStudyMigrated(reportFailure);
    expect(spy).not.toHaveBeenCalled();
    expect(isDesktopNativeStudy()).toBe(false);
  });

  it("empty browser data stamps the marker WITHOUT issuing the replace (no native wipe)", async () => {
    // A cleared webview profile (empty IndexedDB, marker gone) over an intact
    // native store: migrating empty collections would silently wipe them.
    const spy = vi.fn((fn: string) => {
      if (fn === "study_migrate") {
        throw new Error("study_migrate must not be called for empty browser data");
      }
      return Promise.resolve(null);
    });
    setRpcMockHandler(spy as unknown as RpcHandler);

    await ensureDesktopStudyMigrated(reportFailure);

    expect(isDesktopNativeStudy()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    // Subsequent actions go straight to native; empty-browser migration is
    // never re-attempted (the marker is stamped).
    __resetDesktopStudyMigrationForTests();
    await ensureDesktopStudyMigrated(reportFailure);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sanitizeStudySessions (narrow legacy guard)", () => {
  it("keeps only shape-valid core-session twins and reports nothing silently", () => {
    const valid = {
      id: "s1",
      course_id: "CS201",
      duration_minutes: 25,
      timestamp: "2026-11-10T12:00:00Z",
      date_iso: "2026-11-10",
    };
    const camelValid = {
      id: "s2",
      durationMinutes: 30,
      timestamp: "2026-11-10T13:00:00Z",
      dateIso: "2026-11-10",
    };
    const kept = sanitizeStudySessions([
      valid,
      camelValid,
      null,
      { id: "bad-date", duration_minutes: 5, date_iso: "11/10/2026" },
      { id: "no-minutes", date_iso: "2026-11-10" },
      { duration_minutes: 5, date_iso: "2026-11-10" },
    ]);
    expect(kept.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(sanitizeStudySessions("not an array")).toEqual([]);
  });
});
