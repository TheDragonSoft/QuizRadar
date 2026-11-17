---
bump: patch
surfaces: [core, web]
agent: antigravity
branch: fix/gemini-model-ladder
date: 2026-11-17
---

### Summary

Prioritize gemini-3.8-flash first in the Flash model ladder (core and PWA browser adapter) and preserve earlier 503 congestion errors instead of letting a trailing retired-model 404 (gemini-2.5-flash) overwrite them.

### Verification

- cargo fmt --all --check
- cargo clippy -p quizradar-core --all-targets -- -D warnings
- cargo test -p quizradar-core
- pnpm --filter @quizradar/web exec vitest run src/pwadapters/browserAi.test.ts
- pnpm format:check
- pnpm lint

### Handoff / Follow-ups

- None
