---
bump: none
surfaces: [web]
agent: antigravity
branch: refactor/modular-settings-view
date: 2026-11-10
---

### Summary

De-monolithize pps/web/src/views/SettingsView.tsx (reduced from 1,738 lines to 151 lines):
- Created pps/web/src/views/settings/ directory with dedicated modules:
  - constants.ts: Shared section ID map (ccount, courses, integrations)
  - SettingsAccountSection.tsx: Profile banner, theme suite (Solar, Obsidian, AMOLED variants), academic rhythm preset selector, OAuth hub cards (Google, Microsoft), and BYOK Gemini configuration
  - SettingsCoursesSection.tsx: Timetable vision import and course enrollment management grid
  - SettingsIntegrationsSection.tsx: Google Calendar sync, University sources (Teams, Classroom), LMS setup guides (Moodle, Canvas, Blackboard), external ICS feeds, JSON backup/restore/reset, anonymous telemetry toggle, software updates, and custom OAuth override settings
  - index.ts: Clean barrel exports
- Refactored SettingsView.tsx into a lightweight, readable coordinator shell managing layout and section anchor-scrolling.

### Verification

- pnpm --filter @quizradar/web typecheck (zero TypeScript errors)
- pnpm --filter @quizradar/web test (39/39 passed, 330/330 tests)
- pnpm test:tooling (2/2 passed, 16/16 tests)
- pnpm typecheck (zero global TypeScript errors)
- pnpm lint (0 errors)

### Handoff / Follow-ups

- Next target in Phase 3 de-monolithization: pps/web/src/views/DashboardView.tsx (1,500+ lines).