---
bump: none
surfaces: [web, tooling]
agent: zcode
branch: dependabot/npm_and_yarn/vitest-4.1.11
date: 2026-11-21
---

### Summary

Complete the vitest 4.1.11 migration on top of the dependabot bump: vitest 4 removed coverage.all (untested files are now always included, which is what all: true asked for) and pool/poolOptions (defaults are the equivalent worker-thread, per-file-isolated, parallel configuration) - both blocks replaced in apps/web/vite.config.ts with explanatory comments. Verified locally under vitest 4: apps/web suite 49 files / 458 tests green, tooling meta-tests 5 files / 45 tests green, landing 8 tests green, web typecheck (app + node configs) clean, prettier clean.

### Verification

- pnpm --filter @quizradar/web typecheck (after build:wasm)
- pnpm --dir apps/web test
- pnpm test:tooling
- pnpm --filter @quizradar/landing test
- pnpm lint
- prettier --check apps/web/vite.config.ts

### Handoff / Follow-ups

- Watch the CI rerun: the earlier android lane failure on this PR predates the vitest change and may be the same emulator/runner transient seen on #49
- coverage ratchet numbers should be unchanged since coverage.all semantics are preserved by the vitest 4 default
