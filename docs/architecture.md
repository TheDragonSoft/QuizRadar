# QuizRadar Architecture

_Current v5 system architecture. Historical v5.0 migration notes live under git tag `docs-pre-purge-2026-11`; architectural overrides live in [`docs/adr/`](./adr/README.md)._

---

## 1. Locked Stack

| Layer | Implementation | Notes |
|---|---|---|
| **Core (`core/`)** | Pure Rust crate | Single implementation of parsers, planner, GPA/cushion/parity, conflicts, study blocks, ICS, GCal, Drive backup, Course Packs, AI client, SQLite store, OAuth PKCE/scopes. Zero UI/Tauri/Android dependencies. |
| **Desktop (`apps/desktop/`)** | Tauri 2 + `apps/web` React 19 SPA | In-process IPC commands (`src-tauri/src/commands/`), signed `tauri-plugin-updater`, OS keyring, ephemeral LAN HTTPS QR pairing ([ADR-0002](./adr/0002-ephemeral-lan-https-pairing.md)). |
| **Mobile (`apps/mobile-android/`)** | Kotlin + Jetpack Compose M3 + Glance | Binds `core/` via **UniFFI** (`uniffiGenerate`). Native notifications, `ACTION_SEND` share ingest, `EncryptedSharedPreferences`, Custom Tabs PKCE. |
| **Web / PWA (`apps/web/`)** | React 19 + Vite + Tailwind + Zustand | Shared UI for Desktop webview and offline-capable PWA. PWA compiles `core/` to **WASM** (`core/bindings/wasm/`) with TS fetch/IndexedDB adapters (`src/pwadapters/`). |
| **Landing (`apps/landing/`)** | Astro 7 static site | Marketing site, `/download/` hub, hosted `/privacy/` & `/terms/` pages for OAuth verification. |
| **Trial AI Relay (`workers/trial-ai-relay/`)** | Stateless Cloudflare Worker | Opt-in first-run trial AI proxy ([ADR-0003](./adr/0003-zero-key-trial-ai-relay.md)). Stores zero user data; rejects `Authorization` headers. |

## 2. Monorepo Layout

```text
core/                   # Pure Rust domain crate (types, parse, plan, cal, ai, store, auth, sources, sync, ffi)
  bindings/             # uniffi.toml (Android) + wasm/ (PWA)
  tests/fixtures/       # Golden email/ICS/schedule fixtures + proptest suites
apps/
  desktop/              # Tauri 2 shell (src-tauri/) consuming apps/web/dist
  web/                  # React 19 + Vite SPA (views, components, state, pwadapters, contract, stories)
  mobile-android/       # Kotlin + Compose M3 + Glance + generated UniFFI bindings
  landing/              # Astro 7 marketing & compliance site (GitHub Pages)
workers/trial-ai-relay/ # Stateless Cloudflare Worker for opt-in trial AI
performance/            # Per-PR base-vs-head performance samplers (core, web, android, desktop)
tooling/                # Version generator, agent-preflight, agent-note, agent-gate, version-rollup, git-hooks
changes/                # In-flight per-branch agent handoff & SemVer fragments
docs/                   # Evergreen docs, ADRs (docs/adr/), auto-archived worklogs (docs/worklog/)
```

## 3. Storage & Cross-Language Contracts

- **Database (`SCHEMA_VERSION = 6`):**
  - Desktop & Android: bundled SQLite via `rusqlite` (`core/src/store/db.rs`, `repo.rs`) with versioned migrations (content-addressed topic keys, flashcards, mistake bank, attendance, `courses.aliases`).
  - PWA: IndexedDB mirror (`apps/web/src/pwadapters/idbStore.ts`) serialized with the same `core/` schema.
- **Wire-map contract (`core/` ↔ `apps/web` ↔ Android):**
  - `core/src/types.rs` and `core/src/ffi.rs` are the single source of truth.
  - Editing either requires `node apps/web/src/contract/regenerate.mjs` (snake_case boundary normalized once in `apps/web/src/state/ipcShape.ts`) and `./gradlew uniffiGenerate` for Kotlin.
- **Version sinks (`tooling/version.json`):** `tooling/generate-version.mjs` stamps all 5 sinks (`apps/web/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, `apps/mobile-android/app/build.gradle.kts`, `apps/web/src/generated/version.ts`).

## 4. Auth, Security & Sync Boundaries

- **OAuth:** PKCE (S256) + single-use 128-bit `state` (15-min expiry), scopes defined once in `core/src/auth/providers.rs`.
  - Desktop: loopback redirect + OS keyring (see [ADR-0001](./adr/0001-desktop-oauth-secret.md) for the scoped Google Installed-client secret).
  - Android: custom scheme (`com.quizradar.app://oauth/...`) + `EncryptedSharedPreferences` (zero secrets).
  - PWA: GIS token client / SPA PKCE, memory-only 1h tokens (never persisted in `localStorage`).
- **Sync:** Each device scans with its own local tokens. Data-only `BackupPayload` syncs via JSON export/import, Google Drive `appDataFolder`, `quizradar://pair?d=...` links, or ephemeral Desktop LAN HTTPS QR ([ADR-0002](./adr/0002-ephemeral-lan-https-pairing.md)). Tokens and secrets are stripped at the type level.

## 5. Permanently Banned v4 Patterns (Never Reintroduce)

- `?demo=` URL hacks, fabricated course palettes/practice banks, `Hall B-204`, `"(via Home-Su25)"`, `_KEYWORD` course forcing.
- Persistent Axum HTTP server (`--lan` daemon), `LocalOAuthServer.java`, Android OAuth foreground service, XOR-obfuscated secrets.
- Calendar-event fallback storage, `teams_token` cloud sync channels, `auto_sync_gcal: true` default, silent OAuth-bearer AI fallback.
