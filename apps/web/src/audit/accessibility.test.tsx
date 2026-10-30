/**
 * Structural accessibility assertions for the QuizRadar web shell.
 *
 * `axe-core` is deliberately NOT a dependency (no network changes to
 * package.json), so these are structural checks instead:
 *
 *   1. every interactive control in the chrome has a non-empty accessible name,
 *   2. icon-only buttons carry `aria-label` or `title`,
 *   3. every form control is labelled,
 *   4. the modal stack exposes a proper modal dialog and moves focus into it,
 *   5. rendered views do not skip heading levels.
 *
 * Every user-facing string this file asserts on comes from the `copy` module
 * (`apps/web/src/copy.ts`) — the single source of truth.
 */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { ModalStack } from "../components/ModalStack";
import { AppConfirmModal } from "../components/AppConfirmModal";
import { registerModal, type ModalComponent } from "../components/modalRegistry";
import { useAppStore, initialFullState } from "../state/store";
import { copy } from "../copy";
import type { GetStatePayload } from "../state/types";

/**
 * A realistic, local fixture. It is deliberately NOT imported from another
 * test file — each test owns its own data shape.
 */
const fixtureState: GetStatePayload = {
  ...initialFullState,
  schedule: {
    semester: "Fall 2026",
    courses: [
      { id: "CS2410", name: "Digital Systems", color: "#1a73e8" },
      { id: "ST2201", name: "Applied Statistics", color: "#0f9d58" },
    ],
    slots: [
      {
        id: "slot-1",
        day: "Monday",
        dayIndex: 1,
        courseId: "CS2410",
        courseName: "Digital Systems",
        type: "Lecture",
        room: "N4-102",
        startTime: "09:00",
        endTime: "10:30",
        displayTime: "09:00 - 10:30",
      },
    ],
  },
  assessments: [
    {
      id: "a-cs2410-quiz",
      courseId: "CS2410",
      courseName: "Digital Systems",
      title: "Quiz 1: Boolean Algebra",
      assessmentType: "Class Quiz",
      dateIso: "2026-10-30",
      startTime: "09:00",
      endTime: "09:45",
      room: "N4-102",
      isUpcoming: true,
      daysUntil: 1,
      urgencyLevel: "critical",
      priorityScore: 88,
      topics: ["Boolean Algebra", "Karnaugh Maps"],
      warnings: ["Bring a calculator"],
      source: "GMAIL",
      gcalSynced: false,
      achievedScore: null,
      maxScore: 20,
      weightagePercent: 10,
    },
  ],
  dashboard: {
    referenceDate: "2026-10-29",
    nextUp: null,
    upcomingThisWeek: [],
    allUpcoming: [],
    examTypeCounts: { "Class Quiz": 1 },
    studyRecommendations: [
      {
        assessmentId: "a-cs2410-quiz",
        courseId: "CS2410",
        courseName: "Digital Systems",
        title: "Quiz 1: Boolean Algebra",
        assessmentType: "Class Quiz",
        daysUntil: 1,
        urgencyLevel: "critical",
        priorityScore: 88,
        whyStudyNow: "Critical quiz tomorrow; high weightage",
        topics: [
          {
            topicIndex: 0,
            title: "Boolean Algebra",
            completed: false,
            key: "a-cs2410-quiz::0",
          },
          {
            topicIndex: 1,
            title: "Karnaugh Maps",
            completed: false,
            key: "a-cs2410-quiz::1",
          },
        ],
      },
    ],
    totalTopicsCount: 2,
    completedTopicsCount: 0,
    readinessPercent: 0,
    conflictAlerts: [],
    sourcesCount: { GMAIL: 1 },
  },
  studyTasksPayload: {
    days: [
      {
        dayOffset: 0,
        date: "2026-10-29",
        displayDay: "Today",
        isToday: true,
        totalEstimatedHours: 2,
        tasks: [
          {
            id: "task-1",
            key: "a-cs2410-quiz::0",
            assessmentId: "a-cs2410-quiz",
            courseId: "CS2410",
            title: "Quiz 1: Boolean Algebra",
            topicTitle: "Boolean Algebra",
            topicIndex: 0,
            dayOffset: 0,
            estimatedHours: 2,
            priorityRank: 1,
            completed: false,
            reasoning: "Prep day 1 of 2",
          },
        ],
      },
    ],
    readinessCards: [
      {
        assessmentId: "a-cs2410-quiz",
        courseId: "CS2410",
        courseName: "Digital Systems",
        title: "Quiz 1: Boolean Algebra",
        assessmentType: "Class Quiz",
        dateIso: "2026-10-30",
        daysUntil: 1,
        readinessPercent: 0,
        completedCount: 0,
        totalCount: 2,
        priorityScore: 88,
        recommendedFocus: "Review Boolean identities",
      },
    ],
    totalTasks: 1,
    pendingTasks: 1,
    completedTasks: 0,
    totalHours: 2,
    aiGenerated: false,
  },
};

// The confirm dialog is registered directly (instead of importing App.tsx) so
// this test does not depend on the application shell.
registerModal("app-confirm", AppConfirmModal as unknown as ModalComponent);

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The accessible name of a control, using the sources the product accepts:
 * text content, `aria-label`, `aria-labelledby`, an associated `<label>` or
 * `title`.
 */
function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy && labelledBy.trim()) {
    const referenced = labelledBy
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (referenced) return referenced;
  }

  const imageAlt = element.querySelector("img[alt]")?.getAttribute("alt")?.trim();
  if (imageAlt) return imageAlt;

  const labels = (element as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const labelText = Array.from(labels)
      .map((label) => textOf(label))
      .filter(Boolean)
      .join(" ");
    if (labelText) return labelText;
  }

  const wrappingLabel = element.closest("label");
  if (wrappingLabel) {
    const wrappingText = textOf(wrappingLabel);
    if (wrappingText) return wrappingText;
  }

  const title = element.getAttribute("title");
  if (title && title.trim()) return title.trim();

  return textOf(element);
}

/** A human-readable description of a control, used in failure messages. */
function describeControl(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const type = element.getAttribute("type");
  const id = element.getAttribute("data-testid");
  const text = textOf(element).slice(0, 40);
  return [
    `<${tag}${type ? ` type="${type}"` : ""}>`,
    id ? ` [data-testid="${id}"]` : "",
    text ? ` text="${text}"` : "",
  ].join("");
}

/** The name of a form control from a label / aria-label / aria-labelledby only. */
function formControlName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy && labelledBy.trim()) return labelledBy.trim();

  const labels = (element as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    const labelText = Array.from(labels)
      .map((label) => textOf(label))
      .filter(Boolean)
      .join(" ");
    if (labelText) return labelText;
  }

  const wrappingLabel = element.closest("label");
  if (wrappingLabel) {
    const wrappingText = textOf(wrappingLabel);
    if (wrappingText) return wrappingText;
  }

  return "";
}

/**
 * The accessible name of a dialog. `role="dialog"` is NOT named from its
 * content, so only `aria-label` / `aria-labelledby` count here.
 */
function dialogAccessibleName(dialog: Element): string {
  const ariaLabel = dialog.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = dialog.getAttribute("aria-labelledby");
  if (labelledBy && labelledBy.trim()) {
    const referenced = labelledBy
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (referenced) return referenced;
  }

  return "";
}

function describeDialog(dialog: Element): string {
  const testId = dialog.getAttribute("data-testid");
  const labelledBy = dialog.getAttribute("aria-labelledby");
  return [
    '<div role="dialog" aria-modal="true"',
    testId ? ` data-testid="${testId}"` : "",
    labelledBy ? ` aria-labelledby="${labelledBy}"` : " (no aria-label, no aria-labelledby)",
    ">",
  ].join("");
}

function headingsOf(container: HTMLElement): Array<{ level: number; text: string }> {
  return Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: textOf(heading),
  }));
}

/** Heading levels that jump by more than one (h2 -> h4 skips h3). */
function headingSkips(headings: Array<{ level: number; text: string }>): string[] {
  const skips: string[] = [];
  for (let index = 1; index < headings.length; index += 1) {
    const previous = headings[index - 1];
    const current = headings[index];
    if (current.level > previous.level + 1) {
      skips.push(
        `h${previous.level} ("${previous.text}") -> h${current.level} ("${current.text}")`,
      );
    }
  }
  return skips;
}

describe("web shell accessibility (structural assertions)", () => {
  beforeEach(() => {
    useAppStore.setState({
      data: JSON.parse(JSON.stringify(fixtureState)) as GetStatePayload,
      view: "dashboard",
      theme: "light",
      openModals: [],
      toasts: [],
      syncStatus: "idle",
      selectedCourseIds: null,
      layers: { exams: true, classes: true },
      activeSourceFilter: "ALL",
      activeTypeFilter: "ALL",
      activeCourseFilterTasks: "ALL",
      activeModalAssessmentId: null,
      checkUpdate: vi.fn(async () => ({ available: false, currentVersion: "5.0.0" })),
    });
  });

  it("gives every interactive control in the chrome an accessible name", () => {
    render(
      <>
        <TopBar />
        <Sidebar />
        <ModalStack />
      </>,
    );

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("button, input, select, textarea, [role='button']"),
    );
    expect(controls.length).toBeGreaterThan(5);

    const unnamed = controls
      .filter((control) => accessibleName(control).trim() === "")
      .map((control) => describeControl(control));

    expect(unnamed).toEqual([]);
  });

  it("gives every icon-only button an aria-label or a title", () => {
    render(
      <>
        <TopBar />
        <Sidebar />
        <ModalStack />
      </>,
    );

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const iconOnlyButtons = Array.from(
      document.querySelectorAll<HTMLElement>("button, [role='button']"),
    ).filter((button) => {
      const hasText = textOf(button).length > 0;
      const hasImageAlt = Boolean(button.querySelector("img[alt]"));
      return !hasText && !hasImageAlt;
    });

    // The sweep must actually find the icon-only controls it is meant to check.
    expect(iconOnlyButtons.length).toBeGreaterThan(0);

    const unlabelled = iconOnlyButtons
      .filter(
        (button) =>
          !button.getAttribute("aria-label")?.trim() && !button.getAttribute("title")?.trim(),
      )
      .map((button) => describeControl(button));

    expect(unlabelled).toEqual([]);
  });

  it("labels every form input and select", () => {
    render(
      <>
        <TopBar />
        <Sidebar />
        <ModalStack />
      </>,
    );

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const formControls = Array.from(
      document.querySelectorAll<HTMLElement>("input, select, textarea"),
    );
    // The sidebar ships course + layer filters; the sweep must find them.
    expect(formControls.length).toBeGreaterThan(0);

    const unlabelled = formControls
      .filter((control) => formControlName(control).trim() === "")
      .map((control) => describeControl(control));

    expect(unlabelled).toEqual([]);
  });

  it("exposes the open modal as a modal dialog", () => {
    render(<ModalStack />);

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const stackRoot = screen.getByTestId("modal-stack-root");
    const modalDialogs = Array.from(
      stackRoot.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']"),
    );
    expect(modalDialogs.length).toBeGreaterThan(0);
  });

  it("gives every modal dialog an accessible name", () => {
    render(<ModalStack />);

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const modalDialogs = Array.from(
      document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']"),
    );
    expect(modalDialogs.length).toBeGreaterThan(0);

    const unnamed = modalDialogs
      .filter((dialog) => dialogAccessibleName(dialog).trim() === "")
      .map((dialog) => describeDialog(dialog));

    expect(unnamed).toEqual([]);
  });

  it("names the modal through its own dialog role", () => {
    render(<ModalStack />);

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const namedDialog = screen.getByRole("dialog", { name: copy.confirm.defaultTitle });
    expect(namedDialog).toHaveAttribute("aria-modal", "true");
    expect(namedDialog).toHaveAccessibleName(copy.confirm.defaultTitle);
  });

  it("exposes exactly one modal dialog per open modal", () => {
    render(<ModalStack />);

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const modalDialogs = Array.from(
      document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']"),
    );
    expect(modalDialogs).toHaveLength(1);
  });

  it("moves focus into the dialog when the modal opens", () => {
    render(<ModalStack />);

    act(() => {
      useAppStore.getState().openModal({ id: "app-confirm" });
    });

    const panel = screen.getByTestId("modal-app-confirm");
    expect(document.activeElement).toBe(panel);
  });

  it("does not skip heading levels in the dashboard view", async () => {
    const { DashboardView } = await import("../views/views");
    const { container } = render(<DashboardView />);

    const headings = headingsOf(container);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.some((heading) => heading.level === 1)).toBe(true);

    expect(headingSkips(headings)).toEqual([]);
  });

  it("does not skip heading levels in the calendar view", async () => {
    const { CalendarView } = await import("../views/views");
    const { container } = render(<CalendarView />);

    const headings = headingsOf(container);
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.some((heading) => heading.level === 1)).toBe(true);

    expect(headingSkips(headings)).toEqual([]);
  });
});
