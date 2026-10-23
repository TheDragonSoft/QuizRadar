# Phase 05 — Core: source fetchers + sync orchestrator

> After phase 04. The scanning radar — real OAuth-token-consuming fetchers, all honest.

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §4.2; `docs/rebuild/02-current-architecture.md` §5.1–§5.5 + §5.8 (exact endpoints/queries/semantics) and §6 (AI gating contract); `docs/rebuild/03-issues-and-pain-points.md` §B3 (progress honesty), §B5 (scope registry), §A3–A5 (never fabricate on unconfigured sources).

**Reference implementation:** `git show v4-final:src/gmail.rs` (5 queries, dedupe, refresh cap, MIME walk), `git show v4-final:src/teams.rs` (Graph paging, refresh-token rotation, honest heuristic fallback), `git show v4-final:src/moodle.rs`, `git show v4-final:src/classroom.rs`, `git show v4-final:src/feeds.rs`, and the JS engine's live scanners `git show v4-final:static/app.js` (`runLiveScan`, `mergeScannedAssessments` — merge-preserves-user-fields rule source of truth).

## Build

1. `core/src/auth/providers.rs` — **declarative scope registry**: per provider (Google, Microsoft) the exact scope lists per capability (`gmail.readonly`, `calendar.events`, `drive.appdata`, `classroom.coursework.students`…; MS: `offline_access User.Read Mail.Read Calendars.Read`) + PKCE URL builders taking a `redirect` parameter (loopback / custom scheme / web origin). Google: `accounts.google.com/o/oauth2/v2/auth` + token `oauth2.googleapis.com/token`; MS: `login.microsoftonline.com/common/oauth2/v2.0/authorize|token`. **No client_secret types exist in code (no fields, no functions).** Unit tests assert single-use state handling + scopes present for classroom capability.
2. `core/src/sources/gmail.rs` — port the five queries verbatim; newest-first ids; skip-cached with refresh cap; MIME walk (plain → HTML-strip) with **no 4,500-char body truncation loss: cap 30_000 chars but record `body_truncated: true` flag** (fixes `03` C3); returns `FetchedEmail` list + per-source run stats.
3. `core/src/sources/teams.rs` — Graph: `/me`, `/me/joinedTeams`, per-team channels→tabs→drive one level→conversations (paged ≤10, bounded concurrency 4); token refresh honored via `TokenProvider` trait the platform supplies; heuristic fallback = courses-only with noise filter; **AI-discovery lives behind an injected hook** (phase 06 wires it).
4. `core/src/sources/moodle.rs` + `core/src/sources/feeds.rs` — iCal path via `parse::ics`, REST path via webservice endpoints; https-only enforcement; feeds: ids `feed-*`, user-provided label as source name, ≤10, dedupe by URL.
5. `core/src/sources/classroom.rs` — courses+courseWork, due-date-gated, **using the classroom scopes from the registry** (fixes B5).
6. `core/src/sources/sync.rs` — orchestrator `run_sync(config, schedule, emails_cache, ai?, progress_cb)`: runs enabled sources concurrently (bounded), feeds each Gmail result through `parse::email`, feeds/Teams/Moodle/Classroom through type mapping (same parsers), **reports real per-source progress** (`SourceProgress { name, stage, found, done }` via callback — the UI's scan overlay consumes this; no staged fiction, `03` §B3), merges via `parse::merge` preserving user fields, returns `SyncReport { per_source: Vec<SourceRun>, total_new, total_updated, notes[] }` where notes are truthful (e.g., "Moodle: not configured — skipped").
7. Email cache table reuse from phase 04 (`tokens_meta` never stores tokens—platform side stores tokens; core only receives bearer strings per call).

## Acceptance
- [ ] Fixture-level tests: with recorded HTTP fixtures (`wiremock` or `httpmock`) for Gmail search+fetch, Graph teams happy+empty, moodle ics+rest, feed parsing — each source's happy + not-configured + error paths honest (empty ≠ success-theatre)
- [ ] `run_sync` with zero enabled sources returns truthful "0 found, nothing configured" report — tested
- [ ] Scope registry tests prove classroom scopes present in URL build
- [ ] No `unwrap()` on network paths; clippy/fmt clean; STATUS updated

## Commit
`phase(5): core source fetchers + honest sync orchestrator`
