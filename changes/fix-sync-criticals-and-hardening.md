---
bump: minor
surfaces: [core, desktop, android, web, tooling, docs]
agent: Antigravity
branch: fix/sync-criticals-and-hardening
date: 2026-11-08
---

### Summary

Complete audit plan batches 1-6: sync hardening (S1, S2, S3, S6, S12, S14, S19), store safety & migrations (P3, P4, P25, S35, S40, P19, P20, P22), AI honesty & local timezone alignment (P5, P30, P1, S42, S8, P2), announcement email cache with SQLite schema v5 (S37, S39), timetable-derived week start & regional parity anchoring, shared pure study algorithms (streak & Leitner in core::plan::study for Store and WASM parity), contract spec M1 sync, and clippy/ktlint/vitest hardening.

### Verification

- `cargo test --workspace` (391 tests passed)
- `cargo clippy --workspace --all-targets -- -D warnings` (0 warnings)
- `pnpm --dir apps/web test` (329 tests across 39 files passed)
- `pnpm typecheck` (clean across all workspaces)
- `pnpm lint` (0 errors)
- `node apps/web/src/contract/regenerate.mjs --check` (wire map up to date)
- `cd apps/mobile-android; .\gradlew.bat uniffiGenerate testDebugUnitTest` (passed)

### Handoff / Follow-ups

None — all 6 audit batches implemented, tested, and passing on all platforms.
