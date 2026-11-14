/**
 * Workbench UI capture — the "before/after" tool for UI changes.
 *
 * Captures every Ladle story (desktop, theme matrix on the views, and a
 * 390×844 phone pass for the phone-shell stories) into an output directory so
 * an agent can produce a BEFORE and an AFTER render around any UI change and
 * show the maintainer the diff (pair the two dirs with tooling/ui-compare.mjs).
 *
 * Usage:
 *   1. Start the workbench:  pnpm --dir apps/web ladle   (localhost:61000)
 *   2. Before a change:      node tooling/capture-workbench.mjs target/ui-before
 *      After the change:     node tooling/capture-workbench.mjs target/ui-after
 *   3. Compare:              node tooling/ui-compare.mjs target/ui-before target/ui-after
 *
 * Output is machine-local; keep it under target/ (gitignored, AGENTS §3.8).
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire("D:/Projects/QuizRadar/apps/web/package.json");
const { chromium } = require("@playwright/test");

const OUT = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(process.cwd(), "target", "ui-capture");
const BASE = "http://localhost:61000/";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`CONSOLE.error: ${msg.text().slice(0, 300)}`);
});

// 1. Discover every story id from Ladle's generated module (exact ids).
await page.goto(BASE, { waitUntil: "load", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
const storyIds = await page.evaluate(async () => {
  const mod = await import("/@id/__x00__virtual:generated-list");
  const list = mod.stories;
  const ids = Array.isArray(list)
    ? list.map((s) => (typeof s === "string" ? s : (s.id ?? s.storyId))).filter(Boolean)
    : Object.keys(list ?? {});
  return ids.sort();
});
console.log(`discovered ${storyIds.length} stories`);

const manifest = { capturedAt: new Date().toISOString(), base: BASE, shots: [] };
const log = [];

async function shot(url, file, extraWait = 1200) {
  const before = errors.length;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 25000 });
  } catch (e) {
    log.push(`${file}: goto issue ${String(e).slice(0, 120)}`);
  }
  await page.waitForTimeout(extraWait);
  try {
    await page.screenshot({ path: join(OUT, file) });
    manifest.shots.push(file);
    log.push(`${file}: ok`);
  } catch (e) {
    log.push(`${file}: SHOT FAILED ${String(e).slice(0, 120)}`);
  }
  const fresh = errors.slice(before);
  if (fresh.length) log.push(`${file}: ${fresh.length} errors -> ${fresh.slice(0, 3).join(" | ")}`);
}

// 2. Every story in the default theme, desktop canvas.
for (const id of storyIds) {
  await shot(`${BASE}?story=${id}&theme=obsidian`, `${id}.png`);
}

// 3. Theme matrix over the views (every theme the app ships).
for (const id of storyIds.filter((s) => s.startsWith("views--"))) {
  for (const theme of ["solar", "light", "dark", "amoled-nebula"]) {
    await shot(`${BASE}?story=${id}&theme=${theme}`, `${id}--${theme}.png`, 1000);
  }
}

// 4. Phone pass: real 390×844 viewport + preview chrome (breakpoints follow
//    the real viewport) for the phone-shell + phone stories.
await page.setViewportSize({ width: 390, height: 844 });
for (const id of storyIds.filter(
  (s) =>
    s.startsWith("phone-shell--") ||
    s.startsWith("phone--pwa-web-tier---") ||
    s === "phone--android-app---dashboard-dark",
)) {
  for (const theme of ["dark", "light"]) {
    await shot(
      `${BASE}?story=${id}&theme=${theme}&mode=preview`,
      `phone--${id}--${theme}.png`,
      1000,
    );
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(OUT, "capture-log.txt"),
  log.join("\n") + "\n\nERRORS:\n" + errors.slice(0, 40).join("\n"),
);
console.log(log.join("\n"));
console.log(`\n${manifest.shots.length} shots -> ${OUT}`);
console.log(`page/console errors: ${errors.length}`);
await browser.close();
