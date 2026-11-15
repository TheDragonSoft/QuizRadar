---
bump: patch
surfaces: [core, android, web]
agent: antigravity
branch: fix/email-parser-and-dashboard
date: 2026-11-15
---

### Summary

Harden core email false-positive filtering, topic unwrapping/cleanup, Gemini sync caching/workers, SQLite/dashboard canonical ordering, and Android/Web UI honesty & polish

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace
- pnpm lint
- pnpm typecheck
- pnpm --dir apps/web vitest run
- pnpm format:check
- pnpm --dir apps/web build
- node apps/web/src/contract/regenerate.mjs --check
- pnpm generate:version:check
- gradlew.bat ktlintCheck testDebugUnitTest assembleDebug

### Handoff / Follow-ups

- emulator-5554 currently runs a release-signed build (INSTALL_FAILED_UPDATE_INCOMPATIBLE for debug APK without KEYSTORE_FILE)
- did not uninstall to preserve user login/data on emulator — install release-signed APK or approve uninstall before live device re-verify
