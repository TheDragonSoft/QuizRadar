/**
 * Browser RPC adapter for the QuizRadar PWA tier.
 * Implements the exact same typed IPC contract as Desktop Tauri 2 (apps/desktop/src-tauri/src/commands/),
 * powered by the pure Rust WASM engine (`QuizRadarWasm`) and IndexedDB persistence.
 */

import { APP_VERSION } from "../generated/version";
import type {
  Assessment,
  Course,
  CustomCalendarEvent,
  DesktopAuthProfile,
  DesktopConfig,
  FeedConfig,
  GetStatePayload,
  ScheduleData,
  ScheduleSlot,
  StudyTasksPayload,
} from "../state/types";
import {
  deleteCourse,
  deleteCustomEvent,
  deleteFeed,
  idbResetAll,
  loadAllConfig,
  loadAssessments,
  loadCustomEvents,
  loadFeeds,
  loadGrades,
  loadScheduleData,
  loadTopicsDone,
  saveAssessments,
  saveGrade,
  saveScheduleData,
  setConfigValue,
  setTopicDone,
  upsertCourse,
  upsertCustomEvent,
  upsertFeed,
  type IdbGradeRecord,
} from "./idbStore";
import { getWasmEngine } from "./wasmBridge";
import {
  DEFAULT_BROWSER_GOOGLE_CLIENT_ID,
  getMemoryGoogleToken,
  getMemoryMsToken,
  scanBrowserFeeds,
  setMemoryGoogleToken,
  setMemoryMsToken,
  validateGeminiKeyBrowser,
} from "./browserSources";

/**
 * The desktop IPC contract speaks camelCase, but the browser tier persists
 * configuration in the same snake_case keys the Rust core uses. Without this
 * mapping a saved OAuth client ID was written under `googleClientId` and then
 * read back as `google_client_id` — i.e. it never survived a reload, which is
 * exactly why the browser sign-in kept asking for a client ID.
 */
const CONFIG_KEY_MAP: Record<string, string> = {
  autoSyncGcal: "auto_sync_gcal",
  syncWeeklyClassesToGcal: "sync_weekly_classes_to_gcal",
  geminiEnabled: "gemini_enabled",
  onboardingCompleted: "onboarding_completed",
  teamsEnabled: "teams_enabled",
  teamsClientId: "teams_client_id",
  teamsAccountName: "teams_account_name",
  teamsAccountEmail: "teams_account_email",
  googleClientId: "google_client_id",
  moodleEnabled: "moodle_enabled",
  moodleUrl: "moodle_url",
  moodleIcalUrl: "moodle_ical_url",
  classroomEnabled: "classroom_enabled",
  dismissConflictBanner: "dismiss_conflict_banner",
  userEmail: "user_email",
  userName: "user_name",
  userPicture: "user_picture",
};

export function toRustAssessment(a: Assessment | Record<string, unknown>): Record<string, unknown> {
  const rec = a as unknown as Record<string, unknown>;
  return {
    ...rec,
    course_id: rec.course_id ?? rec.courseId ?? null,
    course_name: rec.course_name ?? rec.courseName ?? null,
    assessment_type: rec.assessment_type ?? rec.assessmentType ?? "Class Quiz",
    date_iso: rec.date_iso ?? rec.dateIso ?? null,
    day_name: rec.day_name ?? rec.dayName ?? null,
    start_time: rec.start_time ?? rec.startTime ?? null,
    end_time: rec.end_time ?? rec.endTime ?? null,
    display_time: rec.display_time ?? rec.displayTime ?? null,
    is_upcoming: rec.is_upcoming ?? rec.isUpcoming ?? true,
    days_until: rec.days_until ?? rec.daysUntil ?? null,
    urgency_level: rec.urgency_level ?? rec.urgencyLevel ?? "upcoming",
    priority_score: rec.priority_score ?? rec.priorityScore ?? 0,
    topics: rec.topics ?? [],
    warnings: rec.warnings ?? [],
    source: rec.source ?? "email",
    achieved_score: rec.achieved_score ?? rec.achievedScore ?? null,
    max_score: rec.max_score ?? rec.maxScore ?? null,
    weightage_percent: rec.weightage_percent ?? rec.weightagePercent ?? null,
  };
}

export function toJsAssessment(a: Record<string, unknown>): Assessment {
  return {
    ...(a as unknown as Assessment),
    courseId: (a.course_id ?? a.courseId ?? null) as string | null,
    courseName: (a.course_name ?? a.courseName ?? null) as string | null,
    assessmentType: (a.assessment_type ?? a.assessmentType ?? "Class Quiz") as string,
    dateIso: (a.date_iso ?? a.dateIso ?? null) as string | null,
    dayName: (a.day_name ?? a.dayName ?? null) as string | null,
    startTime: (a.start_time ?? a.startTime ?? null) as string | null,
    endTime: (a.end_time ?? a.endTime ?? null) as string | null,
    displayTime: (a.display_time ?? a.displayTime ?? null) as string | null,
    isUpcoming: Boolean(a.is_upcoming ?? a.isUpcoming ?? true),
    daysUntil: (a.days_until ?? a.daysUntil ?? null) as number | null,
    urgencyLevel: (a.urgency_level ?? a.urgencyLevel ?? "upcoming") as Assessment["urgencyLevel"],
    priorityScore: Number(a.priority_score ?? a.priorityScore ?? 0),
    achievedScore: (a.achieved_score ?? a.achievedScore ?? null) as number | null,
    maxScore: (a.max_score ?? a.maxScore ?? null) as number | null,
    weightagePercent: (a.weightage_percent ?? a.weightagePercent ?? null) as number | null,
  };
}

/**
 * The core's slot shape, exactly as `core/src/types.rs` declares it. Used
 * for the backup export so the browser tier writes the same snake_case
 * contract the desktop tier does (the core ignores unknown fields, but the
 * file is user-visible and should stay clean).
 */
function toRustSlotPayload(slot: Record<string, unknown>): Record<string, unknown> {
  return {
    id: slot.id,
    day: slot.day,
    day_index: slot.day_index ?? slot.dayIndex ?? 0,
    course_id: slot.course_id ?? slot.courseId ?? "",
    course_name: slot.course_name ?? slot.courseName ?? "",
    type: slot.type ?? slot.slotType ?? "Lecture",
    group: slot.group ?? null,
    room: slot.room ?? null,
    start_time: slot.start_time ?? slot.startTime ?? "09:00",
    end_time: slot.end_time ?? slot.endTime ?? "10:30",
    display_time: slot.display_time ?? slot.displayTime ?? "",
    has_quiz: slot.has_quiz ?? slot.hasQuiz ?? false,
    quiz_title: slot.quiz_title ?? slot.quizTitle ?? null,
  };
}

/** A schedule in the core's wire shape (snake_case), for the backup export. */
export function toRustSchedulePayload(schedule: ScheduleData): Record<string, unknown> {
  return {
    semester: schedule.semester ?? null,
    courses: (schedule.courses || []).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      bg: c.bg ?? null,
      border: c.border ?? null,
    })),
    slots: (schedule.slots || []).map((s) =>
      toRustSlotPayload(s as unknown as Record<string, unknown>),
    ),
  };
}

export async function buildFullState(refDate?: string): Promise<GetStatePayload> {
  const schedule = await loadScheduleData();
  const rawAssessments = await loadAssessments();
  const topicsDone = await loadTopicsDone();
  const grades = await loadGrades();
  const events = await loadCustomEvents();
  const feeds = await loadFeeds();
  const allConfig = await loadAllConfig();

  const todayIso = refDate || new Date().toISOString().split("T")[0];

  // Merge grades onto assessments and normalize to Rust shape
  const assessmentsWithGrades = rawAssessments.map((a) => {
    const g = grades[a.id];
    const achieved = g?.achieved_score ?? a.achievedScore ?? a.achieved_score;
    const max = g?.max_score ?? a.maxScore ?? a.max_score;
    const weight = g?.weightage_percent ?? a.weightagePercent ?? a.weightage_percent;
    return toRustAssessment({
      ...a,
      achieved_score: achieved,
      max_score: max,
      weightage_percent: weight,
    });
  });

  const wasm = await getWasmEngine();

  // Sort assessments into canonical radar order via WASM
  const orderedJson = wasm.radar_order(JSON.stringify(assessmentsWithGrades), todayIso);
  const rawOrdered = JSON.parse(orderedJson) as Array<Record<string, unknown>>;
  const orderedAssessments = rawOrdered.map(toJsAssessment);

  // Derive dashboard summary via WASM
  const dashboardJson = wasm.derive_dashboard(
    JSON.stringify(rawOrdered),
    JSON.stringify(topicsDone),
    JSON.stringify(events),
    todayIso,
  );
  const dashboard = JSON.parse(dashboardJson);

  // Derive study tasks via WASM
  const tasksJson = wasm.derive_tasks(
    JSON.stringify(rawOrdered),
    JSON.stringify(schedule),
    JSON.stringify(topicsDone),
    todayIso,
  );
  const studyTasksPayload = JSON.parse(tasksJson) as StudyTasksPayload;

  const config: DesktopConfig = {
    autoSyncGcal: false, // Honesty: GCal background sync unavailable in browser PWA
    syncWeeklyClassesToGcal: false,
    geminiEnabled: Boolean(allConfig.gemini_enabled),
    onboardingCompleted: Boolean(allConfig.onboarding_completed),
    teamsEnabled: Boolean(allConfig.teams_enabled),
    teamsClientId: (allConfig.teams_client_id as string) || null,
    teamsAccountName: (allConfig.teams_account_name as string) || null,
    teamsAccountEmail: (allConfig.teams_account_email as string) || null,
    googleClientId: (allConfig.google_client_id as string) || DEFAULT_BROWSER_GOOGLE_CLIENT_ID,
    moodleEnabled: Boolean(allConfig.moodle_enabled),
    moodleUrl: (allConfig.moodle_url as string) || null,
    moodleIcalUrl: (allConfig.moodle_ical_url as string) || null,
    classroomEnabled: Boolean(allConfig.classroom_enabled),
    dismissConflictBanner: Boolean(allConfig.dismiss_conflict_banner),
    syncedGcalMap: {},
    feeds,
    customEvents: events,
    lastGmailSync: (allConfig.last_gmail_sync as string) || null,
    lastGcalSync: null,
    lastBackupPush: (allConfig.last_backup_push as string) || null,
    userEmail: (allConfig.user_email as string) || null,
    userName: (allConfig.user_name as string) || null,
    userPicture: (allConfig.user_picture as string) || null,
  };

  const auth: DesktopAuthProfile = {
    authenticated: Boolean(getMemoryGoogleToken() || allConfig.user_email),
    email: (allConfig.user_email as string) || null,
    name: (allConfig.user_name as string) || null,
    picture: (allConfig.user_picture as string) || null,
    hasGmailScope: Boolean(getMemoryGoogleToken()),
    hasCalendarScope: false, // Browser tier cannot push to native calendar
    hasTeamsAuth: Boolean(getMemoryMsToken()),
  };

  return {
    config,
    auth,
    schedule,
    assessments: orderedAssessments,
    dashboard,
    studyTasksPayload,
  };
}

/**
 * The running browser-tier scan, if any. `cancel_sync` aborts it, which
 * drops the in-flight feed request so a canceled scan writes nothing.
 */
let activeScanController: AbortController | null = null;

/**
 * The "Last synced" stamp, in the same human-readable local shape the
 * desktop shell writes (`2026-10-28 19:04`) — the UI shows it verbatim.
 */
function lastSyncedStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Dispatches an RPC command to the local browser / WASM implementation.
 */
export async function pwaRpcHandler<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  switch (fn) {
    case "version":
      return APP_VERSION as T;

    case "get_state":
      return (await buildFullState()) as T;

    case "save_schedule": {
      const schedule = (args?.schedule || args) as ScheduleData;
      await saveScheduleData(schedule);
      return (await buildFullState()) as T;
    }

    case "upsert_course": {
      const course = (args?.course || args) as Course;
      const slots = ((args?.slots || []) as ScheduleSlot[]) ?? [];
      await upsertCourse(course);
      // The browser tier used to drop the timetable slots here, so a saved
      // class never showed up in the week calendar.
      if (slots.length > 0) {
        const existing = await loadScheduleData();
        const otherCourses = existing.courses.filter((c) => c.id !== course.id);
        const otherSlots = existing.slots.filter((s) => s.courseId !== course.id);
        await saveScheduleData({
          semester: existing.semester,
          courses: [...otherCourses, course],
          slots: [...otherSlots, ...slots],
        });
      }
      return (await buildFullState()) as T;
    }

    case "delete_course": {
      const id = (args?.code as string) || (args?.id as string) || "";
      await deleteCourse(id);
      return (await buildFullState()) as T;
    }

    case "update_config": {
      const update = (args?.update || args) as Record<string, unknown>;
      for (const [k, v] of Object.entries(update)) {
        await setConfigValue(CONFIG_KEY_MAP[k] ?? k, v);
      }
      return (await buildFullState()) as T;
    }

    case "add_custom_event": {
      const event = (args?.event || args) as CustomCalendarEvent;
      await upsertCustomEvent(event);
      return (await buildFullState()) as T;
    }

    case "delete_custom_event": {
      const id = (args?.id as string) || "";
      await deleteCustomEvent(id);
      return (await buildFullState()) as T;
    }

    case "toggle_topic": {
      // The desktop shell toggles by (assessment id, topic index) and derives
      // the `"{assessment_id}::{topic_index}"` key itself; the browser tier
      // used to expect a pre-built key that the UI never sent.
      const assessmentId = (args?.assessmentId as string) || "";
      const topicIdx = Number(args?.topicIdx ?? 0);
      const topicKey =
        (args?.topicKey as string) ||
        `${assessmentId}::${Number.isFinite(topicIdx) ? topicIdx : 0}`;
      const done = await loadTopicsDone();
      const next = args?.completed !== undefined ? Boolean(args.completed) : !done[topicKey];
      await setTopicDone(topicKey, next);
      return (await buildFullState()) as T;
    }

    case "save_grade": {
      const assessmentId = (args?.assessmentId as string) || "";
      await saveGrade({
        assessment_id: assessmentId,
        achieved_score: args?.achievedScore !== undefined ? (args.achievedScore as number) : null,
        max_score: args?.maxScore !== undefined ? (args.maxScore as number) : null,
        weightage_percent:
          args?.weightagePercent !== undefined ? (args.weightagePercent as number) : null,
      });
      return (await buildFullState()) as T;
    }

    case "dismiss_conflicts": {
      await setConfigValue("dismiss_conflict_banner", true);
      return (await buildFullState()) as T;
    }

    case "schedule_study_blocks": {
      const wasm = await getWasmEngine();
      const assessments = await loadAssessments();
      const schedule = await loadScheduleData();
      const events = await loadCustomEvents();
      const todayIso = new Date().toISOString().split("T")[0];
      const targetId = args?.assessmentId as string | undefined;

      const targets = targetId
        ? assessments.filter((a) => a.id === targetId)
        : assessments.filter(
            (a) =>
              a.isUpcoming && a.daysUntil !== null && a.daysUntil !== undefined && a.daysUntil <= 7,
          );

      for (const a of targets) {
        const blocksJson = wasm.generate_study_blocks(
          JSON.stringify(toRustAssessment(a)),
          JSON.stringify(schedule),
          JSON.stringify(events),
          todayIso,
        );
        const generated = JSON.parse(blocksJson) as CustomCalendarEvent[];
        for (const block of generated) {
          await upsertCustomEvent(block);
          events.push(block);
        }
      }

      return (await buildFullState()) as T;
    }

    case "export_ics": {
      const wasm = await getWasmEngine();
      const assessments = await loadAssessments();
      const rustAssessments = assessments.map(toRustAssessment);
      const assessmentId = (args?.assessmentId as string) || null;
      return wasm.export_ics(JSON.stringify(rustAssessments), assessmentId) as T;
    }

    case "export_backup_file": {
      const schedule = await loadScheduleData();
      const assessments = await loadAssessments();
      const topicsDone = await loadTopicsDone();
      const grades = await loadGrades();
      const events = await loadCustomEvents();
      const feeds = await loadFeeds();
      const config = await loadAllConfig();

      const backup = {
        schema_version: 1,
        exported_at: new Date().toISOString(),
        tier: "pwa",
        schedule: toRustSchedulePayload(schedule),
        assessments: assessments.map(toRustAssessment),
        topics_done: topicsDone,
        grades,
        events: events.map((ev) => ({
          ...ev,
          course_id: ev.courseId ?? null,
          event_type: ev.eventType ?? null,
          date_iso: ev.dateIso ?? null,
          start_time: ev.startTime ?? null,
          end_time: ev.endTime ?? null,
        })),
        feeds,
        config,
      };

      return JSON.stringify(backup, null, 2) as T;
    }

    case "import_backup_file": {
      const content = (args?.content as string) || "";
      const parsed = JSON.parse(content);
      if (parsed.schedule) {
        await saveScheduleData(parsed.schedule);
      }
      if (Array.isArray(parsed.assessments)) {
        await saveAssessments(parsed.assessments);
      }
      if (parsed.grades && typeof parsed.grades === "object") {
        for (const g of Object.values(parsed.grades)) {
          await saveGrade(g as IdbGradeRecord);
        }
      }
      if (Array.isArray(parsed.events)) {
        for (const ev of parsed.events) {
          await upsertCustomEvent(ev);
        }
      }
      if (Array.isArray(parsed.feeds)) {
        for (const f of parsed.feeds) {
          await upsertFeed(f);
        }
      }
      return (await buildFullState()) as T;
    }

    case "reset_database": {
      await idbResetAll();
      setMemoryGoogleToken(null);
      setMemoryMsToken(null);
      return (await buildFullState()) as T;
    }

    case "upsert_feed": {
      const feed = (args?.feed || args) as FeedConfig;
      await upsertFeed(feed);
      return (await buildFullState()) as T;
    }

    case "delete_feed": {
      const id = (args?.id as string) || "";
      await deleteFeed(id);
      return (await buildFullState()) as T;
    }

    case "practice_generate": {
      const wasm = await getWasmEngine();
      const assessments = await loadAssessments();
      const targetId = args?.assessmentId as string;
      const target = assessments.find((a) => a.id === targetId);
      if (!target) {
        throw new Error(`Assessment ${targetId} not found`);
      }
      const quizJson = wasm.generate_practice_quiz(JSON.stringify(toRustAssessment(target)));
      return JSON.parse(quizJson) as T;
    }

    case "run_gcal_sync": {
      // Honest degradation per 01 §4.8
      throw new Error(
        "Calendar sync is unavailable in the browser companion tier — export .ics instead.",
      );
    }

    case "check_update": {
      return {
        available: false,
        currentVersion: APP_VERSION,
        error: null,
        note: "PWA is kept up to date automatically via Service Worker.",
      } as T;
    }

    case "validate_gemini_key": {
      const key = (args?.key as string) || "";
      const result = await validateGeminiKeyBrowser(key);
      return result as T;
    }

    case "ai_quota_usage": {
      // The browser companion keeps no quota ledger: the key is only checked
      // against the model list, and practice quizzes run on-device. Reporting
      // "not tracked" is honest; a zero would read as "you used nothing".
      return { callsToday: null, perModel: {} } as T;
    }

    case "google_login_start":
    case "microsoft_login_start":
    case "microsoft_scanning_consent_start": {
      // Browser tier: the store runs the GIS token client / PKCE popup flow
      // locally (needs the user's own OAuth client ID from Settings → Account).
      // `microsoft_scanning_consent_start` asks for the mail + calendar
      // scopes, which many work tenants gate behind administrator approval.
      return {
        url: null,
        port: null,
        mode: fn === "google_login_start" ? "gis" : "pkce-popup",
      } as T;
    }

    case "google_logout":
    case "microsoft_logout":
    case "logout": {
      setMemoryGoogleToken(null);
      setMemoryMsToken(null);
      return (await buildFullState()) as T;
    }

    case "run_sync": {
      const wasm = await getWasmEngine();
      const existing = await loadAssessments();
      const schedule = await loadScheduleData();
      const feeds = await loadFeeds();
      const todayIso = new Date().toISOString().split("T")[0];

      // The browser tier can abort its scan too: `cancel_sync` aborts this
      // controller, which drops the in-flight feed request.
      const controller = new AbortController();
      activeScanController = controller;

      let feedResult;
      try {
        feedResult = await scanBrowserFeeds(feeds, schedule, todayIso, controller.signal);
      } finally {
        activeScanController = null;
      }

      if (controller.signal.aborted) {
        throw new Error("Scan canceled - your data was left untouched.");
      }

      const mergeJson = wasm.merge_sync(
        JSON.stringify(existing.map(toRustAssessment)),
        JSON.stringify(feedResult.assessments.map(toRustAssessment)),
      );
      const { merged, counts } = JSON.parse(mergeJson) as {
        merged: Assessment[];
        counts: { added: number; updated: number; unchanged: number };
      };

      await saveAssessments(merged);

      // "Last synced" reflects real fetches only: with no feed fetched, the
      // stamp would claim a sync that never reached a source.
      if (feedResult.fetched > 0) {
        await setConfigValue("last_gmail_sync", lastSyncedStamp());
      }

      return {
        success: true,
        totalNew: counts.added,
        totalUpdated: counts.updated,
        notes: feedResult.errors,
        errors: feedResult.errors,
      } as T;
    }

    case "cancel_sync": {
      activeScanController?.abort();
      activeScanController = null;
      return null as T;
    }

    default:
      throw new Error(`RPC call "${fn}" is not implemented in browser tier`);
  }
}
