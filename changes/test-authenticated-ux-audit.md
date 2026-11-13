---
bump: patch
surfaces: [web]
agent: zcode
branch: test/authenticated-ux-audit
date: 2026-11-13
---

### Summary

Authenticated UX sweep harness: the app is now served from http://localhost:4317, the one origin both OAuth providers accept, so the signed-in run needs no Azure app registration and no secret. The harness binds Vite to the IPv4 loopback literal and maps the Chromium localhost name to it, so the origin the providers validate stays http://localhost:4317 while the socket reaches the bound address, and it records that origin in the evidence bundle. The public Google and Microsoft client ids are written through the app own Settings form before sign-in. Measured live against the real endpoints: Google GIS accepts the bundled client id at http://127.0.0.1:4317 only and answers Error 400: origin_mismatch at localhost, while an older public client id accepts both; the Microsoft v2 endpoint accepts the desktop shell bundled public Graph CLI client id at http://localhost:PORT/ exactly and rejects 127.0.0.1 (AADSTS50011) and any sub-path. Also corrects two false Settings and copy promises about a bundled Microsoft client that the browser tier does not have, plus the stale origin comment in browserSources.ts.

### Verification

- node tooling/generate-version.mjs --check
- pnpm --dir apps/web build:wasm
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm test, 44 web test files and 8 landing tests and 40 desktop Rust tests passed with 0 failed
- pnpm e2e:authed -- --skip-signin --headless --surfaces dashboard --out e2e-results/authed/verify-localhost, origin http://localhost:4317, 11 surfaces captured, exit 0
- credential-free live origin probes against accounts.google.com and login.microsoftonline.com, Google rejected the bundled id at localhost with origin_mismatch and accepted it at 127.0.0.1, accepted the older id at both and rejected a bogus id as invalid_client, Microsoft redirected back for localhost:4317/ and localhost:55555/ in fragment and query mode and never for 127.0.0.1:4317/ or localhost:4317/callback

### Handoff / Follow-ups

- The signed-in run still needs a human: complete the Google GIS popup, the Microsoft PKCE popup and the mail and calendar consent in the browser windows. The signed-in evidence bundle is the input for the stage-2 AI audit, whose dry run over the signed-out smoke evidence is still confirming its findings. The harness now types into two Settings fields, the Google and the Microsoft client id, both public identifiers and never secrets. Carried over: apps/web/playwright.config.ts still has the latent Windows IPv6-loopback bind issue, a possible --no-identity-surfaces opt-out, and the desktop shell real Gmail and Teams scanning is unverified by this harness because the web tier Sync only reads public ics feeds. This branch is 3 commits behind main and was not rebased. Nothing was pushed to origin.
