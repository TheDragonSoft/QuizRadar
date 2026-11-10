import { copy } from "../../copy";
import { formatIsoShortDate, parseIsoDate } from "../../lib/weekRange";

export const MONTHS_SHORT = [
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

/** v4 `stripRoomPrefix`: renders "Room" once, never "Room Room 301". */
export function stripRoomPrefix(room: string): string {
  return room.replace(/^Room\s+/i, "").trim();
}

/** v4 `formatCompactCardSchedule`: "Due 09:00" for same-time slots, "Oct 18"
 * dates, and the room appended when the display string does not carry it. */
export function formatCompactCardSchedule(
  display: string | null | undefined,
  room?: string | null,
): string {
  if (!display) {
    return room
      ? copy.dashboard.roomLabel(stripRoomPrefix(room))
      : copy.dashboard.scheduleScheduled;
  }
  let cleaned = display.replace(/\((\d{1,2}:\d{2})\s*-\s*\1\)/, `Due $1`);
  cleaned = cleaned.replace(
    /(\d{4})-(\d{2})-(\d{2})/,
    (_match, _year: string, month: string, day: string) => {
      const monthName = MONTHS_SHORT[Number(month) - 1] ?? month;
      return `${monthName} ${Number(day)}`;
    },
  );
  if (room && !cleaned.toLowerCase().includes(room.toLowerCase())) {
    cleaned += ` · ${stripRoomPrefix(room)}`;
  }
  return cleaned;
}

/** v4's dashboard-row date format ("Sun, Oct 18"), fixed to en-US so the
 * visual baselines do not depend on the host locale. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3) return iso;
  const date = new Date(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1);
  if (Number.isNaN(date.getTime())) return iso;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${weekdays[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** v4 `stripLeadingEmoji`: exam rules arrive with emoji bullets; the row
 * renders the text only. Code-point loop — regex character classes mislead
 * with variation selectors and ZWJ. */
export function stripLeadingEmoji(text: string): string {
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index) ?? 0;
    const isEmojiOrJoiner =
      (code >= 0x1f000 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      code === 0xfe0f ||
      code === 0x200d ||
      code === 0x20e3;
    if (!isEmojiOrJoiner) break;
    index += code > 0xffff ? 2 : 1;
  }
  return text.slice(index).trim();
}

/** en-US range labels for the "Next 7 days" KPI (v4 `kpi-week-subtext`).
 *  Seven calendar days: today plus the next six - the same window the core
 *  counts, so the printed range and the number can never disagree. */
export function weekRangeLabels(referenceDate: string | undefined): { start: string; end: string } {
  const base = parseIsoDate(referenceDate ?? "");
  const start = base && !Number.isNaN(base.getTime()) ? base : new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(
    start.getDate(),
  ).padStart(2, "0")}`;
  const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
  return {
    start: formatIsoShortDate(startIso, { weekday: true }),
    end: formatIsoShortDate(endIso, { weekday: true, year: true }),
  };
}
