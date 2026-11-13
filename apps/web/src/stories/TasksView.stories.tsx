import type { Story, StoryDefault } from "@ladle/react";
import { TasksView } from "../views/TasksView";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Views / Study Roadmap (Tasks)" } satisfies StoryDefault;

/** The study roadmap: daily task groups, readiness cards, topic checkboxes. */
export const Loaded: Story = () => {
  seedWorkbench({ view: "tasks" });
  return <TasksView />;
};
