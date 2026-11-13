import type { Story, StoryDefault } from "@ladle/react";
import { ToastContainer } from "../components/Toast";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Components / Toasts" } satisfies StoryDefault;

/** Mixed toast stack. Long durations keep them on screen while inspecting. */
export const SuccessAndError: Story = () => {
  seedWorkbench({
    toasts: [
      {
        id: "wb-success",
        type: "success",
        message: "Schedule exported — 12 slots.",
        duration: 3_600_000,
      },
      {
        id: "wb-error",
        type: "error",
        message: "Gmail scan failed: offline.",
        duration: 3_600_000,
      },
    ],
  });
  return <ToastContainer />;
};
