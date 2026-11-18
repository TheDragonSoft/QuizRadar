---
bump: minor
surfaces: [core, desktop, web, android]
agent: antigravity
branch: feat/course-aliases-and-reassignment
date: 2026-11-17
---

### Summary

Add multiple course codes/aliases per course and assessment course reassignment with optional alias recording.

### Verification

- cargo fmt --all
- cargo clippy -p quizradar-core --all-targets -- -D warnings
- cargo test -p quizradar-core
- node apps/web/src/contract/regenerate.mjs --check
- pnpm --filter @quizradar/web exec vitest run src/contract/contract.test.ts src/copy/conformance.test.ts
- pnpm format:check
- pnpm lint

### Handoff / Follow-ups

- CI builds Desktop (Tauri), WASM, and Android Gradle + Robolectric screenshots.
