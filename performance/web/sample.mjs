#!/usr/bin/env node
/* global window, document, localStorage, requestAnimationFrame, MutationObserver */
/** One isolated production-web performance sample. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "../../tooling/lib/agent-utils.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags.dist || !flags.revision || !flags.output) {
  console.error(
    "usage: node performance/web/sample.mjs --dist apps/web/dist --revision HEAD --output result.json [--fixture core/tests/fixtures/v4_backup.json]",
  );
  process.exit(2);
}
const dist = path.resolve(String(flags.dist));
const fixture = path.resolve(String(flags.fixture ?? "core/tests/fixtures/v4_backup.json"));
const require = createRequire(import.meta.url);
const playwrightEntry = require.resolve("@playwright/test", { paths: [path.resolve("apps/web")] });
const playwright = await import(pathToFileURL(playwrightEntry).href);
const { chromium } = playwright.default ?? playwright;

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"],
]);

function staticServer() {
  return createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      let file = path.resolve(dist, `.${relative}`);
      if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      let content;
      try {
        content = readFileSync(file);
      } catch {
        file = path.join(dist, "index.html");
        content = readFileSync(file);
      }
      response.writeHead(200, {
        "content-type": mime.get(path.extname(file)) ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(content);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
}

const now = () => Number(process.hrtime.bigint()) / 1_000_000;
const server = staticServer();
let browser;
const consoleErrors = [];
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    return route.abort("blockedbyclient");
  });
  await page.clock.setFixedTime(new Date("2026-10-29T12:00:00Z"));
  await page.addInitScript(() => {
    localStorage.setItem("quizradar-theme", "obsidian");
    window.__quizPerfPaint = [];
    new PerformanceObserver((list) => {
      window.__quizPerfPaint.push(
        ...list.getEntries().map((entry) => ({ name: entry.name, startTime: entry.startTime })),
      );
    }).observe({ type: "paint", buffered: true });
  });

  const coldStarted = now();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByTestId("app-shell").waitFor({ state: "visible", timeout: 30_000 });
  const appShellMs = now() - coldStarted;
  const firstContentfulPaint = await page.evaluate(
    () =>
      window.__quizPerfPaint.find((entry) => entry.name === "first-contentful-paint")?.startTime ??
      null,
  );
  if (firstContentfulPaint === null) {
    throw new Error("Chromium did not report first-contentful-paint; the sample is not comparable");
  }

  const onboarding = page.getByTestId("modal-onboarding");
  await onboarding.getByRole("button", { name: "Close" }).click();
  await onboarding.waitFor({ state: "detached" });

  // Setup only: populate through the same secret-free JSON import users invoke.
  await page.getByTitle("On-device engine & local data backup").click();
  const backupModal = page.getByTestId("modal-cloud-sync");
  await backupModal.getByLabel("Import Backup (JSON)").setInputFiles(fixture);
  await page
    .getByText(/Imported \d+ courses, \d+ assessments, \d+ topics/)
    .waitFor({ timeout: 30_000 });
  await backupModal.getByLabel("Close", { exact: true }).click();
  await backupModal.waitFor({ state: "detached" });

  async function navigate(id, expectedText) {
    // Time inside the browser around the real DOM click. This keeps Playwright
    // actionability/protocol overhead out of the app's navigation measurement.
    return page.evaluate(
      async ({ id, expectedText }) => {
        const nav = document.querySelector(`[data-testid="topbar-nav-${id}"]`);
        if (!nav) throw new Error(`navigation target missing: ${id}`);
        const started = performance.now();
        nav.click();
        await new Promise((resolve, reject) => {
          const isReady = () => {
            const view = document.querySelector(`[data-testid="view-${id}"]`);
            if (!view) return false;
            const style = window.getComputedStyle(view);
            const visible =
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              view.getClientRects().length > 0;
            if (!visible) return false;
            return !expectedText || Boolean(view.textContent?.includes(expectedText));
          };
          const observer = new MutationObserver(() => {
            if (!isReady()) return;
            observer.disconnect();
            window.clearTimeout(timeout);
            resolve(undefined);
          });
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error(`navigation did not become ready: ${id}`));
          }, 30_000);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          if (isReady()) {
            observer.disconnect();
            window.clearTimeout(timeout);
            resolve(undefined);
          }
        });
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        return performance.now() - started;
      },
      { id, expectedText },
    );
  }

  const calendarMs = await navigate("calendar");
  const tasksMs = await navigate("tasks");
  const dashboardMs = await navigate("dashboard", "Quiz 1");
  if (consoleErrors.length > 0) throw new Error(`browser errors: ${consoleErrors.join(" | ")}`);

  const result = {
    schemaVersion: 1,
    surface: "web",
    revision: String(flags.revision),
    environment: {
      profile: "production-static-build",
      browser: "chromium",
      viewport: "1440x900",
      externalNetwork: "blocked",
      fixture: path.basename(fixture),
    },
    scenarios: [
      { id: "startup.app_shell", unit: "ms", samples: [appShellMs] },
      { id: "startup.first_contentful_paint", unit: "ms", samples: [firstContentfulPaint] },
      { id: "navigation.calendar", unit: "ms", samples: [calendarMs] },
      { id: "navigation.tasks", unit: "ms", samples: [tasksMs] },
      { id: "navigation.dashboard", unit: "ms", samples: [dashboardMs] },
    ],
  };
  const output = path.resolve(String(flags.output));
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
