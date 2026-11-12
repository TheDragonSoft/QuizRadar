import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { useAppStore, initialFullState } from "../state/store";
import { getLocalDateString } from "../state/watchdog";
import App from "../App";
import { DashboardView } from "./DashboardView";
import { FocusView } from "./FocusView";
import type { GetStatePayload, Flashcard } from "../state/types";

describe("Adversarial Verification — Milestone 2: UI, Shortcuts & Density", () => {
  const mockState: GetStatePayload = {
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
        topics: ["Boolean Algebra", "Karnaugh Maps"],
        warnings: [],
        source: "Syllabus",
        achievedScore: 18,
        maxScore: 20,
        weightagePercent: 15,
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
            { key: "t-1", title: "Karnaugh Maps", topicIndex: 1, completed: false },
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
        committedHours: 2,
        availableHours: 14,
        requiredHours: 3,
        cushionHours: 11,
        deficitHours: null,
        isDeficit: false,
      },
      days: [
        {
          dayOffset: 0,
          date: "2026-11-06",
          displayDay: "Friday",
          isToday: true,
          tasks: [],
        },
      ],
      readinessCards: [],
    },
  };

  beforeEach(() => {
    useAppStore.setState({
      ...initialFullState,
      data: mockState,
      view: "dashboard",
      pomodoroIsRunning: false,
      pomodoroSecondsLeft: 25 * 60,
      pomodoroMode: "pomodoro",
      openModals: [],
      flashcards: [],
      mistakeBank: [],
      selectedCalendarDate: "2026-01-01",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: KEYBOARD SHORTCUTS IN APP.TSX
  // =========================================================================
  describe("1. Keyboard Shortcuts (App.tsx)", () => {
    it("executes 1, 2, 3, 4, T, N, and Space when body has focus", () => {
      render(<App />);
      document.body.focus();

      // Test '2' -> Tasks
      fireEvent.keyDown(window, { key: "2" });
      expect(useAppStore.getState().view).toBe("tasks");

      // Test '3' -> Calendar
      fireEvent.keyDown(window, { key: "3" });
      expect(useAppStore.getState().view).toBe("calendar");

      // Test '4' -> Focus
      fireEvent.keyDown(window, { key: "4" });
      expect(useAppStore.getState().view).toBe("focus");

      // Test '1' -> Dashboard
      fireEvent.keyDown(window, { key: "1" });
      expect(useAppStore.getState().view).toBe("dashboard");

      // Test 't' and 'T' -> jumpToToday()
      useAppStore.setState({ selectedCalendarDate: "2020-01-01" });
      fireEvent.keyDown(window, { key: "t" });
      const todayIso = getLocalDateString();
      expect(useAppStore.getState().selectedCalendarDate).toBe(todayIso);

      useAppStore.setState({ selectedCalendarDate: "2020-01-01" });
      fireEvent.keyDown(window, { key: "T" });
      expect(useAppStore.getState().selectedCalendarDate).toBe(todayIso);

      // Test 'n' and 'N' -> openEventModal() (opens 'create-edit-event')
      expect(useAppStore.getState().openModals.some((m) => m.id === "create-edit-event")).toBe(
        false,
      );
      fireEvent.keyDown(window, { key: "n" });
      expect(useAppStore.getState().openModals.some((m) => m.id === "create-edit-event")).toBe(
        true,
      );

      // Close modal to test uppercase 'N'
      useAppStore.setState({ openModals: [] });
      fireEvent.keyDown(window, { key: "N" });
      expect(useAppStore.getState().openModals.some((m) => m.id === "create-edit-event")).toBe(
        true,
      );
      useAppStore.setState({ openModals: [] });

      // Test ' ' and 'Space' code -> togglePomodoro()
      expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
      fireEvent.keyDown(window, { key: " ", code: "Space" });
      expect(useAppStore.getState().pomodoroIsRunning).toBe(true);

      fireEvent.keyDown(window, { key: " ", code: "Space" });
      expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
    });

    it("STRICTLY SUPPRESSES all shortcuts when typing inside <input>, <textarea>, <select>, and contentEditable elements", () => {
      render(<App />);

      const textInput = document.createElement("input");
      textInput.type = "text";
      const numberInput = document.createElement("input");
      numberInput.type = "number";
      const textarea = document.createElement("textarea");
      const select = document.createElement("select");
      const editableDiv = document.createElement("div");
      editableDiv.contentEditable = "true";
      const editableChild = document.createElement("span");
      editableDiv.appendChild(editableChild);

      const elements = [textInput, numberInput, textarea, select, editableDiv];
      elements.forEach((el) => document.body.appendChild(el));
      editableDiv.appendChild(editableChild);

      try {
        elements.forEach((element) => {
          element.focus();
          useAppStore.setState({
            view: "dashboard",
            pomodoroIsRunning: false,
            openModals: [],
            selectedCalendarDate: "2026-01-01",
          });

          // Test '2' -> should NOT switch view to tasks
          fireEvent.keyDown(element, { key: "2" });
          expect(useAppStore.getState().view).toBe("dashboard");

          // Test '3' -> should NOT switch view to calendar
          fireEvent.keyDown(element, { key: "3" });
          expect(useAppStore.getState().view).toBe("dashboard");

          // Test '4' -> should NOT switch view to focus
          fireEvent.keyDown(element, { key: "4" });
          expect(useAppStore.getState().view).toBe("dashboard");

          // Test 't' and 'T' -> should NOT change calendar date
          fireEvent.keyDown(element, { key: "t" });
          expect(useAppStore.getState().selectedCalendarDate).toBe("2026-01-01");
          fireEvent.keyDown(element, { key: "T" });
          expect(useAppStore.getState().selectedCalendarDate).toBe("2026-01-01");

          // Test 'n' and 'N' -> should NOT open event modal
          fireEvent.keyDown(element, { key: "n" });
          expect(useAppStore.getState().openModals.length).toBe(0);
          fireEvent.keyDown(element, { key: "N" });
          expect(useAppStore.getState().openModals.length).toBe(0);

          // Test ' ' and code 'Space' -> should NOT toggle pomodoro
          fireEvent.keyDown(element, { key: " ", code: "Space" });
          expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
        });
      } finally {
        elements.forEach((el) => {
          if (el.parentNode) el.parentNode.removeChild(el);
        });
      }
    });

    it("ignores shortcuts when modifier keys (Ctrl, Alt, Meta) are pressed", () => {
      render(<App />);
      useAppStore.setState({
        view: "dashboard",
        pomodoroIsRunning: false,
        openModals: [],
      });

      // Ctrl+2 should NOT switch to tasks (browser tab switching safety)
      fireEvent.keyDown(window, { key: "2", ctrlKey: true });
      expect(useAppStore.getState().view).toBe("dashboard");

      // Alt+3 should NOT switch to calendar
      fireEvent.keyDown(window, { key: "3", altKey: true });
      expect(useAppStore.getState().view).toBe("dashboard");

      // Meta+4 should NOT switch to focus
      fireEvent.keyDown(window, { key: "4", metaKey: true });
      expect(useAppStore.getState().view).toBe("dashboard");

      // Ctrl+Space should NOT toggle Pomodoro
      fireEvent.keyDown(window, { key: " ", code: "Space", ctrlKey: true });
      expect(useAppStore.getState().pomodoroIsRunning).toBe(false);

      // Alt+T should NOT jump to today
      useAppStore.setState({ selectedCalendarDate: "2026-01-01" });
      fireEvent.keyDown(window, { key: "t", altKey: true });
      expect(useAppStore.getState().selectedCalendarDate).toBe("2026-01-01");
    });

    it("suppresses view switching and event modal shortcuts when another modal is open", () => {
      render(<App />);
      useAppStore.setState({
        view: "dashboard",
        openModals: [{ id: "add-course" }],
      });

      // Pressing '2' while modal is open must NOT switch the background view
      fireEvent.keyDown(window, { key: "2" });
      expect(useAppStore.getState().view).toBe("dashboard");

      // Pressing 'n' while modal is open must NOT stack another create-edit-event modal
      fireEvent.keyDown(window, { key: "n" });
      expect(useAppStore.getState().openModals.length).toBe(1);
      expect(useAppStore.getState().openModals[0].id).toBe("add-course");
    });
  });

  // =========================================================================
  // SECTION 2: WIDESCREEN DENSITY (DASHBOARDVIEW.TSX)
  // =========================================================================
  describe("2. Widescreen Density (DashboardView.tsx)", () => {
    it("renders side-by-side layout at >=1200px with CalendarGrid and DailyStudyRoadmap simultaneously", () => {
      render(<DashboardView forceWidescreen={true} />);

      // Verify widescreen split container
      const splitSection = screen.getByTestId("dashboard-widescreen-split");
      expect(splitSection).toBeInTheDocument();

      // Left pane (~58% / col-span-7) contains CalendarGrid
      const leftPane = screen.getByTestId("dashboard-widescreen-left-pane");
      expect(leftPane).toBeInTheDocument();
      expect(leftPane).toHaveClass("col-span-7");
      const calendarGrid = within(leftPane).getByTestId("calendar-grid");
      expect(calendarGrid).toBeInTheDocument();

      // Right pane (~42% / col-span-5) contains NextUpHero and DailyStudyRoadmap
      const rightPane = screen.getByTestId("dashboard-widescreen-right-pane");
      expect(rightPane).toBeInTheDocument();
      expect(rightPane).toHaveClass("col-span-5");
      expect(within(rightPane).getByTestId("dashboard-next-up-hero")).toBeInTheDocument();
      expect(within(rightPane).getByTestId("daily-study-roadmap")).toBeInTheDocument();

      // Standard <1200px single study panel must NOT be rendered
      expect(screen.queryByTestId("dashboard-study-panel")).not.toBeInTheDocument();
    });

    it("renders standard single-column study panel at <1200px viewport", () => {
      render(<DashboardView forceWidescreen={false} />);

      // Split view must NOT be rendered
      expect(screen.queryByTestId("dashboard-widescreen-split")).not.toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-widescreen-left-pane")).not.toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-widescreen-right-pane")).not.toBeInTheDocument();

      // Standard study panel must be rendered
      const studyPanel = screen.getByTestId("dashboard-study-panel");
      expect(studyPanel).toBeInTheDocument();
    });

    it("dynamically reacts to media query resize events across 1200px threshold", () => {
      let listener: ((e: MediaQueryListEvent) => void) | null = null;
      let matchesState = false;

      // Mock window.matchMedia
      window.matchMedia = vi.fn().mockImplementation((query: string) => {
        if (query === "(min-width: 1200px)") {
          return {
            matches: matchesState,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) => {
              listener = cb;
            }),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          };
        }
        return {
          matches: false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
      });

      // Initially narrow (<1200px)
      matchesState = false;
      render(<DashboardView />);
      expect(screen.getByTestId("dashboard-study-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-widescreen-split")).not.toBeInTheDocument();

      // Simulate viewport expanding to >=1200px
      act(() => {
        if (listener) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });

      // Split view should now appear
      expect(screen.getByTestId("dashboard-widescreen-split")).toBeInTheDocument();
      expect(screen.getByTestId("dashboard-widescreen-left-pane")).toBeInTheDocument();
      expect(screen.getByTestId("dashboard-widescreen-right-pane")).toBeInTheDocument();
      expect(screen.queryByTestId("dashboard-study-panel")).not.toBeInTheDocument();

      // Simulate collapsing back below 1200px
      act(() => {
        if (listener) {
          listener({ matches: false } as MediaQueryListEvent);
        }
      });

      expect(screen.queryByTestId("dashboard-widescreen-split")).not.toBeInTheDocument();
      expect(screen.getByTestId("dashboard-study-panel")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // SECTION 3: FLASHCARDS & MISTAKE BANK (FOCUSVIEW.TSX)
  // =========================================================================
  describe("3. Flashcards & Mistake Bank (FocusView.tsx)", () => {
    it("handles card flip state between Side A and Side B", () => {
      const initialCards: Flashcard[] = [
        {
          id: "card-1",
          courseId: "CSE241",
          assessmentId: "a-cse241-q1",
          topic: "Boolean Algebra",
          front: "What is De Morgan's Law for AND?",
          back: "!(A & B) = !A | !B",
          boxLevel: 1,
        },
      ];
      useAppStore.setState({ flashcards: initialCards, activeModalAssessmentId: null });

      render(<FocusView />);

      // Switch to Flashcards tab
      fireEvent.click(screen.getByRole("tab", { name: /Flashcards/i }));
      expect(screen.getByTestId("flashcards-section")).toBeInTheDocument();

      // Initially front is displayed
      expect(screen.getByText("Question / Concept")).toBeInTheDocument();
      expect(screen.getByText("Side A")).toBeInTheDocument();
      expect(screen.getByText("What is De Morgan's Law for AND?")).toBeInTheDocument();
      expect(screen.queryByText("Side B")).not.toBeInTheDocument();
      expect(screen.queryByText("!(A & B) = !A | !B")).not.toBeInTheDocument();

      // Click card to flip
      const cardButton = screen.getByRole("button", { name: /Flip flashcard/i });
      fireEvent.click(cardButton);

      // Now back is displayed
      expect(screen.getByText("Answer / Explanation")).toBeInTheDocument();
      expect(screen.getByText("Side B")).toBeInTheDocument();
      expect(screen.getByText("!(A & B) = !A | !B")).toBeInTheDocument();

      // Flip again by clicking
      fireEvent.click(cardButton);
      expect(screen.getByText("Side A")).toBeInTheDocument();

      // Flip via keyboard (Enter / Space)
      fireEvent.keyDown(cardButton, { key: "Enter" });
      expect(screen.getByText("Side B")).toBeInTheDocument();
    });

    it("implements Leitner progression (advances box on Mastered, resets to 1 on Needs Review, caps at 5)", () => {
      const initialCards: Flashcard[] = [
        {
          id: "card-test",
          courseId: "CSE241",
          assessmentId: "a-cse241-q1",
          topic: "Boolean Algebra",
          front: "Front of card",
          back: "Back of card",
          boxLevel: 1,
          reviewCount: 0,
        },
      ];
      useAppStore.setState({ flashcards: initialCards, activeModalAssessmentId: null });

      render(<FocusView />);
      fireEvent.click(screen.getByRole("tab", { name: /Flashcards/i }));

      // Flip card to reveal Leitner rating controls
      fireEvent.click(screen.getByRole("button", { name: /Flip flashcard/i }));

      // Click 'Mastered (Advance Box)'
      const masteredBtn = screen.getByRole("button", { name: /Mastered \(Advance Box\)/i });
      fireEvent.click(masteredBtn);

      // Verify card in store advanced from Box 1 to Box 2
      let storedCard = useAppStore.getState().flashcards.find((c) => c.id === "card-test");
      expect(storedCard?.boxLevel).toBe(2);
      expect(storedCard?.reviewCount).toBe(1);

      // Test Box 5 ceiling: manually set card to box 5 and master it
      useAppStore.setState({
        flashcards: [{ ...storedCard!, boxLevel: 5 }],
      });
      fireEvent.click(screen.getByRole("button", { name: /Flip flashcard/i }));
      fireEvent.click(screen.getByRole("button", { name: /Mastered \(Advance Box\)/i }));

      storedCard = useAppStore.getState().flashcards.find((c) => c.id === "card-test");
      expect(storedCard?.boxLevel).toBe(5); // Must remain capped at 5

      // Test Reset: card at Box 5 marked 'Needs Review' resets directly to Box 1
      fireEvent.click(screen.getByRole("button", { name: /Flip flashcard/i }));
      const needsReviewBtn = screen.getByRole("button", { name: /Needs Review \(Box 1\)/i });
      fireEvent.click(needsReviewBtn);

      storedCard = useAppStore.getState().flashcards.find((c) => c.id === "card-test");
      expect(storedCard?.boxLevel).toBe(1); // Reset to 1
    });

    it("records mistakes into Mistake Bank when flashcard is marked 'Needs Review', and supports mark resolved", () => {
      const initialCards: Flashcard[] = [
        {
          id: "card-mistake-test",
          courseId: "CSE241",
          assessmentId: "a-cse241-q1",
          topic: "Boolean Logic",
          front: "What is an XOR gate output for inputs (1, 1)?",
          back: "0 (false)",
          boxLevel: 2,
        },
      ];
      useAppStore.setState({ flashcards: initialCards, mistakeBank: [] });

      render(<FocusView />);
      fireEvent.click(screen.getByRole("tab", { name: /Flashcards/i }));

      // Flip card
      fireEvent.click(screen.getByRole("button", { name: /Flip flashcard/i }));

      // Mark Needs Review
      fireEvent.click(screen.getByRole("button", { name: /Needs Review \(Box 1\)/i }));

      // Verify mistake logged in store
      const mistakes = useAppStore.getState().mistakeBank;
      expect(mistakes.length).toBe(1);
      expect(mistakes[0].questionText).toBe("What is an XOR gate output for inputs (1, 1)?");
      expect(mistakes[0].resolved).toBe(false);
      expect(mistakes[0].courseId).toBe("CSE241");

      // Switch to Mistake Bank tab
      fireEvent.click(screen.getByRole("tab", { name: /Mistake Bank/i }));
      expect(screen.getByTestId("mistake-bank-section")).toBeInTheDocument();

      // Verify unresolved item is rendered
      expect(screen.getByText("⚠️ Needs Review")).toBeInTheDocument();
      expect(screen.getByText("What is an XOR gate output for inputs (1, 1)?")).toBeInTheDocument();
      expect(screen.getAllByText("0 (false)").length).toBeGreaterThan(0);

      // Click 'Mark Resolved'
      const resolveBtn = screen.getByRole("button", { name: /Mark Resolved/i });
      expect(resolveBtn).toBeInTheDocument();
      fireEvent.click(resolveBtn);

      // Verify in store
      expect(useAppStore.getState().mistakeBank[0].resolved).toBe(true);

      // Unresolved view should now show 'No Mistakes Found'
      expect(screen.getByText("No Mistakes Found")).toBeInTheDocument();

      // Switch filter to 'All History'
      fireEvent.click(screen.getByRole("button", { name: /All History/i }));
      expect(screen.getByText("✓ Resolved")).toBeInTheDocument();
      expect(screen.getByText("What is an XOR gate output for inputs (1, 1)?")).toBeInTheDocument();
    });
  });
});
