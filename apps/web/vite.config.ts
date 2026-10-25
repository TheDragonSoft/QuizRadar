import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
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
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
