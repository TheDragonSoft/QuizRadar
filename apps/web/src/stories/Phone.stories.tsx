import type { Story, StoryDefault } from "@ladle/react";
import { PhoneFrame } from "./phoneFrameHelpers";

export default { title: "Phone (PWA web tier)" } satisfies StoryDefault;

/**
 * The WEB app's own phone rendering — the PWA companion tier (the same React
 * UI shipped to phones as the PWA), inside a real 390×844 phone viewport.
 *
 * This is NOT the Android app's UI: the primary phone experience is the
 * Kotlin/Compose app, rendered on the JVM in the `Phone (Android app)/`
 * section. Each story mounts an iframe pointing at the underlying story with
 * `mode=preview`: an iframe is a real nested viewport, so Tailwind
 * breakpoints follow the phone's width — pixel-identical to the PWA on a
 * phone. Views point at the `Phone shell/*` stories (app chrome included —
 * bare views overflow horizontally and read as desktop fragments). The
 * iframes are live — click through them.
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
