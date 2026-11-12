import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Single version truth: tooling/version.json — read directly here so
 * `__APP_VERSION__` (and the SW cache key in src/generated/version.ts) can
 * never go stale. CI runs node tooling/generate-version.mjs --check.
 */
const versionJson = fileURLToPath(new URL("../../tooling/version.json", import.meta.url));
const { version } = JSON.parse(readFileSync(versionJson, "utf8")) as { version: string };

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    watch: {
      // The Playwright output dir lives inside `apps/web`, so the dev server
      // (which the e2e harness reuses) watches it. Playwright writes browser
      // download artifacts (.crdownload → final) there mid-run, and a Windows
      // fs.watch on a file being renamed KILLS Vite with an unhandled EBUSY —
      // which then makes every subsequent e2e test fail with
      // ERR_CONNECTION_REFUSED. The e2e results are not app source; ignore
      // them (same rule the gitignore applies).
      ignored: ["**/e2e-results/**"],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    /**
     * Windows-friendly pool settings: worker threads avoid the process churn
     * of the default `forks` pool, while per-file isolation keeps every test
     * file on its own fresh jsdom document and module registry.
     *
     * `isolate: false` was measured on this machine and rejected: sharing one
     * jsdom/module registry across files leaked module-level mocks between
     * suites (e.g. `googleLogin` from the Chrome flow tests into the auth
     * tests) and left RTL's `screen` bound to a stale document, which made
     * the suite both flaky and much slower to settle (~67 s vs ~20 s).
     */
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },
    /**
     * The visual-regression suite in `e2e/` is a *Playwright* suite (it runs
     * against a real browser via `apps/web/playwright.config.ts`), not a
     * vitest suite. Vitest's default include pattern would collect those
     * `*.spec.ts` files and fail to run them, so they are excluded here.
     */
    exclude: [...defaultExclude, "**/e2e/**"],
    /**
     * Coverage for the web tier.
     *
     * The floors deliberately live in `tooling/coverage-baseline.json` (the
     * ratchet), NOT here: a Vitest `thresholds` block would fail the whole
     * suite the moment a floor is bumped, which is exactly the "fake green"
     * failure mode the ratchet replaces. This block only *produces* the
     * numbers; `tooling/coverage-ratchet.mjs` decides what "too low" means.
     *
     * `reportsDirectory` points into the gitignored `target/` tree so the
     * generated lcov HTML/JS never reaches `git status`, `pnpm lint` or
     * `pnpm format:check` (all three scan the working tree).
     */
    coverage: {
      provider: "v8",
      // Vitest 3 names this option `reporter` (singular); `reporters` is
      // silently ignored and falls back to the default reporter set.
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "../../target/coverage/web",
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/generated/**",
        "**/testdata/**",
        "**/e2e/**",
        "e2e/**",
        "src/test/**",
      ],
    },
  },
});
