import type { Story, StoryDefault } from "@ladle/react";
import { DashboardView } from "../views/DashboardView";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Views / Dashboard" } satisfies StoryDefault;

/**
 * Full dashboard on the real core fixture payloads (re-dated to today).
 * Theme and viewport come from Ladle's global controls.
 */
export const Loaded: Story = () => {
  seedWorkbench({ view: "dashboard" });
  return <DashboardView />;
};
