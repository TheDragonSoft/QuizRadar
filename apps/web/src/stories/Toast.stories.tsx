import type { Story, StoryDefault } from "@ladle/react";
import { ToastContainer } from "../components/Toast";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Components / Toasts" } satisfies StoryDefault;

const STICKY = 3_600_000; // keep toasts on screen while inspecting

/** Success toast: completed exports, saved changes. */
export const Success: Story = () => {
  seedWorkbench({
    toasts: [
      {
        id: "wb-success",
        type: "success",
        message: "Schedule exported — 12 slots.",
        duration: STICKY,
      },
    ],
  });
  return <ToastContainer />;
};

/** Error toast: failed scans surface the failure honestly. */
export const Error: Story = () => {
  seedWorkbench({
    toasts: [
      {
        id: "wb-error",
        type: "error",
        message: "Gmail scan failed: offline.",
        duration: STICKY,
      },
    ],
  });
  return <ToastContainer />;
};

/** Warning toast: retryable/skipped-but-live situations. */
export const Warning: Story = () => {
  seedWorkbench({
    toasts: [
      {
        id: "wb-warning",
        type: "warning",
        message: "Moodle feed skipped — invalid URL, other sources ran.",
        duration: STICKY,
      },
    ],
  });
  return <ToastContainer />;
};

/** Info toast: neutral status lines. */
export const Info: Story = () => {
  seedWorkbench({
    toasts: [
      {
        id: "wb-info",
        type: "info",
        message: "Sync started — this may take up to a minute.",
        duration: STICKY,
      },
    ],
  });
  return <ToastContainer />;
};

/** Mixed stack (the container shows the last two). */
export const SuccessAndError: Story = () => {
  seedWorkbench({
    toasts: [
      {
        id: "wb-success",
        type: "success",
        message: "Schedule exported — 12 slots.",
        duration: STICKY,
      },
      {
        id: "wb-error",
        type: "error",
        message: "Gmail scan failed: offline.",
        duration: STICKY,
      },
    ],
  });
  return <ToastContainer />;
};
