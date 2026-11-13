import type { Story, StoryDefault } from "@ladle/react";
import { ModalStack } from "../components/ModalStack";
import { useAppStore } from "../state/store";
import { seedWorkbench } from "./workbenchFixtures";
import "./modalSetup";

export default { title: "Components / Assessment Detail Modal" } satisfies StoryDefault;

/**
 * The detail modal through the REAL `ModalStack` — backdrop, centering and
 * shell chrome exactly as the app renders it. (Rendering the bare component
 * looked broken: an edge-to-edge sheet glued to the canvas with no dimmed
 * page behind it.)
 */

export const MidtermWithRoom: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  useAppStore.setState({ openModals: [{ id: "assessment-detail" }] });
  return <ModalStack />;
};

/** The fixture's Moodle quiz: no room on the wire — the modal must render
 * the honest "—" placeholder, never a default room string. */
export const OnlineQuizNoRoom: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "moodle-1" });
  useAppStore.setState({ openModals: [{ id: "assessment-detail" }] });
  return <ModalStack />;
};
