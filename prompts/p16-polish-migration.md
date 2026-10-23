# Phase 16 — Migration UX + docs honesty pass + v1.0 cut

> After phase 15. The pre-flight before showing the app to any real user. Mostly review, small fixes, big truth-telling.

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §2 journeys + §8 checklist (FULL audit); `docs/rebuild/03-issues-and-pain-points.md` (the anti-checklist: verify none of its ❌/HIGH items reappeared); `docs/rebuild/05-ai-features-plan.md` §5 (consent copy presence audit).

## Build

1. **v4 data migration UX**: a first-run "Coming from v4?" card on every shell reading the v4 backup JSON (path or file-pick on desktop/mobile; file-pick on PWA) → core importer (phase 04) → success/close summary with honest counts. Never silently auto-migrate (user confirms).
2. **Docs honesty pass**:
   - New `README.md` written from zero against the v5 reality: claims audited against `01` §8 checked items (every link must exist, version badges generated, no "Coming soon" fakery, platform matrix honest about PWA limits per `04` §0).
   - `docs/architecture-v5.md` (public-facing brief) derived mechanically from dossier `04` — no claims unbacked by code.
   - LICENSE (choose with maintainer input — default MIT), CONTRIBUTING.md brief, SECURITY.md (how to report; wallet none), privacy statement: data-locality statement enforced + AI disclosure line.
3. **Dogfood checklist matrix** executed by the maintainer or agent stubs: desktop first-run journey A, android journey B, pwa journey C — from `01` §2 — each step recorded pass/fail in `docs/STATUS.md` §Dogfood-notes with fixes applied for fails (small scope only; anything big goes to a new phase prompt in `prompts/` marked `p17-*`).
4. **Final grooming**: dependency audit (`cargo udeps` optional), bundle size check (web <900 KB gzip exclusional, core <4 MB), APK <25 MB, startup <2 s desktop; all findings honest in STATUS.
5. **Cut v5.0.0** via phase 15 pipeline; verify updater + PWA + APK from the actual release; freeze; announce plan-diff to maintainer.

## Acceptance
- [ ] Every `01` §8 checklist item ✅ in STATUS (or explicitly descoped with maintainer sign-off note)
- [ ] `03` ❌ items re-audited absent (grep the equivalent shadows: "Hall B-204", demo palettes, auto_sync true default, teams_token in clouds, classroom 403 apology path, 4.5k body truncation etc.)
- [ ] README/PRIVACY/SECURITY exist + truthful; LICENSE decided
- [ ] v5.0.0 released; updater flow works on desktop; PWA installable; APK signed-installable
- [ ] STATUS: v5.0.0 shipped note + lessons + next-phase candidates (settings deepening, further LMS, etc.)

## Commit
`phase(16): migration UX + docs honesty pass + v1.0 cut`
