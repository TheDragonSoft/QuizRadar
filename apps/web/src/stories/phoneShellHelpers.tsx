import React from "react";
import { MobileNav } from "../components/MobileNav";
import { PullToRefresh } from "../components/PullToRefresh";
import { Sidebar } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";

/**
 * The app's phone shell, mirrored line-for-line from `App.tsx`'s render
 * (below the `lg` breakpoint the Sidebar rail hides itself, so including it
 * is authentic phone rendering). Stories MUST render views inside this shell:
 * the views bleed to the screen edges (`-mx-4` heroes) against the shell's
 * `px-4` main padding — rendered bare they overflow and read as "desktop
 * elements in a phone".
 */
export function PhoneAppShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="app-shell"
      className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--page)] text-[var(--text)]"
    >
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <PullToRefresh>
          <main
            data-testid="main-content-viewport"
            className="h-full overflow-y-auto px-4 py-6 pb-24 sm:px-6 lg:pb-8"
          >
            <div className="view-transition w-full">{children}</div>
          </main>
        </PullToRefresh>
      </div>
      <MobileNav />
    </div>
  );
}
