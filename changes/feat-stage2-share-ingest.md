---
bump: minor
surfaces: [core, desktop, web, android]
agent: Antigravity
branch: feat/stage2-share-ingest
date: 2026-11-22
---

### Summary

Stage 2 PR 3: WhatsApp/Telegram/Discord screenshot, PDF, and forwarded-text announcement ingest across Rust core, Desktop Tauri, Web/PWA (QuickCaptureModal + Ctrl+V paste), and Android Share Sheet (ACTION_SEND text/plain, image/*, application/pdf).

### Verification

- cargo fmt --all --check
- cargo test --locked -p quizradar-core
- cargo test --locked -p quizradar-desktop --test commands_integration test_quick_capture
- uniffi-bindgen kotlin
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/generate-version.mjs --check
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Stage 2 PR 4 (Onboarding progressive disclosure + post-syllabus 1-tap share prompt) and Stage 2 PR 2 (Privacy-first crash/funnel diagnostics).
