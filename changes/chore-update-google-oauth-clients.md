---
bump: patch
surfaces: [desktop, android, web, docs, ci]
agent: Antigravity
branch: chore/update-google-oauth-clients
date: 2026-11-22
---

### Summary

Rotate bundled Google OAuth client IDs to project quizradar-511922 across Desktop, Android, Web/PWA, and docs/OAUTH-VERIFICATION.md, and move the Desktop Google client secret out of git into build-time injection from GitHub Actions secret QUIZRADAR_GOOGLE_CLIENT_SECRET.

### Verification

- cargo fmt --all --check
- cargo test --locked -p quizradar-desktop --lib state::tests
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Submit Google OAuth consent screen & CASA Tier 2 review for project quizradar-511922.
