/**
 * Local-First Study Statistics for QuizRadar.
 *
 * 100% On-Device & Zero Egress:
 * Computes study metrics, focus time, topic readiness, and exam completion streaks
 * directly from SQLite/Zustand store and localStorage. No personal data, course names,
 * or timestamps are ever sent to any remote server.
 */

import { useEffect, useState } from "react";
import type { Assessment, StudyRecommendation } from "../state/types";

/** The single localStorage ledger key — exported so adapters/store never mirror the literal. */
export const STUDY_STATS_STORAGE_KEY = "quizradar_local_study_stats_v1";

export interface StoredStudyStats {
  totalMinutes: number;
  totalSessions: number;
  dailyMinutes: Record<string, number>; // "YYYY-MM-DD" -> minutes
  lastUpdated: string; // ISO date
}

export interface StudyStatsSummary {
  focusMinutesTotal: number;
  focusMinutesToday: number;
  focusSessionsTotal: number;
  studyStreakDays: number;
  totalAssessments: number;
  upcomingAssessments: number;
  completedAssessments: number;
  gradedAssessmentsCount: number;
  averageAchievedScore: number | null;
  readinessPercent: number;
  completedTopicsCount: number;
  totalTopicsCount: number;
}

function getTodayIsoString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function loadStoredStudyStats(): StoredStudyStats {
  if (typeof window === "undefined") {
    return {
      totalMinutes: 0,
      totalSessions: 0,
      dailyMinutes: {},
      lastUpdated: getTodayIsoString(),
    };
  }

  try {
    const raw = localStorage.getItem(STUDY_STATS_STORAGE_KEY);
    if (!raw) {
      return {
        totalMinutes: 0,
        totalSessions: 0,
        dailyMinutes: {},
        lastUpdated: getTodayIsoString(),
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredStudyStats>;
    return {
      totalMinutes: Math.max(0, Number(parsed.totalMinutes) || 0),
      totalSessions: Math.max(0, Number(parsed.totalSessions) || 0),
      dailyMinutes:
        parsed.dailyMinutes && typeof parsed.dailyMinutes === "object" ? parsed.dailyMinutes : {},
      lastUpdated:
        typeof parsed.lastUpdated === "string" ? parsed.lastUpdated : getTodayIsoString(),
    };
  } catch {
    return {
      totalMinutes: 0,
      totalSessions: 0,
      dailyMinutes: {},
      lastUpdated: getTodayIsoString(),
    };
  }
}

export function saveStoredStudyStats(stats: StoredStudyStats): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STUDY_STATS_STORAGE_KEY, JSON.stringify(stats));
    window.dispatchEvent(new Event("quizradar:study-stats-updated"));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Validates and restores a focus-minutes ledger payload (backup import).
 * Returns false when the payload is not a shape-valid ledger — the caller
 * reports that honestly instead of trusting the file. On success the ledger
 * is written and the UI's update event fires.
 */
export function writeStoredStudyStats(value: unknown): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  if (!Number.isFinite(Number(raw.totalMinutes)) || !Number.isFinite(Number(raw.totalSessions))) {
    return false;
  }
  if (!raw.dailyMinutes || typeof raw.dailyMinutes !== "object") return false;
  try {
    window.localStorage.setItem(STUDY_STATS_STORAGE_KEY, JSON.stringify(raw));
    window.dispatchEvent(new Event("quizradar:study-stats-updated"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a completed pomodoro session.
 */
export function recordPomodoroSession(minutes: number): StoredStudyStats {
  const current = loadStoredStudyStats();
  const today = getTodayIsoString();
  const currentTodayMinutes = current.dailyMinutes[today] || 0;

  const updated: StoredStudyStats = {
    totalMinutes: current.totalMinutes + minutes,
    totalSessions: current.totalSessions + 1,
    dailyMinutes: {
      ...current.dailyMinutes,
      [today]: currentTodayMinutes + minutes,
    },
    lastUpdated: today,
  };

  saveStoredStudyStats(updated);
  return updated;
}

/**
 * Calculate consecutive day streak from daily study records.
 */
export function calculateStudyStreak(dailyMinutes: Record<string, number>): number {
  const dates = Object.keys(dailyMinutes).filter((d) => (dailyMinutes[d] || 0) > 0);
  if (dates.length === 0) return 0;

  const dateSet = new Set(dates);
  const now = new Date();
  const checkDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const toIso = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  let streak = 0;
  const todayIso = toIso(checkDate);

  // If today has study activity, count today and walk backward
  if (dateSet.has(todayIso)) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  } else {
    // Check if yesterday was active (allowing current day streak to stay alive)
    checkDate.setDate(checkDate.getDate() - 1);
    if (!dateSet.has(toIso(checkDate))) {
      return 0;
    }
  }

  // Walk backward day by day
  while (true) {
    const iso = toIso(checkDate);
    if (dateSet.has(iso)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Compute the complete study summary by combining local focus logs with store state.
 */
export function computeStudyStatsSummary(
  assessments: Assessment[],
  recommendations: StudyRecommendation[],
  storeReadiness?: number,
): StudyStatsSummary {
  const stored = loadStoredStudyStats();
  const today = getTodayIsoString();
  const focusMinutesToday = stored.dailyMinutes[today] || 0;
  const streak = calculateStudyStreak(stored.dailyMinutes);

  let totalTopics = 0;
  let completedTopics = 0;

  recommendations.forEach((rec) => {
    totalTopics += rec.topics.length;
    completedTopics += rec.topics.filter((t) => t.completed).length;
  });

  const readinessPercent =
    storeReadiness !== undefined
      ? storeReadiness
      : totalTopics > 0
        ? Math.round((completedTopics / totalTopics) * 100)
        : 100;

  const totalAssessments = assessments.length;
  const upcomingAssessments = assessments.filter((a) => a.isUpcoming).length;
  const completedAssessments = assessments.filter((a) => !a.isUpcoming).length;

  const gradedAssessments = assessments.filter(
    (a) => a.achievedScore !== undefined && a.achievedScore !== null,
  );
  // Achieved scores are raw points out of `maxScore`, so the average must be
  // taken over per-assessment percentages — averaging raw points mixes
  // incompatible scales whenever graded assessments have different maxScore.
  const gradedPercents: number[] = [];
  gradedAssessments.forEach((a) => {
    if (a.maxScore === undefined || a.maxScore === null || a.maxScore <= 0) return;
    gradedPercents.push(((a.achievedScore ?? 0) / a.maxScore) * 100);
  });
  const averageAchievedScore =
    gradedPercents.length > 0
      ? Math.round(gradedPercents.reduce((sum, p) => sum + p, 0) / gradedPercents.length)
      : null;

  return {
    focusMinutesTotal: stored.totalMinutes,
    focusMinutesToday,
    focusSessionsTotal: stored.totalSessions,
    studyStreakDays: streak,
    totalAssessments,
    upcomingAssessments,
    completedAssessments,
    gradedAssessmentsCount: gradedAssessments.length,
    averageAchievedScore,
    readinessPercent,
    completedTopicsCount: completedTopics,
    totalTopicsCount: totalTopics,
  };
}

/**
 * React hook to observe local study statistics.
 */
export function useLocalStudyStats(
  assessments: Assessment[],
  recommendations: StudyRecommendation[],
  storeReadiness?: number,
): StudyStatsSummary {
  const [summary, setSummary] = useState<StudyStatsSummary>(() =>
    computeStudyStatsSummary(assessments, recommendations, storeReadiness),
  );

  useEffect(() => {
    const refresh = () => {
      setSummary(computeStudyStatsSummary(assessments, recommendations, storeReadiness));
    };

    refresh();
    window.addEventListener("quizradar:study-stats-updated", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener("quizradar:study-stats-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [assessments, recommendations, storeReadiness]);

  return summary;
}
