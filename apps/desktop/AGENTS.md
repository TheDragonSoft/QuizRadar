# apps/desktop — Tauri 2 shell surface guide

Scoped extension of the **root `AGENTS.md`** — read it first. This file covers
the desktop shell only (`apps/desktop/src-tauri`): in-process IPC glue around
the pure `core/` crate, hosting the `apps/web` UI.

## Scope & boundaries

- The shell stays **thin** (root §3.3): a few hundred LOC of its own logic.
  Business logic belongs in `core/`; UI belongs in `apps/web`.
- The UI is **not owned here**: `tauri.conf.json` serves `frontendDist:
  "../../web/dist"` and dev mode proxies `devUrl: http://localhost:5173`.
  Edit UI in `apps/web` (see `apps/web/AGENTS.md`).
- Window/updater/keyring/OAuth-loopback concerns are the shell's job; nothing
  else.

## Security-critical files (extra care)

- `src-tauri/src/state.rs` — `DEFAULT_GOOGLE_CLIENT_ID` /
  `DEFAULT_GOOGLE_CLIENT_SECRET`. This is the **root §3.2 maintainer
  exception, scoped to this shell only**:
  - Never copy the secret into `core/`, `apps/web`, or the Android app (the
    Android flow is a PKCE public client — id only).
  - The authorize URL stays secret-free (a unit test guards this).
  - Runtime overrides win: OS keyring `google_client_secret`, then
    `QUIZRADAR_GOOGLE_CLIENT_SECRET`.
- `src-tauri/src/auth_loopback.rs` — keep token-exchange error text and any
  client/redirect logging redacted or debug-gated; never log codes or tokens.
- `tauri.conf.json` — the dev CSP is fully open **on purpose**; verify it is
  never what ships in a release build.

## Commands

```powershell
cargo clippy --all-targets   # in apps/desktop/src-tauri — must stay 0 warnings
cargo fmt --check            # same directory
pnpm tauri:build             # full desktop build (needs apps/web dist)
```

A release build consumes `apps/web/dist` — run the web build first if you
changed the UI, and never commit a stale `dist`.
