# Phase 04 — Core: store, migrations, v4 importer, Drive backup

> After phase 02 (03 parallelizes after store lands).

**Read first:** `AGENTS.md`; `docs/rebuild/04-rebuild-architecture.md` §4.4 (store contract) + §4.6 (sync story); `docs/rebuild/02-current-architecture.md` §3 (all v4 schemas — the importer consumes them) + §5.7 (v4 cloud_sync to REPLACE, not port); `docs/rebuild/03-issues-and-pain-points.md` §B6 (token-in-cloud ban) + D-list.

**Reference implementation:** `git show v4-final:src/cloud_sync.rs` (Drive appDataFolder API usage to port, minus the calendar fallback and teams_token), `git show v4-final:src/parser.rs load/save schedule JSON shapes` + `data/app_config.json` key list, and the export/restore logic in `git show v4-final:static/app.js` (backup scrubbing behavior — the *honest* twin).

## Build

1. `core/src/store/db.rs` — rusqlite (bundled) with **async via tokio `spawn_blocking`** wrapper; tables: `courses`, `slots`, `assessments`, `topics_done`, `grades`, `events`, `feeds`, `config_kv`, `tokens_meta`, `kv_meta(schema_version, last_*_sync)`. Schema versioned `MIGRATIONS: &[(u32, "...")]`, apply-on-open, tests with in-memory DB. All unknowns `NULL` (display layer renders "—").
2. `core/src/store/repo.rs` — typed repositories: `CourseRepo`, `AssessmentRepo`, … exposing the operations both desktop IPC and Kotlin bindings need (draft from `02` §4 route table semantics: GET-state shape, schedule save/replace, course upsert/delete, custom events CRUD, topic toggle, grade partial-update **with explicit-null-clears semantics**, feeds CRUD with https-only validation + ≤10 cap).
3. `core/src/store/importer.rs` — v4 backup importer: accepts the v4 export JSON shape (`assessments[]`, `schedule.courses[]`, `schedule.slots[]`, `completed_topics` map, `grades` map, `custom_events[]`); validates via typed structs (`serde_json::from_str` with deny-unknown-fields false but required core fields), maps old enums ("Microsoft Teams" source etc.) to v5 enums, **drops tokens/secrets fields silently-but-documented**, writes via repos in one transaction. Unit test with a fixture v4 export (build it from the v4 schema facts in `02` §3).
4. `core/src/store/backup.rs` — Drive appDataFolder push/pull of data-only JSON (schema_version, device_id passed in from caller, updated_at per record): search by name, PATCH-or-create multipart upload, download+merge (additive topics, grade upsert, schedule replace-if-newer). **Tokens never serialize** — type system enforces (backup payload struct has no token fields; test asserts omitted).
5. Transactions + `db.journal_mode=WAL`; every mutation returns the new derived state (dashboard/tasks) so shells never re-derive separately.

## Acceptance
- [ ] Store unit suite ≥18 tests (repos, migrations, importer, backup-merge semantics) green in-memory
- [ ] v4 fixture round-trips: import → export → import (idempotent, graded fields preserved)
- [ ] Backup payload struct cannot carry tokens (compile-level via type), refuse-to-truncate policy documented + tested at 8_000-byte boundary
- [ ] clippy/fmt clean; STATUS updated, phase 04 ticked

## Commit
`phase(4): core store + migrations + v4 importer + data-only Drive backup`
