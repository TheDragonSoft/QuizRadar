# QuizRadar v5 Architecture Brief

**Version:** 5.0.0  
**Scope:** Public architecture specification and subsystem design.

---

## 1. System Overview & The Core Purity Principle

QuizRadar v5 is built upon a **zero-server, local-first** architecture. Rather than running a local HTTP daemon or relying on hosted cloud backends, all academic computations, schedule cross-referencing, announcement parsing, study planning, conflict detection, and database transactions occur entirely inside a single shared **Rust core crate** (`core/`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        QuizRadar Client Tier                           │
├─────────────────────────┬─────────────────────────┬────────────────────┤
│     Desktop (Tauri 2)   │   Android (Compose M3)  │   Web / PWA (SPA)  │
│    React 19 + TypeScript│   Kotlin 2.x + Glance   │   React 19 + WASM  │
└────────────┬────────────┴────────────┬────────────┴─────────┬──────────┘
             │ In-Process IPC          │ UniFFI (JNA / C-ABI) │ WebAssembly
             ▼                         ▼                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          Rust Core (`core/`)                           │
│  - SQLite Store (rusqlite)          - Schedule & Timetable Planner     │
│  - Email & Announcement Parsers     - Conflict Detection & Study Blocks│
│  - Source Integrations (Gmail, etc) - ICS / GCal Calendar Export       │
│  - BYOK AI Engine & Cache           - PKCE Auth & Scope Registry       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Platform Tier Breakdown

### 2.1 Desktop Shell (`apps/desktop/`)
- **Technology:** Tauri 2 (Rust shell) + React 19 / TypeScript / Vite frontend.
- **Communication:** Pure in-process Tauri IPC commands (`list_state`, `run_scan`, `push_gcal`, `extract_schedule`, `save_grade`, etc.). No local network ports or HTTP sockets are opened.
- **Security:** Credential tokens are stored in the host operating system's native keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service).
- **Updates:** Cryptographically signed automatic updates via `tauri-plugin-updater` with `minisign` verification.

### 2.2 Android Native Shell (`apps/mobile-android/`)
- **Technology:** 100% Kotlin 2.x with Jetpack Compose Material 3 UI.
- **Binding:** UniFFI-generated C-ABI bridge communicating asynchronously with the Rust core.
- **Home Screen Widget:** Glance 2x1 AppWidget rendering live urgent countdowns updated via Jetpack WorkManager.
- **System Integrations:** First-party Android notifications, system share-target (`ACTION_SEND` intent filter), and Chrome Custom Tabs PKCE OAuth.
- **Security:** Hardware-backed `EncryptedSharedPreferences` via Android Keystore.

### 2.3 Web Companion Tier (`apps/web/`)
- **Technology:** React 19 + TypeScript PWA sharing 100% of the Desktop UI code.
- **Engine:** Compiled Rust core via `wasm-bindgen` (`core/bindings/wasm/`) running directly in WebAssembly inside browser Web Workers.
- **Storage:** Client-side SQLite persistence in IndexedDB via `sql.js` (identical schema and migrations as desktop/native).
- **Auth Reality:** Memory-only Google Identity Services (GIS) ephemeral tokens (1-hour lifespan; no refresh tokens stored on disk).

---

## 3. Subsystem Architecture

### 3.1 Local SQLite Store (`core/src/store/`)
- Single transactional SQLite database operated via `rusqlite`.
- Strictly typed tables: `courses`, `slots`, `assessments`, `topics_done`, `grades`, `events`, `feeds`, `config_kv`, `tokens_meta`.
- Arity of unknown values is strictly preserved (e.g. unannounced exam rooms store SQL `NULL` and render `"—"` rather than hallucinated lecture halls).
- Atomic v4-to-v5 JSON backup importer executing within a single database transaction.

### 3.2 Authentic PKCE Authentication (`core/src/auth/`)
- Fully compliant with RFC 7636 and RFC 8252.
- Zero client secrets in code or distribution binaries.
- Desktop loopback redirect (`127.0.0.1:<random-port>`) and Android custom scheme redirect (`com.quizradar.app://oauth/google` and `microsoft`).
- Scope registry guarantees exact least-privilege permissions without permission overreach.

### 3.3 BYOK AI Engine (`core/src/ai/`)
- Optional Bring-Your-Own-Key Google Gemini integration using the direct `x-goog-api-key` header.
- Content-hash cache (`hash(provider, task, model, input_hash)`) avoids duplicate API requests across timetable edits.
- Deterministic offline fallbacks for all features: regex heuristic email parsers, manual timetable editors, and local topic-based study planners ensure 100% functionality without AI.

### 3.4 Release & Tooling Pipeline (`tooling/`)
- Single source of version truth: `tooling/version.json`.
- Script `tooling/generate-version.mjs` automatically synchronizes all 5 platform sinks (`Cargo.toml`, `package.json`, `tauri.conf.json`, `build.gradle.kts`, `version.ts`).
- Release automation produces verified Tauri desktop installers, Scheme v2/v3 signed Android APKs/AABs, and GitHub Pages PWA bundles.
