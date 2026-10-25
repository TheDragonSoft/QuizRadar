import { create } from "zustand";
import { copy } from "../copy";
import { rpc } from "./rpc";
import { loadCachedState, saveCachedState } from "./swr";
import { applyOptimistic } from "./optimistic";
import type {
  GetStatePayload,
  LayerToggles,
  ModalInstance,
  SyncStatus,
  ThemeMode,
  ToastItem,
  View,
} from "./types";
import { getLocalDateString, startDayRolloverWatchdog } from "./watchdog";

export function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0 is Sunday
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export const THEME_STORAGE_KEY = "quizradar-theme";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.localStorage) return "light";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (saved === "light" || saved === "dark") return saved;
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
  root.classList.add("theme-transition");
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // ignore
  }
  setTimeout(() => {
    root.classList.remove("theme-transition");
  }, 200);
}

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

  // UI state
  view: View;
  theme: ThemeMode;
  searchQuery: string;
  selectedCourseIds: string[] | null; // null = all courses selected
  layers: LayerToggles;

  // Modals & toasts
  openModals: ModalInstance[];
  toasts: ToastItem[];

  // Sync state
  syncStatus: SyncStatus;
  syncProgressMessage: string | null;

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
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
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

  addToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => void;
  removeToast: (id: string) => void;

  loadInitialData: () => Promise<void>;
  refreshState: () => Promise<void>;
  triggerSync: () => Promise<void>;

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
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  data: initialFullState,
  isOffline: false,

  view: "dashboard",
  theme: getInitialTheme(),
  searchQuery: "",
  selectedCourseIds: null,
  layers: { exams: true, classes: true },

  openModals: [],
  toasts: [],

  syncStatus: "idle",
  syncProgressMessage: null,

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
    const current = new Date(get().currentWeekStart + "T00:00:00");
    current.setDate(current.getDate() + deltaWeeks * 7);
    const nextStart = current.toISOString().slice(0, 10);
    set({ currentWeekStart: nextStart });
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

  setTheme: (theme) => {
    applyThemeToDocument(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    applyThemeToDocument(next);
    set({ theme: next });
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

  addToast: (toast) => {
    const id = toast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullToast: ToastItem = {
      id,
      message: toast.message,
      type: toast.type,
      duration: toast.duration ?? 4000,
    };

    set((state) => ({
      toasts: [...state.toasts, fullToast],
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

  triggerSync: async () => {
    set({ syncStatus: "syncing", syncProgressMessage: copy.topBar.syncScanning });
    try {
      await rpc<{ success: boolean; totalNew: number; totalUpdated: number }>("run_sync");
      await get().refreshState();
      set({ syncStatus: "success", syncProgressMessage: null });
      get().addToast({
        type: "success",
        message: copy.topBar.syncSynced,
      });
      setTimeout(() => {
        if (get().syncStatus === "success") {
          set({ syncStatus: "idle" });
        }
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ syncStatus: "error", syncProgressMessage: null });
      get().addToast({
        type: "error",
        message: `${copy.topBar.syncFailed}: ${msg}`,
      });
      setTimeout(() => {
        if (get().syncStatus === "error") {
          set({ syncStatus: "idle" });
        }
      }, 4000);
    }
  },

  toggleTopic: async (assessmentId, topicIdx) => {
    const prevData = get().data;
    const addToast = get().addToast;

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

        // Global readiness & counts
        let totalCompleted = 0;
        let totalTopics = 0;
        nextData.studyTasksPayload.readinessCards.forEach((c) => {
          totalCompleted += c.completedCount;
          totalTopics += c.totalCount;
        });
        nextData.dashboard.completedTopicsCount = totalCompleted;
        nextData.dashboard.totalTopicsCount = totalTopics;
        nextData.dashboard.readinessPercent =
          totalTopics > 0 ? Math.round((totalCompleted / totalTopics) * 100) : 100;

        set({ data: nextData });
      },
      // 2. Network call
      async () => {
        return await rpc<GetStatePayload>("toggle_topic", { assessmentId, topicIdx });
      },
      // 3. Rollback
      () => {
        set({ data: prevData });
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
      // 3. Rollback
      () => {
        set({ data: prevData });
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
      // 3. Rollback
      () => {
        set({ data: prevData });
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
      const freshState = await rpc<GetStatePayload>("schedule_study_blocks", { assessmentId });
      saveCachedState(freshState);
      set({ data: freshState });
      get().addToast({
        type: "success",
        message: "Smart study preparation blocks added to your timetable",
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
      try {
        icsContent = await rpc<string>("export_ics", { assessmentId });
      } catch {
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
              `SUMMARY:${a.courseId ? `[${a.courseId}] ` : ""}${a.title}`,
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
        message: "Calendar file (.ics) downloaded successfully",
      });
    } catch (err) {
      get().addToast({
        type: "error",
        message: `Failed to export ICS: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
}));

// Day-rollover watchdog initialization helper
let watchdogStarted = false;
export function initDayRolloverWatchdog(): () => void {
  if (watchdogStarted || typeof window === "undefined") {
    return () => {};
  }
  watchdogStarted = true;
  return startDayRolloverWatchdog((newDate) => {
    useAppStore.getState().refreshState();
    useAppStore.getState().addToast({
      type: "info",
      message: `${copy.common.dayRolloverNotice} (${newDate})`,
      duration: 3500,
    });
  });
}
