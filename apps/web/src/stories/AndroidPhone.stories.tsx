import type { Story, StoryDefault } from "@ladle/react";

export default { title: "Phone (Android app)" } satisfies StoryDefault;

/**
 * The REAL Android phone UI — the production Kotlin/Compose screens —
 * rendered on the JVM by `AndroidUiCaptureTest` (Robolectric native graphics
 * + the actual Rust-backed `QuizRadarViewModel`, no emulator) and served
 * from the gitignored `.ladle-static/android-ui/` dir.
 *
 * Regenerate after UI changes:
 * `cd apps/mobile-android; .\gradlew.bat testDebugUnitTest --tests
 * "*AndroidUiCaptureTest*"`
 * then refresh this page. These are static renders by design: the Android
 * phone UI is a separate Compose implementation from the web tier — the
 * `Phone (PWA web tier)/` section covers the web app's own phone rendering.
 */

/** Served by the `workbench-android-ui` middleware in `ladle.config.mjs`
 *  from the gitignored `.ladle-static/android-ui/` dir. */
function captureUrl(name: string): string {
  return `/android-ui/${name}.png`;
}

function AndroidScreen({ name, caption }: { name: string; caption: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-300 p-8 dark:bg-slate-950">
      <figure className="m-0">
        <div
          className="overflow-hidden rounded-[2.75rem] border-[10px] border-slate-800 bg-black shadow-2xl"
          style={{ width: 410, height: 864 }}
        >
          <img
            src={captureUrl(name)}
            alt={`QuizRadar Android app: ${caption}`}
            className="block bg-black object-cover"
            style={{ width: 390, height: 844 }}
            onError={(event) => {
              const target = event.currentTarget;
              target.style.display = "none";
              const fallback = target.nextElementSibling;
              if (fallback instanceof HTMLElement) fallback.style.display = "flex";
            }}
          />
          <div
            className="hidden h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-slate-300"
            style={{ display: "none" }}
          >
            <p className="text-sm font-semibold">Capture not generated yet.</p>
            <p className="text-xs text-slate-400">
              Run{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px]">
                gradlew.bat testDebugUnitTest --tests *AndroidUiCaptureTest*
              </code>{" "}
              in apps/mobile-android, then refresh.
            </p>
          </div>
        </div>
        <figcaption className="mt-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400">
          {caption} — production Compose UI, JVM-rendered from code
        </figcaption>
      </figure>
    </div>
  );
}

export const DashboardDark: Story = () => (
  <AndroidScreen name="dashboard-dark" caption="Dashboard (dark)" />
);

export const DashboardLight: Story = () => (
  <AndroidScreen name="dashboard-light" caption="Dashboard (light)" />
);

export const Tasks: Story = () => (
  <AndroidScreen name="tasks-dark" caption="Tasks & daily roadmap" />
);

export const WeekCalendar: Story = () => (
  <AndroidScreen name="calendar-dark" caption="Week calendar" />
);

export const Grades: Story = () => (
  <AndroidScreen name="grades-dark" caption="Grade Center & GPA" />
);

export const Focus: Story = () => (
  <AndroidScreen name="focus-dark" caption="Focus (Pomodoro & practice)" />
);

export const Settings: Story = () => <AndroidScreen name="settings-dark" caption="Settings" />;
