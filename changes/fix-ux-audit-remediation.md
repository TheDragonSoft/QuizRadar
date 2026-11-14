---
bump: minor
surfaces: [web, android, tooling, docs]
agent: antigravity
branch: fix/ux-audit-remediation
date: 2026-11-14
---

### Summary

Remediate cross-platform UX audit findings across Android Compose and Web, add dynamic empty-day calendar column filtering on both platforms, tune dynamic Android period grid lines, redesign Focus timer and Web TimelineHorizon cards, and add AuditRenderHarness plus Web component/capture test coverage.

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace
- eslint .
- pnpm -r typecheck
- pnpm --dir apps/web test -- --run (47 files, 444 passed)
- pnpm test:tooling (3 files, 30 passed)
- pnpm --filter @quizradar/landing build
- playwright test --grep-invert @visual (11 passed, 1 skipped)
- gradlew.bat ktlintCheck testDebugUnitTest (33 files, 200 passed) assembleDebug
- prettier --check .

### Handoff / Follow-ups

- Follow-up: capture-audit-sweep.spec.ts (empty-state E2E audit) and browser-visual baselines remain opt-in
- dynamic 390px mobile calendar strip in Web CalendarView preserves 3-day horizontal scroll at 140px column minWidth.
