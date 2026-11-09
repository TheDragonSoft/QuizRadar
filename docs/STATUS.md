# STATUS — QuizRadar Live Operational Tracker

_Concise status index for AI agents and maintainers (enforced `<= 250` lines by `tooling/agent-gate.mjs`). Do **not** append per-task essays here — record branch work via `pnpm agent:note` (`changes/<slug>.md`), which rolls up automatically into [`CHANGELOG.md`](../CHANGELOG.md) and [`docs/worklog/`](./worklog/README.md) on merge to `main`._

## Snapshot

- **Current Version:** `5.6.0` (source of truth: `tooling/version.json` -> 5 stamped sinks)
- **Latest Published Release Tag:** `v5.0.0` (Windows NSIS/Portable, macOS ARM64, Linux deb/AppImage, signed Android APK/AAB, GitHub Pages PWA)
- **Database Schema:** `SCHEMA_VERSION = 3` (SQLite `core/src/store/db.rs` + PWA IndexedDB `apps/web/src/pwadapters/idbStore.ts`; content-addressed topic keys `h<fnv1a64>`)
- **Post-`v5.0.0` Landed on `main`:** Content-addressed topic completion keys (`v2 -> v3` migration), functional Academic Rhythm planner presets (`med=7d`, `eng=5d`, `biz=3d`), full-page `SettingsView.tsx`, baked Installed-client Google OAuth ID on Desktop + Android, Student Observatory 4-theme UI/UX redesign (`obsidian`, `solar`, `aurora`, `editorial`), and non-AI suite (`TimelineHorizon`, `TodayScheduleWidget`, `PrintScheduleDoc`, `StudyStatsCard`).

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
.\gradlew.bat ktlintCheck testDebugUnitTest assembleDebug
```

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

- **Android direct `deriveStudyTasks` track passthrough:** Native-store snapshots apply `academic_track` (`med|eng|biz`), while the direct stateless `QuizRadarEngine.deriveStudyTasks` wrapper still defaults to `""` (`eng`) until the ViewModel forwards the config string.
- **Web first-boot SWR cache after `v2 -> v3` topic-key update:** Cached `localStorage` state on the very first cold frame can briefly show pre-migration positional topic keys as unchecked until the synchronous IndexedDB/IPC refresh resolves (~1 tick).
- **Manual standalone assessment creation UI on Desktop/Web:** Core store CRUD (`upsert_assessment`) is implemented, while Desktop/Web UI currently exposes custom calendar events rather than a manual assessment form.
- **Moodle REST token availability:** Both iCal and REST channels exist in `core/src/sources/moodle.rs`, but most university Moodle instances only expose student iCal URLs without issuing REST app tokens.
- **Serverless Pair Phone (`quizradar://pair`):** Intentionally unimplemented pending a zero-server transport design (`AGENTS.md` §1 bans HTTP/LAN relay servers); JSON Backup Export/Import and Drive AppData backup are the supported cross-device data paths.

## Reference & History Map

- **Canonical Agent Rules & Architecture:** [`AGENTS.md`](../AGENTS.md)
- **Testing & UI Sweep Protocol:** [`docs/TESTING-PLAYBOOK.md`](./TESTING-PLAYBOOK.md)
- **Release & Signing Runbook:** [`docs/RELEASE-RUNBOOK.md`](./RELEASE-RUNBOOK.md)
- **Rolled-Up Agent Worklogs:** [`docs/worklog/`](./worklog/README.md) & in-flight [`changes/`](../changes/README.md)
- **Full v5.0 Rebuild & Audit Archive (Phases 01–20, Rounds 1–15):** [`docs/archive/STATUS-v5.0-rebuild.md`](./archive/STATUS-v5.0-rebuild.md)
