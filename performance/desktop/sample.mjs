#!/usr/bin/env node
/* global window */
/** One isolated release-Tauri startup/IPC performance sample on Windows. */
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "../../tooling/lib/agent-utils.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags.exe || !flags.revision || !flags.output) {
  console.error(
    "usage: node performance/desktop/sample.mjs --exe target/release/quizradar-desktop.exe --revision HEAD --output result.json",
  );
  process.exit(2);
}
if (process.platform !== "win32")
  throw new Error("desktop performance samples currently require Windows WebView2");
const executable = path.resolve(String(flags.exe));
const output = path.resolve(String(flags.output));
const require = createRequire(import.meta.url);
const playwrightEntry = require.resolve("@playwright/test", { paths: [path.resolve("apps/web")] });
const playwright = await import(pathToFileURL(playwrightEntry).href);
const { chromium } = playwright.default ?? playwright;
const now = () => Number(process.hrtime.bigint()) / 1_000_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const sandbox = mkdtempSync(path.join(os.tmpdir(), "quizradar-perf-"));
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
let child;
let browser;
let childExit = null;
const startedAt = now();
let cdpReadyAt;
const bootLog = path.join(os.tmpdir(), "quizradar-boot.log");

try {
  const existing = execFileSync(
    "tasklist",
    ["/FI", "IMAGENAME eq quizradar-desktop.exe", "/FO", "CSV"],
    { encoding: "utf8" },
  );
  if (existing.toLowerCase().includes("quizradar-desktop.exe")) {
    throw new Error("close every QuizRadar desktop instance before running the isolated benchmark");
  }
  child = spawn(executable, [], {
    env: {
      ...process.env,
      QUIZRADAR_DATA_DIR: path.join(sandbox, "data"),
      QUIZRADAR_EPHEMERAL_KEYRING: "1",
      QUIZRADAR_PERFORMANCE_SANDBOX: "1",
      WEBVIEW2_USER_DATA_FOLDER: path.join(sandbox, "wv2"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
  });

  let connected = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (childExit)
      throw new Error(`desktop exited before CDP was ready: ${JSON.stringify(childExit)}`);
    try {
      const response = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        connected = true;
        break;
      }
    } catch {
      // WebView2 is still starting.
    }
    await sleep(200);
  }
  if (!connected) throw new Error(`WebView2 CDP did not become ready at ${origin}`);
  cdpReadyAt = now();
  browser = await chromium.connectOverCDP(origin);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages[0];
  if (!page) throw new Error("no native WebView2 page was exposed over CDP");
  await page.getByTestId("app-shell").waitFor({ state: "visible", timeout: 30_000 });
  if (await page.getByTestId("offline-banner").count()) {
    throw new Error("desktop rendered the offline banner; native state loading failed");
  }
  const ipcStarted = now();
  const version = await page.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__) throw new Error("Tauri internals are unavailable");
    return window.__TAURI_INTERNALS__.invoke("version");
  });
  const ipcMs = now() - ipcStarted;
  if (!version || typeof version.app !== "string" || typeof version.core !== "string") {
    throw new Error(`native version IPC returned an invalid result: ${JSON.stringify(version)}`);
  }
  const nativeReadyMs = now() - startedAt;

  const onboarding = page.getByTestId("modal-onboarding");
  await onboarding.getByRole("button", { name: "Close" }).click();
  await onboarding.waitFor({ state: "detached" });
  const navigationStarted = now();
  await page.getByTestId("topbar-nav-calendar").click();
  await page.getByTestId("view-calendar").waitFor({ state: "visible" });
  const calendarMs = now() - navigationStarted;

  const result = {
    schemaVersion: 1,
    surface: "desktop",
    revision: String(flags.revision),
    environment: {
      profile: "release-no-bundle",
      runtime: "Windows WebView2",
      sandboxed: true,
      updaterNetwork: "disabled-by-complete-sandbox",
    },
    scenarios: [
      { id: "startup.cdp_ready", unit: "ms", samples: [cdpReadyAt - startedAt] },
      { id: "startup.native_ready", unit: "ms", samples: [nativeReadyMs] },
      { id: "ipc.version", unit: "ms", samples: [ipcMs] },
      { id: "navigation.calendar", unit: "ms", samples: [calendarMs] },
    ],
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  mkdirSync(path.dirname(output), { recursive: true });
  if (existsSync(bootLog)) copyFileSync(bootLog, `${output}.boot.log`);
  if (browser) {
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    if (page) await page.screenshot({ path: `${output}.png` }).catch(() => undefined);
  }
  throw error;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (child && !childExit) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      child.kill("SIGKILL");
    }
  }
  // WebView2 can briefly hold profile handles; cleanup is best-effort and
  // must never turn a completed measurement into a failed sample.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(sandbox, { recursive: true, force: true });
      break;
    } catch {
      await sleep(200);
    }
  }
}
