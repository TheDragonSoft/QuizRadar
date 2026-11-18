---
bump: minor
surfaces: [core, web, desktop, android, docs]
agent: antigravity
branch: feat/serverless-sync-and-backlog-cleanup
date: 2026-11-17
---

### Summary

Clear technical backlog in STATUS.md, implement serverless two-way peer sync (quizradar://pair?d=...) across Core/Desktop/PWA/Android, and add docs/ROADMAP-COMMERCIAL.md for future E2EE sync-server and commercial plans

### Verification

- cargo fmt --all --check
- cargo clippy -p quizradar-core --all-targets -- -D warnings
- cargo test -p quizradar-core --lib ffi
- pnpm lint
- pnpm --dir apps/web test src/lib/pairSync.test.ts src/components/CloudSyncModal.test.tsx src/state/swr.test.ts
- node apps/web/src/contract/regenerate.mjs --check
- pnpm generate:version:check

### Handoff / Follow-ups

- Run full pnpm --dir apps/web build:wasm + vitest + desktop cargo test + Android ./gradlew ktlintCheck testDebugUnitTest on a host with wasm-bindgen-cli, Tauri system deps, and Android SDK.
