---
bump: minor
surfaces: [web, tooling, docs]
agent: Antigravity
branch: feat/stage2-privacy-diagnostics
date: 2026-11-22
---

### Summary

Stage 2 PR 2: First-party zero-PII diagnostics Cloudflare Worker (workers/diagnostics-relay), opt-out client funnel + sanitized crash reporter (apps/web/src/lib/diagnostics.ts), Settings toggle, 2026-11-22 AGENTS.md override, and PRIVACY.md disclosure.

### Verification

- prettier --check
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Deploy workers/diagnostics-relay to Cloudflare account with DIAGNOSTICS_KV namespace.
