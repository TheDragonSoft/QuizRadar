---
bump: minor
surfaces: [android, web]
agent: zcode
branch: feat/android-ui-captures
date: 2026-11-14
---

### Summary

Real Android phone UI in the web workbench, rendered from code on the JVM (no emulator): AndroidUiCaptureTest renders the production Compose screens (Dashboard dark+light, Tasks, Calendar, Grades, Focus, Settings) with Robolectric native graphics over the REAL Rust-backed QuizRadarViewModel on an in-memory engine (QuizRadarEngine.createInMemory) seeded with relative dates - the same evergreen honesty contract as the web fixtures. Two Robolectric pitfalls solved and documented in the test: waitForIdle never settles under infinite animations (hero starfield) so the main clock is paused and data readiness is awaited via bounded waitUntil on visible text; compose-test captureToImage's forceRedraw handshake times out under Robolectric so the PNG is produced by drawing the window decor onto a canvas. Captures are written to apps/web/public/android-ui (gitignored, machine-local - AGENTS 3.8; CI never runs the capture test so release builds ship no PNGs) and the workbench Phone (Android app)/ section displays them in a device bezel; the web Phone section is renamed Phone (PWA web tier) so the two phone tiers are never confused.

### Verification

- gradlew.bat testDebugUnitTest --tests *AndroidUiCaptureTest* (7/7 PNGs)
- gradlew.bat ktlintCheck
- pnpm lint
- pnpm --dir apps/web exec tsc --noEmit -p tsconfig.json

### Handoff / Follow-ups

- Paparazzi no longer needed - the Robolectric route uses existing deps (zero new ones). Screens take the shared QuizRadarViewModel so per-state captures (graded/onboarding steps) need VM-state seeding in the test - follow-up. CI runs testDebugUnitTest: the capture test writes PNGs into the workspace (gitignored, harmless) - if that becomes noisy, gate the class behind a system property.
