---
bump: minor
surfaces: [web, tooling, ci, docs]
agent: antigravity
branch: app_landing_page
date: 2026-11-08
---

### Summary

- Add an Astro marketing & downloads site (`apps/landing`) with a product tour, per-platform download
  matrix, FAQ, and honest product copy sourced from `tooling/version.json`.
- Add `tooling/build-site.mjs`, a unified public build that emits the marketing site and mounts the
  Web Companion PWA at `/app/` inside it.
- Wire the landing package into the pnpm workspace, eslint/prettier ignores, CI (static build step),
  and the GitHub Pages release workflow (now deploying `apps/landing/dist`).
- Regenerate the desktop Tauri icon set to match the current brand artwork.

### Verification

- `pnpm install --frozen-lockfile`
- `pnpm --filter @quizradar/landing test` (8 tests passed)
- `pnpm --filter @quizradar/landing typecheck`
- `pnpm --filter @quizradar/landing build` (2 pages built)
- `pnpm lint`
- `pnpm format:check` ("All matched files use Prettier code style!")
- `pnpm test` (web: 31 files / 286 tests passed; desktop: 34 Rust tests passed; landing: 8 tests passed)

### Handoff / Follow-ups

- New runtime dependency `astro` (+ `@fontsource-variable/inter`) scoped to the `@quizradar/landing`
  workspace package only; no core, desktop, or Android shell is affected.
- `apps/landing/src/lib/releaseData.ts` reads `tooling/version.json`, so the version stamp remains the
  single source of truth and the download URLs follow the released SemVer automatically.
- The GitHub Pages deploy path changed from `apps/web/dist` to `apps/landing/dist`; the PWA is mounted
  at `/app/` by the unified build rather than being served from the site root.
