import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { MobileNav } from "./components/MobileNav";
import { ModalStack } from "./components/ModalStack";
import { ToastContainer } from "./components/Toast";
import { PullToRefresh } from "./components/PullToRefresh";
import { DashboardView, TasksView, CalendarView, FocusView, HelpView } from "./views/views";
import { DevRig } from "./dev/DevRig";
import { useAppStore, applyThemeToDocument, initDayRolloverWatchdog } from "./state/store";
import { isTauriEnvironment } from "./state/rpc";
import type { View } from "./state/types";
import { registerModal, type ModalComponent } from "./components/modalRegistry";
import { AssessmentDetailModal } from "./components/AssessmentDetailModal";
import { OnboardingWizardModal } from "./components/OnboardingWizardModal";
import { SettingsModal } from "./components/SettingsModal";
import { SearchPaletteModal } from "./components/SearchPaletteModal";
import { PracticeQuizModal } from "./components/PracticeQuizModal";
import { PomodoroModal } from "./components/PomodoroModal";
import { SchedulePreviewModal } from "./components/SchedulePreviewModal";
import { AddCourseModal } from "./components/AddCourseModal";
import { CreateEditEventModal } from "./components/CreateEditEventModal";
import { AppConfirmModal } from "./components/AppConfirmModal";
import { CloudSyncModal } from "./components/CloudSyncModal";
import { ScanProgressModal } from "./components/ScanProgressModal";
import { AccountProfileModal } from "./components/AccountProfileModal";

// Register all 13 spec modal components
registerModal("assessment-detail", AssessmentDetailModal as unknown as ModalComponent);
registerModal("onboarding", OnboardingWizardModal as unknown as ModalComponent);
registerModal("settings", SettingsModal as unknown as ModalComponent);
registerModal("search", SearchPaletteModal as unknown as ModalComponent);
registerModal("practice-quiz", PracticeQuizModal as unknown as ModalComponent);
registerModal("pomodoro", PomodoroModal as unknown as ModalComponent);
registerModal("schedule-preview", SchedulePreviewModal as unknown as ModalComponent);
registerModal("add-course", AddCourseModal as unknown as ModalComponent);
registerModal("create-edit-event", CreateEditEventModal as unknown as ModalComponent);
registerModal("app-confirm", AppConfirmModal as unknown as ModalComponent);
registerModal("cloud-sync", CloudSyncModal as unknown as ModalComponent);
registerModal("scan-progress", ScanProgressModal as unknown as ModalComponent);
registerModal("account-profile", AccountProfileModal as unknown as ModalComponent);

const VIEWS: Record<View, React.ComponentType> = {
  dashboard: DashboardView,
  tasks: TasksView,
  calendar: CalendarView,
  focus: FocusView,
  help: HelpView,
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

  // Startup initialization: theme + initial SWR load + day-rollover watchdog + route check
  useEffect(() => {
    applyThemeToDocument(theme);
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
  }, [loadInitialData, theme]);

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
    openModal({ id: "onboarding", flush: true, size: "lg" });
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
        {/* Left Desktop Sidebar */}
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
                Offline mode · Rendering verified local cache
              </div>
            )}
            <div className="mx-auto max-w-6xl">
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
    </div>
  );
}
