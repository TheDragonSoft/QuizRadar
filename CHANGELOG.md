# Changelog

All notable changes to QuizRadar will be documented in this file.

## [5.9.0] — 2026-11-10

### 🤝 Agent & Contributor Summaries

- **[docs]** Prune the stale multi-agent fleet: verified all 7 non-active worktrees are clean and content-merged (safety-net-ci 4a7b856, privacy-parity fdaa40c, backlog-trio d927202, sync-criticals 7ed0a63, improvement-plan-v5 e72354e, two detached e72354e scratch trees), removed them (dangling dirs force-deleted after registration), pruned, gc'd (62.18 MiB loose -> 46.22 MiB packed) and cleared the .git garbage-ref warning. Active fleet is now exactly 2 trees: main (here) and design/landing-student-clarity (peer in progress).
- **[web, docs]** Purge verified binary screenshot duplicates, disposable debug artifacts, and archive stale audit roadmaps:
  - Removed duplicate screenshot directory `apps/web/docs/screenshots/` (18 files mirror, now writing directly to `docs/screenshots/` without drift).
  - Purged 11 ephemeral debug/verify screenshots from `docs/screenshots/` (`debug-*.png`, `test-screen.png`, `verify-*.png`).
  - Fixed hardcoded ephemeral agent brain directory in `apps/web/e2e/capture-showcase.spec.ts` and updated `capture-non-ai-suite.spec.ts` to write directly to `docs/screenshots/`.
  - Archived completed audit documents `CORE-AUDIT-PLAN.md`, `UI-UX-AUDIT-AND-REDESIGN-PLAN.md`, and `website-improvement-review.md` into `docs/archive/` with explicit historical status banners.
- **[ci, tooling]** Automate GitHub Releases on version changes: wire version-bump.yml to automatically tag and invoke release.yml reusable pipeline whenever SemVer bumps occur or untagged versions exist on main, add workflow_call support and ref checkout to release.yml, and add --tag flag to version-rollup.mjs
- **[docs]** Polish README.md with live website links, web companion launch URL, download center links, refreshed screenshots from the UI redesign, and updated feature showcase
- **[tooling, web, ci]** Move the meta-tests (agentCoordination.test.ts, versionPipeline.test.ts) out of apps/web/src into tooling/__tests__ with a dedicated node-env vitest config wired as root pnpm test:tooling plus a CI web-job step; versionPipeline no longer imports the web app and asserts the generated version.ts file directly. Fixes the recurring 70s vitest-worker timeout that failed every full pnpm test run; web suite drops to ~34s. No behavior or application code changed.
- **[web]** De-monolithize pps/web/src/views/DashboardView.tsx (reduced from 1,503 lines to 472 lines):
  - Created pps/web/src/views/dashboard/ directory with dedicated modular components:
    - ormatters.ts: Date, schedule string, and emoji-stripping helpers (ormatShortDate, ormatCompactCardSchedule, stripRoomPrefix, stripLeadingEmoji, weekRangeLabels)
    - NextUpHero.tsx: Dynamic parallax sky banner with day/night stars and solar glow animations (NextUpHero, NextUpHeroStars)
    - StudyRecommendationCard.tsx: Interactive topic readiness card with collapsible checklist and inline Pomodoro / practice launcher
    - TimelineRow.tsx: Timeline list item with assessment badges, grading chips, and rules display (TimelineRow, SourceIcon)
    - DashboardEmptyStates.tsx: First-run, search empty, and all-clear states
    - RemoteAnnouncementBanner.tsx: Remote announcement banner component wired to feature flags
    - index.ts: Barrel exports
  - Updated pps/web/src/audit/antipatterns.test.ts allow-list to track coursePalette references in the new modular files.
  - Preserved backward compatibility for TasksView.tsx by re-exporting TimelineRow and TimelineRowProps.
- **[web]** De-monolithize pps/web/src/views/SettingsView.tsx (reduced from 1,738 lines to 151 lines):
  - Created pps/web/src/views/settings/ directory with dedicated modules:
    - constants.ts: Shared section ID map (ccount, courses, integrations)
    - SettingsAccountSection.tsx: Profile banner, theme suite (Solar, Obsidian, AMOLED variants), academic rhythm preset selector, OAuth hub cards (Google, Microsoft), and BYOK Gemini configuration
    - SettingsCoursesSection.tsx: Timetable vision import and course enrollment management grid
    - SettingsIntegrationsSection.tsx: Google Calendar sync, University sources (Teams, Classroom), LMS setup guides (Moodle, Canvas, Blackboard), external ICS feeds, JSON backup/restore/reset, anonymous telemetry toggle, software updates, and custom OAuth override settings
    - index.ts: Clean barrel exports
  - Refactored SettingsView.tsx into a lightweight, readable coordinator shell managing layout and section anchor-scrolling.
- **[web]** De-monolithize pps/web/src/state/store.ts:
  - Extracted calendar-date arithmetic and OAuth error classification into pps/web/src/state/dateUtils.ts (ddDaysToIsoDate, getWeekStart, isClientIdSetupError).
  - Extracted local-storage persistence and theme transitions into pps/web/src/state/storage.ts (THEME_STORAGE_KEY, SIDEBAR_STORAGE_KEY, GRADING_SCALE_STORAGE_KEY, FLASHCARDS_STORAGE_KEY, QUIZ_HISTORY_STORAGE_KEY, MISTAKES_STORAGE_KEY, storage helpers, pplyThemeToDocument, isDarkTheme).
  - Extracted initial state payload into pps/web/src/state/initialState.ts (initialFullState).
  - Re-exported all extracted utilities and constants from pps/web/src/state/store.ts for backward compatibility across all consumers.

### 🚀 New Features

- `c778f5c` feat(ci): automate github releases on new version changes

### 🐛 Fixes & Performance

- `5444586` fix(tooling): move meta-tests out of web suite into isolated vitest lane

### 🔧 Maintenance, Docs & Tests

- `a062529` Merge branch 'feat/readme-release-polish' into main
- `0c26b93` docs(readme): polish with live links, refreshed screenshots, and feature guide
- `8017255` Merge branch 'feat/automated-version-releases' into main
- `971bf19` refactor(web): extract dateUtils, storage, and initialState from store (#deslop)
- `4090d11` refactor(web): extract dateUtils, storage, and initialState from store monolith
- `972e819` refactor(web): decompose DashboardView into modular components (#deslop)
- `ac4b443` refactor(web): decompose DashboardView monolith into modular components
- `af31736` refactor(web): slice SettingsView into modular domain sections (#deslop)
- `77aad2f` refactor(web): slice SettingsView monolith into focused domain sections
- `8daef43` Merge branch 'chore/purge-verified-slop' into main
- `b387a67` chore(repo): purge duplicate screenshots, debug captures, and archive audit plans
- `c877e52` Merge branch 'chore/purge-stale-fleet' into main
- `3952780` chore(repo): prune 7 stale worktrees and compact git store
- `81d138c` Merge remote-tracking branch 'origin/main' (release bump v5.8.0)
- `01f21cd` Merge branch 'fix/meta-test-eviction' into main

## [5.8.0] — 2026-11-10

### 🤝 Agent & Contributor Summaries

- **[core, desktop, web, android]** Resolved Phase 1 backlog trio: wired Android deriveStudyTasks academic track passthrough, built manual standalone assessment creation/edit modal UI across desktop/web, and eliminated first-boot SWR cache flicker for legacy positional keys.
- **[core, desktop, web]** Implement DB encryption key management and non-destructive migration, prune/rotate Gemini AI cache per semester, add desktop system tray countdown and notification window, and demote Moodle REST tokens in favor of iCal.
- **[core, web, ci]** Phase 3 Safety Net & CI: SQLite and IndexedDB dual-store migration parity lock contract test and headless Android emulator CI workflow

### 🚀 New Features

- `a6ef6f5` feat(desktop): system tray countdown and notification window
- `341f022` feat(web): prioritize moodle ical over rest tokens in settings
- `d927202` feat: backlog trio - android track passthrough, manual assessment UI, swr cache flicker fix
- `f5e1f70` feat(core): prune and rotate gemini ai cache per semester
- `8de8e54` feat(core): scaffold db encryption key management and non-destructive migration

### 🐛 Fixes & Performance

- `25c44fd` fix(contract): refresh repo.rs source hash after rustfmt
- `a36454a` fix(contract): regenerate wire map after backlog trio merge

### 🔧 Maintenance, Docs & Tests

- `82e7635` Merge remote-tracking branch 'origin/main' (release bump v5.7.0)
- `156ec2a` style(core): rustfmt after privacy-parity merge
- `ef4176c` Merge branch 'feat/privacy-parity' into main
- `fdaa40c` docs: record privacy parity change fragment for multi-agent coordination
- `41f2e75` style(core): clippy clean slice fill and test annotations
- `0c4f930` style(web): prettier formatting on moodle settings and tests
- `9575e33` Merge branch 'feat/backlog-trio' into main
- `e2f72d2` Merge branch 'feat/safety-net-ci' into main
- `4a7b856` docs(changes): add safety-net-ci handoff note
- `3306adb` ci(android): headless emulator job
- `199e6c4` test(contract): lock SQLite and IndexedDB migration parity

## [5.7.0] — 2026-11-10

### 🚀 New Features

- `281a9f4` feat(landing): device notch, highlight swipe, and faq help card polish

## [5.6.0] — 2026-11-09

### 🤝 Agent & Contributor Summaries

- **[core, web, android]** Remove external telemetry across Web & Android to uphold local-first privacy doctrine; implement interval union cushion merging and 0-min untimed honesty doctrine; dynamic GPA scale ceilings and mixed weighting non-drop behavior; Android bi-weekly timetable parity and case-insensitive What-If calculation.

### 🐛 Fixes & Performance

- `8452c44` fix(core): cushion interval union, GPA scale ceilings, and zero telemetry

### 🔧 Maintenance, Docs & Tests

- `ed716ff` Merge branch 'fix/telemetry-p0' into main

## [5.5.0] — 2026-11-09

### 🤝 Agent & Contributor Summaries

- **[core, desktop, android, web, tooling, docs]** Complete audit plan batches 1-6: sync hardening (S1, S2, S3, S6, S12, S14, S19), store safety & migrations (P3, P4, P25, S35, S40, P19, P20, P22), AI honesty & local timezone alignment (P5, P30, P1, S42, S8, P2), announcement email cache with SQLite schema v5 (S37, S39), timetable-derived week start & regional parity anchoring, shared pure study algorithms (streak & Leitner in core::plan::study for Store and WASM parity), contract spec M1 sync, and clippy/ktlint/vitest hardening.

### 🚀 New Features

- `18bdf87` feat(landing): convert FAQ to 2-column balanced layout with sidebar guarantees
- `7ed0a63` feat(core): complete audit batches 1-6 across sync, store, ai honesty, and wasm parity
- `dbe20c0` feat(landing): restore android section with qr phone screen, replace slop copy, and 2-column faq
- `a723c51` feat(landing): platform-specific companion card with qr code & clean workflow cards

### 🐛 Fixes & Performance

- `1916675` fix(core): harden sync security parallelize AI email extraction and optimize selectors
- `e87a36f` revert(landing): restore standard layout with jargon removed and 10/10 typography craft
- `cad1808` fix(sync): resolve critical sync pagination, backoff, and token races

### 🔧 Maintenance, Docs & Tests

- `69eb1c8` Merge branch 'fix/sync-criticals-and-hardening' into main
- `7b881f8` Merge branch 'design/landing-student-clarity' into main
- `8244d33` style(landing): achieve 10/10 critique with contrast, a11y, and responsive polish
- `378939c` style(landing): refine typography and remove AI template tells
- `745f162` style(landing): clarify student copy and replace developer jargon

## [5.4.0] — 2026-11-08

### 🤝 Agent & Contributor Summaries

- **[core, web, desktop]** Intelligent hybrid email extraction: deterministic course-code/name matching in core to avoid Gemini token waste, Gemini for fuzzy dates/times, AI extraction cache table, and UI transparency in assessment detail

### 🚀 New Features

- `9f9d066` feat(email-pipeline): merge hybrid Gemini extraction
- `7dfc54d` feat(email-pipeline): intelligent hybrid email extraction with Gemini transparency

### 🔧 Maintenance, Docs & Tests

- `6b59a07` style(core): format, fix clippy push, update schema v5 tests
- `ec1ed8b` ci(landing): add dedicated GitHub Pages deploy workflow

## [5.3.0] — 2026-11-08

### 🤝 Agent & Contributor Summaries

- **[web, tooling, ci, docs]** - Add an Astro marketing & downloads site (`apps/landing`) with a product tour, per-platform download
    matrix, FAQ, and honest product copy sourced from `tooling/version.json`.
  - Add `tooling/build-site.mjs`, a unified public build that emits the marketing site and mounts the
    Web Companion PWA at `/app/` inside it.
  - Wire the landing package into the pnpm workspace, eslint/prettier ignores, CI (static build step),
    and the GitHub Pages release workflow (now deploying `apps/landing/dist`).
  - Regenerate the desktop Tauri icon set to match the current brand artwork.

### 🚀 New Features

- `4c4fd89` feat(landing): add Astro marketing site and unified public build
- `3c45337` feat(landing): add Astro marketing site and unified public build

## [5.2.0] — 2026-11-08

### 🤝 Agent & Contributor Summaries

- **[web, tooling, docs]** Unify NextUp and TimelineHorizon upcoming pipelines, implement adaptive parallax canopy collapse, widescreen study deck de-duplication, academic timeline jargon calibration, and toast concurrency cap with auto-dismiss

### 🚀 New Features

- `82128aa` feat(dashboard): refine parallax canopy, soften horizon jargon, and cap toast notifications
- `9c775e1` feat(observatory): position hero at top of canopy and implement proactive balanced conflict scheduler

### 🔧 Maintenance, Docs & Tests

- `a8357f8` phase(dogfood): verify live Android emulator and Desktop test suite

## [5.1.0] — 2026-11-08

### 🤝 Agent & Contributor Summaries

- **[tooling, ci, docs, web]** Add conflict-free multi-agent handoff fragments (changes/*.md), worktree conflict-radar preflight CLI, local git hooks + CI hygiene gates, tag-aware changelog generation, slimmed STATUS.md (with 2,088-line v5.0 log archived), and automatic GitHub Actions SemVer rollup on merge to main

### 🚀 New Features

- `03b57d7` feat(tooling): add multi-agent versioning, preflight radar, and changelog rollup
- `1a8d607` feat(suite): implement full non-ai feature suite for web, desktop and android
- `a836beb` feat(observatory): implement astronomical timeline horizon and widescreen mission control
- `1a8e170` feat(redesign): execute cross-platform UI/UX redesign and non-ai suite integration
- `db1048d` feat(oauth): bake the maintainer Google client into desktop and android

### 🐛 Fixes & Performance

- `be9ae0b` fix(rust): complete the academic-track refactor; land the settings-page migration (green tree)
- `cdf0728` fix(android): oauth client ids auto-save + inline in onboarding; regenerate stale uniffi bindings

### 🔧 Maintenance, Docs & Tests

- `e174ff1` chore(web): harden testids, add defensive null checks to FocusView, and update non-ai suite showcase captures
- `374877e` chore(test): add testid to sidebar navigation buttons
- `54acaa0` chore: setup feature/non-ai-suite branch and initial PROJECT.md
- `d1e5aec` chore: preserve uncommitted observatory and theme updates as baseline
- `8446a16` chore: format the swept impeccable critique notes
- `abfd939` chore: remove a stray shell-artifact file
- `08d208d` docs: STATUS round 13 - content-addressed topic keys, rhythm wiring, settings-page redesign
- `93f736f` docs: STATUS round 12 - v5.0.0 released, artifacts and updater manifest verified

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
