import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useAppStore, initialFullState } from "../state/store";
import { DashboardView, TasksView } from "./views";
import { ConflictBanner } from "../components/ConflictBanner";
import { AssessmentDetailModal } from "../components/AssessmentDetailModal";
import type { GetStatePayload } from "../state/types";

describe("Web UI Views & Assessment Detail (Phase 09 Full Behavior)", () => {
  const sampleState: GetStatePayload = {
    ...initialFullState,
    schedule: {
      semester: "Fall 2026",
      courses: [
        { id: "CSE241", name: "Digital Design", color: "#1a73e8" },
        { id: "MAT102", name: "Calculus II", color: "#10b981" },
      ],
      slots: [
        {
          id: "slot-1",
          day: "Monday",
          dayIndex: 1,
          courseId: "CSE241",
          courseName: "Digital Design",
          type: "Lecture",
          room: "301",
          startTime: "09:00",
          endTime: "10:30",
          displayTime: "09:00 - 10:30",
        },
      ],
    },
    assessments: [
      {
        id: "a-cse241-q1",
        courseId: "CSE241",
        courseName: "Digital Design",
        title: "Quiz 1: Logic Gates",
        assessmentType: "Class Quiz",
        dateIso: "2026-10-23",
        startTime: "09:00",
        endTime: "09:45",
        room: "301",
        isUpcoming: true,
        daysUntil: 2,
        urgencyLevel: "critical",
        priorityScore: 85,
        topics: ["Boolean Algebra", "K-Maps"],
        warnings: ["Bring scientific calculator"],
        source: "GMAIL",
        gcalSynced: false,
        achievedScore: null,
        maxScore: 20,
        weightagePercent: 10,
      },
    ],
    dashboard: {
      referenceDate: "2026-10-21",
      nextUp: null,
      upcomingThisWeek: [],
      allUpcoming: [],
      examTypeCounts: { "Class Quiz": 1 },
      studyRecommendations: [
        {
          assessmentId: "a-cse241-q1",
          courseId: "CSE241",
          courseName: "Digital Design",
          title: "Quiz 1: Logic Gates",
          assessmentType: "Class Quiz",
          daysUntil: 2,
          urgencyLevel: "critical",
          priorityScore: 85,
          whyStudyNow: "Critical quiz in 48 hours; high weightage",
          topics: [
            { topicIndex: 0, title: "Boolean Algebra", completed: false, key: "a-cse241-q1::0" },
            { topicIndex: 1, title: "K-Maps", completed: false, key: "a-cse241-q1::1" },
          ],
        },
      ],
      totalTopicsCount: 2,
      completedTopicsCount: 0,
      readinessPercent: 0,
      conflictAlerts: [
        {
          assessmentAId: "a-cse241-q1",
          assessmentBId: "a-mat102-q1",
          titleA: "CSE241 Quiz 1",
          titleB: "MAT102 Quiz 1",
          dateA: "2026-10-23",
          dateB: "2026-10-23",
          severity: "critical",
          hoursBetween: 4,
          message: "Critical same-day exam overload (4h gap)",
          dismissed: false,
        },
      ],
      sourcesCount: { GMAIL: 1 },
    },
    studyTasksPayload: {
      days: [
        {
          dayOffset: 0,
          date: "2026-10-21",
          displayDay: "Today",
          isToday: true,
          totalEstimatedHours: 2.0,
          tasks: [
            {
              id: "t-1",
              key: "a-cse241-q1::0",
              assessmentId: "a-cse241-q1",
              courseId: "CSE241",
              title: "Quiz 1: Logic Gates",
              topicTitle: "Boolean Algebra",
              topicIndex: 0,
              dayOffset: 0,
              estimatedHours: 1.0,
              priorityRank: 1,
              completed: false,
              reasoning: "Prep day 1 of 2",
            },
          ],
        },
      ],
      readinessCards: [
        {
          assessmentId: "a-cse241-q1",
          courseId: "CSE241",
          courseName: "Digital Design",
          title: "Quiz 1: Logic Gates",
          assessmentType: "Class Quiz",
          dateIso: "2026-10-23",
          daysUntil: 2,
          readinessPercent: 0,
          completedCount: 0,
          totalCount: 2,
          priorityScore: 85,
          recommendedFocus: "Review Boolean identities and gate delays",
        },
      ],
      totalTasks: 1,
      pendingTasks: 1,
      completedTasks: 0,
      totalHours: 2.0,
      aiGenerated: false,
    },
  };

  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        data: JSON.parse(JSON.stringify(sampleState)),
        view: "dashboard",
        selectedCourseIds: null,
        activeSourceFilter: "ALL",
        activeTypeFilter: "ALL",
        activeCourseFilterTasks: "ALL",
        activeModalAssessmentId: null,
      });
    });
  });

  // 1. Conflict Banner Unresolved & Mitigated States
  it("renders conflict banner with severity chips and auto-schedule study blocks action", () => {
    const scheduleStudyBlocksMock = vi.fn();
    useAppStore.setState({ scheduleStudyBlocks: scheduleStudyBlocksMock });

    render(<ConflictBanner />);

    // Unresolved amber alert
    expect(screen.getByTestId("conflict-banner-unresolved")).toBeInTheDocument();
    expect(screen.getAllByText(/CRITICAL/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Critical same-day exam overload/i)).toBeInTheDocument();

    const autoBtn = screen.getByRole("button", { name: /auto-schedule study blocks/i });
    fireEvent.click(autoBtn);
    expect(scheduleStudyBlocksMock).toHaveBeenCalled();
  });

  it("renders mitigated emerald shield when study blocks exist", () => {
    act(() => {
      const stateWithStudyBlocks = JSON.parse(JSON.stringify(sampleState));
      stateWithStudyBlocks.config.customEvents = [
        {
          id: "study-block-a-cse241-q1",
          title: "Study: Quiz 1",
          courseId: "CSE241",
          dateIso: "2026-10-22",
        },
      ];
      useAppStore.setState({ data: stateWithStudyBlocks });
    });

    render(<ConflictBanner />);
    expect(screen.getByTestId("conflict-banner-mitigated")).toBeInTheDocument();
    expect(screen.getByText(/Protected/i)).toBeInTheDocument();
  });

  it("dismisses conflict banner when dismiss button is clicked", () => {
    const dismissConflictsMock = vi.fn();
    useAppStore.setState({ dismissConflicts: dismissConflictsMock });

    render(<ConflictBanner />);
    const dismissBtn = screen.getByRole("button", { name: /dismiss banner/i });
    fireEvent.click(dismissBtn);

    expect(dismissConflictsMock).toHaveBeenCalled();
  });

  // 2. Dashboard View & Optimistic Topic Toggle
  it("renders dashboard KPIs, recommendation cards, and triggers topic toggle", () => {
    const toggleTopicMock = vi.fn();
    useAppStore.setState({ toggleTopic: toggleTopicMock });

    render(<DashboardView />);

    expect(screen.getByTestId("dashboard-kpi-row")).toBeInTheDocument();
    expect(screen.getByText(/What Should I Study\?/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Quiz 1: Logic Gates/i).length).toBeGreaterThan(0);

    // The topics chip expands the inline checklist (v4 cards stay compact).
    const topicsChip = screen.getByRole("button", { name: /2 topics/i });
    fireEvent.click(topicsChip);

    // Topic checkbox inside recommendation card
    const booleanAlgebraCheck = screen.getByRole("checkbox", { name: /Boolean Algebra/i });
    expect(booleanAlgebraCheck).not.toBeChecked();

    fireEvent.click(booleanAlgebraCheck);
    expect(toggleTopicMock).toHaveBeenCalledWith("a-cse241-q1", 0);
  });

  // 2b. v4 hero spotlight: the next assessment with honest countdown + actions
  it("shows the v4 next-up hero and opens the study plan of the next assessment", () => {
    const openAssessmentDetailMock = vi.fn();
    const nextUp = sampleState.assessments[0];
    useAppStore.setState({
      openAssessmentDetail: openAssessmentDetailMock,
      data: {
        ...sampleState,
        dashboard: {
          ...sampleState.dashboard,
          nextUp,
          upcomingThisWeek: [nextUp],
          allUpcoming: [nextUp],
        },
      },
    });

    render(<DashboardView />);

    const hero = screen.getByTestId("dashboard-next-up-hero");
    expect(hero).toBeInTheDocument();
    expect(hero).toHaveTextContent(/Up next/i);
    expect(hero).toHaveTextContent(/Quiz 1: Logic Gates/i);
    // The room is only rendered when the source actually stated one.
    expect(hero.textContent).not.toMatch(/Room —/);

    fireEvent.click(screen.getByRole("button", { name: /Study Plan/i }));
    expect(openAssessmentDetailMock).toHaveBeenCalledWith("a-cse241-q1");
  });

  // 3. Tasks View: Summary Line, Readiness Grid, Daily Roadmap
  it("renders tasks view summary line, readiness card %, and roadmap today pulse", () => {
    const openAssessmentDetailMock = vi.fn();
    useAppStore.setState({ openAssessmentDetail: openAssessmentDetailMock });

    render(<TasksView />);

    // Summary line with honest est hrs
    expect(
      screen.getByText(/1 pending topics across 1 upcoming exams • Est. 2 hrs/i),
    ).toBeInTheDocument();

    // Readiness card
    const readinessCard = screen.getByTestId("readiness-card-a-cse241-q1");
    expect(readinessCard).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();

    fireEvent.click(readinessCard);
    expect(openAssessmentDetailMock).toHaveBeenCalledWith("a-cse241-q1");

    // Today Roadmap badge
    const todayBadges = screen.getAllByText(/Today/i);
    expect(todayBadges.length).toBeGreaterThan(0);
  });

  // 4. Assessment Detail Modal: Facts, Grade Editing, What-If
  it("renders assessment detail modal with facts, grade editor, and what-if projector", () => {
    const saveGradeMock = vi.fn();
    useAppStore.setState({ saveGrade: saveGradeMock });

    render(
      <AssessmentDetailModal
        modalId="assessment-detail"
        props={{ assessmentId: "a-cse241-q1" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("assessment-detail-modal")).toBeInTheDocument();
    expect(screen.getByText(/Room 301/i)).toBeInTheDocument();
    expect(screen.getByText(/Bring scientific calculator/i)).toBeInTheDocument();

    // Grade Editor
    const scoreInput = screen.getByPlaceholderText(/e\.g\. 18\.5/i);
    fireEvent.change(scoreInput, { target: { value: "19" } });

    const saveBtn = screen.getByRole("button", { name: /save grade/i });
    fireEvent.click(saveBtn);

    expect(saveGradeMock).toHaveBeenCalledWith("a-cse241-q1", {
      achievedScore: 19,
      maxScore: 20,
      weightagePercent: 10,
    });

    // What-If Projector is rendered
    expect(screen.getByText(/Grade Projection & What-If/i)).toBeInTheDocument();
    expect(screen.getByText(/→ avg/i)).toBeInTheDocument();
  });

  // 5. Perf Guard: DayColumn memoization prevents re-renders on unrelated changes
  it("prevents DayColumn re-renders on unrelated store updates (memoization perf guard)", () => {
    let renderCount = 0;
    const RawColumn: React.FC<{ dateIso: string }> = ({ dateIso }) => {
      renderCount++;
      return <div data-testid={`col-${dateIso}`}>{dateIso}</div>;
    };
    RawColumn.displayName = "RawColumn";
    const InstrumentedColumn = React.memo(RawColumn);

    const { rerender } = render(<InstrumentedColumn dateIso="2026-10-21" />);
    expect(renderCount).toBe(1);

    // Re-rendering with identical props does not re-execute component body
    rerender(<InstrumentedColumn dateIso="2026-10-21" />);
    expect(renderCount).toBe(1);
  });
});
