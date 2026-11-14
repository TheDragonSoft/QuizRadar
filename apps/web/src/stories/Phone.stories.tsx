import type { Story, StoryDefault } from "@ladle/react";
import { PhoneFrame } from "./phoneFrameHelpers";

export default { title: "Phone" } satisfies StoryDefault;

/**
 * Every key surface rendered inside a real 390×844 phone viewport.
 *
 * Each story mounts an iframe pointing at the underlying story with
 * `mode=preview`: an iframe is a real nested viewport, so Tailwind
 * breakpoints follow the phone's width — this is pixel-identical to the
 * app on a phone (a CSS-width frame would NOT be: breakpoints read the
 * window, not the container). The iframes are live — click through them.
 *
 * The story ids below reference stories defined outside this section, so
 * there is no recursion.
 */

export const Dashboard: Story = () => <PhoneFrame story="views--dashboard--loaded" />;

export const DashboardSolar: Story = () => (
  <PhoneFrame story="views--dashboard--loaded" theme="solar" />
);

export const StudyRoadmapTasks: Story = () => (
  <PhoneFrame story="views--study-roadmap-tasks--loaded" />
);

export const WeekCalendar: Story = () => <PhoneFrame story="views--week-calendar--loaded" />;

export const Settings: Story = () => <PhoneFrame story="views--settings--loaded" />;

export const AssessmentDetail: Story = () => <PhoneFrame story="modals--assessment-detail" />;

export const AssessmentDetailNoRoom: Story = () => (
  <PhoneFrame story="components--assessment-detail-modal--online-quiz-no-room" />
);

export const OnboardingWizard: Story = () => <PhoneFrame story="modals--onboarding-wizard" />;

export const SearchPalette: Story = () => (
  <PhoneFrame story="modals--search-palette-with-matches" />
);

export const PracticeQuizReady: Story = () => <PhoneFrame story="modals--practice-quiz-ready" />;

export const PomodoroRunning: Story = () => <PhoneFrame story="modals--pomodoro-running" />;

export const AddCourse: Story = () => <PhoneFrame story="modals--add-course-populated-schedule" />;

export const AppConfirmDestructive: Story = () => (
  <PhoneFrame story="modals--app-confirm-destructive" />
);

export const ConflictBannerUnresolved: Story = () => (
  <PhoneFrame story="components--conflict-banner--unresolved" />
);

export const Toasts: Story = () => <PhoneFrame story="components--toasts--success-and-error" />;

export const ScanProgressSyncing: Story = () => (
  <PhoneFrame story="modals--scan-progress-syncing" />
);
