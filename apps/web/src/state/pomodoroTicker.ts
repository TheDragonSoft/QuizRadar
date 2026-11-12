import { useAppStore } from "./store";

/**
 * The ONE Pomodoro ticker for the whole app.
 *
 * History: FocusView owned the only `setInterval` driving `tickPomodoro`, so a
 * session only progressed while the Focus view was mounted — navigating to
 * Tasks froze the countdown and (before the completion moved into the store)
 * silently dropped the session side effects. The completion transition itself
 * is already exactly-once inside the store (`completePomodoroSession`, guarded
 * by `pomodoroIsRunning` + `pomodoroEndsAt`); what the app still needed was an
 * app-level driver that survives navigation and shares nothing with the
 * view/modal — both of them are pure presentation over `pomodoroSecondsLeft`.
 *
 * Design:
 * - ONE `setInterval` for the entire app lifetime (not per running session).
 *   `tickPomodoro` early-returns on an idle timer, so a constant tick is free.
 * - Elapsed time is deadline-based (`pomodoroEndsAt` wall-clock timestamp):
 *   a throttled background tab or a suspended device loses interval fires but
 *   never correctness — the first tick after waking recomputes the remainder
 *   from `Date.now()` and completes an overdue session exactly once.
 * - `visibilitychange` / `focus` listeners tick immediately on return, so a
 *   session that expired while hidden completes on the transition event
 *   instead of waiting (up to a full second, or minutes under aggressive
 *   timer throttling) for the next interval fire.
 *
 * Re-entrant on purpose (same contract as `initDayRolloverWatchdog`): every
 * call starts a fresh interval + listeners and returns a disposer that fully
 * stops them, so a StrictMode mount→cleanup→mount cannot strand a dead ticker.
 */
export function startPomodoroTicker(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const tick = () => {
    useAppStore.getState().tickPomodoro();
  };

  const intervalId = window.setInterval(tick, 1000);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("focus", tick);

  return () => {
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", tick);
    window.removeEventListener("focus", tick);
  };
}
