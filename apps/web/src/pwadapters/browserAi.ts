/**
 * Browser-tier Gemini Vision adapter (the PWA companion).
 *
 * The desktop shell runs the timetable vision import through the Rust core
 * (`core/src/ai/tasks.rs::extract_timetable` → Tauri `extract_schedule`), but
 * the browser tier has no Tauri IPC and the WASM bindings expose no provider.
 * The locked stack puts the browser's network work in **fetch adapters in TS**,
 * so the vision call lives here — with the same prompt, the same model ladder
 * and the same honesty rules as the core:
 *
 *   - every unknown stays unknown (null / dropped, never invented),
 *   - rows the model got wrong are DROPPED and counted, never repaired,
 *   - the API key travels in the `x-goog-api-key` header only and is held in
 *     memory for the session (never in localStorage, never in a log).
 *
 * Keep this file in sync with `core/src/ai/tasks.rs` (prompt + validation)
 * and `core/src/ai/provider.rs` (model ladder).
 */

import type { Course, DesktopExtractedTimetable, ScheduleData, ScheduleSlot } from "../state/types";
import { coursePalette } from "../lib/coursePalette";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * The Flash tier model ids, in preference order — the same ladder the core
 * provider walks (`core/src/ai/provider.rs`). A retired id (404) or a
 * congested one (503) falls through to the next; every other failure is the
 * caller's own key/quota and is surfaced honestly.
 */
export const FLASH_MODEL_IDS: ReadonlyArray<string> = [
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
];

/**
 * The timetable extraction prompt — the same rules as `TIMETABLE_INSTRUCTION`
 * in `core/src/ai/tasks.rs`. Strict honesty rules: print only what the image
 * shows, never a default semester, never a placeholder room. The example
 * codes are neutral placeholders, so no v4 demo-universe course id ships in
 * the web bundle.
 */
export const TIMETABLE_INSTRUCTION = `You are an intelligent university timetable extraction assistant inside QuizRadar.
Analyze the provided university weekly timetable / class schedule image or document.
Extract all enrolled courses and recurring weekly class timeslots.

HONESTY RULES (strict — never invent anything):
- "semester": ONLY the semester title actually printed on the timetable (e.g. "Fall 2026"); null when it is not shown. Never write a default like "Current Semester".
- "courses": every distinct enrolled course actually visible:
  - "id": the course code exactly as printed (e.g. "ECE210")
  - "name": the full course title exactly as printed
  - "color": one hex color from this list: "#1a73e8", "#0f9d58", "#ea8600", "#d93025", "#8e24aa", "#00acc1", "#e67c73", "#3949ab"
- "slots": every weekly recurring class session actually visible:
  - "id": "slot-1", "slot-2", …
  - "course_id": the matching course code
  - "day": full day name (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday)
  - "start_time" / "end_time": 24-hour "HH:MM" exactly as printed — omit the whole slot when the times are not printed
  - "room": the room/hall exactly as printed, or null when not shown (never "TBA" or a placeholder unless the image itself shows it)
  - "type": "Lecture", "Lab", or "Tutorial" — null when not stated
  - "group": the section/group exactly as printed, or null
- Skip anything unreadable instead of guessing.

Return ONLY a valid JSON object matching this exact structure:
{
  "semester": "Fall 2026",
  "courses": [
    { "id": "ECE210", "name": "Digital Systems", "color": "#1a73e8" }
  ],
  "slots": [
    { "id": "slot-1", "course_id": "ECE210", "day": "Sunday", "start_time": "09:00", "end_time": "10:30", "display_time": "9:00 AM - 10:30 AM", "room": null, "type": "Lecture", "group": null }
  ]
}`;

// ---------------------------------------------------------------------------
// Session-scoped AI call counter
//
// The desktop tier persists a daily quota ledger; the browser tier keeps no
// database for it, so it counts COMPLETED calls in memory for this session
// only. The UI says so explicitly ("this session") — a number that silently
// resets on reload must never be presented as a daily quota.
// ---------------------------------------------------------------------------

let sessionCalls = 0;
const sessionPerModel: Record<string, number> = {};

export function getBrowserAiSessionCalls(): number {
  return sessionCalls;
}

export function getBrowserAiSessionPerModel(): Record<string, number> {
  return { ...sessionPerModel };
}

/** Test seam: resets the in-memory counter. */
export function resetBrowserAiSessionCounters(): void {
  sessionCalls = 0;
  for (const key of Object.keys(sessionPerModel)) delete sessionPerModel[key];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Empty/whitespace strings become null — the wire shape mirrors the core's. */
export function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `HH:MM` (24-hour, seconds tolerated) — anything else is unknown. */
export function parseHm(value: unknown): string | null {
  const text = optionalString(value);
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length < 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Full weekday name (or 3-letter abbreviation) → 0–6, Sunday-first. */
export function weekdayIndex(day: string): number | null {
  const lowered = day.trim().toLowerCase();
  const table: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  const index = table[lowered];
  return index === undefined ? null : index;
}

/** `#rrggbb` only — anything else is not a color. */
export function validHexColor(value: unknown): string | null {
  const text = optionalString(value)?.toLowerCase() ?? null;
  if (!text) return null;
  if (!/^#[0-9a-f]{6}$/.test(text)) return null;
  return text;
}

/**
 * Deterministic preset accent for a course id — the single web FNV-1a copy
 * lives in `lib/coursePalette.ts` (kept byte-equivalent with
 * `core/src/sources/mod.rs::preset_course_colors` by browserAiCoreParity.test.ts).
 */
export function presetCourseColors(id: string): { color: string; bg: string; border: string } {
  return coursePalette(id);
}

/** Strips a `data:<mime>;base64,` prefix (the desktop shell does the same). */
export function stripDataUrlPrefix(image: string): string {
  const index = image.indexOf(";base64,");
  return index >= 0 ? image.slice(index + ";base64,".length) : image;
}

/** The mime type the shell should send for a given data URL. */
export function mimeForImage(image: string): string {
  const lowered = image.trim().toLowerCase();
  if (lowered.startsWith("data:image/jpeg")) return "image/jpeg";
  if (lowered.startsWith("data:image/webp")) return "image/webp";
  if (lowered.startsWith("data:image/png")) return "image/png";
  return "image/png";
}

/** Lenient fence-strip: models occasionally wrap JSON in ```json fences. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const withoutFence = trimmed.startsWith("```json")
    ? trimmed.slice(7)
    : trimmed.startsWith("```JSON")
      ? trimmed.slice(7)
      : trimmed.startsWith("```")
        ? trimmed.slice(3)
        : trimmed;
  const body = withoutFence.replace(/^[\r\n]+/, "");
  const end = body.lastIndexOf("```");
  return (end >= 0 ? body.slice(0, end) : body).trim();
}

/** Parses the model's JSON, unwrapping the one-element array some models use. */
export function parseModelJson(text: string): unknown {
  const cleaned = stripCodeFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini's reply was not valid JSON: ${message}`);
  }
  if (Array.isArray(parsed)) return parsed.length > 0 ? parsed[0] : null;
  return parsed;
}

/** Joins the candidate's text parts (the model may split a reply). */
export function candidateText(body: unknown): string | null {
  const root = asRecord(body);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const first = asRecord(candidates[0]);
  const content = asRecord(first?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  let text = "";
  for (const part of parts) {
    const piece = asRecord(part)?.text;
    if (typeof piece === "string") text += piece;
  }
  return text.trim() ? text : null;
}

/** The model's finish reason, for the honest "no answer" error. */
export function finishReason(body: unknown): string {
  const root = asRecord(body);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const reason = asRecord(candidates[0])?.finishReason;
  return typeof reason === "string" ? reason : "unknown";
}

/** Never let the key leak into an error string. */
export function redactKey(text: string, key: string): string {
  if (!key) return text;
  return text.split(key).join("***");
}

/** Maps a non-2xx status onto an honest, actionable error. */
export function mapGeminiStatus(status: number, detail: string): Error {
  const lowered = detail.toLowerCase();
  if ((status === 400 || status === 403) && lowered.includes("api key not valid")) {
    return new Error(
      "Gemini rejected the API key — re-copy it in Settings → Account. The key is only ever sent in the x-goog-api-key header.",
    );
  }
  if (status === 429) {
    return new Error(
      "Gemini's free-tier quota for today is exhausted (HTTP 429). Try again after the quota resets.",
    );
  }
  if (status === 404) {
    return new Error(`Gemini API error (HTTP 404): the model endpoint was not found. ${detail}`);
  }
  if (status >= 500) {
    return new Error(`Gemini API error (HTTP ${status}): ${detail}`);
  }
  return new Error(`Gemini API error (HTTP ${status}): ${detail}`);
}

/**
 * Validates the model's timetable JSON into a schedule + honest drop counts.
 * Mirrors `core/src/ai/tasks.rs::extract_timetable`: a row the model got
 * wrong is dropped and counted, never repaired into existence.
 */
export function parseTimetableExtraction(raw: unknown): DesktopExtractedTimetable {
  const root = asRecord(raw) ?? {};

  const semester = optionalString(root.semester);

  const courses: Course[] = [];
  let droppedCourses = 0;
  const rawCourses = Array.isArray(root.courses) ? root.courses : [];
  for (const item of rawCourses) {
    const record = asRecord(item);
    const id = optionalString(record?.id);
    const name = optionalString(record?.name);
    if (!id || !name) {
      droppedCourses += 1;
      continue;
    }
    // The same course printed twice — one entry.
    if (courses.some((kept) => kept.id.toLowerCase() === id.toLowerCase())) continue;
    const hex = validHexColor(record?.color);
    const preset = presetCourseColors(id);
    courses.push({
      id,
      name,
      color: hex ?? preset.color,
      bg: `${hex ?? preset.color}18`,
      border: `${hex ?? preset.color}55`,
    });
  }

  const slots: ScheduleSlot[] = [];
  let droppedSlots = 0;
  const rawSlots = Array.isArray(root.slots) ? root.slots : [];
  for (const item of rawSlots) {
    const record = asRecord(item);
    const courseId = optionalString(record?.course_id ?? record?.courseId);
    const course = courseId
      ? courses.find((kept) => kept.id.toLowerCase() === courseId.toLowerCase())
      : undefined;
    if (!course) {
      droppedSlots += 1;
      continue;
    }
    const day = optionalString(record?.day);
    const dayIndex = day ? weekdayIndex(day) : null;
    if (!day || dayIndex === null) {
      droppedSlots += 1;
      continue;
    }
    const start = parseHm(record?.start_time ?? record?.startTime);
    const end = parseHm(record?.end_time ?? record?.endTime);
    if (!start || !end) {
      droppedSlots += 1;
      continue;
    }
    if (end <= start) {
      droppedSlots += 1;
      continue;
    }
    slots.push({
      id: optionalString(record?.id) ?? `slot-${slots.length + 1}`,
      day,
      dayIndex,
      courseId: course.id,
      courseName: optionalString(record?.course_name ?? record?.courseName) ?? course.name,
      type: optionalString(record?.type ?? record?.slot_type ?? record?.slotType) ?? "Lecture",
      group: optionalString(record?.group) ?? null,
      room: optionalString(record?.room) ?? null,
      startTime: start,
      endTime: end,
      displayTime: optionalString(record?.display_time ?? record?.displayTime) ?? `${start}–${end}`,
      hasQuiz: false,
      quizTitle: null,
    });
  }

  const schedule: ScheduleData = { semester, courses, slots };
  return { schedule, droppedCourses, droppedSlots };
}

// ---------------------------------------------------------------------------
// The network call
// ---------------------------------------------------------------------------

/**
 * Runs one timetable vision import.
 *
 * `key` is the caller's Gemini key (the browser tier holds it in memory for
 * the session only). Throws an honest error when there is no key, when
 * Gemini rejects the key, when the quota is exhausted, or when the reply is
 * not JSON — never a fabricated schedule.
 */
export async function extractTimetableBrowser(
  image: string,
  key: string | null,
): Promise<DesktopExtractedTimetable> {
  const apiKey = (key ?? "").trim();
  if (!apiKey) {
    throw new Error(
      "No Gemini API key in memory — validate your key in Settings → Account (Google Gemini AI) first. The browser tier keeps the key in memory for this session only, so it is gone after a reload.",
    );
  }
  const trimmed = image.trim();
  if (!trimmed) {
    throw new Error("The timetable image is empty — pick a file first.");
  }

  const mime = mimeForImage(trimmed);
  const payload = {
    contents: [
      {
        parts: [
          { text: TIMETABLE_INSTRUCTION },
          { inline_data: { mime_type: mime, data: stripDataUrlPrefix(trimmed) } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  };

  let lastError: Error | null = null;
  for (const modelId of FLASH_MODEL_IDS) {
    let response: Response;
    try {
      response = await fetch(`${GEMINI_API_BASE}/models/${modelId}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error reaching Gemini: ${redactKey(message, apiKey)}`);
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = "";
      }
      detail = redactKey(detail, apiKey);
      const error = mapGeminiStatus(response.status, detail);
      // 404 = the model id is retired for this key's project, 503 = the model
      // is congested: both are model-level, so the next id is tried.
      if (response.status === 404 || response.status === 503) {
        lastError = error;
        continue;
      }
      throw error;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Unreadable Gemini response body: ${redactKey(message, apiKey)}`);
    }

    const text = candidateText(body);
    if (!text) {
      throw new Error(
        `Gemini returned no candidate text (finishReason: ${finishReason(body)}). The timetable was not read — nothing was changed.`,
      );
    }

    const extraction = parseTimetableExtraction(parseModelJson(text));
    sessionCalls += 1;
    sessionPerModel[modelId] = (sessionPerModel[modelId] ?? 0) + 1;
    return extraction;
  }

  throw (
    lastError ?? new Error("No Gemini model answered the timetable request — nothing was changed.")
  );
}
