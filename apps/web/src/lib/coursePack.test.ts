import { describe, expect, it } from "vitest";
import {
  COURSE_PACK_URI_PREFIX,
  COURSE_PACK_WEB_BASE_URL,
  buildCoursePackBrowser,
  decodeCoursePackBrowser,
  encodeCoursePackBrowser,
  extractCoursePackFromLocation,
  extractCoursePackToken,
} from "./coursePack";
import { getWasmEngine } from "../pwadapters/wasmBridge";
import type { Assessment, ScheduleData } from "../state/types";

describe("1-Tap Shareable Course Pack codec (web + WASM parity)", () => {
  const sampleSchedule: ScheduleData = {
    semester: "Fall 2026",
    courses: [
      {
        id: "ECE210",
        name: "Digital Systems",
        color: "#1a73e8",
        credits: 3.0,
        aliases: ["ECE 210"],
      },
    ],
    slots: [
      {
        id: "slot-1",
        day: "Mon",
        dayIndex: 1,
        courseId: "ECE210",
        courseName: "Digital Systems",
        type: "Lecture",
        group: null,
        room: "EE-302",
        startTime: "10:00",
        endTime: "11:30",
        displayTime: "10:00–11:30",
        hasQuiz: true,
        quizTitle: "Private quiz note",
      },
    ],
  };

  const sampleAssessments: Assessment[] = [
    {
      id: "syllabus-1",
      courseId: "ECE210",
      courseName: "Digital Systems",
      title: "Midterm Exam",
      assessmentType: "Midterm Exam",
      dateIso: "2026-11-05",
      startTime: "10:00",
      endTime: "11:30",
      room: "Hall A-101",
      weightagePercent: 30,
      achievedScore: 95,
      maxScore: 100,
      topics: ["Boolean Algebra", "FSMs"],
      warnings: ["Bring non-programmable calculator"],
      source: "feed",
      isUpcoming: true,
      priorityScore: 100,
      urgencyLevel: "upcoming",
      elearningUrl: "https://lms.example.edu/private-token",
      googleCalUrl: "https://calendar.google.com/private",
      aiStudyPlan: "Personal private study note",
    },
    {
      id: "other-course-1",
      courseId: "PHY205",
      courseName: "Electromagnetics",
      title: "Lab 1",
      assessmentType: "Lab Assessment",
      dateIso: "2026-11-08",
      topics: [],
      warnings: [],
      source: "email",
      isUpcoming: true,
      priorityScore: 50,
      urgencyLevel: "upcoming",
    },
  ];

  it("strips personal grades, study plans, URLs, and other courses during build", () => {
    const pack = buildCoursePackBrowser("ECE210", sampleSchedule, sampleAssessments);
    expect(pack.course.id).toBe("ECE210");
    expect(pack.slots).toHaveLength(1);
    expect(pack.slots[0].hasQuiz).toBe(false);
    expect(pack.slots[0].quizTitle).toBeNull();
    expect(pack.assessments).toHaveLength(1);
    expect(pack.assessments[0].title).toBe("Midterm Exam");
    expect(pack.assessments[0].weightage_percent).toBe(30);

    const serialized = JSON.stringify(pack);
    expect(serialized).not.toContain("95");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("Personal private study note");
    expect(serialized).not.toContain("PHY205");
    expect(serialized).not.toContain("Private quiz note");
  });

  it("round-trips web URL (#course=), deep link (quizradar://course?d=), raw token, and WASM codec", async () => {
    const exported = await encodeCoursePackBrowser(
      "ECE210",
      sampleSchedule,
      sampleAssessments,
      COURSE_PACK_WEB_BASE_URL,
    );
    expect(exported.links.web_url.startsWith(`${COURSE_PACK_WEB_BASE_URL}#course=`)).toBe(true);
    expect(exported.links.deep_link.startsWith(COURSE_PACK_URI_PREFIX)).toBe(true);
    expect(exported.links.fits_qr).toBe(true);
    expect(exported.qr?.size).toBeGreaterThanOrEqual(21);

    for (const candidate of [
      exported.links.web_url,
      exported.links.deep_link,
      exported.links.token,
    ]) {
      const decoded = await decodeCoursePackBrowser(candidate);
      expect(decoded.course.id).toBe("ECE210");
      expect(decoded.assessments[0].title).toBe("Midterm Exam");
      expect(decoded.assessments[0].weightage_percent).toBe(30);
    }

    const wasm = await getWasmEngine();
    const wasmDecoded = JSON.parse(wasm.decode_course_pack(exported.links.web_url));
    expect(wasmDecoded.course.id).toBe("ECE210");
    expect(wasmDecoded.assessments[0].weightage_percent).toBe(30);
  });

  it("extracts tokens from location hashes/queries and rejects malformed payloads", async () => {
    expect(
      extractCoursePackFromLocation(
        "https://thedragonsoft.github.io/QuizRadar/app/#course=abc_123",
      ),
    ).toBe("abc_123");
    expect(extractCoursePackFromLocation("https://quizradar.app/?course=xyz-789")).toBe("xyz-789");
    expect(extractCoursePackFromLocation("https://quizradar.app/#pair=notcourse")).toBeNull();
    expect(extractCoursePackToken("quizradar://course?d=tok_1")).toBe("tok_1");

    await expect(decodeCoursePackBrowser("not-a-valid-pack!!!")).rejects.toThrow(/Unrecognized/);
    await expect(decodeCoursePackBrowser("aaaa")).rejects.toThrow(/Corrupted Course Pack/);
  });
});
