---
bump: patch
surfaces: [core, web, android]
agent: antigravity
branch: test/email-parser-eval-and-coverage
date: 2026-11-15
---

### Summary

Add 54-case email parser eval benchmark, 12 new golden fixtures (13-24), p5-p7 property suites, mocked Gemini/sync-cache/FFI-cache tests, live Gemini #[ignore] harness, Android BackgroundScanWorkerTest, and fix newly exposed HTML/Moodle-URL, cancellation/solution filter, topic-header, and forwarded-date bugs in core/src/parse/email.rs (54-case fault rate 33->13->0).

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace (363 core lib + 71 integration + 41 desktop passed, 0 failed)
- pnpm --dir apps/web build:wasm
- pnpm --dir apps/web vitest run (47 files, 444 passed)
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- gradlew ktlintCheck testDebugUnitTest (34 suites, 212 tests, 0 failed)

### Handoff / Follow-ups

- None (live_gemini_extraction_eval_harness remains #[ignore] unless GEMINI_API_KEY is exported).
