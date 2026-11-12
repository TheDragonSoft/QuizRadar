import type { Flashcard, MistakeItem, QuizAttemptRecord, ThemeMode } from "./types";

export const THEME_STORAGE_KEY = "quizradar-theme";
export const SIDEBAR_STORAGE_KEY = "quizradar-sidebar-open";
export const GRADING_SCALE_STORAGE_KEY = "quizradar-grading-scale";
export const FLASHCARDS_STORAGE_KEY = "quizradar-flashcards";
export const QUIZ_HISTORY_STORAGE_KEY = "quizradar-quiz-history";
export const MISTAKES_STORAGE_KEY = "quizradar-mistake-bank";

// ---------------------------------------------------------------------------
// Visible storage failures (honesty doctrine: a failed check fails loudly).
// Every persistence helper below used to swallow errors with `catch { //
// ignore }`, so a full quota or a blocked store silently dropped study data.
// The store wires a reporter that raises an error toast; failures are
// reported once per (op, key) per session so a failing write in a hot path
// cannot spam the toast stack.
// ---------------------------------------------------------------------------

export type StorageFailureReporter = (op: string, key: string, error: unknown) => void;

let storageFailureReporter: StorageFailureReporter | null = null;
const reportedStorageFailures = new Set<string>();

export function setStorageFailureReporter(reporter: StorageFailureReporter | null): void {
  storageFailureReporter = reporter;
}

/** Test hook: clears the first-failure-per-key-per-session dedup window. */
export function resetStorageFailureDedup(): void {
  reportedStorageFailures.clear();
}

export function reportStorageFailure(op: string, key: string, error: unknown): void {
  const dedupKey = `${op}:${key}`;
  if (reportedStorageFailures.has(dedupKey)) return;
  reportedStorageFailures.add(dedupKey);
  try {
    storageFailureReporter?.(op, key, error);
  } catch {
    // A throwing reporter must never break the storage path itself.
  }
}

// ---------------------------------------------------------------------------
// Per-collection validators: `JSON.parse(raw) as T[]` used to pass any
// payload — including a non-array — straight into store `.filter/.map` calls
// that then crashed. Corrupt entries are dropped and the drop is reported.
// ---------------------------------------------------------------------------

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));
}

/** Normalizes the snake_case twins an imported/stored Flashcard may carry. */
function normalizeFlashcard(raw: Record<string, unknown>): Flashcard {
  return {
    id: String(raw.id),
    courseId: (raw.courseId ?? raw.course_id ?? null) as string | null,
    assessmentId: (raw.assessmentId ?? raw.assessment_id ?? null) as string | null,
    topic: (raw.topic ?? null) as string | null,
    front: String(raw.front ?? ""),
    back: String(raw.back ?? ""),
    boxLevel: Number(raw.boxLevel ?? raw.box_level ?? 1),
    reviewCount: (raw.reviewCount ?? raw.review_count ?? undefined) as number | undefined,
    nextReviewIso: (raw.nextReviewIso ?? raw.next_review_iso ?? null) as string | null,
    lastReviewedIso: (raw.lastReviewedIso ?? raw.last_reviewed_iso ?? null) as string | null,
  };
}

export function sanitizeFlashcards(value: unknown): Flashcard[] {
  if (!Array.isArray(value)) {
    // A non-array payload is rejected, not cast — and the rejection is
    // visible, or corrupt data would masquerade as "no flashcards".
    if (value !== null && value !== undefined) {
      reportStorageFailure(
        "load",
        FLASHCARDS_STORAGE_KEY,
        "Stored flashcards payload is not an array.",
      );
    }
    return [];
  }
  const valid: Flashcard[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "") continue;
    if (typeof raw.front !== "string" || typeof raw.back !== "string") continue;
    const boxLevel = Number(raw.boxLevel ?? raw.box_level ?? 1);
    if (!Number.isInteger(boxLevel) || boxLevel < 1 || boxLevel > 5) continue;
    const nextReview = raw.nextReviewIso ?? raw.next_review_iso;
    if (nextReview !== undefined && nextReview !== null && !isIsoDateString(nextReview)) continue;
    const lastReviewed = raw.lastReviewedIso ?? raw.last_reviewed_iso;
    if (lastReviewed !== undefined && lastReviewed !== null && !isIsoDateString(lastReviewed)) {
      continue;
    }
    valid.push(normalizeFlashcard(raw));
  }
  if (valid.length !== value.length) {
    reportStorageFailure(
      "load",
      FLASHCARDS_STORAGE_KEY,
      `${value.length - valid.length} corrupt flashcard entr${value.length - valid.length === 1 ? "y" : "ies"} dropped.`,
    );
  }
  return valid;
}

export function sanitizeQuizAttempts(value: unknown): QuizAttemptRecord[] {
  if (!Array.isArray(value)) {
    if (value !== null && value !== undefined) {
      reportStorageFailure(
        "load",
        QUIZ_HISTORY_STORAGE_KEY,
        "Stored quiz history payload is not an array.",
      );
    }
    return [];
  }
  const valid: QuizAttemptRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "") continue;
    if (typeof raw.assessmentId !== "string" && typeof raw.assessment_id !== "string") continue;
    if (!isIsoDateString(raw.timestamp)) continue;
    const score = Number(raw.score);
    const totalQuestions = Number(raw.totalQuestions ?? raw.total_questions);
    // The core's QuizAttempt (desktop backups) carries no percentage — derive
    // it from the same numbers the record holds (honest arithmetic, not a
    // fabricated value). A web-tier record keeps its own percentage.
    let percentage = Number(raw.percentage);
    if (!Number.isFinite(percentage)) {
      percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    }
    if (
      !Number.isFinite(score) ||
      !Number.isFinite(totalQuestions) ||
      !Number.isFinite(percentage)
    ) {
      continue;
    }
    valid.push({
      id: raw.id,
      assessmentId: String(raw.assessmentId ?? raw.assessment_id),
      assessmentTitle: String(raw.assessmentTitle ?? raw.assessment_title ?? ""),
      courseId: (raw.courseId ?? raw.course_id ?? null) as string | null,
      timestamp: String(raw.timestamp),
      score,
      totalQuestions,
      percentage,
      passed: Boolean(raw.passed),
    });
  }
  if (valid.length !== value.length) {
    reportStorageFailure(
      "load",
      QUIZ_HISTORY_STORAGE_KEY,
      `${value.length - valid.length} corrupt quiz attempt entr${value.length - valid.length === 1 ? "y" : "ies"} dropped.`,
    );
  }
  return valid;
}

export function sanitizeMistakes(value: unknown): MistakeItem[] {
  if (!Array.isArray(value)) {
    if (value !== null && value !== undefined) {
      reportStorageFailure(
        "load",
        MISTAKES_STORAGE_KEY,
        "Stored mistake bank payload is not an array.",
      );
    }
    return [];
  }
  const valid: MistakeItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id === "") continue;
    if (typeof raw.assessmentId !== "string" && typeof raw.assessment_id !== "string") continue;
    if (typeof raw.questionText !== "string" && typeof raw.question_text !== "string") continue;
    if (!Array.isArray(raw.options) || raw.options.length === 0) continue;
    if (
      !Number.isInteger(Number(raw.selectedIndex)) ||
      !Number.isInteger(Number(raw.correctIndex))
    ) {
      continue;
    }
    if (!isIsoDateString(raw.timestamp)) continue;
    valid.push({
      id: raw.id,
      attemptId: (raw.attemptId ?? raw.attempt_id ?? null) as string | null,
      assessmentId: String(raw.assessmentId ?? raw.assessment_id),
      courseId: (raw.courseId ?? raw.course_id ?? null) as string | null,
      topic: (raw.topic ?? null) as string | null,
      questionId: String(raw.questionId ?? raw.question_id ?? ""),
      questionText: String(raw.questionText ?? raw.question_text ?? ""),
      options: (raw.options as unknown[]).map(String),
      selectedIndex: Number(raw.selectedIndex),
      correctIndex: Number(raw.correctIndex),
      explanation: String(raw.explanation ?? ""),
      timestamp: String(raw.timestamp),
      resolved: Boolean(raw.resolved),
    });
  }
  if (valid.length !== value.length) {
    reportStorageFailure(
      "load",
      MISTAKES_STORAGE_KEY,
      `${value.length - valid.length} corrupt mistake entr${value.length - valid.length === 1 ? "y" : "ies"} dropped.`,
    );
  }
  return valid;
}

export function getInitialGradingScale(): "4.0" | "uk_honors" | "ects" | "percentage" {
  if (typeof window === "undefined" || !window.localStorage) return "4.0";
  try {
    const saved = window.localStorage.getItem(GRADING_SCALE_STORAGE_KEY);
    if (saved === "4.0" || saved === "uk_honors" || saved === "ects" || saved === "percentage") {
      return saved;
    }
  } catch {
    // ignore
  }
  return "4.0";
}

export function saveGradingScale(scale: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(GRADING_SCALE_STORAGE_KEY, scale);
  } catch {
    // ignore
  }
}

export function loadStoredFlashcards(): Flashcard[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(FLASHCARDS_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeFlashcards(JSON.parse(raw));
  } catch (error) {
    // Honest empty default, but the failure is visible (A2): corrupt study
    // data must never masquerade as "the user has no flashcards".
    reportStorageFailure("load", FLASHCARDS_STORAGE_KEY, error);
    return [];
  }
}

export function saveStoredFlashcards(cards: Flashcard[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify(cards));
  } catch (error) {
    reportStorageFailure("save", FLASHCARDS_STORAGE_KEY, error);
  }
}

export function loadStoredQuizHistory(): QuizAttemptRecord[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(QUIZ_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeQuizAttempts(JSON.parse(raw));
  } catch (error) {
    reportStorageFailure("load", QUIZ_HISTORY_STORAGE_KEY, error);
    return [];
  }
}

export function saveStoredQuizHistory(history: QuizAttemptRecord[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(QUIZ_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    reportStorageFailure("save", QUIZ_HISTORY_STORAGE_KEY, error);
  }
}

export function loadStoredMistakes(): MistakeItem[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(MISTAKES_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeMistakes(JSON.parse(raw));
  } catch (error) {
    reportStorageFailure("load", MISTAKES_STORAGE_KEY, error);
    return [];
  }
}

export function saveStoredMistakes(mistakes: MistakeItem[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(MISTAKES_STORAGE_KEY, JSON.stringify(mistakes));
  } catch (error) {
    reportStorageFailure("save", MISTAKES_STORAGE_KEY, error);
  }
}

/**
 * Removes the legacy localStorage study keys. Called after the one-shot
 * localStorage → IndexedDB migration commits, and by the full-wipe purge —
 * stale legacy keys must never re-import or flash back after a reset.
 */
export function purgeLegacyStudyKeys(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  for (const key of [FLASHCARDS_STORAGE_KEY, QUIZ_HISTORY_STORAGE_KEY, MISTAKES_STORAGE_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      reportStorageFailure("purge", key, error);
    }
  }
}

export function getInitialSidebarOpen(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return true;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The dark themes the UI currently ships (`applyThemeToDocument` normalizes
 *  the generic "dark" id onto the "obsidian" attribute). */
export const KNOWN_DARK_THEMES: readonly ThemeMode[] = ["dark", "obsidian", "amoled-nebula"];

/** The default dark theme — where removed/legacy dark ids resolve. */
export const DEFAULT_DARK_THEME: ThemeMode = "obsidian";

/** The light themes the UI currently ships (the generic "light" id renders
 *  the "solar" attribute). */
export const KNOWN_LIGHT_THEMES: readonly ThemeMode[] = ["light", "solar"];

/** The default light theme — Solar Dawn (the only shipped light theme). */
export const DEFAULT_LIGHT_THEME: ThemeMode = "solar";

/**
 * Dark theme ids that shipped previously (AMOLED Pure Starlight v1 and
 * Constellation Sparkles v2) but no longer exist. A stored id matching one
 * of these resolves to the default dark theme on load — never an unthemed
 * state. `amoled-nebula` (Cosmic Stardust, v3) is live again, so it is NOT
 * in this set.
 */
const LEGACY_DARK_THEMES: readonly string[] = ["amoled", "amoled-minimal", "amoled-sparkle"];

export function isDarkTheme(theme: ThemeMode): boolean {
  return (KNOWN_DARK_THEMES as readonly string[]).includes(theme);
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.localStorage) return "light";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (
      saved !== null &&
      ((KNOWN_DARK_THEMES as readonly string[]).includes(saved) ||
        (KNOWN_LIGHT_THEMES as readonly string[]).includes(saved))
    ) {
      return saved as ThemeMode;
    }
    // A dark theme that no longer ships (e.g. a removed AMOLED id) must
    // resolve to the default dark theme; the next `applyThemeToDocument`
    // persists the migrated value back to localStorage.
    if (saved !== null && LEGACY_DARK_THEMES.includes(saved)) {
      return DEFAULT_DARK_THEME;
    }
  } catch {
    // ignore
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

// ---------------------------------------------------------------------------
// Preferred per-mode themes. The Settings page models "Active Appearance
// Mode" + "Preferred Light/Dark Theme", and the TopBar toggle flips the mode.
// The resolved theme itself lives in `THEME_STORAGE_KEY` — but a mode flip
// must restore the user's *preferred* theme for that mode, not the generic
// id, so the last explicitly picked concrete theme per mode is remembered
// here. (The desktop `Config` struct carries no theme fields, and adding
// them would cross the core/ffi contract — the theme system already owns
// its localStorage persistence, so the preferences live beside it.)
// ---------------------------------------------------------------------------

export const PREFERRED_DARK_THEME_STORAGE_KEY = "quizradar-theme-preferred-dark";
export const PREFERRED_LIGHT_THEME_STORAGE_KEY = "quizradar-theme-preferred-light";

/** Generic ids render the defaults; only concrete picks update the memory. */
const GENERIC_THEME_IDS: readonly string[] = ["dark", "light"];

/**
 * The user's preferred dark theme, resolved: the last concrete dark theme
 * they picked, or Obsidian Cosmic when nothing (valid) is stored. A removed
 * id (e.g. a retired AMOLED variant) in the key falls back too — the legacy
 * migration must hold for the preference as well.
 */
export function getPreferredDarkTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_DARK_THEME;
  try {
    const saved = window.localStorage.getItem(PREFERRED_DARK_THEME_STORAGE_KEY);
    if (
      saved !== null &&
      saved !== "dark" &&
      (KNOWN_DARK_THEMES as readonly string[]).includes(saved)
    ) {
      return saved as ThemeMode;
    }
  } catch {
    // ignore
  }
  return DEFAULT_DARK_THEME;
}

/** The user's preferred light theme, resolved: Solar Dawn is the only one shipped. */
export function getPreferredLightTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_LIGHT_THEME;
  try {
    const saved = window.localStorage.getItem(PREFERRED_LIGHT_THEME_STORAGE_KEY);
    if (
      saved !== null &&
      saved !== "light" &&
      (KNOWN_LIGHT_THEMES as readonly string[]).includes(saved)
    ) {
      return saved as ThemeMode;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LIGHT_THEME;
}

/**
 * Remember a concrete theme pick for its mode. Generic ids ("dark"/"light")
 * are skipped — they mean "the default of this mode", not a preference.
 * Called from `applyThemeToDocument`, so every path that applies a theme
 * (settings pickers, appearance-mode buttons, the resolved toggle) keeps the
 * memory in sync from one code point.
 */
function rememberPreferredTheme(theme: ThemeMode): void {
  if (GENERIC_THEME_IDS.includes(theme)) return;
  const key = isDarkTheme(theme)
    ? PREFERRED_DARK_THEME_STORAGE_KEY
    : PREFERRED_LIGHT_THEME_STORAGE_KEY;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, theme);
    }
  } catch {
    // ignore — a blocked store must not break theme application
  }
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // ignore
  }
  rememberPreferredTheme(theme);

  const isDark = isDarkTheme(theme);
  const currentThemeAttr = root.getAttribute("data-theme");
  const normalizedAttr = theme === "dark" ? "obsidian" : theme === "light" ? "solar" : theme;

  if (root.classList.contains("dark") === isDark && currentThemeAttr === normalizedAttr) {
    return;
  }

  const flip = () => {
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    root.setAttribute("data-theme", normalizedAttr);

    // The installed PWA's status bar follows the theme (01 §4.8). The meta tag
    // used to stay dark in light mode because nothing ever touched it.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        normalizedAttr.startsWith("amoled")
          ? "#000000"
          : normalizedAttr === "obsidian"
            ? "#070a12"
            : "#f5f7fb",
      );
    }
  };

  // Preferred path: the View Transitions API crossfades two composited
  // snapshots on the GPU — one animation for the whole page, so large
  // surfaces never pay the per-element style/paint tax that made the old
  // universal `transition` class feel laggy.
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => unknown;
  };
  const prefersReduced =
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  if (!prefersReduced && typeof doc.startViewTransition === "function") {
    // Name the hero only for this transition: an unconditional
    // view-transition-name would make every other View Transition (settings
    // tab switches, ...) snapshot the hero and replay its scene animation.
    root.classList.add("hero-scene-transition");
    const vt = doc.startViewTransition(flip) as
      { finished?: Promise<unknown>; ready?: Promise<unknown> } | undefined;
    const cleanup = () => root.classList.remove("hero-scene-transition");
    if (vt?.ready && typeof vt.ready.catch === "function") {
      vt.ready.catch(() => {});
    }
    const finished = vt?.finished;
    if (finished && typeof finished.then === "function") {
      finished.then(cleanup, cleanup); // finished rejects when skipped
    } else {
      setTimeout(cleanup, 0);
    }
    return;
  }

  // Fallback (no View Transitions / reduced motion): the 150ms color
  // transition class, or an instant cut when reduced motion is on.
  if (!prefersReduced) {
    root.classList.add("theme-transition");
  }
  flip();
  if (!prefersReduced) {
    setTimeout(() => {
      root.classList.remove("theme-transition");
    }, 200);
  }
}
