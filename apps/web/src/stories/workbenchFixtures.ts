/**
 * Workbench fixtures for the Ladle stories — dev-only tooling (see
 * `apps/web/AGENTS.md`). Never imported by app code; excluded from the
 * shipped bundle, vitest and coverage.
 *
 * The payloads come from `src/testdata/contract/` — the JSON the Rust core
 * really produced (the contract tests pin those bytes). To keep the
 * workbench evergreen, every pure date is shifted by ONE uniform delta so
 * the fixture's reference day (`dashboard.reference_date`) lands on today.
 * A uniform shift preserves every core-derived relative number (`days_until`,
 * `day_offset`, priority scores, urgency), so only the weekday-derived
 * display strings (`day_name`, `display_time`, `display_day`) are rebuilt.
 * Missing rooms stay `null` exactly as captured — the views render "—".
 */

import { useAppStore } from "../state/store";
import { addDaysToIsoDate, getWeekStart } from "../state/dateUtils";
import { normalizeStatePayload } from "../state/ipcShape";
import { applyThemeToDocument, getInitialTheme } from "../state/storage";
import { getLocalDateString } from "../state/watchdog";
import type { GetStatePayload, ThemeMode, ToastItem, View } from "../state/types";

import assessmentsJson from "../testdata/contract/assessments.json";
import dashboardJson from "../testdata/contract/dashboard-summary.json";
import desktopAuthJson from "../testdata/contract/desktop-auth.json";
import desktopConfigJson from "../testdata/contract/desktop-config.json";
import scheduleJson from "../testdata/contract/schedule.json";
import studyTasksJson from "../testdata/contract/study-tasks-payload.json";

type Rec = Record<string, unknown>;

/** Pure ISO dates (and ISO datetimes, whose time-of-day is preserved). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
function diffDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** "09:00" → "9:00 AM" (the 12-hour style the core's display_time uses). */
function to12Hour(hhmm: string): string {
  const [hour, minute] = hhmm.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const DAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const DAY_SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const MONTH_DAY_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Deep, in-place shift of every ISO date string by `delta` days. Datetimes
 * keep their time-of-day suffix; everything else passes through untouched.
 */
function shiftIsoDates(value: unknown, delta: number): void {
  if (Array.isArray(value)) {
    for (const item of value) shiftIsoDates(item, delta);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && ISO_DATE.test(item)) {
      (value as Rec)[key] = addDaysToIsoDate(item.slice(0, 10), delta) + item.slice(10);
    } else {
      shiftIsoDates(item, delta);
    }
  }
}

/** Rebuilds the weekday-derived labels of one assessment-shaped object. */
function rebuildAssessmentLabels(assessment: Rec): void {
  if (typeof assessment.date_iso !== "string") return;
  const date = new Date(Date.parse(assessment.date_iso));
  assessment.day_name = DAY_LONG.format(date);
  if (typeof assessment.start_time === "string" && typeof assessment.end_time === "string") {
    assessment.display_time =
      `${DAY_LONG.format(date)}, ${date.getUTCDate()} ${MONTH_LONG.format(date)} ` +
      `${date.getUTCFullYear()} (${to12Hour(assessment.start_time)} – ${to12Hour(assessment.end_time)})`;
    return;
  }
  // Assessment-shaped objects WITHOUT times (study recommendations) still
  // carry a stale display_time string — rebuild its date part and preserve
  // whatever "(…)" time segment the core appended.
  if (typeof assessment.display_time === "string") {
    const timeSegment = assessment.display_time.match(/\((.*)\)\s*$/);
    assessment.display_time =
      `${DAY_LONG.format(date)}, ${date.getUTCDate()} ${MONTH_LONG.format(date)} ` +
      `${date.getUTCFullYear()}${timeSegment ? ` (${timeSegment[1]})` : ""}`;
  }
}

/** The core's "Today · Fri, Oct 23" style day label, rebuilt for `todayIso`. */
function displayDayFor(dateIso: string, todayIso: string): string {
  const offset = diffDays(todayIso, dateIso);
  const label = `${DAY_SHORT.format(Date.parse(dateIso))}, ${MONTH_DAY_SHORT.format(Date.parse(dateIso))}`;
  if (offset === 0) return `Today · ${label}`;
  if (offset === 1) return `Tomorrow · ${label}`;
  return label;
}

/**
 * The full normalized app state, built from the real contract fixtures and
 * re-dated so the fixture's exam week straddles today.
 */
export function buildWorkbenchState(): GetStatePayload {
  const config = structuredClone(desktopConfigJson) as unknown as Rec;
  const auth = structuredClone(desktopAuthJson) as unknown as Rec;
  const schedule = structuredClone(scheduleJson) as unknown as Rec;
  const assessments = structuredClone(assessmentsJson) as unknown as Rec[];
  const dashboard = structuredClone(dashboardJson) as unknown as Rec;
  const studyTasks = structuredClone(studyTasksJson) as unknown as Rec;

  const todayIso = getLocalDateString();
  const reference =
    typeof dashboard.reference_date === "string" ? dashboard.reference_date : todayIso;
  shiftIsoDates(
    { config, auth, schedule, assessments, dashboard, studyTasks },
    diffDays(reference, todayIso),
  );

  for (const assessment of assessments) rebuildAssessmentLabels(assessment);
  if (dashboard.next_up && typeof dashboard.next_up === "object") {
    rebuildAssessmentLabels(dashboard.next_up as Rec);
  }
  for (const key of ["upcoming_this_week", "all_upcoming", "study_recommendations"] as const) {
    const list = dashboard[key];
    if (Array.isArray(list)) for (const item of list) rebuildAssessmentLabels(item as Rec);
  }

  const days = Array.isArray(studyTasks.days) ? (studyTasks.days as Rec[]) : [];
  for (const day of days) {
    if (typeof day.date_iso === "string") {
      day.day_offset = diffDays(todayIso, day.date_iso);
      day.is_today = day.day_offset === 0;
      day.display_day = displayDayFor(day.date_iso, todayIso);
      const tasks = Array.isArray(day.tasks) ? (day.tasks as Rec[]) : [];
      for (const task of tasks) {
        if (typeof task.target_date_iso === "string") {
          task.display_day = displayDayFor(task.target_date_iso, todayIso);
        }
      }
    }
  }

  // Readiness cards carry a non-ISO `display_date` string next to their
  // `date_iso` — rebuild it from the shifted date like the labels above.
  const readinessCards = Array.isArray(studyTasks.readiness_cards)
    ? (studyTasks.readiness_cards as Rec[])
    : [];
  for (const card of readinessCards) {
    if (typeof card.date_iso === "string") {
      const date = new Date(Date.parse(card.date_iso));
      card.display_date =
        `${DAY_LONG.format(date)}, ${date.getUTCDate()} ${MONTH_LONG.format(date)} ` +
        `${date.getUTCFullYear()}`;
    }
  }

  return normalizeStatePayload({
    config,
    auth,
    schedule,
    assessments,
    dashboard,
    studyTasksPayload: studyTasks,
  } as unknown as GetStatePayload);
}

/**
 * Every theme id the app ships (state/types.ts ThemeMode): the two generic
 * mode ids plus the three concrete themes. `light` and `dark` are NOT
 * separate visual themes — `applyThemeToDocument` normalizes them onto the
 * Solar/Obsidian attributes exactly like the app's TopBar toggle does, so a
 * `theme=dark` story renders the user's preferred dark theme (Obsidian
 * unless a `quizradar-theme-preferred-dark` pick is stored). The AMOLED
 * Pure/Sparkle variants from the v1 gallery were retired from the app.
 */
const KNOWN_THEMES: readonly ThemeMode[] = ["light", "dark", "obsidian", "solar", "amoled-nebula"];

/** The explicit `?theme=` URL param, resolved (`system` → OS preference). */
function urlThemeParam(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("theme");
  if (fromUrl === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  if (fromUrl && (KNOWN_THEMES as readonly string[]).includes(fromUrl)) {
    return fromUrl as ThemeMode;
  }
  return null;
}

/**
 * The workbench theme for this render, in priority order:
 * 1. the explicit `?theme=` URL param (deterministic for agents/screenshots),
 * 2. the page's current `data-theme` attribute — Ladle's banner button and
 *    the app both write it, so an interactive click survives story switches
 *    (`theme-bridge.css` renders both vocabularies correctly),
 * 3. the app's own boot resolution (localStorage → system → generic id),
 * 4. Obsidian.
 */
function resolveWorkbenchTheme(fallback?: ThemeMode): ThemeMode {
  const fromUrl = urlThemeParam();
  if (fromUrl) return fromUrl;
  if (typeof window !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr && (KNOWN_THEMES as readonly string[]).includes(attr)) {
      return attr as ThemeMode;
    }
  }
  return fallback ?? getInitialTheme();
}

/**
 * Seeds the zustand store the same way the view tests do (fresh fixture data
 * every call), plus the workbench's neutral chrome state.
 *
 * Theme is re-asserted on the microtask/rAF/task queues because Ladle's own
 * chrome writes `data-theme` (its banner theme) in effects that run after
 * the story's — the last write must be the app's.
 */
export function seedWorkbench(options?: {
  theme?: ThemeMode;
  view?: View;
  toasts?: ToastItem[];
  activeModalAssessmentId?: string | null;
  searchQuery?: string;
}): void {
  const theme = resolveWorkbenchTheme(options?.theme);
  const todayIso = getLocalDateString();
  useAppStore.setState({
    data: buildWorkbenchState(),
    hasLoaded: true,
    isOffline: false,
    view: options?.view ?? "dashboard",
    theme,
    selectedCourseIds: null,
    activeSourceFilter: "ALL",
    activeTypeFilter: "ALL",
    activeCourseFilterTasks: "ALL",
    activeModalAssessmentId: options?.activeModalAssessmentId ?? null,
    searchQuery: options?.searchQuery ?? "",
    openModals: [],
    toasts: options?.toasts ?? [],
    // Calendar grid seams the views derive from the real clock; pin them so
    // the fixture week and the grid always agree.
    currentWeekStart: getWeekStart(todayIso),
    selectedCalendarDate: todayIso,
    layers: { exams: true, classes: true },
  });
  if (typeof window === "undefined") return;
  // With an explicit `?theme=` param, apply it through the app's own applier
  // (translates generic ids, persists the choice, updates the meta tag).
  // Without one, leave the attribute alone — Ladle's banner button is the
  // interactive authority there, and the `.ladle` observer keeps Tailwind's
  // `.dark` class in sync with whichever value the page carries.
  // Re-resolve at APPLY time: Ladle's button rewrites the URL on click, and
  // its history write can land after this render captured the old param.
  window.setTimeout(() => {
    const current = urlThemeParam();
    if (current) applyThemeToDocument(current);
  }, 0);
}

/**
 * Conflict-banner state: the fixture's own conflicts (or a representative
 * same-day exam pair when the fixture captured none), with the mitigation
 * flag forced to `mitigated`. The mitigated variant carries the covering
 * study block as a custom event, mirroring the view-test pattern.
 */
export function withConflictData(mitigated: boolean): GetStatePayload {
  const data = buildWorkbenchState();
  const todayIso = getLocalDateString();
  const alerts = (
    data.dashboard.conflictAlerts.length > 0
      ? data.dashboard.conflictAlerts.map((alert) => ({ ...alert, isMitigated: mitigated }))
      : [
          {
            assessmentAId: "teams-1",
            assessmentBId: "moodle-1",
            titleA: "CSE241 Midterm Exam",
            titleB: "GSE211 Online Quiz",
            dateA: todayIso,
            dateB: todayIso,
            severity: "critical" as const,
            hoursBetween: 4,
            message: "Critical same-day exam overload (4h gap)",
            dismissed: false,
            isMitigated: mitigated,
          },
        ]
  ) as GetStatePayload["dashboard"]["conflictAlerts"];
  return {
    ...data,
    config: {
      ...data.config,
      customEvents: mitigated
        ? [
            {
              id: "study-block-teams-1",
              title: "Study: Midterm Exam",
              courseId: "CSE241",
              dateIso: todayIso,
            },
          ]
        : data.config.customEvents,
    },
    dashboard: { ...data.dashboard, conflictAlerts: alerts },
  };
}
