/**
 * OPT-IN showcase capture harness — never part of `pnpm e2e`.
 *
 * `capture-showcase.spec.ts` and `capture-non-ai-suite.spec.ts` are screenshot
 * documentation scripts (they seed demo data and walk the whole app), not
 * acceptance tests. The default `playwright.config.ts` excludes them via
 * `testIgnore`, so `pnpm e2e` can never rewrite the tracked screenshots under
 * `docs/screenshots/`.
 *
 * Run them explicitly with:
 *   pnpm --dir apps/web e2e:showcase
 *
 * Output directory: the capture specs write to `QUIZRADAR_SHOWCASE_DIR` when
 * set, and otherwise to the untracked `apps/web/e2e-results/showcase/`
 * staging folder. Writing into `docs/screenshots/` requires pointing
 * `QUIZRADAR_SHOWCASE_DIR` at it explicitly — a deliberate act, never a side
 * effect of a test run.
 */

import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";
import { LIGHT_PROJECT } from "./e2e/helpers/theme";

export default defineConfig({
  ...baseConfig,
  // Only the capture specs, only the light project (each capture spec skips
  // every other project anyway — this just avoids the wasted dark boot).
  testMatch: /capture-.*\.spec\.ts/,
  testIgnore: [],
  projects: baseConfig.projects.filter((project) => project.name === LIGHT_PROJECT),

  // The showcase walks the whole app (desktop + mobile viewports); the
  // individual capture tests raise their own timeouts on top of this.
  timeout: 240_000,
  expect: { timeout: 15_000 },
  outputDir: "./e2e-results/showcase",
});
