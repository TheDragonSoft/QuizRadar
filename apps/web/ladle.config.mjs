import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Single version truth: tooling/version.json (same pattern as vite.config.ts)
// so the stories can never show a stale __APP_VERSION__.
const versionJson = fileURLToPath(new URL("../../tooling/version.json", import.meta.url));
const { version } = JSON.parse(readFileSync(versionJson, "utf8"));

// The `Phone (Android app)/` section displays the Compose screen captures the
// Android module's AndroidUiCaptureTest writes into `public/android-ui/`
// (gitignored — machine-local renders, AGENTS §3.8). Vite serves public/ at
// the root in dev, so the stories reference plain `/android-ui/<name>.png`
// URLs. CI never runs the capture test, so release builds ship no PNGs.
mkdirSync("public/android-ui", { recursive: true });

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
