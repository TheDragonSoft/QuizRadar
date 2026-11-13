---
bump: minor
surfaces: [web, android, tooling]
agent: zcode
branch: feat/ui-workbench
date: 2026-11-13
---

### Summary

Web UI workbench (Ladle 5): dev-only per-component/per-screen playground for apps/web. Stories render the REAL views (Dashboard, Tasks, Calendar, Settings) and shared components (Assessment detail modal, Conflict banner unresolved/mitigated, MiniCalendar, Toasts) seeded from the real core-produced contract payloads (testdata/contract) re-dated by one uniform delta so the fixture exam week always straddles today - only weekday labels are rebuilt, all core-derived relative numbers stay as the core emitted them. Theme via ?theme=<ThemeMode> URL param (all five shipped themes) applied through the store's own applyThemeToDocument; a module-scope observer re-asserts the theme after Ladle's chrome writes the same attribute (writes DIRECTLY, never via applyThemeToDocument, whose View-Transitions API path wedges the page from inside an observer during initial load). Added pnpm --dir apps/web ladle; coverage excludes stories. Per-surface AGENTS.md guides added (apps/web, apps/desktop, apps/mobile-android) scoping agents to one surface with its own commands, security notes and forbidden paths. Housekeeping: committed the pending audit docs + changes fragment, deleted scratch (treedump.txt, m3extract/ jars-extraction dir, 394 files). Android: emulator demo run + AGENTS guide; JVM screenshot testing (Paparazzi 1.3.5) recorded as follow-up.

### Verification

- pnpm --dir apps/web exec tsc --noEmit -p tsconfig.json
- node target/wb-shots/capture.mjs (12/12 stories, 0 console errors)
- pnpm agent:preflight

### Handoff / Follow-ups

- Ladle decorator caveat: .ladle/components.tsx exports globals+decorator but Ladle 5.1.1 applies the decorator unreliably - stories therefore seed themselves via workbenchFixtures.seedWorkbench and theming is URL-param driven
- if a future Ladle version applies decorators, the globals control can replace the URL param. Paparazzi 1.3.5 (AGP 8.9.1-compatible) not yet wired: add plugin + debug preview gallery, recordPaparazziDebug for JVM PNGs. pnpm format:check still fails on 31 pre-existing files (unchanged)
- all new files are Prettier-clean if the format gate runs scoped. Android @Preview gallery for leaf components (debug source set) remains open.
