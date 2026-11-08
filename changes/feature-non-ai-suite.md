---
bump: minor
surfaces: [web, tooling, docs]
agent: antigravity
branch: feature/non-ai-suite
date: 2026-11-08
---

### Summary

Unify NextUp and TimelineHorizon upcoming pipelines, implement adaptive parallax canopy collapse, widescreen study deck de-duplication, academic timeline jargon calibration, and toast concurrency cap with auto-dismiss

### Verification

- pnpm --filter @quizradar/web typecheck
- pnpm --dir apps/web test
- playwright test capture-showcase.spec.ts

### Handoff / Follow-ups

- All 39 web test suites (328/328 tests) passing
- visual evidence verified in screenshots and critique artifact
