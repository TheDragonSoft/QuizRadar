import { describe, it, expect } from "vitest";
import { calculateWhatIf } from "./whatIf";
import type { Assessment } from "../state/types";

describe("whatIf: grade projector arithmetic & honesty", () => {
  const activeAssessment: Assessment = {
    id: "a-midterm",
    courseId: "CSE241",
    title: "Midterm Exam",
    assessmentType: "Midterm Exam",
    isUpcoming: true,
    urgencyLevel: "critical",
    priorityScore: 80,
    topics: [],
    warnings: [],
    source: "GMAIL",
    gcalSynced: false,
    achievedScore: null,
    maxScore: 100,
  };

  it("projects course percentage when this is the first graded assessment", () => {
    const allAssessments: Assessment[] = [activeAssessment];
    const projection = calculateWhatIf(activeAssessment, allAssessments, 85);

    expect(projection.isFirstGraded).toBe(true);
    expect(projection.gradedCount).toBe(0);
    expect(projection.projectedAvg).toBe(85);
    expect(projection.scoreColorClass).toContain("emerald");
  });

  it("calculates honest equal-weight average across other recorded grades in course", () => {
    const quiz1: Assessment = {
      ...activeAssessment,
      id: "a-q1",
      achievedScore: 18,
      maxScore: 20, // 90%
    };

    const quiz2: Assessment = {
      ...activeAssessment,
      id: "a-q2",
      achievedScore: 7,
      maxScore: 10, // 70%
    };

    // Other course assessment should NOT affect this course's projection
    const otherCourseQuiz: Assessment = {
      ...activeAssessment,
      id: "other-q1",
      courseId: "MAT102",
      achievedScore: 50,
      maxScore: 100,
    };

    const allAssessments = [activeAssessment, quiz1, quiz2, otherCourseQuiz];

    // Other recorded items: 90% and 70%.
    // Planned score on active assessment: 80%.
    // Projected average = (90 + 70 + 80) / 3 = 240 / 3 = 80%.
    const projection = calculateWhatIf(activeAssessment, allAssessments, 80);

    expect(projection.isFirstGraded).toBe(false);
    expect(projection.gradedCount).toBe(2);
    expect(projection.projectedAvg).toBe(80);
    expect(projection.scoreColorClass).toContain("emerald");
  });

  it("applies amber and rose color states based on projected threshold", () => {
    const quiz1: Assessment = {
      ...activeAssessment,
      id: "a-q1",
      achievedScore: 60,
      maxScore: 100,
    };

    // Planned 60% => avg 60% => amber
    const projectionAmber = calculateWhatIf(activeAssessment, [activeAssessment, quiz1], 60);
    expect(projectionAmber.projectedAvg).toBe(60);
    expect(projectionAmber.scoreColorClass).toContain("amber");

    // Planned 20% => avg 40% => rose
    const projectionRose = calculateWhatIf(activeAssessment, [activeAssessment, quiz1], 20);
    expect(projectionRose.projectedAvg).toBe(40);
    expect(projectionRose.scoreColorClass).toContain("rose");
  });
});
