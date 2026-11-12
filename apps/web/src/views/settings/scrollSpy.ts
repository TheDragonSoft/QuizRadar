/**
 * Scroll-spy helpers for the Settings page side rail.
 *
 * The settings body scrolls inside the shell's `<main>` viewport
 * (`main.h-full.overflow-y-auto`, App.tsx) — NOT the window — so the active
 * section is resolved against that container's own box.
 *
 * Why measured offsets instead of an IntersectionObserver band: the three
 * anchored sections have very different heights and the last one can be
 * shorter than the viewport. A band observer either never reports such a
 * section (it never reaches the band) or reports it only for the instant it
 * crosses, which leaves the rail highlighting a section the user already
 * scrolled past. Measuring the offsets against the real scroll container is
 * deterministic in every one of those cases.
 *
 * Scheduling: the spy measures straight from the scroll handler instead of
 * coalescing through `requestAnimationFrame`. The geometry read is cheap
 * (three `getBoundingClientRect()` calls) and browsers dispatch scroll events
 * at most once per rendered frame anyway — but a frame callback is not always
 * serviced: Chrome suspends `requestAnimationFrame` while the document is
 * hidden (background tab, unfocused window) and some automation contexts
 * throttle it. Coalescing the update into a frame therefore froze the rail on
 * a stale section even though the page kept scrolling. Measuring in the
 * handler cannot be starved that way.
 */

import type { SettingsSection } from "../../state/types";
import { SECTION_ID } from "./constants";

/** Anchored settings sections, in document order. */
export const SETTINGS_SECTION_ORDER: readonly SettingsSection[] = [
  "account",
  "courses",
  "integrations",
];

/**
 * How far below the scroll container's top edge a section has to travel
 * before it owns the highlight. It sits comfortably past the `scroll-mt-6`
 * (24px) offset the anchors use, so a clicked section is active at once.
 */
export const ACTIVE_SECTION_LINE_PX = 96;

/** The element that actually scrolls the settings body (or the window). */
export type ScrollContainer = HTMLElement | Window;

/** True when the user asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

/** The scroll behavior to use for an anchor jump. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * Finds the scroller the settings body lives in: the nearest scrollable
 * ancestor (the app shell's `<main>` viewport), falling back to the enclosing
 * `<main>` and finally to the window.
 */
export function resolveScrollContainer(root: HTMLElement | null): ScrollContainer {
  if (typeof window !== "undefined") {
    let node = root?.parentElement ?? null;
    while (node) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        return node;
      }
      node = node.parentElement;
    }
  }
  const main = root?.closest("main");
  return main ?? window;
}

/** True when the scroller sits at its very bottom. */
function isAtBottom(container: ScrollContainer): boolean {
  if (container instanceof HTMLElement) {
    const { scrollTop, scrollHeight, clientHeight } = container;
    // Not scrollable at all → the bottom rule does not apply.
    if (scrollHeight <= clientHeight + 1) return false;
    return scrollTop + clientHeight >= scrollHeight - 2;
  }
  const doc = document.documentElement;
  if (doc.scrollHeight <= window.innerHeight + 1) return false;
  return window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
}

/**
 * Picks the active section from the measured tops: the last section whose top
 * has crossed the activation line, or the first one when none has (the page
 * is still at the top).
 */
export function pickActiveSection(
  tops: ReadonlyArray<{ section: SettingsSection; top: number }>,
  activationLine: number = ACTIVE_SECTION_LINE_PX,
): SettingsSection {
  let active: SettingsSection = tops[0]?.section ?? "account";
  for (const entry of tops) {
    if (entry.top <= activationLine) active = entry.section;
  }
  return active;
}

/** Measures the anchored sections and resolves the one currently in view. */
export function measureActiveSection(container: ScrollContainer): SettingsSection {
  const referenceTop = container instanceof HTMLElement ? container.getBoundingClientRect().top : 0;

  const tops = SETTINGS_SECTION_ORDER.flatMap((section) => {
    const element = document.getElementById(SECTION_ID[section]);
    if (!element) return [];
    return [{ section, top: element.getBoundingClientRect().top - referenceTop }];
  });

  if (tops.length === 0) return "account";
  // The last section can be shorter than the viewport, so it may never cross
  // the activation line — at the very bottom it owns the highlight anyway.
  if (isAtBottom(container)) return tops[tops.length - 1].section;
  return pickActiveSection(tops);
}

/**
 * Re-measures the spy whenever the page becomes visible (or focused) again.
 *
 * A hidden document is not guaranteed to receive scroll notifications with
 * fresh geometry — Chrome suspends `requestAnimationFrame` while it is
 * hidden, and a restore can reposition the page without any scroll event.
 * Re-measuring on the way back guarantees the rail never shows a section
 * from before the page went away.
 *
 * Returns a disposer that removes both listeners.
 */
export function observeVisibilitySync(update: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  const onVisibilityChange = () => {
    // Nothing to re-measure while the page is still hidden.
    if (document.visibilityState !== "hidden") update();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", update);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", update);
  };
}
