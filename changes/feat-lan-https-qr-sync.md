---
bump: minor
surfaces: [core, desktop, web, android, docs]
agent: Antigravity
branch: feat/lan-https-qr-sync
date: 2026-11-20
---

### Summary

Add ephemeral on-demand Desktop LAN HTTPS device pairing (`quizradar://lan?...`) and consolidate peer sync & QR encoding into pure Rust `core/`:

- **Core (`core/src/sync/`)**: Implement ISO/IEC 18004 QR matrix encoding, typed two-stage `BackupPayload` compaction, raw-DEFLATE `quizradar://pair` codec (`miniz_oxide = "0.8"`, already in `Cargo.lock`), and SSRF-safe private-IPv4 `quizradar://lan` URI validation once in pure Rust, exported via both UniFFI (Android) and WASM (Web/PWA).
- **Desktop (`apps/desktop/src-tauri/src/lan_pair.rs`)**: Add on-demand ephemeral TLS pairing (`start_lan_pair_session` / `stop_lan_pair_session`) using per-session self-signed X.509 certificates (`rcgen = "0.13"` with `rustls`/`tokio-rustls` already in `Cargo.lock`) whose SHA-256 fingerprint is pinned in the QR code plus a single-use 256-bit bearer token; merges bidirectionally in one scan with no 2.9 KB cap and auto-closes after 1 sync or 5 minutes. Record the 2026-11-20 maintainer override in `AGENTS.md`.
- **Android (`apps/mobile-android/`)**: Add `LanPairClient.kt` (pinned SHA-256 `X509TrustManager` over `HttpsURLConnection`, preserving `usesCleartextTraffic="false"`), `quizradar://lan` deep-link intent filter and `MainActivity` routing, thin UniFFI facades for `QrCodeEncoder.kt` and `PairSyncCodec.kt` (removing ~700 LOC of duplicated Kotlin logic), and tap-to-enlarge full-width QR dialog with temporary screen brightness boost in `SettingsScreen.kt`.
- **Web / Desktop UI (`apps/web/`)**: Add Instant Local Wi-Fi Sync panel in `CloudSyncModal.tsx` with live countdown and Tauri event listeners, live webcam QR scanner (`getUserMedia`) + pure-JS `jsqr` (`1.4.0`) fallback decoder so Android-to-Desktop/Firefox scanning works without `BarcodeDetector`, tap-to-enlarge QR lightbox, and end-to-end `jsQR` + Rust WASM bit-for-bit decode verification tests.

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace
- pnpm --dir apps/web build:wasm
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm --dir apps/web test
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/agent-gate.mjs --ci --base origin/main
- gradlew ktlintCheck testDebugUnitTest

### Handoff / Follow-ups

- None
