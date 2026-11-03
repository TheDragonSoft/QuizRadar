# Changelog

All notable changes to QuizRadar will be documented in this file.

## [5.0.0] — 2026-11-03

**QuizRadar** is a local-first, zero-server academic radar and calendar for university students.
It automatically detects quizzes, exams, and homework deadlines from university sources
(Gmail, Microsoft Teams, Moodle, and Google Classroom) and cross-references them against
your weekly timetable without requiring any central backend server or cloud relay.

### 🏗 Rebuild Milestones (Phases)

- `c2f3eeb` phase(20): impeccable native audit fixes - dark TODAY chip contrast (onError), 48dp touch targets, nav rail at >=600dp, predictive back flag, 11sp labels
- `0fbf602` phase(20): android now ships the desktop radar squircle as its logo, plus the onboarding flag bug found while verifying
- `f71a909` phase(20): readiness sweep - the native core ships in the APK, no launch ANR, honesty fixes on every tier
- `4cab0e3` phase(19): mock-data UI sweep + reviewer fixes - course names not raw ids, honest empty states, palette arrow nav, >=11px fonts, >=24px targets, tier-honest account copy, confirmed sign-out, scan overlay auto-close, onboarding dismiss fix
- `b3b78ce` phase(18): full testing stack + v4 dashboard port + live UI sweep fixes
- `54d5cec` phase(17): finish post-ship audit - honest scan overlay, real cancel, sync stamps, Gemini ladder
- `fd28c3f` phase(16): migration UX + docs honesty pass + v1.0 cut
- `5fcda6d` phase(15): release pipeline (signed tauri updater, release apk, pwa deploy, notes)
- `022e49b` phase(14): android native edge (pkce custom-scheme oauth, glance widget, share ingest, notifications)
- `f838369` phase(13): android compose UI parity (views + detail/pomodoro/practice)
- `d784963` phase(12): android scaffold + uniFFI core bindings + compose skeleton
- `586a2df` phase(11): pwa tier (wasm core + adapters + service worker + help parity page)
- `fcf92dc` phase(10): web flows (onboarding, settings, AI, search, backup, updater, practice)
- `c587a3a` phase(9): web dashboard/tasks/calendar views + assessment detail
- `2f5d14b` phase(8): web UI foundation (tokens, chrome, modal stack, state layer)
- `9c89662` phase(7): desktop tauri shell + full IPC surface over core
- `a7d7e74` phase(6): core calendar push/ICS + BYOK AI provider layer
- `2053048` phase(5): core source fetchers + honest sync orchestrator
- `01807f6` phase(4): core store + migrations + v4 importer + data-only Drive backup
- `fad67b5` phase(3): core plan/derive (dashboard, tasks, conflicts, study blocks)
- `4ad5b41` phase(2): core types + email/ics parsing with golden fixtures
- `ee966be` phase(1): scaffold monorepo (core/tauri/web/android/tooling)

### 🚀 New Features

- `0d6b585` feat(v5): agents.md, prompt pack (16 phases), status tracker, clean gitignore

### 📚 Documentation & Parity

- `f1a66f7` docs: cite phase(4) commit in parity checklist
- `81c50b2` docs: cite phase(3) commit in parity checklist

### 🔒 Privacy, Secrets & Honesty Doctrine

- **100% Local Processing**: Tokens, cached announcements, grades, and custom events stay strictly on the device.
- **Zero Backend Server**: Direct HTTPS requests via PKCE OAuth to Google and Microsoft APIs; no relay, no tracking.
- **Honesty First**: Missing rooms display as `"—"` rather than invented hall numbers. Undated announcements stay in drafts.
- **BYOK Gemini Option**: AI features use the user's Google AI Studio key via `x-goog-api-key` header with explicit consent.

### 📦 Available Artifacts & Downloads

- 🪟 **Desktop (Windows)**: `QuizRadar_5.0.0_x64-setup.exe` (NSIS setup) & `QuizRadar-Portable-win-x64.zip`
- 📱 **Mobile (Android)**: `QuizRadar-v5.0.0.apk` (Signed release APK with Glance 2x1 widget & notifications)
- 🌐 **Web PWA Companion**: Hosted on GitHub Pages at [https://thedragonsoft.github.io/QuizRadar/](https://thedragonsoft.github.io/QuizRadar/)
- 🔐 **Checksums & Signatures**: Verified against `SHA256SUMS.txt` and updater `latest.json`

### 👨‍💻 Maintainer Notes

- Release built automatically from tag `v5.0.0` via GitHub Actions.
- Desktop updates verified with minisign public key configured in `tauri.conf.json`.
- Android release signed with release keystore and verified with `apksigner`.

## [5.0.0] — 2026-10-25

**QuizRadar** is a local-first, zero-server academic radar and calendar for university students.
It automatically detects quizzes, exams, and homework deadlines from university sources
(Gmail, Microsoft Teams, Moodle, and Google Classroom) and cross-references them against
your weekly timetable without requiring any central backend server or cloud relay.

### 🏗 Rebuild Milestones (Phases)

- `5fcda6d` phase(15): release pipeline (signed tauri updater, release apk, pwa deploy, notes)
- `022e49b` phase(14): android native edge (pkce custom-scheme oauth, glance widget, share ingest, notifications)
- `f838369` phase(13): android compose UI parity (views + detail/pomodoro/practice)
- `d784963` phase(12): android scaffold + uniFFI core bindings + compose skeleton
- `586a2df` phase(11): pwa tier (wasm core + adapters + service worker + help parity page)
- `fcf92dc` phase(10): web flows (onboarding, settings, AI, search, backup, updater, practice)
- `c587a3a` phase(9): web dashboard/tasks/calendar views + assessment detail
- `2f5d14b` phase(8): web UI foundation (tokens, chrome, modal stack, state layer)
- `9c89662` phase(7): desktop tauri shell + full IPC surface over core
- `a7d7e74` phase(6): core calendar push/ICS + BYOK AI provider layer
- `2053048` phase(5): core source fetchers + honest sync orchestrator
- `01807f6` phase(4): core store + migrations + v4 importer + data-only Drive backup
- `fad67b5` phase(3): core plan/derive (dashboard, tasks, conflicts, study blocks)
- `4ad5b41` phase(2): core types + email/ics parsing with golden fixtures
- `ee966be` phase(1): scaffold monorepo (core/tauri/web/android/tooling)

### 🚀 New Features

- `0d6b585` feat(v5): agents.md, prompt pack (16 phases), status tracker, clean gitignore

### 📚 Documentation & Parity

- `f1a66f7` docs: cite phase(4) commit in parity checklist
- `81c50b2` docs: cite phase(3) commit in parity checklist

### 🔒 Privacy, Secrets & Honesty Doctrine

- **100% Local Processing**: Tokens, cached announcements, grades, and custom events stay strictly on the device.
- **Zero Backend Server**: Direct HTTPS requests via PKCE OAuth to Google and Microsoft APIs; no relay, no tracking.
- **Honesty First**: Missing rooms display as `"—"` rather than invented hall numbers. Undated announcements stay in drafts.
- **BYOK Gemini Option**: AI features use the user's Google AI Studio key via `x-goog-api-key` header with explicit consent.

### 📦 Available Artifacts & Downloads

- 🪟 **Desktop (Windows)**: `QuizRadar_5.0.0_x64-setup.exe` (NSIS setup) & `QuizRadar-Portable-win-x64.zip`
- 📱 **Mobile (Android)**: `QuizRadar-v5.0.0.apk` (Signed release APK with Glance 2x1 widget & notifications)
- 🌐 **Web PWA Companion**: Hosted on GitHub Pages at [https://thedragonsoft.github.io/QuizRadar/](https://thedragonsoft.github.io/QuizRadar/)
- 🔐 **Checksums & Signatures**: Verified against `SHA256SUMS.txt` and updater `latest.json`

### 👨‍💻 Maintainer Notes

- Release built automatically from tag `v5.0.0` via GitHub Actions.
- Desktop updates verified with minisign public key configured in `tauri.conf.json`.
- Android release signed with release keystore and verified with `apksigner`.

## [5.0.0-alpha.1] — 2026-10-25

**QuizRadar** is a local-first, zero-server academic radar and calendar for university students.
It automatically detects quizzes, exams, and homework deadlines from university sources
(Gmail, Microsoft Teams, Moodle, and Google Classroom) and cross-references them against
your weekly timetable without requiring any central backend server or cloud relay.

### 🏗 Rebuild Milestones (Phases)

- `022e49b` phase(14): android native edge (pkce custom-scheme oauth, glance widget, share ingest, notifications)
- `f838369` phase(13): android compose UI parity (views + detail/pomodoro/practice)
- `d784963` phase(12): android scaffold + uniFFI core bindings + compose skeleton
- `586a2df` phase(11): pwa tier (wasm core + adapters + service worker + help parity page)
- `fcf92dc` phase(10): web flows (onboarding, settings, AI, search, backup, updater, practice)
- `c587a3a` phase(9): web dashboard/tasks/calendar views + assessment detail
- `2f5d14b` phase(8): web UI foundation (tokens, chrome, modal stack, state layer)
- `9c89662` phase(7): desktop tauri shell + full IPC surface over core
- `a7d7e74` phase(6): core calendar push/ICS + BYOK AI provider layer
- `2053048` phase(5): core source fetchers + honest sync orchestrator
- `01807f6` phase(4): core store + migrations + v4 importer + data-only Drive backup
- `fad67b5` phase(3): core plan/derive (dashboard, tasks, conflicts, study blocks)
- `4ad5b41` phase(2): core types + email/ics parsing with golden fixtures
- `ee966be` phase(1): scaffold monorepo (core/tauri/web/android/tooling)

### 🚀 New Features

- `0d6b585` feat(v5): agents.md, prompt pack (16 phases), status tracker, clean gitignore

### 📚 Documentation & Parity

- `f1a66f7` docs: cite phase(4) commit in parity checklist
- `81c50b2` docs: cite phase(3) commit in parity checklist

### 🔒 Privacy, Secrets & Honesty Doctrine

- **100% Local Processing**: Tokens, cached announcements, grades, and custom events stay strictly on the device.
- **Zero Backend Server**: Direct HTTPS requests via PKCE OAuth to Google and Microsoft APIs; no relay, no tracking.
- **Honesty First**: Missing rooms display as `"—"` rather than invented hall numbers. Undated announcements stay in drafts.
- **BYOK Gemini Option**: AI features use the user's Google AI Studio key via `x-goog-api-key` header with explicit consent.

### 📦 Available Artifacts & Downloads

- 🪟 **Desktop (Windows)**: `QuizRadar_5.0.0-alpha.1_x64-setup.exe` (NSIS setup) & `QuizRadar-Portable-win-x64.zip`
- 📱 **Mobile (Android)**: `QuizRadar-v5.0.0-alpha.1.apk` (Signed release APK with Glance 2x1 widget & notifications)
- 🌐 **Web PWA Companion**: Hosted on GitHub Pages at [https://thedragonsoft.github.io/QuizRadar/](https://thedragonsoft.github.io/QuizRadar/)
- 🔐 **Checksums & Signatures**: Verified against `SHA256SUMS.txt` and updater `latest.json`

### 👨‍💻 Maintainer Notes

- Release built automatically from tag `v5.0.0-alpha.1` via GitHub Actions.
- Desktop updates verified with minisign public key configured in `tauri.conf.json`.
- Android release signed with release keystore and verified with `apksigner`.
