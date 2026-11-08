---
bump: minor
surfaces: [tooling, ci, docs, web]
agent: antigravity
branch: agent_version_control
date: 2026-11-08
---

### Summary

Add conflict-free multi-agent handoff fragments (changes/*.md), worktree conflict-radar preflight CLI, local git hooks + CI hygiene gates, tag-aware changelog generation, slimmed STATUS.md (with 2,088-line v5.0 log archived), and automatic GitHub Actions SemVer rollup on merge to main

### Verification

- pnpm exec prettier --check .github CLAUDE.md CONTRIBUTING.md package.json changes tooling apps/web/src/agentCoordination.test.ts
- pnpm exec eslint tooling apps/web/src/agentCoordination.test.ts
- pnpm typecheck
- pnpm --dir apps/web exec vitest run src/agentCoordination.test.ts src/versionPipeline.test.ts
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Sibling branches (such as app_landing_page) should run 'pnpm agent:note' before merging to main
- Note: upstream main commits 1a8e170..e174ff1 left 13 pre-existing ESLint errors and unformatted files in apps/web/ that need a dedicated web-lint cleanup pass.
