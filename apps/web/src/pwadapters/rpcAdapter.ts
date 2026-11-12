/**
 * Browser RPC adapter for the QuizRadar PWA tier.
 * Implements the exact same typed IPC contract as Desktop Tauri 2 (apps/desktop/src-tauri/src/commands/),
 * powered by the pure Rust WASM engine (`QuizRadarWasm`) and IndexedDB persistence.
 */

import { APP_VERSION } from "../generated/version";
import { STUDY_STATS_STORAGE_KEY, writeStoredStudyStats } from "../lib/studyStats";
import { getLocalDateString } from "../state/watchdog";
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
  deleteAssessment,
  deleteCourse,
  deleteCustomEvent,
  deleteFeed,
  getConfigValue,
  idbReplaceAll,
  idbResetAll,
  loadAllConfig,
  loadAssessments,
  loadCustomEvents,
  loadFeeds,
  loadFlashcardRecords,
  loadGrades,
  loadMistakeRecords,
  loadQuizAttemptRecords,
  loadScheduleData,
  loadStudySessionRecords,
  loadTopicRecords,
  loadTopicsDone,
  rewriteTopicKeys,
  saveAssessments,
  saveGrade,
  saveScheduleData,
  setConfigValue,
  setTopicDone,
  upsertAssessment,
  upsertCourse,
  upsertCustomEvent,
  upsertFeed,
  type IdbGradeRecord,
} from "./idbStore";
import { getWasmEngine } from "./wasmBridge";
import { toRustEvent } from "../state/ipcShape";
import { sanitizeFlashcards, sanitizeQuizAttempts, sanitizeMistakes } from "../state/storage";
import {
  DEFAULT_BROWSER_GOOGLE_CLIENT_ID,
  getMemoryGeminiKey,
  getMemoryGoogleToken,
  getMemoryMsToken,
  hasMemoryGeminiKey,
  scanBrowserFeeds,
  setMemoryGeminiKey,
  setMemoryGoogleToken,
  setMemoryMsToken,
  validateGeminiKeyBrowser,
} from "./browserSources";
import {
  extractTimetableBrowser,
  getBrowserAiSessionCalls,
  getBrowserAiSessionPerModel,
} from "./browserAi";

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
  academicTrack: "academic_track",
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
    last_seen_source_run: rec.last_seen_source_run ?? rec.lastSeenSourceRun ?? null,
    retired_source_run: rec.retired_source_run ?? rec.retiredSourceRun ?? null,
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
    lastSeenSourceRun: (a.last_seen_source_run ?? a.lastSeenSourceRun ?? null) as string | null,
    retiredSourceRun: (a.retired_source_run ?? a.retiredSourceRun ?? null) as string | null,
  };
}

/**
 * An honest slot time: a well-formed `HH:MM` (or `HH:MM:SS`) clock string.
 * Anything else — missing, empty, or malformed like "25:99" — is NOT a time
 * and is never coerced into one (no 09:00/10:30 placeholder, ever).
 */
export function parseSlotTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text)) return null;
  return text;
}

/**
 * The core's slot shape, exactly as `core/src/types.rs` declares it. Used
 * for the backup export so the browser tier writes the same snake_case
 * contract the desktop tier does. A slot without WELL-FORMED times keeps its
 * raw time value (or `null` when absent) — the exporter never invents a
 * placeholder clock value.
 */
function toRustSlotPayload(slot: Record<string, unknown>): Record<string, unknown> {
  const startRaw = slot.start_time ?? slot.startTime;
  const endRaw = slot.end_time ?? slot.endTime;
  return {
    id: slot.id,
    day: slot.day,
    day_index: slot.day_index ?? slot.dayIndex ?? 0,
    course_id: slot.course_id ?? slot.courseId ?? "",
    course_name: slot.course_name ?? slot.courseName ?? "",
    type: slot.type ?? slot.slotType ?? "Lecture",
    group: slot.group ?? null,
    room: slot.room ?? null,
    start_time:
      parseSlotTime(startRaw) ??
      (typeof startRaw === "string" && startRaw.trim() ? startRaw.trim() : null),
    end_time:
      parseSlotTime(endRaw) ?? (typeof endRaw === "string" && endRaw.trim() ? endRaw.trim() : null),
    display_time: slot.display_time ?? slot.displayTime ?? "",
    has_quiz: slot.has_quiz ?? slot.hasQuiz ?? false,
    quiz_title: slot.quiz_title ?? slot.quizTitle ?? null,
  };
}

/**
 * A schedule in the core's wire shape (snake_case), for the backup export.
 *
 * Slots WITHOUT well-formed times cannot honestly enter the typed domain
 * shape (the core's `ScheduleSlot` requires `HH:MM`), so they are partitioned
 * out into the explicit non-domain `unscheduled_slots` metadata — preserved
 * verbatim (raw malformed time strings included, never a fabricated value)
 * instead of being dropped or invented. The two lists together are lossless.
 */
export function toRustSchedulePayload(schedule: ScheduleData): {
  schedule: Record<string, unknown>;
  unscheduled_slots: Record<string, unknown>[];
} {
  const timedSlots: Record<string, unknown>[] = [];
  const unscheduledSlots: Record<string, unknown>[] = [];
  for (const slot of schedule.slots || []) {
    const raw = slot as unknown as Record<string, unknown>;
    const payload = toRustSlotPayload(raw);
    if (parseSlotTime(payload.start_time) !== null && parseSlotTime(payload.end_time) !== null) {
      timedSlots.push(payload);
    } else {
      unscheduledSlots.push(payload);
    }
  }
  return {
    schedule: {
      semester: schedule.semester ?? null,
      courses: (schedule.courses || []).map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        bg: c.bg ?? null,
        border: c.border ?? null,
      })),
      slots: timedSlots,
    },
    unscheduled_slots: unscheduledSlots,
  };
}

/**
 * The local study-stats ledger (lib/studyStats.ts owns the read/write API and
 * the key constant, imported here so the backup exporter can never diverge
 * from it). Returns the raw parsed value or null — the importer validates
 * the shape.
 */

function readStoredStudyStatsRaw(): unknown {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STUDY_STATS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The webview's actual study collections in the wire shape the core
 * deserializes (snake_case twins on every record, `lib/studyStats.ts` ledger
 * as non-domain metadata). Used by BOTH backup producers:
 *  - the PWA `export_backup_file` (this adapter), and
 *  - the DESKTOP tier, where the study data lives in browser-side
 *    IndexedDB/localStorage the Rust core can never read — `store.ts`
 *    passes this payload into the Tauri command, which merges it over the
 *    core-generated JSON (thin web wrapper around the native file dialog).
 * Sections are ALWAYS present (an empty list is honest "nothing here", which
 * a restore must honor by clearing, not merging).
 */
export async function buildStudyBackupSections(): Promise<{
  flashcards: Record<string, unknown>[];
  quiz_attempts: Record<string, unknown>[];
  mistake_bank: Record<string, unknown>[];
  study_sessions: unknown[];
  study_stats: unknown;
}> {
  const flashcards = await loadFlashcardRecords();
  const quizAttempts = await loadQuizAttemptRecords();
  const mistakeBank = await loadMistakeRecords();
  const studySessions = await loadStudySessionRecords();
  return {
    flashcards: flashcards.map((c) => ({
      ...c,
      // Both naming twins, mirroring the custom_events mapping: the web
      // store persists camelCase, the core contracts speak snake_case.
      course_id: c.courseId ?? null,
      assessment_id: c.assessmentId ?? null,
      box_level: c.boxLevel,
      next_review_iso: c.nextReviewIso ?? null,
      last_reviewed_iso: c.lastReviewedIso ?? null,
    })),
    quiz_attempts: quizAttempts.map((a) => {
      const r = a as unknown as Record<string, unknown>;
      return {
        ...a,
        // Both naming twins (core contract reads snake_case, the web
        // store persists camelCase) — same rule as the flashcards map.
        assessment_id: r.assessment_id ?? a.assessmentId ?? null,
        course_id: r.course_id ?? a.courseId ?? null,
        assessment_title: r.assessment_title ?? a.assessmentTitle ?? null,
        total_questions: r.total_questions ?? a.totalQuestions,
        percentage: r.percentage ?? a.percentage ?? null,
      };
    }),
    mistake_bank: mistakeBank.map((m) => {
      const r = m as unknown as Record<string, unknown>;
      return {
        ...m,
        attempt_id: r.attempt_id ?? m.attemptId ?? null,
        assessment_id: r.assessment_id ?? m.assessmentId ?? null,
        course_id: r.course_id ?? m.courseId ?? null,
        question_id: r.question_id ?? m.questionId ?? null,
        question_text: r.question_text ?? m.questionText ?? null,
        selected_index: r.selected_index ?? m.selectedIndex,
        correct_index: r.correct_index ?? m.correctIndex,
      };
    }),
    study_sessions: studySessions,
    study_stats: readStoredStudyStatsRaw(),
  };
}

/**
 * One-shot browser twin of SQLite migration 3: rewrite legacy positional
 * topic keys (`"{id}::{index}"`) into content-addressed keys
 * (`"{id}::h{hash}"`) through each assessment's CURRENT topic list. Memoized
 * per session and marker-stamped in `config_kv`, so it runs exactly once and
 * a half-applied rewrite can never exist (single IDB transaction).
 */
let topicKeyMigration: Promise<void> | null = null;
export function ensureTopicKeysContentAddressed(): Promise<void> {
  topicKeyMigration ??= (async () => {
    const MARKER = "topic_key_migration_v3_done";
    if (await getConfigValue<boolean>(MARKER, false)) {
      return;
    }
    const wasm = await getWasmEngine();
    const records = await loadTopicRecords();
    const assessments = await loadAssessments();
    const result = JSON.parse(
      wasm.migrate_topic_keys(
        JSON.stringify(
          records.map((record) => ({
            key: record.key,
            done: record.done,
            updated_at: record.updated_at ?? null,
          })),
        ),
        JSON.stringify(assessments.map(toRustAssessment)),
      ),
    ) as {
      entries: Array<{ key: string; done: boolean; updated_at: string | null }>;
      remapped: number;
      dropped: number;
    };
    // Delete every known key, re-put the migrated set: legacy rows that
    // could not resolve are gone, content rows round-trip unchanged.
    await rewriteTopicKeys(
      records.map((record) => record.key),
      result.entries
        .filter((entry) => entry.done)
        .map((entry) => ({
          key: entry.key,
          done: true,
          updated_at: entry.updated_at ?? undefined,
        })),
      MARKER,
    );
  })().catch((error) => {
    topicKeyMigration = null; // a failed migration retries on the next call
    throw error;
  });
  return topicKeyMigration;
}

export async function buildFullState(refDate?: string): Promise<GetStatePayload> {
  // Topic toggles and derivations both read `topics_done` — the key rewrite
  // must land before anything derives from the map.
  await ensureTopicKeysContentAddressed();
  const schedule = await loadScheduleData();
  const rawAssessments = await loadAssessments();
  const topicsDone = await loadTopicsDone();
  const grades = await loadGrades();
  const events = await loadCustomEvents();
  const feeds = await loadFeeds();
  const allConfig = await loadAllConfig();

  const todayIso = refDate || getLocalDateString();

  // Merge grades onto assessments and normalize to Rust shape. A grade
  // RECORD is authoritative when it exists — `??` would treat an explicit
  // clear (null) as absent and resurrect the value embedded on the
  // assessment by an imported backup.
  const assessmentsWithGrades = rawAssessments.map((a) => {
    const g = grades[a.id];
    const pick = (record?: number | null, embedded?: number | null): number | null =>
      g ? (record ?? null) : (embedded ?? null);
    const achieved = pick(g?.achieved_score, a.achievedScore ?? a.achieved_score);
    const max = pick(g?.max_score, a.maxScore ?? a.max_score);
    const weight = pick(g?.weightage_percent, a.weightagePercent ?? a.weightage_percent);
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

  // Derive study tasks via WASM — the declared academic rhythm tunes the
  // prep-day spread (`01` §4.1; unset behaves like the default "eng").
  const tasksJson = wasm.derive_tasks(
    JSON.stringify(rawOrdered),
    JSON.stringify(schedule),
    JSON.stringify(topicsDone),
    todayIso,
    (allConfig.academic_track as string) || "eng",
  );
  const studyTasksPayload = JSON.parse(tasksJson) as StudyTasksPayload;

  const config: DesktopConfig = {
    autoSyncGcal: false, // Honesty: GCal background sync unavailable in browser PWA
    syncWeeklyClassesToGcal: false,
    geminiEnabled: Boolean(allConfig.gemini_enabled),
    onboardingCompleted: Boolean(allConfig.onboarding_completed),
    academicTrack: (allConfig.academic_track as string) || null,
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
    authenticated: Boolean(getMemoryGoogleToken()),
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
      // Always rewrite this course's slot set — including the empty list, or
      // a class edited down to zero slots would keep its stale times in the
      // week calendar forever (the desktop tier passes the empty array
      // through to the core, so the tiers diverged here).
      const existing = await loadScheduleData();
      const otherCourses = existing.courses.filter((c) => c.id !== course.id);
      const otherSlots = existing.slots.filter((s) => s.courseId !== course.id);
      await saveScheduleData({
        semester: existing.semester,
        courses: [...otherCourses, course],
        slots: [...otherSlots, ...slots],
      });
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

    case "upsert_assessment": {
      const assessment = (args?.assessment || args) as Assessment;
      await upsertAssessment(assessment);
      return (await buildFullState()) as T;
    }

    case "delete_assessment": {
      const id = (args?.id as string) || "";
      await deleteAssessment(id);
      return (await buildFullState()) as T;
    }

    case "toggle_topic": {
      // The desktop shell toggles by (assessment id, topic index) and derives
      // the content-addressed `"{assessment_id}::h{hash}"` key from the
      // assessment's CURRENT topic list; the browser tier does the same via
      // the wasm engine — a rescan that reorders the list can never move a
      // checkmark onto a different topic. The intended value comes from the
      // caller when present: a read-modify-write here loses one of two
      // overlapping toggles.
      const assessmentId = (args?.assessmentId as string) || "";
      const topicIdx = Number(args?.topicIdx ?? 0);
      await ensureTopicKeysContentAddressed();
      const assessments = await loadAssessments();
      const topicText = assessments
        .filter((a) => String((a as unknown as Record<string, unknown>).id ?? "") === assessmentId)
        .flatMap((a) => (Array.isArray(a.topics) ? a.topics : []))[topicIdx] as string | undefined;
      if (typeof topicText !== "string" || topicText === "") {
        throw new Error(
          `Topic ${topicIdx + 1} no longer exists for this assessment — refresh and try again.`,
        );
      }
      const wasm = await getWasmEngine();
      const topicKey = wasm.topic_key(assessmentId, topicText);
      let next: boolean;
      if (args?.completed !== undefined) {
        next = Boolean(args.completed);
      } else {
        const done = await loadTopicsDone();
        next = !done[topicKey];
      }
      await setTopicDone(topicKey, next);
      return (await buildFullState()) as T;
    }

    case "save_grade": {
      const assessmentId = (args?.assessmentId as string) || "";
      const existing = (await loadGrades())[assessmentId];
      // Omitted fields are "keep" (desktop `FieldUpdate::Keep` semantics) —
      // mapping an absent field to null would wipe a previously saved value
      // embedded in the record every time a partial caller saved.
      await saveGrade({
        assessment_id: assessmentId,
        achieved_score:
          args?.achievedScore !== undefined
            ? (args.achievedScore as number)
            : (existing?.achieved_score ?? null),
        max_score:
          args?.maxScore !== undefined ? (args.maxScore as number) : (existing?.max_score ?? null),
        weightage_percent:
          args?.weightagePercent !== undefined
            ? (args.weightagePercent as number)
            : (existing?.weightage_percent ?? null),
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
      const todayIso = getLocalDateString();
      const targetId = args?.assessmentId as string | undefined;

      const targets = targetId
        ? assessments.filter((a) => a.id === targetId)
        : // Raw IDB records may be snake_case-only (scan output persists the
          // Rust serde shape) — read both twins or the filter silently
          // matches nothing after the first scan.
          assessments.filter((a) => {
            const raw = a as unknown as Record<string, unknown>;
            const upcoming = raw.is_upcoming ?? a.isUpcoming;
            const days = raw.days_until ?? a.daysUntil;
            return Boolean(upcoming) && typeof days === "number" && days >= 0 && days <= 6;
          });

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

      // No time fabrication: slots without well-formed times are partitioned
      // into the explicit non-domain `unscheduled_slots` metadata (preserved
      // verbatim), so the domain schedule the desktop tier imports contains
      // only honestly-timed rows. There is no `invented_slot_times` list
      // anymore because there is nothing invented to flag. Metadata preserved
      // by a previous import rides along again (by id, never duplicated).
      const { schedule: schedulePayload, unscheduled_slots: liveUnscheduled } =
        toRustSchedulePayload(schedule);
      const liveSlotIds = new Set((schedule.slots || []).map((s) => String(s.id)));
      const preservedUnscheduled = (
        (await getConfigValue<unknown[]>("quizradar_unscheduled_slots_v1", [])) ?? []
      ).filter(
        (s) =>
          s !== null &&
          typeof s === "object" &&
          !liveSlotIds.has(String((s as { id?: unknown }).id)),
      );
      const unscheduled_slots = [...liveUnscheduled, ...preservedUnscheduled];

      const backup = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        tier: "pwa",
        schedule: schedulePayload,
        unscheduled_slots,
        assessments: assessments.map(toRustAssessment),
        completed_topics: topicsDone,
        grades,
        ...(await buildStudyBackupSections()),
        custom_events: events.map((ev) => {
          const r = ev as unknown as Record<string, unknown>;
          // Study blocks generated in-browser persist snake-only; read both
          // twins or their dates/times AND course/type export as null.
          return {
            id: ev.id,
            title: ev.title,
            course_id: r.course_id ?? ev.courseId ?? null,
            event_type: r.event_type ?? ev.eventType ?? null,
            date: r.date_iso ?? ev.dateIso ?? null,
            date_iso: r.date_iso ?? ev.dateIso ?? null,
            start_time: r.start_time ?? ev.startTime ?? null,
            end_time: r.end_time ?? ev.endTime ?? null,
            room: r.room ?? ev.room ?? null,
            notes: r.notes ?? ev.notes ?? null,
            color: r.color ?? ev.color ?? null,
          };
        }),
        feeds,
        user_email: (config.user_email as string) || null,
        user_name: (config.user_name as string) || null,
        user_picture: (config.user_picture as string) || null,
        onboarding_completed: Boolean(config.onboarding_completed),
        auto_sync_gcal: false,
        sync_weekly_classes_to_gcal: false,
        gemini_enabled: Boolean(config.gemini_enabled),
        teams_enabled: Boolean(config.teams_enabled),
        moodle_enabled: Boolean(config.moodle_enabled),
        classroom_enabled: Boolean(config.classroom_enabled),
        moodle_url: (config.moodle_url as string) || null,
        dismiss_conflict_banner: Boolean(config.dismiss_conflict_banner),
        last_gmail_sync: (config.last_gmail_sync as string) || null,
        last_gcal_sync: null,
        synced_gcal_map: {},
      };

      return JSON.stringify(backup, null, 2) as T;
    }

    case "import_backup_file": {
      const content = ((args?.jsonContent as string) ?? (args?.content as string) ?? "").trim();
      if (!content) {
        throw new Error("Backup JSON content is empty.");
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        throw new Error("This backup file is not valid JSON — nothing was imported.");
      }
      const rawSchedule = parsed.schedule as Record<string, unknown> | undefined;
      if (!Array.isArray(parsed.assessments) || !Array.isArray(rawSchedule?.courses)) {
        throw new Error("This file is not a QuizRadar backup (missing assessments or schedule).");
      }

      const secretsIgnored = Object.keys(parsed).filter((key) =>
        /(?:_token|_api_key|pairing_pin|teams_client_id|moodle_ical_url)$/i.test(key),
      );

      // ------------------------------------------------------------------
      // Phase 1 — pure normalization & validation. EVERYTHING below runs
      // before the first destructive write, so a structurally invalid file is
      // rejected before any local data is touched (no destructive partial
      // imports). Only tolerate-and-warn skips (malformed per-entry records)
      // are pre-computed here too; nothing writes yet.
      // ------------------------------------------------------------------

      const normalizedCourses: Course[] = (
        rawSchedule.courses as Array<Record<string, unknown>>
      ).map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.name ?? c.id ?? ""),
        color: String(c.color ?? "#1a73e8"),
        bg: (c.bg as string | null) ?? null,
        border: (c.border as string | null) ?? null,
      }));
      const rawSlots = Array.isArray(rawSchedule.slots)
        ? (rawSchedule.slots as Array<Record<string, unknown>>)
        : [];
      // Legacy tolerance: v5.10 PWA exporters flagged the slots whose
      // 09:00/10:30 times the exporter itself had invented. Those rows are
      // skipped on restore — importing them would re-invent a schedule that
      // never existed. (Current exporters no longer invent times at all.)
      const inventedSlotTimeIds = new Set(
        Array.isArray(parsed.invented_slot_times)
          ? (parsed.invented_slot_times as unknown[]).map(String)
          : [],
      );
      const warnings: string[] = [];
      const normalizedSlots: ScheduleSlot[] = [];
      // Skipped slots are preserved (raw times included) as non-domain
      // metadata — never silently dropped from the data realm.
      const skippedSlotPayloads: Record<string, unknown>[] = [];
      let slotsSkipped = 0;
      for (let idx = 0; idx < rawSlots.length; idx++) {
        const s = rawSlots[idx];
        // No String() coercion with "09:00"/"10:30" fallbacks: a slot without
        // a WELL-FORMED time (missing, empty or malformed like "25:99") has
        // no honest representation in the core contract (required NaiveTime),
        // so it is skipped into the warnings list.
        const start = parseSlotTime(s.startTime ?? s.start_time);
        const end = parseSlotTime(s.endTime ?? s.end_time);
        if (start === null || end === null) {
          warnings.push(
            `A class slot without valid start/end times was skipped (${String(s.id ?? `index ${idx}`)}) — the timetable format requires HH:MM times.`,
          );
          skippedSlotPayloads.push({
            id: s.id ?? `slot-${idx}`,
            day: s.day ?? null,
            day_index: s.day_index ?? s.dayIndex ?? 0,
            course_id: s.course_id ?? s.courseId ?? "",
            course_name: s.course_name ?? s.courseName ?? "",
            type: s.type ?? s.slotType ?? "Lecture",
            group: s.group ?? null,
            room: s.room ?? null,
            start_time:
              typeof (s.start_time ?? s.startTime) === "string"
                ? (s.start_time ?? s.startTime)
                : null,
            end_time:
              typeof (s.end_time ?? s.endTime) === "string" ? (s.end_time ?? s.endTime) : null,
            display_time: s.display_time ?? s.displayTime ?? "",
            has_quiz: s.has_quiz ?? s.hasQuiz ?? false,
            quiz_title: s.quiz_title ?? s.quizTitle ?? null,
          });
          slotsSkipped += 1;
          continue;
        }
        if (inventedSlotTimeIds.has(String(s.id ?? ""))) {
          warnings.push(
            `A class slot whose times were placeholder values in the backup was skipped (${String(s.id ?? "")}).`,
          );
          slotsSkipped += 1;
          continue;
        }
        normalizedSlots.push({
          id: String(s.id ?? `slot-${idx}`),
          day: String(s.day ?? "Sun"),
          dayIndex: Number(s.dayIndex ?? s.day_index ?? 0),
          courseId: String(s.courseId ?? s.course_id ?? ""),
          courseName: String(s.courseName ?? s.course_name ?? ""),
          type: String(s.type ?? "Lecture"),
          group: (s.group as string | null) ?? null,
          room: (s.room as string | null) ?? null,
          startTime: start,
          endTime: end,
          displayTime: String(s.displayTime ?? s.display_time ?? ""),
          hasQuiz: Boolean(s.hasQuiz ?? s.has_quiz ?? false),
          quizTitle: (s.quizTitle ?? s.quiz_title ?? null) as string | null,
        });
      }

      const normalizedAssessments = (parsed.assessments as Array<Record<string, unknown>>).map(
        toJsAssessment,
      );

      const rawTopics = (parsed.completed_topics ?? parsed.topics_done) as
        Record<string, boolean> | undefined;
      // v4 / pre-migration v5 backups key topics by POSITION inside the
      // backup's own topic lists — remap into content keys through the
      // backup's assessments BEFORE any write (same rule as the Rust
      // importer), so a reordered announcement keeps its checkmarks.
      let migratedTopics: Array<{ key: string; done: boolean }> = [];
      if (rawTopics && typeof rawTopics === "object") {
        const wasm = await getWasmEngine();
        const migrated = JSON.parse(
          wasm.migrate_topic_keys(
            JSON.stringify(
              Object.entries(rawTopics).map(([key, done]) => ({
                key,
                done: Boolean(done),
                updated_at: null,
              })),
            ),
            JSON.stringify(normalizedAssessments.map(toRustAssessment)),
          ),
        ) as { entries: Array<{ key: string; done: boolean }> };
        migratedTopics = migrated.entries;
      }

      const gradesToImport: Array<{ record: IdbGradeRecord; id: string }> = [];
      if (parsed.grades && typeof parsed.grades === "object") {
        for (const [mapId, rawG] of Object.entries(parsed.grades as Record<string, unknown>)) {
          const g = rawG as Record<string, unknown>;
          const achieved = g.achieved_score !== undefined ? g.achieved_score : g.achievedScore;
          const max = g.max_score !== undefined ? g.max_score : g.maxScore;
          const weightage =
            g.weightage_percent !== undefined ? g.weightage_percent : g.weightagePercent;
          // The Rust importer refuses corrupt grades loudly BEFORE writing —
          // same rule here, and same moment (before any local mutation).
          const finiteOrNull = (v: unknown) =>
            v === null || v === undefined || (typeof v === "number" && Number.isFinite(v));
          if (
            !finiteOrNull(achieved) ||
            !finiteOrNull(max) ||
            !finiteOrNull(weightage) ||
            (typeof max === "number" && max !== null && max <= 0)
          ) {
            throw new Error(
              `This backup has an invalid grade record (${mapId}) — nothing was imported.`,
            );
          }
          gradesToImport.push({
            id: mapId,
            record: {
              assessment_id: String(g.assessment_id ?? g.assessmentId ?? mapId),
              achieved_score: (achieved as number | null) ?? null,
              max_score: (max as number | null) ?? null,
              weightage_percent: (weightage as number | null) ?? null,
            } as IdbGradeRecord,
          });
        }
      }

      const eventsToImport: Array<ReturnType<typeof toRustEvent>> = [];
      const rawEvents = Array.isArray(parsed.custom_events)
        ? (parsed.custom_events as Array<Record<string, unknown>>)
        : Array.isArray(parsed.events)
          ? (parsed.events as Array<Record<string, unknown>>)
          : [];
      for (const ev of rawEvents) {
        eventsToImport.push(
          toRustEvent({
            id: String(ev.id ?? `evt-${eventsToImport.length}`),
            title: String(ev.title ?? ""),
            courseId: (ev.courseId ?? ev.course_id ?? null) as string | null,
            eventType: (ev.eventType ?? ev.event_type ?? "Custom") as string | null,
            dateIso: (ev.dateIso ?? ev.date_iso ?? ev.date ?? null) as string | null,
            startTime: (ev.startTime ?? ev.start_time ?? null) as string | null,
            endTime: (ev.endTime ?? ev.end_time ?? null) as string | null,
            room: (ev.room ?? null) as string | null,
            notes: (ev.notes ?? null) as string | null,
            color: (ev.color ?? "#db2777") as string | null,
          }),
        );
      }

      const feedsToImport: FeedConfig[] = [];
      if (Array.isArray(parsed.feeds)) {
        for (const f of parsed.feeds as FeedConfig[]) {
          // A feed without an id would throw a DataError mid-import, after
          // the destructive schedule/assessment replacement is committed —
          // skip malformed entries into the honest warnings list instead.
          if (!f || typeof f.id !== "string" || !f.id.trim()) {
            warnings.push("A feed entry without an id was skipped.");
            continue;
          }
          feedsToImport.push(f);
        }
      }

      // Study collections: validated per entry with the same tolerate-and-warn
      // rule — malformed entries are counted into `warnings`, the file is
      // never trusted, and NONE of this touches the stores yet.
      const flashcardsSectionPresent =
        parsed.flashcards !== undefined || parsed.study_flashcards !== undefined;
      const rawFlashcards = Array.isArray(parsed.flashcards)
        ? (parsed.flashcards as unknown[])
        : Array.isArray(parsed.study_flashcards)
          ? (parsed.study_flashcards as unknown[])
          : [];
      const validFlashcards = sanitizeFlashcards(rawFlashcards);
      const flashcardsImported = validFlashcards.length;
      if (flashcardsSectionPresent && validFlashcards.length !== rawFlashcards.length) {
        warnings.push(
          `${rawFlashcards.length - validFlashcards.length} malformed flashcard entr${rawFlashcards.length - validFlashcards.length === 1 ? "y was" : "ies were"} skipped.`,
        );
      }

      const attemptsSectionPresent =
        parsed.quiz_attempts !== undefined || parsed.quiz_history !== undefined;
      const rawAttempts = Array.isArray(parsed.quiz_attempts)
        ? (parsed.quiz_attempts as unknown[])
        : Array.isArray(parsed.quiz_history)
          ? (parsed.quiz_history as unknown[])
          : [];
      const validAttempts = sanitizeQuizAttempts(rawAttempts);
      const quizAttemptsImported = validAttempts.length;
      if (attemptsSectionPresent && validAttempts.length !== rawAttempts.length) {
        warnings.push(
          `${rawAttempts.length - validAttempts.length} malformed quiz attempt entr${rawAttempts.length - validAttempts.length === 1 ? "y was" : "ies were"} skipped.`,
        );
      }

      const mistakesSectionPresent =
        parsed.mistake_bank !== undefined || parsed.mistakes !== undefined;
      const rawMistakes = Array.isArray(parsed.mistake_bank)
        ? (parsed.mistake_bank as unknown[])
        : Array.isArray(parsed.mistakes)
          ? (parsed.mistakes as unknown[])
          : [];
      const validMistakes = sanitizeMistakes(rawMistakes);
      const mistakesImported = validMistakes.length;
      if (mistakesSectionPresent && validMistakes.length !== rawMistakes.length) {
        warnings.push(
          `${rawMistakes.length - validMistakes.length} malformed mistake entr${rawMistakes.length - validMistakes.length === 1 ? "y was" : "ies were"} skipped.`,
        );
      }

      // Non-domain metadata: slots the exporter could not honestly type,
      // plus the slots this import skipped (raw times preserved above).
      const declaredUnscheduled = Array.isArray(parsed.unscheduled_slots)
        ? (parsed.unscheduled_slots as unknown[])
        : [];
      const importedSlotIds = new Set(normalizedSlots.map((s) => String(s.id)));
      const unscheduledSlots = [
        ...declaredUnscheduled.filter(
          (s) =>
            s !== null &&
            typeof s === "object" &&
            !importedSlotIds.has(String((s as { id?: unknown }).id ?? "")),
        ),
        ...skippedSlotPayloads,
      ];
      if (unscheduledSlots.length > 0) {
        warnings.push(
          `${unscheduledSlots.length} slot${unscheduledSlots.length === 1 ? "" : "s"} without valid times ${unscheduledSlots.length === 1 ? "was" : "were"} kept as backup metadata (not on the timetable until real times are known).`,
        );
      }

      // Local study stats (focus minutes ledger): restore only a shape-valid
      // payload; a malformed ledger is skipped with a warning, not trusted.
      let studyStatsRestored = false;
      if (parsed.study_stats !== undefined && parsed.study_stats !== null) {
        if (writeStoredStudyStats(parsed.study_stats)) {
          studyStatsRestored = true;
        } else {
          warnings.push("A malformed study-stats entry was skipped.");
        }
      }

      // ------------------------------------------------------------------
      // Phase 2 — writes. Validation is done; nothing below is expected to
      // reject the file (only storage-level failures can abort mid-way, and
      // those surface as storage errors, never as silent partial imports).
      // ------------------------------------------------------------------

      await saveScheduleData({
        semester: (rawSchedule.semester as string | null) ?? null,
        courses: normalizedCourses,
        slots: normalizedSlots,
      });

      await saveAssessments(normalizedAssessments);

      let topicsImported = 0;
      for (const entry of migratedTopics) {
        if (entry.done) {
          await setTopicDone(entry.key, true);
          topicsImported += 1;
        }
      }

      let gradesImported = 0;
      for (const { record } of gradesToImport) {
        await saveGrade(record);
        gradesImported += 1;
      }

      let eventsImported = 0;
      for (const event of eventsToImport) {
        await upsertCustomEvent(event);
        eventsImported += 1;
      }

      let feedsImported = 0;
      for (const feed of feedsToImport) {
        await upsertFeed(feed);
        feedsImported += 1;
      }

      // Study collections: a present section REPLACES the whole collection
      // (restore semantics — merging would mix stale backup records into live
      // data); an absent section (v4 file) leaves the collection untouched.
      if (flashcardsSectionPresent) {
        await idbReplaceAll("flashcards", validFlashcards);
      }
      if (attemptsSectionPresent) {
        await idbReplaceAll("quiz_attempts", validAttempts);
      }
      if (mistakesSectionPresent) {
        await idbReplaceAll("mistake_bank", validMistakes);
      }

      // Preserve (never interpret) the backup's non-domain slot metadata so a
      // round-trip re-exports the same rows instead of silently dropping them.
      if (unscheduledSlots.length > 0) {
        await setConfigValue("quizradar_unscheduled_slots_v1", unscheduledSlots);
      }

      // Restore non-secret profile & preference flags; auto_sync_gcal stays false.
      // Every key the export writes must round-trip here, or a cross-device
      // import silently leaves feature toggles off.
      const configRestores: string[] = [
        "user_email",
        "user_name",
        "user_picture",
        "onboarding_completed",
        "moodle_url",
        "dismiss_conflict_banner",
        // `gemini_enabled` is deliberately NOT restored: the API key never
        // travels with a backup, so a restored profile would claim AI is on
        // with no key behind it. The core importer forces it off for the
        // same reason.
        "teams_enabled",
        "moodle_enabled",
        "classroom_enabled",
        "last_gmail_sync",
      ];
      for (const key of configRestores) {
        if (parsed[key] !== undefined) {
          await setConfigValue(key, parsed[key]);
        }
      }
      // The backup carries no Gemini key, so AI must be off after a restore
      // until the user enters one again (the core importer does the same).
      await setConfigValue("gemini_enabled", false);

      return {
        assessmentsImported: normalizedAssessments.length,
        coursesImported: normalizedCourses.length,
        slotsImported: normalizedSlots.length,
        slotsSkipped,
        unscheduledSlotsPreserved: unscheduledSlots.length,
        topicsImported,
        gradesImported,
        eventsImported,
        customEventsImported: eventsImported,
        feedsImported,
        flashcardsImported,
        quizAttemptsImported,
        mistakesImported,
        studyStatsRestored,
        secretsIgnored,
        warnings,
      } as T;
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

    case "download_and_install_update": {
      // Honest degradation: the browser tier is updated by the Service
      // Worker, and there is no installer to hand over to.
      throw new Error(
        "Installing an update is only available in the desktop app — the browser tier updates itself through the Service Worker.",
      );
    }

    case "validate_gemini_key": {
      const key = (args?.key as string) || "";
      const result = await validateGeminiKeyBrowser(key);
      // A validated key is held in memory for this session only (AGENTS §8:
      // PWA secrets live in memory). Every AI feature in this tier — the
      // timetable vision import included — reads it from there.
      if (result.valid) {
        setMemoryGeminiKey(key.trim());
      }
      return result as T;
    }

    case "extract_schedule": {
      // Timetable vision import (Gemini Flash). The desktop shell runs the
      // same task through the Rust core; the browser tier calls Gemini
      // directly with the same prompt, model ladder and drop rules.
      const image = (args?.image as string) || "";
      return (await extractTimetableBrowser(image, getMemoryGeminiKey())) as T;
    }

    case "ai_quota_usage": {
      // The browser companion keeps no daily ledger: it counts COMPLETED
      // calls in memory for this session (the counter resets on reload), so
      // the UI labels it "this session" instead of pretending it is a daily
      // quota.
      return {
        callsToday: getBrowserAiSessionCalls(),
        perModel: getBrowserAiSessionPerModel(),
        sessionScope: true,
        keyInMemory: hasMemoryGeminiKey(),
      } as T;
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
      const todayIso = getLocalDateString();

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

      const mergeJson = wasm.merge_scan(
        JSON.stringify(existing.map(toRustAssessment)),
        JSON.stringify(feedResult.assessments.map(toRustAssessment)),
        JSON.stringify(feedResult.sourceRuns.map((run) => ({ name: run.name, run_id: run.runId }))),
        todayIso,
      );
      const { merged, counts, retired } = JSON.parse(mergeJson) as {
        merged: Assessment[];
        counts: { added: number; updated: number; unchanged: number };
        retired: number;
      };

      await saveAssessments(merged);

      // "Last synced" reflects real fetches only: with no feed fetched, the
      // stamp would claim a sync that never reached a source.
      if (feedResult.fetched > 0) {
        await setConfigValue("last_gmail_sync", lastSyncedStamp());
      }

      const notes = [...feedResult.errors];
      if (retired > 0) {
        notes.push(
          `${retired} announcement(s) that were on the radar are no longer reported by their source and were retired — they are kept in the store with the reason, and they no longer ask for study time.`,
        );
      }

      return {
        success: true,
        totalNew: counts.added,
        totalUpdated: counts.updated,
        notes,
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
