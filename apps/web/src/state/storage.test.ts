import { describe, it, expect, afterEach } from "vitest";
import {
  FLASHCARDS_STORAGE_KEY,
  QUIZ_HISTORY_STORAGE_KEY,
  MISTAKES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  PREFERRED_DARK_THEME_STORAGE_KEY,
  PREFERRED_LIGHT_THEME_STORAGE_KEY,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  getInitialTheme,
  getPreferredDarkTheme,
  getPreferredLightTheme,
  applyThemeToDocument,
  loadStoredFlashcards,
  saveStoredFlashcards,
  loadStoredQuizHistory,
  saveStoredQuizHistory,
  loadStoredMistakes,
  saveStoredMistakes,
  sanitizeFlashcards,
  sanitizeQuizAttempts,
  sanitizeMistakes,
  setStorageFailureReporter,
  resetStorageFailureDedup,
  purgeLegacyStudyKeys,
} from "./storage";
import type { Flashcard, MistakeItem, QuizAttemptRecord } from "./types";

const card = (overrides: Partial<Flashcard> = {}): Flashcard => ({
  id: "card-1",
  front: "What is a joinpoint?",
  back: "A regression point where the trend changes.",
  boxLevel: 1,
  nextReviewIso: "2026-11-11",
  ...overrides,
});

const attempt = (overrides: Partial<QuizAttemptRecord> = {}): QuizAttemptRecord => ({
  id: "attempt-1",
  assessmentId: "a-1",
  assessmentTitle: "Quiz 1",
  timestamp: "2026-11-10T10:00:00.000Z",
  score: 3,
  totalQuestions: 5,
  percentage: 60,
  passed: false,
  ...overrides,
});

const mistake = (overrides: Partial<MistakeItem> = {}): MistakeItem => ({
  id: "mistake-1",
  assessmentId: "a-1",
  questionId: "q-1",
  questionText: "Which layer routes packets?",
  options: ["Network", "Transport"],
  selectedIndex: 1,
  correctIndex: 0,
  explanation: "The network layer routes.",
  timestamp: "2026-11-10T10:00:00.000Z",
  resolved: false,
  ...overrides,
});

describe("study collection storage (durable + honest)", () => {
  afterEach(() => {
    setStorageFailureReporter(null);
    resetStorageFailureDedup();
    window.localStorage.clear();
  });

  describe("round-trip per collection", () => {
    it("flashcards survive a save/load cycle", () => {
      const cards = [card(), card({ id: "card-2", front: "F2", back: "B2", boxLevel: 3 })];
      saveStoredFlashcards(cards);
      // Loads pass through the validator, which normalizes twins/defaults —
      // the round-trip guarantee is "sanitized in equals loaded".
      expect(loadStoredFlashcards()).toEqual(sanitizeFlashcards(cards));
    });

    it("quiz attempts survive a save/load cycle", () => {
      const attempts = [attempt(), attempt({ id: "attempt-2", score: 5, passed: true })];
      saveStoredQuizHistory(attempts);
      expect(loadStoredQuizHistory()).toEqual(sanitizeQuizAttempts(attempts));
    });

    it("mistakes survive a save/load cycle", () => {
      const mistakes = [mistake(), mistake({ id: "mistake-2", resolved: true })];
      saveStoredMistakes(mistakes);
      expect(loadStoredMistakes()).toEqual(sanitizeMistakes(mistakes));
    });

    it("empty storage loads as an honest empty list", () => {
      expect(loadStoredFlashcards()).toEqual([]);
      expect(loadStoredQuizHistory()).toEqual([]);
      expect(loadStoredMistakes()).toEqual([]);
    });
  });

  describe("corrupt payloads are rejected, not cast", () => {
    it("corrupt JSON loads empty and reports exactly one visible failure per key", () => {
      const failures: Array<{ op: string; key: string; error: unknown }> = [];
      setStorageFailureReporter((op, key, error) => failures.push({ op, key, error }));
      window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, "{not json");

      expect(loadStoredFlashcards()).toEqual([]);
      expect(failures).toHaveLength(1);
      expect(failures[0].op).toBe("load");
      expect(failures[0].key).toBe(FLASHCARDS_STORAGE_KEY);

      // A repeat read of the same corrupt key stays silent (first-failure-
      // per-key-per-session): the user was told once, not spammed.
      loadStoredFlashcards();
      loadStoredFlashcards();
      expect(failures).toHaveLength(1);
    });

    it("a non-array payload is rejected instead of cast into a crashing array", () => {
      // Regression: `JSON.parse(raw) as Flashcard[]` passed an object through
      // the cast, then `.filter` in the store threw. Non-arrays must load as
      // empty with a visible failure.
      const failures: unknown[] = [];
      setStorageFailureReporter((op, key, error) => failures.push({ op, key, error }));
      window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify({ id: "x" }));
      expect(loadStoredFlashcards()).toEqual([]);
      expect(failures).toHaveLength(1);

      window.localStorage.setItem(QUIZ_HISTORY_STORAGE_KEY, '"just a string"');
      expect(loadStoredQuizHistory()).toEqual([]);

      window.localStorage.setItem(MISTAKES_STORAGE_KEY, "42");
      expect(loadStoredMistakes()).toEqual([]);
    });

    it("corrupt entries are dropped and the good ones survive", () => {
      const raw = [
        card(),
        { id: "", front: "no id" },
        { id: "c2", front: 5, back: "boxLevel not a number" },
        card({ id: "c3", boxLevel: 9 }), // out of 1..5
        card({ id: "c4", boxLevel: 0 }),
        card({ id: "c5", nextReviewIso: "not-a-date" }),
        "a bare string",
        null,
        card({ id: "c6" }),
      ];
      const result = sanitizeFlashcards(raw);
      expect(result.map((c) => c.id)).toEqual(["card-1", "c6"]);
    });

    it("flashcard snake_case twins are normalized to the camelCase shape", () => {
      const result = sanitizeFlashcards([
        {
          id: "c1",
          front: "f",
          back: "b",
          box_level: 2,
          course_id: "CS101",
          next_review_iso: "2026-11-12",
        },
      ]);
      expect(result[0].boxLevel).toBe(2);
      expect(result[0].courseId).toBe("CS101");
      expect(result[0].nextReviewIso).toBe("2026-11-12");
    });

    it("quiz attempt and mistake validators drop entries without required fields", () => {
      expect(sanitizeQuizAttempts([attempt(), { id: "x" }, null])).toHaveLength(1);
      expect(sanitizeQuizAttempts([attempt({ timestamp: "nope" })])).toHaveLength(0);
      expect(
        sanitizeMistakes([mistake(), { id: "m", options: [] }, mistake({ selectedIndex: 1.5 })]),
      ).toHaveLength(1);
    });

    it("a core-serialized attempt (no percentage) is restored with the percentage derived from its own numbers", () => {
      // Desktop backups carry the core's QuizAttempt shape: score +
      // total_questions, no percentage. Dropping such entries would silently
      // lose every attempt in a desktop→PWA restore.
      const result = sanitizeQuizAttempts([
        {
          id: "attempt-core",
          assessment_id: "a-1",
          timestamp: "2026-11-11T09:00:00.000Z",
          score: 7,
          total_questions: 10,
          passed: true,
        },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].percentage).toBe(70);
      expect(result[0].assessmentId).toBe("a-1");
    });
  });

  describe("write failures are visible, state stays consistent", () => {
    it("a throwing setItem (quota) reports the failure instead of swallowing it", () => {
      const failures: Array<{ op: string; key: string }> = [];
      setStorageFailureReporter((op, key) => failures.push({ op, key }));
      // Stub the window's storage object with a quota-exploding setItem
      // (jsdom's localStorage is not on Storage.prototype, so spying there
      // would silently miss every call).
      const real = window.localStorage;
      const quotaError = new DOMException("quota exceeded", "QuotaExceededError");
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        writable: true,
        value: {
          getItem: real.getItem.bind(real),
          removeItem: real.removeItem.bind(real),
          clear: real.clear.bind(real),
          key: real.key.bind(real),
          get length() {
            return real.length;
          },
          setItem: () => {
            throw quotaError;
          },
        },
      });

      try {
        expect(() => saveStoredFlashcards([card()])).not.toThrow();
        expect(() => saveStoredQuizHistory([attempt()])).not.toThrow();
        expect(() => saveStoredMistakes([mistake()])).not.toThrow();

        expect(failures).toEqual([
          { op: "save", key: FLASHCARDS_STORAGE_KEY },
          { op: "save", key: QUIZ_HISTORY_STORAGE_KEY },
          { op: "save", key: MISTAKES_STORAGE_KEY },
        ]);
      } finally {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          writable: true,
          value: real,
        });
      }
    });

    it("purgeLegacyStudyKeys removes exactly the three legacy study keys", () => {
      window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, "[]");
      window.localStorage.setItem(QUIZ_HISTORY_STORAGE_KEY, "[]");
      window.localStorage.setItem(MISTAKES_STORAGE_KEY, "[]");
      window.localStorage.setItem("quizradar-theme", "obsidian");
      window.localStorage.setItem("quizradar_state_cache_v5", "{}");

      purgeLegacyStudyKeys();

      expect(window.localStorage.getItem(FLASHCARDS_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(QUIZ_HISTORY_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(MISTAKES_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem("quizradar-theme")).toBe("obsidian");
      expect(window.localStorage.getItem("quizradar_state_cache_v5")).toBe("{}");
    });
  });
});

describe("theme resolution (removed dark themes fall back, never unthemed)", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("every removed AMOLED id resolves to the default dark theme (Obsidian Cosmic)", () => {
    for (const legacy of ["amoled", "amoled-minimal", "amoled-sparkle"]) {
      window.localStorage.setItem(THEME_STORAGE_KEY, legacy);
      expect(getInitialTheme()).toBe(DEFAULT_DARK_THEME);
      expect(getInitialTheme()).toBe("obsidian");
    }
  });

  it("a legacy active selection (AMOLED Constellation Sparkles) applies as Obsidian Cosmic and persists the migration", () => {
    // The pre-removal picker stored this id; a fresh load must land on the
    // default dark theme — data-theme, dark class, PWA status bar and the
    // persisted key itself, not an unthemed document.
    window.localStorage.setItem(THEME_STORAGE_KEY, "amoled-sparkle");
    // jsdom has no index.html; the app ships this meta tag, seed it so the
    // status-bar color contract is observable.
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#f5f7fb">');

    const resolved = getInitialTheme();
    expect(resolved).toBe("obsidian");

    applyThemeToDocument(resolved);

    expect(document.documentElement.getAttribute("data-theme")).toBe("obsidian");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("obsidian");
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute("content")).toBe("#070a12");
  });

  it("a stored AMOLED Cosmic Stardust (amoled-nebula) loads as itself — it ships again", () => {
    // amoled-nebula was un-removed: it is a live dark theme, not a legacy id.
    window.localStorage.setItem(THEME_STORAGE_KEY, "amoled-nebula");
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#f5f7fb">');

    expect(getInitialTheme()).toBe("amoled-nebula");

    applyThemeToDocument("amoled-nebula");

    expect(document.documentElement.getAttribute("data-theme")).toBe("amoled-nebula");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("amoled-nebula");
    // AMOLED keeps the PWA status bar pitch black, not the obsidian blue-black.
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute("content")).toBe("#000000");
  });

  it("shipped dark ids still resolve to themselves", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "obsidian");
    expect(getInitialTheme()).toBe("obsidian");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getInitialTheme()).toBe("dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "solar");
    expect(getInitialTheme()).toBe("solar");
    window.localStorage.setItem(THEME_STORAGE_KEY, "amoled-nebula");
    expect(getInitialTheme()).toBe("amoled-nebula");
  });
});

describe("preferred per-mode themes (the toggle restores the user's pick)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults: Obsidian Cosmic for dark, Solar Dawn for light", () => {
    expect(getPreferredDarkTheme()).toBe(DEFAULT_DARK_THEME);
    expect(getPreferredDarkTheme()).toBe("obsidian");
    expect(getPreferredLightTheme()).toBe(DEFAULT_LIGHT_THEME);
    expect(getPreferredLightTheme()).toBe("solar");
  });

  it("a stored concrete pick is returned as itself", () => {
    window.localStorage.setItem(PREFERRED_DARK_THEME_STORAGE_KEY, "amoled-nebula");
    expect(getPreferredDarkTheme()).toBe("amoled-nebula");
    window.localStorage.setItem(PREFERRED_LIGHT_THEME_STORAGE_KEY, "solar");
    expect(getPreferredLightTheme()).toBe("solar");
  });

  it("a removed id stored as the preference falls back to the default (legacy migration holds)", () => {
    window.localStorage.setItem(PREFERRED_DARK_THEME_STORAGE_KEY, "amoled-sparkle");
    expect(getPreferredDarkTheme()).toBe("obsidian");
  });

  it("a generic id stored as the preference falls back to the default", () => {
    // Generic ids mean "the default of this mode", never a preference.
    window.localStorage.setItem(PREFERRED_DARK_THEME_STORAGE_KEY, "dark");
    expect(getPreferredDarkTheme()).toBe("obsidian");
    window.localStorage.setItem(PREFERRED_LIGHT_THEME_STORAGE_KEY, "light");
    expect(getPreferredLightTheme()).toBe("solar");
  });

  it("applying a concrete theme records it as its mode's preference; generic ids never do", () => {
    applyThemeToDocument("amoled-nebula");
    expect(window.localStorage.getItem(PREFERRED_DARK_THEME_STORAGE_KEY)).toBe("amoled-nebula");

    applyThemeToDocument("solar");
    expect(window.localStorage.getItem(PREFERRED_LIGHT_THEME_STORAGE_KEY)).toBe("solar");

    // The generic ids must not clobber the remembered picks.
    applyThemeToDocument("dark");
    applyThemeToDocument("light");
    expect(window.localStorage.getItem(PREFERRED_DARK_THEME_STORAGE_KEY)).toBe("amoled-nebula");
    expect(window.localStorage.getItem(PREFERRED_LIGHT_THEME_STORAGE_KEY)).toBe("solar");
  });

  it("the active theme resolution and the preference stay independent: a dark active theme does not touch the light preference", () => {
    window.localStorage.setItem(PREFERRED_LIGHT_THEME_STORAGE_KEY, "solar");
    applyThemeToDocument("amoled-nebula");
    expect(window.localStorage.getItem(PREFERRED_LIGHT_THEME_STORAGE_KEY)).toBe("solar");
    expect(window.localStorage.getItem(PREFERRED_DARK_THEME_STORAGE_KEY)).toBe("amoled-nebula");
  });
});
