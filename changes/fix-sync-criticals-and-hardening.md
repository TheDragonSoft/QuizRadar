---
bump: patch
surfaces: [core, desktop, android, web, docs]
agent: Antigravity
branch: fix/sync-criticals-and-hardening
date: 2026-11-08
---

### Summary

Batch 1 sync hardening: Gmail pagination (S1), 429/5xx exponential backoff (S2), Teams OAuth scopes (S3), SingleFlightTokenProvider (S6), bounded source timeouts (S12/S14), and honest query error handling (S19/S20)

### Verification

- cargo test --workspace
- cargo clippy --workspace --all-targets -- -D warnings
- pnpm --filter @quizradar/web test
- gradlew.bat testDebugUnitTest

### Handoff / Follow-ups

- Batch 1 complete. Proceed to Batch 2: Store Safety, Migrations & SQLite Integrity (P3, P4, P25, S35, S40, P19, P20, P22).
