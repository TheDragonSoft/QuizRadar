/**
 * ISO 8601 week parity calculation and alternating timetable matching (01 §4.4, R4).
 *
 * Honesty doctrine:
 * - "week_a" for odd ISO calendar weeks, "week_b" for even ISO weeks.
 * - Matches timetable slots by day of week and parity ("all", "week_a", "week_b").
 */

import type { ScheduleSlot } from "../state/types";

export type WeekParity = "week_a" | "week_b";
export type WeekParityFilter = "all" | "auto" | "week_a" | "week_b";

/**
 * Returns the ISO 8601 week number (1-53) for a given date.
 * Anchored to UTC noon to prevent timezone drifting.
 */
export function getIsoWeekNumber(dateInput: Date | string): number {
  let d: Date;
  if (typeof dateInput === "string") {
    const [y, m, day] = dateInput.split("-").map(Number);
    d = new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1, 12, 0, 0));
  } else {
    d = new Date(Date.UTC(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate(), 12, 0, 0));
  }

  const dayNum = d.getUTCDay() || 7; // Sunday is 7 in ISO
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Returns "week_a" (odd ISO week) or "week_b" (even ISO week).
 */
export function getWeekParity(dateInput: Date | string): WeekParity {
  const weekNumber = getIsoWeekNumber(dateInput);
  return weekNumber % 2 !== 0 ? "week_a" : "week_b";
}

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Maps day string or dayIndex to 0-6 weekday (Sunday = 0).
 */
export function normalizeDayIndex(day: string | number): number | null {
  if (typeof day === "number") {
    return day >= 0 && day <= 6 ? day : null;
  }
  const clean = day.trim().toLowerCase();
  return DAY_NAME_TO_INDEX[clean] ?? null;
}

/**
 * Checks whether a schedule slot matches the given date's parity.
 */
export function slotMatchesParity(
  slot: { weekParity?: string | null; week_parity?: string | null },
  dateInput: Date | string,
  filterOverride?: WeekParityFilter,
): boolean {
  if (filterOverride === "all") return true;
  if (filterOverride === "week_a") {
    const slotParity = (slot.weekParity ?? slot.week_parity ?? "all").trim().toLowerCase();
    return slotParity === "all" || slotParity === "" || slotParity === "week_a";
  }
  if (filterOverride === "week_b") {
    const slotParity = (slot.weekParity ?? slot.week_parity ?? "all").trim().toLowerCase();
    return slotParity === "all" || slotParity === "" || slotParity === "week_b";
  }

  const slotParity = (slot.weekParity ?? slot.week_parity ?? "all").trim().toLowerCase();
  if (slotParity === "all" || slotParity === "") return true;

  const currentParity = getWeekParity(dateInput);
  return slotParity === currentParity;
}

/**
 * Checks whether a timetable slot runs on the specific calendar date (matching weekday and parity).
 */
export function slotMatchesDate(
  slot: ScheduleSlot,
  dateInput: Date | string,
  filterOverride?: WeekParityFilter,
): boolean {
  let targetWeekday: number;
  if (typeof dateInput === "string") {
    const [y, m, day] = dateInput.split("-").map(Number);
    const d = new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1, 12, 0, 0));
    targetWeekday = d.getUTCDay();
  } else {
    targetWeekday = dateInput.getDay();
  }

  const slotWeekday = slot.dayIndex !== undefined ? slot.dayIndex : normalizeDayIndex(slot.day);
  if (slotWeekday !== targetWeekday) {
    return false;
  }

  return slotMatchesParity(slot, dateInput, filterOverride);
}
