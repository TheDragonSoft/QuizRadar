import React from "react";
import { Clock, ChevronRight, Check } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import type { DailyStudyTask, ExamReadinessCard } from "../state/types";

export const TasksView: React.FC = () => {
  const tasksPayload = useAppStore((s) => s.data.studyTasksPayload);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const activeCourseFilter = useAppStore((s) => s.activeCourseFilterTasks);
  const setActiveCourseFilter = useAppStore((s) => s.setActiveCourseFilterTasks);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);

  // Filter readiness cards
  const filteredCards = (tasksPayload.readinessCards || []).filter((card) => {
    if (activeCourseFilter === "ALL") return true;
    return card.courseId === activeCourseFilter;
  });

  // Filter roadmap tasks by course
  const filteredDays = (tasksPayload.days || [])
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
    .filter((day) => day.tasks.length > 0);

  // The summary line must describe exactly what the two sections below render
  // (after the course filter) — never a wider payload count.
  const pendingCount = filteredDays.reduce(
    (sum, day) => sum + day.tasks.filter((t) => !t.completed).length,
    0,
  );
  const upcomingCount = filteredCards.length;
  // The hour estimate must describe the FILTERED list below it. The day's
  // own `totalEstimatedHours` covers every task on that day, so using it
  // after a course filter made the summary promise more hours than the
  // roadmap shows. An estimate is only claimed when every visible task
  // carries one - a partial sum would understate the work.
  const visibleTasks = filteredDays.flatMap((day) => day.tasks);
  const totalHours =
    visibleTasks.length > 0 && visibleTasks.every((task) => task.estimatedHours != null)
      ? visibleTasks.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0)
      : null;
  // A card with no tracked topics has no readiness number (the core's 0/0 =
  // 100 means "nothing pending"). Averaging those in would invent a figure
  // for exams the user never tracked a single topic for.
  const readinessCardsWithTopics = filteredCards.filter((card) => card.totalCount > 0);
  const avgReadiness =
    readinessCardsWithTopics.length > 0
      ? Math.round(
          readinessCardsWithTopics.reduce((sum, card) => sum + card.readinessPercent, 0) /
            readinessCardsWithTopics.length,
        )
      : null;

  return (
    <div data-testid="tasks-view" className="space-y-6">
      {/* Top Header: Summary Line & Course Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--text)]">
            {copy.tasks.roadmapTitle}
          </h1>
          <p className="text-xs tabular-nums text-[var(--text-muted)] mt-0.5">
            {copy.tasks.summaryLine(pendingCount, upcomingCount, totalHours)}
          </p>
        </div>

        {/* Course Filter Dropdown */}
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter study tasks by course"
            value={activeCourseFilter}
            onChange={(e) => setActiveCourseFilter(e.target.value)}
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none cursor-pointer"
          >
            <option value="ALL">{copy.tasks.filterAllCourses}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Section 1: Exam Readiness Cards Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {copy.tasks.readinessTitle}
          </h2>
          <div className="flex items-center gap-2 text-[11px] font-semibold tabular-nums text-[var(--text-muted)]">
            <span>
              {filteredCards.length} {filteredCards.length === 1 ? "exam" : "exams"}
            </span>
            {avgReadiness !== null && (
              <>
                <span>•</span>
                <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[var(--text)]">
                  {avgReadiness}% {copy.tasks.avgBadge}
                </span>
              </>
            )}
          </div>
        </div>

        {filteredCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-6 text-center text-xs text-[var(--text-muted)]">
            {copy.emptyStates.noUpcomingExams}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredCards.map((card) => (
              <ReadinessCard
                key={card.assessmentId}
                card={card}
                onClick={() => openAssessmentDetail(card.assessmentId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Daily Study Roadmap */}
      <div className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {copy.tasks.roadmapTitle}
        </h2>

        {filteredDays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-8 text-center text-xs text-[var(--text-muted)]">
            {copy.emptyStates.noStudyTasksPending}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredDays.map((day) => (
              <div
                key={day.date}
                className={`rounded-2xl border p-4 shadow-xs transition ${
                  day.isToday
                    ? "border-[var(--accent)] bg-[var(--surface)] ring-2 ring-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
                    : "border-[var(--surface-border)] bg-[var(--surface)]"
                }`}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between mb-3 border-b border-[var(--surface-border)] pb-2.5">
                  <div className="flex items-center gap-2">
                    {/* The core's `display_day` already spells the date out
                        ("Sat, Oct 31") — the raw ISO string used to sit next
                        to it in parentheses and leaked the storage format
                        into the UI. */}
                    <span className="text-sm font-bold text-[var(--text)]">{day.displayDay}</span>
                    {day.isToday && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent-fill)] text-white text-[11px] font-bold shadow-2xs">
                        {copy.tasks.todayBadge}
                      </span>
                    )}
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
                    <RoadmapTaskRow
                      key={task.key}
                      task={task}
                      onToggle={() => toggleTopic(task.assessmentId, task.topicIndex)}
                      onOpenDetail={() => openAssessmentDetail(task.assessmentId)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components: ReadinessCard & RoadmapTaskRow
// ---------------------------------------------------------------------------

const ReadinessCard: React.FC<{ card: ExamReadinessCard; onClick: () => void }> = ({
  card,
  onClick,
}) => {
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(card.courseId || "GENERAL");
  const enrolled = courses.find((c) => c.id === card.courseId);
  const chip = courseAccessibleChip(enrolled?.color || palette.color, theme === "dark");
  // No tracked topics = no readiness number to display (the core's 0/0 = 100
  // means "nothing pending", not "100% mastered").
  const hasTopics = card.totalCount > 0;
  const pct = hasTopics ? Math.min(100, Math.max(0, card.readinessPercent)) : null;
  const statusColor =
    pct === null
      ? "text-[var(--text-muted)]"
      : pct >= 80
        ? "text-emerald-700 dark:text-emerald-400"
        : pct >= 50
          ? "text-amber-700 dark:text-amber-400"
          : "text-rose-700 dark:text-rose-400";

  return (
    <div
      data-testid={`readiness-card-${card.assessmentId}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-xs hover:border-[var(--accent)] hover:shadow-sm transition cursor-pointer flex flex-col justify-between space-y-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="px-2 py-0.5 rounded-md border text-[11px] font-bold shadow-2xs"
          style={{
            backgroundColor: chip.bg,
            color: chip.text,
            borderColor: chip.border,
          }}
        >
          {courseDisplayName(card.courseId, courses)}
        </span>
        <span className="text-[11px] uppercase font-bold tabular-nums text-[var(--text-muted)]">
          {card.daysUntil === 0 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-300 text-[10px] font-bold">
              TODAY
            </span>
          ) : card.daysUntil === 1 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
              TOMORROW
            </span>
          ) : (
            // Same casing as every other countdown ("In 3d") — "in 3d" broke
            // the visual rhythm with the uppercase chips beside it.
            copy.dashboard.countdownShort(card.daysUntil ?? 0)
          )}
        </span>
      </div>

      <div>
        <h3 className="text-xs font-bold text-[var(--text)] line-clamp-1 whitespace-pre-line">
          {card.title}
        </h3>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-1">
          {card.recommendedFocus}
        </p>
      </div>

      <div className="space-y-1 pt-1 border-t border-[var(--surface-border)]">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] font-semibold tabular-nums text-[var(--text-muted)]">
            {hasTopics
              ? `${card.completedCount}/${card.totalCount} topics`
              : copy.common.noTopicsTracked}
          </span>
          <span className={`font-bold tabular-nums ${statusColor}`}>
            {pct === null ? "—" : `${pct}%`}
          </span>
        </div>
        <div className="w-full bg-[var(--surface-border)] h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              pct === null
                ? "bg-transparent"
                : pct >= 80
                  ? "bg-emerald-500"
                  : pct >= 50
                    ? "bg-amber-500"
                    : "bg-rose-500"
            }`}
            style={{ width: pct === null ? "0%" : `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
};

const RoadmapTaskRow: React.FC<{
  task: DailyStudyTask;
  onToggle: () => void;
  onOpenDetail: () => void;
}> = ({ task, onToggle, onOpenDetail }) => {
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(task.courseId || "GENERAL");
  const enrolled = courses.find((c) => c.id === task.courseId);
  const chip = courseAccessibleChip(enrolled?.color || palette.color, theme === "dark");

  return (
    <div
      data-testid={`roadmap-task-${task.key}`}
      className="flex items-center justify-between py-2.5 px-1 hover:bg-[var(--surface-hover)] transition rounded-lg gap-3"
    >
      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer select-none group">
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
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-1.5 py-0.5 rounded border text-[11px] font-bold"
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
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate whitespace-pre-line">
            {task.title} • {task.reasoning}
          </p>
        </div>
      </label>

      <div className="flex items-center gap-2 shrink-0">
        {task.estimatedHours != null && (
          <span className="text-[11px] font-semibold tabular-nums text-[var(--text-muted)] flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <span>{task.estimatedHours}h</span>
          </span>
        )}

        <button
          type="button"
          onClick={onOpenDetail}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-border)] transition"
          title="View assessment details"
          aria-label="View assessment details"
        >
          <ChevronRight className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
