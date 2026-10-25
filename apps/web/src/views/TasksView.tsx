import React from "react";
import { Clock, Sparkles } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { coursePalette } from "../lib/coursePalette";
import type { DailyStudyTask, ExamReadinessCard } from "../state/types";

export const TasksView: React.FC = () => {
  const tasksPayload = useAppStore((s) => s.data.studyTasksPayload);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const activeCourseFilter = useAppStore((s) => s.activeCourseFilterTasks);
  const setActiveCourseFilter = useAppStore((s) => s.setActiveCourseFilterTasks);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);

  const pendingCount = tasksPayload.pendingTasks ?? 0;
  const upcomingCount = tasksPayload.readinessCards?.length ?? 0;
  const totalHours = tasksPayload.totalHours ?? null;

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

  return (
    <div data-testid="tasks-view" className="space-y-6">
      {/* Top Header: Summary Line & Course Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--text)]">
            {copy.tasks.roadmapTitle}
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {copy.tasks.summaryLine(pendingCount, upcomingCount, totalHours)}
          </p>
        </div>

        {/* Course Filter Dropdown */}
        <div className="flex items-center gap-2">
          <select
            value={activeCourseFilter}
            onChange={(e) => setActiveCourseFilter(e.target.value)}
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none cursor-pointer"
          >
            <option value="ALL">{copy.tasks.filterAllCourses}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.name}
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
          <span className="text-[11px] font-semibold text-[var(--text-muted)]">
            {filteredCards.length} {filteredCards.length === 1 ? "exam" : "exams"}
          </span>
        </div>

        {filteredCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-6 text-center text-xs text-[var(--text-muted)]">
            {copy.emptyStates.noStudyTasksPending}
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
                    ? "border-[var(--accent)] bg-[var(--surface)] ring-2 ring-[var(--accent)]/20"
                    : "border-[var(--surface-border)] bg-[var(--surface)]"
                }`}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between mb-3 border-b border-[var(--surface-border)] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--text)]">{day.displayDay}</span>
                    <span className="text-xs text-[var(--text-muted)]">({day.date})</span>
                    {day.isToday && (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold shadow-2xs">
                        {copy.tasks.todayBadge}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
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
  const palette = coursePalette(card.courseId || "GENERAL");
  const pct = card.readinessPercent;
  const statusColor =
    pct >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";

  return (
    <div
      data-testid={`readiness-card-${card.assessmentId}`}
      onClick={onClick}
      className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-xs hover:border-[var(--accent)] hover:shadow-sm transition cursor-pointer flex flex-col justify-between space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="px-2 py-0.5 rounded-md text-[11px] font-bold shadow-2xs"
          style={{ backgroundColor: palette.bg, color: palette.color }}
        >
          {card.courseId}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">
            {card.daysUntil === 0 ? "Today" : `in ${card.daysUntil}d`}
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] font-semibold">
            {copy.tasks.avgBadge}
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold text-[var(--text)] line-clamp-1">{card.title}</h3>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-1">
          {card.recommendedFocus}
        </p>
      </div>

      <div className="space-y-1 pt-1 border-t border-[var(--surface-border)]">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] font-semibold text-[var(--text-muted)]">
            {card.completedCount}/{card.totalCount} topics
          </span>
          <span className={`font-bold tabular-nums ${statusColor}`}>{pct}%</span>
        </div>
        <div className="w-full bg-[var(--surface-border)] h-1.5 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-200"
            style={{ width: `${pct}%` }}
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
  const palette = coursePalette(task.courseId || "GENERAL");

  return (
    <div
      data-testid={`roadmap-task-${task.key}`}
      className="flex items-center justify-between py-2.5 px-1 hover:bg-[var(--surface-hover)] transition rounded-lg gap-3"
    >
      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={onToggle}
          className="h-4 w-4 rounded accent-[var(--accent)] cursor-pointer shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-1.5 py-0.2 rounded text-[10px] font-bold"
              style={{ backgroundColor: palette.bg, color: palette.color }}
            >
              {task.courseId}
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
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
            {task.title} • {task.reasoning}
          </p>
        </div>
      </label>

      <div className="flex items-center gap-2 shrink-0">
        {task.estimatedHours != null && (
          <span className="text-[11px] font-semibold tabular-nums text-[var(--text-muted)] flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{task.estimatedHours}h</span>
          </span>
        )}

        <button
          type="button"
          onClick={onOpenDetail}
          className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-border)] transition"
          title="View assessment details"
        >
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
        </button>
      </div>
    </div>
  );
};
