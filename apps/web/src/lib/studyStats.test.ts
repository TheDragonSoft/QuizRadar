import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateStudyStreak,
  computeStudyStatsSummary,
  loadStoredStudyStats,
  recordPomodoroSession,
} from "./studyStats";
import type { Assessment, StudyRecommendation } from "../state/types";

describe("studyStats", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default stats when storage is empty", () => {
    const stats = loadStoredStudyStats();
    expect(stats.totalMinutes).toBe(0);
    expect(stats.totalSessions).toBe(0);
    expect(stats.dailyMinutes).toEqual({});
  });

  it("records pomodoro sessions incrementally", () => {
    recordPomodoroSession(25);
    let stats = loadStoredStudyStats();
    expect(stats.totalMinutes).toBe(25);
    expect(stats.totalSessions).toBe(1);

    recordPomodoroSession(25);
    stats = loadStoredStudyStats();
    expect(stats.totalMinutes).toBe(50);
    expect(stats.totalSessions).toBe(2);
  });

  it("calculates streak correctly", () => {
    const today = new Date();
    const toIso = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const d0 = new Date(today);
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 2);

    // Active today, yesterday, 2 days ago -> 3 days
    const daily: Record<string, number> = {
      [toIso(d0)]: 25,
      [toIso(d1)]: 50,
      [toIso(d2)]: 25,
    };
    expect(calculateStudyStreak(daily)).toBe(3);

    // If gap between yesterday and 3 days ago -> streak is 2
    const dGap = new Date(today);
    dGap.setDate(dGap.getDate() - 4);
    daily[toIso(dGap)] = 50;
    expect(calculateStudyStreak(daily)).toBe(3);
  });

  it("computes study summary from assessments and study recommendations", () => {
    recordPomodoroSession(30);

    const mockAssessments: Assessment[] = [
      {
        id: "a1",
        courseId: "CS101",
        title: "Midterm",
        assessmentType: "Exam",
        dateIso: "2026-11-20",
        startTime: "10:00",
        source: "syllabus",
        isUpcoming: true,
        daysUntil: 14,
        urgencyLevel: "upcoming",
        priorityScore: 80,
        topics: ["Trees", "Graphs"],
        warnings: [],
      },
      {
        id: "a2",
        courseId: "CS102",
        title: "Quiz 1",
        assessmentType: "Quiz",
        dateIso: "2026-11-01",
        startTime: "09:00",
        source: "moodle",
        isUpcoming: false,
        daysUntil: -5,
        achievedScore: 85,
        urgencyLevel: "past",
        priorityScore: 0,
        topics: [],
        warnings: [],
      },
    ];

    const mockRecs: StudyRecommendation[] = [
      {
        assessmentId: "a1",
        title: "Midterm",
        courseId: "CS101",
        assessmentType: "Exam",
        dateIso: "2026-11-20",
        daysUntil: 14,
        urgencyLevel: "upcoming",
        priorityScore: 80,
        whyStudyNow: "Coming up soon",
        progressPercent: 50,
        topics: [
          { key: "t0", topicIndex: 0, title: "Trees", completed: true },
          { key: "t1", topicIndex: 1, title: "Graphs", completed: false },
        ],
      },
    ];

    const summary = computeStudyStatsSummary(mockAssessments, mockRecs);

    expect(summary.focusMinutesTotal).toBe(30);
    expect(summary.focusSessionsTotal).toBe(1);
    expect(summary.totalAssessments).toBe(2);
    expect(summary.upcomingAssessments).toBe(1);
    expect(summary.completedAssessments).toBe(1);
    expect(summary.gradedAssessmentsCount).toBe(1);
    expect(summary.averageAchievedScore).toBe(85);
    expect(summary.completedTopicsCount).toBe(1);
    expect(summary.totalTopicsCount).toBe(2);
    expect(summary.readinessPercent).toBe(50);
  });
});
