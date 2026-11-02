/**
 * The cold-start gate for the browser (PWA) tier.
 *
 * While the first state load is running the app must NOT render an empty
 * dashboard: for a returning user that empty state claims "you have no
 * courses, no assessments and no grades", which is both wrong and
 * dishonest. The gate says what is actually happening instead.
 *
 * The copy lives here rather than in `src/copy.ts` because this change is
 * scoped to the boot path.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { BootResult } from "./boot";

export function BootLoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="boot-loading"
      className="flex h-screen w-screen items-center justify-center bg-[var(--page)] text-[var(--text)]"
    >
      <div className="text-center">
        <div className="text-sm font-bold">Loading your saved data…</div>
        <div className="mt-1 text-xs opacity-70">
          Reading the schedule and assessments stored on this device.
        </div>
      </div>
    </div>
  );
}

/**
 * Holds the app back until the first state load has finished — but only when
 * there is no snapshot to show. With a snapshot the app renders immediately
 * and refreshes in the background.
 */
export function BootGate({ boot, children }: { boot: BootResult; children: ReactNode }) {
  const [ready, setReady] = useState(boot.hasSnapshot);

  useEffect(() => {
    if (ready) return;
    let active = true;
    void boot.ready
      .catch(() => undefined)
      .then(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [boot, ready]);

  if (!ready) return <BootLoadingScreen />;
  return <>{children}</>;
}
