import React from "react";
import { BookOpen, Calendar, CheckSquare, Plus, Timer } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { DashboardView as FullDashboardView } from "./DashboardView";
import { TasksView as FullTasksView } from "./TasksView";
import { CalendarView as FullCalendarView } from "./CalendarView";

export const DashboardView: React.FC = () => {
  const courses = useAppStore((s) => s.data.schedule.courses);
  const assessments = useAppStore((s) => s.data.assessments);
  const openModal = useAppStore((s) => s.openModal);

  const hasCourses = courses.length > 0;

  return (
    <section data-testid="view-dashboard" className="view-transition space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {copy.nav.dashboard}
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {hasCourses
              ? `${courses.length} enrolled course${courses.length === 1 ? "" : "s"} · ${assessments.length} assessment${assessments.length === 1 ? "" : "s"} on radar`
              : copy.brand.tagline}
          </p>
        </div>
      </div>

      {!hasCourses ? (
        <div
          data-testid="empty-dashboard-no-courses"
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface)] p-12 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--page)] text-[var(--text-muted)]">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-base font-bold text-[var(--text)]">
            {copy.emptyStates.dashboardNoCourses}
          </h2>
          <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
            QuizRadar uses your weekly classes to resolve fuzzy announcement dates into exact
            calendar items.
          </p>
          <button
            type="button"
            onClick={() => openModal("add-course")}
            className="mt-5 flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-95 transition cursor-pointer"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{copy.emptyStates.dashboardAddCourseAction}</span>
          </button>
        </div>
      ) : (
        <FullDashboardView />
      )}
    </section>
  );
};

export const TasksView: React.FC = () => {
  const days = useAppStore((s) => s.data.studyTasksPayload.days);
  const cards = useAppStore((s) => s.data.studyTasksPayload.readinessCards);
  const hasTasks = days.length > 0 || cards.length > 0;

  return (
    <section data-testid="view-tasks" className="view-transition space-y-6">
      {!hasTasks ? (
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{copy.nav.tasks}</h1>
          <div
            data-testid="empty-tasks"
            className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface)] p-12 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--page)] text-[var(--text-muted)]">
              <CheckSquare className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--text)]">
              {copy.emptyStates.noStudyTasksPending}
            </p>
          </div>
        </div>
      ) : (
        <FullTasksView />
      )}
    </section>
  );
};

export const CalendarView: React.FC = () => {
  const slots = useAppStore((s) => s.data.schedule.slots);
  const assessments = useAppStore((s) => s.data.assessments);
  const customEvents = useAppStore((s) => s.data.config.customEvents);
  const hasEvents =
    slots.length > 0 || assessments.length > 0 || (customEvents && customEvents.length > 0);

  return (
    <section data-testid="view-calendar" className="view-transition space-y-6">
      {!hasEvents ? (
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {copy.nav.calendar}
          </h1>
          <div
            data-testid="empty-calendar"
            className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface)] p-12 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--page)] text-[var(--text-muted)]">
              <Calendar className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--text)]">
              {copy.emptyStates.noCalendarItems}
            </p>
          </div>
        </div>
      ) : (
        <FullCalendarView />
      )}
    </section>
  );
};

export const FocusView: React.FC = () => {
  return (
    <section data-testid="view-focus" className="view-transition space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{copy.nav.focus}</h1>

      <div
        data-testid="empty-focus"
        className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface)] p-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--page)] text-[var(--text-muted)]">
          <Timer className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-4 text-sm font-medium text-[var(--text)]">
          {copy.emptyStates.noFocusTaskSelected}
        </p>
      </div>
    </section>
  );
};
