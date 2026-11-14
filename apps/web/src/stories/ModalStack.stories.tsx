import type { Story, StoryDefault } from "@ladle/react";
import { ModalStack } from "../components/ModalStack";
import { useAppStore } from "../state/store";
import { setRpcMockHandler } from "../state/rpc";
import type { ModalInstance, PracticeQuizPayload, SyncOutcome } from "../state/types";
import { seedWorkbench, withConflictData } from "./workbenchFixtures";
import "./modalSetup";

export default { title: "Modals" } satisfies StoryDefault;

/**
 * Every registered modal in every meaningful state, rendered through the
 * real `ModalStack` exactly as the shell does: the store's `openModals`
 * carries the modal id (+ props), the registry supplies sizing/flush
 * metadata. KEEP IN SYNC with `modalSetup.ts` / `App.tsx` — one story per
 * registered id per state. States are seeded from the real contract
 * fixtures (overridden in place where a state needs it), and backend-bound
 * states use the blessed `setRpcMockHandler` seam — never shipped-code
 * branches.
 */

function openModal(modal: ModalInstance): void {
  useAppStore.setState({ openModals: [modal] });
}

function cloneStoreData(): ReturnType<typeof useAppStore.getState>["data"] {
  return JSON.parse(JSON.stringify(useAppStore.getState().data));
}

/** Installs a backend mock through the blessed rpc seam (rpc.ts). */
function mockRpc(handler: (fn: string) => Promise<unknown> | null): void {
  setRpcMockHandler(((fn: string) => handler(fn)) as unknown as Parameters<
    typeof setRpcMockHandler
  >[0]);
}

// --- Assessment detail ----------------------------------------------------

export const AssessmentDetailWithRoom: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  openModal({ id: "assessment-detail" });
  return <ModalStack />;
};

/** The Moodle quiz: no room/instructor on the wire — honest "—" placeholders. */
export const AssessmentDetailNoRoom: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "moodle-1" });
  openModal({ id: "assessment-detail" });
  return <ModalStack />;
};

/** A graded item: achieved score recorded, grade projection + what-if live. */
export const AssessmentDetailGraded: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  const data = cloneStoreData();
  const graded = data.assessments.find((a) => a.id === "teams-1");
  if (graded) {
    graded.achievedScore = 17;
    graded.maxScore = 20;
    graded.weightagePercent = 30;
  }
  useAppStore.setState({ data });
  openModal({ id: "assessment-detail" });
  return <ModalStack />;
};

/** Warning-carrying announcement: exam-overload conflict + warnings, no AI
 * study plan (the honest fallback when the extraction had none). */
export const AssessmentDetailWithWarnings: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  const data = cloneStoreData();
  const warned = data.assessments.find((a) => a.id === "teams-1");
  if (warned) {
    warned.warnings = ["Bring a scientific calculator", "Closed-book, no formula sheet"];
    warned.aiStudyPlan = null;
  }
  useAppStore.setState({ data });
  openModal({ id: "assessment-detail" });
  return <ModalStack />;
};

// --- Onboarding wizard ------------------------------------------------------

/** Fresh student: no courses, signed out, nothing configured. Click "Next
 * Step" to walk the wizard interactively — steps are component state. */
export const OnboardingFreshStart: Story = () => {
  seedWorkbench();
  const data = cloneStoreData();
  data.schedule = { semester: null, courses: [], slots: [] };
  data.auth = {
    authenticated: false,
    email: null,
    name: null,
    picture: null,
    hasGmailScope: false,
    hasCalendarScope: false,
    hasTeamsAuth: false,
  };
  data.config = { ...data.config, onboardingCompleted: false, userEmail: null, userName: null };
  useAppStore.setState({ data });
  openModal({ id: "onboarding" });
  return <ModalStack />;
};

/** Returning student data: fixture courses, sources and identity present. */
export const OnboardingPopulated: Story = () => {
  seedWorkbench();
  openModal({ id: "onboarding" });
  return <ModalStack />;
};

// --- Practice quiz ----------------------------------------------------------

const QUIZ_PAYLOAD: PracticeQuizPayload = {
  assessmentId: "teams-1",
  courseId: "CSE241",
  assessmentTitle: "Midterm Exam",
  questions: [
    {
      id: "q1",
      question: "Which gate outputs 1 only when BOTH inputs are 1?",
      options: ["OR", "AND", "XOR", "NAND"],
      correctIndex: 1,
      explanation: "AND outputs 1 only for the all-ones input combination.",
    },
    {
      id: "q2",
      question: "How many rows does a truth table for 3 variables have?",
      options: ["3", "6", "8", "9"],
      correctIndex: 2,
      explanation: "2^n rows for n variables: 2^3 = 8.",
    },
    {
      id: "q3",
      question: "A Karnaugh map groups adjacent cells whose values are…",
      options: ["0", "1", "Either 0 or 1", "Prime"],
      correctIndex: 1,
      explanation: "K-maps minimize sums of products by grouping adjacent 1 cells.",
    },
  ],
  generatedByAi: false,
  authoredLocally: true,
  credit: { source: "local topic bank" },
};

/** Quiz ready: the mocked backend returned questions — answer and grade. */
export const PracticeQuizReady: Story = () => {
  seedWorkbench();
  mockRpc((fn) => (fn === "practice_generate" ? Promise.resolve(QUIZ_PAYLOAD) : null));
  openModal({ id: "practice-quiz", props: { assessmentId: "teams-1" } });
  return <ModalStack />;
};

/** Generating: the backend call is still pending (deterministic pending mock). */
export const PracticeQuizGenerating: Story = () => {
  seedWorkbench();
  mockRpc((fn) =>
    fn === "practice_generate" ? new Promise<PracticeQuizPayload>(() => undefined) : null,
  );
  openModal({ id: "practice-quiz", props: { assessmentId: "teams-1" } });
  return <ModalStack />;
};

/** Backend failure surfaced honestly in the modal. */
export const PracticeQuizError: Story = () => {
  seedWorkbench();
  mockRpc((fn) =>
    fn === "practice_generate"
      ? Promise.reject(new Error("Gemini quota exceeded — try again after 60s"))
      : null,
  );
  openModal({ id: "practice-quiz", props: { assessmentId: "teams-1" } });
  return <ModalStack />;
};

/** Opened without an assessment: the honest "no assessment selected" error. */
export const PracticeQuizNoAssessment: Story = () => {
  seedWorkbench();
  mockRpc(() => null);
  openModal({ id: "practice-quiz" });
  return <ModalStack />;
};

// --- Pomodoro ---------------------------------------------------------------

export const PomodoroIdle: Story = () => {
  seedWorkbench();
  useAppStore.setState({
    pomodoroMode: "pomodoro",
    pomodoroSecondsLeft: 25 * 60,
    pomodoroIsRunning: false,
  });
  openModal({ id: "pomodoro" });
  return <ModalStack />;
};

/** Focus session mid-run — the countdown ticks live in the story. */
export const PomodoroRunning: Story = () => {
  seedWorkbench();
  useAppStore.setState({
    pomodoroMode: "pomodoro",
    pomodoroSecondsLeft: 1234,
    pomodoroIsRunning: true,
  });
  openModal({ id: "pomodoro" });
  return <ModalStack />;
};

export const PomodoroPaused: Story = () => {
  seedWorkbench();
  useAppStore.setState({
    pomodoroMode: "pomodoro",
    pomodoroSecondsLeft: 731,
    pomodoroIsRunning: false,
  });
  openModal({ id: "pomodoro" });
  return <ModalStack />;
};

export const PomodoroShortBreak: Story = () => {
  seedWorkbench();
  useAppStore.setState({
    pomodoroMode: "shortBreak",
    pomodoroSecondsLeft: 4 * 60 + 12,
    pomodoroIsRunning: true,
  });
  openModal({ id: "pomodoro" });
  return <ModalStack />;
};

// --- Scan progress ----------------------------------------------------------

/** Live scan: honest progress line, cancel available. */
export const ScanProgressSyncing: Story = () => {
  seedWorkbench();
  useAppStore.setState({
    syncStatus: "syncing",
    syncProgressMessage: "Scanning Gmail — 12 of 30 messages",
    syncOutcome: null,
  });
  openModal({ id: "scan-progress" });
  return <ModalStack />;
};

const SCAN_SUCCESS: SyncOutcome = {
  status: "success",
  totalNew: 3,
  totalUpdated: 5,
  notes: ["Gmail: 3 new announcements", "ICS feed: 2 updated", "Teams: 0 new"],
};

export const ScanProgressSuccess: Story = () => {
  seedWorkbench();
  useAppStore.setState({
    syncStatus: "success",
    syncProgressMessage: null,
    syncOutcome: SCAN_SUCCESS,
  });
  openModal({ id: "scan-progress" });
  return <ModalStack />;
};

const SCAN_ERROR: SyncOutcome = {
  status: "error",
  totalNew: 0,
  totalUpdated: 0,
  notes: ["Gmail: rate limited after 8 messages"],
  message: "Gmail rate limited — retry in 60s",
};

export const ScanProgressError: Story = () => {
  seedWorkbench();
  useAppStore.setState({ syncStatus: "error", syncProgressMessage: null, syncOutcome: SCAN_ERROR });
  openModal({ id: "scan-progress" });
  return <ModalStack />;
};

// --- Cloud sync ---------------------------------------------------------------

export const CloudSyncNeverBackedUp: Story = () => {
  seedWorkbench();
  const data = cloneStoreData();
  data.config = { ...data.config, lastBackupPush: null };
  useAppStore.setState({ data });
  openModal({ id: "cloud-sync" });
  return <ModalStack />;
};

export const CloudSyncLastBackup: Story = () => {
  seedWorkbench();
  const data = cloneStoreData();
  data.config = { ...data.config, lastBackupPush: "2026-11-12T09:14:00Z" };
  useAppStore.setState({ data });
  openModal({ id: "cloud-sync" });
  return <ModalStack />;
};

// --- Account profile ----------------------------------------------------------

export const AccountProfileSignedIn: Story = () => {
  seedWorkbench();
  openModal({ id: "account-profile" });
  return <ModalStack />;
};

export const AccountProfileSignedOut: Story = () => {
  seedWorkbench();
  const data = cloneStoreData();
  data.auth = {
    authenticated: false,
    email: null,
    name: null,
    picture: null,
    hasGmailScope: false,
    hasCalendarScope: false,
    hasTeamsAuth: false,
  };
  data.config = { ...data.config, userEmail: null, userName: null, userPicture: null };
  useAppStore.setState({ data });
  openModal({ id: "account-profile" });
  return <ModalStack />;
};

// --- Search palette -----------------------------------------------------------

export const SearchPaletteWithMatches: Story = () => {
  seedWorkbench({ searchQuery: "quiz" });
  openModal({ id: "search-palette" });
  return <ModalStack />;
};

export const SearchPaletteNoMatches: Story = () => {
  seedWorkbench({ searchQuery: "zzzz" });
  openModal({ id: "search-palette" });
  return <ModalStack />;
};

export const SearchPaletteEmptyQuery: Story = () => {
  seedWorkbench({ searchQuery: "" });
  openModal({ id: "search-palette" });
  return <ModalStack />;
};

// --- App confirm ---------------------------------------------------------------

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

export const AppConfirmNonDestructive: Story = () => {
  seedWorkbench();
  openModal({
    id: "app-confirm",
    props: {
      title: "Discard draft?",
      message: "Your changes to this assessment will not be saved.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      destructive: false,
    },
  });
  return <ModalStack />;
};

// --- Create/edit assessment ------------------------------------------------------

export const CreateEditAssessmentNew: Story = () => {
  seedWorkbench();
  openModal({ id: "create-edit-assessment" });
  return <ModalStack />;
};

export const CreateEditAssessmentEditing: Story = () => {
  seedWorkbench();
  const assessment = useAppStore.getState().data.assessments.find((a) => a.id === "teams-1");
  openModal({ id: "create-edit-assessment", props: { assessment } });
  return <ModalStack />;
};

// --- Create/edit event -----------------------------------------------------------

export const CreateEditEventNew: Story = () => {
  seedWorkbench();
  openModal({ id: "create-edit-event" });
  return <ModalStack />;
};

export const CreateEditEventEditing: Story = () => {
  seedWorkbench();
  const todayIso = useAppStore.getState().data.dashboard.referenceDate;
  openModal({
    id: "create-edit-event",
    props: {
      event: {
        id: "evt-1",
        title: "Study: Boolean Algebra",
        courseId: "CSE241",
        eventType: "study",
        dateIso: todayIso,
        startTime: "18:00",
        endTime: "19:30",
        room: "Lab 2",
      },
    },
  });
  return <ModalStack />;
};

// --- Add course --------------------------------------------------------------------

export const AddCoursePopulatedSchedule: Story = () => {
  seedWorkbench();
  openModal({ id: "add-course" });
  return <ModalStack />;
};

/** Empty timetable: the form's collision detection has nothing to collide. */
export const AddCourseEmptySchedule: Story = () => {
  seedWorkbench();
  const data = cloneStoreData();
  data.schedule = { semester: null, courses: [], slots: [] };
  useAppStore.setState({ data });
  openModal({ id: "add-course" });
  return <ModalStack />;
};

// --- Schedule preview ----------------------------------------------------------------

export const SchedulePreviewClean: Story = () => {
  seedWorkbench();
  const schedule = useAppStore.getState().data.schedule;
  openModal({
    id: "schedule-preview",
    props: { extracted: { schedule, droppedCourses: 0, dropped_courses: 0 } },
  });
  return <ModalStack />;
};

/** Import report with dropped rows — the honest "what did not make it" view. */
export const SchedulePreviewDropped: Story = () => {
  seedWorkbench();
  const schedule = useAppStore.getState().data.schedule;
  openModal({
    id: "schedule-preview",
    props: { extracted: { schedule, droppedCourses: 2, dropped_courses: 2 } },
  });
  return <ModalStack />;
};

// --- Conflict banner via stack (full-screen sheet treatment) --------------------------

export const AssessmentDetailConflictContext: Story = () => {
  seedWorkbench({ activeModalAssessmentId: "teams-1" });
  useAppStore.setState({ data: withConflictData(false) });
  openModal({ id: "assessment-detail" });
  return <ModalStack />;
};
