import type {
  Flashcard,
  MistakeItem,
  QuizAttemptRecord,
  ThemeMode,
} from "./types";

export const THEME_STORAGE_KEY = "quizradar-theme";
export const SIDEBAR_STORAGE_KEY = "quizradar-sidebar-open";
export const GRADING_SCALE_STORAGE_KEY = "quizradar-grading-scale";
export const FLASHCARDS_STORAGE_KEY = "quizradar-flashcards";
export const QUIZ_HISTORY_STORAGE_KEY = "quizradar-quiz-history";
export const MISTAKES_STORAGE_KEY = "quizradar-mistake-bank";

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
    return raw ? (JSON.parse(raw) as Flashcard[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredFlashcards(cards: Flashcard[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // ignore
  }
}

export function loadStoredQuizHistory(): QuizAttemptRecord[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(QUIZ_HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QuizAttemptRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredQuizHistory(history: QuizAttemptRecord[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(QUIZ_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

export function loadStoredMistakes(): MistakeItem[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(MISTAKES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MistakeItem[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredMistakes(mistakes: MistakeItem[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(MISTAKES_STORAGE_KEY, JSON.stringify(mistakes));
  } catch {
    // ignore
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

export function isDarkTheme(theme: ThemeMode): boolean {
  return (
    theme === "dark" ||
    theme === "obsidian" ||
    theme === "amoled" ||
    theme === "amoled-minimal" ||
    theme === "amoled-sparkle" ||
    theme === "amoled-nebula"
  );
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.localStorage) return "light";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (
      saved === "light" ||
      saved === "dark" ||
      saved === "obsidian" ||
      saved === "solar" ||
      saved === "amoled" ||
      saved === "amoled-minimal" ||
      saved === "amoled-sparkle" ||
      saved === "amoled-nebula"
    ) {
      return saved;
    }
  } catch {
    // ignore
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
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
      | { finished?: Promise<unknown>; ready?: Promise<unknown> }
      | undefined;
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
