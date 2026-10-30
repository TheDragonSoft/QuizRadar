/**
 * Playwright visual-regression harness for the QuizRadar web tier (apps/web).
 *
 * ---------------------------------------------------------------------------
 * FONT RISK — checked against the source, not assumed
 * ---------------------------------------------------------------------------
 * `apps/web/src/main.tsx` starts with `import "@fontsource-variable/inter";`,
 * so the "Inter Variable" family named in `apps/web/src/tokens.css`
 * (`--font-sans: "Inter Variable", "Inter", system-ui, sans-serif`) is served
 * from the npm package `@fontsource-variable/inter` that Vite bundles into
 * the app. There is NO network font:
 *   - `apps/web/index.html` has no <link> to fonts.googleapis.com /
 *     fonts.gstatic.com (it only links the manifest, the favicon and the
 *     touch icon);
 *   - `apps/web/public/` ships no font files at all (only icons, the service
 *     worker, the web manifest and the generated WASM engine).
 * The committed baselines therefore do not depend on a font CDN being
 * reachable from CI.
 *
 * The remaining (accepted) risk is the bundled font file itself: upgrading
 * `@fontsource-variable/inter` changes the glyph rasterisation, so the
 * baselines must be regenerated with `pnpm --dir apps/web e2e:update` after
 * such an upgrade. Every spec waits for `document.fonts.status === "loaded"`
 * before snapshotting, so a half-loaded font can never leak into a baseline.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------
 * The UI renders real dates (sidebar mini calendar, the week grid's day
 * headers, the "today" disc, relative countdowns), so every spec freezes the
 * browser clock at 2026-10-29T12:00:00Z and the timezone is pinned to UTC.
 * Without that, the committed baselines would break at local midnight and
 * would differ per CI machine.
 *
 * The app is local-first with no server: a fresh browser context starts with
 * an empty IndexedDB and the WASM core derives an honestly empty state from
 * it. No fixtures are injected anywhere — the baselines capture the genuine
 * first-run empty UI (AGENTS.md §3.1 honesty doctrine).
 */

import { defineConfig } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DARK_PROJECT, LIGHT_PROJECT } from "./e2e/helpers/theme";

/** Absolute path of `apps/web` (the directory this config lives in). */
const appDir = path.dirname(fileURLToPath(import.meta.url));

/** The dev-server origin the specs talk to. */
const BASE_URL = "http://127.0.0.1:4317";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-results",
  // Committed baselines live next to the suite, outside the spec files.
  snapshotPathTemplate: "{testDir}/../e2e-baselines/{arg}{ext}",

  // A fresh browser context per test (Playwright's default) is what keeps
  // the IndexedDB-backed state empty and deterministic.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    // Pinned so the rendered "today" is the same on every machine.
    timezoneId: "UTC",
    trace: "off",
    video: "off",
    screenshot: "off",
  },

  projects: [
    {
      name: LIGHT_PROJECT,
      use: {
        browserName: "chromium",
        colorScheme: "light",
      },
    },
    {
      name: DARK_PROJECT,
      use: {
        browserName: "chromium",
        // The app's own theme is class-driven (`<html class="dark">`, see
        // `applyThemeToDocument` in apps/web/src/state/store.ts and the
        // `.dark { … }` block in apps/web/src/tokens.css); the spec seeds
        // `localStorage["quizradar-theme"] = "dark"` through
        // `page.addInitScript` before any app script runs. Emulating the dark
        // OS preference as well only makes the app's `prefers-color-scheme`
        // fallback agree with the seeded value.
        colorScheme: "dark",
      },
    },
  ],

  webServer: {
    command: "node ../../tooling/build-wasm.mjs && pnpm exec vite --port 4317 --strictPort",
    url: BASE_URL,
    cwd: appDir,
    reuseExistingServer: true,
    // The WASM engine may have to be compiled from scratch on a cold CI box.
    timeout: 180_000,
    /**
     * Vite's default bind host is `localhost`, which on this Windows host
     * resolves to the IPv6 loopback (::1) FIRST — so Vite listened on ::1
     * only and the mandated health-check URL `http://127.0.0.1:4317` was
     * refused (ECONNREFUSED), which made the webServer time out.
     * `--dns-result-order=ipv4first` makes Node resolve `localhost` to
     * 127.0.0.1 first, so Vite binds the IPv4 loopback the health check
     * (and `baseURL`) uses. The command string itself is left untouched.
     */
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim(),
    } as Record<string, string>,
  },
});
