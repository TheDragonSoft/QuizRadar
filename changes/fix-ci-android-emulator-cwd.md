---
bump: none
surfaces: [ci]
agent: antigravity
branch: fix/ci-android-emulator-cwd
date: 2026-11-17
---

### Summary

Fix android-emulator CI job in .github/workflows/ci.yml so gradlew runs from apps/mobile-android instead of failing with ./gradlew: not found across per-line sh -c invocations.

### Verification

- Verified ci.yml syntax and validated agent note
- full android-emulator job runs in GitHub Actions.

### Handoff / Follow-ups

- None
