/**
 * Day-rollover watchdog (spec §4.8).
 * Checks the local calendar date every 30s and upon document visibility change.
 * Triggers recomputation whenever the date flips (e.g. at midnight), ensuring
 * relative countdowns ("TODAY" -> "PAST", "TOMORROW" -> "TODAY") never go stale.
 */

export function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type DayRolloverCallback = (newDate: string, oldDate: string) => void;

export function startDayRolloverWatchdog(
  onRollover: DayRolloverCallback,
  intervalMs = 30_000,
): () => void {
  let lastDate = getLocalDateString();

  const check = () => {
    const currentDate = getLocalDateString();
    if (currentDate !== lastDate) {
      const oldDate = lastDate;
      lastDate = currentDate;
      onRollover(currentDate, oldDate);
    }
  };

  const timer = setInterval(check, intervalMs);

  const handleVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      check();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}
