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
  getMemoryGoogleToken,
  getMemoryMsToken,
  scanBrowserFeeds,
  setMemoryGoogleToken,
  setMemoryMsToken,
  validateGeminiKeyBrowser,
} from "./browserSources";

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
      await upsertCourse(course);
      return (await buildFullState()) as T;
    }

    case "delete_course": {
      const id = (args?.id as string) || "";
      await deleteCourse(id);
      return (await buildFullState()) as T;
    }

    case "update_config": {
      const update = (args?.update || args) as Record<string, unknown>;
      for (const [k, v] of Object.entries(update)) {
        await setConfigValue(k, v);
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
      const topicKey = (args?.topicKey as string) || "";
      const completed = Boolean(args?.completed);
      await setTopicDone(topicKey, completed);
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
        schedule,
        assessments,
        topics_done: topicsDone,
        grades,
        events,
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

    case "google_login_start": {
      return { url: null, port: null, mode: "gis" } as T;
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

      const feedResult = await scanBrowserFeeds(feeds, schedule, todayIso);
      const mergeJson = wasm.merge_sync(
        JSON.stringify(existing.map(toRustAssessment)),
        JSON.stringify(feedResult.assessments.map(toRustAssessment)),
      );
      const { merged, counts } = JSON.parse(mergeJson) as {
        merged: Assessment[];
        counts: { added: number; updated: number; unchanged: number };
      };

      await saveAssessments(merged);
      await setConfigValue("last_gmail_sync", new Date().toISOString());

      return {
        success: true,
        totalNew: counts.added,
        totalUpdated: counts.updated,
        errors: feedResult.errors,
      } as T;
    }

    default:
      throw new Error(`RPC call "${fn}" is not implemented in browser tier`);
  }
}
