---
bump: patch
surfaces: [tooling, ci]
agent: zcode
branch: dependabot/npm_and_yarn/astro-7.4.7
date: 2026-11-20
---

### Summary

Astro 7 requires Node >=22.23.4; bump every setup-node pin (ci, pages, performance, pr-ui-screenshots, release, version-bump) from 20 to 22 and root engines to >=22.23.4 so the dependabot astro 5.18.2 -> 7.4.7 upgrade passes typecheck. Landing verified locally on astro 7: astro sync + tsc clean, 8/8 vitest, static build complete.

### Verification

- pnpm -C <worktree> install --frozen-lockfile
- pnpm --filter @quizradar/landing typecheck
- pnpm --filter @quizradar/landing test
- pnpm --filter @quizradar/landing build

### Handoff / Follow-ups

- AGENTS.md §5 still says Node 20+ - maintainer should update the toolchain line
- watch first CI run on node 22 including performance thresholds calibrated on node 20
