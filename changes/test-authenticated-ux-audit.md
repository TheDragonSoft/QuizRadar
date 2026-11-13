---
bump: patch
surfaces: [web, tooling]
agent: zcode
branch: test/authenticated-ux-audit
date: 2026-11-13
---

### Summary

Authenticated UX sweep harness: the app is now served from http://localhost:4317, the one origin both OAuth providers accept, so the signed-in run needs no Azure app registration and no secret. The harness binds Vite to the IPv4 loopback literal and maps the Chromium localhost name to it, so the origin the providers validate stays http://localhost:4317 while the socket reaches the bound address, and it records that origin in the evidence bundle. The public Google and Microsoft client ids are written through the app own Settings form before sign-in. Measured live against the real endpoints: Google GIS accepts the bundled client id at http://127.0.0.1:4317 only and answers Error 400: origin_mismatch at localhost, while an older public client id accepts both; the Microsoft v2 endpoint accepts the desktop shell bundled public Graph CLI client id at http://localhost:PORT/ exactly and rejects 127.0.0.1 (AADSTS50011) and any sub-path. Sign-in failure details now name where the popup had reached, reduced to its origin and path, so a dismissed or stalled popup is diagnosable from the evidence bundle without leaking an OAuth code, a token or a session identifier. Also corrects two false Settings and copy promises about a bundled Microsoft client that the browser tier does not have, plus the stale origin comment in browserSources.ts. Merged main into the branch and repaired two release-pipeline defects the merge exposed: the version rollup wrote a CHANGELOG whose fragment bullets were not Prettier clean, so the release bot broke the repo own format gate, and the tracked service worker was left stamped 5.10.0 by the v5.11.0 bump, which failed the PWA precache test.

### Verification

- node tooling/generate-version.mjs --check, all 5 sinks in sync at 5.11.0
- node apps/web/src/contract/regenerate.mjs --check, wire map fresh
- pnpm --dir apps/web build:wasm
- pnpm --dir apps/web build:sw
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm test, 44 web test files and 8 landing tests and 40 desktop Rust tests passed with 0 failed
- pnpm agent:note --validate
- node --check on all four authed harness modules
- pnpm e2e:authed -- --skip-signin --headless --surfaces dashboard --out e2e-results/authed/verify-localhost, origin http://localhost:4317, 11 surfaces captured, exit 0
- pnpm e2e:authed -- --out e2e-results/authed/signed-in, origin http://localhost:4317, both client ids written to Settings, both popups reported as closed
- pnpm e2e:authed -- --out e2e-results/authed/signed-in-2, origin http://localhost:4317, the Google popup reached the Google account chooser and waited out the 10 minute timeout while Microsoft hit the app own 5 minute popup timeout, so neither provider rejected the origin or the client id, 18 surfaces captured
- a headful reproduction through the harness own signInWithGoogle helper left the Google popup open at the account chooser for 60 seconds with no error, proving the flow waits for the human
- credential-free live origin probes against accounts.google.com and login.microsoftonline.com, Google rejected the bundled id at localhost with origin_mismatch and accepted it at 127.0.0.1, accepted the older id at both and rejected a bogus id as invalid_client, Microsoft redirected back for localhost:4317/ and localhost:55555/ in fragment and query mode and never for 127.0.0.1:4317/ or localhost:4317/callback

### Handoff / Follow-ups

- The signed-in evidence bundle does NOT exist yet: both signed-in runs reached the provider popups at http://localhost:4317 with the client ids accepted, but no human completed the Google account chooser or the Microsoft login, so both bundles cover the signed-out app. The next run needs the human present: Google gets 10 minutes, Microsoft only 5 because the app caps its own popup wait. The stage-2 AI audit over the signed-out dry run is finished and published as the ux-audit artifact, 11 of 12 findings confirmed, and the same workflow has to be re-run over the real signed-in bundle once it exists. The harness types into two Settings fields, the Google and the Microsoft client id, both public identifiers and never secrets. One release-pipeline gap remains open: tooling/version-rollup.mjs does not restamp the tracked service worker, so every future bot bump will leave apps/web/public/sw.js stale and fail the PWA precache test until the rollup learns to call tooling/build-sw.mjs. Carried over: apps/web/playwright.config.ts still has the latent Windows IPv6-loopback bind issue, a possible --no-identity-surfaces opt-out, and the desktop shell real Gmail and Teams scanning is unverified by this harness because the web tier Sync only reads public ics feeds.
