---
bump: none
surfaces: [ci]
agent: zcode
branch: ci/version-bump-tag-identity
date: 2026-11-20
---

### Summary

Fix the tag-only rollup path in version-bump.yml: the 'Tag unreleased version' step creates an annotated tag without configuring a git identity, so any push to main that needs tagging but carries no pending fragment work (exactly the state after merging a release PR) fails with git exit 128 'empty ident name' - observed on the post-#49 run 44840466884. Configure the github-actions[bot] identity in that step. Note: v5.20.0 was tagged manually at e6e0f65 to unblock the release pipeline, so this fix prevents recurrence only. Separate open question for the maintainer: the direct-push rollup path ('Commit, tag & push release rollup to main') is rejected by branch protection (GH006) on every run - either allow a github-actions[bot] bypass or change the step to open a release PR.

### Verification

- node tooling/version-rollup.mjs --dry-run --json (hasWork=false expected on main)
- reviewed step diff against the sibling commit step's identity config

### Handoff / Follow-ups

- Decide the direct-push vs release-PR strategy for the rollup commit path
- consider dependabot alert follow-ups (zip rust crate has no upstream patch for 2 criticals, tinypool clearable via PR #48 vitest 4)
