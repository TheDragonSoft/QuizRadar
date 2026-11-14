---
bump: patch
surfaces: [web, android, tooling]
agent: zcode
branch: chore/workbench-polish
date: 2026-11-14
---

### Summary

Workbench polish + the before/after UI-change workflow. (1) tooling/capture-workbench.mjs: committed capture tool (was a throwaway) - discovers every story from Ladle's generated module, captures desktop + full theme matrix on the views + 390x844 phone pass, writes <dir>/manifest.json; usage: node tooling/capture-workbench.mjs target/ui-before (before a UI change) and target/ui-after (after). (2) tooling/ui-compare.mjs: generates target/ui-compare/index.html pairing before/after shots side by side with synced scrolling, amber borders on shared screens, NEW/REMOVED badges. (3) AGENTS.md (web + android): the workflow is now documented so every agent produces a before/after diff for the maintainer around any UI change (android flow: copy public/android-ui to target/ui-before, re-run AndroidUiCaptureTest, compare). (4) Slug polish: Views/Study Roadmap (Tasks) and Views/Week Calendar renamed to Views/Tasks and Views/Calendar (the parenthesized titles produced ugly --- slugs). Capture verified live: 99 stories, 161 shots, 0 page errors; compare page generated 161 pairs.

### Verification

- node tooling/capture-workbench.mjs target/ui-before (161 shots, 0 errors)
- node tooling/ui-compare.mjs target/ui-before target/ui-before (161 pairs)
- pnpm lint
- pnpm --dir apps/web exec tsc --noEmit -p tsconfig.json
- gradlew.bat ktlintCheck

### Handoff / Follow-ups

- The compare tool pairs by filename - keep capture dirs stable across a change (same branch state except the UI edit). Pixel-diff is intentionally not implemented: sizes are the cheap change hint, the human eye decides from the side-by-side page. The other concurrent agent's untracked files (AuditRenderHarness.kt, capture-audit-sweep.spec.ts, audit-capture/) were left untouched.
