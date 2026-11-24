---
bump: none
surfaces: [docs, tooling, web]
agent: antigravity
branch: feat/landing-academic-editorial
date: 2026-11-24
---

### Summary

Purge bloated/outdated docs (pre-purge state archived at git tag docs-pre-purge-2026-11), rebuild into a 4-tier documentation system (slim root entrypoints, 9 allowlisted evergreen docs, immutable ADRs in docs/adr/, automated changes/ worklog), add Forgejo-first Git/CI workflow, and enforce doc allowlist, ADR naming, and per-doc line budgets in tooling/agent-gate.mjs.

### Verification

- node tooling/agent-gate.mjs --hook pre-commit
- pnpm test:tooling
- pnpm --dir apps/web vitest run src/copy/conformance.test.ts
- pnpm exec prettier --check
- pnpm exec eslint

### Handoff / Follow-ups

- Commit/push docs-4tier-rebuild changes (and tag docs-pre-purge-2026-11) to origin (Forgejo) when ready
- in-progress apps/landing working-tree edits were left untouched.
