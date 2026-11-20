---
bump: patch
surfaces: [core, web, desktop, android, tooling, docs, ci]
agent: zcode
branch: test/performance-ci-hardening
date: 2026-11-18
---

### Summary

Add tested four-surface performance regression gate (core/web/Android staging/Windows desktop), retire live Gemini timing test while preserving the 54-case eval, add academic property and CI validator tests, make Android emulator smoke real, enforce release signing/tag/ABI validation, and document the durable testing rework handoff. Bend was evaluated and not adopted.

### Verification

- pnpm agent:preflight
- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace
- pnpm test:tooling
- pnpm --dir apps/web build:wasm
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm --dir apps/web test
- pnpm --filter @quizradar/landing test
- playwright test (behavioral pass, visual baselines non-blocking)
- coverage:rust, coverage:web, coverage:ratchet
- gradlew ktlintCheck lintRelease testDebugUnitTest assembleDebug assembleRelease bundleRelease
- verify-android-artifacts debug/release APK and AAB
- performance same-build calibration core/web/android/desktop
- node performance/desktop/prepare-build.mjs --project .; cargo tauri build --no-bundle; node performance/desktop/run.mjs --base-exe target/release/quizradar-desktop.exe --head-exe target/release/quizradar-desktop.exe --samples 5 (native CDP/IPC and repeated same-build comparison pass)

### Handoff / Follow-ups

- Run the first real GitHub Actions calibration and adjust thresholds only with evidence
- configure branch protection to require ci-success and performance-review
- run a true base-vs-head comparison on PR
- visual baselines remain non-blocking until regenerated/verified on Linux
- Android lint baseline intentionally contains only UniFFI-generated NewApi findings
- CONFLICT RADAR: coordinate/rebase with sibling `chore/agent-ready` (`QuizRadar-pr41`) — it independently touches `PairSyncCodec.kt`, `QuizRadarCore.kt`, and `AndroidUiCaptureTest.kt`, including a linear QR-compaction fix
