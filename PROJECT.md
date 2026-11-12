# Project: QuizRadar Non-AI Feature Suite

## Architecture

- **Core Pure Rust Engine (`core/`)**:
  - Implemented once in pure Rust with zero UI dependencies.
  - Implements all deterministic models, SQLite schema migration 4, study cushion and availability deficit calculator, week parity logic, GPA calculation across 4 scales, attendance session logs, flashcard spaced repetition (Leitner), and study session analytics.
  - Bound via **UniFFI 0.28** for Android and **WASM** / Tauri in-process IPC for Web/Desktop.
- **Desktop & Web Shell (`apps/web/`, `apps/desktop/`)**:
  - React 19 + Vite + Tailwind CSS SPA running inside Tauri 2 desktop shell and PWA.
  - State management via Zustand (`store.ts`).
  - Implements multi-pane widescreen layout (≥1200px), GPA & Course Grade Center, power-user keyboard shortcuts (`1-4`, `T`, `N`, `Space`), CSS `@media print` clean PDF export, study cushion meter, Canvas/Blackboard connection guides, Week A/B chips, and offline flashcard review.
- **Android Mobile App (`apps/mobile-android/`)**:
  - Kotlin + Jetpack Compose M3 + Glance 1.1.1 widgets + WorkManager.
  - Binds to Rust `NativeStore` via UniFFI.
  - Implements 4x2 / 4x1 "Today's Schedule" Glance widget, calendar agenda/list view toggle, tap-to-mark attendance with absence limit warning chips, persistent lock-screen countdown notification starting at T-3h, focus minute logging, streaks, and weekly analytics chart.

## Feature Inventory

| #   | Feature                                   | Description                                                                                                                            | Milestone | Source                      |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------- |
| 1   | Git Branch Setup                          | Create and verify `feature/non-ai-suite` git branch                                                                                    | M0        | ORIGINAL_REQUEST R1         |
| 2   | Pure Non-AI Scope                         | Zero AI API calls, zero server dependencies, local-first                                                                               | M0–M6     | ORIGINAL_REQUEST R1         |
| 3   | Core Data Models & Migration              | SQLite migration v4: attendance, flashcards, quiz attempts, mistake bank, study sessions, course credits & absence limits, week parity | M1        | Core Survey                 |
| 4   | Study Cushion & Deficit Engine            | Pure deterministic waking hours (15–16h) minus commitments vs pending study hours                                                      | M1        | ORIGINAL_REQUEST R4         |
| 5   | GPA Calculator Engine                     | Credit-weighted GPA across US 4.0, UK Honors (70%+), ECTS, and Percentage                                                              | M1        | ORIGINAL_REQUEST R2         |
| 6   | Alternating Timetable Logic               | ISO week parity evaluation (`week_a` / `week_b` / `all`) and slot filtering                                                            | M1        | ORIGINAL_REQUEST R4         |
| 7   | Study Analytics Engine                    | Reference-date anchored focus session logging, streak calculation, and weekly distribution                                             | M1        | ORIGINAL_REQUEST R3         |
| 8   | UniFFI & WASM Surface                     | Expose new methods to Android JNA and Web WASM / Tauri IPC                                                                             | M1        | Core Survey                 |
| 9   | Multi-Pane Widescreen Density             | Side-by-side split view on wide screens (≥1200px) with calendar on left (~58%) and roadmap/assessments on right (~42%)                 | M2        | ORIGINAL_REQUEST R2         |
| 10  | GPA and Course Grade Center UI            | Course grade summaries with accumulated points progress bar, 4 grading scales, and semester GPA calculator in TasksView                | M2        | ORIGINAL_REQUEST R2         |
| 11  | Power-User Keyboard Shortcuts             | `1-4` (view switch), `T` (jump to today), `N` (new event modal), `Space` (start/pause Pomodoro)                                        | M2        | ORIGINAL_REQUEST R2         |
| 12  | Printable & Exportable Clean PDF          | Vector-crisp printable weekly timetable and exam cram sheet with topic checklist boxes via `@media print`                              | M2        | ORIGINAL_REQUEST R2         |
| 13  | Web Study Cushion & Deficit UI            | Cushion badge / deficit warning alert on Daily Study Roadmap                                                                           | M2        | ORIGINAL_REQUEST R4         |
| 14  | Web Canvas & Blackboard Guides            | Step-by-step accordion connection cards in Settings -> Sources with iCal URL inputs                                                    | M2        | ORIGINAL_REQUEST R4         |
| 15  | Web Alternating Timetable UI              | Week A / Week B parity indicator chips, calendar header filter, and slot recurrence editor                                             | M2        | ORIGINAL_REQUEST R4         |
| 16  | Web Flashcard Mode & Mistake Bank         | Flip-card review mode, quiz attempt persistence, and mistake bank revision                                                             | M2        | ORIGINAL_REQUEST R4         |
| 17  | Android 4x2 / 4x1 Today's Schedule Widget | Glance widget showing timetable slots, room numbers, study blocks, and next exam banner                                                | M3        | ORIGINAL_REQUEST R3         |
| 18  | Android Calendar Agenda / List Toggle     | Mobile-first toggle between 3-day time grid and vertical scrolling list grouped by day                                                 | M3        | ORIGINAL_REQUEST R3         |
| 19  | Android Attendance & Absence Tracker      | Tap-to-mark attendance on class slots with warning chips approaching absence limits                                                    | M3        | ORIGINAL_REQUEST R3         |
| 20  | Android Persistent Exam Notification      | Ongoing lock-screen notification starting 3 hours before an exam with room and native chronometer countdown                            | M3        | ORIGINAL_REQUEST R3         |
| 21  | Android Study Logging & Analytics         | Focus minute tracking by course, daily streak counter, and weekly chart on Focus screen                                                | M3        | ORIGINAL_REQUEST R3         |
| 22  | Android Study Cushion & Deficit UI        | Cushion / deficit indicator on Tasks and Dashboard screens                                                                             | M3        | ORIGINAL_REQUEST R4         |
| 23  | Android Canvas & Blackboard Guides        | Dedicated connection cards in Settings -> Sources with setup instructions                                                              | M3        | ORIGINAL_REQUEST R4         |
| 24  | Android Alternating Timetable UI          | Week A / Week B recurrence on slot editor and calendar filtering                                                                       | M3        | ORIGINAL_REQUEST R4         |
| 25  | Android Flashcards & Mistake Bank UI      | Local flashcard flip review and persistent mistake bank on Focus screen                                                                | M3        | ORIGINAL_REQUEST R4         |
| 26  | Comprehensive Test Suite Pass             | 100% passing tests for Rust core, Web vitest, and Android Robolectric                                                                  | M4        | ORIGINAL_REQUEST Acceptance |
| 27  | Visual Comparisons (Before vs After)      | Side-by-side screenshot comparisons for desktop and android documented in summary markdown report                                      | M5        | ORIGINAL_REQUEST R5         |
| 28  | Forensic Integrity Audit                  | Independent teamwork_auditor verification for zero cheating and authentic implementations                                              | M6        | Orchestration Governance    |

## Milestones

| #   | Name                                | Scope                                                                                                              | Dependencies | Status      |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------ | ----------- |
| M0  | Branch Setup & Baseline             | Git branch `feature/non-ai-suite` creation and baseline check                                                      | none         | IN_PROGRESS |
| M1  | Core & Cross-Platform Engine        | Data models, SQLite v4, cushion, GPA, week parity, flashcards/mistakes, attendance, session analytics, UniFFI/WASM | M0           | PLANNED     |
| M2  | Web & Desktop Suite                 | Multi-pane density, Grade Center, shortcuts, clean PDF, cushion UI, LMS guides, alternating UI, flashcards UI      | M1           | PLANNED     |
| M3  | Android Mobile Suite                | 4x2/4x1 Today's widget, agenda/list toggle, attendance tracker, persistent exam notification, focus analytics      | M1           | PLANNED     |
| M4  | Full Automated Test Verification    | Full test suite execution across core, web, and android                                                            | M2, M3       | PLANNED     |
| M5  | Visual Before-and-After Comparisons | Capture desktop and android screenshots; author comparison markdown document                                       | M4           | PLANNED     |
| M6  | Forensic Integrity Audit            | Teamwork auditor integrity verification and victory handoff                                                        | M5           | PLANNED     |

## Interface Contracts

### Core ↔ Web/Desktop

- **Data Models**:
  - `Course`: includes `credits?: number | null`, `max_absences?: number | null`.
  - `ScheduleSlot`: includes `week_parity?: "all" | "week_a" | "week_b"`.
  - `StudyTasksPayload`: includes `today_cushion?: DailyStudyCushion`.
  - `DailyStudyDayGroup`: includes `cushion?: DailyStudyCushion`.
- **WASM / IPC Methods**:
  - `calculate_study_cushion(slots, events, tasks, ref_date, waking_hours) -> DailyStudyCushion`
  - `calculate_gpa(courses, assessments, grades, scale) -> GpaSummary`
  - `get_week_parity(date_iso) -> "week_a" | "week_b"`

### Core ↔ Android UniFFI

- **NativeStore Methods**:
  - `record_attendance(slot_id, course_id, date_iso, status, updated_at, ref_date_iso) -> Result<String, QuizRadarFfiError>`
  - `log_study_session(session_json, updated_at, ref_date_iso) -> Result<String, QuizRadarFfiError>`
  - `get_study_analytics(ref_date_iso) -> Result<String, QuizRadarFfiError>`
  - `save_quiz_attempt(attempt_json, mistakes_json, ref_date_iso) -> Result<String, QuizRadarFfiError>`
  - `list_mistakes(assessment_id) -> Result<String, QuizRadarFfiError>`
  - `resolve_mistake(mistake_id, updated_at) -> Result<String, QuizRadarFfiError>`
  - `upsert_flashcard(card_json, updated_at) -> Result<String, QuizRadarFfiError>`
  - `list_flashcards(course_id) -> Result<String, QuizRadarFfiError>`

## Code Layout

- `core/`:
  - `src/types.rs`: Core domain models.
  - `src/store/db.rs`, `src/store/repo.rs`: SQLite migration 4 and repositories.
  - `src/plan/cushion.rs`: Study cushion and deficit calculator.
  - `src/plan/gpa.rs`: Grade conversion and credit-weighted GPA calculator.
  - `src/plan/parity.rs`: ISO week parity calculations.
  - `src/ffi.rs`: UniFFI exports.
  - `bindings/wasm/`: WASM exports.
- `apps/web/`:
  - `src/views/DashboardView.tsx`: Multi-pane widescreen layout (≥1200px).
  - `src/views/TasksView.tsx`: GPA & Course Grade Center 3rd tab, study cushion indicator.
  - `src/views/CalendarView.tsx`: Week A/B parity toggle and badge.
  - `src/views/FocusView.tsx`: Flashcard mode, quiz attempt history, mistake bank.
  - `src/views/SettingsView.tsx`: Canvas & Blackboard iCal feed guides.
  - `src/components/CalendarGrid.tsx`, `DailyStudyRoadmap.tsx`: Extracted modular grid and roadmap.
  - `src/components/PrintScheduleDoc.tsx`: Printable schedule and exam cram sheet.
  - `src/lib/gpaCalculator.ts`, `weekParity.ts`, `cushionCalculator.ts`.
  - `src/App.tsx`: Global keyboard shortcuts (`1-4`, `T`, `N`, `Space`).
- `apps/mobile-android/`:
  - `app/src/main/java/com/quizradar/app/glance/TodayScheduleWidget.kt`: 4x2 / 4x1 schedule widget.
  - `.../ui/screens/CalendarScreen.kt`: Agenda list view toggle and attendance chips.
  - `.../ui/screens/FocusScreen.kt`: Study analytics charts, streaks, and flashcard/mistake mode.
  - `.../ui/screens/TasksScreen.kt`: Study cushion & deficit banner.
  - `.../ui/screens/SettingsScreen.kt`: Canvas & Blackboard setup guides.
  - `.../notifications/NotificationHelper.kt`: Persistent T-3h exam countdown notification.
  - `.../ui/QuizRadarViewModel.kt`: Attendance, session logging, and analytics state.
