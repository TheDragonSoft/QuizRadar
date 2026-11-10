---
bump: patch
surfaces: [web, tooling, docs]
agent: opencode
branch: chore/web-test-velocity
date: 2026-11-10
---

### Summary

Speed up the web test loop and purge disposable tooling: WASM staleness now accounts for tooling/version.json, apps/web test scripts no longer build WASM/SW, Vitest runs on the threads pool with per-file isolation (330 tests in ~19s vs the previous ~85s with 15 failures), and the redundant view/store wrapper modules plus the one-off ui-sweep/build-ui-review harnesses are removed.

### Verification

- pnpm --dir apps/web test (39 files / 330 tests passed, 19.2s vitest duration, 21.4s wall)
- pnpm test (web 330 + landing 8 + desktop 40 Rust tests passed)
- pnpm --dir apps/web typecheck
- pnpm typecheck
- pnpm lint (0 errors, 6 pre-existing react-refresh warnings)
- node tooling/generate-version.mjs --check
- pnpm --dir apps/web build:wasm

### Handoff / Follow-ups

- `pnpm format:check` still fails on 31 pre-existing files; none of them were introduced by this change (`apps/web/e2e/week-calendar.spec.ts` was already unformatted at HEAD). Reformatting them is out of scope for this branch.
- The Vitest pool uses `isolate: true`, not the `isolate: false` originally requested: a shared module registry leaked module-level mocks between files (e.g. `googleLogin` from the Chrome flow tests into the auth tests) and left RTL's `screen` bound to a stale document, costing ~67 s instead of ~20 s and requiring `setup.ts` workarounds.
