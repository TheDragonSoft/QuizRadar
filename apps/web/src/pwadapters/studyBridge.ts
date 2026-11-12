/**
 * Study-collection backend bridge — one call surface, two backends.
 *
 * The desktop tier's authoritative store is the core SQLite database (the
 * `study_*` Tauri commands over the core repos); the PWA tier keeps its
 * IndexedDB adapters. The selection is made PER CALL from the live
 * environment, so tests can exercise either backend without module tricks.
 *
 * One-time migration: a desktop webview that already holds browser-local
 * study data (pre-bridge sessions, or a webview profile shared with an older
 * build) pushes it into SQLite through `study_migrate` exactly once. The
 * marker is stamped ONLY after the native write resolves durably — a failed
 * migration leaves the browser data untouched and retries on the next study
 * action, so nothing is lost and no split-brain snapshot is created.
 */

import { isTauriEnvironment, rpc } from "../state/rpc";
import type { Flashcard, MistakeItem, QuizAttemptRecord } from "../state/types";
import {
  deleteFlashcardRecord,
  idbClear,
  idbDelete,
  loadFlashcardRecords,
  loadMistakeRecords,
  loadQuizAttemptRecords,
  loadStudySessionRecords,
  putFlashcardRecord,
  putMistakeRecord,
  putQuizAttemptRecord,
} from "./idbStore";
import { sanitizeFlashcards, sanitizeMistakes, sanitizeQuizAttempts } from "../state/storage";
import { STUDY_STATS_STORAGE_KEY } from "../lib/studyStats";

/** localStorage marker: native study storage owns this webview's data. */
export const DESKTOP_STUDY_NATIVE_MARKER = "quizradar_desktop_study_native_v1";

export interface NativeStudyMigrateReport {
  flashcards: number;
  quizAttempts: number;
  mistakes: number;
  studySessions: number;
  studyStatsRestored: boolean;
}

export interface StudyBridge {
  /** Hydrate the three collections in the web record shapes (sanitized). */
  list(): Promise<{
    flashcards: Flashcard[];
    quizHistory: QuizAttemptRecord[];
    mistakeBank: MistakeItem[];
  }>;
  /** Persist a card upsert; native returns the stored canonical record. */
  upsertCard(card: Flashcard): Promise<Flashcard | null>;
  /**
   * Persist a Leitner review. `computed` is the web-tier's own math result
   * (what IndexedDB stores); the native backend re-derives the review in
   * CORE instead and returns the canonical card for the caller to adopt.
   */
  reviewCard(id: string, correct: boolean, computed: Flashcard): Promise<Flashcard | null>;
  deleteCard(id: string): Promise<void>;
  saveQuizAttempt(attempt: QuizAttemptRecord): Promise<void>;
  deleteQuizAttempt(id: string): Promise<void>;
  upsertMistake(mistake: MistakeItem): Promise<void>;
  deleteMistake(id: string): Promise<void>;
  /** Persist a mistake resolution. The caller supplies the resolved record. */
  resolveMistake(resolved: MistakeItem): Promise<void>;
}

// ---------------------------------------------------------------------------
// IndexedDB backend (PWA tier — the historical path, unchanged behavior)
// ---------------------------------------------------------------------------

const idbStudyBridge: StudyBridge = {
  async list() {
    const [cards, attempts, mistakes] = await Promise.all([
      loadFlashcardRecords(),
      loadQuizAttemptRecords(),
      loadMistakeRecords(),
    ]);
    return {
      flashcards: sanitizeFlashcards(cards),
      quizHistory: sanitizeQuizAttempts(attempts),
      mistakeBank: sanitizeMistakes(mistakes),
    };
  },
  async upsertCard(card) {
    await putFlashcardRecord(card);
    return null;
  },
  async reviewCard(_id, _correct, computed) {
    await putFlashcardRecord(computed);
    return null;
  },
  async deleteCard(id) {
    await deleteFlashcardRecord(id);
  },
  async saveQuizAttempt(attempt) {
    await putQuizAttemptRecord(attempt);
  },
  async deleteQuizAttempt(id) {
    await idbDelete("quiz_attempts", id);
  },
  async upsertMistake(mistake) {
    await putMistakeRecord(mistake);
  },
  async deleteMistake(id) {
    await idbDelete("mistake_bank", id);
  },
  async resolveMistake(resolved) {
    await putMistakeRecord(resolved);
  },
};

// ---------------------------------------------------------------------------
// Native backend (desktop tier — core SQLite via the `study_*` commands)
// ---------------------------------------------------------------------------

const nativeStudyBridge: StudyBridge = {
  async list() {
    const native = await rpc<{
      flashcards: unknown[];
      quizAttempts: unknown[];
      mistakes: unknown[];
    }>("study_list");
    return {
      flashcards: sanitizeFlashcards(native.flashcards),
      quizHistory: sanitizeQuizAttempts(native.quizAttempts),
      mistakeBank: sanitizeMistakes(native.mistakes),
    };
  },
  async upsertCard(card) {
    const stored = await rpc<Flashcard | null>("study_upsert_card", { card });
    return stored ?? null;
  },
  async reviewCard(id, correct) {
    const reviewed = await rpc<Flashcard | null>("study_review_card", { id, correct });
    return reviewed ?? null;
  },
  async deleteCard(id) {
    await rpc<boolean>("study_delete_card", { id });
  },
  async saveQuizAttempt(attempt) {
    // Wire shape is the core record: the web-only `assessmentTitle` and the
    // derived `percentage` have no core column (percentage is re-derived on
    // read from score/total — the sanitize step's own rule).
    await rpc("study_save_quiz_attempt", { attempt });
  },
  async deleteQuizAttempt(id) {
    await rpc<boolean>("study_delete_quiz_attempt", { id });
  },
  async upsertMistake(mistake) {
    await rpc("study_upsert_mistake", { mistake });
  },
  async deleteMistake(id) {
    await rpc<boolean>("study_delete_mistake", { id });
  },
  async resolveMistake(resolved) {
    await rpc<boolean>("study_resolve_mistake", { id: resolved.id });
  },
};

/** The backend for THIS call, from the live environment. */
export function activeStudyBridge(): StudyBridge {
  return isDesktopNativeStudy() ? nativeStudyBridge : idbStudyBridge;
}

/** Test seam: the two backends, for direct assertions without env tricks. */
export const studyBridges = { idb: idbStudyBridge, native: nativeStudyBridge };

// ---------------------------------------------------------------------------
// One-time IDB → native migration (desktop only)
// ---------------------------------------------------------------------------

let desktopStudyMigration: Promise<void> | null = null;
let desktopMigrationFailed = false;

export function isDesktopNativeStudy(): boolean {
  if (typeof window === "undefined" || !isTauriEnvironment()) return false;
  try {
    return window.localStorage.getItem(DESKTOP_STUDY_NATIVE_MARKER) !== null;
  } catch {
    return false;
  }
}

/** Test hook: clears the memoized migration so a fresh run re-attempts. */
export function __resetDesktopStudyMigrationForTests(): void {
  desktopStudyMigration = null;
  desktopMigrationFailed = false;
}

/**
 * The raw focus-minutes ledger (`lib/studyStats.ts` owns the shape), carried
 * into the native passthrough untouched — the core never interprets it.
 */
function readStoredStudyStatsRaw(): unknown {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STUDY_STATS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The webview's IDB `study_sessions` store is honestly empty today (the
 * pomodoro ledger lives in localStorage), but its records would be raw
 * browser shapes. Narrow minimal guard: keep only records that carry the
 * core `StudySessionRecord` fields (either naming twin) with a well-formed
 * `YYYY-MM-DD` date — a legacy garbage row must not block the whole
 * migration, and dropping an unrepresentable row is reported, not silent.
 */
export function sanitizeStudySessions(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object") return false;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "") return false;
    const minutes = Number(raw.durationMinutes ?? raw.duration_minutes);
    if (!Number.isFinite(minutes) || minutes < 0) return false;
    const date = raw.dateIso ?? raw.date_iso;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
  });
}

/**
 * One-shot desktop migration: browser-local study collections → core SQLite.
 * Memoized per session; the marker is stamped ONLY after the native write
 * resolves durably. On failure the browser data stays untouched, the memo is
 * cleared (the next study action retries) and the failure is surfaced once
 * through the shared storage-failure reporter.
 */
export function ensureDesktopStudyMigrated(
  reportFailure: (op: string, key: string, error: unknown) => void,
): Promise<void> {
  if (typeof window === "undefined" || !isTauriEnvironment()) return Promise.resolve();
  if (desktopMigrationFailed) return Promise.resolve();
  desktopStudyMigration ??= (async () => {
    try {
      if (window.localStorage.getItem(DESKTOP_STUDY_NATIVE_MARKER)) return;
      const [cards, attempts, mistakes, sessions] = await Promise.all([
        loadFlashcardRecords(),
        loadQuizAttemptRecords(),
        loadMistakeRecords(),
        loadStudySessionRecords(),
      ]);
      const stats = readStoredStudyStatsRaw();
      const hasBrowserData =
        cards.length > 0 ||
        attempts.length > 0 ||
        mistakes.length > 0 ||
        sessions.length > 0 ||
        stats !== null;
      if (!hasBrowserData) {
        // Nothing browser-local to migrate. Stamp the marker WITHOUT issuing
        // the replace: a cleared webview profile (empty IndexedDB, marker
        // gone) with an intact native store must NEVER overwrite that store's
        // study data with empty collections — that would be a silent wipe.
        window.localStorage.setItem(DESKTOP_STUDY_NATIVE_MARKER, new Date().toISOString());
        return;
      }
      const report = await rpc<NativeStudyMigrateReport>("study_migrate", {
        payload: {
          flashcards: cards,
          quizAttempts: attempts,
          mistakeBank: mistakes,
          studySessions: sanitizeStudySessions(sessions),
          studyStats: stats,
        },
      });
      // Durable success — only now does native become authoritative.
      window.localStorage.setItem(DESKTOP_STUDY_NATIVE_MARKER, new Date().toISOString());
      // The browser-local copies are now dead mirrors: clear them so no
      // export/import path can ever re-read them as live data. A failed
      // clear leaves inert rows behind (the marker keeps them ignored) —
      // reported, not hidden.
      try {
        await Promise.all([
          idbClear("flashcards"),
          idbClear("quiz_attempts"),
          idbClear("mistake_bank"),
          idbClear("study_sessions"),
        ]);
      } catch (error) {
        reportFailure("migrate", "study-mirror-clear", error);
      }
      return void report;
    } catch (error) {
      desktopStudyMigration = null; // retry on the next study action
      desktopMigrationFailed = true;
      throw error;
    }
  })().catch((error) => {
    reportFailure("migrate", "desktop-study-native", error);
    throw error;
  });
  return desktopStudyMigration;
}

/**
 * Reset support: the desktop `reset_database` command wipes the SQLite study
 * tables natively, so the web purge never calls `study_purge` for the normal
 * reset path — it only clears the memoized migration so a subsequent action
 * re-evaluates (the stamped marker survives: native and IDB are both empty).
 */
export function resetDesktopStudyMigrationMemo(): void {
  desktopStudyMigration = null;
  desktopMigrationFailed = false;
}

/** Desktop-native reset recovery path (idempotent, one transaction natively). */
export async function purgeNativeStudyCollections(): Promise<NativeStudyMigrateReport> {
  return rpc<NativeStudyMigrateReport>("study_purge");
}

/**
 * The `studyPayload` for the desktop `export_backup_file` wrapper (store.ts).
 *
 * - PWA tier / pre-migration desktop: the browser-local collections ARE the
 *   study data the core can never see, so the FULL override payload rides
 *   into the command (`buildStudyBackupSections`).
 * - Post-migration desktop: core SQLite is authoritative and its exporter
 *   already emits the collections — overriding them with the cleared browser
 *   mirrors would fabricate empty study data in the backup. Only the
 *   focus-minutes ledger (webview-localStorage, the live UI source) rides
 *   along; `null` when there is no ledger so the command leaves the core's
 *   own sections untouched.
 */
export async function buildStudyExportOverride(): Promise<Record<string, unknown> | null> {
  if (isDesktopNativeStudy()) {
    const stats = readStoredStudyStatsRaw();
    return stats === null ? null : { study_stats: stats };
  }
  const { buildStudyBackupSections } = await import("./rpcAdapter");
  return buildStudyBackupSections();
}
