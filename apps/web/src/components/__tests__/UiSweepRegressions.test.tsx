import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ModalStack } from "../ModalStack";
import { TopBar } from "../TopBar";
import { FocusView } from "../../views/FocusView";
import { useAppStore } from "../../state/store";
import { setupMockIndexedDb } from "../../test/mockIndexedDb";
import { setConfigValue } from "../../pwadapters/idbStore";
import { pwaRpcHandler } from "../../pwadapters/rpcAdapter";
import type { GetStatePayload } from "../../state/types";

describe("UI Sweep Regressions & Single-Shell Modal Invariants", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
  });

  afterEach(() => {
    teardownIdb();
    vi.restoreAllMocks();
  });

  it("renders TopBar calendar month using 1-based month indexing (10 -> October)", () => {
    useAppStore.setState({
      view: "calendar",
      currentWeekStart: "2026-10-25",
    });

    render(<TopBar />);
    expect(screen.getByTestId("topbar-calendar-controls")).toHaveTextContent("October 2026");
    expect(screen.getByTestId("topbar-calendar-controls")).not.toHaveTextContent("November 2026");
  });

  it("keeps underlying modal hidden when a child modal is stacked, and restores it on Escape", () => {
    useAppStore.setState({
      openModals: [],
      data: {
        ...useAppStore.getState().data,
        config: {
          ...useAppStore.getState().data.config,
          onboardingCompleted: true,
        },
      },
    });

    render(<ModalStack />);

    act(() => {
      // Settings left the modal stack (it is a full-screen view now), so the
      // base layer here is the account-profile modal.
      useAppStore.getState().openModal("account-profile");
      useAppStore.getState().openModal("add-course");
    });

    const stackRoot = screen.getByTestId("modal-stack-root");
    const visibleDialogs = Array.from(stackRoot.querySelectorAll('[role="dialog"]')).filter(
      (el) => !el.closest("[hidden]"),
    );

    // Exactly ONE visible dialog at any time — no stacked double windows!
    expect(visibleDialogs).toHaveLength(1);
    expect(screen.getByTestId("modal-add-course")).toBeVisible();

    // LIFO Escape pops AddCourseModal and reveals AccountProfileModal again
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useAppStore.getState().openModals).toHaveLength(1);
    expect(useAppStore.getState().openModals[0].id).toBe("account-profile");
    expect(screen.getByTestId("modal-account-profile")).toBeVisible();
  });

  it("does not fabricate auth.authenticated=true from a local user_email profile anchor", async () => {
    await setConfigValue("user_email", "student@university.edu");
    await setConfigValue("user_name", "Alex Student");

    const state = await pwaRpcHandler<GetStatePayload>("get_state");
    expect(state.config.userEmail).toBe("student@university.edu");
    expect(state.auth.authenticated).toBe(false);
    expect(state.auth.hasGmailScope).toBe(false);
  });

  it("supports end-to-end JSON backup export and import in browser PWA mode", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await pwaRpcHandler("save_schedule", {
      schedule: {
        semester: "Fall 2026",
        courses: [{ id: "CSE241", name: "Digital Logic Design", color: "#1a73e8" }],
        slots: [],
      },
    });

    const exported = await useAppStore.getState().exportBackupFile();
    expect(exported.saved).toBe(false);
    expect(typeof exported.json).toBe("string");
    expect(exported.json).toContain("CSE241");

    // Clear and re-import from JSON string
    await pwaRpcHandler("reset_database");
    const report = await useAppStore.getState().importBackupFile(undefined, exported.json ?? "");
    expect(report.coursesImported).toBe(1);
  });

  it("renders interactive FocusView timer and practice quiz switcher", () => {
    useAppStore.setState({
      view: "focus",
      data: {
        ...useAppStore.getState().data,
        assessments: [
          {
            id: "asm-1",
            courseId: "CSE241",
            courseName: "Digital Logic Design",
            title: "Quiz 2 — Karnaugh Maps",
            assessmentType: "Class Quiz",
            dateIso: "2026-10-30",
            isUpcoming: true,
            daysUntil: 1,
            urgencyLevel: "critical",
            priorityScore: 95,
            topics: ["Karnaugh Maps", "SR Latches"],
            warnings: [],
            source: "Gmail",
          },
        ],
      },
    });

    render(<FocusView />);
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByLabelText("Study Target Assessment")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Short Break/i }));
    expect(screen.getByText("05:00")).toBeInTheDocument();

    const practiceTab = screen.getByRole("tab", { name: /Practice Quiz/i });
    fireEvent.click(practiceTab);
    expect(practiceTab).toHaveAttribute("aria-selected", "true");
  });
});
