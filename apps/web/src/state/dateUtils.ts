/**
 * True when an OAuth failure is a *setup* problem (no client id configured,
 * or an unusable one) rather than a provider/consent failure. Those are
 * fixed in Settings → Account, so the UI jumps straight there instead of
 * dumping a wall of text into a toast.
 */
export function isClientIdSetupError(message: string): boolean {
  return (
    /client id/i.test(message) &&
    /(needs your own|not configured|not usable|missing)/i.test(message)
  );
}

/**
 * Calendar-date arithmetic on plain `YYYY-MM-DD` strings. Dates are anchored
 * at UTC noon internally so the result never shifts with the device timezone
 * (a local-midnight `toISOString()` round-trip moves the day for every user
 * east or west of UTC).
 */
export function addDaysToIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day + days));
  return anchor.toISOString().slice(0, 10);
}

export function getWeekStart(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day));
  const weekday = anchor.getUTCDay(); // 0 is Sunday
  return addDaysToIsoDate(dateStr, -weekday);
}
