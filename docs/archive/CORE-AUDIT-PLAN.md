> **ARCHIVED 2026-11-10** — executed: all six batches below were implemented and merged in
> `7ed0a63 feat(core): complete audit batches 1-6 across sync, store, ai honesty, and wasm parity`
> (see `docs/worklog/2026-11.md` and the change fragments archived there). Kept as a historical
> audit record; the finding tables are stale and must not be treated as open work.

# QuizRadar Core Audit — Sync, Email Loop + Core Fixes

> Audit date: 2026-11-08 (Adjusted with technical review & architectural corrections)
> Scope: `core/src/**/*.rs`, `apps/desktop/src-tauri/**/*.rs`, `apps/web/src/contract/**`, `apps/web/src/lib/**`
> Status: **Adjusted Plan — Ready for Batch 1 Execution**
> Severity: Critical / High / Medium / Low

Three parallel audits, ~100 findings. Ordered by leverage: sync/email first, then store/migrations, then honesty/AI, email cache, week alignment, and test/WASM parity.

---

## 1. Sync + Email Loop (highest leverage)

### Critical

| #   | Location                                   | Issue                                                                                                                                                                                                                                                        | Fix                                                                                                                                                                                                           |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `core/src/sources/gmail.rs:38,245-275`     | **Silent Gmail truncation** — `MAX_RESULTS_PER_QUERY=35`, first page only, ignores `nextPageToken`. Mailbox >35 hits/query shows newest 35, rest lost silently. `stats.unique_ids ≤ 175` ever.                                                               | Follow `nextPageToken` to `MAX_PAGES_GMAIL=5`, or `q=after:<last_internalDate>`. Emit `"Gmail: truncated at N pages"` when capped.                                                                            |
| S2  | `core/src/sources/mod.rs:118-144`          | **No 429/5xx retry/backoff** — `authed_get` retries only `401` once. Gmail quota (250 QPS/user) / Graph throttle aborts whole query as hard failure.                                                                                                         | Enable `tokio/time` for native builds. `authed_get_with_retry(3, base 500ms)` — on 429/5xx sleep `min(Retry-After, base·2^n + jitter)`, re-`bearer()`. Return distinct `Throttled` so caller defers vs fails. |
| S3  | `core/src/sources/teams.rs:82,352,413,486` | **Wrong OAuth capability** — all Graph calls use `User.Read`. `/groups/{id}/drive`, `/conversations` need `Files.Read.All` / `Group.Read.All` → real tenants `403`, swallowed by `unwrap_or_default()` → Teams looks empty with "sync succeeded, 0 courses". | Add `FilesRead`/`GroupRead` to `MicrosoftCapability`; pass correct capability per call in `teams.rs`.                                                                                                         |

### High — Gmail incremental & cache

| #   | Location                                                              | Issue                                                                                                                                                                                                                                               | Fix                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4  | `core/src/types.rs:130-146` + `core/src/sources/gmail.rs:315-351`     | **No `historyId` / `internalDate` / `threadId` cursor** — `CachedEmail` drops them. Incremental sync impossible; deletes/edits never observed.                                                                                                      | Add `internal_date_ms, history_id, thread_id, rfc_message_id` to `CachedEmail`; persist `last_history_id` in `kv_meta`.                                                                 |
| S5  | `core/src/store/repo.rs:1584-1590`                                    | **`last_gmail_sync` written, never read** — stamp exists + v4-imported, `scan_gmail` ignores it. Every run re-searches same 35.                                                                                                                     | Thread `last_history_id/last_internalDate` via `SyncInput` → `scan_gmail(q=after:…)`, fallback to full on `410`.                                                                        |
| S6  | `core/src/sources/mod.rs:46-66,134-137` + `core/src/ffi.rs:1115-1126` | **Refresh thundering herd** — Gmail scan fires ~175 `bearer()` at concurrency 8. Concurrent refresh with same `refresh_token` → rotation invalidates, followers get `invalid_grant`.                                                                | `TokenCache` (`Arc<Mutex<Option<{token,expires_at}>>>`, single-flight refresh, 60s slack). Snapshot one `bearer()` per scan.                                                            |
| S7  | `core/src/sources/gmail.rs:315-435`                                   | **MIME corruption + DoS** — last duplicate `Subject:` wins, RFC2047 headers never decoded (garbled subjects), charset ignored (`lossy` mangles Latin-1), HTML accumulates unbounded, recursion depth unbounded, base64 cut mid-quantum → `""` body. | Cap depth 10 + HTML bytes 200k; decode `encoded_word`; cut base64 at `len-len%4`; keep partial prefix + `body_truncated`.                                                               |
| S8  | `core/src/parse/email.rs:650-652`                                     | **Timezone ignored; future dates always "recent"** — `+0300` ignored → off-by-one at midnight, recency anchor shifts. `is_email_recent` true for any future `sent` (2030 passes). Undated kept forever.                                             | Parse offset, convert to local; require `0 ≤ ref−sent ≤ 60` (allow 1-day skew); cap undated by `synced_at`.                                                                             |
| S9  | `core/src/sources/sync.rs:158-181`                                    | **Gmail stamps skipped cache as "seen this run"** — full 500-cache re-parsed every run, `last_seen_source_run` overwritten for out-of-window mail. Provenance lies.                                                                                 | Carry `fetched_ids: HashSet` in `GmailScan`; stamp only those.                                                                                                                          |
| S10 | `core/src/parse/merge.rs:15-34`                                       | **`merge_key` = `source                                                                                                                                                                                                                             | course                                                                                                                                                                                  | title | date`** — drops time/instructor/location. Two retakes same day collide; rescheduled final (new date = new key) → old row never retired for Gmail → phantom duplicate. | Include `start_time`/`instructor` in key. **Keep source in `merge_key`** to preserve `retire_unseen_items` provenance; use a secondary correlation key for advisory cross-source linking. |
| S11 | `core/src/sources/mod.rs:297-327` vs `core/src/store/repo.rs:693-751` | **Two merge paths diverge** — sync dedupes by `id` only, repo by `id+merge_key`. Re-emailed announcement with new Gmail id keeps both rows.                                                                                                         | Canonicalize merge path in sync (lookup by `merge_key` first within same source, `id` second). Cross-source duplicates linked via advisory relation, never silently collapsed into one. |

### High — Tokens, timeouts, orchestrator

| #   | Location                                                | Issue                                                                                                                                                                                                                                                                | Fix                                                                                                                                             |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| S12 | `core/src/sources/mod.rs:75-81` + `core/src/ffi.rs:436` | **Untimed clients** — sync client 30s total, `exchange_oauth_code` `Client::new()` (no timeout). One hung feed blocks `tokio::join!` (`core/src/sources/sync.rs:155-156`) for all 5 sources.                                                                         | Add `connect_timeout(10s)` / `timeout(20s)` / `pool_max_idle_per_host(8)` to `reqwest::ClientBuilder`; per-source timeout surfacing `TimedOut`. |
| S13 | `core/src/sources/sync.rs:553-557`                      | **All-disabled feeds = Failed** — `runs=[]`, `failed==runs` (`0==0`) → `"every feed failed: "` when user disabled feeds.                                                                                                                                             | `if runs.is_empty() → Ran("Calendar feeds")` or `Skipped("all disabled")`.                                                                      |
| S14 | `core/src/sources/sync.rs:149-156`                      | **Unbounded join + shared token race** — 5 futures share one client + one `Arc<dyn TokenProvider>` (Gmail+Classroom). Slow Moodle dominates total time.                                                                                                              | Share `TokenCache` (S6) + per-source `timeout()` so one slow source fails alone.                                                                |
| S15 | `core/src/sources/mod.rs:335-357`                       | **Wall-clock in core + non-persistent sequence** — `source_run_id(name, Utc::now())` violates "core owns no clock"; `RUN_SEQUENCE: AtomicU32` resets on restart → `(name,timestamp,0)` collision if two scans in same second across restart → stale items kept live. | Inject `run_at: DateTime<Utc>` via `SyncConfig`; persist sequence in `kv_meta` or `Uuid::now_v7()` suffix.                                      |
| S16 | `core/src/sources/mod.rs:273-290`                       | **Every day is `updated`** — `days_until`/`priority_score` recomputed from `ref_date` → `scanned_content_differs` true on rollover even if announcement unchanged.                                                                                                   | Exclude derived fields from diff, or recompute both clones at same `ref_date`.                                                                  |
| S17 | `core/src/sources/mod.rs:382-419`                       | **Retirement edges** — `date < ref_date` lets today retire same-day if feed drops after morning event; `date=None` retired on first omission (false cancellation); `O(n·m)` scan.                                                                                    | `date <= ref_date` (keep today's completed events from false retirement); never retire `date=None`; use `HashMap<provenance_key, run_id>`.      |

### Medium — Gmail accounting, Teams, Feeds, Moodle, Classroom

| #   | Location                                                                 | Issue                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                 |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| S18 | `core/src/sources/gmail.rs:142-158,210-214`                              | **Cache refresh arbitrary 10; eviction sorts by string `id`** — `CACHED_REFRESH_LIMIT` picks grouped-order first 10, not newest. Hex ids lexicographic ≠ chronological → evicts in-window mail, keeps out-of-window. `cache_refreshed` counts attempts not successes; `Ok(None)` dead branch; failed ids not tracked. | Sort by `internal_date_ms desc` before cap/evict; `fetch_message → Result<CachedEmail,String>`; track `failed_ids`. |
| S19 | `core/src/sources/gmail.rs:134-138`                                      | **One good query + empty still hard-fails** — `message_ids.is_empty() && first_error` → `Err`. Should be `Ran 0 found` with warning.                                                                                                                                                                                  | Only `Err` when _all_ queries failed.                                                                               |
| S20 | `core/src/sources/gmail.rs:286`                                          | Unencoded `msg_id` in URL path.                                                                                                                                                                                                                                                                                       | `percent_encode(&msg_id)`.                                                                                          |
| S21 | `core/src/sources/teams.rs:87-94,359,391,419-493`                        | **Silent error swallowing** — `/me` → `let _ = error` → `(None,None)` proceeds `Ran`; channels/tabs/drive/conversations `unwrap_or_default()` → partial bundle ≡ empty. `TeamsDiscovery` has no notes.                                                                                                                | `TeamBundle { errors: Vec<String> }` → notes → `run_sync` notes.                                                    |
| S22 | `core/src/sources/teams.rs:241-294`                                      | **Silent `GRAPH_MAX_PAGES=10` truncation + unbounded fan-out** — per-folder fetch unbounded (500 folders = 500 calls, conc 3 each) — no folder cap; all teams held in RAM.                                                                                                                                            | Return `(items, truncated, error)`; cap folders 50/team + items 200 with notes.                                     |
| S23 | `core/src/sources/teams.rs:155-184`                                      | Noise filter `"cohort 20"` — matches `"cohort 20xx"` for _every_ cohort 20xx → all filtered.                                                                                                                                                                                                                          | Word-boundary `cohort\s+20\d\d`.                                                                                    |
| S24 | `core/src/sources/feeds.rs:68-82` + `core/src/sources/moodle.rs:161-172` | **Unbounded `response.text()`** — 100MB `.ics` OOMs.                                                                                                                                                                                                                                                                  | `bytes().take(5MiB)` + `content_length` pre-check.                                                                  |
| S25 | `core/src/sources/feeds.rs:111-131`                                      | **Disabled feed poisons dedupe** — `seen_urls` inserted before `enabled` check → `[disabled X, enabled X]` drops enabled. `overflow` double-counts.                                                                                                                                                                   | Check `enabled` first; `overflow = enabled_unique − selected`.                                                      |
| S26 | `core/src/sources/moodle.rs:199-206`                                     | Token sent twice (header + form) → leaks to proxy logs.                                                                                                                                                                                                                                                               | Send header only.                                                                                                   |
| S27 | `core/src/sources/moodle.rs:227-247`                                     | `stats.scanned` counts _after_ filter → undercounts; one channel 0 + other failing = hard `Err` even though calendar proven empty.                                                                                                                                                                                    | Count `raw_events.len()`; only `Err` when _all_ channels failed.                                                    |
| S28 | `core/src/sources/classroom.rs:80-88,271-312`                            | **Per-course errors swallowed; page errors discard history** — `unwrap_or_default()` per course → 401 on first course = success with 0 scanned. `paged_collection` discards earlier pages on any-page failure; `MAX_PAGES=10` silent.                                                                                 | `(items, truncated, error)` triple; aggregate errors into notes with truncation note.                               |
| S29 | `core/src/sources/classroom.rs:159-172`                                  | `dueTime` loses seconds/nanos/tz; `dueDate` tz assumption undocumented.                                                                                                                                                                                                                                               | Read `nanos`; document assumption.                                                                                  |
| S30 | `core/src/parse/email.rs:1243-1272`                                      | **Week estimate re-anchors daily** — undated "next week" → `ref_date+5` _today_, `+5` tomorrow → drifts forever.                                                                                                                                                                                                      | Persist resolved date; reuse if `email_sent_date` unchanged.                                                        |
| S31 | `core/src/parse/email.rs:495-559`                                        | **Day-first forced; invalid date poisons scan** — US `05/06` misread; signature `31 Feb` aborts, later valid date never tried.                                                                                                                                                                                        | On invalid, continue scanning; document day-first in note.                                                          |
| S32 | `core/src/parse/email.rs:1441-1472`                                      | Dedupe first-wins order-dependent — older email wins, correction lost.                                                                                                                                                                                                                                                | Sort by `internal_date_ms desc` before loop.                                                                        |
| S33 | `core/src/parse/email.rs:420-490`                                        | `"Sept"` missed — `"sep"` + `t` fails ws check.                                                                                                                                                                                                                                                                       | Add `"sept"` alias.                                                                                                 |
| S34 | —                                                                        | No golden for truncated body, quoted-printable, Arabic names, snippet-only, multi-source duplicate, stale-window boundary.                                                                                                                                                                                            | Add 6+ email fixtures (see T8).                                                                                     |

### Store / Auth / FFI sync points

| #   | Location                                                                        | Issue                                                                                                                                      | Fix                                                                                                             |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| S35 | `core/src/store/repo.rs:745-749`                                                | **`DELETE NOT IN (?,…)` SQLite var blowup** — radar >999 rows → `SQLITE_ERROR: too many SQL variables` every sync persist.                 | Chunk deletes (500) or temp-table join.                                                                         |
| S36 | `core/src/store/repo.rs:700-720,756-764`                                        | Grade-preserve diverges: repo `incoming.or(old)` vs sync old-wins; `by_key` overwrites earlier on `merge_key` collision.                   | Unify old-wins; prefer `id` match then `merge_key`.                                                             |
| S37 | `core/src/store/db.rs:49-178`                                                   | **No `emails_cache` table** — neither Desktop nor Android persists email cache (`Vec::new()` passed by both). Scans refetch unnecessarily. | Schema v5: add `email_cache(...)` table + `last_history_id` in `kv_meta`; single transaction for cache + radar. |
| S38 | `core/src/types.rs:449-458`                                                     | `from_label` case-sensitive → `"gmail"` becomes `Feed("gmail")` → never retired.                                                           | `to_ascii_lowercase()` for known labels.                                                                        |
| S39 | `core/src/ffi.rs:1205-1209` + `apps/desktop/src-tauri/src/commands/sync.rs:230` | **Email cache passed empty on Desktop AND Android** — `emails_cache: Vec::new()` on both platforms.                                        | Thread persistent cache from `email_cache` table in `core`.                                                     |
| S40 | `core/src/ffi.rs:1231-1251`                                                     | `"Last synced"` mislabeled (feed-only sync stamps Gmail) + **empty-radar never persists** (skipped if `report.assessments.is_empty()`).    | Per-source stamps; persist empty radar with `EmptyReplace::Allow` when scan proved empty.                       |
| S41 | `core/src/ffi.rs:387-478` + `core/src/auth/pkce.rs:118-125`                     | Token exchange: no timeout, override SSRF, body echo. PKCE future-issued state never expires.                                              | 15s timeout; allowlist endpoints; sanitize body. PKCE: `now < issued → Expired`.                                |
| S42 | `core/src/ffi.rs:86-98`                                                         | `parse_ics` hardcodes UTC (`east_opt(0)`) — non-UTC shells off by timezone.                                                                | Add `offset_seconds` param (mirror `run_native_sync`).                                                          |

---

## 2. Planner / Store / Calendar / AI (non-sync)

### Fix-first

| #   | Location                           | Issue                                                                                                                                                                                                    | Fix                                                                                                      |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P1  | `core/src/ffi.rs:93-96`            | **`parse_ics` always UTC** — `20261018T100000Z` for Cairo user rendered `10:00` not `12:00`; date shifts at midnight. Same as S42.                                                                       | `offset_seconds: i32` param.                                                                             |
| P2  | `core/src/ffi.rs:1307,1319-1321`   | **`gcal_base_url` override exfiltrates bearer token** — public FFI param, no allowlist.                                                                                                                  | `#[cfg(test)]` only or host-validate `www.googleapis.com`/loopback.                                      |
| P3  | `core/src/store/db.rs:328-360`     | **Migration stamped before data migration** — crash between `user_version=4` and `migrate_topic_keys` → reopen never remaps, silent topic loss.                                                          | Data migration inside v3 tx or `kv_meta` completion flag; idempotent re-run on startup.                  |
| P4  | `core/src/store/backup.rs:202-219` | **String-lexicographic stamp compare** — `"2026-10-23 09:00"` vs `"2026-10-23T08:00:00Z"` (`' '` < `'T'`) → local always "newer" regardless of time.                                                     | Normalize to RFC3339 UTC; parse to `DateTime<Utc>` before compare.                                       |
| P5  | `core/src/ai/tasks.rs:190-221`     | **Prompt example hallucination** — `"Hall A-101"`, `"Prof. Alan Turing"` in prompt; `merge_extraction` trusts AI unconditionally → hallucinated room/instructor enters radar. Violates honesty doctrine. | Neutral placeholders (`"<ROOM_OR_NULL>"`); post-validate room/instructor against email text or schedule. |
| P6  | `core/src/cal/gcal.rs:530`         | Template all-day end = same day (zero-length). Push path correctly `+1`.                                                                                                                                 | Use `succ_opt()` next-day compact.                                                                       |
| P7  | `core/src/ffi.rs:226,238`          | **Study block in the past** — `today_iso` validated then ignored; exam tomorrow → block booked yesterday.                                                                                                | If `block_date < today` return `[]`/next future slot.                                                    |

### Medium — dates/countdowns/semantics

- **P8** `core/src/plan/parity.rs:13-18` — ISO parity breaks at 53-week years (week 53 + next week 1 = two consecutive A weeks). Anchor to semester-start Monday.
- **P9** `core/src/plan/cushion.rs:69-70` — untimed assessment = fabricated 2h block (understates availability). Count 0 + note.
- **P10** `core/src/plan/cushion.rs:36-73` — double-counts overlapping commitments (sums not unions). Merge intervals first.
- **P11** `core/src/plan/tasks.rs:404` — roadmap cushion hardcodes `None` → always 15h waking; `calculate_study_cushion` respects param. Thread `waking_hours`.
- **P12** `core/src/plan/gpa.rs:124,192-200` — `scale_max` from last graded course only; "percentage with no grades" still returns 4.0. Derive from scale once.
- **P13** `core/src/plan/gpa.rs:178-190` — mixed weighted/unweighted silently drops unweighted. Require all-or-none weights.
- **P14** `core/src/parse/ics.rs:352-398` — no RRULE expansion; recurring quiz appears once. Emit warning/count at minimum.
- **P15** `core/src/parse/ics.rs:294-350` — digit-filter accepts malformed dates (`202610181` → 2026-10-18). Strict `YYYYMMDD` validation.
- **P16** `core/src/parse/ics.rs:444-460` — UID-less id hashes mutable `description` → registrar edit orphans grades/completion. Hash `summary|date|start` only.
- **P17** `core/src/cal/ics.rs:55-76` — `export_ics_all` trusts stale `is_upcoming`; add `ref_date`, filter `date >= ref_date`.
- **P18** `core/src/cal/ics.rs:152-184` — overnight export invalid (`DTEND` earlier same day). `end <= start` → `date+1` or refuse.
- **P19** `core/src/store/repo.rs:292,314,2029,2319` — `as u32` casts wrap negatives (`-1 → 4294967295`). `u32::try_from().unwrap_or(0)`.
- **P20** `core/src/store/repo.rs:538-908` — corruption swallowed: bad time → midnight, bad date → `1970-01-01`, corrupt topics → `[]`. Fail loudly vs fabricate.
- **P21** `core/src/store/repo.rs:2203-2221` — `u32` overflow in analytics (`+=` panics debug / wraps release). Use `u64` + `saturating_add`.
- **P22** `core/src/store/mod.rs:527-548` — `reset_all` misses attendance/flashcards/attempts/mistakes/sessions (schema v4 tables). Add all 5.
- **P23** `core/src/store/db.rs:299-308` — 5s `busy_timeout`, no retry; two Stores one file → `SQLITE_BUSY`. Bump + exponential retry.
- **P24** `core/src/store/backup.rs:217,254,278` — missing stamp → `""` written, destroys local stamp, next merge clobbers. Never write `""`.
- **P25** `core/src/store/backup.rs:213 vs 227` — tie-break `>` vs `>=` inconsistent. Pick one unified LWW rule.
- **P26** `core/src/store/importer.rs:208-212` — `grades_imported` inflated (counts no-op upserts). Count only `if merge_upsert()?`.
- **P27** `core/src/store/importer.rs:287-292` — restore overwrites profile with `None` (deletes current) + empty GCal map kept stale. Only overwrite if `is_some()`; always write map.
- **P28** `core/src/store/importer.rs:266-271` — `gemini_enabled` forced `false`, no warning. Keep backup value + "re-enter key" state, or warn.
- **P29** `core/src/store/backup.rs:396-398,439-442` — fixed multipart boundary (corrupts if literal appears) + pull has no size guard (OOM). Random boundary; `take(REFUSE+1)` on pull.
- **P30** `core/src/ai/tasks.rs:304-363` — AI date trusted over heuristic; `"Estimated:"` prefix not enforced. Keep heuristic on disagreement or force label.
- **P31** `core/src/ai/tasks.rs:524-530` — slot id collision (`slot-1` explicit + blank → both `slot-1`, `REPLACE` overwrites). Renumber.
- **P32** `core/src/ai/provider.rs:540-553` + `core/src/ai/gemini.rs:92,173` — quota ledger read-modify-write race; double-tap exceeds limit. `Mutex` or SQLite atomic increment.
- **P33** `core/src/ai/tasks.rs:959-1010,691-728` — degenerate practice quizzes pass (5 identical, trivial); `optimize_plan` counts scaffold topics vs `tasks.rs:272` honesty. Dedup + require explanation; use real topics.

### Low — polish

- **P34** `core/src/parse/util.rs:121` `days_until` clamps far-past to `+MAX` (wrong sign) — branch on sign.
- **P35** `core/src/cal/gcal.rs:118-126` + `core/src/cal/ics.rs:181` undated → `1970-01-01` event; return error.
- **P36** `core/src/parse/ics.rs:541-547` fake fallback topics counted as real. Return empty.
- **P37** `core/src/cal/ics.rs:147-149` UID not `ical_escape`d (CRLF injection). Escape.
- **P38** `core/src/cal/gcal.rs:89-94` `offset_string` drops seconds (LMT zones off ≤59s). Include `:SS` when non-zero.
- **P39** `core/src/cal/gcal.rs:424-435` token fetched twice (PUT vs POST can differ under rotation). Fetch once per `push_one`.
- **P40** `core/src/ai/gemini.rs:342-389` 503 retried across 4–6 models serially (6 min hang). Retry 503 ≤2.
- **P41** `core/src/store/repo.rs:1797-1800` + `core/src/ffi.rs:777-781` unknown attendance → `Attended`. Return `Validation`.
- **P42** `core/src/store/repo.rs:1751-1762` attendance warning: `max=1, absent=0` false-warns; `max=0` (zero tolerance) hidden. Fix both.
- **P43** `core/src/store/repo.rs:357-369` `delete_course` returns wrong `changed` flag (orphan slots deleted, reports `false`).
- **P44** `core/src/store/repo.rs:1467` single corrupt `config_kv` key bricks `load_state`. Degrade per-key.

---

## 3. Tests / WASM / UniFFI / CI Drift

| #   | Location                                                | Issue                                                                                                                                                                                                                                                     | Fix                                                                                                                     |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| T1  | `core/bindings/wasm/src/lib.rs:247-250,232-234,304-446` | **WASM lies vs FFI** — `get_week_parity` returns 1970-parity on garbage (FFI: `Validation`), `derive_tasks` malformed schedule → empty slots silently, `calculate_study_analytics` + `review_flashcard` hand-roll streak/Leitner instead of shared logic. | Move streak/Leitner algorithms from `store` into pure `core::plan` module so both WASM and `Store` call identical code. |
| T2  | `core/src/ffi.rs:777-781,815`                           | `record_attendance` unknown → `Attended`; `log_study_session` discards `updated_at`. Kotlin trusts signature.                                                                                                                                             | `Validation` on unknown; persist `updated_at`.                                                                          |
| T3  | `apps/web/src/contract/contractSpec.ts:130-175`         | `RUST_TO_TS_MAPPINGS` (17 structs) missing M1 additions (`Flashcard`, `StudyAnalytics`, …); `KNOWN_FIELD_GAPS=[]` → test passes while TS mirror omits fields.                                                                                             | Add mappings / completeness assert.                                                                                     |
| T4  | `core/src/ffi.rs:428-477`                               | `exchange_oauth_code` spawns `new_current_thread` runtime per call + no timeout.                                                                                                                                                                          | Add 15s timeout to reqwest client + sanitize response.                                                                  |
| T5  | `core/src/ffi.rs:94`                                    | Only bare prod panic: `unreachable!()` on `east_opt(0)`.                                                                                                                                                                                                  | `ok_or(Validation)` like `parse_local_offset`.                                                                          |
| T6  | `core/build.rs:18-23`                                   | Version scan: byte-index panic on truncated line, space-before-colon mis-parse, silent skip if CWD wrong.                                                                                                                                                 | Parse JSON properly / assert presence.                                                                                  |
| T7  | `core/Cargo.toml:27,32,35-41,53,58-65`                  | `--no-default-features` / `--features cli` / `wasm32` never built in CI; duplicate `getrandom` in WASM; `clippy::unwrap_used` warning only.                                                                                                               | Add CI matrix entries; add `#![deny(clippy::unwrap_used)]` to `src/lib.rs` (excluding test modules).                    |
| T8  | Fixtures                                                | No `tests/fixtures/sync/**`; no merge/retire, GCal, Drive-merge goldens; email 12-case guard is `checked >= 12` (one deletion silent). Sync correctness lives only in inline `wiremock` units.                                                            | Add recorded JSON goldens; floor guard to exact count; seed `proptest` cases.                                           |
| T9  | Flaky                                                   | `core/tests/challenger_m1_storage.rs:663` tempdir by `pid` only (collides across parallel runs); `schema_version==4` hardcoded; `ffi_sync_tests` 9 `MockServer` spins, `expect(1)` timing-sensitive.                                                      | `tempfile::TempDir`; pin `SCHEMA_VERSION`; add timeouts.                                                                |
| T10 | Hygiene                                                 | `core/src/store/importer.rs` only 6 secret keys checked; `schedule.json` lacks parity/overnight/empty; `FfiProviderCapability` 10-variant mirror untested.                                                                                                | Expand goldens; exhaustiveness test.                                                                                    |

---

## 4. Week Start / Week End — Defined by the Timetable (timetable-derived week)

> User note: week start and week end depend on the timetable provided, not a fixed weekday.
> Currently core hardcodes a calendar assumption in 6 places. All of them must derive
> week boundaries from `ScheduleData` / `ScheduleSlot` instead.

### 4.1 Where the hardcoded assumption lives today

| #   | Location                                                      | Hardcoded assumption                                                                                      | Symptom                                                                             |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| W1  | `parse/util.rs:40-66` `weekday_index` / `weekday_to_index`    | Sunday-first `0=Sun … 6=Sat` baked everywhere (v4 parity). `types.rs:180` documents it.                   | Storage index conflated with academic week start.                                   |
| W2  | `plan/parity.rs:13-19` `date_week_parity`                     | ISO-8601 Monday-first weeks: odd ISO week = `week_a`, even = `week_b`.                                    | If university week starts Saturday/Sunday, parity flips mid-academic week (Monday). |
| W3  | `plan/dashboard.rs:476-480` `upcoming_this_week`              | Rolling 7-day window `days_until 0..=6`.                                                                  | Label says "this week" but doesn't align with the institution's week boundaries.    |
| W4  | `plan/cushion.rs:14,38` via `slot_matches_date`               | Inherits W2 parity + W1 weekday index.                                                                    | Wrong parity week → wrong committed hours.                                          |
| W5  | `store/repo.rs:2271-2282` `weekly_chart` + streak `2250-2269` | Streak = consecutive calendar days; weekly chart = trailing 7 calendar days.                              | Breaks streak on structural off-days (e.g. Friday in Egypt).                        |
| W6  | `plan/study_blocks.rs` + `plan/tasks.rs`                      | Free-day windows ignore whether day is a class day or free day.                                           | Class days without early morning slots get assigned heavy study tasks.              |
| W7  | `apps/web/src/lib/weekParity.ts:18-39`                        | **Independent TypeScript ISO implementation** — frontend calculates its own parity in JS, bypassing core. | Diverges from core if core is updated without syncing `weekParity.ts`.              |

### 4.2 Fix Architecture (Robust & Non-Heuristic)

Do **NOT** use `min(day_index)` from student slots. (In `Sun=0..Sat=6`, a Sat-first timetable has `min(6, 0) = 0`, picking Sunday instead of Saturday, and sparse schedules pick whatever arbitrary weekday the student has their first lecture).

Instead, declare clear, explicit resolution:

```rust
// In core/src/types.rs
pub struct ScheduleData {
    pub semester: Option<String>,
    /// Explicit academic week start: "Saturday", "Sunday", "Monday".
    /// Extracted from timetable metadata or set by user.
    pub academic_week_start: Option<String>,
    pub courses: Vec<Course>,
    pub slots: Vec<ScheduleSlot>,
}
```

Resolution order:

1. `schedule.academic_week_start` if explicitly specified.
2. If absent: Semester start date weekday (if semester start date is known).
3. If absent: Default Monday with an honest note: `"Academic week start assumed Monday — set in timetable"`.

Parity calculation:

```rust
pub fn timetable_week_start(schedule: &ScheduleData) -> (Weekday, Option<&'static str>)
pub fn week_start_on_or_before(date: NaiveDate, week_start: Weekday) -> NaiveDate
pub fn date_week_parity_anchored(date: NaiveDate, anchor_date: NaiveDate, week_start: Weekday) -> &'static str
```

**Frontend Sync Required:**
Refactor [`apps/web/src/lib/weekParity.ts`](file:///d:/Projects/QuizRadar/apps/web/src/lib/weekParity.ts) to accept `weekStart` and match core's anchored calculation.

---

## 5. Execution Roadmap (Atomic PR Batches)

### Batch 1: Sync Criticals & Network Hardening (Est: 1-2 days)

_Target: Immediate fix for sync drops, silent rate-limits, and empty Teams scans._

- [ ] **S1**: Gmail pagination (`nextPageToken` loop, `MAX_PAGES_GMAIL=5`, truncation notes).
- [ ] **S2**: Add `features = ["rt", "macros", "time"]` to `tokio` in `core/Cargo.toml`. Add 429/5xx exponential backoff with `Retry-After` honoring.
- [ ] **S3**: Add `FilesRead` and `GroupRead` capabilities to `MicrosoftCapability`; use appropriate scopes in `teams.rs`.
- [ ] **S6**: Single-flight `TokenCache` to prevent refresh rotation race conditions.
- [ ] **S12 & S14**: Enforce strict `connect_timeout` (10s) and request `timeout` (20s) across all fetchers.
- [ ] **S19**: Only return hard `Err` on Gmail scan when _all_ queries failed.

### Batch 2: Store Safety, Migrations & SQLite Integrity (Est: 1-2 days)

_Target: Prevent database corruption, crash data loss, and query failures._

- [ ] **P3**: Move topic key migration inside transaction or gate with `kv_meta` migration flag.
- [ ] **P4 & P25**: Parse backup stamps to `DateTime<Utc>` (RFC3339) before comparing; unify LWW rule.
- [ ] **S35**: Chunk `DELETE FROM assessments WHERE id NOT IN (...)` in batches of 500.
- [ ] **S40**: Ensure empty radar correctly persists when an authoritative scan proves zero items remain (`EmptyReplace::Allow`).
- [ ] **P19 & P20**: Fix wrapping `as u32` casts; fail loudly on corrupt time/date instead of fabricating midnight/1970.
- [ ] **P22**: Include all schema v4 tables in `reset_all`.

### Batch 3: AI Honesty & Timezone Corrections (Est: 1 day)

_Target: Eliminate prompt hallucinations and timezone shifting._

- [ ] **P5 & P30**: Remove `"Hall A-101"` and `"Prof. Alan Turing"` from extraction prompt; ground inferred fields.
- [ ] **P1 & S42**: Add `offset_seconds: i32` to `parse_ics` so times render in user's local timezone.
- [ ] **S8**: Parse email offset and anchor recency checks to local time with 1-day skew allowance.
- [ ] **P2**: Disallow arbitrary URL overrides in production FFI for `gcal_base_url`.

### Batch 4: Announcement Email Cache (Schema v5) (Est: 1-2 days)

_Target: Stop re-fetching 175 emails on every sync run for both Desktop & Android._

- [ ] **S37 & S39**: Add `email_cache` SQLite table (`id`, `internal_date_ms`, `history_id`, `subject`, `body`, `sender`, `synced_at`).
- [ ] Wire email cache into `run_sync` on Desktop and Android FFI.
- [ ] Remove `emails_cache: Vec::new()` stubs.

### Batch 5: Timetable-Derived Week & Frontend Parity (Est: 1-2 days)

_Target: Align week start with regional institutional calendars (Sat/Sun/Mon)._

- [ ] Implement Section 4.2 in `core/src/plan/parity.rs` with `academic_week_start`.
- [ ] Sync [`apps/web/src/lib/weekParity.ts`](file:///d:/Projects/QuizRadar/apps/web/src/lib/weekParity.ts) with core.
- [ ] Update `upcoming_this_week` and `weekly_chart` to use timetable week boundaries.

### Batch 6: WASM Parity, CI Matrix & Test Goldens (Est: 1 day)

_Target: Contract hardening and CI reliability._

- [ ] **T1**: Extract pure streak/Leitner algorithms to `core::plan` so WASM and Store share exact logic.
- [ ] **T3**: Add missing M1 model definitions to `contractSpec.ts`.
- [ ] **T7**: Add CI checks for `--no-default-features`, `--features cli`, and `wasm32`. Add `#![deny(clippy::unwrap_used)]` to `lib.rs`.
- [ ] **T8**: Add fixture tests for sync goldens and boundary cases.
