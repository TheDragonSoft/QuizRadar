import React from "react";
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
  return (
    <section data-testid="view-tasks" className="view-transition">
      <FullTasksView />
    </section>
  );
};

export const CalendarView: React.FC = () => {
  return (
    <section data-testid="view-calendar" className="view-transition">
      <FullCalendarView />
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
