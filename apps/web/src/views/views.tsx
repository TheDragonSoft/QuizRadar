import React from "react";
import { Calendar, CheckSquare } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { DashboardView as FullDashboardView } from "./DashboardView";
import { TasksView as FullTasksView } from "./TasksView";
import { CalendarView as FullCalendarView } from "./CalendarView";
import { FocusView as FullFocusView } from "./FocusView";

/**
 * The dashboard renders v4's full layout at all times — the first-run empty
 * state lives inside the study panel (`empty-dashboard-no-courses`), exactly
 * where v4 puts it. No short-circuit wrapper any more.
 */
export const DashboardView: React.FC = () => {
  return (
    <section data-testid="view-dashboard" className="view-transition">
      <FullDashboardView />
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
    <section data-testid="view-focus" className="view-transition">
      <FullFocusView />
    </section>
  );
};

export { HelpView } from "./HelpView";
