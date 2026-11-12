import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import { calculateDailyStudyCushionCore } from "../lib/cushionEngine";
import type { Course, DailyStudyCushion, DailyStudyDayGroup, DailyStudyTask } from "../state/types";

export interface DailyStudyRoadmapProps {
  days?: DailyStudyDayGroup[];
  activeCourseFilter?: string;
  compactMode?: boolean;
  className?: string;
}

export const DailyStudyRoadmap: React.FC<DailyStudyRoadmapProps> = ({
  days: propDays,
  activeCourseFilter: propCourseFilter,
  compactMode = false,
  className = "",
}) => {
  const storeDays = useAppStore((s) => s.data.studyTasksPayload.days || []);
  const storeFilter = useAppStore((s) => s.activeCourseFilterTasks);
  const activeCourseFilter = propCourseFilter ?? storeFilter;

  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const scheduleSlots = useAppStore((s) => s.data.schedule.slots || []);
  const customEvents = useAppStore((s) => s.data.config.customEvents || []);
  const assessments = useAppStore((s) => s.data.assessments || []);
  const courses = useAppStore((s) => s.data.schedule.courses);

  const rawDays = propDays ?? storeDays;

  // Filter roadmap tasks by course
  const filteredDays = useMemo(
    () =>
      rawDays
        .map((day) => {
          const dayTasks = (day.tasks || []).filter((task) => {
            if (activeCourseFilter === "ALL") return true;
            return task.courseId === activeCourseFilter;
          });
          return {
            ...day,
            tasks: dayTasks,
          };
        })
        .filter((day) => day.tasks.length > 0),
    [rawDays, activeCourseFilter],
  );

  // Cushions are derived by the Rust core (single implementation for every
  // tier), computed over the course-filtered task subset exactly as before —
  // reached through the WASM engine, which initializes asynchronously. The
  // map starts empty (no badge is invented for an unknown day) and fills as
  // the core answers.
  const [cushionsByDate, setCushionsByDate] = useState<Record<string, DailyStudyCushion | null>>(
    {},
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        filteredDays.map(async (day) => {
          try {
            const cushion = await calculateDailyStudyCushionCore(
              day.date,
              scheduleSlots,
              customEvents,
              assessments,
              day.tasks,
              15.0,
            );
            return [day.date, cushion] as const;
          } catch {
            // Engine unavailable or the day's payload could not cross the
            // wire: no cushion badge for this day rather than a fabricated
            // number (honesty doctrine, AGENTS §3.1).
            return [day.date, null] as const;
          }
        }),
      );
      if (!cancelled) setCushionsByDate(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [filteredDays, scheduleSlots, customEvents, assessments]);

  if (filteredDays.length === 0) {
    return (
      <div
        data-testid="daily-study-roadmap"
        className={`rounded-2xl border border-dashed border-[var(--surface-border)] p-6 sm:p-8 text-center text-xs text-[var(--text-muted)] ${className}`}
      >
        <div data-testid="empty-tasks">{copy.emptyStates.noStudyTasksPending}</div>
      </div>
    );
  }

  return (
    <div data-testid="daily-study-roadmap" className={`space-y-4 ${className}`}>
      {filteredDays.map((day) => {
        // Core-derived cushion for this specific day (see the effect above).
        const cushion = cushionsByDate[day.date] ?? null;

        return (
          <div
            key={day.date}
            data-testid={`roadmap-day-${day.date}`}
            className={`rounded-2xl border p-4 shadow-xs transition ${
              day.isToday
                ? "border-[var(--accent)] bg-[var(--surface)] ring-2 ring-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
                : "border-[var(--surface-border)] bg-[var(--surface)]"
            }`}
          >
            {/* Day Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 border-b border-[var(--surface-border)] pb-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-[var(--text)]">{day.displayDay}</span>
                {day.isToday && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--accent-fill)] text-white text-xs font-bold shadow-2xs">
                    {copy.tasks.todayBadge}
                  </span>
                )}

                {/* Study Cushion / Deficit Chip (absent until the core answers) */}
                {cushion !== null &&
                cushion.isDeficit &&
                cushion.deficitHours !== undefined &&
                cushion.deficitHours !== null ? (
                  <span
                    data-testid="study-deficit-badge"
                    title={cushion.warningNote ?? "Study tasks exceed available free hours"}
                    className="flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-300"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>⚠️ Study Time Deficit: -{cushion.deficitHours.toFixed(1)} hrs</span>
                  </span>
                ) : cushion !== null &&
                  cushion.cushionHours !== undefined &&
                  cushion.cushionHours !== null ? (
                  <span
                    data-testid="study-cushion-badge"
                    title={`Available waking capacity after classes: ${cushion.availableHours}h`}
                    className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300"
                  >
                    <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span>+{cushion.cushionHours.toFixed(1)}h Cushion</span>
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                <span>
                  {day.tasks.length} {day.tasks.length === 1 ? "task" : "tasks"}
                </span>
                {day.totalEstimatedHours != null && (
                  <>
                    <span>•</span>
                    <span>{copy.tasks.estHours(day.totalEstimatedHours)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Day Tasks List */}
            <div className="divide-y divide-[var(--surface-border)]">
              {day.tasks.map((task) => (
                <RoadmapTaskItem
                  key={task.key}
                  task={task}
                  courses={courses}
                  compactMode={compactMode}
                  onToggle={() =>
                    task.assessmentId &&
                    task.topicIndex != null &&
                    void toggleTopic(task.assessmentId, task.topicIndex)
                  }
                  onOpenDetail={() => task.assessmentId && openAssessmentDetail(task.assessmentId)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface RoadmapTaskItemProps {
  task: DailyStudyTask;
  courses: Course[];
  compactMode?: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
}

const RoadmapTaskItem: React.FC<RoadmapTaskItemProps> = ({
  task,
  courses,
  compactMode = false,
  onToggle,
  onOpenDetail,
}) => {
  const p = coursePalette(task.courseId || "");
  const chip = courseAccessibleChip(p.color, false);

  return (
    <div
      data-testid={`roadmap-task-${task.key}`}
      className="flex items-center justify-between py-2 px-1 hover:bg-[var(--surface-hover)] transition rounded-lg gap-2 sm:gap-3"
    >
      <label className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 cursor-pointer select-none group">
        <div className="relative flex h-5 w-5 items-center justify-center shrink-0">
          <input
            type="checkbox"
            checked={task.completed}
            onChange={onToggle}
            className="peer absolute inset-0 z-10 h-full w-full opacity-0 cursor-pointer"
          />
          <div className="pointer-events-none h-[18px] w-[18px] rounded-md border-2 border-slate-300 dark:border-slate-600 bg-[var(--surface)] peer-checked:bg-[var(--accent-fill)] peer-checked:border-[var(--accent-fill)] flex items-center justify-center transition-all shadow-2xs group-hover:border-[var(--accent)]">
            <Check
              className={`h-3 w-3 text-white stroke-[3] transition-transform ${
                task.completed ? "scale-100" : "scale-0"
              }`}
            />
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span
              className="px-1.5 py-0.2 rounded border text-[11px] font-bold"
              style={{
                backgroundColor: chip.bg,
                color: chip.text,
                borderColor: chip.border,
              }}
            >
              {courseDisplayName(task.courseId, courses)}
            </span>
            <span
              className={`text-xs transition ${
                task.completed
                  ? "line-through text-[var(--text-muted)]"
                  : "font-semibold text-[var(--text)]"
              }`}
            >
              {task.topicTitle}
            </span>
          </div>
          {!compactMode && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate whitespace-pre-line">
              {task.title} • {task.reasoning}
            </p>
          )}
        </div>
      </label>

      <div className="flex items-center gap-2 shrink-0">
        {task.estimatedHours != null && (
          <span className="text-[11px] sm:text-xs font-semibold tabular-nums text-[var(--text-muted)] flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <span>{task.estimatedHours}h</span>
          </span>
        )}

        <button
          type="button"
          onClick={onOpenDetail}
          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-border)] transition cursor-pointer"
          title="View assessment details"
          aria-label="View assessment details"
        >
          <ChevronRight className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
