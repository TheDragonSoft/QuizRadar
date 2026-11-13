---
bump: minor
surfaces: [web, android, tooling]
agent: zcode
branch: feat/ui-workbench
date: 2026-11-13
---

### Summary

Web UI workbench v2 (Ladle 5): complete per-element UI playground for apps/web. 40+ stories: the four views, ALL 13 registered modals rendered through the real ModalStack (modalSetup.ts mirrors App.tsx registrations - keep in sync), the shell chrome (TopBar, Sidebar, MobileNav, PullToRefresh, PrintScheduleDoc, SearchDropdown, brand marks), and every dashboard/calendar card (CalendarGrid, DailyStudyRoadmap, StudyStatsCard full+compact, TimelineHorizon, NextUpHero loaded+empty, StudyRecommendationCard, TimelineRow, all three empty states). Everything seeded from the real core-produced contract payloads re-dated by one uniform delta; calendar grid seams (currentWeekStart, selectedCalendarDate, layers) pinned to the fixture week. Theme fixes from maintainer feedback: the URL ?theme= param now documents the app's real theme surface (5 ids; light/dark are generic MODES the app normalizes onto Solar/Obsidian - AMOLED Pure/Sparkle were retired from the app), supports ?theme=system (OS preference), and the decorator paints the canvas with the real page tokens (bare components no longer float on Ladle's gray canvas - that was the 'weird' look). Phone coverage: capture pass at a real 390x844 viewport with mode=preview - Tailwind breakpoints follow the viewport, so MobileNav, PullToRefresh and every view render exactly as on a phone. Captured ~100 screenshots into gitignored target/wb-shots. Per-surface AGENTS.md guides; workbench docs list all URL params.

### Verification

- pnpm lint
- pnpm --dir apps/web exec tsc --noEmit -p tsconfig.json
- pnpm exec prettier --check apps/web/src/stories apps/web/.ladle
- node target/wb-shots/capture.mjs

### Handoff / Follow-ups

- Ladle 5.1.1 applies .ladle/components.tsx decorators unreliably - stories seed themselves via workbenchFixtures.seedWorkbench and theming is URL-param driven
- if a future Ladle applies decorators the globals control can replace the URL param. NEVER call applyThemeToDocument inside a MutationObserver - its View Transitions path wedges initial load (the observer writes attributes directly). Paparazzi 1.3.5 JVM screenshots + Android debug @Preview gallery remain open follow-ups. Full format:check still fails on 31 pre-existing files (untouched).
