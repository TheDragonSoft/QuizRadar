import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { OnboardingWizardModal } from "./components/OnboardingWizardModal";
import { SettingsView } from "./views/SettingsView";
import { SearchDropdown } from "./components/SearchDropdown";
import { AccountProfileModal } from "./components/AccountProfileModal";
import { PracticeQuizModal } from "./components/PracticeQuizModal";
import { PomodoroModal } from "./components/PomodoroModal";
import { TopBar } from "./components/TopBar";
import { useAppStore, initialFullState } from "./state/store";
import { setRpcMockHandler } from "./state/rpc";
import { setupMockIndexedDb } from "./test/mockIndexedDb";
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

    it("persists the chosen academic rhythm instead of discarding it", async () => {
      // `01` §4.1: the track/rhythm chips are PERSISTED. The answer used to
      // live in local component state only, so finishing the wizard threw it
      // away.
      const calls: { fn: string; args?: Record<string, unknown> }[] = [];
      setRpcMockHandler(async <T,>(fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "update_config") return sampleState as unknown as T;
        if (fn === "run_sync") {
          return {
            success: true,
            totalNew: 0,
            totalUpdated: 0,
            notes: [],
          } as unknown as T;
        }
        if (fn === "get_state") return sampleState as unknown as T;
        return null as unknown as T;
      });

      render(<OnboardingWizardModal modalId="onboarding" onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: new RegExp(copy.onboarding.trackMed) }));

      const nextBtn = screen.getByRole("button", { name: new RegExp(copy.onboarding.next, "i") });
      fireEvent.click(nextBtn);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(copy.onboarding.next, "i") }));
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(copy.onboarding.finish, "i") }),
      );

      await waitFor(() => {
        const update = calls.find((call) => call.fn === "update_config");
        expect(update).toBeTruthy();
        const payload = (update?.args?.update ?? {}) as Record<string, unknown>;
        expect(payload.academicTrack).toBe("med");
        expect(payload.onboardingCompleted).toBe(true);
      });
    });

    it("links the Gemini key card to AI Studio key creation", () => {
      render(<OnboardingWizardModal modalId="onboarding" onClose={vi.fn()} />);

      // Advance to Step 2 (Connect Sources), where the Gemini key card lives
      fireEvent.click(screen.getByRole("button", { name: new RegExp(copy.onboarding.next, "i") }));
      expect(screen.getByText(copy.onboarding.geminiConnect)).toBeInTheDocument();

      const studioLink = screen.getByRole("link", { name: copy.ai.getKeyCta });
      expect(studioLink).toHaveAttribute("href", copy.ai.getKeyUrl);
      expect(studioLink).toHaveAttribute("target", "_blank");
      expect(studioLink).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  // 2. Settings Page: one scrollable surface (the old tabbed modal is gone),
  //    feeds HTTPS validation, AI consent & quota copy
  describe("Settings Page", () => {
    it("renders all three sections on one anchored page", () => {
      render(<SettingsView />);

      // Every section header is present at once — no tab switching, no
      // localStorage tab restoration to lose state.
      expect(screen.getByText(copy.settings.coursesHeader)).toBeInTheDocument();
      expect(screen.getByText(copy.settings.integrationsHeader)).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
      expect(document.getElementById("settings-section-integrations")).not.toBeNull();
    });

    it("displays exact verbatim Gemini free-tier consent disclosure and quota cap text", () => {
      render(<SettingsView />);

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

      // …and offers the key-creation page directly — same link as onboarding.
      const studioLink = screen.getByRole("link", { name: copy.ai.getKeyCta });
      expect(studioLink).toHaveAttribute("href", copy.ai.getKeyUrl);
      expect(studioLink).toHaveAttribute("target", "_blank");
      expect(studioLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("rejects non-https URLs when adding an external calendar feed", async () => {
      const addToastMock = vi.fn();
      useAppStore.setState({ addToast: addToastMock });

      render(<SettingsView />);

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

    it("keeps sign-in simple on the browser tier — client IDs are baked in, not user-entered", () => {
      render(<SettingsView />);

      // The OAuth client-ID entry card is gone: both tiers ship working
      // clients, so the user only ever presses "Sign in".
      expect(screen.queryByText(copy.settings.browserSignInHeader)).not.toBeInTheDocument();
      expect(screen.queryByText(copy.settings.googleClientIdLabel)).not.toBeInTheDocument();
      expect(screen.queryByText(copy.settings.desktopSignInHeader)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();

      // The theme tiles live in the onboarding wizard only — the topbar keeps
      // the single quick toggle. A second "Light Theme" block in Settings was
      // the duplicate the report was about.
      expect(screen.queryByText(copy.onboarding.themeLight)).not.toBeInTheDocument();
      expect(screen.queryByText(copy.onboarding.themeDark)).not.toBeInTheDocument();
    });

    it("signs in with the bundled clients on the desktop tier — no client ID form", () => {
      const globals = window as unknown as Record<string, unknown>;
      globals.__TAURI_INTERNALS__ = {};
      try {
        render(<SettingsView />);

        expect(screen.queryByText(copy.settings.desktopSignInHeader)).not.toBeInTheDocument();
        expect(
          screen.queryByText(copy.settings.googleDesktopClientIdLabel),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Sign in with Google/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Sign in with Microsoft/i })).toBeInTheDocument();
        expect(screen.queryByText(copy.onboarding.themeLight)).not.toBeInTheDocument();
      } finally {
        delete globals.__TAURI_INTERNALS__;
      }
    });

    it("discloses what the academic rhythm preset actually does", () => {
      render(<SettingsView />);

      // The preset is wired into the planner now — the page must say so.
      expect(screen.getByText(/Sets how many days before each exam/i)).toBeInTheDocument();
      expect(screen.getByText(copy.onboarding.trackEffect)).toBeInTheDocument();
    });
  });

  // 3. Top-bar Search: Matching across fields, type filtering, recents
  describe("Top-bar Search Dropdown", () => {
    it("matches assessments, courses, and slots across title, instructor, and topics", () => {
      render(<SearchDropdown />);

      const searchInput = screen.getByPlaceholderText(copy.topBar.searchPlaceholder);
      fireEvent.focus(searchInput);

      // Search by title
      fireEvent.change(searchInput, { target: { value: "Logic" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();

      // Search by instructor
      fireEvent.change(searchInput, { target: { value: "Smith" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();

      // Search by topic
      fireEvent.change(searchInput, { target: { value: "Boolean" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();

      // Search by course code still matches, but the result shows the NAME
      // (phase-19: raw id slugs are never rendered as labels).
      fireEvent.change(searchInput, { target: { value: "CSE241" } });
      expect(screen.getByText("Quiz 1: Logic Gates")).toBeInTheDocument();
      expect(screen.getByText("Digital Design")).toBeInTheDocument();
      expect(screen.queryByText(/CSE241 —/)).not.toBeInTheDocument();
    });

    it("navigates results with ArrowUp/ArrowDown and selects the highlighted row on Enter", () => {
      render(<SearchDropdown />);
      const searchInput = screen.getByPlaceholderText(copy.topBar.searchPlaceholder);
      fireEvent.focus(searchInput);

      fireEvent.change(searchInput, { target: { value: "Digital" } });
      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(1);

      // ArrowDown moves the highlight; aria-activedescendant follows.
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      expect(searchInput).toHaveAttribute("aria-activedescendant", "search-result-1");
      expect(options[1]).toHaveAttribute("aria-selected", "true");

      // ArrowUp clamps at the top.
      fireEvent.keyDown(searchInput, { key: "ArrowUp" });
      fireEvent.keyDown(searchInput, { key: "ArrowUp" });
      expect(searchInput).toHaveAttribute("aria-activedescendant", "search-result-0");

      // Enter on the highlighted row opens it (assessment detail) and the
      // attached panel closes.
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      fireEvent.keyDown(searchInput, { key: "Enter" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(searchInput).toHaveAttribute("aria-expanded", "false");
    });

    it("saves search queries to recents up to a maximum of 6", () => {
      render(<SearchDropdown />);

      const searchInput = screen.getByPlaceholderText(copy.topBar.searchPlaceholder);
      fireEvent.focus(searchInput);
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

  // 3b. Account profile: tier-honest storage copy + confirmed sign-out (phase-19)
  describe("Account Profile Modal", () => {
    it("says tokens stay in memory on the web tier (never claims the OS keyring)", () => {
      const globals = window as unknown as Record<string, unknown>;
      delete globals.__TAURI_INTERNALS__;
      render(<AccountProfileModal modalId="account-profile" onClose={vi.fn()} />);
      expect(screen.getByText(copy.accountProfile.storageMemory)).toBeInTheDocument();
      expect(screen.queryByText(copy.accountProfile.storageKeyring)).not.toBeInTheDocument();
    });

    it("claims the OS keyring only on the desktop tier", () => {
      const globals = window as unknown as Record<string, unknown>;
      globals.__TAURI_INTERNALS__ = {};
      try {
        render(<AccountProfileModal modalId="account-profile" onClose={vi.fn()} />);
        expect(screen.getByText(copy.accountProfile.storageKeyring)).toBeInTheDocument();
      } finally {
        delete globals.__TAURI_INTERNALS__;
      }
    });

    it("routes sign-out through the app-confirm modal instead of wiping tokens on one click", () => {
      const googleLogoutMock = vi.fn();
      const loggedIn = JSON.parse(JSON.stringify(sampleState)) as GetStatePayload;
      loggedIn.auth = {
        ...loggedIn.auth,
        authenticated: true,
        email: "ada.kowalska@university.example.edu",
        name: "Ada Kowalska",
      };
      useAppStore.setState({
        data: loggedIn,
        googleLogout: googleLogoutMock,
        openModals: [],
      });

      render(<AccountProfileModal modalId="account-profile" onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: copy.accountProfile.signOutGoogle }));

      // The destructive action is NOT executed yet — a confirm modal is stacked.
      expect(googleLogoutMock).not.toHaveBeenCalled();
      const modals = useAppStore.getState().openModals;
      expect(modals.some((m) => m.id === "app-confirm")).toBe(true);
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
      // exportBackupFile now collects the webview's study collections
      // (browser IndexedDB) for the desktop command's study payload — this
      // test env needs a mock IDB or the honest loud failure ("cannot read
      // study data") fires instead of the export.
      const teardownIdb = setupMockIndexedDb();
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
      teardownIdb();
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
