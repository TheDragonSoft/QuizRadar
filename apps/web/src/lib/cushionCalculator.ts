/**
 * Study Cushion and Availability Deficit Calculator (01 §4.4, R4).
 *
 * Honesty doctrine matching core/src/plan/cushion.rs:
 * - Daily available study capacity = waking hours (default 15.0h) minus committed hours
 *   (timetabled classes matching day + week parity, timed custom events, scheduled exams).
 * - If any pending study task on that date lacks an estimatedHours value, cushion calculation
 *   is withheld with an honest warning note ("Cushion calculation unavailable: N tasks lack hour estimates").
 *   No estimates are fabricated.
 * - When all pending tasks have estimates, if required study hours exceed available capacity,
 *   isDeficit: true with deficitHours: available - required.
 */

import type {
  Assessment,
  CustomCalendarEvent,
  DailyStudyCushion,
  DailyStudyTask,
  ScheduleSlot,
} from "../state/types";
import { slotMatchesDate } from "./weekParity";

export const DEFAULT_WAKING_HOURS = 15.0;

function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) return null;
  const hours = parseInt(parts[0] ?? "", 10);
  const minutes = parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Calculates study cushion and availability deficit for a single calendar date.
 */
export function calculateDailyStudyCushion(
  dateIso: string,
  slots: ScheduleSlot[],
  customEvents: CustomCalendarEvent[],
  assessments: Assessment[],
  tasks: DailyStudyTask[],
  wakingHours: number = DEFAULT_WAKING_HOURS,
): DailyStudyCushion {
  const waking = Math.max(1.0, Math.min(24.0, wakingHours));

  // 1. Timetabled class slot duration
  let slotMinutes = 0;
  for (const slot of slots) {
    if (slotMatchesDate(slot, dateIso)) {
      const startMin = parseTimeToMinutes(slot.startTime);
      const endMin = parseTimeToMinutes(slot.endTime);
      if (startMin !== null && endMin !== null && endMin > startMin) {
        slotMinutes += endMin - startMin;
      }
    }
  }

  // 2. Timed custom events on this date
  let eventMinutes = 0;
  for (const event of customEvents) {
    if (event.dateIso === dateIso) {
      const startMin = parseTimeToMinutes(event.startTime);
      const endMin = parseTimeToMinutes(event.endTime);
      if (startMin !== null && endMin !== null && endMin > startMin) {
        eventMinutes += endMin - startMin;
      }
    }
  }

  // 3. Scheduled exams / assessments on this date
  let examMinutes = 0;
  for (const assessment of assessments) {
    if (assessment.dateIso === dateIso && !assessment.retiredSourceRun) {
      const startMin = parseTimeToMinutes(assessment.startTime);
      const endMin = parseTimeToMinutes(assessment.endTime);
      if (startMin !== null && endMin !== null && endMin > startMin) {
        examMinutes += endMin - startMin;
      } else {
        // Untimed assessment on date: count standard 2-hour exam block
        examMinutes += 120;
      }
    }
  }

  const totalCommittedMinutes = slotMinutes + eventMinutes + examMinutes;
  const committedHours = Math.round((totalCommittedMinutes / 60.0) * 10) / 10;
  const availableHours = Math.round(Math.max(0, waking - committedHours) * 10) / 10;

  // 4. Tasks for this date
  const dateTasks = tasks.filter(
    (t) => (t.targetDateIso === dateIso || t.targetDateIso === undefined) && !t.completed,
  );

  const missingEstimateCount = dateTasks.filter(
    (t) => t.estimatedHours === undefined || t.estimatedHours === null,
  ).length;

  if (missingEstimateCount > 0) {
    const warningNote =
      missingEstimateCount === 1
        ? "Cushion calculation unavailable: 1 task lacks hour estimates"
        : `Cushion calculation unavailable: ${missingEstimateCount} tasks lack hour estimates`;

    return {
      date: dateIso,
      wakingHours: waking,
      committedHours,
      availableHours,
      requiredHours: null,
      cushionHours: null,
      isDeficit: false,
      deficitHours: null,
      warningNote,
      waking_hours: waking,
      committed_hours: committedHours,
      available_hours: availableHours,
      required_hours: null,
      cushion_hours: null,
      is_deficit: false,
      deficit_hours: null,
      warning_note: warningNote,
    };
  }

  const reqSum = dateTasks.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
  const requiredHours = Math.round(reqSum * 10) / 10;
  const cushionHours = Math.round((availableHours - requiredHours) * 10) / 10;

  if (cushionHours < 0) {
    const deficitHours = Math.round(-cushionHours * 10) / 10;
    const warningNote = `Study deficit of ${deficitHours.toFixed(1)}h detected: scheduled commitments leave insufficient study time`;
    return {
      date: dateIso,
      wakingHours: waking,
      committedHours,
      availableHours,
      requiredHours,
      cushionHours,
      isDeficit: true,
      deficitHours,
      warningNote,
      waking_hours: waking,
      committed_hours: committedHours,
      available_hours: availableHours,
      required_hours: requiredHours,
      cushion_hours: cushionHours,
      is_deficit: true,
      deficit_hours: deficitHours,
      warning_note: warningNote,
    };
  }

  return {
    date: dateIso,
    wakingHours: waking,
    committedHours,
    availableHours,
    requiredHours,
    cushionHours,
    isDeficit: false,
    deficitHours: null,
    warningNote: null,
    waking_hours: waking,
    committed_hours: committedHours,
    available_hours: availableHours,
    required_hours: requiredHours,
    cushion_hours: cushionHours,
    is_deficit: false,
    deficit_hours: null,
    warning_note: null,
  };
}
