import type { Story, StoryDefault } from "@ladle/react";
import { CalendarView } from "../views/CalendarView";
import { DashboardView } from "../views/DashboardView";
import { FocusView } from "../views/FocusView";
import { SettingsView } from "../views/SettingsView";
import { TasksView } from "../views/TasksView";
import { seedWorkbench } from "./workbenchFixtures";
import { PhoneAppShell } from "./phoneShellHelpers";

export default { title: "Phone shell" } satisfies StoryDefault;

/**
 * Each real view inside the app's actual phone shell (TopBar + self-hiding
 * Sidebar + PullToRefresh main + MobileNav — mirrored from `App.tsx`). These
 * are the stories the `Phone/*` section mounts in its phone-sized iframes;
 * capture them at a 390×844 viewport for pixel-true phone rendering.
 */

export const Dashboard: Story = () => {
  seedWorkbench({ view: "dashboard" });
  return (
    <PhoneAppShell>
      <DashboardView />
    </PhoneAppShell>
  );
};

export const Tasks: Story = () => {
  seedWorkbench({ view: "tasks" });
  return (
    <PhoneAppShell>
      <TasksView />
    </PhoneAppShell>
  );
};

export const Calendar: Story = () => {
  seedWorkbench({ view: "calendar" });
  return (
    <PhoneAppShell>
      <CalendarView />
    </PhoneAppShell>
  );
};

export const Focus: Story = () => {
  seedWorkbench({ view: "focus" });
  return (
    <PhoneAppShell>
      <FocusView />
    </PhoneAppShell>
  );
};

export const Settings: Story = () => {
  seedWorkbench({ view: "settings" });
  return (
    <PhoneAppShell>
      <SettingsView />
    </PhoneAppShell>
  );
};
