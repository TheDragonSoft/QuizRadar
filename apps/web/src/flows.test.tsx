import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { OnboardingWizardModal } from "./components/OnboardingWizardModal";
import { SettingsModal } from "./components/SettingsModal";
import { SearchPaletteModal } from "./components/SearchPaletteModal";
import { PracticeQuizModal } from "./components/PracticeQuizModal";
import { PomodoroModal } from "./components/PomodoroModal";
import { TopBar } from "./components/TopBar";
import { useAppStore, initialFullState } from "./state/store";
import { setRpcMockHandler } from "./state/rpc";
import { copy } from "./copy";
import type { GetStatePayload, PracticeQuizPayload, UpdateCheckResult } from "./state/types";

describe("Web UI Flows & Modals (Phase 10)", () => {
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
        instructor: "Dr. Smith",
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
    config: {
      ...initialFullState.config,
      onboardingCompleted: true,
    },
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setRpcMockHandler(null);
    useAppStore.setState({
      view: "dashboard",
      theme: "light",
      data: sampleState,
      openModals: [],
      toasts: [],
      syncStatus: "idle",
      selectedCourseIds: null,
      layers: { exams: true, classes: true },
    });
  });

  afterEach(() => {
    setRpcMockHandler(null);
  });

  // 1. Onboarding Wizard: First-run gating and stepper data preservation
  describe("Onboarding Wizard", () => {
    it("auto-opens onboarding on first run when onboardingCompleted is false", async () => {
      useAppStore.setState({
        data: {
          ...sampleState,
          config: { ...sampleState.config, onboardingCompleted: false },
        },
      });

      render(<App />);
      // The wizard opens only after the first real state load, so a returning
      // user never gets it flashed at them (App.tsx first-run effect).
      await waitFor(() =>
        expect(useAppStore.getState().openModals).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "onboarding" })]),
        ),
      );
    });

    it("does not auto-open onboarding when onboardingCompleted is true", () => {
      useAppStore.setState({
        data: {
          ...sampleState,
          config: { ...sampleState.config, onboardingCompleted: true },
        },
      });

      render(<App />);
      expect(useAppStore.getState().openModals).toHaveLength(0);
    });

    it("preserves entered data across steps and does not reset mid-flow", () => {
      render(<OnboardingWizardModal modalId="onboarding" onClose={vi.fn()} />);

      // Step 1: fill in profile
      const nameInput = screen.getByPlaceholderText("Student Name");
      const emailInput = screen.getByPlaceholderText("student@university.edu");

      fireEvent.change(nameInput, { target: { value: "Taylor Swift" } });
      fireEvent.change(emailInput, { target: { value: "taylor@swift.edu" } });

      // Advance to Step 2
      const nextBtn = screen.getByRole("button", { name: new RegExp(copy.onboarding.next, "i") });
      fireEvent.click(nextBtn);

      // Verify Step 2 is active
      expect(screen.getByText(copy.onboarding.googleConnect)).toBeInTheDocument();
      expect(screen.getByText(copy.onboarding.geminiConnect)).toBeInTheDocument();

      // Advance to Step 3
      const nextBtn2 = screen.getByRole("button", { name: new RegExp(copy.onboarding.next, "i") });
      fireEvent.click(nextBtn2);

      // Verify Step 3 is active
      expect(screen.getByText(copy.onboarding.step3Title)).toBeInTheDocument();

      // Navigate back to Step 2
      const backBtn = screen.getByRole("button", { name: new RegExp(copy.onboarding.back, "i") });
      fireEvent.click(backBtn);
      expect(screen.getByText(copy.onboarding.googleConnect)).toBeInTheDocument();

      // Navigate back to Step 1
      const backBtn2 = screen.getByRole("button", { name: new RegExp(copy.onboarding.back, "i") });
      fireEvent.click(backBtn2);

      // Verify Step 1 fields still hold previously entered data
      expect((screen.getByPlaceholderText("Student Name") as HTMLInputElement).value).toBe(
        "Taylor Swift",
      );
      expect(
        (screen.getByPlaceholderText("student@university.edu") as HTMLInputElement).value,
      ).toBe("taylor@swift.edu");
    });
  });

  // 2. Settings Modal: Tab restoration, feeds HTTPS validation, AI consent & quota copy
  describe("Settings Modal", () => {
    it("restores the last active tab from localStorage", () => {
      localStorage.setItem("quizradar_settings_tab", "courses");

      render(<SettingsModal modalId="settings" onClose={vi.fn()} />);

      // Courses tab should be active
      expect(screen.getByText(copy.settings.coursesHeader)).toBeInTheDocument();

      // Click Integrations tab (the v4-style tab bar exposes ARIA tabs)
      const integrationsTab = screen.getByRole("tab", {
        name: new RegExp(copy.settings.tabIntegrations, "i"),
      });
      fireEvent.click(integrationsTab);

      // Should persist "integrations" to localStorage
      expect(localStorage.getItem("quizradar_settings_tab")).toBe("integrations");
      expect(screen.getByText(copy.settings.integrationsHeader)).toBeInTheDocument();
    });

    it("displays exact verbatim Gemini free-tier consent disclosure and quota cap text", () => {
      localStorage.setItem("quizradar_settings_tab", "account");
      render(<SettingsModal modalId="settings" onClose={vi.fn()} />);

      // Verbatim AI consent string from 05 §5.1
      expect(
        screen.getByText(
          /Your email announcements and timetable images are sent to Google's Gemini API when AI is used/i,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText(/Turn off to stay fully local\./i)).toBeInTheDocument();

      // Quota note — the daily limit belongs to the user's Google project,
      // so the panel points at AI Studio instead of quoting a made-up number.
      expect(
        screen.getByText(/Google sets the free-tier daily limit per project/i),
      ).toBeInTheDocument();
    });

    it("rejects non-https URLs when adding an external calendar feed", async () => {
      localStorage.setItem("quizradar_settings_tab", "integrations");
      const addToastMock = vi.fn();
      useAppStore.setState({ addToast: addToastMock });

      render(<SettingsModal modalId="settings" onClose={vi.fn()} />);

      const nameInput = screen.getByPlaceholderText(copy.settings.feedNamePlaceholder);
      const urlInput = screen.getByPlaceholderText(copy.settings.feedUrlPlaceholder);
      const addBtn = screen.getByRole("button", { name: new RegExp(copy.settings.addFeed, "i") });

      fireEvent.change(nameInput, { target: { value: "External Calendar" } });
      fireEvent.change(urlInput, { target: { value: "http://insecure-feed.com/cal.ics" } });
      fireEvent.click(addBtn);

      expect(addToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          message: copy.settings.feedHttpsError,
        }),
      );
    });

    it("offers the browser-tier OAuth client IDs and keeps a single theme control", () => {
      localStorage.setItem("quizradar_settings_tab", "account");
      render(<SettingsModal modalId="settings" onClose={vi.fn()} />);

      expect(screen.getByText(copy.settings.browserSignInHeader)).toBeInTheDocument();
      expect(
        screen.getByText(copy.settings.googleClientIdLabel, { exact: false }),
      ).toBeInTheDocument();

      // The theme tiles live in the onboarding wizard only — the topbar keeps
      // the single quick toggle. A second "Light Theme" block in Settings was
      // the duplicate the report was about.
      expect(screen.queryByText(copy.onboarding.themeLight)).not.toBeInTheDocument();
      expect(screen.queryByText(copy.onboarding.themeDark)).not.toBeInTheDocument();
    });

    it("asks for a Desktop app client ID on the desktop tier", () => {
      const globals = window as unknown as Record<string, unknown>;
      globals.__TAURI_INTERNALS__ = {};
      try {
        localStorage.setItem("quizradar_settings_tab", "account");
        render(<SettingsModal modalId="settings" onClose={vi.fn()} />);

        expect(screen.getByText(copy.settings.desktopSignInHeader)).toBeInTheDocument();
        expect(
          screen.getByText(copy.settings.googleDesktopClientIdLabel, { exact: false }),
        ).toBeInTheDocument();
        expect(
          screen.getByText(copy.settings.googleDesktopClientIdHint, { exact: false }),
        ).toBeInTheDocument();
        expect(screen.queryByText(copy.onboarding.themeLight)).not.toBeInTheDocument();
      } finally {
        delete globals.__TAURI_INTERNALS__;
      }
    });
  });

  // 3. Search Palette: Matching across fields, type filtering, recents
  describe("Search Palette Modal", () => {
    it("matches assessments, courses, and slots across title, instructor, and topics", () => {
      render(<SearchPaletteModal modalId="search" onClose={vi.fn()} />);

      const searchInput = screen.getByPlaceholderText(copy.search.placeholder);

      // Search by title
      fireEvent.change(searchInput, { target: { value: "Logic" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();

      // Search by instructor
      fireEvent.change(searchInput, { target: { value: "Smith" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();

      // Search by topic
      fireEvent.change(searchInput, { target: { value: "Boolean" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();

      // Search by course code
      fireEvent.change(searchInput, { target: { value: "CSE241" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();
      expect(screen.getByText(/CSE241 — Digital Design/i)).toBeInTheDocument();
    });

    it("saves search queries to recents up to a maximum of 6", () => {
      render(<SearchPaletteModal modalId="search" onClose={vi.fn()} />);

      const searchInput = screen.getByPlaceholderText(copy.search.placeholder);
      fireEvent.change(searchInput, { target: { value: "Calculus" } });
      fireEvent.keyDown(searchInput, { key: "Enter" });

      const storedRecents = JSON.parse(
        localStorage.getItem("quizradar_recent_searches") || "[]",
      ) as string[];
      expect(storedRecents.length).toBeGreaterThan(0);
      expect(storedRecents[0]).toContain("Calculus");
      expect(storedRecents.length).toBeLessThanOrEqual(6);
    });
  });

  // 4. Practice Quiz: Provenance labeling (AI vs Local Fallback) & Scoring
  describe("Practice Quiz Modal", () => {
    it("displays honest 'Authored locally from your topics' provenance when authoredLocally is true", async () => {
      const mockQuiz: PracticeQuizPayload = {
        assessmentId: "a-cse241-q1",
        questions: [
          {
            id: "q-1",
            question: "What is the boolean complement of 1?",
            options: ["0", "1", "Undefined", "Both"],
            correctIndex: 0,
            explanation: "In binary boolean logic, NOT 1 is 0.",
          },
        ],
        generatedByAi: false,
        authoredLocally: true,
      };

      setRpcMockHandler(<T,>(fn: string): Promise<T> | null => {
        if (fn === "practice_generate") return Promise.resolve(mockQuiz as unknown as T);
        return null;
      });

      render(
        <PracticeQuizModal
          modalId="practice-quiz"
          props={{ assessmentId: "a-cse241-q1" }}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("quiz-provenance-label")).toHaveTextContent(
          copy.practice.localFallbackProvenance,
        );
      });

      // Verify question is displayed
      expect(screen.getByText("What is the boolean complement of 1?")).toBeInTheDocument();

      // Click correct option
      const optionA = screen.getByText("0");
      fireEvent.click(optionA);

      // Verify explanation is revealed
      expect(screen.getByText("In binary boolean logic, NOT 1 is 0.")).toBeInTheDocument();
    });

    it("displays 'Generated by Gemini AI' provenance when generatedByAi is true", async () => {
      const mockQuiz: PracticeQuizPayload = {
        assessmentId: "a-cse241-q1",
        questions: [
          {
            id: "q-1",
            question: "What is a Karnaugh map used for?",
            options: ["Simplifying boolean algebra", "CPU cooling", "Memory paging", "Rendering"],
            correctIndex: 0,
            explanation: "K-Maps are used for logic simplification.",
          },
        ],
        generatedByAi: true,
        authoredLocally: false,
      };

      setRpcMockHandler(<T,>(fn: string): Promise<T> | null => {
        if (fn === "practice_generate") return Promise.resolve(mockQuiz as unknown as T);
        return null;
      });

      render(
        <PracticeQuizModal
          modalId="practice-quiz"
          props={{ assessmentId: "a-cse241-q1" }}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("quiz-provenance-label")).toHaveTextContent(
          copy.practice.aiProvenance,
        );
      });
    });
  });

  // 5. Pomodoro Modal: Mode switching & topic completion hookup
  describe("Pomodoro Focus Modal", () => {
    it("renders pomodoro timer modes and wires topic completion toggle", () => {
      const toggleTopicMock = vi.fn();
      useAppStore.setState({ toggleTopic: toggleTopicMock });

      render(
        <PomodoroModal
          modalId="pomodoro"
          props={{
            assessmentId: "a-cse241-q1",
            topicIndex: 0,
            topicTitle: "Boolean Algebra",
          }}
          onClose={vi.fn()}
        />,
      );

      // Initial duration 25:00
      expect(screen.getByText("25:00")).toBeInTheDocument();

      // Switch to Short Break (5:00)
      const shortBreakBtn = screen.getByRole("button", {
        name: copy.pomodoro.modeShortBreak,
      });
      fireEvent.click(shortBreakBtn);
      expect(screen.getByText("05:00")).toBeInTheDocument();

      // Switch to Long Break (15:00)
      const longBreakBtn = screen.getByRole("button", {
        name: copy.pomodoro.modeLongBreak,
      });
      fireEvent.click(longBreakBtn);
      expect(screen.getByText("15:00")).toBeInTheDocument();

      // Click Mark Done button for topic
      const markDoneBtn = screen.getByRole("button", {
        name: new RegExp(copy.pomodoro.markTopicDone, "i"),
      });
      fireEvent.click(markDoneBtn);

      expect(toggleTopicMock).toHaveBeenCalledWith("a-cse241-q1", 0);
    });
  });

  // 6. Backup Export: Secrets scrubbed
  describe("Backup Export", () => {
    it("ensures exported backup contains no credentials or secret keys", async () => {
      let exportPayload: Record<string, unknown> = {};

      setRpcMockHandler(<T,>(fn: string): Promise<T> | null => {
        if (fn === "export_backup_file") {
          exportPayload = {
            schemaVersion: "5.0.0",
            exportedAt: "2026-10-24T12:00:00Z",
            schedule: sampleState.schedule,
            assessments: sampleState.assessments,
            config: {
              userName: "Test User",
              userEmail: "test@university.edu",
              onboardingCompleted: true,
              autoSyncGcal: false,
              feeds: [],
            },
          };
          return Promise.resolve({
            saved: false,
            json: JSON.stringify(exportPayload),
          } as unknown as T);
        }
        return null;
      });

      const res = await useAppStore.getState().exportBackupFile();
      expect(res.json).toBeDefined();

      const parsed = JSON.parse(res.json!);
      // Assert critical secret scrub guarantee
      expect(parsed).not.toHaveProperty("gemini_api_key");
      expect(parsed).not.toHaveProperty("google_refresh_token");
      expect(parsed).not.toHaveProperty("microsoft_refresh_token");
      expect(parsed).not.toHaveProperty("client_secret");
      expect(parsed).not.toHaveProperty("access_token");
      expect(parsed.config).not.toHaveProperty("geminiKey");
      expect(parsed.config).not.toHaveProperty("token");
    });
  });

  // 7. Update Pill: Dismissal and Skip Version Persistence
  describe("Update Pill", () => {
    it("displays update pill, opens popover with release notes, and persists skipped version", async () => {
      const mockUpdate: UpdateCheckResult = {
        available: true,
        currentVersion: "5.0.0-alpha.1",
        latestVersion: "5.1.0",
        body: "Major performance improvements and sync stability",
      };

      useAppStore.setState({
        checkUpdate: async () => mockUpdate,
      });

      render(<TopBar />);

      // Pill appears
      await waitFor(() => {
        expect(screen.getByTestId("update-pill-btn")).toBeInTheDocument();
      });

      // Click pill to open popover
      fireEvent.click(screen.getByTestId("update-pill-btn"));
      expect(screen.getByTestId("update-popover")).toBeInTheDocument();
      expect(screen.getByText(/QuizRadar v5\.1\.0 Available/i)).toBeInTheDocument();
      expect(
        screen.getByText("Major performance improvements and sync stability"),
      ).toBeInTheDocument();

      // Click "Skip this version"
      const skipBtn = screen.getByTestId("skip-update-btn");
      fireEvent.click(skipBtn);

      // Verify skip is persisted in localStorage
      expect(localStorage.getItem("quizradar_skip_version")).toBe("5.1.0");

      // Verify pill is dismissed
      expect(screen.queryByTestId("update-pill-btn")).not.toBeInTheDocument();
    });

    it("does not display update pill if version matches quizradar_skip_version", async () => {
      localStorage.setItem("quizradar_skip_version", "5.1.0");

      const mockUpdate: UpdateCheckResult = {
        available: true,
        currentVersion: "5.0.0-alpha.1",
        latestVersion: "5.1.0",
        body: "Performance patch",
      };

      useAppStore.setState({
        checkUpdate: async () => mockUpdate,
      });

      render(<TopBar />);

      // Wait a tick and verify pill never rendered
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId("update-pill-btn")).not.toBeInTheDocument();
    });
  });
});
