# QuizRadar

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Desktop%20%7C%20Android%20%7C%20Web%20PWA-blue)](docs/architecture-v5.md)
[![Rust](https://img.shields.io/badge/Core-Rust%202021-orange.svg)](core/)
[![Zero Server](https://img.shields.io/badge/Architecture-Zero--Server%20%2F%20Local--First-success)](PRIVACY.md)

**QuizRadar** is a local-first, zero-server academic radar for university students. It resolves fuzzy announcements (_"Class Quiz 1 next week, not this week"_) into exact calendar items by cross-referencing each announcement against your weekly timetable, then manages the resulting exam radar — complete with conflict detection, readiness tracking, study recommendations, practice quizzes, grade what-if calculations, and home screen countdown widgets.

---

## 1. Platform Matrix

| Platform                      | Tier      | Shell Architecture                          | Auth & Storage                                                        | Native Edge Features                                                                                            |
| ----------------------------- | --------- | ------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Desktop** (Win, Mac, Linux) | Primary   | **Tauri 2** (In-Process IPC) + **React 19** | Loopback PKCE OAuth; OS Keyring (`keyring-rs`); SQLite                | Signed Auto-Updater (`tauri-plugin-updater`), native menus, system file dialogs                                 |
| **Android** (Phone & Tablet)  | Native    | **Kotlin 2.x** + **Jetpack Compose M3**     | Custom-scheme PKCE OAuth; `EncryptedSharedPreferences`; UniFFI SQLite | Glance 2x1 AppWidget, WorkManager periodic checks & T-24/digest notifications, `ACTION_SEND` share-sheet ingest |
| **Web Companion** (PWA)       | Companion | **React 19** + **WebAssembly Core**         | In-memory ephemeral GIS tokens (1-hour lifespan); IndexedDB SQLite    | Service Worker offline caching, responsive mobile & desktop web layouts                                         |

> **Note on PWA Limits:** The Web Companion PWA runs entirely in-browser without a backend server. In compliance with browser security models, it uses ephemeral 1-hour Google Identity Services tokens (no persistent refresh tokens) and does not perform background scans. For full background automation, use the Desktop or Android app.

---

## 2. Core Capabilities

- **Fuzzy Announcement Resolution:** Automatically cross-references email and LMS announcements against your course schedule, anchoring phrases like _"next week"_ or _"the following Tuesday"_ to exact timetable lecture slots.
- **Multi-Source Ingestion:**
  - **Gmail:** Scans recent candidate announcements across 5 targeted queries with deduplication.
  - **Microsoft Teams:** Microsoft Graph client with heuristics for channel posts.
  - **Moodle LMS:** Connects via REST API token or private iCalendar (`.ics`) webcal links.
  - **Google Classroom:** Direct ingestion of active coursework and due dates.
- **Academic Dashboard & Conflict Radar:**
  - 7-day upcoming assessment KPIs and exam-type breakdown pills.
  - Overall exam readiness score dynamically calculated from syllabus topics.
  - Automatic conflict detection with instant scheduling of dedicated study blocks.
- **What Should I Study?** Prioritized study recommendations with optimistic topic completion checkoffs.
- **Interactive Calendar & Roadmap:**
  - 7-day (Desktop) and 3-day (Mobile) overlapping lane timetable views with visual exam glow.
  - Daily study roadmap and per-course readiness grid.
  - One-click iCalendar (`.ics`) file export and two-way Google Calendar push.
- **Grades & What-If Projection:** Record achieved scores and simulate required finals scores to achieve your target letter grades.
- **Study Support Tools:**
  - AI-assisted practice quiz generator with labeled on-device deterministic fallbacks.
  - Integrated Pomodoro focus timer with audio completion chimes and topic completion links.
- **v4 Data Migration:** One-click import tool restoring courses, assessments, grades, and topic progress from legacy QuizRadar v4 backup files.

---

## 3. Privacy & The Honesty Doctrine

QuizRadar is engineered with a strict **Honesty Doctrine**:

1. **Zero Server Architecture:** QuizRadar operates no servers, relays, or central databases. All data remains on your physical device.
2. **Zero Fabricated Data:** If a room, instructor, or time is unannounced, QuizRadar renders `"—"` rather than hallucinating placeholder lecture halls.
3. **No Embedded Secrets:** Authentication uses standard PKCE OAuth 2.0 without embedded client secrets.
4. **Bring-Your-Own-Key (BYOK) AI:** Optional Google Gemini AI features use your personal API key via direct HTTP headers. When offline or unconfigured, QuizRadar automatically uses fully local, deterministic heuristics.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for full policies.

---

## 4. Development & Building from Source

### Prerequisites

- **Rust:** Stable toolchain (`rustup update stable`)
- **Node.js:** Node.js 20+ with `pnpm`
- **Java:** JDK 21 (Temurin / Adoptium)
- **Android SDK:** Command-line Tools, API Platform 35, Build-Tools 34.0.0+

### Build Commands

```powershell
# 1. Install frontend dependencies
pnpm install

# 2. Run Rust Core tests
cargo test --workspace

# 3. Typecheck and lint Web UI
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test

# 4. Run Android lint and unit tests
cd apps/mobile-android
.\gradlew.bat ktlintCheck testDebugUnitTest
```

---

## 5. Documentation

- [Architecture Specification (v5)](docs/architecture-v5.md)
- [Privacy Policy & AI Consent Disclosure](PRIVACY.md)
- [Security Policy & Vulnerability Reporting](SECURITY.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [License (MIT)](LICENSE)
