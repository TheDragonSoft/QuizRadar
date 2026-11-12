/**
 * Regression: the Settings side rail must highlight the section the reader is
 * scrolling through — not keep every button muted until it is clicked.
 *
 * The settings body scrolls inside the shell's `<main>` viewport, so the spy
 * measures the anchored sections against that container (see
 * `views/settings/scrollSpy.ts`). jsdom has neither layout nor scrolling, so
 * the test mocks the scroll geometry and drives the container's scroll event.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../SettingsView";
import { useAppStore, initialFullState } from "../../state/store";

const SECTION_IDS = {
  account: "settings-section-account",
  courses: "settings-section-courses",
  integrations: "settings-section-integrations",
} as const;

/** Distance of each anchored section from the top of the settings body. */
const SECTION_TOPS: Record<string, number> = {
  [SECTION_IDS.account]: 120,
  [SECTION_IDS.courses]: 620,
  [SECTION_IDS.integrations]: 1120,
};

const ACTIVE_CLASS = "text-[var(--accent-ink)]";
const MUTED_CLASS = "text-[var(--text-muted)]";

let scrollOffset = 0;
const scrollIntoViewMock = vi.fn();

function makeRect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + 100,
    left: 0,
    right: 0,
    width: 0,
    height: 100,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderSettings() {
  return render(
    <main data-testid="main-content-viewport" className="h-full overflow-y-auto">
      <SettingsView />
    </main>,
  );
}

/** Moves the mocked viewport and fires the container's scroll event. */
function scrollTo(offset: number) {
  scrollOffset = offset;
  fireEvent.scroll(screen.getByTestId("main-content-viewport"));
}

describe("Settings side rail scroll spy", () => {
  beforeEach(() => {
    scrollOffset = 0;
    scrollIntoViewMock.mockClear();
    useAppStore.setState({
      data: JSON.parse(JSON.stringify(initialFullState)),
      view: "settings",
      pendingSettingsSection: null,
      openModals: [],
    });

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const top = SECTION_TOPS[this.id];
      return makeRect(top === undefined ? 0 : top - scrollOffset);
    });

    // jsdom implements neither scrolling nor layout.
    (
      Element.prototype as unknown as {
        scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
      }
    ).scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("highlights Account at the top and follows the section in view", async () => {
    renderSettings();

    const account = screen.getByTestId("settings-nav-account");
    const courses = screen.getByTestId("settings-nav-courses");
    const integrations = screen.getByTestId("settings-nav-integrations");

    // At the top of the page the first section owns the rail.
    expect(account).toHaveAttribute("aria-current", "true");
    expect(account.className).toContain(ACTIVE_CLASS);
    expect(courses).not.toHaveAttribute("aria-current");
    expect(courses.className).toContain(MUTED_CLASS);

    // Scrolled into Courses: the highlight moves, and only one button keeps it.
    scrollTo(600);
    await waitFor(() => expect(courses).toHaveAttribute("aria-current", "true"));
    expect(courses.className).toContain(ACTIVE_CLASS);
    expect(account).not.toHaveAttribute("aria-current");
    expect(integrations).not.toHaveAttribute("aria-current");

    // Scrolled into Integrations: the highlight follows again.
    scrollTo(1100);
    await waitFor(() => expect(integrations).toHaveAttribute("aria-current", "true"));
    expect(integrations.className).toContain(ACTIVE_CLASS);
    expect(courses).not.toHaveAttribute("aria-current");
    expect(account).not.toHaveAttribute("aria-current");

    // The small-screen pill row mirrors the rail.
    expect(screen.getByTestId("settings-mobile-nav-integrations")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("sets the highlight immediately when a rail button is clicked", () => {
    renderSettings();

    fireEvent.click(screen.getByTestId("settings-nav-courses"));

    expect(screen.getByTestId("settings-nav-courses")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("settings-nav-account")).not.toHaveAttribute("aria-current");
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("follows the scroll even when requestAnimationFrame is never serviced", async () => {
    // Chrome suspends `requestAnimationFrame` callbacks whenever the document
    // is not visible (a background tab, a browser pane that is not in the
    // foreground), and some automation contexts throttle them. A spy that
    // coalesces its update into a frame would then never update at all: the
    // page scrolls, the rail keeps highlighting the section it had before.
    //
    // The stub registers the callback but NEVER invokes it — a suspended rAF.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    // Prove the simulation is real: a frame requested here never runs either.
    let probeRan = false;
    window.requestAnimationFrame(() => {
      probeRan = true;
    });

    renderSettings();

    const account = screen.getByTestId("settings-nav-account");
    const courses = screen.getByTestId("settings-nav-courses");

    expect(account).toHaveAttribute("aria-current", "true");

    // The scroll handler must move the highlight on its own — the frame
    // callback is never invoked.
    scrollTo(600);
    await waitFor(() => expect(courses).toHaveAttribute("aria-current", "true"));

    expect(account).not.toHaveAttribute("aria-current");
    expect(courses.className).toContain(ACTIVE_CLASS);
    expect(screen.getByTestId("settings-nav-integrations")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("settings-mobile-nav-courses")).toHaveAttribute(
      "aria-current",
      "true",
    );

    // And the same on the way down.
    scrollTo(1100);
    await waitFor(() =>
      expect(screen.getByTestId("settings-nav-integrations")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    expect(courses).not.toHaveAttribute("aria-current");
    expect(account).not.toHaveAttribute("aria-current");

    // The suspended frame callback really never ran — so none of the
    // highlights above could have come from one.
    expect(probeRan).toBe(false);
  });

  it("re-measures when the page becomes visible again", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden" as DocumentVisibilityState);

    renderSettings();

    scrollTo(600);
    await waitFor(() =>
      expect(screen.getByTestId("settings-nav-courses")).toHaveAttribute("aria-current", "true"),
    );

    // The page moved while it was hidden and the spy never heard about it.
    scrollOffset = 1100;

    // Still hidden: nothing to re-measure against.
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByTestId("settings-nav-courses")).toHaveAttribute("aria-current", "true");

    // Back in the foreground: the spy re-measures and catches up.
    visibility.mockReturnValue("visible" as DocumentVisibilityState);
    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() =>
      expect(screen.getByTestId("settings-nav-integrations")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    expect(screen.getByTestId("settings-nav-courses")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("settings-mobile-nav-integrations")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("re-measures when the window regains focus", async () => {
    renderSettings();

    scrollTo(600);
    await waitFor(() =>
      expect(screen.getByTestId("settings-nav-courses")).toHaveAttribute("aria-current", "true"),
    );

    // The page moved while the window was in the background.
    scrollOffset = 1100;

    fireEvent.focus(window);

    await waitFor(() =>
      expect(screen.getByTestId("settings-nav-integrations")).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    expect(screen.getByTestId("settings-nav-courses")).not.toHaveAttribute("aria-current");
  });

  it("does not smooth-scroll when the user prefers reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      renderSettings();
      fireEvent.click(screen.getByTestId("settings-nav-integrations"));

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
