#!/usr/bin/env node
/**
 * Builds the unified public web deployment:
 *   - `/`          → Marketing & Downloads website (`apps/landing/dist`)
 *   - `/download/` → Multi-platform Downloads & SHA-256 verification page
 *   - `/app/`      → Offline-capable WebAssembly Companion PWA (`apps/web/dist`)
 *
 * Respects `ASTRO_SITE` and `ASTRO_BASE` (e.g. `ASTRO_BASE=/QuizRadar` on
 * GitHub Pages) while keeping `apps/web` portable via relative `./` URLs.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipWebBuild = process.argv.includes("--skip-web-build");

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: repoRoot, stdio: "inherit", env: process.env });
};

if (!skipWebBuild) {
  run("pnpm --filter @quizradar/web build");
}

run("pnpm --filter @quizradar/landing build");

const webDist = path.join(repoRoot, "apps/web/dist");
const landingAppDest = path.join(repoRoot, "apps/landing/dist/app");

if (!existsSync(webDist)) {
  console.error(`Expected Web Companion build output at ${webDist}`);
  process.exit(1);
}

rmSync(landingAppDest, { recursive: true, force: true });
mkdirSync(landingAppDest, { recursive: true });
cpSync(webDist, landingAppDest, { recursive: true });

console.log("Unified site ready at apps/landing/dist (with Web Companion mounted at /app/).");
