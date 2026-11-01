import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractTimetableBrowser,
  getBrowserAiSessionCalls,
  getBrowserAiSessionPerModel,
  mapGeminiStatus,
  parseModelJson,
  parseTimetableExtraction,
  presetCourseColors,
  resetBrowserAiSessionCounters,
  stripCodeFences,
} from "./browserAi";

/**
 * The browser tier's timetable vision import.
 *
 * The rules under test are the core's rules (`core/src/ai/tasks.rs`):
 * unknown stays unknown, a row the model got wrong is DROPPED and counted
 * (never repaired), a course printed twice is one course, and a bad colour
 * falls back to the deterministic preset palette.
 */
describe("browser timetable extraction (honest parsing)", () => {
  it("keeps the rows the model read and counts the ones it did not", () => {
    const result = parseTimetableExtraction({
      semester: "Fall 2026",
      courses: [
        { id: "CS101", name: "Introduction to Computer Science", color: "#1a73e8" },
        { id: "cs101", name: "Introduction to Computer Science (printed twice)" },
        { id: "", name: "No code" },
        { name: "No name either" },
      ],
      slots: [
        {
          id: "slot-1",
          course_id: "CS101",
          day: "Sunday",
          start_time: "09:00",
          end_time: "10:30",
          room: "Hall A-101",
          type: "Lecture",
        },
        {
          id: "slot-2",
          course_id: "MATH200",
          day: "Monday",
          start_time: "09:00",
          end_time: "10:00",
        },
        {
          id: "slot-3",
          course_id: "CS101",
          day: "Someday",
          start_time: "09:00",
          end_time: "10:00",
        },
        { id: "slot-4", course_id: "CS101", day: "Monday", start_time: "25:00", end_time: "26:00" },
        { id: "slot-5", course_id: "CS101", day: "Monday", start_time: "11:00", end_time: "10:00" },
      ],
    });

    expect(result.schedule.semester).toBe("Fall 2026");
    // The duplicated course is one entry; the two malformed ones are dropped.
    expect(result.schedule.courses).toHaveLength(1);
    expect(result.droppedCourses).toBe(2);
    // Four slots were unusable: unknown course, unknown day, impossible
    // times, and an end before the start.
    expect(result.schedule.slots).toHaveLength(1);
    expect(result.droppedSlots).toBe(4);

    const slot = result.schedule.slots[0];
    expect(slot.courseId).toBe("CS101");
    expect(slot.courseName).toBe("Introduction to Computer Science");
    expect(slot.dayIndex).toBe(0);
    expect(slot.startTime).toBe("09:00");
    expect(slot.endTime).toBe("10:30");
    expect(slot.displayTime).toBe("09:00–10:30");
    expect(slot.room).toBe("Hall A-101");
  });

  it("leaves an unknown semester unknown and an unknown room missing", () => {
    const result = parseTimetableExtraction({
      courses: [{ id: "CS101", name: "Intro" }],
      slots: [{ course_id: "CS101", day: "Friday", start_time: "8:05", end_time: "9:45" }],
    });

    expect(result.schedule.semester).toBeNull();
    expect(result.schedule.slots[0].room).toBeNull();
    // "8:05" is normalized to 24-hour "08:05" — the same shape the core uses.
    expect(result.schedule.slots[0].startTime).toBe("08:05");
  });

  it("falls back to the deterministic preset palette for an invalid colour", () => {
    const withBadColor = parseTimetableExtraction({
      courses: [{ id: "CS101", name: "Intro", color: "not-a-colour" }],
      slots: [],
    });
    const withoutColor = parseTimetableExtraction({
      courses: [{ id: "CS101", name: "Intro" }],
      slots: [],
    });

    expect(withBadColor.schedule.courses[0].color).toBe(presetCourseColors("CS101").color);
    expect(withoutColor.schedule.courses[0].color).toBe(presetCourseColors("CS101").color);
  });

  it("unwraps a one-element array and strips code fences", () => {
    expect(parseModelJson('```json\n{"semester": "Fall 2026"}\n```')).toEqual({
      semester: "Fall 2026",
    });
    expect(parseModelJson('[{"semester": "Fall 2026"}]')).toEqual({ semester: "Fall 2026" });
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(() => parseModelJson("not json at all")).toThrow(/not valid JSON/i);
  });
});

describe("browser timetable extraction (network contract)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetBrowserAiSessionCounters();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const geminiReply = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  });

  it("fails honestly when no key is in memory", async () => {
    await expect(extractTimetableBrowser("data:image/png;base64,QUJD", null)).rejects.toThrow(
      /No Gemini API key in memory/i,
    );
  });

  it("sends the key in the x-goog-api-key header and the image as inline data", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return geminiReply({
        semester: "Fall 2026",
        courses: [{ id: "CS101", name: "Intro", color: "#1a73e8" }],
        slots: [
          {
            id: "slot-1",
            course_id: "CS101",
            day: "Monday",
            start_time: "09:00",
            end_time: "10:30",
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await extractTimetableBrowser("data:image/png;base64,QUJD", "test-key");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("gemini-3.5-flash");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: "image/png",
      data: "QUJD",
    });
    expect(body.generationConfig.temperature).toBe(0.1);

    expect(result.schedule.courses[0].id).toBe("CS101");
    expect(result.schedule.slots[0].dayIndex).toBe(1);
    // The session counter records the completed call.
    expect(getBrowserAiSessionCalls()).toBe(1);
    expect(getBrowserAiSessionPerModel()["gemini-3.5-flash"]).toBe(1);
  });

  it("falls through to the next model id when one is retired (404)", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return { ok: false, status: 404, text: async () => "model not found" };
      }
      return geminiReply({ courses: [], slots: [] });
    }) as unknown as typeof fetch;

    const result = await extractTimetableBrowser("data:image/png;base64,QUJD", "test-key");

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("gemini-3.8-flash");
    expect(result.schedule.courses).toEqual([]);
  });

  it("surfaces an invalid key and never echoes the key back", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => "API key not valid. key=test-key",
    })) as unknown as typeof fetch;

    await expect(extractTimetableBrowser("data:image/png;base64,QUJD", "test-key")).rejects.toThrow(
      /rejected the API key/i,
    );
    await expect(
      extractTimetableBrowser("data:image/png;base64,QUJD", "test-key"),
    ).rejects.not.toThrow(/test-key/);
  });

  it("reports an exhausted free-tier quota honestly", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "quota exceeded",
    })) as unknown as typeof fetch;

    await expect(extractTimetableBrowser("data:image/png;base64,QUJD", "test-key")).rejects.toThrow(
      /quota for today is exhausted/i,
    );
  });

  it("maps a status onto an honest error", () => {
    expect(mapGeminiStatus(429, "quota").message).toMatch(/quota/i);
    expect(mapGeminiStatus(503, "busy").message).toMatch(/HTTP 503/);
    expect(mapGeminiStatus(403, "API key not valid").message).toMatch(/rejected the API key/i);
  });
});
