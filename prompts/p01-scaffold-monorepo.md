# Phase 01 — Scaffold the monorepo

> Fresh session. Read `AGENTS.md` and `docs/STATUS.md` (create it if missing) before typing any code. This phase produces an **empty but correct** skeleton — every later phase fills it.

**Read first:** `AGENTS.md` (all), `docs/rebuild/04-rebuild-architecture.md` §4.1 (layout) + §0 (locked stack), `prompts/README.md`.

## Goal
Standing scaffolding that all subsequent phases assume: Rust workspace + core crate, Tauri 2 desktop app, React 19/Vite web app, Android Compose app skeleton, version generator, status tracker, lint/test wiring for all three ecosystems.

## Build

1. **Rust workspace** (root `Cargo.toml`, workspace members only):
   - `core/` — crate `quizradar-core`, edition 2021, deps: `serde`, `serde_json`, `chrono`, `regex`, `reqwest` (json, rustls; **no default features that pull native-tls**), `rusqlite` (bundled), `thiserror`. NO tauri/wry/tao deps. Module placeholder files: `types.rs`, `parse/mod.rs`, `plan/mod.rs`, `cal/mod.rs`, `ai/mod.rs`, `store/mod.rs`, `auth/mod.rs`, `sources/mod.rs`, `lib.rs`. Lint config in `core/Cargo.toml`: `[lints.rust] unsafe_code = "deny"`, `unwrap_used = "warn"`, clippy pedantic-lite set. Give each placeholder module **real honest structs** where trivial (e.g. `types.rs` with `Assessment`, `Course`, `ScheduleSlot` skeletons matching `docs/rebuild/02-current-architecture.md` §3) — acceptable as starting points, refined in phases 02–04.
   - `apps/desktop/src-tauri/` — Tauri 2 app: window 1420×880 (min 960×620), loads production build of `apps/web` dist or dev URL; plugins to declare: `tauri-plugin-updater`, `tauri-plugin-single-instance`, `tauri-plugin-opener`. Commands file stubs: `state() -> ()` returning honest `NotImplemented` errors is **forbidden** — instead emit compile-time TODO list item in STATUS and implement truthfully where cheap (e.g. `version()` command).
2. **Web app** `apps/web/` — Vite 6 + React 19 + TS strict, Tailwind 3 with a **tokens preset** file `apps/web/src/tokens.css` (copy the design tokens from `docs/rebuild/01-product-spec.md` §6 exactly: accent `#1a73e8`, dark base `#0b0f19`, surfaces, exam-glow shadow, course palette derivation util placeholder, Inter self-hosted fonts from `apps/web/public/fonts/` — download Inter var latin woff2s or wire fontsource; do NOT use font CDNs). App skeleton: `App.tsx` with view-router stub rendering three placeholders (`Dashboard/Tasks/Calendar`) + `<ModalStack/>` empty provider + zustand store stub `useStore`. Vitest + `@testing-library/react` wired; eslint + prettier configured (shared config in root, extends @react-recommended + strict TS).
3. **Android app** `apps/mobile-android/` — Gradle AGP 8.5+, Kotlin 2.x, compileSdk 35, minSdk 26; Compose BOM; M3; `applicationId com.quizradar.app`; single `MainActivity` with Compose `MaterialTheme(useThemeToken = QuizRadarTheme)` rendering placeholder 3-tab scaffold (bottom nav Dashboard/Tasks/Calendar + Focus entry). Add `ktlint` + Android unit test wiring. **UniFFI binding stub**: `app/src/main/java/.../core/QuizRadarCore.kt` interface file placeholder that phases 02+ replace with generated bindings — document the generation command in STATUS (machine will build Docker? no — plain command; if tooling missing, record blocker).
4. **Tooling** `tooling/`:
   - `generate-version.mjs`: reads `tooling/version.json` (`{ "version": "5.0.0-alpha.1" }`) and writes/injects it into `apps/web/package.json#version`, `apps/desktop/src-tauri/tauri.conf.json#version`, `apps/mobile-android/app/build.gradle.kts` versionName/Code (derive code: major*10000+minor*100+patch), and `apps/web/vite.config.ts` `__APP_VERSION__` define + SW cache key. Run `node tooling/generate-version.mjs --check` in CI to fail when stale.
   - `README-for-agents`: not needed.
5. **Culture files**: root `Makefile`-equivalent `task.ps1`? No — plain `package.json` at root (pnpm workspace root) with scripts: `lint`, `typecheck`, `test`, `core:watch`, `generate:version`, `tauri dev/build` helpers. `docs/STATUS.md` seeded with phase table (checkboxes for 01–16 exactly as `prompts/README.md` manifest) + §Commands (record commands as you wire them).
6. `.github/workflows/ci.yml` **minimal PR CI** now (job matrix: rust (fmt/clippy/test), web (lint/typecheck/vitest), android (assembleDebug)) and replace/extend in phase 15 — honest placeholder jobs that run the real commands already wired.

## Acceptance
- [ ] `cargo check`/`cargo test` (workspace) green from repo root; `cargo fmt --check` and `cargo clippy -D warnings` clean
- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test` green in `apps/web`
- [ ] `cd apps/desktop && cargo tauri dev` opens a window (webview shows placeholder shell); `cargo tauri build --debug` produces an exe
- [ ] `apps/web` build output works INSIDE the tauri window (configure `tauri.conf.json` frontendDist to `../../web/dist`)
- [ ] `generate:version --check` passes and stamps all four version sinks
- [ ] Android: `apps/mobile-android/gradlew assembleDebug` builds (skip with recorded blocker if SDK absent here; CI covers)
- [ ] `docs/STATUS.md` exists with phase 01 ticked + all commands used recorded

## Guardrails
- No fabricated placeholder DATA anywhere (empty lists are correct).
- No version string hardcoded anywhere except `tooling/version.json`.
- No `todo!()`/`unwrap()` in `core/` (warnings-as-blockers in CI).
- Do not touch `docs/rebuild/` or `prompts/`.
- Commit: `phase(1): scaffold monorepo (core/tauri/web/android/tooling)`.
