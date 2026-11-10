import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { MobileNav } from "./components/MobileNav";
import { ModalStack } from "./components/ModalStack";
import { ToastContainer } from "./components/Toast";
import { PullToRefresh } from "./components/PullToRefresh";
import { DashboardView, TasksView, CalendarView, FocusView, HelpView } from "./views/views";
import { SettingsView } from "./views/SettingsView";
import { DevRig } from "./dev/DevRig";
import { useAppStore, applyThemeToDocument, initDayRolloverWatchdog } from "./state/store";
import { PrintScheduleDoc } from "./components/PrintScheduleDoc";
import { isTauriEnvironment } from "./state/rpc";
import { copy } from "./copy";
import type { View } from "./state/types";
import { registerModal, type ModalComponent } from "./components/modalRegistry";
import { AssessmentDetailModal } from "./components/AssessmentDetailModal";
import { OnboardingWizardModal } from "./components/OnboardingWizardModal";
import { PracticeQuizModal } from "./components/PracticeQuizModal";
import { PomodoroModal } from "./components/PomodoroModal";
import { SchedulePreviewModal } from "./components/SchedulePreviewModal";
import { AddCourseModal } from "./components/AddCourseModal";
import { CreateEditEventModal } from "./components/CreateEditEventModal";
import { CreateEditAssessmentModal } from "./components/CreateEditAssessmentModal";
import { AppConfirmModal } from "./components/AppConfirmModal";
import { CloudSyncModal } from "./components/CloudSyncModal";
import { ScanProgressModal } from "./components/ScanProgressModal";
import { AccountProfileModal } from "./components/AccountProfileModal";
import { SearchPaletteModal } from "./components/SearchPaletteModal";

// Register the spec modal components with canonical single-shell sizing & flush
// metadata. (Settings is NOT one of them anymore: it is a full-screen view —
// the modal could not hold its nine sections without cramped tabs.)
registerModal("search-palette", SearchPaletteModal as unknown as ModalComponent, {
  size: "lg",
  flush: true,
});
registerModal("assessment-detail", AssessmentDetailModal as unknown as ModalComponent, {
  size: "lg",
  flush: true,
});
registerModal("create-edit-assessment", CreateEditAssessmentModal as unknown as ModalComponent, {
  size: "md",
  flush: true,
});
registerModal("onboarding", OnboardingWizardModal as unknown as ModalComponent, {
  size: "xl",
  flush: true,
});
registerModal("practice-quiz", PracticeQuizModal as unknown as ModalComponent, { size: "lg" });
registerModal("pomodoro", PomodoroModal as unknown as ModalComponent, { size: "sm" });
registerModal("schedule-preview", SchedulePreviewModal as unknown as ModalComponent, {
  size: "xl",
});
registerModal("add-course", AddCourseModal as unknown as ModalComponent, {
  size: "md",
  flush: true,
});
registerModal("create-edit-event", CreateEditEventModal as unknown as ModalComponent, {
  size: "md",
  flush: true,
});
registerModal("app-confirm", AppConfirmModal as unknown as ModalComponent, { size: "sm" });
registerModal("cloud-sync", CloudSyncModal as unknown as ModalComponent, { size: "md" });
registerModal("scan-progress", ScanProgressModal as unknown as ModalComponent, { size: "sm" });
registerModal("account-profile", AccountProfileModal as unknown as ModalComponent, { size: "sm" });

const VIEWS: Record<View, React.ComponentType> = {
  dashboard: DashboardView,
  tasks: TasksView,
  calendar: CalendarView,
  focus: FocusView,
  help: HelpView,
  settings: SettingsView,
};

export default function App() {
  const currentView = useAppStore((s) => s.view);
  const theme = useAppStore((s) => s.theme);
  const loadInitialData = useAppStore((s) => s.loadInitialData);
  const isOffline = useAppStore((s) => s.isOffline);
  const hasLoaded = useAppStore((s) => s.hasLoaded);
  const config = useAppStore((s) => s.data.config);
  const openModal = useAppStore((s) => s.openModal);
  const openModals = useAppStore((s) => s.openModals);

  const [isDevRigActive, setIsDevRigActive] = useState(() => {
    if (typeof window === "undefined") return false;
    const url = new URL(window.location.href);
    return url.pathname === "/dev" || url.searchParams.get("dev") === "true";
  });

  // Startup initialization: initial load + day-rollover watchdog + route check.
  // Mount-only ON PURPOSE: keying this on `theme` re-ran the whole effect on
  // every theme toggle — killing the watchdog (its init helper was one-shot)
  // and stomping fresh in-memory data with the possibly-stale SWR cache.
  // Theme application lives in its own effect below; `setTheme` already
  // applies it immediately on toggle.
  useEffect(() => {
    loadInitialData();
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.pathname === "/help" || url.hash === "#help") {
        useAppStore.getState().setView("help");
      }
    }
    const stopWatchdog = initDayRolloverWatchdog();
    return () => {
      stopWatchdog();
    };
  }, [loadInitialData]);

  // Theme application whenever the mode changes (also covers first mount).
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Single-letter navigation shortcuts (D/T/C/F/?/S) — the Help cheatsheet
  // promises these, so they must actually exist. Ignored while typing, with
  // modifier keys held, while a modal owns the surface, or while the inline
  // search dropdown is open (it floats above the view; D/C under it would
  // switch views and strand a stale panel).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target =
        (e.target as HTMLElement | null) || (document.activeElement as HTMLElement | null);
      const isInput = (el: HTMLElement | null) => {
        let cur: HTMLElement | null = el;
        while (cur) {
          const tag = cur.tagName?.toUpperCase();
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
          if (
            cur.isContentEditable ||
            cur.contentEditable === "true" ||
            cur.getAttribute?.("contenteditable") === "true"
          )
            return true;
          cur = cur.parentElement;
        }
        return false;
      };
      if (isInput(target) || isInput(document.activeElement as HTMLElement | null)) {
        return;
      }

      // Cmd+K / Ctrl+K opens floating search palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const { openModals, openModal } = useAppStore.getState();
        if (openModals.some((m) => m.id === "search-palette")) return;
        openModal({ id: "search-palette" });
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // / opens search palette
      if (e.key === "/") {
        e.preventDefault();
        const { openModals, openModal } = useAppStore.getState();
        if (openModals.some((m) => m.id === "search-palette")) return;
        openModal({ id: "search-palette" });
        return;
      }

      // Space toggles Pomodoro timer app-wide (strictly ignored if typing in inputs)
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        useAppStore.getState().togglePomodoro();
        return;
      }

      if (document.getElementById("topbar-search-results")) return;
      const { openModals, setView } = useAppStore.getState();
      if (openModals.length > 0) return;
      switch (e.key) {
        case "1":
          setView("dashboard");
          break;
        case "2":
          setView("tasks");
          break;
        case "3":
          setView("calendar");
          break;
        case "4":
          setView("focus");
          break;
        case "t":
        case "T":
          useAppStore.getState().jumpToToday();
          break;
        case "n":
        case "N":
          useAppStore.getState().openEventModal();
          break;
        case "d":
        case "D":
          setView("dashboard");
          break;
        case "c":
        case "C":
          setView("calendar");
          break;
        case "f":
        case "F":
          setView("focus");
          break;
        case "?":
          setView("help");
          break;
        case "s":
        case "S":
          setView("settings");
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // First-run onboarding check — waits for the first real state load so a
  // returning user is never shown the wizard. It never stacks on top of
  // another modal (e.g. the scan overlay opened from the top bar first).
  // The X-dismissed flag is written in the SAME effect, before the reopen
  // check: two separate effects raced, and the wizard re-opened on Close.
  const wasOnboardingOpen = useRef(false);
  useEffect(() => {
    const has = openModals.some((m) => m.id === "onboarding");
    if (wasOnboardingOpen.current && !has && typeof window !== "undefined") {
      sessionStorage.setItem("quizradar_onboarding_dismissed", "1");
    }
    wasOnboardingOpen.current = has;

    if (!hasLoaded) return;
    if (config.onboardingCompleted) return;
    if (openModals.length > 0) return;
    if (typeof window !== "undefined") {
      const dismissed = sessionStorage.getItem("quizradar_onboarding_dismissed");
      if (dismissed) return;
    }
    openModal({ id: "onboarding", flush: true, size: "xl" });
  }, [hasLoaded, config.onboardingCompleted, openModal, openModals]);

  // Desktop auth bridge: the OAuth round trip finishes in the browser, so the
  // shell emits "auth-changed" when the token lands. Without this listener the
  // app kept showing "Sign in" even though the account was connected.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const subscribe = async () => {
      if (!isTauriEnvironment()) return;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen<string>("auth-changed", () => {
          void useAppStore.getState().refreshState();
          useAppStore.getState().addToast({
            type: "success",
            message: "Account connected — signed in.",
          });
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
      } catch {
        // The event bridge is a nicety: a failure here must never break the app.
      }
    };

    void subscribe();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (isDevRigActive) {
    return <DevRig onExit={() => setIsDevRigActive(false)} />;
  }

  const ActiveViewComponent = VIEWS[currentView] || DashboardView;

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--page)] text-[var(--text)]"
    >
      {/* Top Bar */}
      <TopBar />

      {/* Main Container: Sidebar + View Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Desktop Sidebar — always mounted so the width collapse animates;
            the rail hides itself below lg and collapses via sidebarOpen. */}
        <Sidebar />

        {/* View Content Area wrapped in touch PullToRefresh */}
        <PullToRefresh>
          <main
            data-testid="main-content-viewport"
            className="h-full overflow-y-auto px-4 py-6 pb-24 sm:px-6 lg:pb-8"
          >
            {isOffline && (
              <div
                role="status"
                data-testid="offline-banner"
                className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400"
              >
                {copy.common.offlineNotice}
              </div>
            )}
            {/* Full-bleed content: the views own their width, the main
                padding is the only margin (the old max-w-6xl cap stranded
                half a 1920px window in empty background). */}
            <div key={currentView} className="view-transition w-full">
              <ActiveViewComponent />
            </div>
          </main>
        </PullToRefresh>
      </div>

      {/* Mobile M3 Bottom Navigation */}
      <MobileNav />

      {/* Declarative Modals & Toast Containers */}
      <ModalStack />
      <ToastContainer />

      {/* Printable Timetable & Exam Cram Document (Vector clean print only) */}
      <PrintScheduleDoc />
    </div>
  );
}
