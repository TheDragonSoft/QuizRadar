---
bump: minor
surfaces: [android, docs, ci]
agent: zcode
branch: feat/android-beta-feedback
date: 2026-11-20
---

### Summary

Add native shake-to-feedback for debug, staging, and GitHub release APKs with a persistent multi-issue inbox. Each report keeps its own ID, screenshot, written note, and optional voice recording; save multiple issues, review/play/delete them in Settings, then export all as one ZIP with batch-index.md, batch-manifest.json, and isolated issue directories. Preserve single-issue sharing, privacy review, no automatic upload, release inclusion, Help/FAQ, short PR Authoring Model field, and dialog-aware Robolectric UI captures. Hardened in PR review: ViewModel-backed rotation survival, ModalBottomSheet discard-cancel recovery, separate save/share progress states, cold-start deep link layout deferral, accurate screen reporting, sliding-window/rate-independent shake detection, synchronized inbox store that clears damaged entries and preserves per-issue build info, subsampled thumbnails, inbox voice playback, 3-minute recording cap, stale cache pruning, and tightened FileProvider package-only path.

### Verification

- gradlew ktlintCheck lintRelease testDebugUnitTest assembleDebug assembleRelease (247 tests before review fixes; full testDebugUnitTest + 33 feedback unit tests + BetaFeedbackBuildGateTest release test + ktlintCheck + lintRelease re-run and green after review fixes)
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- pnpm format:check
- pnpm agent:note --validate
- emulator-5554 single-issue shake/screenshot/voice/share smoke plus two saved issues with separate screenshots and a voice note on issue 2, Settings Review & export all (2), batch share sheet, preserved inbox, and local CRC/manifest/attachment validation
- test-signed R8 release APK launch/screenshot/ZIP share smoke (debug key only, no external send)
- three inspected non-blank Robolectric feedback/inbox PNGs for direct PR embedding.

### Handoff / Follow-ups

- Dogfood sensitivity and microphone capture on physical phones. Voice notes require an available transcription tool during maintainer review
- otherwise request a transcript. No automatic upload, export-triggered inbox deletion, or phone-to-agent repair channel by design. Release signing/publishing remains the normal release-pipeline step.
