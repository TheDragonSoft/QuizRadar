import { useEffect, useRef, useState } from "react";
import { User, BookOpen, Sliders, ArrowLeft } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { SettingsSection } from "../state/types";
import {
  SettingsAccountSection,
  SettingsCoursesSection,
  SettingsIntegrationsSection,
  SECTION_ID,
} from "./settings";
import {
  measureActiveSection,
  observeVisibilitySync,
  resolveScrollContainer,
  scrollBehavior,
} from "./settings/scrollSpy";

/**
 * Settings as a full-screen page (one scrollable surface with an anchored
 * side rail on wide screens). Sections anchor-link so `openSettings("courses")`-style
 * callers land exactly where the task they came for lives.
 *
 * Sliced into focused subcomponents under `./settings/`:
 * - SettingsAccountSection
 * - SettingsCoursesSection
 * - SettingsIntegrationsSection
 */
export function SettingsView() {
  const setView = useAppStore((s) => s.setView);
  const pendingSettingsSection = useAppStore((s) => s.pendingSettingsSection);

  // The section the reader is currently looking at — the rail highlights it
  // while the page scrolls (default: the first section, at the top).
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll spy: the settings body scrolls inside the shell's `<main>`
  // viewport, so the offsets are measured against that container (see
  // ./settings/scrollSpy.ts for why this is not an IntersectionObserver).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const container = resolveScrollContainer(root);

    const update = () => {
      const next = measureActiveSection(container);
      setActiveSection((current) => (current === next ? current : next));
    };

    // Measure straight from the scroll handler. The geometry read is cheap
    // (three getBoundingClientRect() calls) and browsers dispatch scroll
    // events at most once per rendered frame anyway — but a requestAnimation-
    // Frame callback is NOT always serviced: Chrome suspends it while the
    // document is hidden, and some automation contexts throttle it. Coalescing
    // the update into a frame therefore left the rail highlighting a stale
    // section even though the page kept scrolling.
    update();
    const target: EventTarget = container;
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    // A hidden page can be scrolled (or restored) without any scroll event
    // reaching us — re-measure when it comes back so the rail never shows a
    // section from before the page went away.
    const stopVisibilitySync = observeVisibilitySync(update);

    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      stopVisibilitySync();
    };
  }, []);

  // A caller that asked for a specific section scrolls the page there, then
  // the request is consumed (jsdom has no scrollIntoView — guard it).
  useEffect(() => {
    if (!pendingSettingsSection) return;
    const element = document.getElementById(SECTION_ID[pendingSettingsSection]);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }
    // The rail follows the section the caller asked for.
    setActiveSection(pendingSettingsSection);
    useAppStore.setState({ pendingSettingsSection: null });
  }, [pendingSettingsSection]);

  const scrollToSection = (section: SettingsSection) => {
    // The rail reacts to the click right away — the smooth scroll below takes
    // a moment and the highlight must not lag behind it.
    setActiveSection(section);
    const element = document.getElementById(SECTION_ID[section]) as
      (HTMLElement & { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }) | null;
    element?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
  };

  return (
    <div ref={rootRef} data-testid="view-settings" className="mx-auto flex w-full max-w-6xl gap-10">
      {/* Side rail (wide screens): anchored section navigation */}
      <nav
        aria-label="Settings sections"
        className="sticky top-6 hidden h-fit w-56 shrink-0 lg:block"
      >
        <button
          type="button"
          onClick={() => setView("dashboard")}
          aria-label="Back to dashboard"
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--surface-hover)] cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>← Back</span>
        </button>
        <div className="flex items-center gap-2.5 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Sliders className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-[var(--text)]">{copy.settings.title}</h1>
        </div>
        <ul className="space-y-1 border-t border-[var(--border)] pt-3">
          {(
            [
              { id: "account", label: copy.settings.tabAccount, Icon: User },
              { id: "courses", label: copy.settings.tabCourses, Icon: BookOpen },
              { id: "integrations", label: copy.settings.tabIntegrations, Icon: Sliders },
            ] as const
          ).map(({ id, label, Icon }) => {
            const isActive = activeSection === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-testid={`settings-nav-${id}`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => scrollToSection(id)}
                  className={`relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      data-testid={`settings-nav-active-${id}`}
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--accent)]"
                    />
                  )}
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 border-t border-[var(--border)] px-3 pt-3 text-xs leading-relaxed text-[var(--text-muted)]">
          {copy.settings.pageSubtitle}
        </p>
      </nav>

      {/* Scrollable page body */}
      <div className="min-w-0 flex-1 space-y-10 pb-16">
        {/* Breadcrumb navigation */}
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-xs text-[var(--text-muted)]"
        >
          <button
            type="button"
            onClick={() => setView("dashboard")}
            className="flex items-center gap-1.5 font-semibold text-[var(--accent-ink)] hover:underline cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Dashboard</span>
          </button>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-[var(--text)]">{copy.settings.title}</span>
        </nav>

        {/* Mobile header (the rail carries the title on lg+) */}
        <div className="lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              aria-label="Back to dashboard"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text)] transition hover:bg-[var(--surface-hover)] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h1 className="text-lg font-bold text-[var(--text)]">{copy.settings.title}</h1>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.settings.pageSubtitle}</p>
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {(
              [
                { id: "account", label: copy.settings.tabAccount },
                { id: "courses", label: copy.settings.tabCourses },
                { id: "integrations", label: copy.settings.tabIntegrations },
              ] as const
            ).map(({ id, label }) => {
              const isActive = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`settings-mobile-nav-${id}`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => scrollToSection(id)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]"
                      : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ================= ACCOUNT ================= */}
        <SettingsAccountSection />

        {/* ================= COURSES ================= */}
        <SettingsCoursesSection />

        {/* ================= INTEGRATIONS ================= */}
        <SettingsIntegrationsSection />
      </div>
    </div>
  );
}
