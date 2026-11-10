/**
 * Real axe-core audits (the structural twin lives in
 * `accessibility.test.tsx`, which needs no dependency).
 *
 * `jest-axe` runs the full axe-core rule set over the rendered DOM inside
 * jsdom. Rules that need real layout (notably `color-contrast`) come back
 * "inapplicable" there, so the result is a genuine structural audit —
 * labels, roles, aria usage, duplicate ids, name/role/value — not a layout
 * audit. The pixel-level checks stay with the Playwright harness and the
 * impeccable audit passes.
 *
 * One deliberate configuration: the `region` rule is disabled. The chrome
 * renders as a fragment of `<header>`/`<aside>`/`<main>` inside a shell that
 * also hosts the modal stack; axe cannot see the landmarks document from
 * these per-component renders and flags every node as "outside a landmark".
 * The real landmark tree is checked by the structural suite, which asserts
 * the shell's `main`/`header`/`nav` roles on the composed app.
 */

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe, toHaveNoViolations } from "jest-axe";
import type { AxeResults } from "axe-core";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { ModalStack } from "../components/ModalStack";
import { AppConfirmModal } from "../components/AppConfirmModal";
import { registerModal, type ModalComponent } from "../components/modalRegistry";
import { useAppStore, initialFullState } from "../state/store";
import type { GetStatePayload } from "../state/types";

declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
}

expect.extend(toHaveNoViolations);

/** axe over a rendered tree, with the documented jsdom exceptions. */
async function audit(container: HTMLElement): Promise<AxeResults> {
  const results = await axe(container, {
    rules: {
      region: { enabled: false },
    },
  });
  return results as unknown as AxeResults;
}

registerModal("app-confirm", AppConfirmModal as unknown as ModalComponent);

function populatedState(): GetStatePayload {
  return JSON.parse(
    JSON.stringify({
      ...initialFullState,
      schedule: {
        semester: "Fall 2026",
        courses: [{ id: "CS2410", name: "Digital Systems", color: "#1a73e8" }],
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
        studyRecommendations: [],
        totalTopicsCount: 2,
        completedTopicsCount: 0,
        readinessPercent: 0,
        conflictAlerts: [],
        sourcesCount: { GMAIL: 1 },
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
    }),
  ) as GetStatePayload;
}

describe("axe-core audits", () => {
  beforeEach(() => {
    useAppStore.setState({
      data: populatedState(),
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

  it(
    "the chrome (top bar + rail + confirm modal) has no axe violations",
    { timeout: 60_000 },
    async () => {
      const { container } = render(
        <>
          <TopBar />
          <Sidebar />
          <ModalStack />
        </>,
      );
      act(() => {
        useAppStore.getState().openModal({ id: "app-confirm" });
      });
      const results = await audit(container);
      expect(results).toHaveNoViolations();
    },
  );

  it("the dashboard view has no axe violations", { timeout: 60_000 }, async () => {
    const { DashboardView } = await import("../views/DashboardView");
    const { container } = render(<DashboardView />);
    const results = await audit(container);
    expect(results).toHaveNoViolations();
  });

  it("the week calendar has no axe violations", { timeout: 60_000 }, async () => {
    const { CalendarView } = await import("../views/CalendarView");
    const { container } = render(<CalendarView />);
    const results = await audit(container);
    expect(results).toHaveNoViolations();
  });
});
