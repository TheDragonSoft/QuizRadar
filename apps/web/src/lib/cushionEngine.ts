/**
 * Engine-derived study cushion (01 §4.4, R4).
 *
 * The interval-merge, deficit and honesty-withholding rules live in exactly
 * one place: `core/src/plan/cushion.rs`, reached here through the WASM
 * engine's `calculate_study_cushion` export
 * (`core/bindings/wasm/src/lib.rs:252`). This module is only the async
 * bridge + wire mapping — no cushion math lives in TS, so the two tiers
 * cannot drift.
 *
 * Honesty doctrine (inherited from the core):
 * - If any pending task on the date lacks an hour estimate, the core
 *   withholds `cushion_hours` with an honest warning note. Nothing is
 *   fabricated.
 * - A timetable slot without times cannot cross the engine boundary (the
 *   core requires concrete `HH:MM`) — such slots are skipped here rather
 *   than defaulted, so a time-less class never silently costs capacity.
 */

import { getWasmEngine } from "../pwadapters/wasmBridge";
import type {
  Assessment,
  CustomCalendarEvent,
  DailyStudyCushion,
  DailyStudyTask,
  ScheduleSlot,
} from "../state/types";
import {
  cushionFromCore,
  toCoreAssessments,
  toCoreCalendarEvent,
  toCoreSlot,
  toCoreStudyTask,
} from "./coreWire";

/** Matches `core::plan::cushion::DEFAULT_WAKING_HOURS` (15.0h). */
export const DEFAULT_WAKING_HOURS = 15.0;

/**
 * Calculates the study cushion and deficit for one calendar date through the
 * core engine. Throws when the engine is unavailable or the payload cannot
 * cross the wire — the caller decides how honestly to degrade.
 */
export async function calculateDailyStudyCushionCore(
  dateIso: string,
  slots: ScheduleSlot[],
  customEvents: CustomCalendarEvent[],
  assessments: Assessment[],
  tasks: DailyStudyTask[],
  wakingHours: number = DEFAULT_WAKING_HOURS,
): Promise<DailyStudyCushion> {
  const engine = await getWasmEngine();

  const coreSlots = slots
    .map(toCoreSlot)
    .filter((slot): slot is Record<string, unknown> => slot !== null);

  const raw = engine.calculate_study_cushion(
    JSON.stringify({ semester: null, courses: [], slots: coreSlots }),
    JSON.stringify(customEvents.map(toCoreCalendarEvent)),
    JSON.stringify(toCoreAssessments(assessments)),
    JSON.stringify(tasks.map((task) => toCoreStudyTask(task, dateIso))),
    dateIso,
    wakingHours,
  );
  return cushionFromCore(JSON.parse(raw) as Record<string, unknown>, dateIso);
}
