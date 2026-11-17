---
bump: patch
surfaces: [android]
agent: antigravity
branch: fix/concise-sync-toast
date: 2026-11-17
---

### Summary

Keep Android scan completion toast concise (counts and per-source status only) by omitting verbose diagnostic notes that already live in lastScanReport.

### Verification

- Kotlin unit test updated in QuizRadarViewModelTest.kt
- Android SDK not installed in this VM so ktlintCheck/testDebugUnitTest deferred to CI.

### Handoff / Follow-ups

- None
