import type { Story, StoryDefault } from "@ladle/react";
import { GoogleMark, MicrosoftMark, RadarMark } from "../components/BrandMarks";
import { MobileNav } from "../components/MobileNav";
import { PrintScheduleDoc } from "../components/PrintScheduleDoc";
import { PullToRefresh } from "../components/PullToRefresh";
import { SearchDropdown } from "../components/SearchDropdown";
import { Sidebar } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Chrome" } satisfies StoryDefault;

const noop = () => undefined;

/** The desktop shell's top bar (sync, search, settings, account). */
export const TopBarDefault: Story = () => {
  seedWorkbench();
  return <TopBar onOpenSettings={noop} onOpenAuth={noop} />;
};

/** The desktop sidebar navigation with the fixture's week exam pins. */
export const SidebarDefault: Story = () => {
  seedWorkbench();
  return <Sidebar />;
};

/**
 * The phone-only bottom navigation. On a desktop-sized canvas it renders its
 * content but the shell hides it with a breakpoint — capture phone stories at
 * a 390px viewport (`mode=preview`) to see it exactly as a phone does.
 */
export const MobileNavDefault: Story = () => {
  seedWorkbench();
  return <MobileNav />;
};

/** Pull-to-refresh wrapper around a scrollable feed. */
export const PullToRefreshDefault: Story = () => {
  seedWorkbench();
  return (
    <PullToRefresh>
      <div className="space-y-2 p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]"
          >
            Announcement row {i + 1}
          </div>
        ))}
      </div>
    </PullToRefresh>
  );
};

/** The print/PDF schedule document, rendered as the printer sees it. */
export const PrintSchedule: Story = () => {
  seedWorkbench();
  return <PrintScheduleDoc />;
};

/** The global search dropdown panel for the seeded query. */
export const SearchDropdownDefault: Story = () => {
  seedWorkbench({ searchQuery: "quiz" });
  return (
    <div className="relative mx-auto h-72 w-full max-w-xl p-6">
      <SearchDropdown />
    </div>
  );
};

/** A query that matches nothing — the dropdown's honest empty panel. */
export const SearchDropdownNoMatches: Story = () => {
  seedWorkbench({ searchQuery: "zzzz" });
  return (
    <div className="relative mx-auto h-72 w-full max-w-xl p-6">
      <SearchDropdown />
    </div>
  );
};

/** The in-tree brand marks (no icon-font dependency). */
export const BrandMarksAll: Story = () => {
  seedWorkbench();
  return (
    <div className="flex items-center gap-6 p-8">
      <RadarMark />
      <RadarMark animated />
      <GoogleMark />
      <MicrosoftMark />
    </div>
  );
};
