/**
 * Pure lane-overlap assignment algorithm and coordinate math for QuizRadar week calendar.
 * Ported from v4 math with strict typing and unit test coverage.
 */

export const START_HOUR = 8;
export const END_HOUR = 21; // 08:00 to 21:00 inclusive (13 hours)
export const HOUR_HEIGHT = 60; // 60px per hour

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
