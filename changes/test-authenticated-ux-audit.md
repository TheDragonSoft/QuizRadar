---
bump: patch
surfaces: [web, docs]
agent: zcode
branch: test/authenticated-ux-audit
date: 2026-11-12
---

### Summary

Adds the authenticated UX sweep harness: a local, manual (never CI) Playwright runner at apps/web/e2e/authed that signs the user in with their own Google and Microsoft accounts in a real Chromium window, triggers the app's Sync button, then walks every reachable web-tier surface (views, discoverable modals, dark variant, narrow-viewport variants) and captures per surface a full-page screenshot, a DOM outline (roles, names, test ids, disabled state, aria - never input values), an axe-core scan, console problems and the app's own toasts; evidence lands under gitignored apps/web/e2e-results/authed/ as report.json, summary.md, screenshots, dom, axe and console.txt. The crawler is allowlist-driven with a destructive-control blocklist (including role=switch/checkbox/radio controls), never types (one documented exception: the Azure client id when --teams-client-id is passed), never reloads after sign-in (web-tier tokens are memory-only), refuses to run when CI is set, and its report carries explicit honesty statements including that the web tier's Sync only fetches public .ics feeds. Adds e2e:authed scripts to both package.json files, a README runbook and a TESTING-PLAYBOOK section.

### Verification

- node tooling/generate-version.mjs --check
- pnpm format:check
- pnpm exec eslint . --max-warnings 0
- pnpm typecheck
- pnpm test (web 424 + landing 8 + desktop 40)
- node apps/web/e2e/authed/run-authed-sweep.mjs --skip-signin --headless (exit 0, 18 surfaces captured, 22 axe findings recorded)
- independent reviewer pass with 16 findings, all P0 and P1 items addressed

### Handoff / Follow-ups

- The signed-in run needs a human: complete the Google GIS popup and the Microsoft PKCE popup
- supply an Azure SPA client id via --teams-client-id (public id, no secret) for Teams. In the web tier the Sync button only fetches public .ics feeds - the desktop shell is the tier that scans Gmail/Teams mail, so a signed-in web sweep proves UI state, not mail scanning. Signed-in screenshots contain the user's own name and email - the evidence folder is gitignored personal data on the machine. Known follow-up: apps/web/playwright.config.ts has the same latent Windows IPv6-loopback issue (Vite binds ::1 unless --host is passed) - out of scope here. Possible follow-up: a --no-identity-surfaces opt-out that skips settings-account and the account modal for users who do not want identity data in screenshots.
