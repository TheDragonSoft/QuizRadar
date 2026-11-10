import React, { useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  ChevronRight,
  Sparkles,
  Timer,
} from "lucide-react";
import { copy } from "../../copy";
import { useAppStore } from "../../state/store";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../../lib/coursePalette";
import type { StudyRecommendation } from "../../state/types";
import { formatCompactCardSchedule } from "./formatters";

export interface RecommendationCardProps {
  index: number;
  recommendation: StudyRecommendation;
  /** The matching assessment's room (v4 looked it up from `appState.assessments`). */
  room?: string | null;
  onToggleTopic: (topicIdx: number) => void;
  onOpenDetail: () => void;
}

export const StudyRecommendationCard: React.FC<RecommendationCardProps> = ({
  index,
  recommendation: rec,
  room,
  onToggleTopic,
  onOpenDetail,
}) => {
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(rec.courseId || "GENERAL");
  const enrolled = courses.find((c) => c.id === rec.courseId);
  const accent = rec.color || enrolled?.color || palette.color;
  const chip = courseAccessibleChip(accent, theme === "dark");
  const completedCount = rec.topics.filter((t) => t.completed).length;
  const totalCount = rec.topics.length;
  // 0 tracked topics means there is no readiness number to show at all. The
  // core's 0/0 = 100 semantic means "nothing is pending", not "100% mastered",
  // so the percentage is withheld instead of being rendered as mastery the
  // user never recorded (mirrors the KPI card's `totalTopicsCount === 0` rule).
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null;
  const topicsCount = rec.topics.length;
  const uniqueWarnings = [...new Set(rec.warnings || [])];
  const displaySchedule = formatCompactCardSchedule(rec.displayTime, room);

  const badgeColor =
    (rec.daysUntil ?? 99) <= 1
      ? "border-red-200 bg-red-100 text-red-700 dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-300"
      : (rec.daysUntil ?? 99) <= 4
        ? "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/70 dark:text-amber-300"
        : "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/70 dark:text-blue-300";

  return (
    <div
      data-testid={`rec-card-${rec.assessmentId}`}
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs transition-all duration-200 hover:border-[#1a73e8]/70 hover:shadow-md active:scale-[0.985] sm:p-4 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      {/* Left Course Color Accent Bar */}
      <div
        className="absolute bottom-3 left-0 top-3 w-1.5 rounded-r-full"
        style={{ backgroundColor: chip.dot }}
      />

      <div className="space-y-2 pl-2">
        {/* Top Row: Badges & Readiness Meter */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white dark:bg-slate-800">
              #{index}
            </span>
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
              style={{ backgroundColor: chip.solidBg }}
            >
              {courseDisplayName(rec.courseId, courses)}
            </span>
            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {rec.assessmentType}
            </span>
            {rec.urgencyBadge && (
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${badgeColor}`}
              >
                {rec.urgencyBadge}
              </span>
            )}
          </div>

          {/* Progress Pill — withheld entirely when nothing is tracked */}
          <div className="flex shrink-0 items-center gap-1.5 text-right tabular-nums">
            {progressPct === null ? (
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {copy.common.noTopicsTracked}
              </span>
            ) : (
              <>
                <div
                  role="progressbar"
                  aria-label={`Topic readiness for ${rec.title}`}
                  aria-valuenow={progressPct === null ? 0 : progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 sm:w-16 dark:bg-slate-800"
                >
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                  {progressPct}%
                </span>
              </>
            )}
          </div>
        </div>

        {/* Main Title & Course Name */}
        <div>
          <h3 className="text-xs font-bold leading-snug text-slate-900 transition line-clamp-1 group-hover:text-[var(--accent-ink)] sm:text-sm dark:text-white">
            {rec.title}
          </h3>
          <div className="mt-0.5 truncate text-[11px] text-slate-600 line-clamp-1 dark:text-slate-400">
            {rec.courseName || "—"}
          </div>
        </div>

        {/* Bottom Row: Time / Location Pill & Topics Count & Chevron Details Affordance */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1 text-[11px] text-slate-600 dark:border-slate-800/80 dark:text-slate-400">
          <div className="flex min-w-0 items-center gap-2 truncate">
            <span className="flex items-center gap-1 truncate font-medium">
              <Calendar
                className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]"
                aria-hidden="true"
              />
              <span className="truncate">{displaySchedule}</span>
            </span>
            {topicsCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTopicsExpanded((v) => !v);
                }}
                aria-expanded={topicsExpanded}
                className="inline-flex min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-[#1557b0] hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/60"
              >
                <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                <span>{copy.dashboard.topicsCount(topicsCount)}</span>
                <ChevronRight
                  className={`h-2.5 w-2.5 transition-transform ${topicsExpanded ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </button>
            )}
            {uniqueWarnings.length > 0 && (
              <span className="hidden shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 md:inline-flex dark:bg-amber-950/50 dark:text-amber-300">
                <AlertCircle
                  className="h-2.5 w-2.5 text-amber-700 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>{copy.dashboard.rulesCount(uniqueWarnings.length)}</span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-[var(--accent-ink)] transition-transform group-hover:translate-x-0.5">
            <span>{copy.dashboard.detailsAction}</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </div>

        {/* Inline Topic Checklist (optimistic toggles — 01 §4.3) */}
        {topicsExpanded && topicsCount > 0 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="space-y-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 transition-all duration-200"
          >
            <div className="space-y-1">
              {rec.topics.map((topic) => (
                <div key={topic.key} className="flex items-center gap-2">
                  <label className="group flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 text-xs text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={topic.completed}
                      onChange={() => onToggleTopic(topic.topicIndex)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 cursor-pointer rounded accent-[var(--accent-fill)]"
                    />
                    <span
                      className={`transition ${
                        topic.completed
                          ? "text-slate-600 line-through dark:text-slate-400"
                          : "group-hover:text-[var(--accent-ink)]"
                      }`}
                    >
                      {topic.title}
                    </span>
                  </label>
                  {/* Focus THIS topic: the pomodoro's "Mark Done" completes
                      exactly this topic (spec §4.7). */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      useAppStore.getState().openPomodoro({
                        assessmentId: rec.assessmentId,
                        topicIndex: topic.topicIndex,
                        topicTitle: topic.title,
                      });
                    }}
                    aria-label={`${copy.pomodoro.startForTopic} ${topic.title}`}
                    title={`${copy.pomodoro.startForTopic} ${topic.title}`}
                    className="inline-flex min-h-6 shrink-0 cursor-pointer items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
                  >
                    <Timer className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Target the next pending topic so the modal's "Mark Done"
                  // completes the topic the user is actually working on.
                  const nextTopic = rec.topics.find((t) => !t.completed) ?? rec.topics[0];
                  useAppStore.getState().openPomodoro({
                    assessmentId: rec.assessmentId,
                    topicIndex: nextTopic?.topicIndex,
                    topicTitle: nextTopic?.title,
                  });
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-semibold transition cursor-pointer"
              >
                <Timer className="h-3 w-3" />
                <span>Pomodoro</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  useAppStore.getState().openPracticeQuiz(rec.assessmentId);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent-ink)] text-[11px] font-semibold transition cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                <span>Practice</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
