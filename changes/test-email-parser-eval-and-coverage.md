---
bump: patch
surfaces: [core, web, android]
agent: antigravity
branch: test/email-parser-eval-and-coverage
date: 2026-11-15
---

### Summary

Add 54-case deterministic + live Gemini/hybrid email parser eval benchmark, 12 new golden fixtures (13-24), p5-p7 property suites, mocked Gemini/sync-cache/FFI-cache tests, live Gemini #[ignore] harnesses, Android BackgroundScanWorkerTest, deterministic parser fixes in core/src/parse/email.rs (54-case faults 33->13->0), and live Gemini schema/prompt fixes in core/src/ai/tasks.rs (accept null JSON arrays on is_assessment=false replies, clarify LMS /mod/quiz/ & combined grade/appeal + remake extraction, and normalize typographic punctuation in clean_ai_topics, reducing live 54-case Gemini/hybrid false negatives 3->0 and topic defects 2->0 while cutting live calls 59.3% via deterministic pre-filtering).

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace (364 core unit + 1 ignored, 71 core integration + 2 ignored, 41 desktop passed; 0 failed)
- live Gemini API eval (live_gemini_extraction_eval_harness + paced live_gemini_54_email_eval_benchmark against gemini-3.5-flash-lite with transient GEMINI_API_KEY: 54/54 HTTP 200, avg 1389ms / p50 1234ms / p95 1928ms, 22/22 TP, 32/32 TN, 0 FP, 0 FN, 0 topic/type/date errors, 1 cosmetic cls-07 title prefix diff, hybrid 22 calls vs 54 unfiltered)
- pnpm --dir apps/web build:wasm (863.2 KiB)
- pnpm --dir apps/web vitest run (47 files, 444 passed)
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- gradlew ktlintCheck testDebugUnitTest --rerun-tasks (34 suites, 212 tests, 0 skipped, 0 failed)

### Handoff / Follow-ups

- None (live_gemini_* #[ignore] harnesses remain skipped in offline CI unless GEMINI_API_KEY is supplied at runtime).
