import type { FC } from "react";
import { ModalStack } from "./components/ModalStack";
import { useStore, type View } from "./store/useStore";
import { CalendarView, Dashboard, Tasks } from "./views/placeholders";

const VIEWS: Record<View, FC> = {
  dashboard: Dashboard,
  tasks: Tasks,
  calendar: CalendarView,
};

const NAV: ReadonlyArray<{ id: View; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
];

/**
 * View-router stub: three placeholder views + the empty `<ModalStack/>`
 * (declarative layer replacing the v4 hardcoded Escape-stack, `04` §4.7).
 * Real chrome (top bar, sidebar, KPIs) lands in phase 08.
 */
export default function App() {
  const view = useStore((state) => state.view);
  const setView = useStore((state) => state.setView);
  const Current = VIEWS[view];

  return (
    <div className="min-h-screen">
      <nav aria-label="Main navigation" className="flex items-center gap-2 p-3">
        <span className="mr-4 text-sm font-bold tracking-tight">QuizRadar</span>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            aria-current={view === item.id ? "page" : undefined}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition"
            style={
              view === item.id
                ? { backgroundColor: "var(--accent)", color: "#ffffff" }
                : { color: "var(--text)" }
            }
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="p-3">
        <Current />
      </main>
      <ModalStack />
    </div>
  );
}
