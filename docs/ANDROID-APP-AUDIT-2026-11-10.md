# Android app audit — 2026-11-10

## Scope and evidence

- Review branch: `docs/android-app-audit`, created from local `main` at `60a8543`.
- Current source version: 5.10.0. No application source changes made during this audit.
- Method: native design review (web detector not applicable), two independent read-only code investigations for reliability and acceptance/feature parity, and limited native emulator inspection.
- Runtime target: existing `Pixel_10`, `emulator-5554`, 1080 × 2424. The **preinstalled app is version 5.0.0**, last updated 2026-11-08. Its screenshots are supporting visual observations, not current-5.10.0 runtime certification. Relevant observations were cross-checked against current source.
- Inspected Dashboard, Tasks, Calendar, Focus and Account sheet. Did not sign in, send AI requests, import personal data, reset data or change account credentials.
- Emulator initially displayed both System UI and QuizRadar ANR dialogs during host/native-build load. Cause unproven; not classified as a confirmed app performance defect.
- Product baseline: `docs/rebuild/01-product-spec.md`, with later locked architecture and AGENTS.md exceptions taking precedence. LAN pairing, servers, telemetry, legacy calendar-event storage and desktop updater are intentionally excluded, not missing features.

## Executive assessment

The app has a real native foundation, but several polished-looking surfaces are backed by incomplete or disconnected workflows. The biggest issue is not color choice: users cannot reliably trust dates, account continuity, saved progress, deletion or some statistics. Visual refinement should follow reliability fixes rather than conceal them.

### What works

1. Native Compose four-destination navigation, theme tokens, responsive 3/7-day calendar and overlap lanes are already present.
2. Real per-device Rust scanning, progress and honest source outcomes exist; deterministic study tasks/readiness remain useful without AI.
3. Real bulk Google Calendar push, data-only Drive backup, timetable preview/manual fallback, native share ingestion, widgets and notification infrastructure exist. These are not universally missing.

## Priority 1 — reliability, privacy and trust

### A01 — Custom-event dates are silently lost (high)

Android writes `date`, but the Rust contract expects `date_iso`. Android also reads `date` from returned events. Core accepts omitted optional dates as `None`, so saving can look successful while the event becomes unschedulable. Imported/generated study blocks likewise lose their date in the native model, and collision avoidance receives wrong input.

Evidence:
- `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/QuizRadarViewModel.kt:1021` and `:955`.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/model/QuizRadarJsonParser.kt:126`.
- `core/src/types.rs:723-724`.

Fix: use the canonical serialized field on both read/write paths; add Android-to-Rust-to-Android round-trip and study-block collision regression tests.

### A02 — Feed removal does not delete the feed and changes unrelated preferences (high)

`removeIcsFeed` exports a backup, removes a JSON entry and reimports it. Import is additive: omitted feeds are not deleted. The UI then says "Feed removed". Legacy import also forces auto-GCal and Gemini preferences off.

Evidence:
- `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/QuizRadarViewModel.kt:1336-1360`.
- `core/src/store/importer.rs:224-235`, `:267-280`.

Fix: use a real feed-delete operation, never backup import as CRUD. Verify actual absence and that unrelated settings remain unchanged.

### A03 — Google connection does not reliably survive restart or token expiration (high)

Interactive login falls back to the shipped Google client ID. Refresh paths use only the stored override, so default-ID users lose silent refresh after process restart. Separately, each core operation creates a fresh token wrapper; its instance-local TTL treats an old nonblank token as newly issued. Expired tokens can be repeatedly reused instead of refreshed. UI connection state can therefore disagree with usable credentials.

Evidence:
- `apps/mobile-android/app/src/main/java/com/quizradar/app/MainActivity.kt:80-83`.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/QuizRadarViewModel.kt:553-559`.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/core/BackgroundScanWorker.kt:84-90`.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/core/QuizRadarEngine.kt:337-345`.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/core/EngineFfiTokens.kt:69-115`, `:125-131`.

Fix: centralize effective client ID resolution, track actual token expiry across operations, and invalidate/retry on rejected tokens. Test default-client login → process death → scan, and expiry in a long-lived process. Provider login was not exercised with real credentials in this review.

### A04 — OAuth can fail when Android recreates the Activity (high)

Pending provider/state/verifier/redirect are plain fields of an Activity-owned OAuthManager. Returning from the browser after recreation or process reclamation loses the transaction needed to validate a legitimate callback.

Evidence: `MainActivity.kt:36-39`; `auth/OAuthManager.kt:31-38`, `:69-91`, `:157-169`, under the Android Java source root above.

Fix: retain and securely recover a short-lived transaction, preserve state/PKCE validation, consume it once, and test recreation/process-death return paths.

### A05 — "Reset All Data" is not a full reset (high)

The shell manually clears selected entities/config instead of invoking the transactional reset. Feeds, private caches, metadata and other persisted state are not all cleared, yet the app reports "All data and credentials reset". Partial failure can also leave a half-reset store.

Evidence: `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/QuizRadarViewModel.kt:1979-2008`; existing core reset: `core/src/store/mod.rs:625-650`.

Fix: expose/use the canonical transactional reset and explicitly coordinate platform token, notification, widget and in-memory cleanup. Verify every owned table and setting after reset.

### A06 — Focus statistics are fabricated, not recorded history (high trust impact)

The ViewModel starts with CS=150, MATH=90, BIO=45 minutes and a four-day streak. The UI presents these as real weekly study time and 4h45m logged. Timer completion does not persist a session; the local log helper has no production caller. This was also visible in the otherwise empty preinstalled emulator app.

Evidence:
- `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/QuizRadarViewModel.kt:389-408`, `:450-490`.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/screens/FocusScreen.kt:503-596`.
- Real available core APIs: `core/src/ffi.rs:846-867`.

Fix: start empty, persist real completed sessions, and derive streak/course totals from the store. Never replace missing history with examples in production.

### A07 — AI consent, disabled state and advertised capabilities disagree (high)

Onboarding enables AI when a nonblank key is entered, without separate explicit opt-in or the complete required free-tier disclosure. Timetable image extraction checks for a key but does not check the AI-enabled preference; retaining a key can permit a send while AI is disabled. The Account sheet's blanket "No personal data crosses external servers" claim is incompatible with optional Gemini/Drive functionality.

Meanwhile native scan passes no AI provider and practice always invokes a local-fallback FFI method. The fallback is real and labeled, but supplying a key does not enable the promised AI scan/practice branch.

Evidence:
- `ui/screens/OnboardingWizardScreen.kt:885-930`.
- `ui/screens/SettingsScreen.kt:864-877`, `:953-975`.
- `ui/QuizRadarViewModel.kt:1705-1741`.
- `ui/components/AccountSheet.kt:126-130`.
- `core/QuizRadarEngine.kt:273-275`; `core/src/ffi.rs:283-287`, `:1273`.

Paths without a repository prefix in this section are under `apps/mobile-android/app/src/main/java/com/quizradar/app/`; `core/src/ffi.rs` is repository-root Rust.

Fix: separate key storage from consent, use the required disclosure, enforce the preference or obtain explicit per-operation consent, and either wire the AI capability or narrow the promise. Preserve useful deterministic fallback.

## Priority 2 — incomplete daily workflows

### A08 — Calendar create/read/edit/delete is incomplete

Class/custom blocks have no assessment ID; taps only handle assessment IDs. Custom agenda rows are display-only and the delete function has no UI caller. A student can create an event but cannot reopen, correct or delete it through the calendar. Manual assessment creation is also missing: the Add menu creates events/courses, not radar assessments.

Evidence: `ui/screens/CalendarScreen.kt:523-555`, `:700-704`, `:1008-1043`; `ui/QuizRadarViewModel.kt:1046-1066`; `ui/components/AddActionMenuSheet.kt:34-160`; `ui/detail/CreateEventSheet.kt:194-218`.

Fix: typed block actions, event edit/delete, class details, and an actual manual assessment form. Add course/layer filters and a date jump as specified.

### A09 — Agenda and grid disagree about which classes exist

The editor saves abbreviated weekdays such as `Mon`; agenda compares full weekday names such as `Monday` exactly. Agenda also skips the alternating-week helper used by the grid. Editor-created classes can disappear in agenda or appear on the wrong parity week.

Evidence: `ui/detail/CourseEditorSheet.kt:61`, `:87-90`, `:427-439`; `ui/screens/CalendarScreen.kt:752-758` versus `:458-460`.

Fix: use one parity/day-resolution helper for both views and test identical event sets.

### A10 — Attendance is not durable and absence counting is unreliable

Marks live only in a ViewModel map, not the existing Rust attendance store. Restart loses them. Absence count searches for course ID within `slotId::date`; generated slot IDs need not contain a course ID.

Evidence: `ui/QuizRadarViewModel.kt:360-386`; `ui/screens/CalendarScreen.kt:918-994`; available persistence: `core/src/ffi.rs:796-828`.

Fix: store attendance with explicit slot/course/date association and derive course summaries from persisted records.

### A11 — Reminders can report fictional time or notify retired assessments

The same-day worker supplies a fixed `minutesRemaining=120`, irrespective of actual/unknown/past exam time. The resulting ongoing notification has no normal production update/cancel path. Reminder/digest filtering uses days-until without excluding retired assessments.

Evidence: `notifications/ExamReminderWorker.kt:64-99`, `:123`; `notifications/NotificationHelper.kt:115-130`; `core/src/plan/dashboard.rs:238-246`.

Fix: calculate from a confirmed scheduled instant, do not invent countdowns for unknown times, exclude inactive items, and cancel/update notifications as data/time changes.

### A12 — The dashboard does not answer "what should I study now?"

A substantial StudyRecommendationCard exists but is never mounted. The dashboard mostly shows hero/setup/KPIs/timeline. Its type filter is consumed internally but not exposed by a control. Timeline starts from all assessments, including past entries, under an upcoming heading.

Evidence: `ui/components/StudyRecommendationCard.kt:40-238`; `ui/screens/DashboardScreen.kt:160-202`, `:243-729`; filter setter `ui/QuizRadarViewModel.kt:682`.

Fix: put the next recommended study action near the top, mount topic/progress actions, expose relevant filters and default to actual upcoming items.

### A13 — Inference/provenance is stripped at the Android boundary

Rust provides AI inference note, study plan and estimated hours, but Android's model/parser omit them. Detail does not display the original e-learning link even though it is parsed. Estimated dates can appear as authoritative as explicit dates, and students cannot easily check the source.

Evidence: `core/src/types.rs:589-594`; `model/QuizRadarModels.kt:71-103`; `model/QuizRadarJsonParser.kt:151-180`; `ui/detail/AssessmentDetailSheet.kt:275-404`.

Fix: retain these fields, label inferred/explicit dates beside the date, and expose source links/notes.

### A14 — Onboarding and course editing create avoidable dead ends

Timetable-image import is Step 2, before key entry in Step 3. On a fresh install, failure directs the student to Settings that is not available until exiting/skipping the wizard. The import picker is image-only; theme choice is missing. Course text survives recreation but draft slots use plain remember and do not. Course save dismisses before asynchronous success, and instructor changes do not update existing slot records.

Evidence: `ui/screens/OnboardingWizardScreen.kt:255-273`, `:885-896`; `ui/QuizRadarViewModel.kt:1721-1727`; `ui/detail/CourseEditorSheet.kt:78-93`, `:438`, `:470-479`.

Fix: resolve import prerequisites inline, keep manual setup first-class, retain the entire draft and dismiss only on confirmed save. The wizard step itself IS persisted correctly; do not misdiagnose that as reset-on-background.

### A15 — Grading/calendar actions are narrower than the advertised workflow

The what-if calculator is an equal-weight arithmetic scenario, not the requested weighted target/remaining-average calculation. Its equal-weight note is honest, but the feature is incomplete. Assessment-level calendar action uses Android ACTION_INSERT rather than per-item Google push and does not supply end time; absent calendar handlers fail silently. Real bulk GCal exists in Settings.

Evidence: `ui/detail/WhatIfCalculator.kt:19-64`; `ui/detail/AssessmentDetailSheet.kt:637-699`, `:743-776`.

Fix: implement the weighted target calculation in the shared core, preserve unknown/partial-grade semantics, distinguish "open device calendar" from "push to Google Calendar", and show actionable failures.

## Priority 3 — usability and visual hierarchy

Native visual method: design review only; web detector/overlays not applicable. Current source was cross-checked, but live images are from preinstalled 5.0.0, not a complete current-release visual gate.

1. **Empty dashboard is oversized and repetitive.** Hero, checklist and four large KPIs compete to explain that there is no data. Actual assessments/actions sit below. Replace with a compact next-action setup panel; after setup, prioritize Today, Next assessment and Study next. Evidence: DashboardScreen.kt:243-595.
2. **Settings is hidden behind Account.** On compact phones the profile sheet is the route to general settings; users must guess that account controls also own courses, appearance, backup and notifications. Add an obvious settings/overflow entry. Evidence: AppScaffold.kt:434-519, :707-727.
3. **Calendar header loses the key information.** In emulator inspection the range was ellipsized to `Nov 8 – Nov 14, 20…` while Today/arrows/view switch consumed the row. Put date/title on its own line or make controls more compact; offer an explicit date picker. Evidence: CalendarScreen.kt:214-309.
4. **Empty-state instructions and actions disagree.** Tasks says add courses but offers scan, including with no source connected. Resolve state before choosing CTA: Add course, Connect source, Scan, or Add assessment. Source: TasksScreen.kt; runtime capture 04-tasks-installed.png.
5. **Focus has unnecessary navigation and layout weight.** Global sync/search/account, a local two-tab switch, interval controls, a large ring, and large analytics card compete with the simple Start action. Separate session/task selection from history; use truthful, compact session feedback. Source: FocusScreen.kt:104-596.
6. **Some custom controls lack native selection semantics.** Source/course chips and color swatches should announce selected state and names, not rely on color alone. Evidence: TasksScreen.kt:137-219; CourseEditorSheet.kt:176-210. Verify TalkBack and large font on device before calling accessibility complete.
7. **Developer-facing setup language leaks into normal onboarding.** Setup checklist still tells users to add OAuth client IDs despite the shipped Google default. Keep advanced configuration separate. Evidence: SetupChecklistCard.kt:126-140.
8. **Remove the nonfunctional Anonymous Diagnostics preference.** AnalyticsManager is a no-op; implementing telemetry is explicitly disallowed. Evidence: SettingsScreen.kt:1493-1527; analytics/AnalyticsManager.kt:4-31.

### Heuristic score — provisional, source plus limited installed-build inspection

0 = broken/absent, 1 = poor, 2 = partial, 3 = good, 4 = excellent. This is a review judgment, not a measured usability study.

| Heuristic | Score | Reason |
| --- | --- | --- |
| System status | 2/4 | Real scan progress, but fictional stats/countdown and unreliable connected state |
| Match to real world | 2/4 | Student concepts present; technical OAuth setup language leaks through |
| User control | 1/4 | Calendar dead ends; feed delete/reset promises not fulfilled |
| Consistency | 2/4 | Shared styling, but agenda/grid and data contracts disagree |
| Error prevention | 1/4 | Date loss, incomplete CRUD and draft loss |
| Recognition over recall | 2/4 | Four clear destinations; settings/source verification buried |
| Efficiency | 2/4 | Native navigation works; primary study recommendation disconnected |
| Minimalist design | 2/4 | Consistent theme but oversized/redundant empty-state chrome |
| Error recovery | 1/4 | Some honest failures/draft retention, but misleading success paths remain |
| Help | 2/4 | Help exists; prerequisites and empty-state guidance are inconsistent |
| **Total** | **17/40** | **Needs reliability and workflow work before polish** |

### Persona risks

- **First-time student:** asked for image import before configuring its prerequisite; technical connection advice and scan-only empty state can prevent reaching useful data.
- **Busy returning student:** connected badge may outlive usable auth; agenda may omit classes; wrong dates/reminders undermine the main promise.
- **Student tracking progress/accessibility needs:** fictional history, lost attendance and weak selection semantics undermine confidence and usability.

## Missing capabilities versus enhancements

**Specified but incomplete:** manual assessment CRUD; editable custom calendar items and class detail; actionable study recommendations; provenance/source links; full AI consent and real enabled branches; course/layer calendar filtering/date jump; weighted grade target; complete onboarding import prerequisites and PDF support; usable scan cancellation (currently honestly omitted rather than fake).

**Useful parity enhancements after stability:** Android Grade Center/GPA/history (already on web and available through core bindings), persisted real study analytics, flashcard/mistake-bank review, and a focused Today agenda. Do not add these ahead of repairing existing data paths.

**Not requested gaps:** servers, relay/LAN daemon, native iOS app, telemetry, fabricated demo data or desktop-only updater. Android Moodle REST is honestly unsupported in this shell rather than universally absent from the core.

## Recommended implementation order

1. **Trust/data foundation:** A01–A07; contract round-trips, real mutations/reset, auth process-death/expiry, consent and truthful analytics.
2. **Complete the daily loop:** A08–A15; add assessment → inspect source → calendar correct/edit → study → persist progress → accurate reminder.
3. **Simplify the mobile hierarchy:** task-first home, direct settings, coherent setup/empty-state CTAs, compact calendar header, useful Focus layout and accessibility.
4. **Expand intentionally:** Grade Center/GPA, flashcards/mistakes and richer history only once the daily loop is proven.

Required future acceptance tests: fresh install without AI; manual course+assessment; event date round-trip/edit/delete; agenda/grid parity; process restart and expired-token scan; interrupted OAuth return; attendance/focus restart persistence; deleted feed stays deleted without changing preferences; reset covers all owned data; AI-off sends no payload; cancelled/unknown-time exams produce no fictional countdown; populated and empty UI at large font/TalkBack.

## Verification record

- `pnpm agent:preflight`: passed; isolated branch created. No sibling worktree edits.
- `node tooling/generate-version.mjs --check`: passed, all five sinks synchronized.
- Android command started: `powershell -NoProfile -Command "& 'D:\Projects\QuizRadar\apps\mobile-android\gradlew.bat' -p 'D:\Projects\QuizRadar\apps\mobile-android' ktlintCheck testDebugUnitTest assembleDebug"`.
- **Final Android result: FAILED (exit 1, 9m49s).** ktlint passed/up-to-date; arm64 and x86_64 Rust release libraries built and staged; Kotlin/Java compilation completed. Unit tests: **122 run, 121 passed, 1 failed**. `QuizRadarEngineSmokeTest.coreVersion_matches_app_version` expected `5.10.0` but the JVM-loaded core returned `5.9.0` (`app/build/test-results/testDebugUnitTest/TEST-com.quizradar.app.QuizRadarEngineSmokeTest.xml:8`). This establishes a local native-artifact freshness/version mismatch, not a proven release-APK defect. The combined command stopped at `testDebugUnitTest`; `assembleDebug` did not complete and no current APK was installed. Rebuild/resolve the JVM host native core and rerun before green handoff.
- No live OAuth/Google API/AI/Drive flows verified, no physical-device/large-font/TalkBack sweep, no full populated-state runtime certification.
- Review screenshots were moved outside the source tree; no generated binaries/screenshots should be committed with this report.
