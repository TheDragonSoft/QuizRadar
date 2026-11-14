import type { Story, StoryDefault } from "@ladle/react";
import { SettingsView } from "../views/SettingsView";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Views / Settings" } satisfies StoryDefault;

/**
 * Settings with the fixture's real desktop config (Teams/Moodle/Classroom
 * enabled, one public ICS feed, no user identity). If a section fires an RPC
 * on mount this story fails loudly — mock it at the `setRpcMockHandler` seam,
 * never inside the view.
 */
export const Loaded: Story = () => {
  seedWorkbench({ view: "settings" });
  return <SettingsView />;
};
