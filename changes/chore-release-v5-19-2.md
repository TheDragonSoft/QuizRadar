---
bump: patch
surfaces: [web, desktop, android, tooling, docs]
agent: zcode
branch: chore/release-v5-19-2
date: 2026-11-20
---

### Summary

Harden performance CI harnesses: retry Android ADB device-offline transients and time desktop native IPC as an in-page median of five round trips to remove automation jitter; document both measurement details.

### Verification

- pnpm lint
- pnpm --dir . exec prettier --check performance/android/sample.mjs performance/desktop/sample.mjs docs/PERFORMANCE-TESTING.md
- node --check performance/android/sample.mjs
- node --check performance/desktop/sample.mjs

### Handoff / Follow-ups

- Watch the first live Android rerun with retry and desktop median IPC after this fragment lands
- adjust thresholds only with measured evidence.
