import React from "react";
import { Calendar, CheckSquare, LayoutDashboard, Timer } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { View } from "../state/types";

const NAV_DESTINATIONS: ReadonlyArray<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: copy.nav.dashboard, icon: LayoutDashboard },
  { id: "tasks", label: copy.nav.tasks, icon: CheckSquare },
  { id: "calendar", label: copy.nav.calendar, icon: Calendar },
  { id: "focus", label: copy.nav.focus, icon: Timer },
];

export const MobileNav: React.FC = () => {
  const currentView = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  return (
    <nav
      data-testid="app-mobilenav"
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-[var(--surface-border)] bg-[var(--surface)] px-2 shadow-lg transition-colors lg:hidden select-none"
    >
      {NAV_DESTINATIONS.map((item) => {
        const Icon = item.icon;
        const isActive = currentView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            aria-current={isActive ? "page" : undefined}
            className="flex min-w-[64px] flex-col items-center justify-center gap-1 py-1 focus:outline-none"
          >
            <div
              className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
                isActive
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <span
              className={`text-[11px] font-medium leading-none ${
                isActive ? "font-bold text-[var(--accent)]" : "text-[var(--text-muted)]"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
