---
bump: patch
surfaces: [web, android]
agent: Antigravity
branch: feat/qr-code-pairing
date: 2026-11-20
---

### Summary

Harden serverless `quizradar://pair` QR code pairing across Web/Desktop and Android: resolve the `PairSyncCodec.kt` conflict with `main` (fixing a JSON-corruption bug in `main`'s truncation helper), upgrade compaction on both Web and Android to a two-stage strategy targeting real `BackupPayload` fields (lossless removal of `null` and derived `google_cal_url`/`conflict_warning`/`display_time` fields first, then verbose `ai_study_plan`/`raw_text` stripping and UTF-16/escape-safe truncation of `ai_inference_note`/`snippet`/`notes` across assessments and custom events), drain Web `CompressionStream`/`DecompressionStream` concurrently to prevent Chromium >64KB backpressure deadlocks, close scanned `ImageBitmap` handles in `CloudSyncModal`, move Android deflate/QR matrix encoding off the main thread without double-encoding, render the Android pairing QR card inline with integer-snapped Canvas modules and non-clipping compact row buttons, and expand unit/UI-capture regression coverage.

### Verification

- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm test
- node tooling/agent-gate.mjs --ci
- gradlew ktlintCheck testDebugUnitTest

### Handoff / Follow-ups

- Consider consolidating `pairSync` compaction/codec and QR encoding into pure Rust `core/` (single implementation) and adding a live camera + non-`BarcodeDetector` fallback decoder for Android-to-Desktop pairing.
