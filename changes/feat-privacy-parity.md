---
bump: minor
surfaces: [core, desktop, web]
agent: antigravity
branch: feat/privacy-parity
date: 2026-11-10
---

### Summary

Implement DB encryption key management and non-destructive migration, prune/rotate Gemini AI cache per semester, add desktop system tray countdown and notification window, and demote Moodle REST tokens in favor of iCal.

### Verification

- cargo test -p quizradar-core
- cargo test -p quizradar-desktop
- cargo clippy -p quizradar-core -p quizradar-desktop --all-targets
- pnpm --filter @quizradar/web test
- pnpm typecheck
- pnpm lint

### Handoff / Follow-ups

- SQLCipher requires OpenSSL and C toolchain on Windows host to compile bundled-sqlcipher
- clean key management and header-detection scaffolding is in place. Android notification semantics parity achieved in desktop tray.
