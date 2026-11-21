---
bump: none
surfaces: [ci, docs]
agent: zcode
branch: ci/version-bump-release-pr-fallback
date: 2026-11-21
---

### Summary

Make the version-bump rollup self-healing: when the direct push to main is rejected by branch protection (GH006, every post-merge rollup since required checks landed), push the rollup commit to chore/release-rollup-v<next> and open a release PR instead of failing the run - the reviewed release-PR path is already proven (v5.19.2 via #47, v5.20.0 via #49). No tag is created in that path (the rollup commit is not on main yet); the following post-merge run tags it. Also record the Node 22 toolchain floor in AGENTS.md §5 (Astro 7 requires >= 22.23.4; enforced by engines and CI pins since #45).

### Verification

- Reviewed the fallback branch against the observed GH006 failures (runs 44816615548, 44822798723, 44833948530)
- gh pr create uses the workflow's GITHUB_TOKEN with pull-requests: write already granted

### Handoff / Follow-ups

- Release PRs created by the fallback still need a maintainer merge (required checks + protection)
- consider whether bypassing protection for github-actions[bot] is preferable later
