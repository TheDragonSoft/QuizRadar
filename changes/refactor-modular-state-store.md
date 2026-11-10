---
bump: none
surfaces: [web]
agent: antigravity
branch: refactor/modular-state-store
date: 2026-11-10
---

### Summary

De-monolithize pps/web/src/state/store.ts:
- Extracted calendar-date arithmetic and OAuth error classification into pps/web/src/state/dateUtils.ts (ddDaysToIsoDate, getWeekStart, isClientIdSetupError).
- Extracted local-storage persistence and theme transitions into pps/web/src/state/storage.ts (THEME_STORAGE_KEY, SIDEBAR_STORAGE_KEY, GRADING_SCALE_STORAGE_KEY, FLASHCARDS_STORAGE_KEY, QUIZ_HISTORY_STORAGE_KEY, MISTAKES_STORAGE_KEY, storage helpers, pplyThemeToDocument, isDarkTheme).
- Extracted initial state payload into pps/web/src/state/initialState.ts (initialFullState).
- Re-exported all extracted utilities and constants from pps/web/src/state/store.ts for backward compatibility across all consumers.

### Verification

- pnpm --filter @quizradar/web typecheck (clean)
- pnpm --filter @quizradar/web test (39/39 passed, 330/330 tests)
- pnpm test:tooling (2/2 passed, 16/16 tests)
- pnpm lint (0 errors)

### Handoff / Follow-ups

- Completed Phase 3 de-monolithization of frontend monoliths (SettingsView, DashboardView, store).