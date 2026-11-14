import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Single version truth: tooling/version.json (same pattern as vite.config.ts)
// so the stories can never show a stale __APP_VERSION__.
const versionJson = fileURLToPath(new URL("../../tooling/version.json", import.meta.url));
const { version } = JSON.parse(readFileSync(versionJson, "utf8"));

/** @type {import("@ladle/react").LadleConfig} */
export default {
  vite: (config) => {
    config.define = {
      ...(config.define ?? {}),
      __APP_VERSION__: JSON.stringify(version),
    };
    return config;
  },
};
