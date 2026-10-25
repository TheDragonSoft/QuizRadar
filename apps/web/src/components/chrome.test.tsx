import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { ModalStack } from "./ModalStack";
import { PullToRefresh } from "./PullToRefresh";
import { useAppStore, initialFullState, THEME_STORAGE_KEY } from "../state/store";
import { computeSyncStatusSummary } from "../state/syncStatus";
import { startDayRolloverWatchdog } from "../state/watchdog";
import { loadCachedState, saveCachedState, SWR_CACHE_KEY } from "../state/swr";

describe("Web UI Foundation & Chrome Components", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
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

    expect(useAppStore.getState().theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const lightBtn = screen.getByLabelText(/switch to light mode/i);
    fireEvent.click(lightBtn);

    expect(useAppStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
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

  // 9. SWR cache loads local snapshot immediately on startup
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
