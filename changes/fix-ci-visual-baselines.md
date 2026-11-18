---
bump: none
surfaces: [ci, web]
agent: antigravity
branch: fix/ci-visual-baselines
date: 2026-11-17
---

### Summary

Refresh stale Playwright visual baselines in apps/web/e2e-baselines/ and upload visual diff artifacts on failure in .github/workflows/ci.yml.

### Verification

- Verified via GitHub Actions browser (visual baselines, non-blocking) job.

### Handoff / Follow-ups

- None
