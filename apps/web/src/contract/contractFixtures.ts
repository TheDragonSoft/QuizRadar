/**
 * The canonical contract fixtures.
 *
 * Every file in `src/testdata/contract/` is a payload the Rust core really
 * produces — the shapes `serde` writes for `core/src/types.rs`,
 * `core/src/plan/**` and the desktop shell's `get_state` command. They are
 * loaded from disk (not imported as modules) so the test sees exactly the
 * bytes a shell would receive.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURE_DIR } from "./contractSpec";

export type JsonObject = Record<string, unknown>;

/** Read one fixture file. */
export function readFixture<T = JsonObject>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

/** A deep copy, so a drift case can mutate a fixture without side effects. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Every assessment the core knows about (snake_case wire shape). */
export const assessmentsFixture: JsonObject[] = readFixture<JsonObject[]>("assessments.json");

/** The derived dashboard summary (snake_case wire shape). */
export const dashboardFixture: JsonObject = readFixture("dashboard-summary.json");

/** The derived study roadmap (snake_case wire shape). */
export const studyTasksFixture: JsonObject = readFixture("study-tasks-payload.json");

/** The user's timetable (snake_case wire shape). */
export const scheduleFixture: JsonObject = readFixture("schedule.json");

/** The desktop shell's config (camelCase — the shell serializes it that way). */
export const desktopConfigFixture: JsonObject = readFixture("desktop-config.json");

/** The desktop shell's auth profile (camelCase). */
export const desktopAuthFixture: JsonObject = readFixture("desktop-auth.json");

/**
 * The payload the desktop shell's `get_state` command returns.
 *
 * The shell serializes `DesktopConfig`/`DesktopAuthProfile` in camelCase
 * (`#[serde(rename_all = "camelCase")]` on the shell's own structs) and
 * hands the core's structs through untouched — so the payload is camelCase
 * at the top and snake_case inside `schedule`, `assessments`, `dashboard`
 * and `studyTasksPayload`.
 */
export const statePayloadFixture: JsonObject = {
  config: desktopConfigFixture,
  auth: desktopAuthFixture,
  schedule: scheduleFixture,
  assessments: assessmentsFixture,
  dashboard: dashboardFixture,
  studyTasksPayload: studyTasksFixture,
};
