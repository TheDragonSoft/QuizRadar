---
bump: minor
surfaces: [android, docs]
agent: antigravity
branch: feat/android-feedback-improvements
date: 2026-11-20
---

### Summary

Improve Android shake-to-feedback capture, privacy redaction, sensor fusion, and dictation: capture screenshots via API 26+ PixelCopy (with software fallback) and off-main-thread PNG encoding; decode preview and inbox thumbnails asynchronously off the main thread; add an interactive finger-drag screenshot redaction dialog that permanently burns opaque black marks into screenshot.png before sharing; prefer hardware-fused TYPE_LINEAR_ACCELERATION with TYPE_ACCELEROMETER fallback; add opt-in speech-to-text dictation into the report text box with honest unavailable fallback; and fix rounded-rectangle clipping (extraSmall 12dp) on screenshot previews, inbox thumbnails, and banners.

### Verification

- gradlew ktlintCheck lintRelease testDebugUnitTest
- gradlew testDebugUnitTest --tests com.quizradar.app.feedback.* (42 tests)
- gradlew testReleaseUnitTest --tests com.quizradar.app.feedback.BetaFeedbackBuildGateTest
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- pnpm format:check
- pnpm agent:note --validate

### Handoff / Follow-ups

- Dogfood PixelCopy, linear acceleration trigger sensitivity, screenshot redaction touch ergonomics, and device speech-to-text dictation on physical Android hardware.
