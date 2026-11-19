---
bump: minor
surfaces: [android, docs, ci]
agent: zcode
branch: feat/android-beta-feedback
date: 2026-11-19
---

### Summary

Add native shake-to-feedback for debug, staging, and GitHub release APKs: accelerometer trigger plus Settings/deep-link entry, screenshot review/removal, written reports, runtime-permission voice recording/playback, private ZIP packaging with minimal diagnostics and an agent brief, and explicit share-sheet handoff without telemetry or automatic upload. Add Help/FAQ, tester/ZCode guide, a short PR Authoring Model template field, and dialog-aware Robolectric feedback UI captures for PR review.

### Verification

- gradlew ktlintCheck testDebugUnitTest (238 tests, 0 failures)
- gradlew lintRelease assembleRelease
- gradlew testReleaseUnitTest --tests com.quizradar.app.feedback.BetaFeedbackBuildGateTest
- gradlew assembleDebug
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- pnpm format:check
- pnpm agent:note --validate
- emulator-5554 real accelerometer shake, Settings toggle/button, deep link, screenshot, voice record/playback, ZIP CRC/content inspection, and share-sheet smoke
- test-signed R8 release APK launch/screenshot/ZIP share smoke (debug key only, no external send)
- BetaFeedbackAndroidUiCaptureTest produced inspected non-blank top/share PNGs for direct PR embedding.

### Handoff / Follow-ups

- Dogfood sensitivity and microphone capture on physical phones. Voice notes require an available transcription tool during maintainer review
- otherwise request a transcript. No automatic upload or phone-to-agent repair channel by design. Release signing/publishing remains the normal release-pipeline step.
