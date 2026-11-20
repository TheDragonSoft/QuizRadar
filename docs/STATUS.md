# STATUS — QuizRadar Live Operational Tracker

_Concise status index for AI agents and maintainers (enforced `<= 250` lines by `tooling/agent-gate.mjs`). Do **not** append per-task essays here — record branch work via `pnpm agent:note` (`changes/<slug>.md`), which rolls up automatically into [`CHANGELOG.md`](../CHANGELOG.md) and [`docs/worklog/`](./worklog/README.md) on merge to `main`._

## Snapshot

- **Current Version:** `5.20.0` (source of truth: `tooling/version.json` -> 5 stamped sinks)
- **Latest Published Release Tag:** `v5.16.0` (Windows NSIS/Portable, macOS ARM64, Linux deb/AppImage, signed Android APK/AAB, GitHub Pages PWA)
- **Database Schema:** `SCHEMA_VERSION = 6` (SQLite `core/src/store/db.rs` + PWA IndexedDB `apps/web/src/pwadapters/idbStore.ts`; content-addressed topic keys `h<fnv1a64>`, Non-AI suite tables, and `courses.aliases` JSON column)
- **Post-`v5.0.0` Landed on `main` (through `v5.16.0`):** Content-addressed topic completion keys (`v2 -> v3`), Non-AI Academic Productivity Suite (`v4`: GPA engine, study cushion/deficit, Week A/B parity, Leitner flashcards, mistake bank, attendance tracker, `TodayScheduleWidget` 4x2, persistent T-3h exam notification, printable PDF schedule), multiple course codes/aliases & one-click course reassignment (`v6`: `Course.aliases`, `reassign_assessment_course`), serverless two-way peer sync (`quizradar://pair?d=...`), `gemini-3.8-flash` primary AI model ladder, and Student Observatory 3-theme UI/UX suite (`obsidian`, `solar`, `amoled-nebula`).

## Multi-Agent Quickstart (Read Before Editing)

1. **Preflight & conflict radar:** Run `pnpm agent:preflight` first to inspect current version, active `git worktree` peers, surface/file overlap warnings, pending `changes/*.md` handoffs, and required test gates.
2. **Worktree / branch isolation:** Never commit directly on `main` or share an active dirty directory with another agent session. Use a dedicated branch (`feat/...`, `fix/...`, `chore/...`, `docs/...`) or git worktree.
3. **Handoff & version note:** Never edit `tooling/version.json` on feature branches. Before pushing/opening a PR, record your work in `changes/<slug>.md`:
   ```powershell
   pnpm agent:note --bump <patch|minor|major|none> --surfaces <core,web,desktop,android,tooling,docs,ci> --agent <agent-name> --summary "<what changed & why>" --verify "<commands run>" --handoff "<follow-ups or None>"
   ```
4. **Cross-language contract sync:** Whenever `core/src/types.rs` or `core/src/ffi.rs` changes, re-stamp `node apps/web/src/contract/regenerate.mjs` and regenerate Kotlin bindings (`cd apps/mobile-android; .\gradlew.bat uniffiGenerate`).

## Canonical Verification Commands (Windows PowerShell 5.1)

> PowerShell 5.1 note: do not chain with `&&`; run commands separately or guard with `; if ($?) { ... }`.

### Agent & Version Gates

```powershell
pnpm agent:preflight                             # branch, worktree collision radar, pending notes, required gates
pnpm generate:version:check                      # verify all 5 version sinks match tooling/version.json
node apps/web/src/contract/regenerate.mjs --check # verify Rust <-> TS wire contract map is fresh
pnpm test:tooling                                # version pipeline, coordination, perf gate & CI validator meta-tests
node tooling/validate-release.mjs --tag vX.Y.Z   # release tag/version/prerelease dry check
pnpm agent:note --validate                       # validate all changes/*.md handoff fragments
```

### Rust Workspace (`core/` + `apps/desktop/src-tauri/`)

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p quizradar-desktop
```

### Web & PWA (`apps/web/` + `tooling/`)

```powershell
pnpm --dir apps/web build:wasm
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                                        # Vitest unit, contract, a11y (axe), antipattern & copy suites
pnpm --dir apps/web exec playwright test         # Visual regression vs apps/web/e2e-baselines/
```

### Android (`apps/mobile-android/`, requires Temurin JDK 21)

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
cd apps/mobile-android
.\gradlew.bat ktlintCheck lintRelease testDebugUnitTest assembleDebug
```

### Performance Regression Gate (`performance/`, separate from correctness)

```powershell
pnpm perf:core -- --base-bin <core-sampler> --head-bin <core-sampler> --samples 15
pnpm perf:web -- --base-dist <web-dist> --head-dist <web-dist> --samples 7
pnpm perf:android -- --base-apk <test-signed.apk> --head-apk <test-signed.apk> --serial emulator-5554
pnpm perf:desktop -- --base-exe <quizradar-desktop.exe> --head-exe <quizradar-desktop.exe> --samples 5
pnpm perf:review                                  # aggregate all surface comparison reports
```

See `docs/PERFORMANCE-TESTING.md`. CI required checks: `ci-success` and
`performance-review`.

## Round 16: Non-AI Academic Productivity Suite & Live Dogfooding (Desktop & Android)

_Executed the complete non-AI feature expansion across Rust Core, Web/Desktop, and Android Compose tiers. Exercised live dogfooding on physical/AVD Android emulator `emulator-5554` and verified desktop production build and IPC test suite._

### Shipped & Verified Across Tiers

1. **Rust Core Engine (`core`)**:
   - `core/src/plan/cushion.rs`: Study cushion deficit and availability calculator.
   - `core/src/plan/gpa.rs`: Multi-scale GPA engine (4.0, 4.33, 5.0, 10.0) with credit weighting, honours classification, and what-if targets.
   - `core/src/plan/parity.rs`: Alternating week parity (Week A / Week B) schedule resolution.
   - SQLite v4 migrations in `core/src/store/db.rs` and `repo.rs` for flashcards, quiz history, mistake bank, and attendance.
   - Regenerated UniFFI bindings and WASM exports.
   - **Verification**: `cargo test -p quizradar-core` -> **342 passed, 0 failed** (296 unit, 8 adversarial, 5 storage, property and fixture tests).

2. **Web & Desktop Tier (`apps/web` & `apps/desktop`)**:
   - Components: `CalendarGrid.tsx`, `DailyStudyRoadmap.tsx`, `PrintScheduleDoc.tsx`, `StudyStatsCard.tsx`, `TimelineHorizon.tsx`.
   - Grade Center tab with GPA calculator and international scales in `TasksView.tsx`.
   - Canvas and Blackboard LMS manual integration guides in `SettingsView.tsx`.
   - Leitner 5-box review hub, mistake bank, and interactive Pomodoro in `FocusView.tsx`.
   - Global keyboard shortcuts (`1-4`, `T`, `N`, `Space`) with input field suppression in `App.tsx`.
   - **Verification**:
     - `pnpm --dir apps/web vitest run` -> **323 passed, 0 failed** (38 test files).
     - `pnpm --dir apps/web typecheck` -> **Clean (0 errors)**.
     - `pnpm --dir apps/web build` -> **Built in 17.75s** (Vite + WASM + SW clean).
     - `cargo test -p quizradar-desktop` -> **34 passed, 0 failed** (23 unit, 11 integration).

3. **Android Mobile Native Tier (`apps/mobile-android`)**:
   - Assembled `arm64-v8a` and `x86_64` native Rust libraries via NDK 27 into `jniLibs`.
   - Assembled and installed `app-debug.apk` directly on Android emulator `emulator-5554` (Pixel 10, Android API 35).
   - `TodayScheduleWidget.kt` and Glance provider `today_schedule_widget_info.xml` wired to `WidgetUpdateWorker.kt`.
   - Persistent exam notification builder `buildPersistentExamNotification` in `NotificationHelper.kt`.
   - Attendance and absence tracker with interactive status chips (`✓ Attended`, `✗ Absent`, `~ Excused`) and absence warning badges.
   - Calendar Agenda / List view toggle (`Switch to Agenda View` / `Switch to Grid View`) with empty-state honesty.
   - Focus screen with active countdown Pomodoro timer, study streak counter (`4-Day Study Streak`), and course study time analytics.
   - **Live Dogfooding Evidence**:
     - Live screenshot captures in `docs/screenshots/non-ai-suite/`: `live-android-focused.png`, `live-android-calendar.png`, `live-android-agenda.png`, `live-android-focus.png`.
     - Verified interactive timer: Play button tapped live on device, state transitioned to "Focusing", display actively decremented (`25:00` -> `24:54`).
     - `./gradlew.bat testDebugUnitTest` and `ktlintCheck` -> **100% clean**.

4. **Showcase Documentation & Before/After Report**:
   - Comprehensive showcase report generated in `docs/NON_AI_SUITE_DEMO.md` with 8 Playwright mock showcase captures.

## Open Backlog & Known Limitations (Honest State)

- **Technical backlog cleared (v5.16.0 candidate):**
  - `deriveStudyTasks` track passthrough on Android is wired via [`QuizRadarViewModel.kt`](../apps/mobile-android/app/src/main/java/com/quizradar/app/ui/QuizRadarViewModel.kt).
  - Web first-boot SWR cache guard (`hasLegacyPositionalKeys`) is implemented and tested in [`swr.ts`](../apps/web/src/state/swr.ts).
  - Manual standalone assessment creation/edit UI is wired via [`CreateEditAssessmentModal.tsx`](../apps/web/src/components/CreateEditAssessmentModal.tsx).
  - Serverless two-way peer sync (`quizradar://pair?d=...`) is implemented across Core, Desktop, PWA, and Android using additive `BackupPayload` merge (both devices scan independently; zero tokens leave the device; zero servers).
- **External ecosystem limitation — Moodle REST token availability:** Both iCal and REST channels exist in `core/src/sources/moodle.rs`, but most university Moodle instances only expose student iCal URLs without issuing REST app tokens.
- **Commercial / Growth Roadmap:** Tracked in [`docs/ROADMAP-COMMERCIAL.md`](./ROADMAP-COMMERCIAL.md) (Syllabus PDF ingestion, zero-key trial AI relay, Google OAuth verification, opt-in E2EE sync server, App Store / Play Store distribution, and Pro tier).

## Reference & History Map

- **Canonical Agent Rules & Architecture:** [`AGENTS.md`](../AGENTS.md)
- **Testing & UI Sweep Protocol:** [`docs/TESTING-PLAYBOOK.md`](./TESTING-PLAYBOOK.md)
- **Release & Signing Runbook:** [`docs/RELEASE-RUNBOOK.md`](./RELEASE-RUNBOOK.md)
- **Rolled-Up Agent Worklogs:** [`docs/worklog/`](./worklog/README.md) & in-flight [`changes/`](../changes/README.md)
- **Full v5.0 Rebuild & Audit Archive (Phases 01–20, Rounds 1–15):** [`docs/archive/STATUS-v5.0-rebuild.md`](./archive/STATUS-v5.0-rebuild.md)
