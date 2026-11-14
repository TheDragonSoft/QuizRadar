import React from "react";
import { Calendar, CheckSquare, LayoutDashboard, LifeBuoy, Settings, Timer } from "lucide-react";
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
  // Expose Settings directly on phones alongside the TopBar gear so settings
  // (accounts, AI key, theme, courses) are always one tap away below 1024px.
  { id: "settings", label: copy.topBar.settings, icon: Settings },
  // The sidebar (and its Help entry) is hidden below 1024px, so without this
  // destination the tier-parity page is unreachable at all on phones and in
  // the 960-1023px desktop window band — compact "Help" label avoids crowding.
  { id: "help", label: "Help", icon: LifeBuoy },
];

export const MobileNav: React.FC = () => {
  const currentView = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  return (
    <nav
      data-testid="app-mobilenav"
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-[var(--surface-border)] bg-[var(--surface)] px-1.5 shadow-lg transition-colors lg:hidden select-none"
    >
      {NAV_DESTINATIONS.map((item) => {
        const Icon = item.icon;
        const isActive = currentView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`mobilenav-${item.id}`}
            onClick={() => setView(item.id)}
            aria-current={isActive ? "page" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1 px-0.5 rounded-lg focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <div
              className={`flex h-7 w-11 sm:h-8 sm:w-14 items-center justify-center rounded-full transition-colors ${
                isActive
                  ? "bg-[var(--accent-fill)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <span
              className={`max-w-full truncate text-[11px] sm:text-xs font-medium leading-none ${
                isActive ? "font-bold text-[var(--accent-ink)]" : "text-[var(--text-muted)]"
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
