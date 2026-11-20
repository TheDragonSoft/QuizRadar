---
bump: none
surfaces: [core, web]
agent: zcode
branch: feat/lan-https-qr-sync
date: 2026-11-20
---

### Summary

Gate the new sync module (QR matrix, pair codec, LAN URI parse) plus its miniz_oxide dependency behind a cargo feature: core gains default=[sync,uniffi] with sync=[dep:miniz_oxide], lib.rs and the six UniFFI exports are cfg(feature=sync)-gated, and the wasm bindings crate explicitly opts in. Rationale: the performance sampler builds quizradar-core with default-features=false, and with sync compiled in unconditionally the Linux release codegen for store/planner hot paths shifted +13-22% (reproduced on two CI runners with zero-overlap sample distributions; not reproducible on Windows). Gating returns the sampler's codegen to exact-main while every product shell keeps the feature.

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace (375 core tests incl. sync suite)
- cargo build -p quizradar-performance-core (no-default build compiles with sync cfg'd out)
- node apps/web/src/contract/regenerate.mjs --check (hash-only diff, surface unchanged)

### Handoff / Follow-ups

- Watch the first CI+Performance cycle on the re-pushed PR branch
- if the core sampler still regresses on Linux, the next escalation is codegen-units=1 in the workspace release profile (needs its own calibration evidence)
