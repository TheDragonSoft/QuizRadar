import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANCHOR_STEPS,
  APP_VERSION,
  detectClientPlatform,
  FAQ_ITEMS,
  INGESTION_SOURCES,
  PLATFORM_DOWNLOADS,
  PRODUCT_VIEWS,
  withBase,
} from "./lib/releaseData";

const landingRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(landingRoot, "../..");

describe("QuizRadar Landing Site — Identity, Real Screenshots, Design Rules & Icon Purge", () => {
  it("derives APP_VERSION from tooling/version.json with zero hardcoded version in package.json", () => {
    const rootVersion = JSON.parse(
      readFileSync(path.join(repoRoot, "tooling/version.json"), "utf8"),
    ).version;
    expect(APP_VERSION).toBe(rootVersion);

    const landingPkg = JSON.parse(
      readFileSync(path.join(landingRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(landingPkg.version).toBeUndefined();

    expect(PLATFORM_DOWNLOADS.windows.primaryArtifact).toBe(
      `QuizRadar_${rootVersion}_x64-setup.exe`,
    );
    expect(PLATFORM_DOWNLOADS.android.primaryArtifact).toBe(`QuizRadar-v${rootVersion}.apk`);
  });

  it("normalizes base paths cleanly for both root (/) and GitHub Pages (/QuizRadar)", () => {
    expect(withBase("/", "/")).toBe("/");
    expect(withBase("/", "/download/")).toBe("/download/");
    expect(withBase("/", "/app/")).toBe("/app/");
    expect(withBase("/QuizRadar", "/")).toBe("/QuizRadar/");
    expect(withBase("/QuizRadar/", "/download/")).toBe("/QuizRadar/download/");
    expect(withBase("/QuizRadar/", "app/")).toBe("/QuizRadar/app/");
  });

  it("detects client OS accurately for the primary download button", () => {
    expect(detectClientPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32")).toBe(
      "windows",
    );
    expect(detectClientPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)", "MacIntel")).toBe(
      "mac",
    );
    expect(detectClientPlatform("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64")).toBe("linux");
    expect(detectClientPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)", "Linux armv81")).toBe(
      "android",
    );
  });

  it("ships real 2x Retina dark & light WebP screenshots and removes fake HTML mockups", () => {
    expect(existsSync(path.join(landingRoot, "src/components/HeroShowcase.astro"))).toBe(false);
    expect(PRODUCT_VIEWS.length).toBeGreaterThanOrEqual(5);

    for (const view of PRODUCT_VIEWS) {
      const darkPath = path.join(landingRoot, "public", view.darkSrc);
      const lightPath = path.join(landingRoot, "public", view.lightSrc);
      expect(existsSync(darkPath), `Missing dark screenshot: ${view.darkSrc}`).toBe(true);
      expect(existsSync(lightPath), `Missing light screenshot: ${view.lightSrc}`).toBe(true);
      expect(readFileSync(darkPath).subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(readFileSync(lightPath).subarray(0, 4).toString("ascii")).toBe("RIFF");
    }

    for (const mobileShot of [
      "screenshots/android-dashboard-dark.webp",
      "screenshots/android-dashboard-light.webp",
      "screenshots/android-tasks-light.webp",
      "screenshots/android-focus-light.webp",
      "screenshots/android-focus-dark.webp",
    ]) {
      expect(existsSync(path.join(landingRoot, "public", mobileShot))).toBe(true);
    }
  });

  it("upholds the Honesty Doctrine across Timetable Anchor steps and copy", () => {
    const unannounced = ANCHOR_STEPS.find((s) => s.id === "honest-radar");
    expect(unannounced).toBeDefined();
    expect(unannounced?.resolvedRoom).toBe("—");

    const serialized = JSON.stringify({
      ANCHOR_STEPS,
      PRODUCT_VIEWS,
      INGESTION_SOURCES,
      FAQ_ITEMS,
    });
    expect(serialized).not.toContain("Hall B-204");
    expect(serialized).not.toContain("Home-Su25");
  });

  it("enforces better-ui CSS rules (zero `transition: all`, exact 0.96 press scale)", () => {
    const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
    const globalCss = stripComments(
      readFileSync(path.join(landingRoot, "src/styles/global.css"), "utf8"),
    );
    expect(globalCss).not.toMatch(/transition\s*:\s*all\b/);
    expect(globalCss).not.toContain("transition-all");
    expect(globalCss).toContain("scale(0.96)");
    expect(globalCss).toContain("prefers-reduced-motion");
    expect(globalCss).toContain("tabular-nums");

    const astroFiles = [
      "src/layouts/Layout.astro",
      "src/components/CelestialSky.astro",
      "src/components/BrandIcon.astro",
      "src/components/Navbar.astro",
      "src/components/Footer.astro",
      "src/pages/index.astro",
      "src/pages/download.astro",
    ];
    for (const rel of astroFiles) {
      const content = stripComments(readFileSync(path.join(landingRoot, rel), "utf8"));
      expect(content, `${rel} must not use transition: all`).not.toMatch(/transition\s*:\s*all\b/);
    }
  });

  it("ships a 1200x630 Open Graph social preview banner and declares structured FAQPage metadata", () => {
    const ogPath = path.join(landingRoot, "public/og-image.png");
    expect(existsSync(ogPath), "apps/landing/public/og-image.png must exist").toBe(true);
    const pngBytes = readFileSync(ogPath);
    expect(pngBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = pngBytes.readUInt32BE(16);
    const height = pngBytes.readUInt32BE(20);
    expect(width).toBe(1200);
    expect(height).toBe(630);

    const layoutContent = readFileSync(path.join(landingRoot, "src/layouts/Layout.astro"), "utf8");
    expect(layoutContent).toContain('property="og:image"');
    expect(layoutContent).toContain('name="twitter:image"');
    expect(layoutContent).toContain('"@type": "FAQPage"');
  });

  it("permanently purges the legacy solid-black concentric icon and uses the calendar-radar squircle", () => {
    const tauriIconsDir = path.join(repoRoot, "apps/desktop/src-tauri/icons");
    const icon2xPath = path.join(tauriIconsDir, "128x128@2x.png");
    const appleTouchPath = path.join(landingRoot, "public/apple-touch-icon.png");
    const faviconSvgPath = path.join(landingRoot, "public/favicon.svg");

    expect(existsSync(icon2xPath)).toBe(true);
    expect(existsSync(appleTouchPath)).toBe(true);
    expect(existsSync(faviconSvgPath)).toBe(true);

    const pngBytes = readFileSync(icon2xPath);
    expect(pngBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = pngBytes.readUInt32BE(16);
    const height = pngBytes.readUInt32BE(20);
    const colorType = pngBytes.readUInt8(25);
    expect(width).toBe(256);
    expect(height).toBe(256);
    expect(colorType).toBe(6);

    const hash = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
    expect(hash(pngBytes)).toBe(hash(readFileSync(appleTouchPath)));

    const iconEntries = readdirSync(tauriIconsDir);
    expect(iconEntries).toContain("icon.ico");
    expect(iconEntries).toContain("icon.icns");
    expect(iconEntries).not.toContain("ios");
    expect(iconEntries).not.toContain("android");

    const svgContent = readFileSync(faviconSvgPath, "utf8");
    expect(svgContent).toContain("#facc15");
  });
});
