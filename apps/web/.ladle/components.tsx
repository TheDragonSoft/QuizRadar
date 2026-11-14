import type { GlobalTypes, Globe } from "@ladle/react";
import { createElement } from "react";
import "@fontsource-variable/inter";
import "./theme-bridge.css";
import "../src/index.css";
import { seedWorkbench } from "../src/stories/workbenchFixtures";

/**
 * Ladle workbench chrome (dev-only).
 *
 * Theme model — two writers, one attribute, two vocabularies:
 * - Ladle's banner button writes `data-theme="light"|"dark"` (its vocabulary;
 *   ladle.css themes its chrome off that attribute).
 * - The `?theme=` URL param and the app write `obsidian|solar|amoled-nebula`
 *   (tokens.css's vocabulary) via the app's `applyThemeToDocument`.
 * `theme-bridge.css` teaches Ladle's chrome the app's dark ids, and the
 * observer below keeps Tailwind's `.dark` class in sync with whichever value
 * is present — so every writer produces a coherent page. The observer NEVER
 * rewrites the attribute: it used to fight the banner button (which made the
 * button look dead), and routing applyThemeToDocument through an observer
 * wedges initial load — its View Transitions path must not run in a callback.
 */

/** Attribute values whose semantic is "dark" (drives the `.dark` class). */
const DARK_IDS: readonly string[] = ["dark", "obsidian", "amoled-nebula"];

// Module scope: runs once per page load, before Ladle's React tree mounts.
if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  const syncDarkClass = () => {
    const attr = document.documentElement.getAttribute("data-theme") ?? "";
    document.documentElement.classList.toggle("dark", DARK_IDS.includes(attr));
  };
  new MutationObserver(syncDarkClass).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  syncDarkClass();
}

export const globals: GlobalTypes = {
  theme: {
    name: "Theme (banner button = light/dark; ?theme= pins exact)",
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
  // on Ladle's gray canvas. createElement (not JSX): this file sits outside
  // tsconfig's src include and the repo's eslint config expects React in
  // scope for JSX here.
  return createElement(
    "div",
    { className: "min-h-screen bg-[var(--page)] text-[var(--text)]" },
    children,
  );
};
