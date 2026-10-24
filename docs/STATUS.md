# STATUS — QuizRadar v5 rebuild tracker

_Agents update this file after every phase. Prompts are defined in `prompts/README.md`._

## Phases

- [x] 01 scaffold-monorepo (`prompts/p01-scaffold-monorepo.md`) — shipped: Rust workspace (`core` + Tauri shell), pnpm root scripts, React 19/Vite/Tailwind 3 web skeleton, Android Compose skeleton, version generator + 5 stamped sinks, PR CI (3 jobs), lint/test gates everywhere green.
- [x] 02 core: types + email/ICS parsing + fixtures (`prompts/p02-core-types-parse.md`) — shipped: serde types (`core/src/types.rs` incl. `ScheduleData`/`Course`/`ScheduleSlot`/`CachedEmail`/`Assessment` with honest `None` semantics + v4-compatible serde adapters), announcement email parser (`core/src/parse/email.rs`, hand-written char scanners — no regex dependency in core), ICS parser (`core/src/parse/ics.rs`, Moodle + generic feeds with `IcsOrigin`, RFC 5545 unfolding/VALARM-skip/TEXT-unescape, UTC conversion through caller-provided `FixedOffset`), shared dedupe key (`core/src/parse/merge.rs`) and pure helpers (`core/src/parse/util.rs`: urgency/priority ladders, 12h formatting, semester inference). Golden fixtures: 11 email cases + 2 ICS files × 3 runs (`core/tests/fixtures/`, harnesses `email_fixtures.rs` + `ics_fixtures.rs` with ignored dumper). 55 lib unit tests + 9 fixture/smoke tests green; clippy/fmt clean.
- [x] 03 core: plan/derive (dashboard, tasks, conflicts, study blocks) (`prompts/p03-core-plan-derive.md`) — shipped: pure, UI-agnostic derivation modules in `core/src/plan/` with the reference date always injected (no wall clock in core): `dashboard.rs` (`build_dashboard_summary` → `next_up`/`all_upcoming`/`upcoming_this_week` with v4's 0–7 day inclusive window, radar ordering, urgency badges TODAY/TOMORROW/IN n DAYS/PAST, `readiness_percent` 0/0→100, `why_study_now` copy ladder, `StudyRecommendation`, `refresh_assessment` shared by all derive modules); `tasks.rs` (`build_study_tasks` → 14-day honest horizon, ≤5 prep-day round-robin topic distribution, per-topic hours = estimate/clamp(0.5–2.5)/topics with tenth rounding, per-day + payload totals `None` whenever any covered task lacks hours, `DailyStudyTask`/`ExamReadinessCard`/reasoning copy, priority recomputed per derive call, fallback topics for topicless assessments); `conflicts.rs` (`detect_conflicts`: same-day pair ⇒ critical gap 4h, adjacent-day ⇒ warning gap 26h, mitigated by `study-block-` events, message cites course+title only; `conflict_chips` on unmitigated alerts); `study_blocks.rs` (`study_block_candidates`: 90-min windows 08:00–21:30 evening-first, slot/custom-event overlap exclusion incl. whole-day dated events, `block_id_for`/`block_date_for`). Shared fixture helpers (`plan/fixtures.rs`, ref date 2026-10-23 Fri). 94 lib tests (39 new), 10 integration/smoke green; clippy `-D warnings` + fmt clean; `Utc::now|Local::now` grep in core clean (doc-comment mention only).
- [x] 04 core: store + migrations + v4 importer + Drive backup (data-only) (`prompts/p04-core-store-backup.md`) — shipped: `core/src/store/db.rs` (rusqlite bundled, WAL + 5s busy_timeout, `SCHEMA_VERSION 1` + `MIGRATIONS` apply-on-open, honest `SchemaTooNew` refusal, all unknowns NULL); `core/src/store/repo.rs` (typed repos `CourseRepo`/`AssessmentRepo`/`TopicRepo`/`GradeRepo`/`EventRepo`/`FeedRepo`/`ConfigRepo`/`MetaRepo` + transactional `ops` — every mutation returns `AppSnapshot` with pre-derived dashboard/tasks; grade partial-update Keep/Clear/Set with explicit-null-clears; reannouncement `replace_all` preserving user-owned fields by id then `merge_key`; topics true-only; feeds https-only + ≤10 cap; case-insensitive course upsert/delete; `slot-N` id assignment); async `Store` facade (`mod.rs`, tokio `spawn_blocking` + poison recovery); `importer.rs` (v4 backup JSON → one transaction, v4 restore guard `assessments[]`+`schedule.courses[]`, fuzzy `assessment_type` labels normalized with on-row warnings, v4 secret keys never enter the store and are reported in `ImportReport.secrets_ignored`, `auto_sync_gcal`/`gemini_enabled` forced off per honesty rules); `exporter.rs` (v4-shape local export, structurally secret-free); `backup.rs` (data-only `BackupPayload` — no token fields at the type level — per-record `RecordStamps` stamps, merge rules topics-additive/grades-upsert-fill/records-replace-if-newer/schedule-replace-if-newer, `REFUSE_TRUNCATE_BYTES = 8_000` + complete-JSON guard, `DriveBackupClient` ported from v4 `cloud_sync.rs` minus calendar fallback and `teams_token`). 130 lib tests (40 store: 5 db + 18 repo + 7 importer + 6 backup + 4 round-trip) + v4 fixture `core/tests/fixtures/v4_backup.json`; clippy `-D warnings` + fmt clean.
- [x] 05 core: source fetchers + honest sync orchestrator (`prompts/p05-core-sources-sync.md`) — shipped: `core/src/auth/providers.rs` (declarative scope registry — Google `GmailRead`/`UserProfile`/`CalendarEvents`/`DriveAppdata`/`ClassroomRead` [both classroom read scopes, structurally fixing `03` §B5] + MS `offline_access User.Read Mail.Read Calendars.Read`; PKCE authorize/token URL + form-param builders taking a `redirect` parameter with `RedirectTarget` classification loopback/web-origin/custom-scheme; `percent_encode` helper; zero client_secret types — tests assert), `core/src/auth/pkce.rs` (RFC 7636 S256 challenge with the Appendix-B vector test, random 256-bit state, `PendingStates` single-use 15-min registry with injected clock); `core/src/sources/gmail.rs` (5 v4 queries verbatim, newest-first ids, cross-query dedupe, skip-cached with `CACHED_REFRESH_LIMIT = 10`, 8-way bounded fetch with per-item progress pulses, MIME walk plain→HTML-strip reusing the shared sanitizer, body cap raised 4,500→**30,000 chars with `body_truncated: true`** recorded on `CachedEmail` (fixes `03` §C3), cache cap 500 id-desc); `core/src/sources/teams.rs` (Graph `/me` + `/me/joinedTeams` + channels→tabs→drive root+1 level→conversations, `@odata.nextLink` paging ≤10, bounded concurrency 4/3, 401→one silent-refresh retry via the platform-supplied `TokenProvider`, heuristic fallback = noise-filtered courses-only with deterministic preset palettes — never invented assessments — and `TeamsAiDiscovery` object-safe injected hook for phase 06); `core/src/sources/moodle.rs` (iCal + REST channels concurrent, https-enforced, REST events mapped onto the SHARED ICS honesty pipeline via `parse::ics::assessment_from_event`, cross-channel merge-key dedupe); `core/src/sources/feeds.rs` (https-only, ids `feed-*`, user label = source, ≤10 cap + URL dedupe with honest notes, `BEGIN:`-guard against login pages); `core/src/sources/classroom.rs` (courses+courseWork paged ≤10, due-date-gated, scopes consumed from the registry, honest mapping — no fabricated room/instructor/group/end-time); `core/src/sources/sync.rs` (`run_sync(config, input, ai?, progress_cb)` runs all five sources concurrently via `tokio::join!`, real `SourceProgress { name, stage, found, done }` pulses — no staged fiction per `03` §B3 — per-source `SourceRun { status: Ran|Skipped{reason}|Failed{error} }`, merge via `merge_preserving_user_fields` (v4 `mergeScannedAssessments` rule: achieved/max/weightage/gcal_synced/gcal_event_id preserved; honest added/updated/unchanged counts), truthful notes ("0 found — nothing configured"; every configured source failing is loud). 179 lib tests (49 new: 8 pkce/providers + 41 source fixtures with wiremock 0.6 recorded-HTTP fixtures for gmail search/fetch/truncation/refresh-cap/all-fail, Graph happy/empty/AI-hook/401, moodle ics+REST+errors+dedupe, feeds happy/non-ICS/dedupe/cap, classroom due-date-gating+403, and the zero-enabled-sources truthful report). clippy `-D warnings` + fmt clean.
- [ ] 06 core: GCal push + ICS export + BYOK AI provider layer
- [ ] 07 desktop: Tauri 2 shell + full IPC surface + keyring + PKCE loopback + updater state
- [ ] 08 web: UI foundation (tokens, chrome, modal stack, state layer)
- [ ] 09 web: dashboard/tasks/calendar views + assessment detail
- [ ] 10 web: flows (onboarding, settings, AI, search, backup, updater, practice)
- [ ] 11 PWA: wasm core + adapters + service worker + help parity page
- [ ] 12 android: scaffold + UniFFI core bindings + Compose skeleton
- [ ] 13 android: Compose UI parity (views + detail/pomodoro/practice)
- [ ] 14 android: native edge (PKCE custom-scheme OAuth, Glance widget, share ingest, notifications)
- [ ] 15 release pipeline (signed tauri updater, release APK/AAB, PWA deploy, notes)
- [ ] 16 migration UX + docs honesty pass + v1.0 cut

## Feature-parity checklist status

_Track against `docs/rebuild/01-product-spec.md` §8. Tick items only with a CITATION to the §4/§5 item implemented + the commit hash._

- [x] Parse announcement emails → quizzes/exams/assignments with course matching (`01` §4.1 / `02` §3.2): `core/src/parse/email.rs` — placeholder commit this phase (`phase(2): core types + email/ics parsing with golden fixtures`).
- [x] Moodle/ICS calendar feed parsing with week/time inference (`01` §4.2 / `02` §3.2): `core/src/parse/ics.rs` (structural parse + course/slot matching + honesty notes; the *fetch* layer itself is phase 05).
- [x] No-fabrication honesty rules for parsed items (`01` §5 honesty): missing room/time renders "—", undated drafts stay dateless, wrong/missing course matching falls back course-less, notes always label estimates ("Estimated (local heuristic):…") — enforced through unit + fixture tests.
- [x] Dedupe/stable ids across sources (`02` §3.3/merge): `core/src/parse/merge.rs` normalized merge key + `moodle-`/`feed-`/uid-hash id scheme (cross-scan field merge deferred to phase 04 store, see phase-03 divergence log).
- [x] Dashboard v1: radar, next-up, urgency badges, readiness, weekly window (`01` §4.3): `core/src/plan/dashboard.rs::build_dashboard_summary` (phase(3) commit `fad67b5`) — DASHBOARD KPIs derived data-only, no demo palettes/plans, missing rooms render as absent (`None` → shell shows "—").
- [x] Study tasks + readiness cards per assessment (`01` §4.4): `core/src/plan/tasks.rs::build_study_tasks` (commit `fad67b5`) — deterministic round-robin roadmap over ≤5 prep days, honest hours (estimate/type heuristic arrives with store phase 04), reasoning labeled by days-out, day-1 crunch sanity.
- [x] 48h schedule-conflict detection + study-block mitigation (`03` §C6 / `02` §3 APIs): `core/src/plan/conflicts.rs::detect_conflicts` + `conflict_chips` (commit `fad67b5`) — critical/warning severities with documented 4h/26h gaps, `study-block-{id}` clearing, examiner/room-involved conflicts stay unported (would need instructor/venue evidence).
- [x] Smart study-block suggestions (`01` §5 honest auxiliary): `core/src/plan/study_blocks.rs::study_block_candidates` (commit `fad67b5`) — 90-min evening-first windows around exam day, excludes timetable slots (day + time overlap) and user's own custom events; ids `study-block-{assessment_id}`, date = exam−1, room honestly `None`.
- [x] Dedupe across sources preserving user edits (`01` §8 / `02` §3.3): `core/src/store/repo.rs::AssessmentRepo::replace_all` (phase(4) commit `01807f6`) — user-owned fields (grading + `gcal_synced`/`gcal_event_id`) survive reannouncement by id and by `parse::merge::merge_key`.
- [x] Manual assessment/custom event CRUD at the store level (`01` §8; UI in phases 09–10): `repo::ops::upsert_assessment`/`delete_assessment`, `ops::upsert_custom_event` (id required, `custom-<unix_millis>` convention)/`delete_custom_event` — every op returns the refreshed snapshot.
- [x] Grade recording with explicit-null-clears (`01` §4.6 grade edit semantics; detail UI later): `repo::ops::update_grade` + `GradeRepo` Keep/Clear/Set `FieldUpdate`, validation (achieved ≥ 0, max > 0, weightage ≥ 0), empty record auto-deletes, `grades` map + assessment display columns kept in sync by one writer.
- [x] Backup export/restore (secret-scrubbed) (`01` §8; settings UI in phase 10): `store/exporter.rs` + `store/importer.rs` — v4-shape export structurally carries no credential fields; restore honors v4's own guard, drops v4 secret keys, reports them in `ImportReport.secrets_ignored`; fixture round-trip `core/tests/v4_backup_roundtrip.rs`.
- [x] `[D]` cloud Drive backup — core (desktop wiring in phase 07) (`01` §8): `store/backup.rs` — Drive appDataFolder search/PATCH-or-create/download, data-only `BackupPayload` (token fields absent at the type level, asserted by test), per-record `RecordStamps`, merge = topics additive + grades upsert-fill + records/schedule replace-if-newer, refuse-to-truncate at 8_000 bytes + complete-JSON guard.
- [x] One-click import of v4 exports — core (button in phase 10) (`01` §8 last item): `importer.rs` consumes `assessments[]` + `schedule.courses[]` + `completed_topics` + `grades` + `custom_events` in one all-or-nothing transaction; fuzzy enum labels normalized with on-row warnings.
- [x] 5 Gmail queries + dedupe + refresh cap + honest fetch failures (`01` §4.2 Gmail): `core/src/sources/gmail.rs` (phase(5) commit) — the five v4 queries verbatim, newest-first ids, `CACHED_REFRESH_LIMIT = 10`, wiremock-fixture tested; empty search is "0 found, queries ran", all-queries-failed is a loud error.
- [x] Teams Graph ingestion with honest heuristic fallback (`01` §4.2 Teams): `core/src/sources/teams.rs` (phase(5)) — heuristic returns courses-only (noise filter, no keyword renaming, no invented assessments/slots/semester); AI discovery is a labeled injected hook (`ai_assisted` flag) wired in phase 06.
- [x] Moodle iCal + REST; feeds .ics ≤10 https-only; no invented dates (`01` §4.2 Moodle/Feeds): `core/src/sources/moodle.rs` + `core/src/sources/feeds.rs` (phase(5)) — both channels plus feeds run the shared `parse::ics` honesty pipeline; undated events skipped, never re-anchored.
- [x] Classroom coursework, due-date-gated (`01` §4.2 Classroom): `core/src/sources/classroom.rs` (phase(5)) — items without a posted `dueDate` are skipped; scopes come from the declarative registry (`auth::providers::GoogleCapability::ClassroomRead`), structurally fixing `03` §B5.
- [x] Real per-source scan progress + honest sync report (`01` §4.2 scan overlay core half; `03` §B3): `core/src/sources/sync.rs::run_sync` (phase(5)) — `SourceProgress` pulses are emitted by the actual fetch loops; `SourceRun` says Ran/Skipped{reason}/Failed{error} per source; "0 found — nothing configured" is the zero-enabled report. (The scan-overlay UI consumes this in phases 08–10.)

## Phase-02 divergence log (deliberate deviations from v4, per 03/01 §3)

- Urgency/priority ladders UNIFIED (`01` §3): ICS constant priority `85` and the divergent ICS urgency table are gone — everything runs through `parse/util.rs` (`urgency_for`, `compute_priority_score`), so ICS as_on_ref+1d quiz scores are computed, not fixed.
- No defaults on sparse ICS events: date-only DTSTART no longer invents `09:00`; missing DTEND no longer invents +90min / `10:30`; room only when a course slot actually carries one (v4's "E-Learning Lab / Online" default deleted); instructor/group never fabricated.
- `classify_ics_text` defaults to Online Quiz (v4 ICS ladder), while email-pipeline text classification defaults to Class Quiz after the explicit ladders (v4 email parity) — surfaced for review.
- Email link domain: v4 accepted only `e-learning.*` hosts; v5 accepts any `https://` link, preferring `/mod/quiz/` paths (host-lock dropped as host-specific).
- `"15 minutes"` warning fixed at digit boundary (v4's bare `"115 minutes"` false positive).
- MCQ warning reworded: `"+ Explain & Discuss"` fabrication dropped.
- Course-code months: v4 regex-accepted only full month names; v5 also accepts 3-letter abbreviations per the phase prompt's explicit-date ladder ("d Mon YYYY").
- Courseless quiz titles keep just `"Quiz N"` (v4's `"GENERAL"` fabrication deleted); ICS uid-less events get deterministic `fnv1a64` content-hash ids instead of v4's course-keyed id.
- Numeric garbage dates (e.g. month 13, `"118-…"` runs) yield `None` — the event/email is skipped or undated, never silently re-dated.
- Feed URL validation ported verbatim (https-only, token-in-URL honesty) from v4 `feeds.rs`.

## Phase-03 divergence log (deliberate deviations from v4, per 03/01 §3/§4)

- v4 `grade_stats` block dropped from the dashboard summary: grading records arrive with the store (phase 04) and `01` §4.3 lists no grade KPI — simulated/derived grades are not fabricated here either.
- Canonical radar ordering moved into core (`radar_key`: dated first, key `date → start_time (None before Some) → title → id`, undated last, past excluded) — v4 relied on callers pre-sorting and put undated next-up items first.
- `next_up` never resolves to an undated assessment (v4 quirk: undated `date_iso ""` sorted first so "next up" could be a dateless draft).
- Unified urgency ladder for task/priority grouping (critical ≤2d, high ≤5d, medium ≤14d, then upcoming) replaces v4's task-specific critical ≤1 / high ≤4 / `normal` naming — one ladder (`parse/util.rs`) everywhere; `why_study_now` day-count copy keeps v4's honest boundaries ("in a few hours" only on day 0, "in 24 hours" only on day 1).
- Readiness `0/0 → 100` (desktop v4 semantic) and per-card empty-topics → 100 (mobile v4 computed 0) — both surfaced here for review.
- Per-day/payload hour totals are `None` when any covered task lacks hours (v4 fabricated `0.0`); per-topic hours clamp 0.5–2.5 with tenth rounding as in v4.
- `StudyTasksPayload` excludes undated assessments entirely (v4 mixed them in with `No date yet` reasoning but still wrote GCal blocks for them).
- `why_study_now` room copy drops v4's leading `"Room "` prefix; `study_room` fabrication (`Study Desk / Library`) deleted — the caller builds the calendar event with `room: None`.
- Fallback topic set (3 generic titles) kept for topicless assessments (v4 parity) BUT priority still scores the real (0) topic count, so topicless items aren't artificially boosted.
- `ConflictAlert` gains `title_a`/`title_b` (`#[serde(default)]`) so shells can render chips without a second lookup; conflict messages cite course + title only (never instructor/room titles from v4); counts use `BTreeMap` for stable serialization; chips only surface on unmitigated alerts.
- Cross-scan field merge (user-owned edits surviving reannouncement) was hinted to phase 03 in a phase-02 STATUS note and `merge.rs` docstring — deferred to phase 04 store (reannouncement replacement is a store job; p03 prompt scope is pure derivation only).

## Phase-05 divergence log (deliberate deviations from v4, per 03/01 §3/§4)

- Gmail body cap raised 4,500 → 30,000 chars **with a `body_truncated` flag recorded on the cached email** (`03` §C3): consumers know when content was dropped; v4 silently truncated.
- Moodle REST events route through the SAME honesty pipeline as the iCal channel (`parse::ics`): keyword filtering applies, the event description (HTML-stripped) feeds topics/warnings, `type` is classified (not stamped "Online Quiz"), room/instructor/group stay `None` unless actually established. v4's REST path fabricated "Moodle LMS Portal"/"Faculty"/"All Groups"/priority 80 and skipped no events — deleted. The REST `timeduration`-missing ⇒ +1h invention is gone (no DTEND, honest `None`).
- Moodle cross-channel dedupe by merge key (iCal copy wins): the same event surfacing via both channels no longer lands twice (v4 concatenated blindly).
- Classroom honest mapping: v4's "Google Classroom Stream" room, "Classroom Teacher" instructor, "Classroom Enrolled" group, hardcoded `12:00` end time, `10:00` default due time and "Classroom Topic:" fabricated topics are all deleted; a missing `dueTime` is recorded in the inference note ("the deadline is that day"), not invented.
- Teams heuristic palette assignment switched from v4's demo 6-color cycle to the 8 v4 preset accents keyed by FNV-1a over the course id (same derivation as `apps/web` `coursePalette.ts`) — deterministic, demo-free, and documented as UI decoration for the adoption flow.
- Teams discovered courses are returned in `SyncReport.discovered_teams` for EXPLICIT adoption (`03` §A3); v4's overwrite-when-empty adoption rule is not implemented — schedule mutation is always the user's decision.
- Graph paging: a first-page failure is a loud source error; a mid-paging failure degrades to the partial list (documented best-effort context gathering) instead of v4's silent break.
- Fetch-layer https gate allows loopback http (`127.0.0.1`/`localhost`) as the narrow recorded-fixture/local-tooling exception — tokens never leave the device on loopback; the store's feed-persistence gate remains strictly https-only.
- The 60-day recency window does NOT gate heuristic parsing (v4 parity + the phase-02 doc decision: parsing checks every cached message; recency gates phase-06 live-AI candidate analysis only).
- Error strings strip request URLs (`reqwest::Error::without_url`): feed URLs embed personal access tokens and must never reach notes/logs/UI (v4 leaked them into error messages).
- `SyncReport.assessments` is the merged full radar (existing + scanned, user fields preserved) for the caller to persist via the phase-04 store; ordering is NOT normalized — the planner owns radar order (v4's engine re-sorted by date).

## Phase-04 divergence log (deliberate deviations from v4, per 03/01 §3/§4)

- Schema version lives in SQLite's `PRAGMA user_version` (standard mechanism) with a `MIGRATIONS: &[(u32, &str)]` ladder; `kv_meta` carries the `last_*_sync`/schedule stamps. Unknown fields are stored NULL and the read layer maps them to `None` ("—" at render time); a newer-schema file is refused with `SchemaTooNew`, never half-read.
- v4's whole-payload `updated_at` is upgraded to per-record `RecordStamps` (`assessments`/`events`/`feeds`/`grades` maps + schedule dataset stamp) — all caller-provided, core owns no clock — so replace-if-newer merges are record-accurate instead of all-or-nothing. Stamps ride in row columns (`updated_at`); v4's events had none, v5 stamps them.
- v4 secret keys (`gemini_api_key`, `teams_token`, `teams_client_id`, `pairing_pin`, `moodle_token`, `moodle_ical_url`) cannot enter the store: the import type has no such fields (compile-level scrub), and their presence is **reported** in `ImportReport.secrets_ignored` — stronger than v4's silent drop (`03` §B6).
- Import forces `auto_sync_gcal = false` (v4's pre-auth `true` default is not portable; `03` §C1) and `gemini_enabled = false` (flag only — the API key is dropped with the v4 file, BYOK re-entry is platform-side).
- Fuzzy v4 `assessment_type` labels (e.g. bare "Quiz") normalize through the v5 ladder **with an on-row warning** ("Imported from v4: type "Quiz" normalized to "Class Quiz".") — v4 coerced silently.
- Backup merge rules are additive by design: remote `false` never un-completes a topic, remote records lacking a field never erase the local value, older-stamped remote rows lose to newer local rows. v4's merge had no stamps and could overwrite.
- `REFUSE_TRUNCATE_BYTES = 8_000` inherited from v4's calendar-channel budget as a single knob on the Drive push, plus a complete-JSON guard (a truncated push parses as nothing and would vanish silently — worse than an error).
- Drive file name `quizradar_cloud_state.json` kept for pull-compatibility with v4 files; payload `schema_version` starts at 1. The calendar-event fallback channel and `teams_token`→Drive mapping are gone entirely (`03` §D).
- The calendar-event-sync fallback and `LocalOAuthServer.java` pairing paths are NOT ported; `tokens_meta` holds only non-secret profile anchors (account name/email/picture) so the UI can show "signed in as …" before re-auth.

## Compile-time TODO list (honest, no NotImplemented stubs)

- Phase 07 owns the full Tauri IPC surface (only `version()` implemented honestly in phase 01): `list_state`, `run_scan` (progress events, cancel), `push_gcal`, `extract_schedule`, `save_grade`, `toggle_topic`, `set_pin`, `check_update`, keyring token storage commands, onboarding complete/reset. Enumerated from `04-rebuild-architecture.md` §4.2; no fake `state() -> ()` stubs shipped.
- Single-instance plugin registered; window-focus handoff (re-focusing existing window on second launch) wired in phase 07 when the command surface exists.
- `tauri.conf.json` → `app.security.csp: null` for now; exact CSP locked in phase 07/08 once the dev-server/font/img sources are known.
- Updater plugin scaffolded with honest empty config (`endpoints: []`, `pubkey: ""`) — real release endpoint + signature key are generated in phase 15. Update pill UI stays unwired until then.
- `apps/web/src/generated/version.ts` provides `SW_CACHE_KEY_PREFIX`; the actual service worker (phase 11) consumes it. `__APP_VERSION__` is also defined in vite.config.ts as the compile-time define.

## Commands (append as established)

### Rust core (phase-02 established, phase-04/05 extended)

```powershell
cargo test -p quizradar-core                                    # 179 lib unit tests (pkce/providers + wiremock source fixtures + store) + email/ics fixtures + smoke + v4 round-trip
cargo test -p quizradar-core --test email_fixtures dump_email_outputs -- --ignored --nocapture
                                                                # ignored dumper: prints actual parse JSON per case
cargo clippy -p quizradar-core --all-targets -- -D warnings     # gate (denies panics/unwrap/expect outside test modules)
cargo fmt -p quizradar-core                                     # format
```

### Rust workspace (repo root)

```powershell
cargo fmt --all --check                                        # rustfmt gate
cargo clippy --workspace --all-targets -- -D warnings          # clippy gate (warnings = blockers)
cargo test --workspace                                         # unit + fixture tests (core has 4 smoke tests)
cargo check --workspace                                        # fast compile check
```

### Root pnpm culture (repo root, pnpm ≥ 12)

```powershell
pnpm install                     # workspace install (root + apps/*; esbuild build approved via allowBuilds)
pnpm lint                        # eslint flat config (root-only shared config)
pnpm typecheck                   # tsc per package (web: src + vite.config)
pnpm test                        # vitest run per package (web: 9 tests, jsdom)
pnpm format:check                # prettier gate (docs/ and prompts/ are unformatted by policy)
pnpm generate:version            # stamp all version sinks from tooling/version.json
pnpm generate:version:check      # CI check — exits 1 when any sink is stale
pnpm --filter "@quizradar/web" build   # vite production build → apps/web/dist (tauri frontendDist)
```

### Desktop (Tauri 2 shell)

```powershell
pnpm --dir apps/desktop dev      # cargo tauri dev (starts vite dev server + app window)
pnpm --dir apps/desktop build    # cargo tauri build (bundles installers)
cargo tauri build --debug --no-bundle   # fast debug exe: target\debug\quizradar-desktop.exe
```

`cargo-tauri` CLI: `cargo install tauri-cli --version ^2` (v2.12.4 currently installed locally).

### Android (JDK 21 Temurin required: `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` locally; `JAVA_HOME` must point at it)

```powershell
.\gradlew.bat assembleDebug testDebugUnitTest ktlintCheck   # from apps\mobile-android (CI runs assembleDebug only)
./gradlew assembleDebug                                     # linux/CI
```

- Toolchain: Gradle **8.11.1** wrapper (bootstrap jar downloaded from gradle/gradle v8.11.1), AGP **8.9.1**, Kotlin **2.1.0**, Compose BOM 2025.01.00, compileSdk 35, minSdk 26, ktlint plugin 12.1.2 (Compose naming via `.editorconfig` `ktlint_standard_function-naming = disabled`).
- **UniFFI generation (documented for phase 12)** — once core contains `#[derive(Object)]`-annotated items:
  `cargo install uniffi-cli` then, from `core/`, `cargo build` (cdylib) + `uniffi-bindgen generate --library <lib> --language kotlin --out-dir apps/mobile-android/app/src/main/java` (final wiring per `prompts/p12-android-scaffold.md`; binding stub lives at `app/src/main/java/com/quizradar/app/core/QuizRadarCore.kt`).
- Android SDK used locally: `C:\Users\ANXOMXR\AppData\Local\Android\Sdk` (`ANDROID_HOME` already set), cmdline-tools 19.0 installed fresh (previous local install was a broken extraction), license accepted, `platforms;android-35` installed during this phase.

### CI

`.github/workflows/ci.yml` — three PR jobs running the exact commands above: `rust` (fmt/clippy/test + version check), `web` (pnpm lint/typecheck/test + version check), `android` (temurin 21 + `./gradlew assembleDebug`). Replace/extend in phase 15.

## Dogfood notes

- Desktop debug exe (`target\debug\quizradar-desktop.exe`) launched headless-smoke: process stays alive >10s (window + WebView create, web dist loads), killed programmatically. Phase 07+ gets a real eyeball-verification note from the maintainer for `cargo tauri dev`.

## Blockers / open decisions

- ~~Android local build requires JDK 21 + Android SDK~~ — resolved during phase 01: Temurin JDK 21 installed via winget; platform 35 + working cmdline-tools installed into the local SDK. CI still uses ubuntu + temurin 21 (`ci.yml`).
- `pnpm core:watch` requires `cargo-watch` (not installed locally; optional dev nicety — plain `pnpm core:test` always works).
- `cargo tauri dev` opens a real window on this machine; the headless shell cannot visually confirm the placeholder rendering — the maintainer should run `pnpm --dir apps/desktop dev` once and confirm the shell (verified equivalent: built exe + dist smoke above).

## New dependencies (with rationale, per §7 DoD)

- Phase 05 added to `core`: `sha2` (PKCE S256 challenge — RFC 7636 compliance, pure Rust), `base64` (PKCE encoding + Gmail MIME body decode, ports v4's dependency), `getrandom` (PKCE verifier + OAuth state entropy; 256-bit, no rand tree — note for phase 11: the wasm32 build needs its `js` feature), `futures` (bounded-concurrency streams `buffer_unordered`/`buffered` for the source scans, std+async-await features only). Dev-only: `wiremock` 0.6 (recorded-HTTP fixture tests required by the phase-05 acceptance; hyper/tokio stack already in the graph via reqwest).
