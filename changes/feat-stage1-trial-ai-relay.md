---
bump: minor
surfaces: [core, desktop, web, android, tooling, docs]
agent: antigravity
branch: feat/stage1-trial-ai-relay
date: 2026-11-21
---

### Summary

Stage 1 PR 2: Stateless Zero-Key Trial AI Relay Cloudflare Worker and opt-in starter AI routing across Rust core, Desktop Tauri, Web/PWA, and Android native (BYOK always wins, verbatim 05 §5.1 consent preserved).

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace --locked
- cargo build -p quizradar-core --no-default-features
- pnpm test:worker
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/generate-version.mjs --check
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm --dir apps/web test
- pnpm --dir apps/web build
- gradlew uniffiGenerate ktlintCheck lintRelease testDebugUnitTest assembleDebug
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Deploy workers/trial-ai-relay with wrangler kv namespace create TRIAL_QUOTA_KV + wrangler secret put GEMINI_API_KEY + wrangler deploy
- Stage 1 item 4 (Google CASA OAuth verification & Microsoft Entra multi-tenant ID) remains external console work.
