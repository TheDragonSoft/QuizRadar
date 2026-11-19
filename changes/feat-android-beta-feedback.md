---
bump: minor
surfaces: [android, docs]
agent: zcode
branch: feat/android-beta-feedback
date: 2026-11-19
---

### Summary

Add native shake-to-feedback for debug, staging, and GitHub release APKs: accelerometer trigger plus Settings/deep-link entry, app screenshot review/removal, written reports, runtime-permission voice recording/playback, private ZIP packaging with minimal diagnostics and an agent brief, and explicit Android share-sheet handoff without telemetry or automatic upload. Add Help/FAQ and tester/ZCode guide.

### Verification

- gradlew ktlintCheck lintRelease testDebugUnitTest assembleRelease (237 tests, 0 failures)
- gradlew testDebugUnitTest --tests com.quizradar.app.feedback.* (15/15)
- gradlew testReleaseUnitTest --tests com.quizradar.app.feedback.BetaFeedbackBuildGateTest
- gradlew assembleDebug
- node tooling/generate-version.mjs --check
- pnpm format:check
- emulator-5554 real accelerometer shake, Settings toggle/button, deep link, screenshot, voice record/playback, ZIP CRC/content inspection, and share-sheet smoke
- test-signed R8 release APK launch/screenshot/ZIP share smoke (debug key only, no external send).

### Handoff / Follow-ups

- Dogfood sensitivity and microphone capture on physical phones. Voice notes require an available transcription tool during maintainer review
- otherwise request a transcript. No automatic upload or phone-to-agent repair channel by design. Release signing/publishing remains the normal release-pipeline step.
