---
bump: none
surfaces: [tooling, web, ci]
agent: opencode
branch: fix/meta-test-eviction
date: 2026-11-10
---

### Summary

Move the meta-tests (agentCoordination.test.ts, versionPipeline.test.ts) out of apps/web/src into tooling/__tests__ with a dedicated node-env vitest config wired as root pnpm test:tooling plus a CI web-job step; versionPipeline no longer imports the web app and asserts the generated version.ts file directly. Fixes the recurring 70s vitest-worker timeout that failed every full pnpm test run; web suite drops to ~34s. No behavior or application code changed.

### Verification

- pnpm test:tooling (16 passed)
- pnpm test (web 330 passed, desktop 11 passed)
- pnpm typecheck clean
- pnpm lint 0 errors (6 pre-existing warnings)
- prettier --check clean on touched files. NOTE: prettier --check repo-wide is already red on main from 23 pre-existing files (FocusView.tsx, components/*, e2e specs, .impeccable critiques, CHANGELOG.md, PROJECT.md) — not touched here.

### Handoff / Follow-ups

- The pre-existing repo-wide prettier redness must be fixed by the owners of those 23 files (or a dedicated format pass). tooling vitest lane runs as its own CI step
- pnpm install performed (lockfile unchanged in package set).
