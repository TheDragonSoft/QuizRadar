/**
 * 1-Tap Shareable Course Pack helpers (`https://.../#course=<token>` and
 * `quizradar://course?d=<token>`).
 *
 * Wire-compatible with Rust `core::sync::course_pack`. In the browser/PWA tier
 * this reuses `deflateRaw`/`inflateRaw` + `encodeQrMatrix` (or WASM when
 * initialized in `rpcAdapter.ts`).
 */

import { aliasDeep } from "../state/ipcShape";
import { deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from "./pairSync";
import { encodeQrMatrix, MAX_QR_BYTE_CAPACITY } from "./qrCode";
import type {
  Assessment,
  Course,
  CoursePackAssessment,
  CoursePackExportResult,
  CoursePackPayload,
  ScheduleData,
  ScheduleSlot,
} from "../state/types";

export const COURSE_PACK_SCHEMA_VERSION = 1;
export const COURSE_PACK_URI_PREFIX = "quizradar://course?d=";

const envPublicUrl = (import.meta.env as Record<string, string | undefined>).VITE_PUBLIC_APP_URL;
export const COURSE_PACK_WEB_BASE_URL =
  envPublicUrl?.trim() || "https://thedragonsoft.github.io/QuizRadar/app/";

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function normalizeWebBaseUrl(webBaseUrl?: string | null): string {
  const raw = (webBaseUrl ?? "").trim() || COURSE_PACK_WEB_BASE_URL;
  const lower = raw.toLowerCase();
  const allowed =
    lower.startsWith("https://") ||
    lower.startsWith("http://localhost") ||
    lower.startsWith("http://127.0.0.1");
  if (!allowed) {
    throw new Error("Course Pack web URL must use https://.");
  }
  const withoutHash = raw.split("#")[0] ?? raw;
  return withoutHash.split("?")[0] ?? withoutHash;
}

/**
 * Extracts a shared Course Pack link/token from `window.location.href` when a
 * classmate opens `https://.../#course=<token>` or `?course=<token>`.
 */
export function extractCoursePackFromLocation(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.hash) {
      const hashBody = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(hashBody);
      const fromHash = hashParams.get("course")?.trim();
      if (fromHash && B64URL_RE.test(fromHash)) {
        return fromHash;
      }
    }
    const fromQuery = url.searchParams.get("course")?.trim();
    if (fromQuery && B64URL_RE.test(fromQuery)) {
      return fromQuery;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Removes `#course=` or `?course=` from the browser URL bar after opening the
 * preview modal so reloads do not re-trigger the import dialog.
 */
export function clearCoursePackFromLocation(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.hash) {
      const hashBody = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(hashBody);
      if (hashParams.has("course")) {
        hashParams.delete("course");
        const nextHash = hashParams.toString();
        url.hash = nextHash ? `#${nextHash}` : "";
        changed = true;
      }
    }
    if (url.searchParams.has("course")) {
      url.searchParams.delete("course");
      changed = true;
    }
    if (changed) {
      window.history.replaceState(null, "", url.toString());
    }
  } catch {
    // Ignore read-only test histories
  }
}

export function courseMatchesCode(course: Course, code: string): boolean {
  const target = code.trim();
  if (!target) return false;
  if (course.id.toLowerCase() === target.toLowerCase()) return true;
  const norm = (s: string) => s.replace(/[\s-]+/g, "").toLowerCase();
  const targetNorm = norm(target);
  return (course.aliases ?? []).some((alias) => {
    const a = alias.trim();
    return a.length > 0 && (a.toLowerCase() === target.toLowerCase() || norm(a) === targetNorm);
  });
}

export function extractCoursePackToken(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Paste a shared Course Pack link first.");
  }

  const hashIdx = trimmed.indexOf("#");
  if (hashIdx >= 0) {
    const fragParams = new URLSearchParams(trimmed.slice(hashIdx + 1));
    const candidate = (fragParams.get("course") ?? fragParams.get("d") ?? "").trim();
    if (candidate && B64URL_RE.test(candidate)) {
      return candidate;
    }
  }

  const queryIdx = trimmed.indexOf("?");
  if (queryIdx >= 0) {
    const endIdx = hashIdx > queryIdx ? hashIdx : trimmed.length;
    const queryParams = new URLSearchParams(trimmed.slice(queryIdx + 1, endIdx));
    const candidate = (queryParams.get("d") ?? queryParams.get("course") ?? "").trim();
    if (candidate && B64URL_RE.test(candidate)) {
      return candidate;
    }
  }

  if (B64URL_RE.test(trimmed)) {
    return trimmed;
  }

  throw new Error(
    "Unrecognized Course Pack link. Expected a shared QuizRadar course URL or quizradar://course?d=... link.",
  );
}

export function buildCoursePackBrowser(
  courseId: string,
  schedule: ScheduleData,
  assessments: Assessment[],
): CoursePackPayload {
  const target = courseId.trim();
  if (!target) {
    throw new Error("Select a course to share.");
  }
  const course = (schedule.courses || []).find((c) => courseMatchesCode(c, target));
  if (!course) {
    throw new Error(`Course '${target}' was not found in your schedule.`);
  }

  const slots: ScheduleSlot[] = (schedule.slots || [])
    .filter((slot) => courseMatchesCode(course, slot.courseId))
    .map((slot) => ({
      ...slot,
      courseId: course.id,
      courseName: slot.courseName?.trim() || course.name,
      hasQuiz: false,
      quizTitle: null,
    }));

  const packAssessments: CoursePackAssessment[] = (assessments || [])
    .filter((a) => !(a.retiredSourceRun ?? a.retired_source_run))
    .filter((a) => {
      const cid = a.courseId ?? a.course_id ?? "";
      return cid ? courseMatchesCode(course, cid) : false;
    })
    .map((a) => {
      const rawWeight = a.weightagePercent ?? a.weightage_percent ?? null;
      const weight =
        typeof rawWeight === "number" &&
        Number.isFinite(rawWeight) &&
        rawWeight > 0 &&
        rawWeight <= 100
          ? rawWeight
          : null;
      const item: CoursePackAssessment = {
        title: a.title.trim(),
        assessment_type: a.assessmentType ?? a.assessment_type ?? "Class Quiz",
        date_iso: a.dateIso ?? a.date_iso ?? null,
        start_time: a.startTime ?? a.start_time ?? null,
        end_time: a.endTime ?? a.end_time ?? null,
      };
      if (a.room?.trim()) item.room = a.room.trim();
      if (a.group?.trim()) item.group = a.group.trim();
      if (a.instructor?.trim()) item.instructor = a.instructor.trim();
      if (weight !== null) item.weightage_percent = weight;
      if (a.topics?.length) item.topics = [...a.topics];
      if (a.warnings?.length) item.warnings = [...a.warnings];
      return item;
    });

  return {
    v: COURSE_PACK_SCHEMA_VERSION,
    semester: schedule.semester?.trim() || null,
    course: {
      id: course.id,
      name: course.name,
      color: course.color,
      bg: course.bg ?? null,
      border: course.border ?? null,
      credits: course.credits ?? null,
      maxAbsences: course.maxAbsences ?? null,
      aliases: course.aliases ?? [],
    },
    slots: slots.map((s) => ({
      id: s.id,
      day: s.day,
      day_index: s.dayIndex,
      dayIndex: s.dayIndex,
      course_id: course.id,
      courseId: course.id,
      course_name: s.courseName,
      courseName: s.courseName,
      type: s.type,
      group: s.group ?? null,
      room: s.room ?? null,
      start_time: s.startTime,
      startTime: s.startTime,
      end_time: s.endTime,
      endTime: s.endTime,
      display_time: s.displayTime,
      displayTime: s.displayTime,
      has_quiz: false,
      hasQuiz: false,
      quiz_title: null,
      quizTitle: null,
      week_parity: s.weekParity ?? s.week_parity ?? null,
    })) as unknown as ScheduleSlot[],
    assessments: packAssessments,
  };
}

export async function encodeCoursePackBrowser(
  courseId: string,
  schedule: ScheduleData,
  assessments: Assessment[],
  webBaseUrl?: string | null,
): Promise<CoursePackExportResult> {
  const pack = buildCoursePackBrowser(courseId, schedule, assessments);
  const base = normalizeWebBaseUrl(webBaseUrl);
  // Strip camelCase UI aliases when compressing so links stay tiny and wire-clean.
  const wirePack = {
    v: pack.v,
    ...(pack.semester ? { semester: pack.semester } : {}),
    course: {
      id: pack.course.id,
      name: pack.course.name,
      color: pack.course.color,
      ...(pack.course.bg ? { bg: pack.course.bg } : {}),
      ...(pack.course.border ? { border: pack.course.border } : {}),
      ...(pack.course.credits != null ? { credits: pack.course.credits } : {}),
      ...(pack.course.maxAbsences != null ? { max_absences: pack.course.maxAbsences } : {}),
      aliases: pack.course.aliases ?? [],
    },
    slots: pack.slots.map((slot) => {
      const r = slot as unknown as Record<string, unknown>;
      return {
        id: slot.id,
        day: slot.day,
        day_index: Number(r.day_index ?? slot.dayIndex ?? 0),
        course_id: String(r.course_id ?? slot.courseId),
        course_name: String(r.course_name ?? slot.courseName),
        type: slot.type || "Lecture",
        group: slot.group ?? null,
        room: slot.room ?? null,
        start_time: String(r.start_time ?? slot.startTime),
        end_time: String(r.end_time ?? slot.endTime),
        display_time: String(r.display_time ?? slot.displayTime ?? ""),
        has_quiz: false,
        quiz_title: null,
        week_parity: r.week_parity ?? slot.weekParity ?? null,
      };
    }),
    assessments: pack.assessments,
  };
  const compressed = await deflateRaw(new TextEncoder().encode(JSON.stringify(wirePack)));
  const token = toBase64Url(compressed);
  const web_url = `${base}#course=${token}`;
  const deep_link = `${COURSE_PACK_URI_PREFIX}${token}`;
  const byte_len = new TextEncoder().encode(web_url).length;
  const fits_qr = byte_len <= MAX_QR_BYTE_CAPACITY;
  let qr: CoursePackExportResult["qr"] = null;
  if (fits_qr) {
    const matrix = encodeQrMatrix(web_url);
    qr = {
      version: matrix.version,
      size: matrix.size,
      modules: matrix.modules.map((row) => row.map((b) => (b ? "1" : "0")).join("")).join(""),
    };
  }
  return aliasDeep({
    pack,
    links: {
      token,
      web_url,
      deep_link,
      byte_len,
      fits_qr,
    },
    qr,
  });
}

export async function decodeCoursePackBrowser(rawInput: string): Promise<CoursePackPayload> {
  const token = extractCoursePackToken(rawInput);
  let compressed: Uint8Array;
  try {
    compressed = fromBase64Url(token);
  } catch {
    throw new Error("Corrupted Course Pack link (invalid base64url encoding).");
  }
  let decompressed: Uint8Array;
  try {
    decompressed = await inflateRaw(compressed);
  } catch {
    throw new Error("Corrupted Course Pack link (failed to decompress payload).");
  }
  if (decompressed.byteLength > 2_000_000) {
    throw new Error("Course Pack exceeds maximum safe payload size.");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decompressed)) as Record<string, unknown>;
  } catch {
    throw new Error("Course Pack payload is not valid JSON.");
  }
  const version = Number(parsed.v ?? 0);
  if (!Number.isInteger(version) || version <= 0 || version > COURSE_PACK_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Course Pack version ${version} (this build supports up to v${COURSE_PACK_SCHEMA_VERSION}). Update QuizRadar to import it.`,
    );
  }
  const rawCourse = parsed.course as Record<string, unknown> | undefined;
  if (!rawCourse || !String(rawCourse.id ?? "").trim() || !String(rawCourse.name ?? "").trim()) {
    throw new Error("Course Pack is missing a valid course code or name.");
  }
  const course: Course = {
    id: String(rawCourse.id).trim(),
    name: String(rawCourse.name).trim(),
    color: String(rawCourse.color ?? "#1a73e8"),
    bg: (rawCourse.bg as string | null) ?? null,
    border: (rawCourse.border as string | null) ?? null,
    credits: typeof rawCourse.credits === "number" ? rawCourse.credits : null,
    maxAbsences:
      typeof (rawCourse.max_absences ?? rawCourse.maxAbsences) === "number"
        ? Number(rawCourse.max_absences ?? rawCourse.maxAbsences)
        : null,
    aliases: Array.isArray(rawCourse.aliases)
      ? rawCourse.aliases.map((a) => String(a).trim()).filter(Boolean)
      : [],
  };
  const slots = Array.isArray(parsed.slots) ? (aliasDeep(parsed.slots) as ScheduleSlot[]) : [];
  const assessments = Array.isArray(parsed.assessments)
    ? (aliasDeep(parsed.assessments) as CoursePackAssessment[])
    : [];
  return aliasDeep({
    v: version,
    semester: typeof parsed.semester === "string" ? parsed.semester : null,
    course,
    slots,
    assessments,
  });
}
