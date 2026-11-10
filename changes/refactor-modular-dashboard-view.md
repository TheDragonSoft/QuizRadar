---
bump: none
surfaces: [web]
agent: antigravity
branch: refactor/modular-dashboard-view
date: 2026-11-10
---

### Summary

De-monolithize pps/web/src/views/DashboardView.tsx (reduced from 1,503 lines to 472 lines):
- Created pps/web/src/views/dashboard/ directory with dedicated modular components:
  - ormatters.ts: Date, schedule string, and emoji-stripping helpers (ormatShortDate, ormatCompactCardSchedule, stripRoomPrefix, stripLeadingEmoji, weekRangeLabels)
  - NextUpHero.tsx: Dynamic parallax sky banner with day/night stars and solar glow animations (NextUpHero, NextUpHeroStars)
  - StudyRecommendationCard.tsx: Interactive topic readiness card with collapsible checklist and inline Pomodoro / practice launcher
  - TimelineRow.tsx: Timeline list item with assessment badges, grading chips, and rules display (TimelineRow, SourceIcon)
  - DashboardEmptyStates.tsx: First-run, search empty, and all-clear states
  - RemoteAnnouncementBanner.tsx: Remote announcement banner component wired to feature flags
  - index.ts: Barrel exports
- Updated pps/web/src/audit/antipatterns.test.ts allow-list to track coursePalette references in the new modular files.
- Preserved backward compatibility for TasksView.tsx by re-exporting TimelineRow and TimelineRowProps.

### Verification

- pnpm --filter @quizradar/web typecheck (clean)
- pnpm --filter @quizradar/web test (39/39 passed, 330/330 tests)
- pnpm test:tooling (2/2 passed, 16/16 tests)
- pnpm typecheck (clean across all workspaces)
- pnpm lint (0 errors)

### Handoff / Follow-ups

- Next target in Phase 3 de-monolithization: pps/web/src/state/store.ts (65.3KB).