/**
 * One date formatter for the week windows the UI prints.
 *
 * Two panels show a week and both used to describe it in their own words:
 * the dashboard KPI ("next 7 days") and the sidebar's week panel. A raw ISO
 * string ("2026-11-01") is never user-facing, and a calendar week is not a
 * rolling window — so the label always carries the exact dates it covers.
 */

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse `"YYYY-MM-DD"` into a local `Date` (no UTC shift, no `Date` parsing quirks). */
export function parseIsoDate(iso: string): Date | null {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/**
 * `"Oct 31"`, optionally `"Sat, Oct 31"` and/or `"Sat, Oct 31, 2026"`.
 * An unparsable input returns the raw string rather than "Invalid Date".
 */
export function formatIsoShortDate(
  iso: string,
  options: { weekday?: boolean; year?: boolean } = {},
): string {
  const date = parseIsoDate(iso);
  if (!date || Number.isNaN(date.getTime())) return iso;
  const month = MONTHS_SHORT[date.getMonth()] ?? "";
  const day = date.getDate();
  const head = options.weekday ? `${WEEKDAYS_SHORT[date.getDay()]}, ` : "";
  const tail = options.year ? `, ${date.getFullYear()}` : "";
  return `${head}${month} ${day}${tail}`;
}

/**
 * The seven days of the week that starts on `weekStartIso`, as one label:
 * `"Oct 25 – Oct 31"`. The year is only appended when the week spans two
 * different years ("Dec 28 – Jan 3, 2027"), so a normal week stays short.
 */
export function formatWeekRange(weekStartIso: string): string {
  const start = parseIsoDate(weekStartIso);
  if (!start || Number.isNaN(start.getTime())) return weekStartIso;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
  const sameYear = end.getFullYear() === start.getFullYear();
  return `${formatIsoShortDate(weekStartIso)} – ${formatIsoShortDate(endIso, {
    year: !sameYear,
  })}`;
}
