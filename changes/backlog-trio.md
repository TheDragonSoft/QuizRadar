---
bump: patch
surfaces: [core, desktop, web, android]
agent: antigravity
branch: feat/backlog-trio
date: 2026-11-10
---

### Summary

Resolved Phase 1 backlog trio: wired Android deriveStudyTasks academic track passthrough, built manual standalone assessment creation/edit modal UI across desktop/web, and eliminated first-boot SWR cache flicker for legacy positional keys.

### Verification

- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace (411 tests passed)
- pnpm typecheck (landing & web 0 errors)
- pnpm vitest run src/components/CreateEditAssessmentModal.test.tsx src/state/swr.test.ts src/state/boot.test.tsx (14 passed)
- eslint . (0 errors)
- .\gradlew.bat testDebugUnitTest ktlintCheck (all passed)

### Handoff / Follow-ups

- Phase 1 complete. Core, desktop Tauri, web PWA, and Android track passthrough are all green and tested.
