import { describe, it, expect } from "vitest";
import { evaluateScale, calculateGpa, getAccumulatedPointsBreakdown } from "./gpaCalculator";
import type { Course, Assessment } from "../state/types";

describe("gpaCalculator — 4 grading scales and credit-weighted GPA", () => {
  it("evaluates US 4.0 scale benchmarks correctly", () => {
    expect(evaluateScale(95, "4.0")).toEqual({ gradePoint: 4.0, letterGrade: "A", scaleMax: 4.0 });
    expect(evaluateScale(91, "4.0")).toEqual({ gradePoint: 3.7, letterGrade: "A-", scaleMax: 4.0 });
    expect(evaluateScale(88, "4.0")).toEqual({ gradePoint: 3.3, letterGrade: "B+", scaleMax: 4.0 });
    expect(evaluateScale(85, "4.0")).toEqual({ gradePoint: 3.0, letterGrade: "B", scaleMax: 4.0 });
    expect(evaluateScale(81, "4.0")).toEqual({ gradePoint: 2.7, letterGrade: "B-", scaleMax: 4.0 });
    expect(evaluateScale(78, "4.0")).toEqual({ gradePoint: 2.3, letterGrade: "C+", scaleMax: 4.0 });
    expect(evaluateScale(74, "4.0")).toEqual({ gradePoint: 2.0, letterGrade: "C", scaleMax: 4.0 });
    expect(evaluateScale(71, "4.0")).toEqual({ gradePoint: 1.7, letterGrade: "C-", scaleMax: 4.0 });
    expect(evaluateScale(68, "4.0")).toEqual({ gradePoint: 1.3, letterGrade: "D+", scaleMax: 4.0 });
    expect(evaluateScale(62, "4.0")).toEqual({ gradePoint: 1.0, letterGrade: "D", scaleMax: 4.0 });
    expect(evaluateScale(50, "4.0")).toEqual({ gradePoint: 0.0, letterGrade: "F", scaleMax: 4.0 });
  });

  it("evaluates UK First Class Honours scale benchmarks correctly", () => {
    expect(evaluateScale(75, "uk_honors")).toEqual({
      gradePoint: 4.0,
      letterGrade: "First Class (1st)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(65, "uk_honors")).toEqual({
      gradePoint: 3.3,
      letterGrade: "Upper Second (2:1)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(55, "uk_honors")).toEqual({
      gradePoint: 2.7,
      letterGrade: "Lower Second (2:2)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(45, "uk_honors")).toEqual({
      gradePoint: 2.0,
      letterGrade: "Third Class (3rd)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(35, "uk_honors")).toEqual({
      gradePoint: 0.0,
      letterGrade: "Fail",
      scaleMax: 4.0,
    });
  });

  it("evaluates ECTS scale benchmarks correctly", () => {
    expect(evaluateScale(92, "ects")).toEqual({
      gradePoint: 4.0,
      letterGrade: "A (Excellent)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(82, "ects")).toEqual({
      gradePoint: 3.5,
      letterGrade: "B (Very Good)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(72, "ects")).toEqual({
      gradePoint: 3.0,
      letterGrade: "C (Good)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(62, "ects")).toEqual({
      gradePoint: 2.5,
      letterGrade: "D (Satisfactory)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(52, "ects")).toEqual({
      gradePoint: 2.0,
      letterGrade: "E (Sufficient)",
      scaleMax: 4.0,
    });
    expect(evaluateScale(42, "ects")).toEqual({
      gradePoint: 0.0,
      letterGrade: "F (Fail)",
      scaleMax: 4.0,
    });
  });

  it("evaluates Percentage scale correctly", () => {
    expect(evaluateScale(88.4, "percentage")).toEqual({
      gradePoint: 88.4,
      letterGrade: "88.4%",
      scaleMax: 100.0,
    });
  });

  it("computes credit-weighted semester GPA matching Rust core benchmarks", () => {
    const courses: Course[] = [
      { id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 },
      { id: "CS102", name: "Data Structures", color: "#10b981", credits: 4.0 },
    ];
    const assessments: Assessment[] = [
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

    const result = calculateGpa(courses, assessments, undefined, "4.0");

    // (3.0 * 4.0 + 4.0 * 3.0) / (3.0 + 4.0) = 24.0 / 7.0 = 3.4285... -> 3.43
    expect(result.totalCredits).toBe(7.0);
    expect(result.semesterGpa).toBe(3.43);
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].percentage).toBe(95.0);
    expect(result.courses[0].gradePoint).toBe(4.0);
    expect(result.courses[1].percentage).toBe(85.0);
    expect(result.courses[1].gradePoint).toBe(3.0);
  });

  it("handles courses without grades honestly (excluded from GPA)", () => {
    const courses: Course[] = [
      { id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 },
      { id: "ENG101", name: "English", color: "#f59e0b", credits: 3.0 },
    ];
    const assessments: Assessment[] = [
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
    ];

    const result = calculateGpa(courses, assessments, undefined, "4.0");
    expect(result.totalCredits).toBe(6.0);
    expect(result.semesterGpa).toBe(4.0);
    expect(result.courses[1].percentage).toBeNull();
    expect(result.courses[1].gradePoint).toBeNull();
  });

  it("calculates accumulated points breakdown for horizontal progress bar", () => {
    const breakdown = getAccumulatedPointsBreakdown(42.5, 50.0, "4.0");
    expect(breakdown.securedPercent).toBe(42.5);
    expect(breakdown.pendingPercent).toBe(7.5);
    expect(breakdown.unassignedPercent).toBe(50.0);
    expect(breakdown.passingThresholdPercent).toBe(60.0);
  });

  it("defaults scaleMax to scale ceiling when no courses have recorded grades", () => {
    const courses: Course[] = [
      { id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 },
    ];
    const pctResult = calculateGpa(courses, [], undefined, "percentage");
    expect(pctResult.scaleMax).toBe(100.0);
    expect(pctResult.semesterGpa).toBeNull();

    const standardResult = calculateGpa(courses, [], undefined, "4.0");
    expect(standardResult.scaleMax).toBe(4.0);
  });

  it("preserves unweighted assessments in mixed weighting scenarios", () => {
    const courses: Course[] = [
      { id: "CS101", name: "Intro to CS", color: "#4f46e5", credits: 3.0 },
    ];
    const assessments: Assessment[] = [
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
    ];

    const result = calculateGpa(courses, assessments, undefined, "4.0");
    // (0.8 * 50 + 1.0 * 50) / 100 = 90.0%
    expect(result.courses[0].percentage).toBe(90.0);
  });
});
