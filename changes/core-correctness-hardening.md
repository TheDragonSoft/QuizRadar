---
bump: patch
surfaces: [core, web]
agent: zcode
branch: chore/agent-ready
date: 2026-11-18
---

### Summary

Correct rescheduled announcement dates, require timely timed study blocks before suppressing conflicts, retain explicit ICS venues, and emit exclusive all-day Google Calendar end dates; refresh the contract source hash.

### Verification

- cargo fmt --all --check (PASS)
- cargo clippy --workspace --all-targets -- -D warnings (PASS)
- cargo test --workspace --no-fail-fast -- --format terse (367 core unit tests passed; all workspace suites except property_plan passed)
- property_plan assertions control_mitigated_pair_is_reported_mitigated and p5_alerts_pair_dated_upcoming_items_with_honest_gaps FAILED because they assert legacy untimed/ID-only mitigation; the other 10 tests in that suite passed
- node tooling/generate-version.mjs --check (PASS)
- node apps/web/src/contract/regenerate.mjs --check (PASS after source-hash refresh)
- pnpm --dir apps/web build:wasm (PASS)
- pnpm format:check (PASS)
- pnpm lint (PASS)
- pnpm typecheck (PASS)
- pnpm test (PASS: 451 web tests, 8 landing tests, and 41 desktop unit/integration tests)
- pnpm agent:note --validate (PASS)

### Handoff / Follow-ups

- Two unchanged property tests in core/tests/property_plan.rs assert the legacy mitigation contract and need updating only when core test work is authorized
- no test files were edited. DST follow-up: ICS and Google Calendar paths still inject one current fixed offset, so events across DST transitions can be wrong. Fixing this coherently needs per-event timezone resolvers across desktop, Android/UniFFI, and WASM. No dependencies, database migrations, or FFI/DTO shape changes.
