---
bump: minor
surfaces: [core, web, desktop]
agent: antigravity
branch: feat/email-pipeline-gemini-overhaul
date: 2026-11-08
---

### Summary

Intelligent hybrid email extraction: deterministic course-code/name matching in core to avoid Gemini token waste, Gemini for fuzzy dates/times, AI extraction cache table, and UI transparency in assessment detail

### Verification

- cargo fmt --all --check
- cargo test --workspace (300 core + all integration, 0 failed)
- node apps/web/src/contract/regenerate.mjs --check
- pnpm --dir apps/web test (328 passed, 39 files)
- node tooling/generate-version.mjs --check

### Handoff / Follow-ups

- cargo clippy --workspace --all-targets -- -D warnings still fails on pre-existing unwrap_used in cushion/parity and bool asserts in repo tests
- fix in follow-up. Android uniffiGenerate not run (no JDK/Gradle in this env).
