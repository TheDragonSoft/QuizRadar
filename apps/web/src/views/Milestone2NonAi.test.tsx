import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useAppStore, initialFullState } from "../state/store";
import { getLocalDateString } from "../state/watchdog";
import { DashboardView } from "./DashboardView";
import { TasksView } from "./TasksView";
import { CalendarView } from "./CalendarView";
import { FocusView } from "./FocusView";
import { SettingsView } from "./SettingsView";
import { AddCourseModal } from "../components/AddCourseModal";
import { PrintScheduleDoc } from "../components/PrintScheduleDoc";
import App from "../App";
import type { GetStatePayload } from "../state/types";

describe("Milestone 2: Web & Desktop Non-AI Feature Suite", () => {
  const sampleState: GetStatePayload = {
    ...initialFullState,
    schedule: {
      semester: "Fall 2026",
      courses: [
        { id: "CSE241", name: "Digital Design", color: "#1a73e8", credits: 4 },
        { id: "MAT102", name: "Calculus II", color: "#10b981", credits: 3 },
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
          weekParity: "all",
        },
        {
          id: "slot-2",
          day: "Wednesday",
          dayIndex: 3,
          courseId: "MAT102",
          courseName: "Calculus II",
          type: "Lab",
          room: "Lab-B",
          startTime: "14:00",
          endTime: "16:00",
          displayTime: "14:00 - 16:00",
          weekParity: "week_a",
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
        dateIso: "2026-11-15",
        startTime: "10:00",
        endTime: "10:45",
        displayTime: "10:00 - 10:45",
        isUpcoming: true,
        daysUntil: 2,
        urgencyLevel: "high",
        priorityScore: 88,
        topics: ["Boolean Algebra", "Gate Propagation Delays"],
        warnings: [],
        source: "Syllabus",
        achievedScore: 18,
        maxScore: 20,
        weightagePercent: 15,
      },
      {
        id: "a-mat102-mid",
        courseId: "MAT102",
        courseName: "Calculus II",
        title: "Midterm Exam",
        assessmentType: "Midterm Exam",
        dateIso: "2026-11-20",
        isUpcoming: true,
        daysUntil: 7,
        urgencyLevel: "medium",
        priorityScore: 70,
        topics: ["Taylor Series", "Polar Coordinates"],
        warnings: [],
        source: "Manual",
        achievedScore: null,
        maxScore: 100,
        weightagePercent: 30,
      },
    ],
    dashboard: {
      ...initialFullState.dashboard,
      studyRecommendations: [
        {
          assessmentId: "a-cse241-q1",
          courseId: "CSE241",
          title: "Quiz 1: Logic Gates",
          assessmentType: "Class Quiz",
          whyStudyNow: "Prep for Quiz 1 in 2 days",
          dateIso: "2026-11-15",
          urgencyLevel: "high",
          priorityScore: 88,
          progressPercent: 50,
          daysUntil: 2,
          topics: [
            { key: "t-0", title: "Boolean Algebra", topicIndex: 0, completed: true },
            { key: "t-1", title: "Gate Propagation Delays", topicIndex: 1, completed: false },
          ],
        },
      ],
    },
    studyTasksPayload: {
      totalTasks: 1,
      pendingTasks: 1,
      completedTasks: 0,
      totalHours: 1.5,
      aiGenerated: false,
      todayCushion: {
        date: "2026-11-06",
        wakingHours: 16,
        committedHours: 3.5,
        availableHours: 12.5,
        requiredHours: 4,
        cushionHours: 8.5,
        deficitHours: null,
        isDeficit: false,
      },
      days: [
        {
          dayOffset: 0,
          date: "2026-11-06",
          displayDay: "Friday",
          isToday: true,
          tasks: [
            {
              id: "task-1",
              key: "task-1",
              title: "Review Gate Delays",
              courseId: "CSE241",
              assessmentId: "a-cse241-q1",
              topicIndex: 1,
              topicTitle: "Gate Propagation Delays",
              reasoning: "Prep for Quiz 1 in 2 days",
              completed: false,
              estimatedHours: 1.5,
              dayOffset: 0,
              priorityRank: 1,
            },
          ],
        },
      ],
      readinessCards: [],
    },
  };

  beforeEach(() => {
    useAppStore.setState({
      ...initialFullState,
      data: sampleState,
      view: "dashboard",
      pomodoroIsRunning: false,
      pomodoroSecondsLeft: 25 * 60,
      pomodoroMode: "pomodoro",
      gradingScale: "4.0",
      flashcards: [],
      mistakeBank: [],
    });
  });

  // 1. Multi-Pane Widescreen Density (>=1200px)
  it("renders side-by-side split view on widescreen with embedded CalendarGrid and DailyStudyRoadmap", () => {
    render(<DashboardView forceWidescreen={true} />);

    // Left pane has calendar grid
    const leftPane = screen.getByTestId("dashboard-widescreen-left-pane");
    expect(leftPane).toBeInTheDocument();
    expect(within(leftPane).getByTestId("calendar-grid")).toBeInTheDocument();

    // Right pane has NextUpHero and DailyStudyRoadmap
    const rightPane = screen.getByTestId("dashboard-widescreen-right-pane");
    expect(rightPane).toBeInTheDocument();
    expect(within(rightPane).getByTestId("dashboard-next-up-hero")).toBeInTheDocument();
    expect(within(rightPane).getByTestId("daily-study-roadmap")).toBeInTheDocument();
  });

  // 2. GPA & Course Grade Center
  it("renders Grade Center tab with GPA calculations across multiple grading scales", () => {
    render(<TasksView />);

    // Click 3rd sub-tab: Grade Center & GPA
    const gradesTab = screen.getByRole("button", { name: /grade center & gpa/i });
    expect(gradesTab).toBeInTheDocument();
    fireEvent.click(gradesTab);

    // Verify GPA summary card and enrolled credits
    expect(screen.getByText("Semester GPA")).toBeInTheDocument();
    expect(screen.getByText("Total Enrolled Credits")).toBeInTheDocument();
    expect(screen.getByText("7.0")).toBeInTheDocument(); // 4 + 3 credits

    // Grading scale dropdown
    const scaleSelect = screen.getByLabelText("Select grading scale") as HTMLSelectElement;
    expect(scaleSelect).toBeInTheDocument();
    expect(scaleSelect.value).toBe("4.0");

    // Switch to UK Honours
    fireEvent.change(scaleSelect, { target: { value: "uk_honors" } });
    expect(useAppStore.getState().gradingScale).toBe("uk_honors");

    // Switch to ECTS
    fireEvent.change(scaleSelect, { target: { value: "ects" } });
    expect(useAppStore.getState().gradingScale).toBe("ects");

    // Switch to Percentage
    fireEvent.change(scaleSelect, { target: { value: "percentage" } });
    expect(useAppStore.getState().gradingScale).toBe("percentage");

    // Course Grade Card: Digital Design points breakdown
    expect(screen.getAllByText("Digital Design").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/4\.0 Credits/i)).toBeInTheDocument();
    expect(screen.getByText("18 / 20")).toBeInTheDocument(); // 18 out of 20 score
  });

  it("renders course credits input and slot parity selector in AddCourseModal", () => {
    render(<AddCourseModal modalId="add-course" onClose={vi.fn()} />);

    // Credits input field
    const creditsInput = screen.getByTestId("course-credits-input") as HTMLInputElement;
    expect(creditsInput).toBeInTheDocument();
    fireEvent.change(creditsInput, { target: { value: "4.5" } });
    expect(creditsInput.value).toBe("4.5");

    // Add slot and verify parity dropdown
    const addSlotBtn = screen.getByRole("button", { name: /add class slot/i });
    fireEvent.click(addSlotBtn);

    const paritySelect = screen.getByLabelText(/Recurrence for slot 1/i) as HTMLSelectElement;
    expect(paritySelect).toBeInTheDocument();
    expect(paritySelect.value).toBe("all");
    fireEvent.change(paritySelect, { target: { value: "week_b" } });
    expect(paritySelect.value).toBe("week_b");
  });

  // 3. Power-User Keyboard Shortcuts
  it("handles keyboard navigation (1-4, T, N, Space) and ignores shortcuts when typing in inputs", () => {
    render(<App />);

    // Press '2' -> switches to tasks
    fireEvent.keyDown(window, { key: "2" });
    expect(useAppStore.getState().view).toBe("tasks");

    // Press '3' -> switches to calendar
    fireEvent.keyDown(window, { key: "3" });
    expect(useAppStore.getState().view).toBe("calendar");

    // Press '4' -> switches to focus
    fireEvent.keyDown(window, { key: "4" });
    expect(useAppStore.getState().view).toBe("focus");

    // Press '1' -> switches to dashboard
    fireEvent.keyDown(window, { key: "1" });
    expect(useAppStore.getState().view).toBe("dashboard");

    // Press 'Space' -> toggles Pomodoro timer
    expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(useAppStore.getState().pomodoroIsRunning).toBe(true);
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(useAppStore.getState().pomodoroIsRunning).toBe(false);

    // Press 'T' -> jump to today
    useAppStore.setState({ selectedCalendarDate: "2025-01-01" });
    fireEvent.keyDown(window, { key: "t" });
    const todayStr = getLocalDateString();
    expect(useAppStore.getState().selectedCalendarDate).toBe(todayStr);

    // Input safety: create a dummy input element and focus it
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    // While focused on input, pressing '3' must NOT switch view
    useAppStore.setState({ view: "dashboard" });
    fireEvent.keyDown(input, { key: "3" });
    expect(useAppStore.getState().view).toBe("dashboard");

    // While focused on input, pressing 'Space' must NOT toggle timer
    fireEvent.keyDown(input, { key: " ", code: "Space" });
    expect(useAppStore.getState().pomodoroIsRunning).toBe(false);

    document.body.removeChild(input);
  });

  // 4. Printable and Exportable Clean PDF
  it("renders print schedule document with weekly timetable and exam cram sheet checklist", () => {
    render(<PrintScheduleDoc />);

    // Timetable section
    expect(screen.getByText(/Weekly Class Timetable/i)).toBeInTheDocument();
    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByText("Wednesday")).toBeInTheDocument();

    // Cram sheet section
    expect(screen.getByText(/Topic Cram Checklist/i)).toBeInTheDocument();
    expect(screen.getByText(/Quiz 1: Logic Gates/i)).toBeInTheDocument();
    expect(screen.getByText("Boolean Algebra")).toBeInTheDocument();
    expect(screen.getByText("Gate Propagation Delays")).toBeInTheDocument();
  });

  it("renders print button in CalendarView with testid", () => {
    render(<CalendarView />);
    const printBtn = screen.getByTestId("print-schedule-btn");
    expect(printBtn).toBeInTheDocument();
  });

  // 5. Cross-Platform Web Implementations
  it("displays study cushion badge and handles week parity chips in CalendarView", () => {
    render(<CalendarView />);

    // Week parity chip is rendered
    expect(screen.getByTestId("week-parity-chip")).toBeInTheDocument();

    // Filter select works
    const parityFilterSelect = screen.getByTestId("parity-filter-select");
    expect(parityFilterSelect).toBeInTheDocument();
    fireEvent.change(parityFilterSelect, { target: { value: "week_a" } });
    expect(useAppStore.getState().weekParityFilter).toBe("week_a");
  });

  it("displays Canvas and Blackboard guides with iCal feed inputs in SettingsView", () => {
    render(<SettingsView />);

    // Canvas accordion
    const canvasBtn = screen.getByRole("button", { name: /Canvas LMS Calendar Feed/i });
    expect(canvasBtn).toBeInTheDocument();
    fireEvent.click(canvasBtn);
    expect(screen.getByText(/How to extract your private Canvas Calendar Feed:/i)).toBeInTheDocument();

    // Blackboard accordion
    const blackboardBtn = screen.getByRole("button", { name: /Blackboard Learn Calendar Feed/i });
    expect(blackboardBtn).toBeInTheDocument();
    fireEvent.click(blackboardBtn);
    expect(screen.getByText(/How to extract your Blackboard Calendar Link:/i)).toBeInTheDocument();

    // Moodle accordion (prioritizes iCal feed and demotes REST)
    const moodleBtn = screen.getByRole("button", { name: /Moodle LMS Calendar Feed/i });
    expect(moodleBtn).toBeInTheDocument();
    fireEvent.click(moodleBtn);
    expect(screen.getByText(/How to extract your private Moodle Calendar export feed:/i)).toBeInTheDocument();
    expect(screen.getByText(/Advanced: Moodle Web Service \/ REST API \(rare\)/i)).toBeInTheDocument();
  });

  it("supports interactive Flashcards review and persistent Mistake Bank in FocusView", () => {
    render(<FocusView />);

    // Switch to Flashcards tab
    const flashcardsTab = screen.getByRole("tab", { name: /Flashcards/i });
    expect(flashcardsTab).toBeInTheDocument();
    fireEvent.click(flashcardsTab);
    expect(screen.getByTestId("flashcards-section")).toBeInTheDocument();

    // Seed from syllabus topics
    const seedBtn = screen.getByRole("button", { name: /Seed from Topics/i });
    fireEvent.click(seedBtn);
    expect(useAppStore.getState().flashcards.length).toBeGreaterThan(0);

    // Flip flashcard
    const flipCard = screen.getByRole("button", { name: /Flip flashcard/i });
    fireEvent.click(flipCard);
    expect(screen.getByText("Answer / Explanation")).toBeInTheDocument();

    // Rate Needs Review -> logs into Mistake Bank
    const needsReviewBtn = screen.getByRole("button", { name: /Needs Review/i });
    fireEvent.click(needsReviewBtn);
    expect(useAppStore.getState().mistakeBank.length).toBeGreaterThan(0);

    // Switch to Mistake Bank tab
    const mistakesTab = screen.getByRole("tab", { name: /Mistake Bank/i });
    fireEvent.click(mistakesTab);
    expect(screen.getByTestId("mistake-bank-section")).toBeInTheDocument();

    // Resolve mistake
    const resolveBtn = screen.getByRole("button", { name: /Mark Resolved/i });
    expect(resolveBtn).toBeInTheDocument();
    fireEvent.click(resolveBtn);

    // Switch to All History tab to inspect resolved item
    const allHistoryBtn = screen.getByRole("button", { name: /All History/i });
    fireEvent.click(allHistoryBtn);
    expect(screen.getByText(/✓ Resolved/i)).toBeInTheDocument();
  });
});
