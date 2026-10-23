# QuizRadar Rebuild — Documentation Set (v4.3.0 → v5)

_Compile date: 2026-10-23. Compiled from a full static audit of the current repo (`D:\Projects\QuizRadar`), building on the 2026-10-19 audit in `reference-v4-audit.md`._

> **Read this first.** This folder is the complete "what the app does today, why it hurts, and how to rebuild it" dossier. It is written so that you (or a new dev / AI agent) can start a v5 rewrite from zero without touching the old code, while not forgetting a single shipped feature.

---

## Doc index

| Doc | What it is |
|---|---|
| `01-product-spec.md` | The product: purpose, users, **every feature** on desktop/mobile/PWA, all screens & modals, user journeys, design language, feature-parity rebuild checklist. |
| `02-current-architecture.md` | The current app in detail: stack, module inventory, complete data-model schemas, all runtime state files, the full HTTP API route table (~57 routes), all integrations (Gmail/Teams/Moodle/Classroom/GCal/Drive/pairing), the Gemini/AI call sites, the three platform shells, and the build/release pipeline. |
| `03-issues-and-pain-points.md` | **The centerpiece.** Every problem in the current app, categorized, with severity, current status (fixed since the Oct-19 audit / still open), why it is hard to fix at this architecture, and file:line references. Includes the seven root causes that make the codebase hostile. |
| `04-rebuild-architecture.md` | The v5 proposal: recommended framework/stack (with honest decision matrix vs Flutter/Expo), monorepo layout, how auth/storage/sync/AI get re-architected, what features get *deleted* on purpose, migration plan, and CI/release design. |
| `05-ai-features-plan.md` | How to keep every AI feature **free-forever for each user**: BYOK Gemini, free-tier reality (verified 2026), caching, quota UX, honest degradation ladder, privacy disclosure requirements. |

---

## 10-minute TL;DR

### What QuizRadar is
A local-first, no-server academic dashboard for university students. It turns fuzzy announcements ("quiz next week, not this week") into precise calendar items by cross-referencing the announcement against the student's own weekly timetable. Sources: Gmail (OAuth), Microsoft Teams (Graph OAuth), Moodle (iCal/REST), Google Classroom (API), generic ICS feeds, plus a timetable-screenshot importer (Gemini vision). Outputs: dashboard, 7-day calendar, study tasks/readiness, topic checklists, practice quizzes, grades with what-if projections, conflict detection, Google Calendar push, .ics export, exam notifications, Android home-screen widget. Ships as three surfaces on one web bundle: a desktop app (Rust/Axum + wry WebView), an Android APK (Capacitor 6 + hand-written Java native layer), and an installable PWA.

### Why the current architecture "sucks" (the 7 root causes)

1. **Split brain:** the same `/api/*` contract has been implemented **three times** in three languages — Rust (Axum), JavaScript (`app.js` "engine"), and Java (Android loopback `LocalOAuthServer`). Feature work means triple-syncing semantics ("honest failure messages", grade partial-update rules, dedupe keys…), and bugs mirror.
2. **Frontend monolith:** one 10,474-line `app.js` (453 KB) global namespace with inline-`onclick` wiring to ~300 global functions, `index.html` as one 3,000-line template, plus an in-file parity re-implementation of the Rust email parser.
3. **Backend monolith:** `main.rs` = 3,118 lines / 115 KB of router + 30+ handlers + 6 inline HTML string templates + middleware + pairing + URL encoder; `parser.rs` (64 KB) and `gemini.rs` (56 KB) contain hardcoded demo-course remnants from the project's early era.
4. **Three "platforms," zero platform abstraction:** every feature function sprinkles `IS_NATIVE` checks and each of `filterStateByEnabledSources` / back-button modal stacks / Escape-close stacks / course grids gets maintained in two+ places.
5. **Honesty debt history:** fabricated demo data, fake success toasts, and silent fallbacks were load-bearing for a long time (see `reference-v4-audit.md`); many are fixed but remnants still sit in hot paths (demo palettes, demo study plans, Moodle "test" endpoint success-theatre, classroom scope never requested). The architecture allowed these to exist because there are no feature-level HTTP contract tests.
6. **Build/release is manual and multi-source-of-truth:** version `4.3.0` hand-edited in ≥8 places (3 of them stale `3.3.0`/`4.1.0`); the Android web bundle is a committed blob that can silently drift (CI checks only 2 of ~15 files); Android ships a **debug APK**; no code signing on any platform; icons require Python+Pillow+headless-Edge at a hardcoded Windows path.
7. **Secrets & security posture:** plaintext keys/tokens on disk, a hardcoded OAuth client secret in both the Rust binary (XOR-obfuscated) and the APK, `cleartext` HTTP on Android, Microsoft cloud-sync uploads the Teams token to Google Drive, and LAN mode still ships a non-timing-safe PIN comparison with no rate limiting.

### Recommended rebuild in one paragraph (✔ stack locked with maintainer 2026-10-23)

Rebuild as **one Rust core crate consumed by native shells**: the parser/planner/dashboard/store/AI-client logic exists exactly once in Rust; **Tauri 2** wraps it in-process for the Windows/macOS/Linux desktop (React 19 + Vite UI, signed auto-updates, OS keyring), **Kotlin + Jetpack Compose + Glance** is the Android-only-native app (bound to the same core via UniFFI; widget/share/notifications built natively in Kotlin — maintainer's explicit choice over porting the old Java), and the **PWA/iPhone web tier** reuses the same React UI with the core compiled to WASM (companion tier: memory-only Google tokens, no background scans — the accepted "pure local, no server" trade-off). All OAuth is **PKCE with zero client secrets** (kills `LocalOAuthServer.java`, the XOR-obfuscated secrets and the OAuth foreground service), AI stays an explicit BYOK layer, storage is one v5 SQLite DB owned by the core with a v4-backup importer, and every artifact (versions, bindings, installers) is generated by `tooling/` — never hand-edited or committed. Full rationale + phased migration in `04-rebuild-architecture.md` (§0 = locked decision table).

### Result
- One logic implementation instead of 3.
- Zero client secrets anywhere.
- Signed, honest updates (Tauri plugin updater) instead of the 404-prone hand-rolled one.
- A build where forgetting to bump a version is impossible.
- AI stays $0/user with quota-aware UX.

---

## Rebuild checklist pointer

The single most valuable artifact for the rebuild is the **feature parity matrix + screen inventory** at the end of `01-product-spec.md` — treat it as acceptance criteria (it enumerates ~45 behaviors, including easy-to-forget ones: Android back-button modal stack, share-sheet ingest, home-screen widget contract, exam migration on restore, grade what-if, ICS floating-time VCALARMs, translucent-status-bar sync, `.vercel` exclusion…). Do not start building v5 without reading `01` and `03` completely.
