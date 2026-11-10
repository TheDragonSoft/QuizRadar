/**
 * Cold-start regression tests for the browser tier.
 *
 * A cold offline start must show the user's own last snapshot. The failure
 * these guard against is quiet and very confusing: the app renders its
 * first-run empty dashboard ("add your first course", "connect your
 * account") for a user who already has courses, until the IndexedDB read
 * finally resolves.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { bootQuizRadar } from "./boot";
import { BootGate } from "./bootGate";
import { useAppStore } from "./store";
import { setRpcMockHandler } from "./rpc";
import { SWR_CACHE_KEY, saveCachedState } from "./swr";
import type { GetStatePayload } from "./types";

function snapshotFixture(): GetStatePayload {
  return {
    ...useAppStore.getState().data,
    assessments: [
      {
        id: "exam-saved",
        courseId: "CSE 341",
        courseName: "Operating Systems",
        title: "Midterm Exam",
        assessmentType: "Midterm",
        dateIso: "2026-12-15",
        dayName: "Tuesday",
        startTime: "10:00",
        endTime: "12:00",
        displayTime: "10:00 – 12:00",
        room: "B-201",
        isUpcoming: true,
        daysUntil: 44,
        urgencyLevel: "medium",
        priorityScore: 50,
        topics: ["Scheduling"],
        warnings: [],
        source: "email",
      },
    ],
  };
}

describe("browser tier cold start", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.setState({ data: useAppStore.getState().data, hasLoaded: false });
  });

  afterEach(() => {
    setRpcMockHandler(null);
    window.localStorage.clear();
  });

  it("restores the last saved snapshot into the store before the first paint", () => {
    const snapshot = snapshotFixture();
    saveCachedState(snapshot);

    const boot = bootQuizRadar();

    // The store already holds the user's data — no await, no empty paint.
    expect(boot.hasSnapshot).toBe(true);
    expect(useAppStore.getState().data.assessments).toHaveLength(1);
    expect(useAppStore.getState().data.assessments[0].id).toBe("exam-saved");
  });

  it("shows an honest loading state instead of a fake-empty dashboard", async () => {
    // No snapshot: the app must not claim the user has nothing.
    window.localStorage.removeItem(SWR_CACHE_KEY);
    let resolveLoad: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    render(
      <BootGate boot={{ hasSnapshot: false, ready: pending }}>
        <div data-testid="app-content">the app</div>
      </BootGate>,
    );

    expect(screen.getByTestId("boot-loading")).toBeInTheDocument();
    expect(screen.getByText(/loading your saved data/i)).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();

    resolveLoad?.();
    await waitFor(() => expect(screen.getByTestId("app-content")).toBeInTheDocument());
    expect(screen.queryByTestId("boot-loading")).not.toBeInTheDocument();
  });

  it("renders the app immediately when a snapshot was restored", async () => {
    saveCachedState(snapshotFixture());

    const boot = bootQuizRadar();

    render(
      <BootGate boot={boot}>
        <div data-testid="app-content">the app</div>
      </BootGate>,
    );

    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.queryByTestId("boot-loading")).not.toBeInTheDocument();
  });

  it("finishes the first load and keeps the restored snapshot in local storage", async () => {
    const fresh = snapshotFixture();
    setRpcMockHandler(async <T,>() => fresh as unknown as T);

    const boot = bootQuizRadar();
    expect(boot.hasSnapshot).toBe(false);
    await boot.ready;

    await waitFor(() => expect(useAppStore.getState().hasLoaded).toBe(true));
    expect(useAppStore.getState().data.assessments).toHaveLength(1);
    // The fresh state is cached for the next cold start.
    expect(window.localStorage.getItem(SWR_CACHE_KEY)).toBeTruthy();
  });

  it("treats pre-v3 positional keys as loading so cold frames never paint unchecked stale topics", () => {
    const legacySnapshot: GetStatePayload = {
      ...snapshotFixture(),
      studyTasksPayload: {
        totalTasks: 1,
        pendingTasks: 1,
        completedTasks: 0,
        aiGenerated: false,
        days: [
          {
            dayOffset: 0,
            date: "2026-11-01",
            displayDay: "Nov 1",
            isToday: false,
            tasks: [
              {
                id: "t1",
                key: "exam-saved::0", // legacy positional key
                assessmentId: "exam-saved",
                title: "Study Scheduling",
                courseId: "CSE 341",
                courseName: "OS",
                topicTitle: "Scheduling",
                topicIndex: 0,
                dayOffset: 0,
                priorityRank: 1,
                reasoning: "Review CPU scheduling",
                completed: false,
              },
            ],
          },
        ],
        readinessCards: [],
      },
    };

    saveCachedState(legacySnapshot);

    const boot = bootQuizRadar();

    // Stale positional snapshot is discarded; treated as loading
    expect(boot.hasSnapshot).toBe(false);

    render(
      <BootGate boot={boot}>
        <div data-testid="app-content">the app</div>
      </BootGate>,
    );

    // BootGate displays loading instead of painting stale unchecked state
    expect(screen.getByTestId("boot-loading")).toBeInTheDocument();
  });
});
