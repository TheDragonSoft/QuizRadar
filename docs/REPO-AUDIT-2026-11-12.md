# QuizRadar Repo Audit — 2026-11-12

Read-only audit by a three-worker swarm (core, apps, infra), two passes. Both passes were grep-and-read-the-hits, **not** line-by-line reviews. Nothing has been fixed yet.

## Medium

| Area | Location | Issue | Fix |
|---|---|---|---|
| Core | `core/src/store/repo.rs:2472-2473` | `&date_str[..10]` byte-slices a DB string; panics on non-ASCII/corrupt dates | Use `date_str.get(..10)`, skip row on `None` |
| Apps | `apps/mobile-android/.../analytics/AnalyticsManager.kt` | Telemetry API + opt-out pref (`quizradar_telemetry_opt_out`) contradicts AGENTS §9 (no telemetry). All `track*` methods are empty no-ops | Delete file, call sites and pref |
| Apps | `apps/desktop/src-tauri/src/state.rs:72` | Bundled Google client secret in source. Allowed by AGENTS §3.2 (desktop only) but extractable | Plan rotation; never extend to web/core/Android |
| Infra | `.github/workflows/release.yml:375-376` | `${{ github.event.inputs.tag }}` interpolated into shell (script injection; maintainer-triggered only) | Pass via `env:` and quote |
| Infra | `docs/PHASE-1-VISUAL-PREVIEW-GALLERY.md` | Absolute `file:///d:/Projects/...` links, broken for everyone else/GitHub | Use relative paths |

## Low

**Core**
- `store/repo.rs:2444` `prune_by_age`: `chrono::Duration::days` and `now - dur` panic on extreme/negative `max_age_days` via FFI/WASM. Use `try_days` + `checked_sub_signed` or validate.
- `store/repo.rs:505`: `+ 1` overflow at `i64::MAX`; use `saturating_add`. Cosmetic `as` casts at 817, 822, 558, 1990, 2092.
- `ai/provider.rs:98`: unchecked `self.model_ids()[0]`; use `.first().copied()` with a fallback.
- `ai/provider.rs:~86`: model ids `gemini-3.7-flash` / `gemini-3.6-flash` unverified; each wasted request if non-existent (fallback chain covers it).
- Test fixtures contain `Hall B-204` (`ai/tasks.rs:1366,1410`, `plan/dashboard.rs:831,835`), banned by AGENTS §3.4. Rename to a neutral string.
- Test gaps: non-ASCII dates in semester prune; extreme `max_age_days`.

**Apps**
- `auth_loopback.rs:286-342`: `eprintln!` logs client_id, redirect_uri, peer, callback param keys; token-exchange error text (:418-421) may echo Google detail. Gate behind debug flag, redact.
- `tauri.conf.json:30`: prod CSP has `style-src 'unsafe-inline'` and `img-src https:`; confirm devCsp (fully open) is never used in release.
- `capabilities/default.json`: `opener:default` and `dialog:default` are broad; confirm opener URL scope is https only.
- Android OAuth redirect uses custom scheme `com.quizradar.app` (claimable); PKCE + `state` check (`OAuthManager.kt:225`) mitigates. Keep `state` strictly enforced.
- `quizradar://action` deep link is BROWSABLE; verify the handler never does destructive actions or syncs without confirmation (handler not read).
- `CalendarView.tsx:80,85,91,97,106,123`: 6 `react-refresh/only-export-components` warnings.
- `apps/web/package.json` has no `lint` script.

**Infra**
- `release.yml:235-237`: secrets interpolated into `run:`; use `env:`.
- All GitHub Actions pinned to floating tags (including third-party in the signing release job); pin to SHAs, add Dependabot.
- `Cargo.lock` has duplicate transitive crate versions (base64, getrandom, etc.); occasional `cargo update`.
- `tooling/generate-version.mjs`: `--help` stamps instead of printing help (no-op this time); add `--help`/`--check`.
- `docs/screenshots/` has 75 tracked images, one over 2 MB (`non-ai-suite/live-android-02-main.png`), against AGENTS rule 8. Prune or git-ignore.

## Info
- `apps/landing` exists but is missing from the AGENTS.md repo layout.
- Android manifest: `exported="true"` at lines 19 (launcher), 72, 84 (widget receivers, standard APPWIDGET_UPDATE pattern, OK). No `networkSecurityConfig`, not needed since cleartext is off.
- `core/`: no TODO/FIXME, no `allow(dead_code)`; one acceptable `allow(clippy::too_many_arguments)` at `cal/gcal.rs:414`.
- The worktree had many uncommitted `apps/mobile-android/**` edits from other agents.

## Verified clean
- `cargo clippy --all-targets` — 0 warnings in `core/` and `apps/desktop/src-tauri`
- `cargo test` (core): 334 unit tests + integration tests pass
- `cargo fmt --check` (core) clean; desktop fmt not confirmed
- No non-test `unwrap`/`expect`/`panic` in core; no hardcoded secrets in core (outside the §3.2 exception)
- Web `tsc --noEmit` exit 0; contract `regenerate.mjs --check` up to date; eslint 0 errors
- All 5 version sinks at 5.10.0 (versionCode 51000); `docs/STATUS.md` 119/250 lines
- No `.env`/`.pem`/`.jks`/`.db` tracked; `.gitignore` covers secrets
- Workflows use least-privilege `permissions:`; no `pull_request_target`; PR title/body passed via `env`
- `pnpm agent:note --validate` passes (3 fragments)
- Android: tokens in `EncryptedSharedPreferences` (AES256_GCM), `allowBackup=false`, cleartext off; SQL `format!` uses only constants/placeholders

## Not checked
Line-by-line read of `repo.rs`, `ffi.rs`, `email.rs`, `tasks.rs`; SQL migrations; timezone handling in `cal/gcal.rs` / `cal/ics.rs`; ktlint, Gradle, Kotlin a11y; WASM build; desktop `cargo fmt --check`; workflow semantics beyond security; stale or contradictory docs.
