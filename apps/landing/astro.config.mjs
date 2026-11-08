import { defineConfig } from "astro/config";

/**
 * Supports both root hosting (`/` on local dev, Vercel, or a custom domain)
 * and GitHub Pages project hosting (`ASTRO_BASE=/QuizRadar` in release.yml).
 */
const site = process.env.ASTRO_SITE || "https://thedragonsoft.github.io";
const base = process.env.ASTRO_BASE || "/";

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
});
