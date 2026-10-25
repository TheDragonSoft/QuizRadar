import { create } from "zustand";
import { copy } from "../copy";
import { rpc } from "./rpc";
import { loadCachedState, saveCachedState } from "./swr";
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

  // Actions
  setView: (view: View) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSearchQuery: (query: string) => void;
  toggleCourseFilter: (courseId: string) => void;
  selectAllCourses: () => void;
  toggleLayer: (layer: keyof LayerToggles) => void;

  openModal: (modal: ModalInstance | string) => void;
  closeModal: (id?: string) => void;
  closeAllModals: () => void;

  addToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => void;
  removeToast: (id: string) => void;

  loadInitialData: () => Promise<void>;
  refreshState: () => Promise<void>;
  triggerSync: () => Promise<void>;
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
