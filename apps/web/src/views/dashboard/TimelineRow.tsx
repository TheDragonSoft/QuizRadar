import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Calendar,
  CalendarPlus,
  GraduationCap,
  Mail,
  MapPin,
  School,
  Users,
} from "lucide-react";
import { copy } from "../../copy";
import { useAppStore } from "../../state/store";
import { isDarkTheme } from "../../state/storage";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../../lib/coursePalette";
import type { Assessment } from "../../state/types";
import { formatShortDate, stripLeadingEmoji } from "./formatters";

/** Source pill/icon lookup — the core's `source_icon` names, with the same
 * mapping for chips built from the source label. */
export function SourceIcon({ name, className }: { name: string; className?: string }) {
  const props = { className, "aria-hidden": true } as const;
  switch (name) {
    case "graduation-cap":
      return <GraduationCap {...props} />;
    case "users":
      return <Users {...props} />;
    case "school":
      return <School {...props} />;
    case "calendar-plus":
      return <CalendarPlus {...props} />;
    case "calendar":
      return <Calendar {...props} />;
    default:
      return <Mail {...props} />;
  }
}

export interface TimelineRowProps {
  assessment: Assessment;
  onClick: () => void;
}

export const TimelineRow: React.FC<TimelineRowProps> = ({ assessment: a, onClick }) => {
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(a.courseId || "GENERAL");
  const enrolled = courses.find((c) => c.id === a.courseId);
  const accent = a.color || enrolled?.color || palette.color;
  const chip = courseAccessibleChip(accent, isDarkTheme(theme));

  const uniqueRules = [...new Set(a.warnings || [])];
  const rulesHtml = uniqueRules.slice(0, 2);

  let timeText = "";
  if (a.startTime && a.endTime) {
    timeText = `${a.startTime} – ${a.endTime}`;
  } else if (a.startTime) {
    timeText = a.startTime;
  } else if (a.endTime) {
    timeText = `Until ${a.endTime}`;
  }
  const dateText = formatShortDate(a.dateIso);
  const dateTimeDisplay = [dateText, timeText].filter(Boolean).join(" · ");

  return (
    <div
      data-testid={`timeline-row-${a.id}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 transition hover:border-[#1a73e8] hover:bg-white sm:p-3 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-500 dark:hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: chip.solidBg }}
          >
            {courseDisplayName(a.courseId, courses)}
          </span>
          <span className="shrink-0 rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {a.assessmentType}
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200">
            <SourceIcon name={a.sourceIcon || "mail"} className="h-2.5 w-2.5" />
            {/* No source means "unknown" - never a fabricated "Gmail". */}
            <span>{a.source?.trim() ? a.source : "—"}</span>
          </span>
          {a.conflictWarning && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-300/60 dark:bg-amber-950/80 dark:text-amber-200"
              title={a.conflictWarning}
            >
              <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
              <span>{copy.dashboard.conflictBadge}</span>
            </span>
          )}
          {a.achievedScore != null && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-300/60 dark:bg-emerald-950/80 dark:text-emerald-200">
              <Award className="h-2.5 w-2.5" aria-hidden="true" />
              <span>
                {a.achievedScore}/{a.maxScore ?? "—"}
              </span>
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            a.isUpcoming
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {/* Honest countdown: undated drafts carry none (never "In 0d"). */}
          {a.isUpcoming && a.daysUntil != null
            ? a.daysUntil === 0
              ? copy.dashboard.heroToday
              : a.daysUntil === 1
                ? copy.dashboard.heroTomorrow
                : copy.dashboard.countdownShort(a.daysUntil)
            : a.semester || "—"}
        </span>
      </div>
      <div className="text-xs font-bold leading-snug text-slate-900 line-clamp-2 dark:text-white">
        {a.title}
      </div>
      <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-600 sm:text-[11px] dark:text-slate-400">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" aria-hidden="true" />
          <span>{dateTimeDisplay || "—"}</span>
        </span>
        {a.room && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            <span>{a.room}</span>
          </span>
        )}
      </div>
      {rulesHtml.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {rulesHtml.map((rule, ruleIndex) => (
            <div
              key={ruleIndex}
              className="flex items-start gap-1.5 rounded-md border border-amber-200/80 bg-amber-50/90 px-2.5 py-1 text-[11px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <AlertCircle
                className="mt-0.5 h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400"
                aria-hidden="true"
              />
              <span>{stripLeadingEmoji(rule)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
