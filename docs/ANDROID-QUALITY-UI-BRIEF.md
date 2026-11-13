# Android quality UI brief — screen plan

Source of truth: `docs/ANDROID-APP-AUDIT-2026-11-10.md` (A01–A15 + Priority-3 items), current Compose source on `feat/android-quality-overhaul`, and the brand tokens in `apps/mobile-android/app/src/main/java/com/quizradar/app/ui/theme/QuizRadarTheme.kt` (web tokens.css mapping, `CustomEventPink`, `StatusColors`, Light/Dark/AMOLED schemes — `QuizRadarTheme.kt:19-116`). Nothing below changes the brand palette, the NextUp starfield hero, or the three theme modes (`MainActivity.kt:125-144`).

Order follows the audit: trust/data fixes first (A01–A07), daily loop (A08–A15), then hierarchy. UI changes ride on those; polish never conceals a broken data path.

## Global rules (all screens)

- Brand: only theme-role colors + `StatusColors` + `CustomEventPink`. Replace remaining raw `Color(0xFF…)` literals in screens (e.g. `DashboardScreen.kt:212-214`) with the token layer.
- Touch targets ≥ 48dp everywhere a touch lands (pattern exists: `CalendarScreen.kt:288-292`; Tasks chips at 36dp, `TasksScreen.kt:147` — fix).
- Chips/segments/toggles: `Modifier.selectable(selected=…, role=Role.RadioButton/Tab)` or `FilterChip`/`SegmentedButton` so TalkBack announces "selected" (Tasks chips `TasksScreen.kt:143-221` and Focus mode switch `FocusScreen.kt:113-211` are plain `clickable` Boxes today; color alone must never carry selection — add a leading check icon).
- State: honor `animateContentSize`/transitions only behind reduced-motion (respect `Settings.Global.ANIMATOR_DURATION_SCALE == 0`); no new looping animations; AMOLED starfield keeps its existing subtlety.
- Sheets: `ModalBottomSheet` with predicted-back enabled, scrim-tap confirm-discard when a draft has edits, drafts survive recreation via `rememberSaveable` (CourseEditor slot draft loses them today, audit A14).
- IME: every text field scrolls with `imePadding()`; primary action lives above the keyboard, not under it.
- Errors: inline, specific, actionable (never toast-only); success copy states exactly what happened. No fabricated numbers ever (AGENTS.md §3.1; audit A06/A11).
- Large fonts: no fixed heights on text containers; let rows grow; headers `maxLines=2` where truncation loses meaning (calendar header today, P3-3).

## Screen ownership (disjoint — one file per agent)

| Screen | Owns | Must not touch |
|---|---|---|
| Dashboard | `ui/screens/DashboardScreen.kt` + new `ui/components/CompactSetupPanel.kt` | AppScaffold, hero card internals |
| Calendar | `ui/screens/CalendarScreen.kt`, `ui/calendar/*`, `ui/detail/CreateEventSheet.kt`, `ui/detail/CourseEditorSheet.kt` | Dashboard, TaskDetail |
| Focus | `ui/screens/FocusScreen.kt` + new `ui/components/FocusHistoryCard.kt` | Tasks, detail sheets |
| Tasks | `ui/screens/TasksScreen.kt` | Calendar, Focus |
| Grade Center | new `ui/screens/GradeCenterScreen.kt` + new `ui/components/GpaHistoryCard.kt` | TasksScreen, WhatIfCalculator |
| Onboarding | `ui/screens/OnboardingWizardScreen.kt` | SettingsScreen |
| Settings | `ui/screens/SettingsScreen.kt`, `ui/components/AccountSheet.kt`, `ui/components/OAuthClientIdFields.kt` | Onboarding |
| Shared chrome | `ui/AppScaffold.kt`, `ui/components/{SetupChecklistCard,AddActionMenuSheet,SearchSheet,HelpSheet,HeroSky,QuizRadarLogo}.kt` | Screen bodies |
| Detail surfaces | `ui/detail/{AssessmentDetailSheet,WhatIfCalculator,TimetableImportPreviewDialog}.kt`, `ui/components/{StudyRecommendationCard,TimelineAssessmentRow,ReadinessCard,DailyRoadmapCard,ConflictBanner,NextUpHeroCard}.kt` | Screen files |
| Theme/tokens | `ui/theme/*`, `ui/icons/Icons.kt` | All of the above (additive only) |

## Per-screen actions

### Dashboard (`DashboardScreen.kt`)
- Compact empty setup: replace the oversized hero+checklist+4-KPI empty stack (P3-1, `DashboardScreen.kt:243-595`) with one `CompactSetupPanel` — one-line status per step (Course / Source / Reminders), a single primary CTA matching the *actual* blocker (Add course vs Connect source vs Scan; P3-4 logic), dismissible. Keep developer-facing OAuth text out (`SetupChecklistCard.kt:126-140` → point at Settings → Sources, no client IDs on the happy path).
- Populated order: NextUp hero → StudyRecommendationCard (finally mount it; audit A12, `StudyRecommendationCard.kt:40-238` exists unmounted) → Today strip → Next assessment → KPIs → timeline starting at genuinely upcoming items (filter `a.isUpcoming`, expose the internally-consumed type filter as chips, `DashboardScreen.kt:192-204`).
- CTA wiring: Study-next row → Focus with task preselected; timeline row → detail sheet.

### AppScaffold / Settings entry (`AppScaffold.kt`)
- Add a persistent Settings icon in the top bar next to search (P3-2: settings currently hides behind the profile sheet, `AppScaffold.kt:434-519`). Profile avatar opens Account only. `MainActivity.kt:173` `onOpenSettings = {}` becomes the real navigation.

### Calendar (`CalendarScreen.kt`, `ui/calendar/`)
- Header: date range gets its own full-width line; controls row carries only Today / arrows / view switch (P3-3, `CalendarScreen.kt:214-321`). Range text never ellipsizes to uselessness.
- Add a date-picker entry (tap the range or an icon → Material3 `DatePickerDialog`).
- Add 3-day view alongside 7-day grid, sharing the same lane renderer (`ui/calendar/CalendarLanes.kt`).
- Parity: grid and agenda must resolve days/alternating weeks through one helper (`WeekParityHelper` vs `CalendarScreen.kt:458-460` vs `:752-758`, audit A09) — one helper, tested-equal event sets.
- Course/layer filter chips (courses, custom events, assessments) with `FilterChip` semantics; persisted per session.
- Complete CRUD: typed taps on class/custom blocks (open detail, edit, delete — custom agenda rows are display-only today, `CalendarScreen.kt:523-555`, `:1008-1043`); manual assessment form in AddActionMenuSheet (audit A08); CreateEventSheet saves `date_iso` (A01) and dismisses only on confirmed success.
- Attendance marks persist via the existing core attendance APIs (`core/src/ffi.rs:796-828`), not the ViewModel map (A10).

### Focus (`FocusScreen.kt`)
- Structure: Session (task picker → timer, big Start, minimal interval controls) / History / Practice Quiz as three segments. Move history out of the Pomodoro scroll (P3-5).
- Truthful stats: start empty; persist completed sessions through the real core session APIs (`core/src/ffi.rs:846-867`); derive streak/course totals from the store. Delete the seeded CS=150/MATH=90/BIO=45 + 4-day-streak fiction (A06, `QuizRadarViewModel.kt:389-408`). Empty history = honest empty state, never demo minutes.
- Practice: keep the honest local-fallback label; AI branch only when consented+enabled (A07). Flashcard/mistake-bank review lands here **after** the daily loop is proven (parity enhancement, audit §Missing).

### Tasks (`TasksScreen.kt`)
- Roadmap stays: honest summary line (already fixed, `TasksScreen.kt:86-99`), readiness cards, day groups.
- Empty states state the blocker and offer the matching CTA (P3-4): no courses → Add course; courses but no source → Connect source / Scan; everything else → Add assessment.
- Selected-chip semantics per Global rules; 48dp chips.
- Grade Center/GPA is a **separate** GradeCenterScreen (table above), reachable from Tasks header or nav — weighted target calculation implemented in core first (A15; equal-weight `WhatIfCalculator.kt:19-64` stays labeled until core ships weighted math). GPA/history uses existing core bindings — no new numbers invented.

### Onboarding (`OnboardingWizardScreen.kt`)
- Consent before import: AI key entry + explicit consent step (with the verbatim free-tier disclosure, `05` §5.1) precedes any timetable-image import; the image-extraction path must check the AI-enabled preference, not just key presence (A07, `SettingsScreen.kt:864-877`).
- Import prerequisites resolved inline: on fresh install, image-import failure offers Connect-source / manual-entry without leaving the wizard (A14, `OnboardingWizardScreen.kt:255-273`).
- Image/PDF preview: extend picker to PDF, show `TimetableImportPreviewDialog` with extracted rows before commit; errors state which step failed.
- Manual setup stays first-class (skip visible from step 1); theme picker (System/Light/Dark/AMOLED) as a wizard step; full draft survives recreation (`rememberSaveable`, incl. slot rows).

### Settings (`SettingsScreen.kt`)
- Direct navigation entry (AppScaffold above). Remove the dead Anonymous Diagnostics preference (P3-8, `SettingsScreen.kt:1493-1527`; `AnalyticsManager` is a no-op).
- Feed removal = real delete with honest result and untouched preferences (A02). Reset All = canonical core reset + platform cleanup (A05; wiring already in `MainActivity.kt:72-86`).
- AI consent copy exactly per spec; account sheet privacy claim narrowed to truth (A07, `AccountSheet.kt:126-130`).

### Detail sheets (`ui/detail/`, `ui/components/`)
- Provenance shown: inferred vs explicit date labels, inference note, source link, estimated hours (A13 — fields exist in core, `core/src/types.rs:589-594`, dropped in `QuizRadarJsonParser.kt:151-180`).
- Per-assessment calendar action: distinguish "Push to Google Calendar" (per-item) from "Open device calendar" with end time supplied; failures surface (A15).
- WhatIfCalculator keeps its honest equal-weight note until core provides weighted math.

## Integration API needs (ViewModel / core — owner: trust-track agent, not screen agents)

1. `date_iso` round-trip on custom events + study blocks (A01) — model/parser fix, regression tests.
2. Real `removeIcsFeed` core op; canonical `resetAllData` exposure (A02/A05).
3. Token expiry tracking + effective client-id resolution consumed by UI state (A03).
4. Focus-session record/list core calls surfaced to ViewModel (A06).
5. Attendance persist/derive via `core/src/ffi.rs:796-828` (A10).
6. Provenance fields (`inferenceNote`, source link, estimatedHours, study plan) added to Android models/parser (A13).
7. Manual assessment create; event update/delete; typed block IDs (A08).
8. Weighted grade target in core (A15) before GradeCenterScreen ships.
9. Reminder times from confirmed instants only; retired assessments excluded (A11).

## Acceptance gates (before any screen is "done")

- TalkBack sweep + largest font scale on Dashboard, Calendar, Focus, Tasks, Onboarding (audit verification record: never yet run on device — must run).
- Light, Dark, AMOLED screenshots per changed screen; no hardcoded color escapes tokens.
- Empty-state and populated-state both verified; every number on screen traceable to the store.
- Back-gesture, sheet-back, IME-resize behavior exercised per changed sheet.
