---
bump: minor
surfaces: [core, desktop, web, android, docs]
agent: antigravity
branch: feat/stage1-syllabus-and-course-pack
date: 2026-11-21
---

### Summary

Stage 1 PR 1: Multi-Syllabus PDF/Photo Importer (1-6 docs) and 1-Tap Shareable Course Pack links (#course= HTTPS URL, quizradar://course?d= deep link, QR code) across Rust core, Desktop Tauri, Web/PWA, and Android native; recorded 2026-11-21 Trial AI Relay maintainer override in AGENTS.md.

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace --locked
- cargo build -p quizradar-core --no-default-features
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/generate-version.mjs --check
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm --dir apps/web test
- pnpm --dir apps/web build
- gradlew ktlintCheck lintRelease testDebugUnitTest assembleDebug

### Handoff / Follow-ups

- Stage 1 PR 2: Zero-Key Trial AI Relay Cloudflare Worker + opt-in client routing (authorized via AGENTS.md 2026-11-21 override).
