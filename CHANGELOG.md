# Changelog

All notable changes to QuizRadar will be documented in this file.

## [5.11.2] — 2026-11-13

### 🤝 Agent & Contributor Summaries

- **[core]** Gmail scan no longer discards search-phase notes: a second shadowing notes declaration silently dropped per-query truncation warnings and the partial-query-failure warning; the partial-failure note now names every failed query with its error instead of only the first. Email cache ordering and CACHED_REFRESH_LIMIT selection no longer treat Gmail ids as a chronological contract (per-query newest-first concatenation is not globally newest-first); both rank by internalDate with id as deterministic tiebreak. Four regression tests added; GmailRunStats fields unchanged so no UniFFI/WASM contract regen.

### 🐛 Fixes & Performance

- `9050a21` fix(core): preserve gmail search warnings and order email cache by internal date

### 🔧 Maintenance, Docs & Tests

- `ff8ab67` Merge pull request #24 from TheDragonSoft/fix/gmail-scan-notes-ordering

## [5.11.1] — 2026-11-13

### 🤝 Agent & Contributor Summaries

- **[web, tooling]** Authenticated UX sweep harness: the app is now served from http://localhost:4317, the one origin both OAuth providers accept, so the signed-in run needs no Azure app registration and no secret. The harness binds Vite to the IPv4 loopback literal and maps the Chromium localhost name to it, so the origin the providers validate stays http://localhost:4317 while the socket reaches the bound address, and it records that origin in the evidence bundle. The public Google and Microsoft client ids are written through the app own Settings form before sign-in. Measured live against the real endpoints: Google GIS accepts the bundled client id at http://127.0.0.1:4317 only and answers Error 400: origin_mismatch at localhost, while an older public client id accepts both; the Microsoft v2 endpoint accepts the desktop shell bundled public Graph CLI client id at http://localhost:PORT/ exactly and rejects 127.0.0.1 (AADSTS50011) and any sub-path. Sign-in failure details now name where the popup had reached, reduced to its origin and path, so a dismissed or stalled popup is diagnosable from the evidence bundle without leaking an OAuth code, a token or a session identifier. Also corrects two false Settings and copy promises about a bundled Microsoft client that the browser tier does not have, plus the stale origin comment in browserSources.ts. Merged main into the branch and repaired two release-pipeline defects the merge exposed: the version rollup wrote a CHANGELOG whose fragment bullets were not Prettier clean, so the release bot broke the repo own format gate, and the tracked service worker was left stamped 5.10.0 by the v5.11.0 bump, which failed the PWA precache test.

### 🐛 Fixes & Performance

- `11fbde4` fix(tooling): restamp the tracked service worker during the version rollup
- `ba08dbb` fix(web): restamp the tracked service worker for v5.11.0
- `ee2d0c0` fix(tooling): keep the generated CHANGELOG Prettier-clean
- `3dfb393` fix(web): name where a sign-in popup reached when the sweep fails
- `c74372e` fix(web): run the authenticated UX sweep from an origin both OAuth providers accept

### 🔧 Maintenance, Docs & Tests

- `8a8d722` Merge pull request #25 from TheDragonSoft/test/authenticated-ux-audit
- `12902de` docs(changes): record the merged gate results and the release-pipeline repairs
- `2ebd0c9` Merge remote-tracking branch 'origin/main' into test/authenticated-ux-audit
- `47ed7c2` test(web): add the authenticated UX sweep harness (manual, real accounts)

## [5.11.0] — 2026-11-13

### 🤝 Agent & Contributor Summaries

- **[web, tooling, docs]** Speed up the web test loop and purge disposable tooling: WASM staleness now accounts for tooling/version.json, apps/web test scripts no longer build WASM/SW, Vitest runs on the threads pool with per-file isolation (330 tests in ~19s vs the previous ~85s with 15 failures), and the redundant view/store wrapper modules plus the one-off ui-sweep/build-ui-review harnesses are removed.
- **[core, android, web]** Android quality overhaul: repaired event date_iso write contract, OAuth client resolution + token lifetime + persisted PKCE transactions, exposed canonical store ops (feeds, attendance, study sessions, quiz attempts, reset_all) through UniFFI, honest persisted Focus analytics and attendance, real reminder countdowns with stale-notification cleanup, weighted grade-target sharing the GPA weighting with parity tests, labeled practice-quiz provider fallback, native scan cancellation before the transactional reset, six-step onboarding with the verbatim AI free-tier disclosure and consent-before-import, manual assessment creation, Grade Center with honest unknowns, compact dashboard with persistent Settings entry and Grades destination, calendar pager affordance with re-anchoring and time/room on class blocks, and split theme_mode/preferred_dark_theme so AMOLED survives mode switches. All implementation by GLM 5.3 Flash subagents; parent performed independent review, fresh-install emulator acceptance and routed repairs.

  Round 2 (design-system overhaul, "Quiet instrument"): new docs/ANDROID-DESIGN-SYSTEM.md; theme token layer (typography scale, radius slots, StatusColors with measured WCAG ratios) in ui/theme/QuizRadarTheme.kt plus reusable control styles in ui/theme/ComponentStyles.kt (filledPill/tonalPill/destructivePill, quietChipColors+ChipLeadingCheck, quietCard trio, quietTextFieldColors); calendar chrome rebuilt per researched calendar-UI patterns into one title row (tappable range -> M3 DatePickerDialog, Today pill, Day/3-Day/Week segments, week arrows) + a single day strip that IS the pager (M3 SingleChoiceSegmentedButton replaced by a hand-built selectable row because material3 1.3.1's SegmentedButton swallows synthetic taps in this app; labels content-sized so "3-Day" never ellipsizes); viewModel.today exposed from the injected clock so Today marks match the core; every remaining screen group (dashboard, tasks/focus, settings, onboarding, sheets, grades, app shell) swept onto one system - zero hardcoded fontSize literals left in polished files, one filled pill per flow, destructive pills only for destructive actions, tnum on all data, 8/12/16/24/32 spacing, 20dp screen padding; honest strings, test-pinned labels and the verbatim AI disclosure byte-preserved.

- **[core, web, desktop, ci, tooling]** Integration + interface-polish pass over the web-desktop-deslop batches (persistence/timer, core-derived GPA/cushion, CI gates), then the reviewer-correction round. Integration: removed the inert analytics tier end-to-end (lib/analytics.ts was a 100% no-op; deleted lib+test, 11 call sites, main.tsx init, VITE_POSTHOG_* env types, the never-rendering RemoteAnnouncementBanner and the misleading settings section; /posthog is now a CI-enforced banned pattern). Fixed a real core divergence: coursePalette.ts hashCourseId now byte-matches core preset_course_colors (UTF-8 bytes + unsigned wrap; ~37% of ids picked a different accent before). browserAiCoreParity.test.ts pins the browser TIMETABLE_INSTRUCTION, Flash ladder and palette against the Rust sources at test time. 16px mobile input floor + htmlFor/id pairs on the two OAuth overrides; audit/settingsIntegrations.test.tsx pins both.Reviewer corrections (all applied, none documented-away):

  1. Backup export time fabrication REMOVED (rpcAdapter): no `?? "09:00"`/`?? "10:30"` anywhere; slots without WELL-FORMED HH:MM times (missing/empty/malformed like "25:99") are partitioned into explicit non-domain `unscheduled_slots` metadata (raw values preserved, never invented) and the legacy `invented_slot_times` flag has no producer anymore (importer keeps reading it for old v5.10 files and SKIPS those slots with a warning — core too, via `ImportReport.warnings`). Web import now runs in two phases: ALL normalization/validation (incl. per-entry study sanitization, topic-key migration, feed-id and grade checks) completes BEFORE the first destructive write, so a structurally invalid file (e.g. corrupt grade) is rejected with live data untouched.
  2. Cross-tier backup/import/reset lifecycle CLOSED: core `V4BackupFile` now carries `flashcards`/`quiz_attempts`/`mistake_bank`/`study_sessions` (typed core records) plus non-domain `study_stats` and `unscheduled_slots` passthroughs; core import REPLACES a present section (restore semantics; absent section = v4 file → local collection untouched) inside the existing all-or-nothing transaction, preserves the passthroughs in `config_kv`, and the core exporter re-emits them. Desktop command is a thin web wrapper: `export_backup_file(studyPayload)` merges the webview's ACTUAL browser-IDB study collections over the core payload before the native write; `import_backup_file` returns `{...ImportReport, studyImport, studyStats}` and store.ts mirrors the sections into webview IDB/localStorage (sanitize accepts snake_case core records; missing `percentage` derived from score/total). Round-trip contract tests on both sides: core `pwa_backup_shape_imports…` + `v4_backup_export_import_round_trips_study_collections`, web `PWA→desktop export contract`, `desktop→PWA import contract`, `backup import REPLACES study collections`, and the store-level desktop-wrapper mirror test.
  3. `compute_extraction_cache_key(email, schedule)` now hashes email identity + FlashLite ladder + `ai::tasks::extract_assessment_task_identity()` (SHA-256 digest of the full EXTRACT_INSTRUCTION + the RawExtraction schema field list — digest only, prompt text never leaves core; a test pins the schema list against the struct) + canonical JSON of the schedule snapshot. Same key computed at the desktop pre-scan hydration over the SAME snapshot the scan receives. Tests: changed-timetable re-key, prompt/schema-identity re-key, identical-context stability (core sources::sync 13 passed).
  4. `purgeLocalStudyData` is honest: per-store clear failures are each reported AND rejected (resetDatabase shows "Reset incomplete — the schedule database was wiped, but …" and returns false instead of claiming a clean wipe). A monotonic purge epoch invalidates in-flight study writes: pre- and post-write epoch checks delete anything that commits after the wipe (race regression with a gated put included).
  5. First reset confirmation copy states the full wipe scope (`copy.ts resetDatabaseWarn` + new shared `resetDatabaseWarnFinal`; both dialogs now come from the same copy source; audit test asserts the FIRST dialog names every surface).
  6. Secret-scan exemption for desktop `state.rs` is LINE-scoped now (only lines referencing DEFAULT_GOOGLE_CLIENT_ID/SECRET are stripped; the rest of the file is scanned — regression proves a second secret literal in that file fails the gate). Fragment-ownership gained an explicit `--base/--head` range test (fails without a fragment, passes with it, empty range requires nothing) — the gate's rule is "a valid fragment exists", NOT per-branch matching (test documents that honestly).
  7. Playwright split: every snapshot assertion tagged `@visual`; `browser` job is a BLOCKING behavioral smoke (`--grep-invert @visual`, DOM assertions only) and the new `browser-visual` job runs the pixel comparison non-blocking (`continue-on-error`) — an optional failure is never a gate. TESTING-PLAYBOOK §5 updated to match. Baselines NOT regenerated (parent reviews renders first).
  8. sw.js verified build-consistent: rebuilt via tooling/build-sw.mjs, output byte-identical to the committed dirty state (only the 5.10.0 version stamp vs HEAD). Also fixed: quiz-attempt id collision under the IDB keyPath (`attempt-${Date.now()}` → random suffix; same-ms regression added); `idbReplaceAll` is now the live import path (was dead code); contract rust-structs.json regenerated (repo.rs source-hash only).

  Browser-acceptance round (parent-directed, after the reviewer corrections): 9. Widescreen dashboard honesty restored (DashboardView.tsx): at ≥1200px the recommendations pane now renders the same `FirstRunEmpty` card (`empty-dashboard-no-courses`, "Add your first course…" + Add Course / Connect Account CTAs) when there are ZERO courses, instead of the dishonest "No active study plans matching your filters." (which implies filters hid pending plans — §3.1). The "matching your filters" empty stays for the has-courses-no-plans case. dashboard.spec.ts hero assertion is now breakpoint-aware: at ≥1200px the VISIBLE hero is `dashboard-next-up-hero-top`; the plain `dashboard-next-up-hero` testid belongs to the sr-only scroll anchor (its content is invisible to `getByRole`). All emptiness checks kept. 10. Showcase capture scripts separated from acceptance: `playwright.config.ts` now `testIgnore`s `capture-*.spec.ts`, so `pnpm e2e` can NEVER rewrite `docs/screenshots/`. New opt-in `playwright.showcase.config.ts` (`pnpm --dir apps/web e2e:showcase`) runs only the capture specs on the light project; both capture specs write to the untracked `e2e-results/showcase/` staging dir unless `QUIZRADAR_SHOWCASE_DIR` explicitly points elsewhere. capture-non-ai-suite stale seeds fixed to the current schema (Course.color, ScheduleSlot.dayIndex/displayTime, Assessment urgencyLevel/priorityScore/warnings/source/topics:string[], Flashcard front/back/boxLevel, new MistakeItem shape, and the `quizradar_local_study_stats_v1` localStorage ledger replacing the removed `studyStreakDays`/`studyMinutesByCourse` store keys) — the stale objects crashed the app and were the cause of the topbar Calendar-tab 180s timeout. vite.config.ts now `server.watch.ignored: ["**/e2e-results/**"]` (a Playwright download artifact inside the watched dir killed Vite with EBUSY mid-suite, cascading ERR_CONNECTION_REFUSED). 11. Parent-run artifacts in docs/screenshots/redesign resolved: the 7 modified PNGs restored to HEAD and the 3 new generated captures (after-desktop-timeline-horizon, after-desktop-widescreen-mission-control{,-scrolled}) deleted — the 10 files mapped 1:1 to capture-showcase's output set; `git status docs/screenshots/` is now clean. 12. Authorized baseline refresh executed for dashboard-light/dark + settings-page-light ONLY (week-calendar baselines byte-untouched; verified via git status). Diffs inspected by hand before refreshing: settings baseline showed v5.0.0 + the obsolete 4-card theme picker vs the current mode/preferences+AMOLED picker; the dashboard baselines predated the Timeline-Horizon/widescreen layout entirely. Thresholds unchanged (maxDiffPixelRatio 0.01, threshold 0.2); frozen clock/UTC/light projects untouched. The widescreen FirstRunEmpty render was verified visually with a fresh-context Playwright screenshot before refreshing. 13. Default acceptance now covers real functional paths (no demo seeding): new e2e/study-persistence.spec.ts — Add Course via the real modal → real page.reload() (IndexedDB persistence) → settings "Export Backup (JSON)" (real browser download, asserts the course is in the file) → "Reset All Local Data" double-confirm → re-import of the downloaded file (waits for the honest "Imported 1 courses…" toast) → reload → course restored. week-calendar.spec.ts gained a real week-navigation test (topbar Previous/Next week + Jump to Today vs the shared `currentWeekStart`, asserted on `sidebar-week-exam-range`). bootApp's app-shell wait raised to 30s (cold WASM mount exceeded the 10s expect default once — observed blank-page flake). 14. store.test.ts typecheck repairs (batch debt): `importBackupFile(null, null)` → `(undefined, undefined)`; removed non-standard message args on two `toEqual/toBe` calls. Assertions unchanged.

  Final-correctness round (parent rejected the remaining original-scope gaps; all closed here):

  15. Pomodoro completion is now fully navigation-independent. The single tick driver moved OUT of FocusView into an app-level controller (`state/pomodoroTicker.ts`, mounted once in App.tsx's mount-only effect): ONE `setInterval` for the whole shell plus immediate `tickPomodoro()` on `visibilitychange`/`focus`, so an overdue deadline completes on the return transition instead of waiting for the next (throttled) interval fire. Elapsed time stays deadline-based (`pomodoroEndsAt` wall-clock; the store-owned exactly-once completion transition is unchanged). FocusView and PomodoroModal are pure presentation over `pomodoroSecondsLeft`. The chime's AudioContext is now CLOSED after the tone (`osc.onended → ctx.close()` — each completion used to leak one context until browsers cap them). Tests: `state/pomodoroTicker.test.ts` (fake-time completion exactly once with NO view and NO modal mounted; visibilitychange-tick completion; disposer; chime context closed); `views.test.tsx` FocusView completion test re-driven through the app-level ticker; real-browser regression `e2e/pomodoro-navigation.spec.ts` (start via the real Focus button → shorten the deadline via the existing DEV `__QUIZRADAR_STORE__` boundary only → navigate to Tasks → completion toast arrives while Focus is unmounted → return → readout reset + Start state; both light+dark projects pass). No production test hook added.
  16. Desktop study writes now reach the AUTHORITATIVE core SQLite store. New desktop commands `apps/desktop/src-tauri/src/commands/study.rs` (`study_list/upsert_card/review_card/delete_card/save_quiz_attempt/delete_quiz_attempt/upsert_mistake/delete_mistake/resolve_mistake/migrate/purge`) — thin camelCase DTO twins over the EXISTING core repos (no parallel schema; the Leitner review runs in core `plan::study::apply_leitner_review` and the webview adopts the canonical card). Core gained `repo::ops::{replace_study_collections, purge_study_collections, save_mistake, delete_mistake, list_quiz_attempts, delete_quiz_attempt}` + `Store` facade (one transaction each) + `StudyCollectionsReport`. Web side: `pwadapters/studyBridge.ts` selects the backend per call — Tauri → `study_*` commands, browser → the existing IDB adapters (PWA behavior unchanged; store.test.ts IDB paths all still pass). One-time IDB→native migration: memoized, marker `quizradar_desktop_study_native_v1` stamped ONLY after `study_migrate` resolves (core side is one all-or-nothing transaction — core test proves a failing record rolls the whole replace back), then the browser mirrors are cleared. Guard: EMPTY browser data stamps the marker WITHOUT issuing the replace — a cleared webview profile over an intact native store must never wipe it (regression included). Stats ledger lifecycle: the focus-minutes ledger migrates into the core passthrough (`config_kv`), stays the live UI source in webview localStorage, and the desktop export override shrinks to `{study_stats}` only (or null) so the core's own collection sections are never overridden with cleared mirrors; backup import mirrors are skipped once native is authoritative (hydration re-reads native). Reset: desktop `reset_database` already wipes the native study tables; the web purge clears the memo, keeps the marker. Export/import/reset flows preserved; no split-brain snapshot: exactly one authoritative store per tier at any time.
  17. Agent gate fragment requirement is now branch-relative: `checkBranchRange` requires a VALID `changes/<slug>.md` ADDED or MODIFIED inside the committed range (`git diff --diff-filter=AM mergeBase...head -- changes/`), not merely any fragment in the working tree (the old `fragments.length === 0` accepted a free-rider). New regression: a valid UNRELATED fragment committed on the base side does NOT satisfy the branch (fails with the range wording); `[skip-note]`, `dependabot[bot]`/`github-actions[bot]` and release-commit-only exceptions still pass; committing the branch's own fragment satisfies the same range. The empty-range-needs-nothing behavior is unchanged and still tested.
  18. Backup-mapping review (after the ownership change) found and fixed one real data-loss hole — the empty-browser migration guard in item 16. Reviewed and accepted, with documented narrowings: core `QuizAttempt` has no `assessmentTitle`/`percentage` columns (percentage is honestly re-derived from score/total on read — `storage.ts` sanitize; `assessmentTitle` has no UI consumer); `MistakeItem.topic` and `Flashcard.reviewCount` are web-only optionals with no UI consumer and no core column, so a desktop→PWA round-trip drops them (narrow minimal mapping, documented here, not invented into core). Optional-field parity re-verified: all core study-record optionals carry `#[serde(default)]`; the exporter always ships the four study sections (present-empty restores as a clear, not a merge); the stats/unscheduled-slots passthroughs are shape-gated (malformed ledger skipped, never fatal). Migration atomicity: one transaction per replace/purge, marker post-success, import mirror + export override gated on the marker. `rust-structs.json` regenerated for the new repo.rs hash (ffi.rs/types.rs untouched, no UniFFI regeneration needed).

### 🚀 New Features

- `9b6cb68` feat(android): quality overhaul, calendar redesign and Quiet-instrument design system
- `6e7794b` feat(web): deslop and polish pass

### 🔧 Maintenance, Docs & Tests

- `2fd2545` Merge branch 'feat/android-quality-overhaul'
- `8978d87` Merge branch 'chore/web-desktop-deslop' into main
- `60a8543` chore(web): accelerate vitest loop, fix wasm staleness, and purge dead review tooling

## [5.10.0] — 2026-11-10

### 🤝 Agent & Contributor Summaries

- **[android]** fix(android): resolve Google OAuth 400 invalid_request error by using RFC 3986 package-path custom scheme (com.quizradar.app:/oauth/google)

### 🐛 Fixes & Performance

- `e7f1cc3` fix(android): resolve Google OAuth 400 invalid_request error with single-slash package scheme

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
- **[tooling, web, ci]** Move the meta-tests (agentCoordination.test.ts, versionPipeline.test.ts) out of apps/web/src into tooling/**tests** with a dedicated node-env vitest config wired as root pnpm test:tooling plus a CI web-job step; versionPipeline no longer imports the web app and asserts the generated version.ts file directly. Fixes the recurring 70s vitest-worker timeout that failed every full pnpm test run; web suite drops to ~34s. No behavior or application code changed.
- **[web]** De-monolithize pps/web/src/views/DashboardView.tsx (reduced from 1,503 lines to 472 lines):
  - Created pps/web/src/views/dashboard/ directory with dedicated modular components:
    - ormatters.ts: Date, schedule string, and emoji-stripping helpers (ormatShortDate, ormatCompactCardSchedule, stripRoomPrefix, stripLeadingEmoji, weekRangeLabels)
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
