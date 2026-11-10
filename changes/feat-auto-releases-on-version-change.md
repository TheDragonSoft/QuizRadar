---
bump: minor
surfaces: [ci, tooling]
agent: antigravity
branch: feat/automated-version-releases
date: 2026-11-10
---

### Summary

Automate GitHub Releases on version changes: wire version-bump.yml to automatically tag and invoke release.yml reusable pipeline whenever SemVer bumps occur or untagged versions exist on main, add workflow_call support and ref checkout to release.yml, and add --tag flag to version-rollup.mjs

### Verification

- pnpm test:tooling
- node tooling/agent-gate.mjs --hook pre-commit

### Handoff / Follow-ups

- Whenever merges or pushes to main bump the version or introduce untagged versions, GitHub Releases (desktop, android, PWA) will be automatically published
