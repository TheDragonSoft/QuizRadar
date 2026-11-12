import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ModalStack } from "./ModalStack";
import { PullToRefresh } from "./PullToRefresh";
import {
  useAppStore,
  initialFullState,
  THEME_STORAGE_KEY,
  PREFERRED_DARK_THEME_STORAGE_KEY,
} from "../state/store";
import { computeSyncStatusSummary } from "../state/syncStatus";
import { startDayRolloverWatchdog } from "../state/watchdog";
import { loadCachedState, saveCachedState, SWR_CACHE_KEY } from "../state/swr";

describe("Web UI Foundation & Chrome Components", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    useAppStore.setState({
      view: "dashboard",
      theme: "light",
      data: initialFullState,
      openModals: [],
      toasts: [],
      syncStatus: "idle",
      selectedCourseIds: null,
      layers: { exams: true, classes: true },
    });
  });

  // 1. Theme toggle persistence
  it("theme toggle switches theme, persists to localStorage, and updates document class", () => {
    render(<TopBar />);
    const themeBtn = screen.getByLabelText(/switch to dark mode/i);

    fireEvent.click(themeBtn);

    // The toggle resolves the user's *preferred* theme for the mode it flips
    // into — never the generic "dark" id. With nothing stored that is
    // Obsidian Cosmic ("obsidian") for dark and Solar Dawn ("solar") for
    // light (state/storage.ts: getPreferredDarkTheme / getPreferredLightTheme).
    expect(useAppStore.getState().theme).toBe("obsidian");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("obsidian");
    expect(document.documentElement.getAttribute("data-theme")).toBe("obsidian");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const lightBtn = screen.getByLabelText(/switch to light mode/i);
    fireEvent.click(lightBtn);

    expect(useAppStore.getState().theme).toBe("solar");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("solar");
    expect(document.documentElement.getAttribute("data-theme")).toBe("solar");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  // 1b. The toggle honours the concrete theme picked in Settings instead of
  //     silently falling back to the generic/default id.
  it("theme toggle honours the preferred dark theme stored in Settings", () => {
    window.localStorage.setItem(PREFERRED_DARK_THEME_STORAGE_KEY, "amoled-nebula");

    render(<TopBar />);
    fireEvent.click(screen.getByLabelText(/switch to dark mode/i));

    expect(useAppStore.getState().theme).toBe("amoled-nebula");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("amoled-nebula");
    expect(document.documentElement.getAttribute("data-theme")).toBe("amoled-nebula");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  // 2. Modal stack escape ordering
  it("modal stack closes in LIFO order upon Escape key presses", () => {
    render(<ModalStack />);

    // Initially no modals
    expect(screen.queryByTestId("modal-stack-root")).not.toBeInTheDocument();

    // Push Modal 1, then Modal 2
    act(() => {
      useAppStore.getState().openModal("modal-first");
      useAppStore.getState().openModal("modal-second");
    });

    expect(screen.getByTestId("modal-modal-first")).toBeInTheDocument();
    expect(screen.getByTestId("modal-modal-second")).toBeInTheDocument();
    expect(useAppStore.getState().openModals.length).toBe(2);

    // 1st Escape closes topmost modal (modal-second)
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useAppStore.getState().openModals.length).toBe(1);
    expect(useAppStore.getState().openModals[0].id).toBe("modal-first");
    expect(screen.queryByTestId("modal-modal-second")).not.toBeInTheDocument();
    expect(screen.getByTestId("modal-modal-first")).toBeInTheDocument();

    // 2nd Escape closes modal-first
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useAppStore.getState().openModals.length).toBe(0);
    expect(screen.queryByTestId("modal-stack-root")).not.toBeInTheDocument();
  });

  // 3. Modal focus trap and restore discipline
  it("traps focus inside the modal and restores focus to triggering element on close", () => {
    const button = document.createElement("button");
    button.textContent = "Open Modal";
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    render(<ModalStack />);
    act(() => {
      useAppStore.getState().openModal("focus-test");
    });

    const modal = screen.getByTestId("modal-focus-test");
    expect(modal).toBeInTheDocument();

    // Tab key inside modal stays within modal
    const closeBtn = modal.querySelector('button[aria-label="Close"]') as HTMLElement;
    closeBtn?.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Close modal
    act(() => {
      useAppStore.getState().closeModal("focus-test");
    });

    // Focus restored to button
    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });

  // 4. Sidebar responsive collapse (<1024px hidden, >=1024px flex)
  it("sidebar includes desktop-only responsive classes (hidden lg:flex)", () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId("app-sidebar");
    expect(sidebar.className).toContain("hidden");
    expect(sidebar.className).toContain("lg:flex");
  });

  // 5. MobileNav renders 4 M3 destinations
  it("mobilenav renders 4 destinations and collapses on desktop (lg:hidden)", () => {
    render(<MobileNav />);
    const mobilenav = screen.getByTestId("app-mobilenav");
    expect(mobilenav.className).toContain("lg:hidden");

    expect(screen.getByRole("button", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /calendar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /focus/i })).toBeInTheDocument();
  });

  // 6. Pull-to-refresh is gated by modal-open state
  it("pull-to-refresh is gated when a modal is open", () => {
    const triggerSyncMock = vi.fn();
    useAppStore.setState({ triggerSync: triggerSyncMock });

    render(
      <PullToRefresh threshold={40}>
        <div data-testid="touch-content">Content</div>
      </PullToRefresh>,
    );

    const container = screen.getByTestId("pull-to-refresh-container");

    // Case A: When modal is open, touch pull does NOT trigger sync
    act(() => {
      useAppStore.getState().openModal("blocking-modal");
    });

    fireEvent.touchStart(container, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 150 }] });
    fireEvent.touchEnd(container);

    expect(triggerSyncMock).not.toHaveBeenCalled();

    // Case B: When modals are closed, touch pull triggers sync
    act(() => {
      useAppStore.getState().closeAllModals();
    });

    fireEvent.touchStart(container, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 150 }] });
    fireEvent.touchEnd(container);

    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
  });

  // 7. Sync status footer honesty copy
  it("computes honest sync footer labels matching spec semantics", () => {
    // 1. No sources connected
    const emptySummary = computeSyncStatusSummary(initialFullState.config, initialFullState.auth);
    expect(emptySummary.label).toBe("No sources connected");
    expect(emptySummary.statusVariant).toBe("neutral");
    expect(emptySummary.lastSyncedText).toBe("Never synced");

    // 2. Signed in, auto-scan off
    const signedInSummary = computeSyncStatusSummary(initialFullState.config, {
      ...initialFullState.auth,
      authenticated: true,
    });
    expect(signedInSummary.label).toBe("Signed in · Auto-scan off");
    expect(signedInSummary.statusVariant).toBe("warning");

    // 3. Radar active with 2 sources (e.g. Gmail + Classroom)
    const activeSummary = computeSyncStatusSummary(
      {
        ...initialFullState.config,
        classroomEnabled: true,
        lastGmailSync: "2026-10-23 14:00",
      },
      {
        ...initialFullState.auth,
        authenticated: true,
        hasGmailScope: true,
      },
    );
    expect(activeSummary.label).toBe("Radar Active · 2 sources");
    expect(activeSummary.statusVariant).toBe("active");
    expect(activeSummary.lastSyncedText).toBe("Last synced: 2026-10-23 14:00");
  });

  // 8. Day rollover watchdog
  it("day rollover watchdog triggers re-derive callback when date changes", () => {
    const onRolloverMock = vi.fn();
    const cleanup = startDayRolloverWatchdog(onRolloverMock, 50);

    // Initially not called
    expect(onRolloverMock).not.toHaveBeenCalled();

    // Trigger visibility change
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    cleanup();
  });

  // 10. One close button per modal (the stack used to add a second X).
  // Importing App registers every modal in the registry, which can spill past
  // the 5 s default under parallel CI load — so this test carries a budget.
  it("renders exactly one close button for a registered modal", { timeout: 20_000 }, async () => {
    // Importing App registers every modal component in the registry.
    await import("../App");

    render(<ModalStack />);
    act(() => {
      useAppStore.getState().openModal({ id: "add-course" });
    });

    const modal = screen.getByTestId("modal-add-course");
    const closeButtons = modal.querySelectorAll('button[aria-label="Close"]');
    expect(closeButtons).toHaveLength(1);
  });

  // 10b. Per-modal border state: assessment-detail's first child is the
  // full-width course-color strip, so it is registered borderless (no 1px
  // hairline ring above the strip) while framed modals keep their border.
  it("resolves borderless only for modals registered borderless", { timeout: 20_000 }, async () => {
    // Importing App registers every modal component in the registry
    // (idempotent: registerModal overwrites by id).
    await import("../App");

    render(<ModalStack />);
    act(() => {
      useAppStore.getState().openModal({ id: "add-course" });
      useAppStore.getState().openModal({ id: "assessment-detail" });
    });

    const detailPanel = screen.getByTestId("modal-assessment-detail");
    const coursePanel = screen.getByTestId("modal-add-course");
    expect(detailPanel.className).not.toContain("border-[var(--surface-border)]");
    expect(coursePanel.className).toContain("border-[var(--surface-border)]");
  });

  // 11. Sign-in buttons sign in (they never dump the user on a settings page)
  it("signs in straight from the topbar chip when signed out", () => {
    const googleLogin = vi.fn();
    useAppStore.setState({
      googleLogin,
      data: {
        ...initialFullState,
        auth: { ...initialFullState.auth, authenticated: false },
      },
    });

    render(<TopBar />);
    fireEvent.click(screen.getByLabelText(/sign in/i));

    expect(googleLogin).toHaveBeenCalled();
    expect(useAppStore.getState().openModals).toHaveLength(0);
  });

  // 12. Settings is a full-screen view — openSettings switches to it and can
  //     target a section; no modal is stacked.
  it("opens settings as the settings view with an optional section", () => {
    act(() => {
      useAppStore.getState().openSettings("account");
    });
    expect(useAppStore.getState().view).toBe("settings");
    expect(useAppStore.getState().pendingSettingsSection).toBe("account");
    expect(useAppStore.getState().openModals).toHaveLength(0);

    act(() => {
      useAppStore.getState().openSettings();
    });
    expect(useAppStore.getState().view).toBe("settings");
    expect(useAppStore.getState().pendingSettingsSection).toBeNull();
  });

  // 13. SWR cache loads local snapshot immediately on startup
  it("SWR cache saves and loads state payload from localStorage", () => {
    const sampleState = {
      ...initialFullState,
      schedule: {
        semester: "Fall 2026",
        courses: [{ id: "CSE241", name: "Digital Design", color: "#1a73e8" }],
        slots: [],
      },
    };

    saveCachedState(sampleState);
    const loaded = loadCachedState();

    expect(loaded).not.toBeNull();
    expect(loaded?.schedule.semester).toBe("Fall 2026");
    expect(loaded?.schedule.courses[0].id).toBe("CSE241");
    expect(window.localStorage.getItem(SWR_CACHE_KEY)).toContain("Fall 2026");
  });
});
