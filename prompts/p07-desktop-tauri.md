# Phase 07 — Desktop: Tauri 2 shell over the core

> After phase 06. This phase defines the IPC surface all UI phases assume. Delete-list: the v4 Axum HTTP API (from `02` §4) is **not** ported as HTTP; its semantics survive as typed commands.

**Read first:** `AGENTS.md`; `docs/rebuild/04-rebuild-architecture.md` §4.2 (IPC contract) + §4.3 (auth) + §5 (deletions); `docs/rebuild/02-current-architecture.md` §4 (v4 route semantics table — the mapping source) + §7.1 (shell behaviors to port: CLI behavior is NOT needed; window/UA/webview2 specifics to REPLACE with tauri defaults).

## Build

1. `apps/desktop/src-tauri/` commands (type-safe Tauri async commands over `core`, serde camelCase payloads):
   - State & data: `get_state` (config + auth + schedule + assessments + dashboard + tasks payload exact v4 `/api/state` shape minus redaction-acrobatics: never return secrets to ANY caller), `save_schedule`, `upsert_course`, `delete_course`, `update_config`, `add_custom_event`, `delete_custom_event`, `toggle_topic`, `save_grade`, `dismiss_conflicts`, `schedule_study_blocks`.
   - Sync & scanning: `run_sync` (streams `SourceProgress` events via `window.emit`), `run_gcal_sync`, `push_cloud_backup`, `pull_cloud_backup`.
   - Auth: `google_login_start()` → returns the PKCE URL w/ loopback port chosen by tauri `port` plugin or ephemeral listener inside **src-tauri (Rust)** — implement loopback redirect receiver (TCP accept loop, serve one HTML card): success/cancel/error cards ported from v4 `main.rs` inline pages → move to static post-auth assets; logout wipes token from OS **keyring** (rp-plugin `keyring`).
   - AI: `extract_schedule(image)` (progress events), `optimize_tasks`, `practice_generate(assessment_id)`, `validate_gemini_key(key)` (honest result: stores key in keyring, pings model).
   - Updater: wire `tauri-plugin-updater` (public key placeholder + honest "release channel not configured" error until phase 15).
   - Pair/backup ports: `pair_info` stub **omitted** — per-device accounts cover it (v5 decision); desktop QR card appears only in phase 10 as *app-import* helper: implement `export_backup_file` + `import_backup_file` (file-dialog) — OS backups without servers.
2. Keyring integration: `tauri-plugin-keyring` or `keyring` crate command (`set_secret/get/delete`): refresh tokens + Microsoft + Gemini keys. Access tokens (1h) may live in-memory; document in STATUS.
3. Window bootstrap: single instance enforced, close→exit **graceful** (no `process::exit`; task-loop cancel + tokio shutdown), deep-link handling for `quizradar://` (updater/auth flows later), dev CSP permissive only in dev.
4. **Integration tests** (`cargo test -p desktop` where possible): command-level tests with in-memory store: `get_state` honest against empty DB; grade partial-update; topic toggle round-trip; sync orchestrator invoked via command with fixture transport (feature-gate `test_transport` to inject mock `TokenProvider`/`HttpClient`).

## Acceptance
- [ ] `cargo tauri dev` boots: window shows web placeholder, `version()` command returns real version from tooling
- [ ] All commands listed exist & compile with typed errors; **no HTTP server rule** enforced by_review + no `axum` in Cargo tree (test: `cargo tree -e no-dev | grep -F axum` fails review)
- [ ] Keyring round-trip test green (CI skips if no dpapi — feature-guard)
- [ ] Graceful close: no hang, no zombie processes (manual note in STATUS)
- [ ] STATUS updated + mapping table v4-route → v5-command recorded (for phase 08–10 UI mapping)

## Commit
`phase(7): desktop tauri shell + full IPC surface over core`
