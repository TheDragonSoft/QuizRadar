import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAppStore, POMODORO_DURATIONS, __resetStudyMigrationForTests } from "./store";
import { rpc } from "./rpc";
import { putFlashcardRecord, idbClear } from "../pwadapters/idbStore";
import { setupMockIndexedDb } from "../test/mockIndexedDb";
import {
  FLASHCARDS_STORAGE_KEY,
  QUIZ_HISTORY_STORAGE_KEY,
  MISTAKES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  PREFERRED_DARK_THEME_STORAGE_KEY,
  PREFERRED_LIGHT_THEME_STORAGE_KEY,
  resetStorageFailureDedup,
} from "./storage";
import { loadStoredStudyStats } from "../lib/studyStats";
import { initialFullState } from "./initialState";
import type { Assessment, Flashcard, GetStatePayload } from "./types";

vi.mock("./rpc", () => ({
  rpc: vi.fn(async () => initialFullState),
  // The study bridge reads the live environment per call; the store tests
  // run the browser tier (IDB backends) unless a case opts into Tauri.
  isTauriEnvironment: vi.fn(() => false),
}));

// Only `putFlashcardRecord` and `idbClear` are mocked; every other IDB helper
// keeps its real (mock-IndexedDB-backed) implementation so the migration and
// reset tests exercise the real storage paths.
vi.mock("../pwadapters/idbStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pwadapters/idbStore")>();
  return {
    ...actual,
    putFlashcardRecord: vi.fn(actual.putFlashcardRecord),
    idbClear: vi.fn(actual.idbClear),
  };
});

const card = (overrides: Partial<Flashcard> = {}): Flashcard => ({
  id: "card-1",
  front: "front",
  back: "back",
  boxLevel: 1,
  ...overrides,
});

describe("app store view switching", () => {
  it("starts on the dashboard view and switches honestly", () => {
    useAppStore.setState({ view: "dashboard" });
    expect(useAppStore.getState().view).toBe("dashboard");
    useAppStore.getState().setView("calendar");
    expect(useAppStore.getState().view).toBe("calendar");
  });
});

describe("durable study collections (IDB-first with visible failures)", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetStorageFailureDedup();
    __resetStudyMigrationForTests();
    // The zustand store is module-level: slices and toasts from a previous
    // case must never leak into the next one.
    useAppStore.setState({
      flashcards: [],
      quizHistory: [],
      mistakeBank: [],
      toasts: [],
      pomodoroIsRunning: false,
      pomodoroEndsAt: null,
      pomodoroPausedRemainingSec: null,
      pomodoroSessionId: 0,
    });
    vi.mocked(putFlashcardRecord).mockClear();
    vi.mocked(idbClear).mockClear();
    vi.mocked(rpc).mockClear();
  });

  afterEach(() => {
    teardownIdb();
  });

  it("runs the Leitner review math: box advance and next-review intervals 1/2/4/7/14 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));

    const daysForNewBox = [0, 1, 2, 4, 7, 14];
    for (let box = 1; box <= 5; box++) {
      const newBox = Math.min(5, box + 1);
      useAppStore.setState({ flashcards: [card({ id: `c${box}`, boxLevel: box })] });
      await useAppStore.getState().reviewFlashcard(`c${box}`, true);
      const reviewed = useAppStore.getState().flashcards[0];
      expect(reviewed.boxLevel).toBe(newBox);
      expect(reviewed.nextReviewIso).toBe(
        `2026-11-${String(10 + daysForNewBox[newBox]).padStart(2, "0")}`,
      );
      expect(reviewed.reviewCount).toBe(1);
      expect(reviewed.lastReviewedIso).toBe("2026-11-10");
    }
    vi.useRealTimers();
  });

  it("a wrong answer resets the card to box 1 with a 1-day review date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    useAppStore.setState({ flashcards: [card({ boxLevel: 4 })] });
    await useAppStore.getState().reviewFlashcard("card-1", false);
    const reviewed = useAppStore.getState().flashcards[0];
    expect(reviewed.boxLevel).toBe(1);
    expect(reviewed.nextReviewIso).toBe("2026-11-11");
    vi.useRealTimers();
  });

  it("upsert persists the record in IndexedDB, not just in memory", async () => {
    await useAppStore.getState().upsertFlashcard({
      courseId: "CS101",
      front: "Define duality",
      back: "minimax = maximin",
      boxLevel: 1,
    });
    expect(useAppStore.getState().flashcards).toHaveLength(1);
    const { loadFlashcardRecords } = await import("../pwadapters/idbStore");
    const stored = await loadFlashcardRecords();
    expect(stored).toHaveLength(1);
    expect(stored[0].front).toBe("Define duality");
    expect(stored[0].courseId).toBe("CS101");
  });

  it("an IDB write failure raises a visible error toast instead of silently losing data", async () => {
    vi.mocked(putFlashcardRecord).mockRejectedValueOnce(new Error("QuotaExceededError"));
    await useAppStore.getState().upsertFlashcard({ front: "f", back: "b", boxLevel: 1 });

    // In-memory state stays honest: the user sees their card this session.
    expect(useAppStore.getState().flashcards).toHaveLength(1);
    const toasts = useAppStore.getState().toasts;
    expect(
      toasts.some((t) => t.type === "error" && t.message.includes(FLASHCARDS_STORAGE_KEY)),
    ).toBe(true);
  });

  it("addMistake and resolveMistake update the bank and persist", async () => {
    await useAppStore.getState().addMistake({
      assessmentId: "a-1",
      questionId: "q-1",
      questionText: "Which layer routes packets?",
      options: ["Network", "Transport"],
      selectedIndex: 1,
      correctIndex: 0,
      explanation: "Network layer routes.",
      timestamp: "2026-11-10T10:00:00.000Z",
      resolved: false,
    });
    const added = useAppStore.getState().mistakeBank[0];
    expect(added.resolved).toBe(false);
    const { loadMistakeRecords } = await import("../pwadapters/idbStore");
    expect(await loadMistakeRecords()).toHaveLength(1);

    await useAppStore.getState().resolveMistake(added.id);
    expect(useAppStore.getState().mistakeBank[0].resolved).toBe(true);
    expect((await loadMistakeRecords())[0].resolved).toBe(true);
  });

  it("recordQuizAttempt prepends the attempt and persists it", async () => {
    await useAppStore.getState().recordQuizAttempt({
      assessmentId: "a-1",
      assessmentTitle: "Quiz 1",
      timestamp: "2026-11-10T10:00:00.000Z",
      score: 4,
      totalQuestions: 5,
      percentage: 80,
      passed: true,
    });
    expect(useAppStore.getState().quizHistory).toHaveLength(1);
    const { loadQuizAttemptRecords } = await import("../pwadapters/idbStore");
    expect(await loadQuizAttemptRecords()).toHaveLength(1);
  });

  it("migrates legacy localStorage study data into IDB exactly once (marker in config_kv)", async () => {
    window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify([card({ id: "legacy-1" })]));
    window.localStorage.setItem(
      QUIZ_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: "legacy-attempt",
          assessmentId: "a-1",
          assessmentTitle: "Quiz 1",
          timestamp: "2026-11-01T10:00:00.000Z",
          score: 2,
          totalQuestions: 4,
          percentage: 50,
          passed: false,
        },
      ]),
    );
    window.localStorage.setItem(MISTAKES_STORAGE_KEY, JSON.stringify([]));

    const { ensureStudyDataMigrated, hydrateStudyCollections } = await import("./store");
    await ensureStudyDataMigrated();

    const { loadFlashcardRecords, loadQuizAttemptRecords, getConfigValue } =
      await import("../pwadapters/idbStore");
    expect((await loadFlashcardRecords()).map((c) => c.id)).toEqual(["legacy-1"]);
    expect(await loadQuizAttemptRecords()).toHaveLength(1);
    expect(await getConfigValue<boolean>("legacy_study_data_migrated_v1", false)).toBe(true);

    // Legacy keys are superseded after a successful migration: a cold start
    // must never paint stale localStorage data ahead of IDB truth.
    expect(window.localStorage.getItem(FLASHCARDS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(QUIZ_HISTORY_STORAGE_KEY)).toBeNull();

    // Re-running (memoized or explicit) must not duplicate anything.
    await hydrateStudyCollections();
    expect((await loadFlashcardRecords()).map((c) => c.id)).toEqual(["legacy-1"]);

    // The in-memory slice reflects IDB truth after hydration.
    expect(useAppStore.getState().flashcards.map((c) => c.id)).toEqual(["legacy-1"]);
  });

  it("does not re-import stale legacy data when the IDB marker already exists", async () => {
    const { setConfigValue } = await import("../pwadapters/idbStore");
    await setConfigValue("legacy_study_data_migrated_v1", true);
    window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify([card({ id: "stale" })]));

    const { ensureStudyDataMigrated } = await import("./store");
    await ensureStudyDataMigrated();

    const { loadFlashcardRecords } = await import("../pwadapters/idbStore");
    // Cleared localStorage with intact IDB never re-imports.
    expect(await loadFlashcardRecords()).toEqual([]);
    // And the stale legacy key survives untouched (purge is migration's job
    // only when it actually imported).
    expect(window.localStorage.getItem(FLASHCARDS_STORAGE_KEY)).not.toBeNull();
  });

  describe("reset_database wipes every study surface", () => {
    it("clears in-memory slices, legacy keys, the stats ledger and the SWR cache", async () => {
      window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify([card()]));
      window.localStorage.setItem(QUIZ_HISTORY_STORAGE_KEY, JSON.stringify([]));
      window.localStorage.setItem(MISTAKES_STORAGE_KEY, JSON.stringify([]));
      window.localStorage.setItem(
        "quizradar_local_study_stats_v1",
        JSON.stringify({
          totalMinutes: 50,
          totalSessions: 2,
          dailyMinutes: {},
          lastUpdated: "2026-11-10",
        }),
      );
      window.localStorage.setItem(
        "quizradar_state_cache_v5",
        JSON.stringify({ stale: "pre-reset data would flash back here" }),
      );
      window.sessionStorage.setItem("quizradar_onboarding_dismissed", "1");
      useAppStore.setState({
        flashcards: [card()],
        quizHistory: [],
        mistakeBank: [],
      });

      const wiped = await useAppStore.getState().resetDatabase();

      expect(wiped).toBe(true);
      // In-memory slices are empty — the flash-back vector the SWR cache
      // purge alone never covered.
      expect(useAppStore.getState().flashcards).toEqual([]);
      expect(useAppStore.getState().quizHistory).toEqual([]);
      expect(useAppStore.getState().mistakeBank).toEqual([]);
      expect(window.localStorage.getItem(FLASHCARDS_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(QUIZ_HISTORY_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(MISTAKES_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem("quizradar_local_study_stats_v1")).toBeNull();
      // The SWR cache holds the fresh post-reset state, not the stale one.
      expect(window.localStorage.getItem("quizradar_state_cache_v5")).toBe(
        JSON.stringify(initialFullState),
      );
      // The onboarding wizard must return after a wipe.
      expect(window.sessionStorage.getItem("quizradar_onboarding_dismissed")).toBeNull();
    });

    it("leaves every study surface untouched when the backend reset fails", async () => {
      vi.mocked(rpc).mockRejectedValueOnce(new Error("backend down"));
      useAppStore.setState({ flashcards: [card()] });
      window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify([card()]));

      const wiped = await useAppStore.getState().resetDatabase();

      expect(wiped).toBe(false);
      expect(useAppStore.getState().flashcards).toHaveLength(1);
      expect(window.localStorage.getItem(FLASHCARDS_STORAGE_KEY)).not.toBeNull();
      expect(
        useAppStore
          .getState()
          .toasts.some((t) => t.type === "error" && t.message.includes("Reset failed")),
      ).toBe(true);
    });

    it("a failed IDB clear makes the reset report honestly instead of claiming a clean wipe", async () => {
      vi.mocked(idbClear).mockRejectedValueOnce(new Error("QuotaExceededError"));
      window.localStorage.setItem(FLASHCARDS_STORAGE_KEY, JSON.stringify([card()]));

      const wiped = await useAppStore.getState().resetDatabase();

      // The backend reset succeeded, but a study store could not be wiped —
      // the store must NOT claim success (the UI's "all data reset" toast is
      // suppressed), and the failure names the affected store.
      expect(wiped).toBe(false);
      expect(
        useAppStore
          .getState()
          .toasts.some(
            (t) =>
              t.type === "error" &&
              t.message.includes("Reset incomplete") &&
              t.message.includes("flashcards"),
          ),
      ).toBe(true);
    });

    it("an in-flight study write that races a reset cannot resurrect purged records", async () => {
      // Simulate a write that was already in flight when the user hit
      // "Reset Everything": the put pauses (gate), the purge completes, then
      // the put commits AFTER the wipe. The store must delete what landed.
      const { putFlashcardRecord: actualPut } =
        await vi.importActual<typeof import("../pwadapters/idbStore")>("../pwadapters/idbStore");
      let releasePut: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      vi.mocked(putFlashcardRecord).mockImplementationOnce(async (card) => {
        await gate;
        return actualPut(card);
      });

      const writePromise = useAppStore
        .getState()
        .upsertFlashcard({ front: "racer", back: "b", boxLevel: 1 });
      // The write is now parked at the gate (pre-IDB). Reset everything.
      const wiped = await useAppStore.getState().resetDatabase();
      expect(wiped).toBe(true);
      releasePut!();
      await writePromise;

      // The late-committing write was rolled back — nothing resurrected.
      const { loadFlashcardRecords } = await import("../pwadapters/idbStore");
      expect(await loadFlashcardRecords()).toEqual([]);
      expect(useAppStore.getState().flashcards).toEqual([]);
    });

    it("two quiz attempts recorded in the same millisecond both persist (no IDB keyPath overwrite)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
      const attempt = {
        assessmentId: "a-1",
        assessmentTitle: "Quiz 1",
        timestamp: "2026-11-11T12:00:00.000Z",
        score: 1,
        totalQuestions: 2,
        percentage: 50,
        passed: false,
      };
      // Same wall-clock ms for both records — the pre-fix `attempt-${Date.now()}`
      // id made the second silently overwrite the first.
      const [first, second] = await Promise.all([
        useAppStore.getState().recordQuizAttempt(attempt),
        useAppStore.getState().recordQuizAttempt(attempt),
      ]);
      void first;
      void second;
      expect(useAppStore.getState().quizHistory).toHaveLength(2);
      const { loadQuizAttemptRecords } = await import("../pwadapters/idbStore");
      expect(await loadQuizAttemptRecords()).toHaveLength(2);
      vi.useRealTimers();
    });

    it("desktop import wrapper: report.studyImport sections are mirrored into the webview stores", async () => {
      // The desktop tauri command restores study collections into SQLite and
      // returns the file's sections; the web layer must mirror them into its
      // own IDB/localStorage (which the UI hydrates from) or the restored
      // data stays invisible.
      const { putFlashcardRecord: actualPut } =
        await vi.importActual<typeof import("../pwadapters/idbStore")>("../pwadapters/idbStore");
      vi.mocked(putFlashcardRecord).mockImplementation(actualPut);
      await useAppStore.getState().upsertFlashcard({ front: "stale", back: "x", boxLevel: 5 });
      await useAppStore.getState().addMistake({
        assessmentId: "a-1",
        questionId: "q-1",
        questionText: "stale mistake",
        options: ["a"],
        selectedIndex: 0,
        correctIndex: 0,
        explanation: "",
        timestamp: "2026-11-01T10:00:00.000Z",
        resolved: false,
      });
      const staleMistakeId = useAppStore.getState().mistakeBank[0].id;
      vi.mocked(putFlashcardRecord).mockClear();

      vi.mocked(rpc).mockResolvedValueOnce({
        ...initialFullState,
        assessmentsImported: 0,
        coursesImported: 1,
        slotsImported: 0,
        gradesImported: 0,
        topicsImported: 0,
        feedsImported: 0,
        customEventsImported: 0,
        secretsIgnored: [],
        warnings: [],
        flashcardsImported: 1,
        studyStatsRestored: true,
        // Desktop wrapper shape: snake_case core records (no percentage).
        studyStats: {
          totalMinutes: 120,
          totalSessions: 5,
          dailyMinutes: { "2026-11-11": 25 },
          lastUpdated: "2026-11-11",
        },
        studyImport: {
          flashcards: [
            {
              id: "card-core",
              course_id: "CSE241",
              front: "core card",
              back: "b",
              box_level: 3,
              next_review_iso: "2026-11-15",
            },
          ],
          quiz_attempts: [
            {
              id: "attempt-core",
              assessment_id: "a-9",
              timestamp: "2026-11-11T09:00:00.000Z",
              score: 7,
              total_questions: 10,
              passed: true,
            },
          ],
          // Absent section (undefined) leaves the local collection untouched.
          mistake_bank: undefined,
        },
      } as never);

      await useAppStore.getState().importBackupFile(undefined, undefined);

      const { loadFlashcardRecords, loadQuizAttemptRecords, loadMistakeRecords } =
        await import("../pwadapters/idbStore");
      const cards = await loadFlashcardRecords();
      // Present section REPLACES the whole collection.
      expect(cards.map((c) => c.id)).toEqual(["card-core"]);
      expect(cards[0].boxLevel).toBe(3);
      expect(cards[0].courseId).toBe("CSE241");
      const attempts = await loadQuizAttemptRecords();
      expect(attempts).toHaveLength(1);
      // The core record's percentage is derived from score/total.
      expect(attempts[0].percentage).toBe(70);
      // Absent section → untouched: the mistake seeded above survives.
      const mistakes = await loadMistakeRecords();
      expect(mistakes.map((m) => m.id)).toEqual([staleMistakeId]);
      expect(useAppStore.getState().flashcards.map((c) => c.id)).toEqual(["card-core"]);
      expect(loadStoredStudyStats().totalSessions).toBe(5);
    });
  });
});

describe("timestamp-based pomodoro timer (exactly-once completion)", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
    window.localStorage.clear();
    resetStorageFailureDedup();
    __resetStudyMigrationForTests();
    useAppStore.setState({ toasts: [] });
  });

  afterEach(() => {
    teardownIdb();
    vi.useRealTimers();
  });

  const startSession = (secondsLeft: number) => {
    useAppStore.setState({
      pomodoroMode: "pomodoro",
      pomodoroIsRunning: true,
      pomodoroEndsAt: Date.now() + secondsLeft * 1000,
      pomodoroSecondsLeft: secondsLeft,
      pomodoroPausedRemainingSec: null,
      pomodoroPausedAtMs: null,
      pomodoroPausedMsTotal: 0,
      pomodoroSessionId: 0,
    });
  };

  it("advancing past zero completes exactly once — a second tick records nothing", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(3);

    // Wall clock jumps past the deadline (tab throttling simulation) — the
    // timestamp-based tick completes from the deadline, not from decrements.
    vi.setSystemTime(new Date("2026-11-10T12:00:04Z"));
    useAppStore.getState().tickPomodoro();
    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
    expect(useAppStore.getState().pomodoroSecondsLeft).toBe(POMODORO_DURATIONS.pomodoro);
    expect(loadStoredStudyStats().totalSessions).toBe(1);
    expect(loadStoredStudyStats().totalMinutes).toBe(25);
    expect(
      useAppStore
        .getState()
        .toasts.some((t) => t.type === "success" && t.message.includes("session complete")),
    ).toBe(true);

    // Racing/duplicate observers must never re-complete.
    useAppStore.getState().tickPomodoro();
    useAppStore.getState().tickPomodoro();
    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(loadStoredStudyStats().totalSessions).toBe(1);
  });

  it("pausing captures the remainder and resuming restores it, not the wall clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(100);

    // 40 seconds elapse, then the user pauses.
    vi.setSystemTime(new Date("2026-11-10T12:00:40Z"));
    useAppStore.getState().tickPomodoro(); // refresh derived secondsLeft
    expect(useAppStore.getState().pomodoroSecondsLeft).toBe(60);
    useAppStore.getState().togglePomodoro();
    expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
    expect(useAppStore.getState().pomodoroPausedRemainingSec).toBe(60);
    expect(useAppStore.getState().pomodoroEndsAt).toBeNull();

    // Wall clock moves far past the original deadline while paused.
    vi.setSystemTime(new Date("2026-11-10T12:10:00Z"));
    useAppStore.getState().togglePomodoro();
    const resumed = useAppStore.getState();
    expect(resumed.pomodoroIsRunning).toBe(true);
    expect(resumed.pomodoroPausedRemainingSec).toBeNull();
    // Resumes with 60s remaining — not zero, not a fresh 25 minutes.
    expect(resumed.pomodoroEndsAt).toBe(Date.now() + 60 * 1000);

    // And completing after the resumed remainder records exactly one session.
    vi.setSystemTime(new Date("2026-11-10T12:11:00Z"));
    useAppStore.getState().tickPomodoro();
    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(loadStoredStudyStats().totalSessions).toBe(1);
  });

  // Pause-bookkeeping regression scope: the stats ledger used to credit the
  // NOMINAL block (25 focus minutes) even when the user spent minutes paused.
  // These tests pin that completion credits only the focused time.
  describe("paused focus time is credited honestly", () => {
    const setSystemTime = (iso: string) => vi.setSystemTime(new Date(iso));

    // Start a real 25-minute focus block through the same toggle the UI uses,
    // so the pause bookkeeping flows through the production code paths.
    const startFocusViaToggle = () => {
      useAppStore.setState({
        pomodoroMode: "pomodoro",
        pomodoroIsRunning: false,
        pomodoroEndsAt: null,
        pomodoroPausedRemainingSec: null,
        pomodoroPausedAtMs: null,
        pomodoroPausedMsTotal: 0,
        pomodoroSessionId: 0,
      });
      useAppStore.getState().togglePomodoro();
    };

    it("no pause in a 25-minute block credits 25 minutes", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      setSystemTime("2026-11-10T12:00:00Z");
      startFocusViaToggle();
      expect(useAppStore.getState().pomodoroEndsAt).toBe(Date.now() + 25 * 60 * 1000);

      setSystemTime("2026-11-10T12:25:00Z");
      useAppStore.getState().tickPomodoro();

      expect(useAppStore.getState().pomodoroSessionId).toBe(1);
      expect(loadStoredStudyStats().totalSessions).toBe(1);
      expect(loadStoredStudyStats().totalMinutes).toBe(25);
    });

    it("one 5-minute pause inside the block credits 20 minutes", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      setSystemTime("2026-11-10T12:00:00Z");
      startFocusViaToggle();

      // 20 focused seconds, then pause.
      setSystemTime("2026-11-10T12:00:20Z");
      useAppStore.getState().togglePomodoro();
      expect(useAppStore.getState().pomodoroPausedAtMs).toBe(Date.now());

      // The pause lasts 5 wall-clock minutes.
      setSystemTime("2026-11-10T12:05:20Z");
      useAppStore.getState().togglePomodoro();
      expect(useAppStore.getState().pomodoroPausedAtMs).toBeNull();
      expect(useAppStore.getState().pomodoroPausedMsTotal).toBe(5 * 60 * 1000);

      // The remaining 24:40 of focused time elapses (deadline restored the
      // captured remainder, so completion lands at 12:30:00); the session
      // completes.
      setSystemTime("2026-11-10T12:30:00Z");
      useAppStore.getState().tickPomodoro();

      expect(useAppStore.getState().pomodoroSessionId).toBe(1);
      expect(loadStoredStudyStats().totalSessions).toBe(1);
      expect(loadStoredStudyStats().totalMinutes).toBe(20);
    });

    it("two pauses (2 minutes + 3 minutes) inside the block credit 20 minutes", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      setSystemTime("2026-11-10T12:00:00Z");
      startFocusViaToggle();

      setSystemTime("2026-11-10T12:00:20Z");
      useAppStore.getState().togglePomodoro(); // pause 1
      setSystemTime("2026-11-10T12:02:20Z");
      useAppStore.getState().togglePomodoro(); // resume — 2 min banked
      setSystemTime("2026-11-10T12:02:40Z");
      useAppStore.getState().togglePomodoro(); // pause 2
      setSystemTime("2026-11-10T12:05:40Z");
      useAppStore.getState().togglePomodoro(); // resume — 5 min banked total

      expect(useAppStore.getState().pomodoroPausedMsTotal).toBe(5 * 60 * 1000);

      // The remaining 24:20 of focused time elapses (deadline 12:30:00 after
      // the two resumes); the session completes.
      setSystemTime("2026-11-10T12:30:00Z");
      useAppStore.getState().tickPomodoro();

      expect(useAppStore.getState().pomodoroSessionId).toBe(1);
      expect(loadStoredStudyStats().totalSessions).toBe(1);
      expect(loadStoredStudyStats().totalMinutes).toBe(20);
    });

    it("resetPomodoro mid-run records nothing and clears the pause ledger", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      setSystemTime("2026-11-10T12:00:00Z");
      startFocusViaToggle();

      setSystemTime("2026-11-10T12:00:20Z");
      useAppStore.getState().togglePomodoro(); // paused, ledger stamp set
      setSystemTime("2026-11-10T12:01:20Z");
      useAppStore.getState().resetPomodoro();

      const state = useAppStore.getState();
      expect(state.pomodoroIsRunning).toBe(false);
      expect(state.pomodoroEndsAt).toBeNull();
      expect(state.pomodoroPausedRemainingSec).toBeNull();
      expect(state.pomodoroPausedAtMs).toBeNull();
      expect(state.pomodoroPausedMsTotal).toBe(0);
      expect(state.pomodoroSecondsLeft).toBe(POMODORO_DURATIONS.pomodoro);
      expect(loadStoredStudyStats().totalSessions).toBe(0);
      expect(loadStoredStudyStats().totalMinutes).toBe(0);

      // Late ticks against the reset session never record anything.
      setSystemTime("2026-11-10T12:30:00Z");
      useAppStore.getState().tickPomodoro();
      expect(loadStoredStudyStats().totalSessions).toBe(0);

      // A fresh full block afterwards credits the whole 25 minutes — proof
      // the pause ledger was truly cleared, not carried over.
      startFocusViaToggle();
      setSystemTime("2026-11-10T12:55:00Z");
      useAppStore.getState().tickPomodoro();
      expect(useAppStore.getState().pomodoroSessionId).toBe(1);
      expect(loadStoredStudyStats().totalSessions).toBe(1);
      expect(loadStoredStudyStats().totalMinutes).toBe(25);
    });

    it("a break completion still records nothing", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      setSystemTime("2026-11-10T12:00:00Z");
      useAppStore.setState({
        pomodoroMode: "shortBreak",
        pomodoroIsRunning: false,
        pomodoroEndsAt: null,
        pomodoroPausedRemainingSec: null,
        pomodoroPausedAtMs: null,
        pomodoroPausedMsTotal: 0,
        pomodoroSessionId: 0,
      });
      useAppStore.getState().togglePomodoro();

      // Pause part of the break too — breaks never credit anything regardless.
      setSystemTime("2026-11-10T12:01:00Z");
      useAppStore.getState().togglePomodoro();
      setSystemTime("2026-11-10T12:02:00Z");
      useAppStore.getState().togglePomodoro();

      setSystemTime("2026-11-10T12:09:00Z");
      useAppStore.getState().tickPomodoro();

      expect(useAppStore.getState().pomodoroSessionId).toBe(1);
      expect(loadStoredStudyStats().totalSessions).toBe(0);
      expect(loadStoredStudyStats().totalMinutes).toBe(0);
    });
  });

  it("a mode switch cancels the running session without completing it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(100);

    useAppStore.getState().setPomodoroMode("shortBreak");
    const state = useAppStore.getState();
    expect(state.pomodoroIsRunning).toBe(false);
    expect(state.pomodoroEndsAt).toBeNull();
    expect(state.pomodoroSessionId).toBe(0);
    expect(state.pomodoroSecondsLeft).toBe(POMODORO_DURATIONS.shortBreak);
    expect(loadStoredStudyStats().totalSessions).toBe(0);
  });
});

describe("theme toggle resolves the user's preferred theme per mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  });

  it("toggling from light applies the preferred DARK theme, not the generic default", () => {
    // The user picked AMOLED Cosmic Stardust as their nighttime theme in
    // Settings; the TopBar flip must restore exactly that pick. The old bug
    // set the generic "dark" id, which always renders the Obsidian tokens.
    window.localStorage.setItem(PREFERRED_DARK_THEME_STORAGE_KEY, "amoled-nebula");
    useAppStore.setState({ theme: "solar" });

    useAppStore.getState().toggleTheme();

    const next = useAppStore.getState().theme;
    expect(next).toBe("amoled-nebula");
    expect(next).not.toBe("dark"); // the resolved id, never the generic one
    expect(document.documentElement.getAttribute("data-theme")).toBe("amoled-nebula");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("amoled-nebula");
  });

  it("toggling from dark applies the preferred LIGHT theme, not the generic default", () => {
    window.localStorage.setItem(PREFERRED_LIGHT_THEME_STORAGE_KEY, "solar");
    useAppStore.setState({ theme: "amoled-nebula" });

    useAppStore.getState().toggleTheme();

    const next = useAppStore.getState().theme;
    expect(next).toBe("solar");
    expect(next).not.toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("solar");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("solar");
  });

  it("with nothing stored the toggle falls back to the defaults (Obsidian for dark, Solar for light)", () => {
    useAppStore.setState({ theme: "light" });

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("obsidian");

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("solar");
  });

  it("the toggle and the settings pickers share one source of truth: the resolved id round-trips", () => {
    // Picking AMOLED in Settings (setTheme → applyThemeToDocument records the
    // preference), flipping to light via the TopBar, and flipping back must
    // restore AMOLED Cosmic Stardust — not the Obsidian default.
    useAppStore.setState({ theme: "light" });

    useAppStore.getState().setTheme("amoled-nebula");
    expect(useAppStore.getState().theme).toBe("amoled-nebula");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("amoled-nebula");

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("solar");

    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe("amoled-nebula");
    expect(document.documentElement.getAttribute("data-theme")).toBe("amoled-nebula");
  });
});

describe("balanced flight path date arithmetic", () => {
  afterEach(() => {
    vi.mocked(rpc).mockImplementation(async () => initialFullState);
  });

  it("lands study blocks on the exam's calendar dates, not a timezone-shifted day", async () => {
    const base = JSON.parse(JSON.stringify(initialFullState)) as GetStatePayload;
    const exam = (id: string, dateIso: string): Assessment => ({
      id,
      courseId: "CSE241",
      title: `Exam ${id}`,
      assessmentType: "Exam",
      dateIso,
      startTime: "10:00",
      source: "syllabus",
      isUpcoming: true,
      daysUntil: 2,
      urgencyLevel: "high",
      priorityScore: 90,
      topics: [],
      warnings: [],
    });
    base.assessments = [exam("exam-1", "2026-11-12"), exam("exam-2", "2026-11-14")];
    base.dashboard.conflictAlerts = [
      {
        assessmentAId: "exam-1",
        assessmentBId: "exam-2",
        dateA: "2026-11-12",
        dateB: "2026-11-14",
        severity: "critical",
        hoursBetween: 30,
        message: "Back-to-back exam overload",
        dismissed: false,
        isMitigated: false,
      },
    ];
    base.schedule.slots = [];
    base.config.customEvents = [];
    useAppStore.setState({ data: base, toasts: [] });

    // Capture the study blocks pushed through the bridge (snake_case wire shape).
    const addedBlocks: Array<Record<string, unknown>> = [];
    vi.mocked(rpc).mockImplementation(async (method: unknown, args?: unknown) => {
      if (method === "add_custom_event") {
        addedBlocks.push((args as { event: Record<string, unknown> }).event);
      }
      return useAppStore.getState().data;
    });

    await useAppStore.getState().draftBalancedFlightPath();

    // The plan offsets (3/2/1/0 days before the 2026-11-12 exam) must land on
    // those exact calendar dates. The old local-midnight → toISOString()
    // round-trip shifted every block one day early for users east of UTC.
    expect(addedBlocks.map((b) => b.date_iso)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
  });
});

describe("toggleTopic intended completion", () => {
  afterEach(() => {
    vi.mocked(rpc).mockImplementation(async () => initialFullState);
  });

  const recState = (): GetStatePayload => {
    const base = JSON.parse(JSON.stringify(initialFullState)) as GetStatePayload;
    base.assessments = [
      {
        id: "up-1",
        courseId: "CSE241",
        title: "Quiz 1",
        assessmentType: "Class Quiz",
        dateIso: "2026-11-20",
        startTime: "10:00",
        source: "syllabus",
        isUpcoming: true,
        daysUntil: 8,
        urgencyLevel: "upcoming",
        priorityScore: 70,
        topics: ["Trees", "Graphs"],
        warnings: [],
      },
      {
        id: "past-1",
        courseId: "MAT102",
        title: "Old Quiz",
        assessmentType: "Quiz",
        dateIso: "2026-11-01",
        startTime: "09:00",
        source: "moodle",
        isUpcoming: false,
        daysUntil: -11,
        urgencyLevel: "past",
        priorityScore: 0,
        topics: ["Limits"],
        warnings: [],
      },
    ];
    base.dashboard.studyRecommendations = [
      {
        assessmentId: "up-1",
        title: "Quiz 1",
        courseId: "CSE241",
        assessmentType: "Class Quiz",
        dateIso: "2026-11-20",
        daysUntil: 8,
        urgencyLevel: "upcoming",
        priorityScore: 70,
        whyStudyNow: "Coming up",
        progressPercent: 0,
        topics: [{ key: "t0", topicIndex: 0, title: "Trees", completed: false }],
      },
    ];
    return base;
  };

  it("sends the absolute flipped value for a recommendation-tracked topic", async () => {
    useAppStore.setState({ data: recState(), toasts: [] });
    await useAppStore.getState().toggleTopic("up-1", 0);
    const [method, args] = vi.mocked(rpc).mock.calls.at(-1) as [
      string,
      { assessmentId: string; topicIdx: number; completed: boolean },
    ];
    expect(method).toBe("toggle_topic");
    expect(args.completed).toBe(true);
  });

  it("defers to the backend's persisted state for a topic absent from the payload", async () => {
    // A past assessment never appears in study_recommendations, so the store
    // has no mirror of the topic's persisted state. Sending an absolute
    // `false` made checking a past topic a silent no-op and an uncheck
    // invisible — the intended value must be omitted so the backend inverts
    // the topic's own state.
    useAppStore.setState({ data: recState(), toasts: [] });
    await useAppStore.getState().toggleTopic("past-1", 0);
    const [method, args] = vi.mocked(rpc).mock.calls.at(-1) as [
      string,
      { assessmentId: string; topicIdx: number; completed?: boolean },
    ];
    expect(method).toBe("toggle_topic");
    expect(args.assessmentId).toBe("past-1");
    // The key is present but undefined — JSON serialization drops it, so both
    // the desktop command (`Option<bool> = None`) and the browser adapter's
    // `args?.completed !== undefined` branch invert the persisted state.
    expect(args.completed).toBeUndefined();
  });
});

describe("runGcalSync honest toast styling", () => {
  afterEach(() => {
    vi.mocked(rpc).mockImplementation(async () => initialFullState);
  });

  const lastToast = () => useAppStore.getState().toasts.at(-1);

  it("shows a success toast only when the push actually succeeded", async () => {
    vi.mocked(rpc).mockImplementation(async (method: unknown) => {
      if (method === "run_gcal_sync") {
        return { success: true, created: 2, updated: 0, needsScope: false, message: "Pushed 2" };
      }
      return useAppStore.getState().data;
    });
    await useAppStore.getState().runGcalSync();
    expect(lastToast()?.type).toBe("success");
    expect(lastToast()?.message).toBe("Pushed 2");
  });

  it("shows a failure toast when the desktop reports Ok with success=false", async () => {
    vi.mocked(rpc).mockImplementation(async (method: unknown) => {
      if (method === "run_gcal_sync") {
        return {
          success: false,
          created: 0,
          updated: 0,
          needsScope: false,
          message: "3 of 5 events failed to push",
        };
      }
      return useAppStore.getState().data;
    });
    await useAppStore.getState().runGcalSync();
    expect(lastToast()?.type).toBe("error");
    expect(lastToast()?.message).toBe("3 of 5 events failed to push");
  });

  it("shows a warning toast for a missing-calendar-scope outcome", async () => {
    vi.mocked(rpc).mockImplementation(async (method: unknown) => {
      if (method === "run_gcal_sync") {
        return {
          success: false,
          created: 0,
          updated: 0,
          needsScope: true,
          message: "Grant calendar access in Settings first.",
        };
      }
      return useAppStore.getState().data;
    });
    await useAppStore.getState().runGcalSync();
    expect(lastToast()?.type).toBe("warning");
  });
});
