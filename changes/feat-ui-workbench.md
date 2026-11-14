---
bump: minor
surfaces: [web, android, tooling]
agent: zcode
branch: feat/ui-workbench
date: 2026-11-14
---

### Summary

Web UI workbench final (Ladle 5): 92 stories covering every surface in every state. (1) Modal state matrix: all 13 registered modals x their meaningful states (assessment detail with-room/no-room/graded/with-warnings, onboarding fresh/populated, practice quiz ready-via-mocked-rpc/generating/error/no-assessment, pomodoro idle/running/paused/short-break, scan progress syncing/success/error, cloud sync never/last-backup, account profile signed-in/out, search palette matches/none/empty, app confirm destructive/non-destructive, create-edit assessment+event new/editing, add course populated/empty-schedule, schedule preview clean/dropped). Backend-bound states use the blessed setRpcMockHandler seam. (2) Phone section: views render inside PhoneAppShell (mirrored line-for-line from App.tsx: TopBar, self-hiding Sidebar, PullToRefresh main with px-4, MobileNav) - bare views overflow horizontally and read as desktop fragments, the shell absorbs the -mx-4 hero bleed; Phone/* stories mount them in live 390x844 iframes (real nested viewport, real breakpoints), verified 0 horizontal overflow at 390px. (3) Theme system fixed: Ladle banner button drives the story (theme-bridge.css teaches ladle.css the app's dark ids; observer only syncs Tailwind .dark, never rewrites the attribute; applyThemeToDocument must never run inside an observer - View Transitions wedge). (4) Assessment-detail stories render through the real ModalStack. (5) Per-surface AGENTS.md guides + housekeeping (audit docs committed, scratch deleted). Verified: tsc/eslint/prettier clean, pnpm -r test 472 passed, capture 118 shots 0 page errors, preflight version check.

### Verification

- pnpm lint
- pnpm typecheck
- pnpm test
- node tooling/generate-version.mjs --check
- node target/wb-shots/capture.mjs (118 shots, 0 errors)

### Handoff / Follow-ups

- Ladle builds its story list at server startup - restart pnpm --dir apps/web ladle after adding stories. Ladle 5.1.1 applies .ladle/components.tsx decorators unreliably
- stories self-seed via workbenchFixtures and themes are URL-param driven. NEVER call applyThemeToDocument inside a MutationObserver (View Transitions wedge). Paparazzi 1.3.5 JVM screenshots + Android debug @Preview gallery remain open follow-ups. Full format:check still fails on 31 pre-existing files (untouched by this branch).
