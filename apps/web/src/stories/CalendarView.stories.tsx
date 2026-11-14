import type { Story, StoryDefault } from "@ladle/react";
import { CalendarView } from "../views/CalendarView";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Views / Week Calendar" } satisfies StoryDefault;

/**
 * The week calendar on the re-dated fixture week: timetable slots (including
 * the null-room tutorial the core emitted), assessment pins, week lanes.
 */
export const Loaded: Story = () => {
  seedWorkbench({ view: "calendar" });
  return <CalendarView />;
};
