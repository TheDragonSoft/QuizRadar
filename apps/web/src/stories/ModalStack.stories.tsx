import type { Story, StoryDefault } from "@ladle/react";
import { ModalStack } from "../components/ModalStack";
import { useAppStore } from "../state/store";
import type { ModalInstance } from "../state/types";
import { seedWorkbench } from "./workbenchFixtures";
import "./modalSetup";

export default { title: "Modals" } satisfies StoryDefault;

/**
 * Every registered modal, rendered through the real `ModalStack` exactly as
 * the shell does: the store's `openModals` carries the modal id (+ any
 * props), the registry supplies sizing/flush metadata. KEEP IN SYNC with
 * `modalSetup.ts` / `App.tsx` — one story per registered id.
 */

function openModal(modal: ModalInstance): void {
  useAppStore.setState({ openModals: [modal] });
}

export const SearchPalette: Story = () => {
  seedWorkbench({ searchQuery: "quiz" });
  openModal({ id: "search-palette" });
  return <ModalStack />;
};

export const AssessmentDetail: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  openModal({ id: "assessment-detail" });
  return <ModalStack />;
};

export const CreateEditAssessment: Story = () => {
  seedWorkbench();
  openModal({ id: "create-edit-assessment" });
  return <ModalStack />;
};

export const OnboardingWizard: Story = () => {
  seedWorkbench();
  openModal({ id: "onboarding" });
  return <ModalStack />;
};

export const PracticeQuiz: Story = () => {
  seedWorkbench();
  openModal({ id: "practice-quiz", props: { assessmentId: "teams-1" } });
  return <ModalStack />;
};

export const Pomodoro: Story = () => {
  seedWorkbench();
  openModal({ id: "pomodoro" });
  return <ModalStack />;
};

export const SchedulePreview: Story = () => {
  seedWorkbench();
  const schedule = useAppStore.getState().data.schedule;
  openModal({
    id: "schedule-preview",
    props: { extracted: { schedule, droppedCourses: 0, dropped_courses: 0 } },
  });
  return <ModalStack />;
};

export const AddCourse: Story = () => {
  seedWorkbench();
  openModal({ id: "add-course" });
  return <ModalStack />;
};

export const CreateEditEvent: Story = () => {
  seedWorkbench();
  openModal({ id: "create-edit-event" });
  return <ModalStack />;
};

export const AppConfirmDestructive: Story = () => {
  seedWorkbench();
  openModal({
    id: "app-confirm",
    props: {
      title: "Delete event?",
      message: "This removes the study block from your calendar. This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Keep it",
      destructive: true,
    },
  });
  return <ModalStack />;
};

export const CloudSync: Story = () => {
  seedWorkbench();
  openModal({ id: "cloud-sync" });
  return <ModalStack />;
};

export const ScanProgress: Story = () => {
  seedWorkbench();
  openModal({ id: "scan-progress" });
  return <ModalStack />;
};

export const AccountProfile: Story = () => {
  seedWorkbench();
  openModal({ id: "account-profile" });
  return <ModalStack />;
};
