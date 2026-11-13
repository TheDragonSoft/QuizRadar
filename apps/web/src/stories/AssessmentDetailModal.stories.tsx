import type { Story, StoryDefault } from "@ladle/react";
import { AssessmentDetailModal } from "../components/AssessmentDetailModal";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Components / Assessment Detail Modal" } satisfies StoryDefault;

/** The full detail modal for the fixture's Teams midterm (room present). */
export const MidtermWithRoom: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  return <AssessmentDetailModal modalId="assessment-detail" onClose={() => undefined} />;
};

/** The fixture's Moodle quiz: no room on the wire — the modal must render
 * the honest "—" placeholder, never a default room string. */
export const OnlineQuizNoRoom: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "moodle-1" });
  return <AssessmentDetailModal modalId="assessment-detail" onClose={() => undefined} />;
};
