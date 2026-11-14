import type { Story, StoryDefault } from "@ladle/react";
import { ConflictBanner } from "../components/ConflictBanner";
import { useAppStore } from "../state/store";
import { seedWorkbench, withConflictData } from "./workbenchFixtures";

export default { title: "Components / Conflict Banner" } satisfies StoryDefault;

/** Amber state: two same-day critical assessments, no covering study block. */
export const Unresolved: Story = () => {
  seedWorkbench();
  useAppStore.setState({ data: withConflictData(false) });
  return <ConflictBanner />;
};

/** Emerald state: a study block covers the conflict pair (`isMitigated`). */
export const Mitigated: Story = () => {
  seedWorkbench();
  useAppStore.setState({ data: withConflictData(true) });
  return <ConflictBanner />;
};
