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
 * Views point at the `Phone shell/*` stories, which wrap the view in the
 * app's actual phone chrome (TopBar, PullToRefresh main, MobileNav) —
 * without it the views render bare and read as desktop fragments.
 * Modal stories point at `Modals/*` (ModalStack already owns the full
 * screen). Story ids reference stories outside this section — no recursion.
 */

export const Dashboard: Story = () => <PhoneFrame story="phone-shell--dashboard" />;

export const DashboardSolar: Story = () => (
  <PhoneFrame story="phone-shell--dashboard" theme="solar" />
);

export const StudyRoadmapTasks: Story = () => <PhoneFrame story="phone-shell--tasks" />;

export const WeekCalendar: Story = () => <PhoneFrame story="phone-shell--calendar" />;

export const Focus: Story = () => <PhoneFrame story="phone-shell--focus" />;

export const Settings: Story = () => <PhoneFrame story="phone-shell--settings" />;

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
