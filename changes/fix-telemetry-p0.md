---
bump: minor
surfaces: [core, web, android]
agent: antigravity
branch: fix/telemetry-p0
date: 2026-11-09
---

### Summary

Remove external telemetry across Web & Android to uphold local-first privacy doctrine; implement interval union cushion merging and 0-min untimed honesty doctrine; dynamic GPA scale ceilings and mixed weighting non-drop behavior; Android bi-weekly timetable parity and case-insensitive What-If calculation.

### Verification

- cargo test -p quizradar-core --tests (368 passed, 0 failed, 1 ignored)
- cargo clippy -p quizradar-core --all-targets -- -D warnings (0 warnings)
- pnpm test in apps/web (39 test files passed, 332 passed)
- pnpm typecheck (web & landing passed)
- cd apps/mobile-android; .\gradlew ktlintCheck testDebugUnitTest (BUILD SUCCESSFUL)
- node tooling/generate-version.mjs --check (all 5 sinks in sync)
- node tooling/agent-gate.mjs --ci (all hygiene, commit, and version checks passed)

### Handoff / Follow-ups

- All core logic, TS web mirrors, and Android parity fixes verified and clean across all test suites.
