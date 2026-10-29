/**
 * Pure lane-overlap assignment algorithm and coordinate math for QuizRadar week calendar.
 * Ported from v4 math with strict typing and unit test coverage.
 *
 * v4 parity (v4-final:static/app.js): 8 AM – 8 PM window, 56px hour rows,
 * 12-hour clock labels, and the same greedy lane-packing algorithm.
 */

export const START_HOUR = 8; // 8 AM
export const END_HOUR = 20; // 8 PM
export const HOUR_HEIGHT = 56; // 56px per hour

export const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface CalendarLaneItem {
  id: string;
  topPx: number;
  heightPx: number;
  laneIndex?: number;
  laneCount?: number;
}

/**
 * Calculates topPx and heightPx within the week grid.
 * Enforces minimum duration of 45 minutes (0.75h) so short events stay readable.
 */
export function computeBlockPosition(
  startHHMM?: string | null,
  endHHMM?: string | null,
  startHour = START_HOUR,
  endHour = END_HOUR,
  hourHeight = HOUR_HEIGHT,
): { topPx: number; heightPx: number } {
  const [sh, sm] = (startHHMM || "09:00").split(":").map(Number);
  const [eh, em] = (endHHMM || "10:30").split(":").map(Number);

  const validSh = isNaN(sh) ? 9 : sh;
  const validSm = isNaN(sm) ? 0 : sm;
  const validEh = isNaN(eh) ? validSh + 1 : eh;
  const validEm = isNaN(em) ? validSm + 30 : em;

  const startHours = Math.max(startHour, validSh + validSm / 60);
  const endHours = Math.min(endHour + 1, validEh + validEm / 60);
  const durationHours = Math.max(0.75, endHours - startHours);

  const topPx = Math.round((startHours - startHour) * hourHeight) + 1;
  const heightPx = Math.round(durationHours * hourHeight) - 3;
  return { topPx, heightPx };
}

/**
 * Pure greedy lane packing algorithm:
 * 1. Sorts items top-to-bottom, longer durations first.
 * 2. Groups intersecting items into temporal clusters.
 * 3. Packs items into lanes greedily (first lane with end time <= item start time + 2px).
 * 4. Assigns laneCount of the cluster to each item for width calc.
 */
export function assignOverlapLanes<T extends CalendarLaneItem>(items: T[]): T[] {
  if (items.length === 0) return items;

  // Sort ascending by topPx, then descending by heightPx
  items.sort((a, b) => a.topPx - b.topPx || b.heightPx - a.heightPx);

  let cluster: T[] = [];
  let clusterEnd = -1;

  const flushCluster = (group: T[]) => {
    if (group.length === 0) return;
    const lanes: number[] = [];

    group.forEach((item) => {
      let placedLane = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= item.topPx + 2) {
          placedLane = i;
          lanes[i] = item.topPx + item.heightPx;
          break;
        }
      }
      if (placedLane === -1) {
        placedLane = lanes.length;
        lanes.push(item.topPx + item.heightPx);
      }
      item.laneIndex = placedLane;
    });

    const totalLanes = lanes.length;
    group.forEach((item) => {
      item.laneCount = totalLanes;
    });
  };

  items.forEach((item) => {
    const itemBottom = item.topPx + item.heightPx;
    if (cluster.length === 0 || item.topPx < clusterEnd - 2) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, itemBottom);
    } else {
      flushCluster(cluster);
      cluster = [item];
      clusterEnd = itemBottom;
    }
  });

  flushCluster(cluster);
  return items;
}

/**
 * Mobile (< 768px) 3-day window clamping:
 * Follows the selected date within the current week, clamping between offset 0 and 4.
 * Desktop returns 7 days starting from offset 0.
 */
export function getClampedDayWindow(
  currentWeekStart: Date,
  selectedDate: Date,
  isNarrow: boolean,
): { dayOffset: number; dayCount: number } {
  if (!isNarrow) {
    return { dayOffset: 0, dayCount: 7 };
  }

  const dayMs = 86400000;
  const start = new Date(currentWeekStart);
  start.setHours(0, 0, 0, 0);
  const sel = new Date(selectedDate);
  sel.setHours(0, 0, 0, 0);

  const diffDays = Math.round((sel.getTime() - start.getTime()) / dayMs);
  const dayOffset = Math.min(4, Math.max(0, diffDays));
  return { dayOffset, dayCount: 3 };
}

// ---------------------------------------------------------------------------
// v4 display helpers (v4-final:static/app.js) — ported verbatim in behavior
// ---------------------------------------------------------------------------

/** "09:30" → "9:30am", "09:00" → "9am" (v4 `formatCompactTime`). */
export function formatCompactTime(hhmm?: string | null): string {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return "";
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return mStr === "00" ? `${h12}${ampm}` : `${h12}:${mStr}${ampm}`;
}

/**
 * Time-gutter hour label (v4): 8 → "8 AM", 12 → "12 PM", 13 → "1 PM".
 */
export function hourLabel(hour: number): string {
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

/**
 * Strips a leading "Room" prefix from a room string (v4 `stripRoomPrefix`).
 * v4 returned "TBA" for an empty room — v5 renders the honest em dash instead,
 * so an unknown room is never presented as a known one (AGENTS §1 honesty rule).
 */
export function stripRoomPrefix(room?: string | null): string {
  const raw = String(room ?? "").trim();
  if (!raw) return "—";
  return raw.replace(/^(Room\s*)+/i, "");
}

/** `#1a73e8` + alpha → `rgba(26, 115, 232, alpha)` (v4 `hexToRgba`). */
export function hexToRgba(hex: string | null | undefined, alpha: number): string {
  const clean = String(hex || "#1a73e8")
    .replace("#", "")
    .trim();
  if (clean.length !== 6) return `rgba(26, 115, 232, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((n) => isNaN(n))) return `rgba(26, 115, 232, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Local-calendar ISO date (`YYYY-MM-DD`) — NOT `toISOString()`, which shifts
 * the day for every user east/west of UTC.
 */
export function toIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** v4 `matchesGlobalSearch`: empty query matches everything, else case-insensitive includes. */
export function matchesGlobalSearch(
  query: string,
  ...fields: (string | null | undefined)[]
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f || "").toLowerCase().includes(q));
}
