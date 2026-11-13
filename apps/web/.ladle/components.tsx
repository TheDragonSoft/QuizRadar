import type { GlobalTypes, Globe } from "@ladle/react";
import { createElement } from "react";
import "@fontsource-variable/inter";
import "../src/index.css";
import { isDarkTheme } from "../src/state/storage";
import { seedWorkbench } from "../src/stories/workbenchFixtures";
import type { ThemeMode } from "../src/state/types";

/**
 * Ladle workbench chrome (dev-only).
 *
 * CSS lives here (the app's real Tailwind/tokens stack). Theme control is
 * URL-driven instead of Ladle-driven: append `&theme=<id>` to any story URL —
 * `light` | `dark` | `obsidian` | `solar` | `amoled-nebula` | `system`. The
 * generic ids are the app's own: light/dark are MODES, normalized by the app
 * onto the Solar/Obsidian attributes (the app ships exactly these five ids;
 * the old AMOLED Pure/Sparkle variants were retired from the app). Ladle's
 * banner toggle writes the same `data-theme` attribute for ITS chrome, so it
 * is not used here — `seedWorkbench` re-asserts the app theme after every
 * story render and the observer below corrects any later chrome writes.
 */

const KNOWN_THEMES: readonly string[] = ["light", "dark", "obsidian", "solar", "amoled-nebula"];

/** Mirrors applyThemeToDocument's normalization of generic ids. */
function normalizeTheme(theme: string): string {
  return theme === "dark" ? "obsidian" : theme === "light" ? "solar" : theme;
}

function desiredTheme(): string {
  if (typeof window === "undefined") return "obsidian";
  const fromUrl = new URLSearchParams(window.location.search).get("theme");
  if (fromUrl === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "obsidian" : "solar";
  }
  return fromUrl && KNOWN_THEMES.includes(fromUrl) ? normalizeTheme(fromUrl) : "obsidian";
}

// Module scope: runs once per page load, before Ladle's React tree mounts.
// Backstop: re-assert the app theme whenever Ladle's chrome rewrites
// <html data-theme> later (e.g. its banner theme toggle). IMPORTANT: write
// the attributes DIRECTLY here — routing this through applyThemeToDocument
// starts a View Transition from inside an observer callback and wedges the
// page during initial load.
if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  const enforce = () => {
    const expected = desiredTheme();
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === expected) return;
    root.classList.toggle("dark", isDarkTheme(expected as ThemeMode));
    root.setAttribute("data-theme", expected);
  };
  new MutationObserver(enforce).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  enforce();
}

export const globals: GlobalTypes = {
  theme: {
    name: "Theme (?theme= URL wins)",
    options: ["light", "dark", "obsidian", "solar", "amoled-nebula"],
    defaultValue: "obsidian",
    control: { type: "select" },
  },
};

export const decorator: Globe = ({ children, globalState }) => {
  const theme = (globalState.theme ?? "obsidian") as ThemeMode;
  seedWorkbench({ theme });
  // Paint the story canvas with the app's real page tokens — bare components
  // (toasts, banners, dropdowns) need a real page behind them or they float
  // on Ladle's gray canvas and look broken. createElement (not JSX): this
  // file sits outside tsconfig's src include and the repo's eslint config
  // expects React in scope for JSX here.
  return createElement(
    "div",
    { className: "min-h-screen bg-[var(--page)] text-[var(--text)]" },
    children,
  );
};
