import React from "react";
import type { Story, StoryDefault } from "@ladle/react";
import { MiniCalendar } from "../components/MiniCalendar";
import { useAppStore } from "../state/store";
import { getWeekStart } from "../state/dateUtils";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Components / MiniCalendar" } satisfies StoryDefault;

/** The sidebar month grid with the fixture's assessment pins. */
export const MonthGrid: Story = () => {
  seedWorkbench();
  const [selectedDate, setSelectedDate] = React.useState(
    () => useAppStore.getState().data.dashboard.referenceDate,
  );
  const assessmentDates = useAppStore
    .getState()
    .data.assessments.map((a) => a.dateIso)
    .filter((dateIso): dateIso is string => typeof dateIso === "string");
  return (
    <div className="max-w-xs p-6">
      <MiniCalendar
        weekStart={getWeekStart(selectedDate)}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        assessmentDates={assessmentDates}
      />
    </div>
  );
};
