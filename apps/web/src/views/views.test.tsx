import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useAppStore, initialFullState } from "../state/store";
import { copy } from "../copy";
import { DashboardView } from "./DashboardView";
import { TasksView } from "./TasksView";
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
          // The day's tasks carry their own estimates; the view sums the
          // visible tasks, so the fixture must agree with them.
          totalEstimatedHours: 1.0,
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
        // The global search is app-wide state — a test that sets it must not
        // leak into the next one.
        searchQuery: "",
        openModals: [],
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
      // The core decides per conflict pair whether a study block covers it
      // (`is_mitigated`). "Any study block exists" used to flip the whole
      // banner to "Mitigated" and hide uncovered conflicts.
      stateWithStudyBlocks.dashboard.conflictAlerts[0].isMitigated = true;
      useAppStore.setState({ data: stateWithStudyBlocks });
    });

    render(<ConflictBanner />);
    expect(screen.getByTestId("conflict-banner-mitigated")).toBeInTheDocument();
    expect(screen.getByText(/Protected/i)).toBeInTheDocument();
  });

  it("keeps the amber banner when one conflict pair is still uncovered", () => {
    act(() => {
      const mixed = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
      mixed.dashboard.conflictAlerts = [
        {
          ...mixed.dashboard.conflictAlerts[0],
          isMitigated: true,
        },
        {
          assessmentAId: "a-cse241-q2",
          assessmentBId: "a-mat102-q2",
          titleA: "CSE241 Quiz 2",
          titleB: "MAT102 Quiz 2",
          dateA: "2026-10-24",
          dateB: "2026-10-24",
          severity: "critical",
          hoursBetween: 3,
          message: "Critical same-day exam overload (3h gap)",
          dismissed: false,
          isMitigated: false,
        },
      ];
      useAppStore.setState({ data: mixed });
    });

    render(<ConflictBanner />);
    expect(screen.getByTestId("conflict-banner-unresolved")).toBeInTheDocument();
    expect(screen.queryByTestId("conflict-banner-mitigated")).not.toBeInTheDocument();
    // The uncovered pair is the one that is named.
    expect(screen.getByText(/CSE241 Quiz 2/)).toBeInTheDocument();
    expect(screen.getByText(/other conflict/i)).toBeInTheDocument();
  });

  it("dismisses conflict banner when dismiss button is clicked", () => {
    const dismissConflictsMock = vi.fn();
    useAppStore.setState({ dismissConflicts: dismissConflictsMock });

    render(<ConflictBanner />);
    const dismissBtn = screen.getByRole("button", { name: /dismiss banner/i });
    fireEvent.click(dismissBtn);

    expect(dismissConflictsMock).toHaveBeenCalled();
  });

  // 1b. Phase-19: identical conflict titles are disambiguated with the ids,
  // never rendered as the stuttering "X and X".
  it("disambiguates with assessment ids when both conflict titles are identical", () => {
    const dup = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
    dup.dashboard.conflictAlerts = [
      {
        assessmentAId: "a-x",
        assessmentBId: "b-y",
        titleA: "Midterm",
        titleB: "Midterm",
        dateA: "2026-10-23",
        dateB: "2026-10-23",
        severity: "critical",
        hoursBetween: 2,
        message: "Same-slot overlap",
        dismissed: false,
      },
    ];
    useAppStore.setState({ data: dup });
    render(<ConflictBanner />);
    expect(screen.getByText(/a-x vs b-y/)).toBeInTheDocument();
    expect(screen.queryByText(/Midterm and/)).not.toBeInTheDocument();
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

  // 2c. Phase-19: zero tracked topics means NO readiness number — never a fake 100%
  it("shows an em dash, not 100%, for readiness when zero topics are tracked", () => {
    useAppStore.setState({
      data: {
        ...sampleState,
        dashboard: {
          ...sampleState.dashboard,
          totalTopicsCount: 0,
          completedTopicsCount: 0,
          readinessPercent: 100,
        },
      },
    });
    render(<DashboardView />);
    expect(screen.getByText(copy.dashboard.kpiReadinessNone)).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  // 2d. The top-bar search filters the dashboard live (01 §4.8). The query
  // used to live only inside the search input, so the calendar/dashboard
  // never re-rendered.
  it("filters the study recommendations by the global search query and says so", () => {
    const twoAssessments = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
    twoAssessments.dashboard.studyRecommendations.push({
      ...twoAssessments.dashboard.studyRecommendations[0],
      assessmentId: "a-mat102-q1",
      courseId: "MAT102",
      courseName: "Calculus II",
      title: "Quiz 1: Derivatives",
      topics: [{ topicIndex: 0, title: "Limits", completed: false, key: "topic-0" }],
    });

    useAppStore.setState({ data: twoAssessments, searchQuery: "derivatives" });
    render(<DashboardView />);

    // The banner names the active filter - a silently filtered list reads as
    // "that is all there is".
    const banner = screen.getByTestId("dashboard-search-banner");
    expect(banner).toHaveTextContent(/derivatives/i);

    expect(screen.getByText("Quiz 1: Derivatives")).toBeInTheDocument();
    expect(screen.queryByText("Quiz 1: Logic Gates")).not.toBeInTheDocument();
  });

  it("does not claim the study plan is empty when the search hides every card", () => {
    useAppStore.setState({ data: sampleState, searchQuery: "nothing-matches-this" });
    render(<DashboardView />);

    // "You're all caught up" would be a lie: the plan is still pending, the
    // search simply matched nothing.
    expect(screen.getByTestId("study-empty-search")).toBeInTheDocument();
    expect(screen.queryByText(copy.dashboard.studyAllClearTitle)).not.toBeInTheDocument();
  });

  // 2e. The pomodoro's "Mark Done" only renders when the modal knows WHICH
  // topic it is working on. The store used to pass a `topicKey` the modal
  // never read, so the control was dead in production.
  it("opens the pomodoro with the topic index so its Mark Done control exists", () => {
    useAppStore.setState({ data: sampleState, openModals: [] });
    render(<DashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /2 topics/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /start a focus session for boolean algebra/i }),
    );

    const modal = useAppStore.getState().openModals.find((m) => m.id === "pomodoro");
    expect(modal).toBeDefined();
    expect(modal?.props).toMatchObject({
      assessmentId: "a-cse241-q1",
      topicIndex: 0,
      topicTitle: "Boolean Algebra",
    });
  });

  // 2c-bis. Round 7: the same rule applies to the "What Should I Study?"
  // cards. The core sends progress_percent = 100 for a card with no topics
  // (0/0 means "nothing pending"); rendering that as a mastery percentage
  // fabricates progress the student never recorded.
  it("withholds the readiness percentage on a recommendation card with no topics", () => {
    const topicless = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
    topicless.dashboard.studyRecommendations = [
      {
        ...topicless.dashboard.studyRecommendations[0],
        topics: [],
        progressPercent: 100,
      },
    ];
    useAppStore.setState({ data: topicless });

    render(<DashboardView />);
    const card = screen.getByTestId("rec-card-a-cse241-q1");
    expect(card).toHaveTextContent(copy.common.noTopicsTracked);
    expect(card.textContent).not.toContain("100%");
  });

  // 2d. The assessments ledger lives in TasksView under the "All Assessments" tab,
  // with sensible time horizons and type filters.
  it("renders the assessments ledger inside tasks view with time horizon and type filters", () => {
    useAppStore.setState({ data: sampleState });
    render(<TasksView />);
    fireEvent.click(screen.getByRole("button", { name: /all assessments/i }));
    expect(screen.getByTestId("timeline-row-a-cse241-q1")).toBeInTheDocument();

    // Time horizon buttons
    expect(screen.getByRole("button", { name: /upcoming & recent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /all history/i })).toBeInTheDocument();

    // Filter by type
    const typeSelect = screen.getByLabelText("Filter by assessment type");
    fireEvent.change(typeSelect, { target: { value: "Final Exam" } });
    expect(screen.getByText("No assessments match your active filters")).toBeInTheDocument();

    // Reset filters
    fireEvent.click(screen.getByRole("button", { name: /reset all filters/i }));
    expect(screen.getByTestId("timeline-row-a-cse241-q1")).toBeInTheDocument();
  });

  // 2f. Phase-19: hero and rec cards show the course NAME, never the raw id
  it("renders course names instead of raw ids in the hero and rec cards", () => {
    const nextUp = sampleState.assessments[0];
    useAppStore.setState({
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
    expect(hero).toHaveTextContent("Digital Design");
    expect(hero.textContent).not.toContain("CSE241");
    const card = screen.getByTestId("rec-card-a-cse241-q1");
    expect(card).toHaveTextContent("Digital Design");
    expect(card.textContent).not.toContain("CSE241");
  });

  // 3. Tasks View: Summary Line, Readiness Grid, Daily Roadmap
  it("renders tasks view summary line, readiness card %, and roadmap today pulse", () => {
    const openAssessmentDetailMock = vi.fn();
    useAppStore.setState({ openAssessmentDetail: openAssessmentDetailMock });

    render(<TasksView />);

    // Summary line with honest est hrs (summed from the visible tasks)
    expect(
      screen.getByText(/1 pending study steps across 1 upcoming exams • Est. 1 hrs/i),
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

  // 3b. Phase-19: the summary line follows the course filter — it must never
  // contradict the (empty) sections below it.
  it("tasks summary line reflects the active course filter, not the wider payload", () => {
    render(<TasksView />);
    act(() => {
      useAppStore.setState({ activeCourseFilterTasks: "MAT102" });
    });
    expect(screen.getByText(/0 pending study steps across 0 upcoming exams/i)).toBeInTheDocument();
    // Distinct honest copy for each section: readiness vs roadmap.
    expect(screen.getByText(copy.emptyStates.noUpcomingExams)).toBeInTheDocument();
    expect(screen.getByText(copy.emptyStates.noStudyTasksPending)).toBeInTheDocument();
  });

  // 3c. Phase-19: readiness cards show the course name, not the raw id.
  it("renders the course name on readiness cards", () => {
    render(<TasksView />);
    const card = screen.getByTestId("readiness-card-a-cse241-q1");
    expect(card).toHaveTextContent("Digital Design");
    expect(card.textContent).not.toContain("CSE241");
  });

  // 3d. Round 7: an exam with no tracked topics has no readiness number —
  // the core's 0/0 = 100 ("nothing pending") must not be rendered as 100%.
  it("withholds the readiness percentage on a readiness card with no topics", () => {
    const topicless = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
    topicless.studyTasksPayload.readinessCards = [
      {
        ...topicless.studyTasksPayload.readinessCards[0],
        readinessPercent: 100,
        completedCount: 0,
        totalCount: 0,
      },
    ];
    useAppStore.setState({ data: topicless });

    render(<TasksView />);
    const card = screen.getByTestId("readiness-card-a-cse241-q1");
    expect(card).toHaveTextContent(copy.common.noTopicsTracked);
    expect(card.textContent).not.toContain("100%");
    // The average must not be invented from the topicless card either.
    expect(screen.queryByText(/avg readiness/i)).not.toBeInTheDocument();
  });

  // 3e. Round 7: the average readiness only counts exams that actually have
  // topics — a topicless exam must not drag the average down or up.
  it("averages readiness only over exams that track topics", () => {
    const mixed = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
    mixed.studyTasksPayload.readinessCards = [
      {
        ...mixed.studyTasksPayload.readinessCards[0],
        readinessPercent: 50,
        completedCount: 1,
        totalCount: 2,
      },
      {
        ...mixed.studyTasksPayload.readinessCards[0],
        assessmentId: "a-mat102-q1",
        courseId: "MAT102",
        readinessPercent: 100,
        completedCount: 0,
        totalCount: 0,
      },
    ];
    useAppStore.setState({ data: mixed });

    render(<TasksView />);
    // The average is 50% (only the tracked exam), not 75% (both cards).
    expect(screen.getByText(/50% avg readiness/i)).toBeInTheDocument();
    expect(screen.queryByText(/75%/)).not.toBeInTheDocument();
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

    // Round 7: the date is printed for humans, never as a raw storage date.
    expect(screen.getByText("Fri, Oct 23, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-23/)).not.toBeInTheDocument();

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
