---
bump: minor
surfaces: [core, desktop, web, android, docs, ci]
agent: Antigravity
branch: feat/stage1-oauth-verification
date: 2026-11-21
---

### Summary

Stage 1 PR 3: OAuth Verification & First-Party Client Readiness — hosts same-domain /privacy/ (with verbatim Google API Services User Data Policy Limited Use disclosure & scope justification table) and /terms/ pages on apps/landing/, updates PRIVACY.md, adds CASA Tier 2 & Microsoft Entra multi-tenant submission runbook (docs/OAUTH-VERIFICATION.md), adds cross-platform Microsoft Entra GUID validation & build-time multi-tenant injection across Core, Desktop, Android (BuildConfig + OAuthManager + EngineFfiTokens + BackgroundScanWorker), Web/PWA (subpath-safe SPA redirect URI), and CI release/pages workflows.

### Verification

- cargo test --workspace --locked
- cargo clippy --workspace --all-targets -- -D warnings
- pnpm --filter @quizradar/landing test
- pnpm --filter @quizradar/landing build
- pnpm --dir apps/web test
- pnpm typecheck
- pnpm lint
- pnpm format:check
- gradlew ktlintCheck lintRelease testDebugUnitTest assembleDebug
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Submit Google OAuth consent screen & CASA Tier 2 review using docs/OAUTH-VERIFICATION.md, register the multi-tenant Microsoft Entra app, and set the QUIZRADAR_MICROSOFT_CLIENT_ID GitHub Actions variable.
