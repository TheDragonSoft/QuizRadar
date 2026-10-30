import React, { useMemo } from "react";
import { Calendar, CheckSquare, Clock, HelpCircle, Layers, Plus, Timer, Zap } from "lucide-react";
import { copy } from "../copy";
import { useAppStore, addDaysToIsoDate } from "../state/store";
import { computeSyncStatusSummary } from "../state/syncStatus";
import { coursePalette, courseDisplayName } from "../lib/coursePalette";
import { roomLabel } from "../lib/calendarLanes";
import type { View } from "../state/types";
import { MiniCalendar } from "./MiniCalendar";

declare const __APP_VERSION__: string;

/**
 * The two views v5 ships that v4 did not. They live under the rail's primary
 * action so the top bar can carry v4's three-way view switcher unchanged.
 */
const SECONDARY_NAV: ReadonlyArray<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "focus", label: copy.nav.focus, icon: Timer },
  { id: "help", label: copy.nav.help, icon: HelpCircle },
];

/**
 * Left rail — v4 parity port (v4-final:static/index.html `#left-sidebar`).
 *
 * v4's rail order, reproduced here:
 *   1. "Create Study Event" action,
 *   2. the interactive mini month calendar,
 *   3. the "Exams in Selected Week" summary panel,
 *   4. "My calendars" (layer toggles + course filters),
 *   5. the sync-status footer.
 *
 * Deliberate v5 deviations (AGENTS §1 honesty doctrine): a missing room
 * renders "—" (v4 printed "TBD"), and the brand block lives in the top bar
 * exactly as v4 had it, so the rail starts with the action.
 */
export const Sidebar: React.FC = () => {
  const currentView = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);
  const toggleCourseFilter = useAppStore((s) => s.toggleCourseFilter);
  const selectAllCourses = useAppStore((s) => s.selectAllCourses);
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const config = useAppStore((s) => s.data.config);
  const auth = useAppStore((s) => s.data.auth);
  const assessments = useAppStore((s) => s.data.assessments);
  const currentWeekStart = useAppStore((s) => s.currentWeekStart);
  const selectedCalendarDate = useAppStore((s) => s.selectedCalendarDate);
  const setSelectedCalendarDate = useAppStore((s) => s.setSelectedCalendarDate);
  const shiftWeek = useAppStore((s) => s.shiftWeek);
  const openEventModal = useAppStore((s) => s.openEventModal);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const runGcalSync = useAppStore((s) => s.runGcalSync);

  const syncSummary = computeSyncStatusSummary(config, auth);

  const assessmentDates = useMemo(
    () => assessments.map((a) => a.dateIso).filter((d): d is string => Boolean(d)),
    [assessments],
  );

  // The exams of the selected week — the rail's "what is due" summary.
  const weekExams = useMemo(() => {
    const weekDays = new Set<string>();
    for (let index = 0; index < 7; index += 1) {
      weekDays.add(addDaysToIsoDate(currentWeekStart, index));
    }
    return assessments
      .filter((a) => a.dateIso && weekDays.has(a.dateIso))
      .sort((a, b) => a.dateIso!.localeCompare(b.dateIso!));
  }, [assessments, currentWeekStart]);

  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "5.0.0";

  return (
    <aside
      data-testid="app-sidebar"
      aria-label="Main sidebar"
      className="hidden w-64 shrink-0 select-none flex-col overflow-y-auto border-r border-[var(--surface-border)] bg-[var(--surface)] p-4 transition-colors lg:flex"
    >
      <div className="space-y-5">
        {/* Primary action — v4 "Create Study Event" */}
        <button
          type="button"
          data-testid="sidebar-create-event"
          onClick={() => openEventModal()}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-semibold text-[var(--text)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          <span>{copy.sidebar.createEvent}</span>
        </button>

        {/* v5-only secondary views */}
        <nav aria-label="Secondary navigation" className="flex items-center gap-1.5">
          {SECONDARY_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                  isActive
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--surface-border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Mini month calendar — v4 grid, week navigation */}
        <MiniCalendar
          weekStart={currentWeekStart}
          selectedDate={selectedCalendarDate}
          assessmentDates={assessmentDates}
          onSelectDate={setSelectedCalendarDate}
          onShiftWeek={shiftWeek}
        />

        {/* Exams in Selected Week — v4 summary panel */}
        <div
          data-testid="sidebar-week-exams"
          className="rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
              <Zap className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
              <span>{copy.sidebar.weekExamsTitle}</span>
            </span>
            <span
              data-testid="sidebar-week-exam-count"
              className="rounded-md bg-[var(--accent)]/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[var(--accent)]"
            >
              {weekExams.length}
            </span>
          </div>

          {weekExams.length === 0 ? (
            <p className="py-1 text-[11px] text-[var(--text-muted)]">
              {copy.sidebar.weekExamsEmpty}
            </p>
          ) : (
            <div className="space-y-1.5">
              {weekExams.map((exam) => {
                const palette = coursePalette(exam.courseId || "");
                const when = [exam.dayName, exam.startTime].filter(Boolean).join(" ");
                return (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => openAssessmentDetail(exam.id)}
                    className="block w-full cursor-pointer rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] p-2 text-left transition hover:border-[var(--accent)]"
                  >
                    <div className="flex items-center justify-between gap-2 font-bold text-[var(--text)]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: palette.color }}
                          aria-hidden="true"
                        />
                        <span
                          className="truncate"
                          title={courseDisplayName(exam.courseId, courses)}
                        >
                          {courseDisplayName(exam.courseId, courses)}
                        </span>
                      </span>
                      {when && (
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                          {when}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[var(--text)]" title={exam.title}>
                      {exam.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {roomLabel(exam.room)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* My calendars — v4 layer toggles + course filters */}
        <div className="px-0.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text)]">
              {copy.sidebar.myCalendars}
            </span>
            <button
              type="button"
              onClick={selectAllCourses}
              className="min-h-6 cursor-pointer rounded px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              {copy.sidebar.showAll}
            </button>
          </div>

          <div className="space-y-1 text-xs">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[var(--text)] transition hover:bg-[var(--surface-hover)]">
              <input
                type="checkbox"
                checked={layers.exams}
                onChange={() => toggleLayer("exams")}
                className="h-3.5 w-3.5 rounded border-[var(--surface-border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span className="font-semibold">{copy.sidebar.layerExams}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[var(--text)] transition hover:bg-[var(--surface-hover)]">
              <input
                type="checkbox"
                checked={layers.classes}
                onChange={() => toggleLayer("classes")}
                className="h-3.5 w-3.5 rounded border-[var(--surface-border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span className="text-[var(--text)]">{copy.sidebar.layerClasses}</span>
            </label>

            {courses.length > 0 && (
              <>
                <div className="my-1.5 border-t border-[var(--surface-border)]" />
                {courses.map((course) => {
                  const isSelected =
                    selectedCourseIds === null || selectedCourseIds.includes(course.id);
                  const palette = coursePalette(course.id);
                  return (
                    <label
                      key={course.id}
                      className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleCourseFilter(course.id)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-[var(--surface-border)] focus:ring-[var(--accent)]"
                        style={{ accentColor: palette.color }}
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: palette.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate text-[var(--text)]" title={course.name}>
                        {course.name}
                      </span>
                    </label>
                  );
                })}
              </>
            )}

            {courses.length === 0 && (
              <p className="px-1 pt-1 text-[11px] italic text-[var(--text-muted)]">
                {copy.sidebar.noCoursesEnrolled}
              </p>
            )}
          </div>
        </div>

        {/* v4's on-device engine card — the local-only promise, stated plainly */}
        <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-200">
              <Layers
                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span>{copy.sidebar.onDeviceEngine}</span>
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              {copy.sidebar.onDeviceStandalone}
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">{copy.sidebar.onDeviceEngineBody}</p>
        </div>
      </div>

      {/* Sync honesty footer — v4 footer */}
      <div className="mt-4 space-y-1.5 border-t border-[var(--surface-border)] pt-3 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                syncSummary.statusVariant === "active"
                  ? "bg-emerald-500 shadow-sm"
                  : syncSummary.statusVariant === "warning"
                    ? "bg-amber-500"
                    : "bg-slate-400"
              }`}
              aria-hidden="true"
            />
            <span className="truncate font-medium text-[var(--text)]">{syncSummary.label}</span>
          </span>
          <button
            type="button"
            onClick={() => void runGcalSync()}
            className="min-h-6 shrink-0 cursor-pointer rounded px-2 py-1 font-medium text-[var(--accent)] hover:underline"
          >
            {copy.sidebar.pushGcal}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>{syncSummary.lastSyncedText}</span>
        </div>
        <div className="flex items-center gap-1.5 pt-1 text-[11px]">
          <Calendar className="h-3 w-3" aria-hidden="true" />
          <CheckSquare className="h-3 w-3" aria-hidden="true" />
          <span data-testid="version-badge">v{appVersion}</span>
        </div>
      </div>
    </aside>
  );
};
