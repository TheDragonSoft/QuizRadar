import { create } from "zustand";
import { copy } from "../copy";
import { getModalMeta } from "../components/modalRegistry";
import { rpc } from "./rpc";
import { clearCachedState, loadCachedState, saveCachedState } from "./swr";
import { applyOptimistic } from "./optimistic";
import type {
  AiQuotaUsage,
  Assessment,
  ConfigUpdate,
  Course,
  CustomCalendarEvent,
  DesktopExtractedTimetable,
  ExportBackupResult,
  FeedConfig,
  Flashcard,
  GetStatePayload,
  ImportReport,
  LayerToggles,
  MistakeItem,
  ModalInstance,
  PracticeQuizPayload,
  QuizAttemptRecord,
  ScheduleData,
  ScheduleSlot,
  SettingsSection,
  SyncOutcome,
  SyncStatus,
  ThemeMode,
  ToastItem,
  UpdateCheckResult,
  View,
} from "./types";
import { getLocalDateString, startDayRolloverWatchdog } from "./watchdog";
import { toRustAssessment, toRustEvent, toRustSchedule, toRustSlots } from "./ipcShape";

export * from "./dateUtils";
export * from "./storage";
export * from "./initialState";

import { addDaysToIsoDate, getWeekStart, isClientIdSetupError } from "./dateUtils";
import {
  SIDEBAR_STORAGE_KEY,
  FLASHCARDS_STORAGE_KEY,
  QUIZ_HISTORY_STORAGE_KEY,
  MISTAKES_STORAGE_KEY,
  setStorageFailureReporter,
  reportStorageFailure,
  resetStorageFailureDedup,
  getInitialGradingScale,
  saveGradingScale,
  loadStoredFlashcards,
  loadStoredQuizHistory,
  loadStoredMistakes,
  purgeLegacyStudyKeys,
  sanitizeFlashcards,
  sanitizeQuizAttempts,
  sanitizeMistakes,
  getInitialSidebarOpen,
  getInitialTheme,
  isDarkTheme,
  getPreferredDarkTheme,
  getPreferredLightTheme,
  applyThemeToDocument,
} from "./storage";
import {
  getConfigValue,
  idbClear,
  idbReplaceAll,
  importLegacyStudyData,
  loadFlashcardRecords,
  loadMistakeRecords,
  loadQuizAttemptRecords,
} from "../pwadapters/idbStore";
import {
  activeStudyBridge,
  buildStudyExportOverride,
  ensureDesktopStudyMigrated,
  isDesktopNativeStudy,
  resetDesktopStudyMigrationMemo,
} from "../pwadapters/studyBridge";
import { initialFullState } from "./initialState";
import {
  recordPomodoroSession,
  STUDY_STATS_STORAGE_KEY,
  writeStoredStudyStats,
} from "../lib/studyStats";

/** Auto-idle timer for the sync outcome banner — cleared at every new scan. */
let syncIdleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Pomodoro durations — single source of truth. FocusView and PomodoroModal
 * used to each carry their own copy and the two had already started to
 * duplicate the whole timer (two concurrent intervals, two chime paths).
 */
export const POMODORO_DURATIONS = {
  pomodoro: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
} as const;

export type PomodoroMode = keyof typeof POMODORO_DURATIONS;

const STUDY_MIGRATION_MARKER = "legacy_study_data_migrated_v1";

/**
 * One-shot localStorage → IndexedDB study-data migration, memoized like
 * `ensureTopicKeysContentAddressed` (rpcAdapter.ts): the marker lives in the
 * IDB `config_kv` store, so a cleared localStorage with intact IDB never
 * re-imports stale data, and a fresh IDB with intact legacy keys still
 * imports. Marker is stamped inside the same transaction as the records, so
 * a half-applied migration cannot exist.
 */
let studyDataMigration: Promise<void> | null = null;
let studyMigrationFailed = false;

/** Test hook: clears the memoized migration so a fresh IDB re-imports. */
export function __resetStudyMigrationForTests(): void {
  studyDataMigration = null;
  studyMigrationFailed = false;
}

export function ensureStudyDataMigrated(): Promise<void> {
  if (studyMigrationFailed) return Promise.resolve();
  studyDataMigration ??= (async () => {
    if (await getConfigValue<boolean>(STUDY_MIGRATION_MARKER, false)) {
      return;
    }
    // Reads validate + report corrupt entries on their own.
    const cards = loadStoredFlashcards();
    const attempts = loadStoredQuizHistory();
    const mistakes = loadStoredMistakes();
    if (cards.length === 0 && attempts.length === 0 && mistakes.length === 0) {
      // Nothing to import — still stamp the marker so this read set is never
      // re-imported over newer IDB records later in the session.
      await importLegacyStudyData([], [], [], STUDY_MIGRATION_MARKER);
      return;
    }
    await importLegacyStudyData(cards, attempts, mistakes, STUDY_MIGRATION_MARKER);
    // Legacy keys are now superseded: remove them so a cold start never
    // paints stale localStorage data ahead of the IDB hydration.
    purgeLegacyStudyKeys();
  })().catch((error) => {
    studyDataMigration = null; // retry on the next study action
    // Only surface once: a persisting IDB outage must not toast every action.
    if (!studyMigrationFailed) {
      studyMigrationFailed = true;
      reportStorageFailure("migrate", "study-data", error);
    }
    throw error;
  });
  return studyDataMigration;
}

/**
 * Both one-shot study migrations, in order: legacy localStorage → IDB (every
 * tier), then — on the desktop tier only — the browser-local IDB collections
 * → core SQLite (the authoritative native store). Each stamps its marker
 * only after its write resolved durably; a failure is reported once and
 * retried by the next study action.
 */
async function ensureStudyStoresReady(): Promise<void> {
  await ensureStudyDataMigrated();
  await ensureDesktopStudyMigrated((op, key, error) => reportStorageFailure(op, key, error));
}

/**
 * Replaces the in-memory study slices with backend truth. Called after the
 * migrations settle at boot and after a backup import wrote the study stores
 * directly. On the desktop tier (native migration stamped) the truth is the
 * core SQLite store; otherwise the IDB adapters.
 */
export async function hydrateStudyCollections(): Promise<void> {
  await ensureStudyStoresReady().catch(() => {});
  if (isDesktopNativeStudy()) {
    try {
      const native = await activeStudyBridge().list();
      useAppStore.setState({
        flashcards: native.flashcards,
        quizHistory: native.quizHistory,
        mistakeBank: native.mistakeBank,
      });
    } catch (error) {
      // Native read failed: keep the current in-memory state and surface it —
      // silently "falling back" to cleared browser mirrors would lie.
      reportStorageFailure("load", "desktop-study-native", error);
    }
    return;
  }
  const [cards, attempts, mistakes] = await Promise.all([
    loadFlashcardRecords().catch((e) => {
      reportStorageFailure("load", FLASHCARDS_STORAGE_KEY, e);
      return null;
    }),
    loadQuizAttemptRecords().catch((e) => {
      reportStorageFailure("load", QUIZ_HISTORY_STORAGE_KEY, e);
      return null;
    }),
    loadMistakeRecords().catch((e) => {
      reportStorageFailure("load", MISTAKES_STORAGE_KEY, e);
      return null;
    }),
  ]);
  useAppStore.setState({
    ...(cards ? { flashcards: sanitizeFlashcards(cards) } : {}),
    ...(attempts ? { quizHistory: sanitizeQuizAttempts(attempts) } : {}),
    ...(mistakes ? { mistakeBank: sanitizeMistakes(mistakes) } : {}),
  });
}

/**
 * Monotonic purge epoch. Bumped at the START of every `purgeLocalStudyData`,
 * before any store is cleared. Every study write action captures the epoch
 * before its optimistic in-memory set and skips its IndexedDB write when the
 * epoch moved — otherwise an in-flight `putFlashcardRecord` (the write may
 * begin seconds before the user hits "Reset Everything") would land AFTER
 * the `idbClear` and resurrect a purged record.
 */
let studyPurgeEpoch = 0;

/** Test hook: observes the epoch without reaching into module internals. */
export function __getStudyPurgeEpochForTests(): number {
  return studyPurgeEpoch;
}

/**
 * Full local study-data wipe for "Reset Everything": legacy localStorage
 * keys, the local study-stats ledger, the SWR state cache and the IDB study
 * stores. Runs regardless of which backend `reset_database` hit, because the
 * desktop Rust reset can never reach browser-side storage.
 *
 * Honesty: a store that cannot be cleared REJECTS the purge (after each
 * failure is reported) so `resetDatabase` can never claim a clean success
 * while purged-shaped data survives on disk.
 */
export async function purgeLocalStudyData(): Promise<void> {
  // First: invalidate every in-flight study write (see the epoch contract).
  studyPurgeEpoch += 1;
  purgeLegacyStudyKeys();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(STUDY_STATS_STORAGE_KEY);
      window.sessionStorage.removeItem("quizradar_onboarding_dismissed");
    }
  } catch (error) {
    reportStorageFailure("purge", STUDY_STATS_STORAGE_KEY, error);
  }
  clearCachedState();
  // allSettled so EVERY store gets its clear attempt and every failure is
  // named — then the failures decide the outcome, loudly.
  const results = await Promise.allSettled([
    idbClear("flashcards"),
    idbClear("quiz_attempts"),
    idbClear("mistake_bank"),
    idbClear("study_sessions"),
  ]);
  const storeNames = ["flashcards", "quiz_attempts", "mistake_bank", "study_sessions"] as const;
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const name = storeNames[index];
      failures.push(name);
      reportStorageFailure("purge", name, result.reason);
    }
  });
  // The marker is gone with config_kv (PWA reset) or stale (desktop reset) —
  // either way the next study action must not treat migration as pending.
  // The desktop-native marker itself survives (native AND browser study data
  // are both empty after a reset); only the memoized attempt is cleared.
  studyDataMigration = null;
  studyMigrationFailed = false;
  resetDesktopStudyMigrationMemo();
  resetStorageFailureDedup();
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} study store${failures.length === 1 ? "" : "s"} (${failures.join(", ")}) could not be wiped`,
    );
  }
}

// Wire storage failures to the visible toast surface. The study collections
// used to fail silently (quota, blocked store) — honesty doctrine requires a
// visible error, first failure per key per session only.
setStorageFailureReporter((op, key, error) => {
  const detail = error instanceof Error ? error.message : String(error);
  useAppStore.getState().addToast({
    type: "error",
    message:
      op === "migrate"
        ? `Study data migration failed — legacy entries stay in browser storage: ${detail}`
        : `Study data was not saved (${key}): ${detail} — your in-app list still shows it for this session.`,
  });
});

export interface AppStoreState {
  // Core derived data
  data: GetStatePayload;
  isOffline: boolean;
  /** True once the first real state load finished (cache + IPC). */
  hasLoaded: boolean;

  // UI state
  view: View;
  /**
   * Section a settings opener asked for (Account/Courses/Integrations).
   * `SettingsView` scrolls to it and clears it; `null` = land at the top.
   */
  pendingSettingsSection: SettingsSection | null;
  theme: ThemeMode;
  /** Desktop rail visibility (the brand icon's hover toggle). */
  sidebarOpen: boolean;
  searchQuery: string;
  selectedCourseIds: string[] | null; // null = all courses selected
  layers: LayerToggles;

  // Modals & toasts
  openModals: ModalInstance[];
  toasts: ToastItem[];

  // Sync state
  syncStatus: SyncStatus;
  syncProgressMessage: string | null;
  /** The honest outcome of the last scan (kept after `syncStatus` resets). */
  syncOutcome: SyncOutcome | null;
  /** True while the user asked the running scan to abort. */
  cancelRequested: boolean;

  /** The device's real AI usage today (null = this tier keeps no ledger). */
  aiQuota: AiQuotaUsage | null;

  // Calendar navigation & selection
  selectedCalendarDate: string;
  currentWeekStart: string;

  // View filtering
  activeSourceFilter: string;
  activeTypeFilter: string;
  activeCourseFilterTasks: string;

  // Modal active item
  activeModalAssessmentId: string | null;

  // Actions
  setView: (view: View) => void;
  /**
   * Opens Settings as a full-screen view (the old modal is gone). An
   * optional section scrolls the page to that anchor — the callers that
   * used to open the modal with `initialTab`.
   */
  openSettings: (section?: SettingsSection) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSearchQuery: (query: string) => void;
  toggleCourseFilter: (courseId: string) => void;
  selectAllCourses: () => void;
  toggleLayer: (layer: keyof LayerToggles) => void;

  setSelectedCalendarDate: (dateIso: string) => void;
  shiftWeek: (deltaWeeks: number) => void;
  jumpToToday: () => void;
  setActiveSourceFilter: (filter: string) => void;
  setActiveTypeFilter: (filter: string) => void;
  setActiveCourseFilterTasks: (filter: string) => void;
  openAssessmentDetail: (assessmentId: string) => void;

  openModal: (modal: ModalInstance | string) => void;
  closeModal: (id?: string) => void;
  closeAllModals: () => void;
  openExternalUrl: (url: string) => Promise<void>;

  addToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => void;
  removeToast: (id: string) => void;

  loadInitialData: () => Promise<void>;
  refreshState: () => Promise<void>;
  refreshAiQuota: () => Promise<void>;
  triggerSync: () => Promise<void>;
  cancelSync: () => Promise<void>;

  toggleTopic: (assessmentId: string, topicIdx: number) => Promise<void>;
  saveGrade: (
    assessmentId: string,
    change: {
      achievedScore?: number | null;
      maxScore?: number | null;
      weightagePercent?: number | null;
    },
  ) => Promise<void>;
  dismissConflicts: () => Promise<void>;
  scheduleStudyBlocks: (assessmentId?: string) => Promise<void>;
  draftBalancedFlightPath: () => Promise<void>;
  exportIcs: (assessmentId?: string) => Promise<void>;

  updateConfig: (update: ConfigUpdate) => Promise<void>;
  upsertCourse: (course: Course, slots?: ScheduleSlot[]) => Promise<void>;
  deleteCourse: (code: string) => Promise<void>;
  saveSchedule: (schedule: ScheduleData) => Promise<void>;
  upsertAssessment: (assessment: Assessment) => Promise<void>;
  deleteAssessment: (id: string) => Promise<void>;
  addCustomEvent: (event: CustomCalendarEvent) => Promise<void>;
  deleteCustomEvent: (id: string) => Promise<void>;
  upsertFeed: (feed: FeedConfig) => Promise<void>;
  deleteFeed: (id: string) => Promise<void>;

  runGcalSync: () => Promise<void>;
  googleLogin: () => Promise<string>;
  googleLogout: () => Promise<void>;
  microsoftLogin: () => Promise<string>;
  microsoftGrantScanningAccess: () => Promise<string>;
  microsoftLogout: () => Promise<void>;
  validateGeminiKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
  extractSchedule: (image: string) => Promise<DesktopExtractedTimetable>;
  practiceGenerate: (assessmentId: string) => Promise<PracticeQuizPayload>;
  checkUpdate: () => Promise<UpdateCheckResult>;
  /** Downloads and installs the pending update (desktop only). */
  installUpdate: () => Promise<void>;
  exportBackupFile: (path?: string) => Promise<ExportBackupResult>;
  importBackupFile: (path?: string, jsonContent?: string) => Promise<ImportReport>;
  resetDatabase: () => Promise<boolean>;

  openPracticeQuiz: (assessmentId: string) => void;
  // `topicIndex` (not `topicKey`): the modal's "Mark Done" toggles the topic
  // by its index in the assessment's topic list - the same index the topic
  // checkboxes use. The two names drifted apart and the button never
  // rendered in production.
  openPomodoro: (props?: {
    assessmentId?: string;
    topicIndex?: number;
    topicTitle?: string;
  }) => void;
  openCourseModal: (course?: Course) => void;
  openEventModal: (event?: CustomCalendarEvent) => void;
  openSchedulePreview: (extracted: DesktopExtractedTimetable) => void;

  // Pomodoro
  pomodoroIsRunning: boolean;
  pomodoroSecondsLeft: number;
  /**
   * Epoch ms when the running session ends — the timer is timestamp-based so
   * tab throttling can never accumulate per-second decrement drift.
   * `null` = not running.
   */
  pomodoroEndsAt: number | null;
  /** Remaining seconds captured when paused; resume restores this remainder. */
  pomodoroPausedRemainingSec: number | null;
  /** Epoch ms when the current pause began; `null` when not paused. */
  pomodoroPausedAtMs: number | null;
  /**
   * Wall-clock pause time banked into the current session, in ms. Completion
   * credits the focused time (nominal block minus this), never the nominal
   * block — a user who paused 10 of 25 focus minutes earns 15, not 25.
   */
  pomodoroPausedMsTotal: number;
  /**
   * Consumable completion token: incremented exactly once per completed
   * session, in the same transition that records the session. Observers
   * (views) never perform completion side effects themselves.
   */
  pomodoroSessionId: number;
  pomodoroMode: "pomodoro" | "shortBreak" | "longBreak";
  togglePomodoro: () => void;
  resetPomodoro: () => void;
  setPomodoroMode: (mode: "pomodoro" | "shortBreak" | "longBreak") => void;
  tickPomodoro: () => void;

  // Grading scale
  gradingScale: "4.0" | "uk_honors" | "ects" | "percentage";
  setGradingScale: (scale: "4.0" | "uk_honors" | "ects" | "percentage") => void;

  // Week Parity filter
  weekParityFilter: "all" | "auto" | "week_a" | "week_b";
  setWeekParityFilter: (filter: "all" | "auto" | "week_a" | "week_b") => void;

  // Flashcards & Mistake Bank & Quiz History
  flashcards: Flashcard[];
  upsertFlashcard: (card: Omit<Flashcard, "id"> & { id?: string }) => Promise<void>;
  deleteFlashcard: (id: string) => Promise<void>;
  reviewFlashcard: (id: string, correct: boolean) => Promise<void>;

  quizHistory: QuizAttemptRecord[];
  recordQuizAttempt: (attempt: Omit<QuizAttemptRecord, "id">) => Promise<void>;

  mistakeBank: MistakeItem[];
  addMistake: (mistake: Omit<MistakeItem, "id">) => Promise<void>;
  resolveMistake: (id: string) => Promise<void>;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  data: initialFullState,
  isOffline: false,
  hasLoaded: false,

  view: "dashboard",
  pendingSettingsSection: null,
  theme: getInitialTheme(),
  sidebarOpen: getInitialSidebarOpen(),
  searchQuery: "",
  selectedCourseIds: null,
  layers: { exams: true, classes: true },

  openModals: [],
  toasts: [],

  syncStatus: "idle",
  syncProgressMessage: null,
  syncOutcome: null,
  cancelRequested: false,
  aiQuota: null,

  selectedCalendarDate: getLocalDateString(),
  currentWeekStart: getWeekStart(getLocalDateString()),

  activeSourceFilter: "ALL",
  activeTypeFilter: "ALL",
  activeCourseFilterTasks: "ALL",

  activeModalAssessmentId: null,

  setSelectedCalendarDate: (dateIso) =>
    set({
      selectedCalendarDate: dateIso,
      currentWeekStart: getWeekStart(dateIso),
    }),

  shiftWeek: (deltaWeeks) => {
    set({
      currentWeekStart: addDaysToIsoDate(get().currentWeekStart, deltaWeeks * 7),
    });
  },

  jumpToToday: () => {
    const today = getLocalDateString();
    set({
      selectedCalendarDate: today,
      currentWeekStart: getWeekStart(today),
    });
  },

  // Pomodoro
  pomodoroIsRunning: false,
  pomodoroSecondsLeft: POMODORO_DURATIONS.pomodoro,
  pomodoroEndsAt: null,
  pomodoroPausedRemainingSec: null,
  pomodoroPausedAtMs: null,
  pomodoroPausedMsTotal: 0,
  pomodoroSessionId: 0,
  pomodoroMode: "pomodoro",
  // Space-key (App) and view/modal buttons all toggle the SAME store timer.
  togglePomodoro: () => {
    const state = get();
    if (state.pomodoroIsRunning && state.pomodoroEndsAt !== null) {
      // Pause: capture the actual remainder, not the wall clock — and stamp
      // when the pause began so resume can bank the paused wall-clock time.
      const remainingSec = Math.max(0, Math.ceil((state.pomodoroEndsAt - Date.now()) / 1000));
      set({
        pomodoroIsRunning: false,
        pomodoroEndsAt: null,
        pomodoroPausedRemainingSec: remainingSec,
        pomodoroSecondsLeft: remainingSec,
        pomodoroPausedAtMs: Date.now(),
      });
      return;
    }
    // Resume: bank the paused wall-clock time (if this resume ends a pause)
    // so completion credits focused time, not the nominal block. A fresh
    // start (no captured remainder) begins with an empty pause ledger.
    const nowMs = Date.now();
    const resumingPause = state.pomodoroPausedRemainingSec !== null;
    const pausedMsTotal = resumingPause
      ? state.pomodoroPausedMsTotal +
        (state.pomodoroPausedAtMs !== null ? Math.max(0, nowMs - state.pomodoroPausedAtMs) : 0)
      : 0;
    const remaining = state.pomodoroPausedRemainingSec ?? POMODORO_DURATIONS[state.pomodoroMode];
    set({
      pomodoroIsRunning: true,
      pomodoroEndsAt: nowMs + remaining * 1000,
      pomodoroPausedRemainingSec: null,
      pomodoroPausedAtMs: null,
      pomodoroPausedMsTotal: pausedMsTotal,
    });
  },
  resetPomodoro: () => {
    const mode = get().pomodoroMode;
    set({
      pomodoroIsRunning: false,
      pomodoroEndsAt: null,
      pomodoroPausedRemainingSec: null,
      pomodoroPausedAtMs: null,
      pomodoroPausedMsTotal: 0,
      pomodoroSecondsLeft: POMODORO_DURATIONS[mode],
    });
  },
  // A mode switch cancels the running session WITHOUT completing it —
  // a half-run focus block must never record a study session.
  setPomodoroMode: (mode) => {
    set({
      pomodoroMode: mode,
      pomodoroSecondsLeft: POMODORO_DURATIONS[mode],
      pomodoroIsRunning: false,
      pomodoroEndsAt: null,
      pomodoroPausedRemainingSec: null,
      pomodoroPausedAtMs: null,
      pomodoroPausedMsTotal: 0,
    });
  },
  tickPomodoro: () => {
    const state = get();
    if (!state.pomodoroIsRunning || state.pomodoroEndsAt === null) return;
    const remainingMs = state.pomodoroEndsAt - Date.now();
    if (remainingMs <= 0) {
      completePomodoroSession();
      return;
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec !== state.pomodoroSecondsLeft) {
      set({ pomodoroSecondsLeft: remainingSec });
    }
  },

  // Grading scale
  gradingScale: getInitialGradingScale(),
  setGradingScale: (gradingScale) => {
    saveGradingScale(gradingScale);
    set({ gradingScale });
  },

  // Week Parity filter
  weekParityFilter: "auto",
  setWeekParityFilter: (weekParityFilter) => set({ weekParityFilter }),

  // Flashcards & Mistake Bank & Quiz History
  // Optimistic in-memory set + durable write through the study bridge: the
  // PWA tier persists to IndexedDB, the desktop tier to the authoritative
  // core SQLite store (`study_*` commands, `pwadapters/studyBridge.ts`). A
  // failed write keeps the in-session state honest and surfaces a visible
  // error toast (first failure per key per session) instead of silently
  // losing data.
  flashcards: loadStoredFlashcards(),
  upsertFlashcard: async (card) => {
    const current = get().flashcards;
    const id = card.id || `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString().slice(0, 10);
    const updatedCard: Flashcard = {
      id,
      courseId: card.courseId,
      assessmentId: card.assessmentId,
      topic: card.topic,
      front: card.front,
      back: card.back,
      boxLevel: card.boxLevel ?? 1,
      nextReviewIso: card.nextReviewIso ?? now,
      lastReviewedIso: card.lastReviewedIso,
    };
    const next = current.some((c) => c.id === id)
      ? current.map((c) => (c.id === id ? updatedCard : c))
      : [updatedCard, ...current];
    const epoch = studyPurgeEpoch;
    set({ flashcards: next });
    await ensureStudyStoresReady().catch(() => {});
    if (epoch !== studyPurgeEpoch) return; // a reset raced this write — purged state wins
    const bridge = activeStudyBridge();
    try {
      await bridge.upsertCard(updatedCard);
    } catch (error) {
      reportStorageFailure("save", FLASHCARDS_STORAGE_KEY, error);
    }
    // Post-write check too: a put that was already in flight when the reset
    // cleared the stores can COMMIT after the wipe (IndexedDB serializes the
    // transactions; an IPC write can land after the native wipe). The purged
    // state wins — remove whatever landed late.
    if (epoch !== studyPurgeEpoch) {
      try {
        await bridge.deleteCard(updatedCard.id);
      } catch (error) {
        reportStorageFailure("purge", FLASHCARDS_STORAGE_KEY, error);
      }
    }
  },
  deleteFlashcard: async (id) => {
    const next = get().flashcards.filter((c) => c.id !== id);
    const epoch = studyPurgeEpoch;
    set({ flashcards: next });
    await ensureStudyStoresReady().catch(() => {});
    if (epoch !== studyPurgeEpoch) return; // a reset raced this write
    try {
      await activeStudyBridge().deleteCard(id);
    } catch (error) {
      reportStorageFailure("save", FLASHCARDS_STORAGE_KEY, error);
    }
  },
  reviewFlashcard: async (id, correct) => {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const reviewedCards: Flashcard[] = [];
    const next = get().flashcards.map((card) => {
      if (card.id !== id) return card;
      let newBox = card.boxLevel;
      if (correct) {
        newBox = Math.min(5, card.boxLevel + 1);
      } else {
        newBox = 1;
      }
      const days = newBox === 1 ? 1 : newBox === 2 ? 2 : newBox === 3 ? 4 : newBox === 4 ? 7 : 14;
      const nextDate = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
      const updated: Flashcard = {
        ...card,
        boxLevel: newBox,
        reviewCount: (card.reviewCount || 0) + 1,
        lastReviewedIso: todayIso,
        nextReviewIso: nextDate,
      };
      reviewedCards.push(updated);
      return updated;
    });
    const epoch = studyPurgeEpoch;
    set({ flashcards: next });
    await ensureStudyStoresReady().catch(() => {});
    if (epoch !== studyPurgeEpoch) return; // a reset raced this write
    const bridge = activeStudyBridge();
    for (const reviewed of reviewedCards) {
      let canonical: Flashcard | null = null;
      try {
        // Native tier: the Leitner math runs in CORE and the canonical card
        // comes back for adoption. IDB tier: null — the computed record is
        // the persisted truth.
        canonical = await bridge.reviewCard(reviewed.id, correct, reviewed);
      } catch (error) {
        reportStorageFailure("save", FLASHCARDS_STORAGE_KEY, error);
      }
      if (canonical && epoch === studyPurgeEpoch) {
        const sanitized = sanitizeFlashcards([canonical])[0];
        if (sanitized) {
          set({
            flashcards: get().flashcards.map((c) => (c.id === sanitized.id ? sanitized : c)),
          });
        }
      }
      if (epoch !== studyPurgeEpoch) {
        try {
          await bridge.deleteCard(reviewed.id);
        } catch (error) {
          reportStorageFailure("purge", FLASHCARDS_STORAGE_KEY, error);
        }
      }
    }
  },

  quizHistory: loadStoredQuizHistory(),
  recordQuizAttempt: async (attempt) => {
    // The backend store keys on `id`: a bare Date.now() suffix would silently
    // OVERWRITE the first attempt when two are recorded in the same
    // millisecond — the random tail keeps every attempt distinct.
    const id = `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record: QuizAttemptRecord = { ...attempt, id };
    const next = [record, ...get().quizHistory];
    const epoch = studyPurgeEpoch;
    set({ quizHistory: next });
    await ensureStudyStoresReady().catch(() => {});
    if (epoch !== studyPurgeEpoch) return; // a reset raced this write
    try {
      await activeStudyBridge().saveQuizAttempt(record);
    } catch (error) {
      reportStorageFailure("save", QUIZ_HISTORY_STORAGE_KEY, error);
    }
    if (epoch !== studyPurgeEpoch) {
      // A late-committing write must not resurrect purged state.
      try {
        await activeStudyBridge().deleteQuizAttempt(record.id);
      } catch (error) {
        reportStorageFailure("purge", QUIZ_HISTORY_STORAGE_KEY, error);
      }
    }
  },

  mistakeBank: loadStoredMistakes(),
  addMistake: async (mistake) => {
    const id = `mistake-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record: MistakeItem = { ...mistake, id };
    const next = [record, ...get().mistakeBank];
    const epoch = studyPurgeEpoch;
    set({ mistakeBank: next });
    await ensureStudyStoresReady().catch(() => {});
    if (epoch !== studyPurgeEpoch) return; // a reset raced this write
    try {
      await activeStudyBridge().upsertMistake(record);
    } catch (error) {
      reportStorageFailure("save", MISTAKES_STORAGE_KEY, error);
    }
    if (epoch !== studyPurgeEpoch) {
      try {
        await activeStudyBridge().deleteMistake(record.id);
      } catch (error) {
        reportStorageFailure("purge", MISTAKES_STORAGE_KEY, error);
      }
    }
  },
  resolveMistake: async (id) => {
    const resolvedItems: MistakeItem[] = [];
    const next = get().mistakeBank.map((m) => {
      if (m.id !== id) return m;
      const updated = { ...m, resolved: true };
      resolvedItems.push(updated);
      return updated;
    });
    const epoch = studyPurgeEpoch;
    set({ mistakeBank: next });
    await ensureStudyStoresReady().catch(() => {});
    if (epoch !== studyPurgeEpoch) return; // a reset raced this write
    for (const resolved of resolvedItems) {
      try {
        await activeStudyBridge().resolveMistake(resolved);
      } catch (error) {
        reportStorageFailure("save", MISTAKES_STORAGE_KEY, error);
      }
      if (epoch !== studyPurgeEpoch) {
        try {
          await activeStudyBridge().deleteMistake(resolved.id);
        } catch (error) {
          reportStorageFailure("purge", MISTAKES_STORAGE_KEY, error);
        }
      }
    }
  },

  setActiveSourceFilter: (activeSourceFilter) => set({ activeSourceFilter }),
  setActiveTypeFilter: (activeTypeFilter) => set({ activeTypeFilter }),
  setActiveCourseFilterTasks: (activeCourseFilterTasks) => set({ activeCourseFilterTasks }),

  openAssessmentDetail: (assessmentId) => {
    set({ activeModalAssessmentId: assessmentId });
    get().openModal({
      id: "assessment-detail",
      props: { assessmentId },
    });
  },

  setView: (view) => set({ view }),

  openSettings: (section) => set({ view: "settings", pendingSettingsSection: section ?? null }),

  // applyThemeToDocument is owned by App's theme effect (runs on state
  // change) — calling it here too queued two View Transitions per click.
  setTheme: (theme) => {
    applyThemeToDocument(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const current = get().theme;
    const isDark = isDarkTheme(current);
    // A mode flip must land on the user's *preferred* theme for that mode —
    // the generic "dark"/"light" ids would always render the default tokens
    // (Obsidian/Solar) and silently discard the AMOLED Cosmic Stardust (or
    // any other) pick from Settings. The getters resolve to the defaults
    // when nothing valid is stored, and the applied theme is re-recorded by
    // `applyThemeToDocument`, so the settings pickers and this toggle share
    // one source of truth: the resolved id in `theme`.
    const next: ThemeMode = isDark ? getPreferredLightTheme() : getPreferredDarkTheme();
    applyThemeToDocument(next);
    set({ theme: next });
  },

  toggleSidebar: () => {
    const sidebarOpen = !get().sidebarOpen;
    set({ sidebarOpen });
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarOpen ? "1" : "0");
      }
    } catch {
      // ignore
    }
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  toggleCourseFilter: (courseId) => {
    const current = get().selectedCourseIds;
    const allCourses = get().data.schedule.courses.map((c) => c.id);

    if (current === null) {
      // Transition from "all selected" to "all except this one"
      set({ selectedCourseIds: allCourses.filter((id) => id !== courseId) });
      return;
    }

    if (current.includes(courseId)) {
      const next = current.filter((id) => id !== courseId);
      set({ selectedCourseIds: next });
    } else {
      const next = [...current, courseId];
      // If all are selected, normalize back to null
      set({ selectedCourseIds: next.length === allCourses.length ? null : next });
    }
  },

  selectAllCourses: () => set({ selectedCourseIds: null }),

  toggleLayer: (layer) => {
    set((state) => ({
      layers: {
        ...state.layers,
        [layer]: !state.layers[layer],
      },
    }));
  },

  openModal: (modal) => {
    const instance: ModalInstance =
      typeof modal === "string"
        ? { id: modal, dismissible: true }
        : { dismissible: true, ...modal };
    const meta = getModalMeta(instance.id);
    if (meta) {
      if (instance.size === undefined && meta.size !== undefined) instance.size = meta.size;
      if (instance.flush === undefined && meta.flush !== undefined) instance.flush = meta.flush;
    }
    set((state) => ({
      openModals: [...state.openModals.filter((m) => m.id !== instance.id), instance],
    }));
  },

  closeModal: (id) => {
    set((state) => {
      if (state.openModals.length === 0) return state;
      if (!id) {
        // Close top-most modal
        return { openModals: state.openModals.slice(0, -1) };
      }
      return { openModals: state.openModals.filter((m) => m.id !== id) };
    });
  },

  closeAllModals: () => set({ openModals: [] }),

  /**
   * Opens a provider console page in the system browser (desktop) or a new
   * tab (web tier). Used by the OAuth setup hints so the user can reach the
   * exact console page without hunting for it.
   */
  openExternalUrl: async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  },

  addToast: (toast) => {
    // Deduplicate identical active toast messages
    if (get().toasts.some((t) => t.message === toast.message)) {
      return;
    }
    const id = toast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const defaultDuration = toast.type === "error" ? 6000 : 4000;
    const fullToast: ToastItem = {
      id,
      message: toast.message,
      type: toast.type,
      duration: toast.duration ?? defaultDuration,
    };

    set((state) => ({
      toasts: [...state.toasts.slice(-4), fullToast],
    }));

    if (fullToast.duration && fullToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, fullToast.duration);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  loadInitialData: async () => {
    // 1. SWR: Load from local storage cache immediately
    const cached = loadCachedState();
    if (cached) {
      set({ data: cached });
    }

    // 2. Refresh from IPC in background
    await get().refreshState();
    // 3. Mark the first load as done — first-run gating waits for this so a
    //    returning user never gets the onboarding wizard flashed at them.
    set({ hasLoaded: true });
    // 4. Study collections: the slices painted at module init come from the
    //    legacy localStorage snapshot (stale-while-revalidate, same as the
    //    SWR cache); IDB truth replaces it once the one-shot migration
    //    settles. A failed migration is reported by its own path.
    await hydrateStudyCollections();
  },

  refreshState: async () => {
    try {
      const fresh = await rpc<GetStatePayload>("get_state");
      saveCachedState(fresh);
      set({ data: fresh, isOffline: false });
    } catch {
      // In offline / browser environment, maintain cached state honestly
      set({ isOffline: true });
    }
  },

  refreshAiQuota: async () => {
    // Best-effort: a tier without a ledger reports "not tracked" instead of
    // a zero that would read as "you used nothing".
    try {
      const usage = await rpc<AiQuotaUsage>("ai_quota_usage");
      set({
        aiQuota: {
          callsToday: usage?.callsToday ?? null,
          perModel: usage?.perModel ?? {},
          // The scope flags must survive the copy: a tier that counts calls
          // in memory for this session must never be shown as a daily
          // ledger, and a tier without a key in memory must say so instead
          // of waiting for a failed call to explain it.
          sessionScope: usage?.sessionScope === true,
          keyInMemory: usage?.keyInMemory,
        },
      });
    } catch {
      set({ aiQuota: { callsToday: null, perModel: {} } });
    }
  },

  triggerSync: async () => {
    // Re-entrancy guard: overlapping scans overwrite each other's outcome and
    // orphan the older request's abort controller.
    if (get().syncStatus === "syncing") return;
    // A stale auto-idle timer from the previous scan must never cut the new
    // scan's success/error display short.
    if (syncIdleTimer !== null) {
      clearTimeout(syncIdleTimer);
      syncIdleTimer = null;
    }
    set({
      syncStatus: "syncing",
      syncProgressMessage: copy.topBar.syncScanning,
      syncOutcome: null,
      cancelRequested: false,
    });
    try {
      const result = await rpc<{
        success: boolean;
        totalNew: number;
        totalUpdated: number;
        notes?: string[];
      }>("run_sync");
      await get().refreshState();
      const outcome: SyncOutcome = {
        status: "success",
        totalNew: result?.totalNew ?? 0,
        totalUpdated: result?.totalUpdated ?? 0,
        notes: result?.notes ?? [],
      };
      set({ syncStatus: "success", syncProgressMessage: null, syncOutcome: outcome });
      get().addToast({
        type: "success",
        message: copy.topBar.syncSyncedSummary(outcome.totalNew, outcome.totalUpdated),
      });
      syncIdleTimer = setTimeout(() => {
        if (get().syncStatus === "success") {
          set({ syncStatus: "idle" });
        }
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (get().cancelRequested) {
        // The user aborted the scan: the backend dropped the in-flight
        // requests and left the radar untouched. That is a cancellation,
        // not a failure, and it is reported as one.
        set({
          syncStatus: "idle",
          syncProgressMessage: null,
          syncOutcome: {
            status: "canceled",
            totalNew: 0,
            totalUpdated: 0,
            notes: [],
            message: copy.topBar.syncCanceled,
          },
        });
        get().addToast({ type: "info", message: copy.topBar.syncCanceled });
        return;
      }
      set({
        syncStatus: "error",
        syncProgressMessage: null,
        syncOutcome: {
          status: "error",
          totalNew: 0,
          totalUpdated: 0,
          notes: [],
          message: msg,
        },
      });
      get().addToast({
        type: "error",
        message: `${copy.topBar.syncFailed}: ${msg}`,
      });
      syncIdleTimer = setTimeout(() => {
        if (get().syncStatus === "error") {
          set({ syncStatus: "idle" });
        }
      }, 4000);
    }
  },

  cancelSync: async () => {
    if (get().syncStatus !== "syncing") return;
    set({ cancelRequested: true });
    try {
      await rpc("cancel_sync");
    } catch {
      // The abort is best-effort: the desktop aborts the running scan, the
      // browser tier aborts its feed fetches. If the bridge is gone the scan
      // fails on its own and is reported honestly as a failure.
    }
  },

  toggleTopic: async (assessmentId, topicIdx) => {
    const prevData = get().data;
    const addToast = get().addToast;
    // `undefined` when this store snapshot has no record of the topic (past
    // assessments never appear in study_recommendations): the backend then
    // inverts the topic's OWN persisted state instead of receiving an
    // absolute `false` that would silently no-op a check or clear a
    // completed topic.
    let intendedCompleted: boolean | undefined = undefined;

    await applyOptimistic(
      // 1. Synchronous optimistic update
      () => {
        const nextData = JSON.parse(JSON.stringify(prevData)) as GetStatePayload;
        let toggledDone = false;
        let topicFound = false;

        // In study recommendations
        const rec = nextData.dashboard.studyRecommendations.find(
          (r) => r.assessmentId === assessmentId,
        );
        if (rec) {
          const item = rec.topics.find((t) => t.topicIndex === topicIdx);
          if (item) {
            item.completed = !item.completed;
            toggledDone = item.completed;
            topicFound = true;
          }
          // The card's own percentage must move with the checkbox instead of
          // waiting for the server round-trip.
          const recDone = rec.topics.filter((t) => t.completed).length;
          rec.progressPercent =
            rec.topics.length > 0 ? Math.round((recDone / rec.topics.length) * 100) : 100;
        }

        // In study tasks payload days
        nextData.studyTasksPayload.days.forEach((day) => {
          day.tasks.forEach((task) => {
            if (task.assessmentId === assessmentId && task.topicIndex === topicIdx) {
              task.completed = !task.completed;
              toggledDone = task.completed;
              topicFound = true;
            }
          });
        });

        // In readiness cards
        const card = nextData.studyTasksPayload.readinessCards.find(
          (c) => c.assessmentId === assessmentId,
        );
        if (card) {
          if (toggledDone) {
            card.completedCount = Math.min(card.totalCount, card.completedCount + 1);
          } else {
            card.completedCount = Math.max(0, card.completedCount - 1);
          }
          card.readinessPercent =
            card.totalCount > 0 ? Math.round((card.completedCount / card.totalCount) * 100) : 100;
        }

        // Global readiness & counts. The dashboard KPI counts EVERY upcoming
        // assessment's topics (core `build_dashboard_summary`), while the
        // readiness cards only cover the 14-day study horizon - summing the
        // cards made the KPI jump to a different population after a toggle.
        if (topicFound) {
          intendedCompleted = toggledDone;
        }
        let totalCompleted = 0;
        let totalTopics = 0;
        nextData.dashboard.studyRecommendations.forEach((rec) => {
          totalTopics += rec.topics.length;
          totalCompleted += rec.topics.filter((t) => t.completed).length;
        });
        nextData.dashboard.completedTopicsCount = totalCompleted;
        nextData.dashboard.totalTopicsCount = totalTopics;
        nextData.dashboard.readinessPercent =
          totalTopics > 0 ? Math.round((totalCompleted / totalTopics) * 100) : 100;

        set({ data: nextData });
      },
      // 2. Network call — the intended value travels with the request so the
      // adapter never does a racy read-modify-write for it.
      async () => {
        return await rpc<GetStatePayload>("toggle_topic", {
          assessmentId,
          topicIdx,
          completed: intendedCompleted,
        });
      },
      // 3. Rollback — the stale snapshot is only an instant patch; a refresh
      // then restores server truth so a concurrent confirmed update (e.g. a
      // grade saved while this toggle was in flight) is never clobbered.
      () => {
        set({ data: prevData });
        void get().refreshState();
      },
      {
        addToast,
        onSuccess: (freshState) => {
          saveCachedState(freshState);
          set({ data: freshState });
        },
        errorToast: "Failed to update topic. Reverted changes.",
      },
    );
  },

  saveGrade: async (assessmentId, change) => {
    const prevData = get().data;
    const addToast = get().addToast;

    await applyOptimistic(
      // 1. Synchronous optimistic update
      () => {
        const nextData = JSON.parse(JSON.stringify(prevData)) as GetStatePayload;
        const a = nextData.assessments.find((x) => x.id === assessmentId);
        if (a) {
          if (change.achievedScore !== undefined) a.achievedScore = change.achievedScore;
          if (change.maxScore !== undefined) a.maxScore = change.maxScore;
          if (change.weightagePercent !== undefined) a.weightagePercent = change.weightagePercent;
        }
        set({ data: nextData });
      },
      // 2. Network call
      async () => {
        return await rpc<GetStatePayload>("save_grade", {
          assessmentId,
          achievedScore: change.achievedScore,
          maxScore: change.maxScore,
          weightagePercent: change.weightagePercent,
        });
      },
      // 3. Rollback — the stale snapshot is only an instant patch; a refresh
      // then restores server truth (see toggleTopic).
      () => {
        set({ data: prevData });
        void get().refreshState();
      },
      {
        addToast,
        successToast: "Grade saved successfully",
        errorToast: "Failed to save grade. Reverted changes.",
        onSuccess: (freshState) => {
          saveCachedState(freshState);
          set({ data: freshState });
        },
      },
    );
  },

  dismissConflicts: async () => {
    const prevData = get().data;
    const addToast = get().addToast;

    await applyOptimistic(
      // 1. Synchronous optimistic update
      () => {
        const nextData = JSON.parse(JSON.stringify(prevData)) as GetStatePayload;
        nextData.config.dismissConflictBanner = true;
        set({ data: nextData });
      },
      // 2. Network call
      async () => {
        return await rpc<GetStatePayload>("dismiss_conflicts", {});
      },
      // 3. Rollback — refresh for server truth (see toggleTopic).
      () => {
        set({ data: prevData });
        void get().refreshState();
      },
      {
        addToast,
        successToast: "Conflict alert banner dismissed",
        errorToast: "Failed to dismiss conflicts.",
        onSuccess: (freshState) => {
          saveCachedState(freshState);
          set({ data: freshState });
        },
      },
    );
  },

  scheduleStudyBlocks: async (assessmentId) => {
    try {
      const before = get().data.config.customEvents ?? [];
      const beforeIds = new Set(before.map((event) => event.id));
      const freshState = await rpc<GetStatePayload>("schedule_study_blocks", { assessmentId });
      saveCachedState(freshState);
      set({ data: freshState });

      // Report what actually happened. The old toast claimed success even
      // when no block was written (no free window, no confirmed date, or the
      // block already existed).
      const created = (freshState.config.customEvents ?? []).filter(
        (event) =>
          !beforeIds.has(event.id) &&
          (event.eventType === "Study Session" || event.id.startsWith("study-block-")),
      ).length;

      if (created > 0) {
        get().addToast({
          type: "success",
          message: copy.dashboard.conflictBanner.blocksCreated(created),
        });
        return;
      }

      // Nothing was written — say WHY, using the assessments the action
      // targeted (an assessment without a confirmed date cannot get a block).
      const assessments = get().data.assessments ?? [];
      const targets = assessmentId
        ? assessments.filter((a) => a.id === assessmentId)
        : assessments.filter(
            (a) =>
              a.isUpcoming &&
              a.daysUntil !== null &&
              a.daysUntil !== undefined &&
              a.daysUntil >= 0 &&
              a.daysUntil <= 6,
          );
      const undated = targets.filter((a) => !a.dateIso).length;
      get().addToast({
        type: "warning",
        message:
          undated > 0
            ? copy.dashboard.conflictBanner.blocksSkippedUndated(undated)
            : copy.dashboard.conflictBanner.blocksNoWindow,
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to schedule study blocks: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  draftBalancedFlightPath: async () => {
    try {
      const state = get().data;
      const alerts = state.dashboard.conflictAlerts ?? [];
      const unresolved = alerts.filter((a) => !a.isMitigated);
      if (unresolved.length === 0) {
        await get().scheduleStudyBlocks();
        return;
      }

      const assessments = state.assessments ?? [];
      const schedule = state.schedule;
      const existingEvents = [...(state.config.customEvents ?? [])];
      let createdCount = 0;

      const isSlotFree = (dateIso: string, start: string, end: string) => {
        const d = new Date(dateIso + "T00:00:00");
        const dayIdx = d.getDay();
        const startMin = parseInt(start.slice(0, 2), 10) * 60 + parseInt(start.slice(3, 5), 10);
        const endMin = parseInt(end.slice(0, 2), 10) * 60 + parseInt(end.slice(3, 5), 10);

        for (const slot of schedule.slots ?? []) {
          if (slot.dayIndex === dayIdx) {
            const sStart =
              parseInt(slot.startTime.slice(0, 2), 10) * 60 +
              parseInt(slot.startTime.slice(3, 5), 10);
            const sEnd =
              parseInt(slot.endTime.slice(0, 2), 10) * 60 + parseInt(slot.endTime.slice(3, 5), 10);
            if (Math.max(startMin, sStart) < Math.min(endMin, sEnd)) return false;
          }
        }
        for (const ev of existingEvents) {
          if (ev.dateIso === dateIso) {
            if (ev.startTime && ev.endTime) {
              const eStart =
                parseInt(ev.startTime.slice(0, 2), 10) * 60 +
                parseInt(ev.startTime.slice(3, 5), 10);
              const eEnd =
                parseInt(ev.endTime.slice(0, 2), 10) * 60 + parseInt(ev.endTime.slice(3, 5), 10);
              if (Math.max(startMin, eStart) < Math.min(endMin, eEnd)) return false;
            } else {
              return false;
            }
          }
        }
        return true;
      };

      const windowCandidates = [
        { start: "16:30", end: "18:00" },
        { start: "18:30", end: "20:00" },
        { start: "14:30", end: "16:00" },
        { start: "10:00", end: "11:30" },
      ];

      const findWindowForDay = (dateIso: string) => {
        for (const win of windowCandidates) {
          if (isSlotFree(dateIso, win.start, win.end)) {
            return win;
          }
        }
        return null;
      };

      // Anchored at UTC noon (addDaysToIsoDate) so the date never shifts with
      // the device timezone — a local-midnight toISOString() round-trip moved
      // every study block one day early for users east of UTC.
      const dateMinusDays = (baseIso: string, days: number) => addDaysToIsoDate(baseIso, -days);

      for (const alert of unresolved) {
        const a1 = assessments.find((a) => a.id === alert.assessmentAId);
        const a2 = assessments.find((a) => a.id === alert.assessmentBId);
        if (!a1 || !a2 || !a1.dateIso || !a2.dateIso) continue;

        const [first, second] = a1.dateIso <= a2.dateIso ? [a1, a2] : [a2, a1];
        const firstDate: string = first.dateIso!;
        const secondDate: string = second.dateIso!;

        const planSchedule = [
          {
            target: first,
            dayOffset: 3,
            label: "Deep Focus Review",
            blockId: `study-block-${first.id}`,
          },
          {
            target: second,
            dayOffset: 2,
            label: "Deep Focus Review",
            blockId: `study-block-${second.id}`,
          },
          {
            target: first,
            dayOffset: 1,
            label: "Final Pre-Exam Polish",
            blockId: `study-block-${first.id}-polish`,
          },
        ];

        if (secondDate > firstDate) {
          planSchedule.push({
            target: second,
            dayOffset: 0,
            label: "Targeted Concept Refresh",
            blockId: `study-block-${second.id}-refresh`,
          });
        }

        for (const item of planSchedule) {
          const targetDateIso = dateMinusDays(firstDate, item.dayOffset);
          if (existingEvents.some((e) => e.id === item.blockId)) continue;

          const freeWin = findWindowForDay(targetDateIso);
          if (freeWin) {
            const newEvent: CustomCalendarEvent = {
              id: item.blockId,
              title: `Study: ${item.target.title} (${item.label})`,
              courseId: item.target.courseId ?? null,
              eventType: "Study Session",
              dateIso: targetDateIso,
              startTime: freeWin.start,
              endTime: freeWin.end,
              room: null,
              notes: `Balanced flight path study block for ${item.target.title} to resolve orbital conflict.`,
              color: "#10b981",
            };
            await get().addCustomEvent(newEvent);
            existingEvents.push(newEvent);
            createdCount++;
          }
        }
      }

      await get().refreshState();

      if (createdCount > 0) {
        get().addToast({
          type: "success",
          message: copy.dashboard.conflictBanner.balancedPathCreated(createdCount),
        });
      } else {
        await get().scheduleStudyBlocks();
      }
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to draft balanced study flight path: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  exportIcs: async (assessmentId) => {
    try {
      let icsContent: string;
      let degraded = false;
      try {
        icsContent = await rpc<string>("export_ics", { assessmentId });
      } catch {
        degraded = true;
        const assessments = assessmentId
          ? get().data.assessments.filter((a) => a.id === assessmentId)
          : get().data.assessments;
        const escapeIcs = (str: string) =>
          str
            .replace(/\\/g, "\\\\")
            .replace(/;/g, "\\;")
            .replace(/,/g, "\\,")
            .replace(/\r?\n/g, "\\n");
        const nowStamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
        icsContent = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//QuizRadar//v5//EN",
          ...assessments.map((a) => {
            const rawSummary = `${a.courseName || a.courseId ? `${a.courseName || a.courseId}: ` : ""}${a.title}`;
            const safeUid = a.id.replace(/[\r\n]/g, "");
            const dateStr = a.dateIso ? a.dateIso.replace(/-/g, "") : "";
            // Calculate next day for exclusive all-day DTEND
            let nextDateStr = "";
            if (a.dateIso) {
              const d = new Date(a.dateIso + "T00:00:00Z");
              d.setUTCDate(d.getUTCDate() + 1);
              nextDateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
            }
            return [
              "BEGIN:VEVENT",
              `UID:quizradar-${safeUid}@quizradar.local`,
              `DTSTAMP:${nowStamp}`,
              `SUMMARY:${escapeIcs(rawSummary)}`,
              dateStr ? `DTSTART;VALUE=DATE:${dateStr}` : "",
              nextDateStr ? `DTEND;VALUE=DATE:${nextDateStr}` : "",
              "END:VEVENT",
            ]
              .filter(Boolean)
              .join("\r\n");
          }),
          "END:VCALENDAR",
        ].join("\r\n");
      }

      if (typeof window !== "undefined" && typeof document !== "undefined") {
        const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = assessmentId ? `${assessmentId}.ics` : "quizradar_exams.ics";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      get().addToast({
        type: "success",
        // The degraded fallback (no times, no undated items) is an honest
        // downgrade the user must know about, not a silent success.
        message: degraded
          ? "Calendar file exported from local cache — full export unavailable right now."
          : "Calendar file (.ics) downloaded successfully",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to export ICS: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  updateConfig: async (update) => {
    try {
      const fresh = await rpc<GetStatePayload>("update_config", { update });
      saveCachedState(fresh);
      set({ data: fresh });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to update configuration: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  upsertCourse: async (course, slots) => {
    try {
      // The desktop shell parses the core's snake_case schema — the adapter
      // adds the twin keys so a camelCase payload from the UI is accepted.
      const fresh = await rpc<GetStatePayload>("upsert_course", {
        course,
        slots: toRustSlots(slots),
      });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: `Course ${course.id} saved successfully`,
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to save course: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  deleteCourse: async (code) => {
    try {
      const fresh = await rpc<GetStatePayload>("delete_course", { code });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: `Course ${code} deleted`,
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to delete course: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  saveSchedule: async (schedule) => {
    try {
      const fresh = await rpc<GetStatePayload>("save_schedule", {
        schedule: toRustSchedule(schedule),
      });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: "Schedule updated successfully",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to save schedule: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  upsertAssessment: async (assessment) => {
    try {
      const fresh = await rpc<GetStatePayload>("upsert_assessment", {
        assessment: toRustAssessment(assessment),
      });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: "Assessment saved",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to save assessment: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  deleteAssessment: async (id) => {
    try {
      const fresh = await rpc<GetStatePayload>("delete_assessment", { id });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: "Assessment deleted",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to delete assessment: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  addCustomEvent: async (event) => {
    try {
      const fresh = await rpc<GetStatePayload>("add_custom_event", {
        event: toRustEvent(event),
      });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: "Calendar event saved",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to save event: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  deleteCustomEvent: async (id) => {
    try {
      const fresh = await rpc<GetStatePayload>("delete_custom_event", { id });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: "Calendar event deleted",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to delete event: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  upsertFeed: async (feed) => {
    try {
      const fresh = await rpc<GetStatePayload>("upsert_feed", { feed });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: `Feed "${feed.name}" saved`,
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to save feed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  deleteFeed: async (id) => {
    try {
      const fresh = await rpc<GetStatePayload>("delete_feed", { id });
      saveCachedState(fresh);
      set({ data: fresh });
      get().addToast({
        type: "success",
        message: "Feed removed",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to delete feed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },

  runGcalSync: async () => {
    try {
      get().addToast({
        type: "info",
        message: "Pushing assessments to Google Calendar...",
      });
      const res = await rpc<{
        success: boolean;
        created: number;
        updated: number;
        needsScope?: boolean;
        message: string;
      }>("run_gcal_sync");
      await get().refreshState();
      // The desktop tier returns Ok with success=false for a missing scope or
      // a partial push (core sets an explanatory message) — a failed push must
      // never be displayed with success styling.
      if (res.success) {
        get().addToast({
          type: "success",
          message: res.message || "Google Calendar sync completed",
        });
      } else {
        get().addToast({
          type: res.needsScope ? "warning" : "error",
          message: res.message || "Google Calendar sync failed",
        });
      }
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Google Calendar sync failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  googleLogin: async () => {
    try {
      const result = await rpc<string | { url: null; port: null; mode: string }>(
        "google_login_start",
      );

      // Desktop: the command returns the PKCE authorize URL and the ephemeral
      // loopback listener is already waiting for the redirect.
      if (typeof result === "string" && result !== "error") {
        get().addToast({ type: "info", message: "Opening Google sign-in in your browser…" });
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(result);
        } catch {
          window.open(result, "_blank", "noopener");
        }
        return result;
      }

      // Browser (PWA/dev server) tier: GIS token client, 1h memory-only token.
      const clientId = get().data.config.googleClientId?.trim();
      if (!clientId) {
        throw new Error(
          "Google sign-in on the web tier needs your own OAuth client ID. Open Settings → Account → Browser Sign-In and paste a Google 'Web application' client ID (PKCE, no secret).",
        );
      }
      const { googleGisLogin } = await import("../pwadapters/browserSources");
      const profile = await googleGisLogin(clientId);
      await get().updateConfig({
        userEmail: profile.email ?? undefined,
        userName: profile.name ?? undefined,
        userPicture: profile.picture ?? undefined,
      });
      await get().refreshState();
      get().addToast({
        type: "success",
        message: "Google account connected (1h session token held in memory)",
      });
      return "gis";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A missing/invalid OAuth client id is a setup problem, not a crash:
      // open the exact settings screen that fixes it and keep the toast short.
      if (isClientIdSetupError(message)) {
        get().openSettings("account");
        get().addToast({
          type: "error",
          message: "Google sign-in needs a usable client ID — Settings → Account is now open.",
        });
        return "error";
      }
      get().addToast({
        type: "error",
        message: `Google sign-in failed: ${message}`,
      });
      return "error";
    }
  },

  googleLogout: async () => {
    try {
      await rpc("google_logout");
      await get().refreshState();
      get().addToast({
        type: "info",
        message: "Google account disconnected and tokens wiped",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to disconnect Google: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  microsoftLogin: async () => {
    try {
      const result = await rpc<string | { url: null; port: null; mode: string }>(
        "microsoft_login_start",
      );

      // Desktop: authorize URL + waiting loopback listener.
      if (typeof result === "string" && result !== "error") {
        get().addToast({ type: "info", message: "Opening Microsoft sign-in in your browser…" });
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(result);
        } catch {
          window.open(result, "_blank", "noopener");
        }
        return result;
      }

      // Browser tier: auth-code + PKCE popup against the v2 endpoints.
      const clientId = get().data.config.teamsClientId?.trim();
      if (!clientId) {
        throw new Error(
          "Microsoft Teams sign-in on the web tier needs your own Azure app client ID. Open Settings → Account → Browser Sign-In and paste it (register this app's origin as a SPA redirect URI).",
        );
      }
      const { microsoftPkcePopupLogin } = await import("../pwadapters/browserSources");
      const profile = await microsoftPkcePopupLogin(clientId);
      await get().updateConfig({
        userEmail: profile.email ?? undefined,
        userName: profile.name ?? undefined,
        ...(profile.email ? { teamsAccountEmail: profile.email } : {}),
        ...(profile.name ? { teamsAccountName: profile.name } : {}),
        teamsEnabled: true,
      });
      await get().refreshState();
      get().addToast({
        type: "success",
        message: "Microsoft Teams connected (1h session token held in memory)",
      });
      get().addToast({
        type: "info",
        message:
          "Mail & calendar scanning may still need administrator approval — if a scan is blocked, use “Grant scanning access”.",
      });
      return "pkce-popup";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isClientIdSetupError(message)) {
        get().openSettings("account");
        get().addToast({
          type: "error",
          message:
            "Microsoft sign-in needs your own Azure app client ID — Settings → Account is now open.",
        });
        return "error";
      }
      get().addToast({
        type: "error",
        message: `Microsoft sign-in failed: ${message}`,
      });
      return "error";
    }
  },

  microsoftLogout: async () => {
    try {
      await rpc("microsoft_logout");
      await get().refreshState();
      get().addToast({
        type: "info",
        message: "Microsoft account disconnected and tokens wiped",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to disconnect Microsoft: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  /**
   * Stage 2 of the Microsoft consent flow: ask for the mail + calendar
   * scopes. Many work tenants require an administrator to approve exactly
   * these permissions, so the sign-in itself stays on the low-consent scope
   * set and this is the explicit "grant scanning access" step.
   */
  microsoftGrantScanningAccess: async () => {
    try {
      const result = await rpc<string | { url: null; port: null; mode: string }>(
        "microsoft_scanning_consent_start",
      );

      if (typeof result === "string" && result !== "error") {
        get().addToast({
          type: "info",
          message: "Opening the Microsoft consent screen in your browser…",
        });
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(result);
        } catch {
          window.open(result, "_blank", "noopener");
        }
        return result;
      }

      const clientId = get().data.config.teamsClientId?.trim();
      if (!clientId) {
        throw new Error(
          "Granting mail & calendar access needs your Azure app client ID. Open Settings → Account → Browser Sign-In and paste it.",
        );
      }
      const { microsoftPkcePopupLogin, MICROSOFT_SCAN_SCOPES } =
        await import("../pwadapters/browserSources");
      const profile = await microsoftPkcePopupLogin(
        clientId,
        crypto,
        MICROSOFT_SCAN_SCOPES,
        "consent",
      );
      await get().updateConfig({
        ...(profile.email ? { teamsAccountEmail: profile.email } : {}),
        ...(profile.name ? { teamsAccountName: profile.name } : {}),
        teamsEnabled: true,
      });
      await get().refreshState();
      get().addToast({
        type: "success",
        message: "Microsoft mail & calendar access granted",
      });
      return "pkce-popup";
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Microsoft consent failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return "error";
    }
  },

  validateGeminiKey: async (key) => {
    return await rpc<{ valid: boolean; error?: string }>("validate_gemini_key", { key });
  },

  extractSchedule: async (image) => {
    const extracted = await rpc<DesktopExtractedTimetable>("extract_schedule", { image });
    // One AI call happened: refresh the counter so the usage line shows the
    // call that just ran instead of a stale number.
    void get().refreshAiQuota();
    return extracted;
  },

  practiceGenerate: async (assessmentId) => {
    return await rpc<PracticeQuizPayload>("practice_generate", { assessmentId });
  },

  checkUpdate: async () => {
    return await rpc<UpdateCheckResult>("check_update");
  },

  installUpdate: async () => {
    await rpc<void>("download_and_install_update");
  },

  exportBackupFile: async (path) => {
    // Thin web wrapper around the desktop file dialog. Tier-aware: before the
    // desktop study migration the webview's browser-side collections ARE the
    // study data (the core can never read them) and ride into the command as
    // the full override payload; after the migration the core SQLite store is
    // authoritative and ONLY the focus-minutes ledger (webview-localStorage)
    // rides along — overriding the core's own collections with the cleared
    // browser mirrors would fabricate empty study data in the backup.
    const studyPayload = await buildStudyExportOverride();
    const raw = await rpc<ExportBackupResult | string>("export_backup_file", {
      path,
      studyPayload,
    });
    const res: ExportBackupResult =
      typeof raw === "string" ? { saved: false, path: null, json: raw } : raw;
    // If browser fallback without saved file path:
    if (!res.saved && res.json && typeof window !== "undefined") {
      const blob = new Blob([res.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quizradar-backup-${getLocalDateString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    return res;
  },

  importBackupFile: async (path, jsonContent) => {
    const report = await rpc<
      ImportReport & {
        // Desktop-tier extras (tauri `import_backup_file` wrapper): the
        // backup file's study sections + focus-minutes ledger, mirrored back
        // into the webview's own stores — the core importer restored them
        // into SQLite, and the web UI reads study collections from here.
        studyStats?: unknown;
        studyImport?: {
          flashcards?: unknown;
          quiz_attempts?: unknown;
          mistake_bank?: unknown;
          study_sessions?: unknown;
          study_stats?: unknown;
        } | null;
      }
    >("import_backup_file", { path, jsonContent });

    // Desktop cross-tier restore: the PWA tier's pwaRpcHandler writes the
    // study stores itself (no `studyImport`), but the desktop command only
    // reaches SQLite. When the native store is authoritative (migration
    // stamped) the core importer ALREADY restored these sections there and
    // hydration below re-reads them — mirroring into the browser mirrors
    // would only recreate a stale copy. Pre-migration (or PWA), the mirror
    // is what keeps the UI working.
    if (report.studyImport && !isDesktopNativeStudy()) {
      const sections = report.studyImport;
      // An absent section leaves the local collection untouched (same rule
      // as the core importer); a present section REPLACES it.
      if (sections.flashcards !== undefined) {
        await idbReplaceAll("flashcards", sanitizeFlashcards(sections.flashcards));
      }
      if (sections.quiz_attempts !== undefined) {
        await idbReplaceAll("quiz_attempts", sanitizeQuizAttempts(sections.quiz_attempts));
      }
      if (sections.mistake_bank !== undefined) {
        await idbReplaceAll("mistake_bank", sanitizeMistakes(sections.mistake_bank));
      }
    }
    const stats = report.studyStats ?? report.studyImport?.study_stats;
    if (stats !== undefined && stats !== null) {
      writeStoredStudyStats(stats);
    }

    await get().refreshState();
    // Both importers write the study stores directly — re-hydrate the
    // in-memory slices or the UI keeps showing the pre-import study state
    // until the next reload.
    await hydrateStudyCollections();
    return report;
  },

  resetDatabase: async () => {
    try {
      const fresh = await rpc<GetStatePayload>("reset_database");
      // Web-side study-data wipe: the IDB reset covers the PWA tier's study
      // stores, but the desktop tier's Rust reset can never reach browser
      // storage — so the legacy localStorage keys, the local study-stats
      // ledger and the SWR cache are purged HERE, tier-agnostically. Without
      // this, a "Reset Everything" user sees pre-reset flashcards, history
      // and mistakes flash back (in-memory slices included).
      let purgeFailure: string | null = null;
      try {
        await purgeLocalStudyData();
      } catch (purgeError) {
        purgeFailure = purgeError instanceof Error ? purgeError.message : String(purgeError);
      }
      saveCachedState(fresh);
      set({
        data: fresh,
        flashcards: [],
        quizHistory: [],
        mistakeBank: [],
      });
      // The session flag suppresses the first-run wizard — a wipe must let
      // it return, or a "fresh database" never re-onboards this session.
      try {
        sessionStorage.removeItem("quizradar_onboarding_dismissed");
      } catch {
        // ignore
      }
      if (purgeFailure !== null) {
        // Honesty: the schedule database WAS reset, but claiming a clean
        // "everything wiped" while study data survived on disk would be a
        // lie. The failure is surfaced; the caller does not show a success
        // toast (resetDatabase reports false).
        get().addToast({
          type: "error",
          message: `Reset incomplete — the schedule database was wiped, but ${purgeFailure}. Retry the reset, or clear this site's data.`,
        });
        return false;
      }
      return true;
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Reset failed — your data is untouched: ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    }
  },

  openPracticeQuiz: (assessmentId) => {
    get().openModal({
      id: "practice-quiz",
      props: { assessmentId },
    });
  },

  openPomodoro: (props) => {
    get().openModal({
      id: "pomodoro",
      props: props || {},
    });
  },

  openCourseModal: (course) => {
    get().openModal({
      id: "add-course",
      props: { course },
    });
  },

  openEventModal: (event) => {
    get().openModal({
      id: "create-edit-event",
      props: { event },
    });
  },

  openSchedulePreview: (extracted) => {
    get().openModal({
      id: "schedule-preview",
      props: { extracted },
    });
  },
}));

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__QUIZRADAR_STORE__ = useAppStore;
}

// ---------------------------------------------------------------------------
// Pomodoro completion — exactly once, in the store.
//
// FocusView used to own the completion branch but early-returned on
// `if (!isRunning)` BEFORE its `timeLeft <= 0` check, while tickPomodoro
// atomically set `secondsLeft: 0, isRunning: false` — so on the Focus view
// the chime / session record / toast NEVER fired. The PomodoroModal carried
// a fully independent second timer that DID complete (its effect checked
// `isRunning && timeLeft === 0` before clearing). Both bugs disappear when
// the single completion transition lives here: `pomodoroIsRunning` flips to
// false inside the same synchronous `set`, so any number of racing ticks or
// observers can observe zero, but the side effects run exactly once.
// ---------------------------------------------------------------------------

function playPomodoroChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Release the audio hardware: each chime used to leak one AudioContext
    // (browsers cap concurrent contexts, so repeated sessions eventually
    // muted the chime). Close once the oscillator has actually finished.
    osc.onended = () => {
      void ctx.close().catch(() => {
        // Closing is best-effort; an already-closed context is fine.
      });
    };
    osc.start(now);
    osc.stop(now + 0.8);
  } catch {
    // AudioContext unavailable or blocked by autoplay policy — silent here
    // is honest: the chime is enhancement, the toast carries the signal.
  }
}

function completePomodoroSession(): void {
  const state = useAppStore.getState();
  // Consumable guard: only the tick that sees a still-running session with
  // an elapsed deadline completes it. After this `set`, every later observer
  // sees isRunning=false / endsAt=null and can never re-complete.
  if (!state.pomodoroIsRunning || state.pomodoroEndsAt === null) return;
  const mode = state.pomodoroMode;
  // Honesty: credit the actual focused time — the nominal block minus every
  // wall-clock millisecond spent paused — never the nominal block. A user
  // who paused 10 of 25 focus minutes earns 15.
  const focusedMs = Math.max(0, POMODORO_DURATIONS[mode] * 1000 - state.pomodoroPausedMsTotal);
  const minutes = Math.round(focusedMs / 60000);
  useAppStore.setState({
    pomodoroIsRunning: false,
    pomodoroEndsAt: null,
    pomodoroPausedRemainingSec: null,
    pomodoroPausedAtMs: null,
    pomodoroPausedMsTotal: 0,
    pomodoroSecondsLeft: POMODORO_DURATIONS[mode],
    pomodoroSessionId: state.pomodoroSessionId + 1,
  });
  if (mode === "pomodoro") {
    recordPomodoroSession(minutes);
  }
  playPomodoroChime();
  useAppStore.getState().addToast({
    type: "success",
    message: copy.pomodoro.sessionComplete,
  });
}

// Day-rollover watchdog initialization helper.
//
// Deliberately re-entrant: every call starts a fresh watchdog and returns a
// disposer that fully stops it (the old module-level `watchdogStarted` flag
// meant a StrictMode mount→cleanup→mount or an effect re-run permanently
// killed rollover detection — countdowns then went stale at midnight).
export function initDayRolloverWatchdog(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  return startDayRolloverWatchdog((newDate) => {
    useAppStore.getState().refreshState();
    useAppStore.getState().addToast({
      type: "info",
      message: `${copy.common.dayRolloverNotice} (${newDate})`,
      duration: 3500,
    });
  });
}

// ---------------------------------------------------------------------------
// Granular Selectors (Sprint 3: State Architecture & Render Performance)
// Prevents monolithic re-renders across views when unrelated fields change.
// ---------------------------------------------------------------------------

export const useAppView = () => useAppStore((s) => s.view);
export const useAppTheme = () => useAppStore((s) => s.theme);
export const useAppSidebarOpen = () => useAppStore((s) => s.sidebarOpen);
export const useAppSearchQuery = () => useAppStore((s) => s.searchQuery);
export const useAppToasts = () => useAppStore((s) => s.toasts);
export const useAppModals = () => useAppStore((s) => s.openModals);
export const useAppSyncStatus = () => useAppStore((s) => s.syncStatus);
export const useAppAssessments = () => useAppStore((s) => s.data.assessments);
export const useAppDashboard = () => useAppStore((s) => s.data.dashboard);
export const useAppSchedule = () => useAppStore((s) => s.data.schedule);
export const useAppConfig = () => useAppStore((s) => s.data.config);
export const useAppAuth = () => useAppStore((s) => s.data.auth);
export const useAppStudyTasks = () => useAppStore((s) => s.data.studyTasksPayload);
