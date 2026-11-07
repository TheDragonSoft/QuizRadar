import React from "react";
import {
  CalendarClock,
  CheckCircle2,
  Flame,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";
import { useAppStore } from "../state/store";
import { useLocalStudyStats } from "../lib/studyStats";

export interface StudyStatsCardProps {
  className?: string;
  variant?: "full" | "compact";
}

export const StudyStatsCard: React.FC<StudyStatsCardProps> = ({
  className = "",
  variant = "full",
}) => {
  const assessments = useAppStore((s) => s.data.assessments);
  const recommendations = useAppStore((s) => s.data.dashboard.studyRecommendations);
  const storeReadiness = useAppStore((s) => s.data.dashboard.readinessPercent);
  const storeTotalTopics = useAppStore((s) => s.data.dashboard.totalTopicsCount);

  const stats = useLocalStudyStats(assessments, recommendations, storeReadiness);
  const isZeroTopics = storeTotalTopics !== undefined ? storeTotalTopics === 0 : stats.totalTopicsCount === 0;

  const formatMinutes = (totalMinutes: number) => {
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  if (variant === "compact") {
    return (
      <div
        data-testid="study-stats-card-compact"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/90 shadow-2xs ${className}`}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-[#1557b0] dark:bg-blue-950/70 dark:text-blue-300">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="text-xs">
            <span className="font-bold tabular-nums text-slate-900 dark:text-white">
              {formatMinutes(stats.focusMinutesTotal)}
            </span>
            <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">
              focused
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="text-xs">
            <span className="font-bold tabular-nums text-slate-900 dark:text-white">
              {isZeroTopics ? "—" : `${stats.readinessPercent}%`}
            </span>
            <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">
              ready
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-300">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="text-xs">
            <span className="font-bold tabular-nums text-slate-900 dark:text-white">
              {stats.studyStreakDays}d
            </span>
            <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">
              streak
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="study-stats-card"
      className={`rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900 shadow-xs ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-xs">
            <Flame className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-slate-900 sm:text-sm dark:text-white">
              Personal Study Stats
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Real-time focus and readiness tracking
            </p>
          </div>
        </div>

        <div
          title="Computed 100% locally from your device database. Never sent to any external server."
          className="flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Local-First</span>
        </div>
      </div>

      {/* 4 Metrics Grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Metric 1: Total Focus */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800/60 dark:bg-slate-800/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Focus Time
            </span>
            <Timer className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl dark:text-white">
              {formatMinutes(stats.focusMinutesTotal)}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {stats.focusSessionsTotal} {stats.focusSessionsTotal === 1 ? "session" : "sessions"} · {stats.focusMinutesToday}m today
            </div>
          </div>
        </div>

        {/* Metric 2: Readiness */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800/60 dark:bg-slate-800/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Overall Readiness
            </span>
            <CheckCircle2
              className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl dark:text-white">
              {isZeroTopics ? "—" : `${stats.readinessPercent}%`}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {stats.completedTopicsCount} / {stats.totalTopicsCount} topics mastered
            </div>
          </div>
        </div>

        {/* Metric 3: Upcoming / Surviving Exams */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800/60 dark:bg-slate-800/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Surviving Radar
            </span>
            <CalendarClock
              className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400"
              aria-hidden="true"
            />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl dark:text-white">
              {stats.upcomingAssessments}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {stats.completedAssessments} passed
              {stats.averageAchievedScore !== null && ` · avg ${stats.averageAchievedScore}%`}
            </div>
          </div>
        </div>

        {/* Metric 4: Study Streak */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800/60 dark:bg-slate-800/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Study Streak
            </span>
            <Zap className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl dark:text-white">
              {stats.studyStreakDays} {stats.studyStreakDays === 1 ? "day" : "days"}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {stats.studyStreakDays > 0 ? "Daily rhythm active" : "Log a session today"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
