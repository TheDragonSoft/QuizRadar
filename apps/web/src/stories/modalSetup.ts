import { registerModal, type ModalComponent } from "../components/modalRegistry";
import { AccountProfileModal } from "../components/AccountProfileModal";
import { AddCourseModal } from "../components/AddCourseModal";
import { AppConfirmModal } from "../components/AppConfirmModal";
import { AssessmentDetailModal } from "../components/AssessmentDetailModal";
import { CloudSyncModal } from "../components/CloudSyncModal";
import { CreateEditAssessmentModal } from "../components/CreateEditAssessmentModal";
import { CreateEditEventModal } from "../components/CreateEditEventModal";
import { OnboardingWizardModal } from "../components/OnboardingWizardModal";
import { PracticeQuizModal } from "../components/PracticeQuizModal";
import { PomodoroModal } from "../components/PomodoroModal";
import { ScanProgressModal } from "../components/ScanProgressModal";
import { SchedulePreviewModal } from "../components/SchedulePreviewModal";
import { SearchPaletteModal } from "../components/SearchPaletteModal";

/**
 * The app registers its modals in `App.tsx` at module load; stories don't
 * mount App, so the workbench registers the same set here. KEEP IN SYNC with
 * `App.tsx` — a new registered modal should get a story here too.
 */
registerModal("search-palette", SearchPaletteModal as unknown as ModalComponent, {
  size: "lg",
  flush: true,
});
registerModal("assessment-detail", AssessmentDetailModal as unknown as ModalComponent, {
  size: "lg",
  flush: true,
  borderless: true,
});
registerModal("create-edit-assessment", CreateEditAssessmentModal as unknown as ModalComponent, {
  size: "md",
  flush: true,
});
registerModal("onboarding", OnboardingWizardModal as unknown as ModalComponent, {
  size: "xl",
  flush: true,
  borderless: true,
});
registerModal("practice-quiz", PracticeQuizModal as unknown as ModalComponent, { size: "lg" });
registerModal("pomodoro", PomodoroModal as unknown as ModalComponent, { size: "sm" });
registerModal("schedule-preview", SchedulePreviewModal as unknown as ModalComponent, {
  size: "xl",
});
registerModal("add-course", AddCourseModal as unknown as ModalComponent, {
  size: "md",
  flush: true,
});
registerModal("create-edit-event", CreateEditEventModal as unknown as ModalComponent, {
  size: "md",
  flush: true,
});
registerModal("app-confirm", AppConfirmModal as unknown as ModalComponent, { size: "sm" });
registerModal("cloud-sync", CloudSyncModal as unknown as ModalComponent, { size: "md" });
registerModal("scan-progress", ScanProgressModal as unknown as ModalComponent, { size: "sm" });
registerModal("account-profile", AccountProfileModal as unknown as ModalComponent, { size: "sm" });
