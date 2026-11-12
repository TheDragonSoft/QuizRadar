import { coursePalette } from "../../lib/coursePalette";
import { formatCompactTime, type CalendarLaneItem } from "../../lib/calendarLanes";
import type { Course, CustomCalendarEvent } from "../../state/types";

export interface BlockPalette {
  color: string;
  bg: string;
  border: string;
}

export interface CalendarBlockItem extends CalendarLaneItem {
  kind: "merged_exam" | "standalone_exam" | "class_slot" | "custom_event";
  title: string;
  courseId?: string | null;
  courseName?: string | null;
  assessmentType?: string | null;
  room?: string | null;
  group?: string | null;
  instructor?: string | null;
  eventType?: string | null;
  startTime: string;
  endTime: string;
  /** False when the source record had no real time and placement guessed one. */
  timeKnown: boolean;
  assessmentId?: string | null;
  eventId?: string | null;
  event?: CustomCalendarEvent;
  palette: BlockPalette;
  weekParity?: string | null;
}

/** Honest time label: real clock range when the source stated one, an em
 * dash when placement guessed a slot for a time-less record. */
export const blockTimeLabel = (item: CalendarBlockItem): string =>
  item.timeKnown
    ? `${formatCompactTime(item.startTime)} – ${formatCompactTime(item.endTime)}`
    : "Time —";

export const CUSTOM_EVENT_PALETTE: BlockPalette = {
  color: "#db2777",
  bg: "#fce7f3",
  border: "#db2777",
};

export const STUDY_BLOCK_PALETTE: BlockPalette = {
  color: "#10b981",
  bg: "#d1fae5",
  border: "#10b981",
};

export function isSolidHex(value?: string | null): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * Palette resolution (v4 semantics): a course's own palette wins, otherwise the
 * deterministic per-course preset. `border` must stay a solid hex so the dark
 * card tint can be derived from it.
 */
export function resolvePalette(
  courseId: string | null | undefined,
  courses: Map<string, Course>,
  override?: { color?: string | null; bg?: string | null; border?: string | null },
): BlockPalette {
  const course = courseId ? courses.get(courseId) : undefined;
  const derived = coursePalette(courseId || "");
  const color = override?.color || course?.color || derived.color;
  const bg = override?.bg || course?.bg || `${color}18`;
  const border =
    (isSolidHex(override?.border) ? (override?.border as string) : undefined) ||
    (isSolidHex(course?.border) ? (course?.border as string) : undefined) ||
    color;
  return { color, bg, border };
}

/** Device-local UTC offset label (v4 hardcoded "GMT+03" — that was wrong). */
export function localUtcOffsetLabel(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}
