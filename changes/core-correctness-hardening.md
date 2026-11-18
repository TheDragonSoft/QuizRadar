---
bump: patch
surfaces: [core, web, android]
agent: zcode
branch: chore/agent-ready
date: 2026-11-18
---

### Summary

Correct rescheduled announcement dates, require timely timed study blocks before suppressing conflicts, retain explicit ICS venues, and emit exclusive all-day Google Calendar end dates; align conflict fixtures with the corrected semantics and make Android QR compaction linear instead of regex-backtracking.

### Verification

- cargo fmt --all --check (PASS)
- cargo clippy --workspace --all-targets -- -D warnings (PASS)
- cargo test --workspace --no-fail-fast -- --format terse (368 core unit tests; all workspace suites passed)
- pnpm coverage:rust (PASS)
- pnpm coverage:web (PASS)
- pnpm coverage:ratchet (PASS: all tracked metrics meet committed floors)
- node tooling/generate-version.mjs --check (PASS)
- node apps/web/src/contract/regenerate.mjs --check (PASS after source-hash refresh)
- pnpm --dir apps/web build:wasm (PASS)
- pnpm format:check (PASS)
- pnpm lint (PASS)
- pnpm typecheck (PASS)
- pnpm test (PASS: 451 web tests, 8 landing tests, and 41 desktop unit/integration tests)
- apps/mobile-android gradlew ktlintCheck testDebugUnitTest assembleDebug assembleRelease (PASS: 222 tests)
- apps/mobile-android gradlew testDebugUnitTest --tests _AndroidUiCaptureTest_ (PASS)
- pnpm agent:note --validate (PASS)

### Handoff / Follow-ups

- DST follow-up: ICS and Google Calendar paths still inject one current fixed offset, so events across DST transitions can be wrong. Fixing this coherently needs per-event timezone resolvers across desktop, Android/UniFFI, and WASM. No dependencies, database migrations, or FFI/DTO shape changes.
