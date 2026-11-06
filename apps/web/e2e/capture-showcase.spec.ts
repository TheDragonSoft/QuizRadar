import { test } from "@playwright/test";
import { bootApp } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";
import * as path from "node:path";
import * as fs from "node:fs";

const ARTIFACT_DIR = "C:/Users/ANXOMXR/.gemini/antigravity/brain/e59c741e-6493-4854-9810-af2aa79dd262/screenshots";
const DOCS_DIR = path.resolve(process.cwd(), "docs/screenshots/redesign");

// Ensure directories exist
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "Showcase captures run once on the light project.",
  );
});

test("capture comprehensive redesign showcase screenshots", async ({ page }) => {
  await bootApp(page, "dark");

  const saveScreenshots = async (filename: string) => {
    const p1 = path.join(ARTIFACT_DIR, filename);
    const p2 = path.join(DOCS_DIR, filename);
    await page.screenshot({ path: p1 });
    fs.copyFileSync(p1, p2);
  };

  // 1. Search Palette Modal (Dark Mode) - verifying zero blue outline
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[data-testid="search-palette-modal"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-search-nobox.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 2. Parallax Scroll on Dashboard (scroll main container down 240px)
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 240, behavior: "instant" });
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-dashboard-parallax.png");
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(300);

  // 3. Tasks View - All Assessments Tab with Time Horizons & AI Auto-Detect
  await page.getByRole("button", { name: "Tasks" }).click();
  await page.waitForSelector('[data-testid="tasks-view"]', { state: "visible" });
  await page.getByRole("button", { name: /All Assessments/i }).click();
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-tasks-assessments.png");

  // 4. Settings View - Appearance Multi-Theme Architecture
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.waitForSelector('[data-testid="view-settings"]', { state: "visible" });
  await page.waitForTimeout(600);
  await saveScreenshots("after-desktop-settings-appearance.png");

  // Return to Dashboard for AMOLED Showcase
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await page.waitForTimeout(400);

  // 5. AMOLED Variant 1: Pure Starlight (amoled-minimal)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-minimal";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-minimal");
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-amoled-minimal.png");

  // 6. AMOLED Variant 2: Constellation Sparkles (amoled-sparkle)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-sparkle";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-sparkle");
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-amoled-sparkle.png");

  // 7. AMOLED Variant 3: Cosmic Stardust (amoled-nebula)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "amoled-nebula";
    document.documentElement.classList.add("dark");
    localStorage.setItem("quizradar_theme", "amoled-nebula");
  });
  await page.waitForTimeout(500);
  await saveScreenshots("after-desktop-amoled-nebula.png");
});
