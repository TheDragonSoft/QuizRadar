# QuizRadar v5 Architecture Brief

**Version:** 5.16.0  
**Scope:** Public architecture specification and subsystem design.

---

## 1. System Overview & The Core Purity Principle

QuizRadar v5 is built upon a **zero-server, local-first** architecture. Rather than running a local HTTP daemon or relying on hosted cloud backends, all academic computations, schedule cross-referencing, course-alias matching, announcement parsing, study planning, GPA/cushion calculations, conflict detection, and database transactions occur entirely inside a single shared **Rust core crate** (`core/`).

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
│  - SQLite Store (rusqlite, v6)      - Schedule, Parity & GPA Planner   │
│  - Email & Announcement Parsers     - Conflict, Cushion & Study Blocks │
│  - Source Integrations (Gmail, etc) - ICS / GCal & Drive Backup        │
│  - BYOK AI Engine & Cache           - PKCE Auth & Serverless Pair Sync │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Platform Tier Breakdown

### 2.1 Desktop Shell (`apps/desktop/`)
- **Technology:** Tauri 2 (Rust shell) + React 19 / TypeScript / Vite frontend.
- **Communication:** Pure in-process Tauri IPC commands (`list_state`, `run_scan`, `push_gcal`, `extract_schedule`, `save_grade`, `reassign_assessment_course`, `merge_sync_payload`, etc.). No persistent local network ports or HTTP servers are run.
- **Security:** Credential tokens are stored in the host operating system's native keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service).
- **Updates:** Cryptographically signed automatic updates via `tauri-plugin-updater` with `minisign` verification.

### 2.2 Android Native Shell (`apps/mobile-android/`)
- **Technology:** 100% Kotlin 2.x with Jetpack Compose Material 3 UI.
- **Binding:** UniFFI-generated C-ABI bridge communicating asynchronously with the Rust core (`NativeStore`).
- **Home Screen Widgets:** Glance **4×2 / 4×1 Today's Schedule AppWidget** (`TodayScheduleWidget`) and **2×1 Urgent Countdown AppWidget** (`QuizRadarWidget`) updated via Jetpack WorkManager.
- **System Integrations:** First-party Android notifications (including T-24h alerts and **T-3h persistent lock-screen exam chronometer notifications**), system share-target (`ACTION_SEND` intent filter), `quizradar://pair` deep-link handler, and Chrome Custom Tabs PKCE OAuth.
- **Security:** Hardware-backed `EncryptedSharedPreferences` via Android Keystore.

### 2.3 Web Companion Tier (`apps/web/`)
- **Technology:** React 19 + TypeScript PWA sharing 100% of the Desktop UI code.
- **Engine:** Compiled Rust core via `wasm-bindgen` (`core/bindings/wasm/`) running directly in WebAssembly in the browser.
- **Storage:** Client-side transactional IndexedDB object stores (`apps/web/src/pwadapters/idbStore.ts`) mirroring the SQLite v6 schema and migrations.
- **Auth Reality:** Memory-only Google Identity Services (GIS) ephemeral tokens (1-hour lifespan; no refresh tokens stored on disk).

---

## 3. Subsystem Architecture

### 3.1 Local SQLite Store (`core/src/store/`, `SCHEMA_VERSION = 6`)
- Single transactional SQLite database operated via `rusqlite`.
- Strictly typed tables across migrations v1–v6:
  - Core schedule & radar: `courses` (including `credits`, `max_absences`, and JSON `aliases`), `slots` (including `week_parity`), `assessments`, `topics_done` (content-addressed `h<fnv1a64>` keys), `grades`, `events`, `feeds`, `config_kv`, `tokens_meta`, `cached_emails`, `ai_extractions`.
  - Non-AI productivity suite: `attendance`, `flashcards` (Leitner 5-box), `quiz_attempts`, `mistakes`, `study_sessions`.
- Arity of unknown values is strictly preserved (e.g. unannounced exam rooms store SQL `NULL` and render `"—"` rather than hallucinated lecture halls).
- Atomic JSON backup importer (`import_backup`) and additive peer sync merger (`merge_sync_payload`) executing within a single database transaction.

### 3.2 Authentic PKCE Authentication (`core/src/auth/`)
- Fully compliant with RFC 7636 and RFC 8252.
- Desktop loopback redirect (`127.0.0.1:<random-port>`) and Android custom scheme redirect (`com.quizradar.app://oauth/google` and `microsoft`).
- Scope registry guarantees exact least-privilege permissions without permission overreach.

### 3.3 BYOK AI Engine (`core/src/ai/`)
- Optional Bring-Your-Own-Key Google Gemini integration (`gemini-3.8-flash` primary ladder) using the direct `x-goog-api-key` header.
- Content-hash cache (`hash(provider, task, model, input_hash)`) avoids duplicate API requests across timetable edits.
- Deterministic offline fallbacks for all features: regex heuristic email parsers, manual timetable editors, local GPA/cushion calculators, and deterministic topic-based study planners ensure 100% functionality without AI.

### 3.4 Serverless Multi-Device Sync (`quizradar://pair` & Drive AppData)
- **Serverless Peer Sync (`quizradar://pair?d=<deflate-base64url>`):** Compresses a data-only `BackupPayload` into a portable deep link or sync code. Receiving devices run `merge_sync_payload`, performing a non-destructive LWW/union merge of courses, aliases, schedule slots, assessments, grades, and topic progress without overwriting newer local edits.
- **Google Drive AppData Backup (`core/src/sources/drive_backup.rs`):** Optional single-file JSON backup inside the user's private Google Drive `appDataFolder`. Both sync paths are strictly data-only—OAuth tokens and AI keys never leave the device.

### 3.5 Release & Tooling Pipeline (`tooling/`)
- Single source of version truth: `tooling/version.json`.
- Script `tooling/generate-version.mjs` automatically synchronizes all 5 platform sinks (`Cargo.toml`, `package.json`, `tauri.conf.json`, `build.gradle.kts`, `version.ts`).
- Release automation produces verified Tauri desktop installers, Scheme v2/v3 signed Android APKs/AABs, and GitHub Pages PWA bundles.
