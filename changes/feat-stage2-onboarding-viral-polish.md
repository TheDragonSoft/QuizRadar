---
bump: minor
surfaces: [web]
agent: Antigravity
branch: feat/stage2-onboarding-viral-polish
date: 2026-11-22
---

### Summary

Stage 2 PR 4: Day-1 onboarding progressive disclosure (collapsing advanced Moodle portal/iCal URLs under a disclosure section) and post-enrollment 1-tap Course Pack viral share prompt in Onboarding Step 3.

### Verification

- prettier --check
- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- Run 10-student over-the-shoulder onboarding test and seed 5 real university class group chats with Course Pack links.
