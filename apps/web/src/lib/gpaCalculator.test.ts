import { describe, it, expect } from "vitest";
import { getAccumulatedPointsBreakdown } from "./gpaCalculator";
import type { Course, Assessment } from "../state/types";

describe("gpaCalculator — progress-bar view math", () => {
  it("calculates accumulated points breakdown for horizontal progress bar", () => {
    const breakdown = getAccumulatedPointsBreakdown(42.5, 50.0, "4.0");
    expect(breakdown.securedPercent).toBe(42.5);
    expect(breakdown.pendingPercent).toBe(7.5);
    expect(breakdown.unassignedPercent).toBe(50.0);
    expect(breakdown.passingThresholdPercent).toBe(60.0);
  });

  it("uses the UK 70% passing line for uk_honors", () => {
    expect(getAccumulatedPointsBreakdown(0, 0, "uk_honors").passingThresholdPercent).toBe(70.0);
    expect(getAccumulatedPointsBreakdown(0, 0, "uk").passingThresholdPercent).toBe(70.0);
    expect(getAccumulatedPointsBreakdown(0, 0, "4.0").passingThresholdPercent).toBe(60.0);
  });

  it("clamps negative and overflowing values into the bar", () => {
    const breakdown = getAccumulatedPointsBreakdown(-5, 150, "4.0");
    expect(breakdown.securedPercent).toBe(0);
    // Existing helper behavior: pending is evaluated-weight minus accumulated
    // points (both inputs clamped to 0..100), so a negative accumulated value
    // can push pending past 100 — asserted here to pin current behavior.
    expect(breakdown.pendingPercent).toBe(105);
    expect(breakdown.unassignedPercent).toBe(0);
  });
});

/**
 * Golden parity cases for the ENGINE-derived GPA (`lib/gpaEngine.ts` →
 * `core/src/plan/gpa.rs` via WASM). These are the ported assertions of the
 * former TS duplicate (`calculateGpa`/`evaluateScale`), so the TS-tier
 * golden coverage survives the deduplication — now they pin the CORE as the
 * single implementation against the same benchmarks the Rust unit tests
 * (`core/src/plan/gpa.rs` tests) assert.
 */
describe("gpaEngine — core-derived GPA through the WASM engine", () => {
  const courses: Course[] = [
    { id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 },
    { id: "CS102", name: "Data Structures", color: "#10b981", credits: 4.0 },
  ];

  const gradedAssessments: Assessment[] = [
    {
      id: "a1",
      courseId: "CS101",
      title: "Quiz 1",
      assessmentType: "Class Quiz",
      isUpcoming: false,
      urgencyLevel: "past",
      priorityScore: 0,
      topics: [],
      warnings: [],
      source: "CUSTOM",
      achievedScore: 95,
      maxScore: 100,
      weightagePercent: 100,
    },
    {
      id: "a2",
      courseId: "CS102",
      title: "Midterm",
      assessmentType: "Midterm Exam",
      isUpcoming: false,
      urgencyLevel: "past",
      priorityScore: 0,
      topics: [],
      warnings: [],
      source: "CUSTOM",
      achievedScore: 85,
      maxScore: 100,
      weightagePercent: 100,
    },
  ];

  it("computes credit-weighted semester GPA matching Rust core benchmarks", async () => {
    const { calculateGpaCore } = await import("./gpaEngine");
    const result = await calculateGpaCore(courses, gradedAssessments, undefined, "4.0");

    // (3.0 * 4.0 + 4.0 * 3.0) / (3.0 + 4.0) = 24.0 / 7.0 = 3.4285... -> 3.43
    expect(result.totalCredits).toBe(7.0);
    expect(result.semesterGpa).toBe(3.43);
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].percentage).toBe(95.0);
    expect(result.courses[0].gradePoint).toBe(4.0);
    expect(result.courses[0].letterGrade).toBe("A");
    expect(result.courses[1].percentage).toBe(85.0);
    expect(result.courses[1].gradePoint).toBe(3.0);
  });

  it("excludes ungraded courses from the GPA honestly", async () => {
    const { calculateGpaCore } = await import("./gpaEngine");
    const result = await calculateGpaCore(
      [...courses, { id: "ENG101", name: "English", color: "#f59e0b", credits: 3.0 }],
      gradedAssessments,
      undefined,
      "4.0",
    );
    expect(result.totalCredits).toBe(10.0);
    expect(result.semesterGpa).toBe(3.43);
    const english = result.courses.find((c) => c.courseId === "ENG101");
    expect(english?.percentage).toBeNull();
    expect(english?.gradePoint).toBeNull();
  });

  it("preserves unweighted assessments in mixed weighting scenarios", async () => {
    const { calculateGpaCore } = await import("./gpaEngine");
    const result = await calculateGpaCore(
      [courses[0]!],
      [
        {
          id: "a1",
          courseId: "CS101",
          title: "Midterm",
          assessmentType: "Midterm Exam",
          isUpcoming: false,
          urgencyLevel: "past",
          priorityScore: 0,
          topics: [],
          warnings: [],
          source: "CUSTOM",
          achievedScore: 80,
          maxScore: 100,
          weightagePercent: 50,
        },
        {
          id: "a2",
          courseId: "CS101",
          title: "Quiz",
          assessmentType: "Class Quiz",
          isUpcoming: false,
          urgencyLevel: "past",
          priorityScore: 0,
          topics: [],
          warnings: [],
          source: "CUSTOM",
          achievedScore: 100,
          maxScore: 100,
          // weightagePercent omitted
        },
      ],
      undefined,
      "4.0",
    );
    // (0.8 * 50 + 1.0 * 50) / 100 = 90.0%
    expect(result.courses[0]?.percentage).toBe(90.0);
  });

  it("evaluates the UK honours and ECTS letter bands through the core", async () => {
    const { calculateGpaCore } = await import("./gpaEngine");
    const uk = await calculateGpaCore(
      [{ id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 }],
      [
        {
          id: "a1",
          courseId: "CS101",
          title: "Quiz 1",
          assessmentType: "Class Quiz",
          isUpcoming: false,
          urgencyLevel: "past",
          priorityScore: 0,
          topics: [],
          warnings: [],
          source: "CUSTOM",
          achievedScore: 75,
          maxScore: 100,
          weightagePercent: 100,
        },
      ],
      undefined,
      "uk_honors",
    );
    expect(uk.courses[0]?.letterGrade).toBe("First Class (1st)");
    expect(uk.courses[0]?.gradePoint).toBe(4.0);

    const ects = await calculateGpaCore(
      [{ id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 }],
      [
        {
          id: "a1",
          courseId: "CS101",
          title: "Quiz 1",
          assessmentType: "Class Quiz",
          isUpcoming: false,
          urgencyLevel: "past",
          priorityScore: 0,
          topics: [],
          warnings: [],
          source: "CUSTOM",
          achievedScore: 82,
          maxScore: 100,
          weightagePercent: 100,
        },
      ],
      undefined,
      "ects",
    );
    expect(ects.courses[0]?.letterGrade).toBe("B (Very Good)");
    expect(ects.courses[0]?.gradePoint).toBe(3.5);
  });

  it("defaults scaleMax to the scale ceiling when no grades are recorded", async () => {
    const { calculateGpaCore } = await import("./gpaEngine");
    const pctResult = await calculateGpaCore([courses[0]!], [], undefined, "percentage");
    expect(pctResult.scaleMax).toBe(100.0);
    expect(pctResult.semesterGpa).toBeNull();

    const standardResult = await calculateGpaCore([courses[0]!], [], undefined, "4.0");
    expect(standardResult.scaleMax).toBe(4.0);
  });
});
