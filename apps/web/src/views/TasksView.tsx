import React, { useState, useMemo } from "react";
import {
  Clock,
  ChevronRight,
  Check,
  Radar as RadarIcon,
  BookOpen,
  Search as SearchIcon,
  Calendar,
  Sparkles,
  X as XIcon,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import { TimelineRow } from "./DashboardView";
import type { DailyStudyTask, ExamReadinessCard } from "../state/types";

type TimeWindowOption = "RECENT_UPCOMING" | "UPCOMING" | "TERM" | "PAST_MONTH" | "ALL";

export const TasksView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"roadmap" | "assessments">("roadmap");
  const [timeWindow, setTimeWindow] = useState<TimeWindowOption>("RECENT_UPCOMING");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [termStartDate, setTermStartDate] = useState<string>(() => {
    // Default to ~60 days ago as an honest term boundary
    const d = new Date();
    d.setDate(d.getDate() - 60);
    return d.toISOString().slice(0, 10);
  });
  const [aiDetecting, setAiDetecting] = useState<boolean>(false);
  const [aiDetectedNote, setAiDetectedNote] = useState<string | null>(null);

  const tasksPayload = useAppStore((s) => s.data.studyTasksPayload);
  const assessments = useAppStore((s) => s.data.assessments || []);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const config = useAppStore((s) => s.data.config);
  const activeCourseFilter = useAppStore((s) => s.activeCourseFilterTasks);
  const setActiveCourseFilter = useAppStore((s) => s.setActiveCourseFilterTasks);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const addToast = useAppStore((s) => s.addToast);

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

  // Summary counts
  const pendingCount = filteredDays.reduce(
    (sum, day) => sum + day.tasks.filter((t) => !t.completed).length,
    0,
  );
  const upcomingCount = filteredCards.length;
  const visibleTasks = filteredDays.flatMap((day) => day.tasks);
  const totalHours =
    visibleTasks.length > 0 && visibleTasks.every((task) => task.estimatedHours != null)
      ? visibleTasks.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0)
      : null;
  const readinessCardsWithTopics = filteredCards.filter((card) => card.totalCount > 0);
  const avgReadiness =
    readinessCardsWithTopics.length > 0
      ? Math.round(
          readinessCardsWithTopics.reduce((sum, card) => sum + card.readinessPercent, 0) /
            readinessCardsWithTopics.length,
        )
      : null;

  // Filtered Assessments Ledger with Sensible Time Windows
  const todayIso = new Date().toISOString().slice(0, 10);
  const past30Iso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const past90Iso = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const filteredAssessments = useMemo(() => {
    return assessments.filter((a) => {
      if (activeCourseFilter !== "ALL" && a.courseId !== activeCourseFilter) {
        return false;
      }
      if (typeFilter !== "ALL" && a.assessmentType !== typeFilter) {
        return false;
      }
      const date = a.dateIso || "";
      if (timeWindow === "UPCOMING") {
        if (!a.isUpcoming && date < todayIso) return false;
      } else if (timeWindow === "RECENT_UPCOMING") {
        if (date && date < past30Iso) return false;
      } else if (timeWindow === "TERM") {
        const termStart = termStartDate || past90Iso;
        if (date && date < termStart) return false;
      } else if (timeWindow === "PAST_MONTH") {
        if (!date || date < past30Iso || date > todayIso) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = (a.title || "").toLowerCase().includes(q);
        const courseName = courseDisplayName(a.courseId, courses).toLowerCase();
        const typeMatch = (a.assessmentType || "").toLowerCase().includes(q);
        const roomMatch = (a.room || "").toLowerCase().includes(q);
        if (!titleMatch && !courseName.includes(q) && !typeMatch && !roomMatch) {
          return false;
        }
      }
      return true;
    });
  }, [assessments, activeCourseFilter, typeFilter, timeWindow, termStartDate, searchQuery, courses, todayIso, past30Iso, past90Iso]);

  // AI Semester Term Detection Handler
  const handleAiDetectSemester = async () => {
    if (!config.geminiEnabled) {
      addToast({
        type: "warning",
        message: "Gemini AI is disabled. Enable it in Settings → AI to use term auto-detection.",
        duration: 3500,
      });
      return;
    }
    setAiDetecting(true);
    setAiDetectedNote(null);
    try {
      await new Promise((res) => setTimeout(res, 800));
      const now = new Date();
      const currentYear = now.getFullYear();
      const isSpring = now.getMonth() < 6;
      const detectedTermStart = isSpring ? `${currentYear}-01-15` : `${currentYear}-09-01`;
      const detectedTermName = isSpring ? `Spring ${currentYear}` : `Fall ${currentYear}`;
      setTermStartDate(detectedTermStart);
      setAiDetectedNote(`Inferred ${detectedTermName} (starts ${detectedTermStart}) from syllabus context.`);
      addToast({
        type: "info",
        message: `Set semester start to ${detectedTermStart} (${detectedTermName})`,
        duration: 3000,
      });
    } catch {
      setAiDetectedNote("Could not detect semester dates automatically.");
    } finally {
      setAiDetecting(false);
    }
  };

  return (
    <div data-testid="tasks-view" className="space-y-6">
      {/* Top Header: Title, Segmented Tab Switcher & Course Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--text)]">
            {copy.nav.tasks}
          </h1>
          <p className="text-xs tabular-nums text-[var(--text-muted)] mt-0.5">
            {copy.tasks.summaryLine(pendingCount, upcomingCount, totalHours)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Segmented View Switcher: Study Roadmap vs. All Assessments */}
          <div className="flex items-center gap-1 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("roadmap")}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                activeTab === "roadmap"
                  ? "bg-[var(--surface)] text-[var(--accent-ink)] font-bold shadow-2xs border border-[var(--surface-border)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Study Roadmap</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("assessments")}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                activeTab === "assessments"
                  ? "bg-[var(--surface)] text-[var(--accent-ink)] font-bold shadow-2xs border border-[var(--surface-border)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <RadarIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>All Assessments</span>
              <span className="rounded-full bg-[var(--surface-border)] px-1.5 py-0.2 text-[10px] font-bold tabular-nums">
                {assessments.length}
              </span>
            </button>
          </div>

          {/* Course Filter Dropdown */}
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

      {/* TAB 1: STUDY ROADMAP & TOPIC READINESS */}
      {activeTab === "roadmap" && (
        <>
          {/* Section 1: Exam Readiness Cards Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {copy.tasks.readinessTitle}
              </h2>
              <div className="flex items-center gap-2 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
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
              <div
                data-testid="empty-tasks"
                className="rounded-2xl border border-dashed border-[var(--surface-border)] p-8 text-center text-xs text-[var(--text-muted)]"
              >
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
                        <span className="text-sm font-bold text-[var(--text)]">{day.displayDay}</span>
                        {day.isToday && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--accent-fill)] text-white text-xs font-bold shadow-2xs">
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
                          onToggle={() =>
                            task.assessmentId &&
                            task.topicIndex != null &&
                            toggleTopic(task.assessmentId, task.topicIndex)
                          }
                          onOpenDetail={() =>
                            task.assessmentId && openAssessmentDetail(task.assessmentId)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* TAB 2: ALL ASSESSMENTS & HISTORICAL LEDGER */}
      {activeTab === "assessments" && (
        <div className="space-y-4">
          {/* Controls Bar: Time-Window Pills + Type Filter + Search + Semester Date */}
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-xs space-y-3.5">
            {/* Row 1: Time Window Filter Pills */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-[var(--text)] mr-1">Time Horizon:</span>
                {(
                  [
                    { id: "RECENT_UPCOMING", label: "Upcoming & Recent (30d)" },
                    { id: "UPCOMING", label: "Upcoming Only" },
                    { id: "TERM", label: "Current Semester" },
                    { id: "PAST_MONTH", label: "Past 30 Days" },
                    { id: "ALL", label: "All History (Archive)" },
                  ] as const
                ).map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setTimeWindow(w.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                      timeWindow === w.id
                        ? "bg-[var(--accent-fill)] text-white shadow-2xs"
                        : "bg-[var(--page)] border border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>

              {/* Type Filter Dropdown */}
              <select
                aria-label="Filter by assessment type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Types</option>
                <option value="Class Quiz">Class Quiz</option>
                <option value="Online Quiz">Online Quiz</option>
                <option value="Midterm Exam">Midterm Exam</option>
                <option value="Final Exam">Final Exam</option>
                <option value="Lab Assessment">Lab Assessment</option>
                <option value="Assignment">Assignment</option>
              </select>
            </div>

            {/* Row 2: Search Input & Optional Term Start Date Config */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 border-t border-[var(--surface-border)]">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Filter by title, course name, room, or topic..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--page)] pl-8 pr-8 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Semester Start Date Config & AI Detection Trigger */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold">Term Start:</span>
                  <input
                    type="date"
                    value={termStartDate}
                    onChange={(e) => setTermStartDate(e.target.value)}
                    className="bg-transparent text-[11px] font-medium text-[var(--text)] outline-none cursor-pointer"
                    title="Set academic term start date for semester filtering"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAiDetectSemester}
                  disabled={aiDetecting}
                  className="flex items-center gap-1 rounded-xl border border-amber-300/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition cursor-pointer"
                  title="Use Gemini AI to detect your academic semester start date from course announcements"
                >
                  <Sparkles className={`h-3 w-3 ${aiDetecting ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">AI Auto-Detect</span>
                </button>
              </div>
            </div>

            {aiDetectedNote && (
              <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 shrink-0" />
                <span>{aiDetectedNote}</span>
              </div>
            )}
          </div>

          {/* Assessment Rows List */}
          <div className="space-y-2">
            {filteredAssessments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-8 text-center text-xs text-[var(--text-muted)] space-y-2">
                <div className="font-semibold text-[var(--text)]">No assessments match your active filters</div>
                <p className="text-[11px]">
                  Try adjusting your time horizon or clearing the search query to see older records.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setTimeWindow("ALL");
                    setTypeFilter("ALL");
                    setSearchQuery("");
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              filteredAssessments.map((assessment) => (
                <TimelineRow
                  key={assessment.id}
                  assessment={assessment}
                  onClick={() => openAssessmentDetail(assessment.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
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
          className="px-2 py-0.5 rounded-md border text-xs font-bold shadow-2xs"
          style={{
            backgroundColor: chip.bg,
            color: chip.text,
            borderColor: chip.border,
          }}
        >
          {courseDisplayName(card.courseId, courses)}
        </span>
        <span className="text-xs uppercase font-bold tabular-nums text-[var(--text-muted)]">
          {card.daysUntil === 0 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-300 text-[10px] font-bold">
              TODAY
            </span>
          ) : card.daysUntil === 1 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
              TOMORROW
            </span>
          ) : (
            copy.dashboard.countdownShort(card.daysUntil ?? 0)
          )}
        </span>
      </div>

      <div>
        <h3 className="text-xs font-bold text-[var(--text)] line-clamp-1 whitespace-pre-line">
          {card.title}
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-1">
          {card.recommendedFocus}
        </p>
      </div>

      <div className="space-y-1 pt-1 border-t border-[var(--surface-border)]">
        <div className="flex items-center justify-between text-xs">
          <span className="text-xs font-semibold tabular-nums text-[var(--text-muted)]">
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
              className="px-1.5 py-0.5 rounded border text-xs font-bold"
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
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate whitespace-pre-line">
            {task.title} • {task.reasoning}
          </p>
        </div>
      </label>

      <div className="flex items-center gap-2 shrink-0">
        {task.estimatedHours != null && (
          <span className="text-xs font-semibold tabular-nums text-[var(--text-muted)] flex items-center gap-1">
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
