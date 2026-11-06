import { create } from "zustand";
import { copy } from "../copy";
import { getModalMeta } from "../components/modalRegistry";
import { rpc } from "./rpc";
import { loadCachedState, saveCachedState } from "./swr";
import { applyOptimistic } from "./optimistic";
import type {
  AiQuotaUsage,
  ConfigUpdate,
  Course,
  CustomCalendarEvent,
  DesktopExtractedTimetable,
  ExportBackupResult,
  FeedConfig,
  GetStatePayload,
  ImportReport,
  LayerToggles,
  ModalInstance,
  PracticeQuizPayload,
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
import { toRustEvent, toRustSchedule, toRustSlots } from "./ipcShape";

/**
 * True when an OAuth failure is a *setup* problem (no client id configured,
 * or an unusable one) rather than a provider/consent failure. Those are
 * fixed in Settings → Account, so the UI jumps straight there instead of
 * dumping a wall of text into a toast.
 */
function isClientIdSetupError(message: string): boolean {
  return (
    /client id/i.test(message) &&
    /(needs your own|not configured|not usable|missing)/i.test(message)
  );
}

/**
 * Calendar-date arithmetic on plain `YYYY-MM-DD` strings. Dates are anchored
 * at UTC noon internally so the result never shifts with the device timezone
 * (a local-midnight `toISOString()` round-trip moves the day for every user
 * east or west of UTC).
 */
export function addDaysToIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day + days));
  return anchor.toISOString().slice(0, 10);
}

export function getWeekStart(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  const weekday = anchor.getUTCDay(); // 0 is Sunday
  return addDaysToIsoDate(dateStr, -weekday);
}

export const THEME_STORAGE_KEY = "quizradar-theme";
export const SIDEBAR_STORAGE_KEY = "quizradar-sidebar-open";

function getInitialSidebarOpen(): boolean {
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

function getInitialTheme(): ThemeMode {
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
  const normalizedAttr =
    theme === "dark" ? "obsidian" : theme === "light" ? "solar" : theme;

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

/** Auto-idle timer for the sync outcome banner — cleared at every new scan. */
let syncIdleTimer: ReturnType<typeof setTimeout> | null = null;

export const initialFullState: GetStatePayload = {
  config: {
    autoSyncGcal: false,
    syncWeeklyClassesToGcal: false,
    geminiEnabled: false,
    onboardingCompleted: false,
    teamsEnabled: false,
    teamsClientId: null,
    teamsAccountName: null,
    teamsAccountEmail: null,
    moodleEnabled: false,
    moodleUrl: null,
    moodleIcalUrl: null,
    classroomEnabled: false,
    dismissConflictBanner: false,
    syncedGcalMap: {},
    feeds: [],
    customEvents: [],
    lastGmailSync: null,
    lastGcalSync: null,
    lastBackupPush: null,
    userEmail: null,
    userName: null,
    userPicture: null,
  },
  auth: {
    authenticated: false,
    email: null,
    name: null,
    picture: null,
    hasGmailScope: false,
    hasCalendarScope: false,
    hasTeamsAuth: false,
  },
  schedule: {
    semester: null,
    courses: [],
    slots: [],
  },
  assessments: [],
  dashboard: {
    referenceDate: getLocalDateString(),
    nextUp: null,
    upcomingThisWeek: [],
    allUpcoming: [],
    examTypeCounts: {},
    studyRecommendations: [],
    totalTopicsCount: 0,
    completedTopicsCount: 0,
    readinessPercent: 100,
    conflictAlerts: [],
    sourcesCount: {},
  },
  studyTasksPayload: {
    days: [],
    readinessCards: [],
    totalTasks: 0,
    pendingTasks: 0,
    completedTasks: 0,
    totalHours: null,
    aiGenerated: false,
  },
};

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
  exportIcs: (assessmentId?: string) => Promise<void>;

  updateConfig: (update: ConfigUpdate) => Promise<void>;
  upsertCourse: (course: Course, slots?: ScheduleSlot[]) => Promise<void>;
  deleteCourse: (code: string) => Promise<void>;
  saveSchedule: (schedule: ScheduleData) => Promise<void>;
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
    const next: ThemeMode = isDark ? "light" : "dark";
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
    const fullToast: ToastItem = {
      id,
      message: toast.message,
      type: toast.type,
      duration: toast.duration ?? 4000,
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
    let intendedCompleted = false;

    await applyOptimistic(
      // 1. Synchronous optimistic update
      () => {
        const nextData = JSON.parse(JSON.stringify(prevData)) as GetStatePayload;
        let toggledDone = false;

        // In study recommendations
        const rec = nextData.dashboard.studyRecommendations.find(
          (r) => r.assessmentId === assessmentId,
        );
        if (rec) {
          const item = rec.topics.find((t) => t.topicIndex === topicIdx);
          if (item) {
            item.completed = !item.completed;
            toggledDone = item.completed;
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
        intendedCompleted = toggledDone;
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
        icsContent = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//QuizRadar//v5//EN",
          ...assessments.map((a) =>
            [
              "BEGIN:VEVENT",
              `UID:quizradar-${a.id}@quizradar.local`,
              `SUMMARY:${a.courseName || a.courseId ? `${a.courseName || a.courseId}: ` : ""}${a.title}`,
              a.dateIso ? `DTSTART;VALUE=DATE:${a.dateIso.replace(/-/g, "")}` : "",
              "END:VEVENT",
            ]
              .filter(Boolean)
              .join("\r\n"),
          ),
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
        message: string;
      }>("run_gcal_sync");
      await get().refreshState();
      get().addToast({
        type: "success",
        message: res.message || "Google Calendar sync completed",
      });
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
    const raw = await rpc<ExportBackupResult | string>("export_backup_file", { path });
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
    const report = await rpc<ImportReport>("import_backup_file", { path, jsonContent });
    await get().refreshState();
    return report;
  },

  resetDatabase: async () => {
    try {
      const fresh = await rpc<GetStatePayload>("reset_database");
      saveCachedState(fresh);
      set({ data: fresh });
      // The session flag suppresses the first-run wizard — a wipe must let
      // it return, or a "fresh database" never re-onboards this session.
      try {
        sessionStorage.removeItem("quizradar_onboarding_dismissed");
      } catch {
        // ignore
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
