import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAppStore, POMODORO_DURATIONS, __resetStudyMigrationForTests } from "./store";
import { startPomodoroTicker } from "./pomodoroTicker";
import { loadStoredStudyStats } from "../lib/studyStats";
import { resetStorageFailureDedup } from "./storage";
import { setupMockIndexedDb } from "../test/mockIndexedDb";

// Regression scope: the Pomodoro tick driver used to live INSIDE FocusView, so
// a running session froze the moment the user navigated to another view and
// nothing completed it. The driver is now app-level (App.tsx mounts
// startPomodoroTicker); these tests prove the controller completes a session
// exactly once with NO view and NO modal mounted, survives deadline elapse
// while "hidden" (visibilitychange tick), and stops on dispose.

describe("app-level pomodoro ticker (no Focus view, no modal mounted)", () => {
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

  it("a paused session the ticker completes credits the focused time, not the nominal block", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(1500); // a full 25-minute focus block
    const stop = startPomodoroTicker();

    // 20 focused seconds, then a 5 wall-clock-minute pause.
    vi.advanceTimersByTime(20000);
    useAppStore.getState().togglePomodoro(); // pause
    vi.advanceTimersByTime(5 * 60 * 1000); // wall clock moves while paused
    useAppStore.getState().togglePomodoro(); // resume — 5 minutes banked
    expect(useAppStore.getState().pomodoroPausedMsTotal).toBe(5 * 60 * 1000);

    // The remaining 24:40 of focused time elapses; the interval completes it.
    vi.advanceTimersByTime(24 * 60 * 1000 + 40 * 1000);
    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(loadStoredStudyStats().totalSessions).toBe(1);
    expect(loadStoredStudyStats().totalMinutes).toBe(20);
    stop();
  });

  it("completes exactly once on interval ticks with no components mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(3);
    const stop = startPomodoroTicker();

    vi.advanceTimersByTime(1500);
    expect(useAppStore.getState().pomodoroSessionId).toBe(0); // still counting

    vi.advanceTimersByTime(2500); // past the deadline
    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(useAppStore.getState().pomodoroIsRunning).toBe(false);
    expect(useAppStore.getState().pomodoroSecondsLeft).toBe(POMODORO_DURATIONS.pomodoro);
    expect(loadStoredStudyStats().totalSessions).toBe(1);
    expect(loadStoredStudyStats().totalMinutes).toBe(25);
    expect(
      useAppStore
        .getState()
        .toasts.some((t) => t.type === "success" && t.message === "Pomodoro session complete!"),
    ).toBe(true);

    // Late ticks (the interval keeps firing forever) never re-complete.
    vi.advanceTimersByTime(10000);
    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(loadStoredStudyStats().totalSessions).toBe(1);

    stop();
  });

  it("the deadline fires on the visibilitychange tick, not just the interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(5);
    const stop = startPomodoroTicker();

    // The tab is hidden/throttled: interval fires are lost, wall clock moves
    // past the deadline. The transition back to visible ticks immediately.
    vi.advanceTimersByTime(1000); // only one interval fire gets through
    vi.setSystemTime(new Date("2026-11-10T12:00:30Z"));
    expect(useAppStore.getState().pomodoroSessionId).toBe(0);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(useAppStore.getState().pomodoroSessionId).toBe(1);
    expect(loadStoredStudyStats().totalSessions).toBe(1);
    stop();
  });

  it("disposing the ticker stops the session at its deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    startSession(2);
    const stop = startPomodoroTicker();
    stop();

    vi.advanceTimersByTime(30000);
    vi.setSystemTime(new Date("2026-11-10T12:01:00Z"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(useAppStore.getState().pomodoroSessionId).toBe(0);
    expect(useAppStore.getState().pomodoroIsRunning).toBe(true);
    expect(loadStoredStudyStats().totalSessions).toBe(0);
  });
});

// The chime is the only place an AudioContext is created; before this change
// each completion leaked one (browsers cap concurrent contexts, so repeated
// sessions eventually muted the chime). The context must close after the tone.
describe("pomodoro chime audio lifecycle", () => {
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("closes the AudioContext after the chime oscillator finishes", async () => {
    const contexts: Array<{ close: ReturnType<typeof vi.fn> } & Record<string, unknown>> = [];
    class FakeOscillator {
      onended: (() => void) | null = null;
      connect = vi.fn();
      start = vi.fn();
      stop = vi.fn(() => {
        this.onended?.();
      });
      frequency = { setValueAtTime: vi.fn() };
      type = "sine";
    }
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      close = vi.fn(async () => undefined);
      createOscillator = () => new FakeOscillator();
      createGain = () => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      });
      constructor() {
        contexts.push(
          this as unknown as { close: ReturnType<typeof vi.fn> } & Record<string, unknown>,
        );
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    useAppStore.setState({
      pomodoroMode: "pomodoro",
      pomodoroIsRunning: true,
      pomodoroEndsAt: Date.now() + 1000,
      pomodoroSecondsLeft: 1,
      pomodoroPausedRemainingSec: null,
      pomodoroSessionId: 0,
    });

    const stop = startPomodoroTicker();
    vi.advanceTimersByTime(2000);

    expect(contexts).toHaveLength(1);
    // The oscillator's stop fired onended, which closed the context.
    expect(contexts[0].close).toHaveBeenCalled();
    stop();
  });
});
