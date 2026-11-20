#!/usr/bin/env node
/** Instrument a benchmark-only Tauri build with an OS-assigned WebView2 CDP port. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "../../tooling/lib/agent-utils.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags.project) {
  console.error("usage: node performance/desktop/prepare-build.mjs --project <checkout>");
  process.exit(2);
}

const project = path.resolve(String(flags.project));
const configPath = path.join(project, "apps/desktop/src-tauri/tauri.conf.json");
if (!existsSync(configPath)) throw new Error(`Tauri config not found: ${configPath}`);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const windows = config.app?.windows;
if (!Array.isArray(windows) || windows.length === 0) {
  throw new Error("the Tauri config must define at least one window");
}

const defaultArgs =
  "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=0";
const remoteArg = "--remote-debugging-port=0";
let instrumented = 0;
for (const window of windows) {
  if (window.create === false) continue;
  const existing = window.additionalBrowserArgs;
  if (typeof existing === "string" && existing.length > 0) {
    if (existing.includes(remoteArg)) {
      instrumented += 1;
      continue;
    }
    if (existing.includes("--remote-debugging-port")) {
      throw new Error("benchmark config already contains a different remote-debugging port");
    }
    window.additionalBrowserArgs = `${existing} ${remoteArg}`;
  } else {
    window.additionalBrowserArgs = defaultArgs;
  }
  instrumented += 1;
}
if (instrumented === 0) throw new Error("no startup window was available for CDP instrumentation");

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Instrumented ${instrumented} benchmark window(s) in ${configPath}`);
