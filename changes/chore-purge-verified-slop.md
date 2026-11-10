---
bump: none
surfaces: [web, docs]
agent: antigravity
branch: chore/purge-verified-slop
date: 2026-11-10
---

### Summary

Purge verified binary screenshot duplicates, disposable debug artifacts, and archive stale audit roadmaps:
- Removed duplicate screenshot directory `apps/web/docs/screenshots/` (18 files mirror, now writing directly to `docs/screenshots/` without drift).
- Purged 11 ephemeral debug/verify screenshots from `docs/screenshots/` (`debug-*.png`, `test-screen.png`, `verify-*.png`).
- Fixed hardcoded ephemeral agent brain directory in `apps/web/e2e/capture-showcase.spec.ts` and updated `capture-non-ai-suite.spec.ts` to write directly to `docs/screenshots/`.
- Archived completed audit documents `CORE-AUDIT-PLAN.md`, `UI-UX-AUDIT-AND-REDESIGN-PLAN.md`, and `website-improvement-review.md` into `docs/archive/` with explicit historical status banners.

### Verification

- `node tooling/generate-version.mjs --check` (5/5 sinks in sync)
- `node tooling/build-wasm.mjs --force` (compiled release WASM v5.8.0)
- `pnpm --filter @quizradar/web test` (39/39 test files passed, 330 tests)
- `pnpm test:tooling` (2/2 test files passed, 16 tests)
- `pnpm typecheck` (zero TypeScript errors)

### Handoff / Follow-ups

- Next step in the deslop roadmap is Phase 3: decomposing the monolithic frontend view files (`SettingsView.tsx` 80KB, `DashboardView.tsx` 69KB, `store.ts` 65KB).
