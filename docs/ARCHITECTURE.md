# 🏛️ QuizRadar v2.0 — Technical Architecture & Developer Guide

## 1. Overview
QuizRadar v2.0 is a standalone native Rust application designed for university students to automatically track quizzes, midterms, finals, lab assessments, and study plans directly from their Gmail announcements and synchronize them with Google Calendar.

---

## 2. Source Code Modules (`src/`)

| File | Responsibility |
| :--- | :--- |
| [src/main.rs](file:///d:/Projects/QuizRadar/src/main.rs) | Application entrypoint, TCP port binding (`5000`, `5050`, `3000`, `8080`), Axum HTTP router, shared state (`Arc<RwLock<...>>`), and REST API handlers. |
| [src/models.rs](file:///d:/Projects/QuizRadar/src/models.rs) | Strongly-typed data structures (`Course`, `ScheduleSlot`, `ScheduleData`, `CachedEmail`, `Assessment`, `DashboardSummary`, `StudyRecommendation`, `TopicCheckItem`, `CustomCalendarEvent`, `AppConfig`). |
| [src/auth.rs](file:///d:/Projects/QuizRadar/src/auth.rs) | Standalone Google OAuth 2.0 loop (`build_google_oauth_url`, `exchange_code_for_token`, `get_valid_access_token`, `fetch_user_profile`). Automatically refreshes expired tokens using `refresh_token` and persists to `token.json`. |
| [src/gmail.rs](file:///d:/Projects/QuizRadar/src/gmail.rs) | Native Rust Gmail API v1 client (`sync_gmail_messages`). Queries academic keywords and senders, decodes base64url MIME parts (`text/plain` and HTML-stripped `text/html`), and maintains `quiz_emails_cache.json`. |
| [src/gemini.rs](file:///d:/Projects/QuizRadar/src/gemini.rs) | Google Gemini API client (`gemini-2.5-flash`) with structured JSON `responseMimeType: "application/json"`. Injects both the student's weekly timetable (`schedule.slots`) and email metadata (`subject`, `from`, `date`, `body`) to infer exact dates, times, rooms, and study plans. |
| [src/parser.rs](file:///d:/Projects/QuizRadar/src/parser.rs) | Schedule-aware temporal reasoning engine & dashboard builder (`process_all_emails`, `build_dashboard_summary`). Cross-references relative phrases (*"next week (not this week)"*, *"Monday and Wednesday during lecture time"*) with `data/schedule.json`, computes urgency & priority scores (`0–100`), and generates interactive topic checklists. |
| [src/gcal.rs](file:///d:/Projects/QuizRadar/src/gcal.rs) | Google Calendar API v3 synchronization engine (`sync_assessments_to_google_calendar`) and RFC 5545 `.ics` generator (`generate_single_ics`, `generate_all_ics`). Performs idempotent event creation/updates via `synced_gcal_map`. |

---

## 3. How Schedule-Aware Date & Time Inference Works

University announcements frequently omit explicit calendar dates or clock times:
1. **Relative Date Anchoring**:
   - Example: Email `1a125bc4af1ed819` (`GSE211: Class Quiz 1`) was sent on **Saturday, 10 October 2026** and states: *"CLASS QUIZ 1 will be held during your scheduled lectures next week (Not this week)"*.
   - The engine anchors to `2026-10-10`, skips the week of `Oct 11–17`, and targets the week starting `Sunday, 18 October 2026`.
2. **Timetable Slot Cross-Referencing**:
   - Matches `GSE211` + `"lectures"` against [data/schedule.json](file:///d:/Projects/QuizRadar/data/schedule.json), finding the student's registered `GSE211` Lecture slot on **Sunday, 08:00 – 10:00 AM in Room C212 O (Group C)**.
3. **Cross-Listed Course Resolution**:
   - Recognizes that Moodle forum `CSE354` taught by `Eng. Mona Farouk Ahmed Kamal Eldeen` covering *Algorithm Efficiency and Recursion* maps to `CSE261` (*Algorithms and Data Structures*) on the student's schedule, resolving *"Monday and Wednesday during lecture time at your assigned slot"* to the student's registered **Group B Lecture on Wednesday, 21 October 2026, 2:00 PM – 3:30 PM in Room D114 O**.
4. **Multi-Email Context Merging**:
   - Links Moodle file upload notifications (such as *"File Quiz template is new in the course Embedded Systems Design"*) to the corresponding upcoming quiz (`CSE252 Quiz 1`) so the student receives an explicit warning to print and bring the template.

---

## 4. Data Storage & Persistence Files

- [credentials.json](file:///d:/Projects/QuizRadar/credentials.json): OAuth 2.0 Desktop Client configuration (also embedded as fallback constants in `src/auth.rs` so the binary can run standalone anywhere).
- `token.json`: Local OAuth 2.0 access token, refresh token, and granted scopes.
- [data/schedule.json](file:///d:/Projects/QuizRadar/data/schedule.json): Student's enrolled courses, color palettes, and weekly Lecture/Tutorial/Lab slots.
- `data/app_config.json`: Stores onboarding completion state, Google user profile summary, checked-off study topics (`completed_topics`), Google Calendar event ID mappings (`synced_gcal_map`), and user-created custom calendar events (`custom_events`).
- `data/gemini_parsed_cache.json`: Caches Gemini structured JSON extractions by Gmail message ID to avoid redundant API calls.
- `quiz_emails_cache.json` & `processed_quizzes.json`: Local cache of raw Gmail messages and enriched assessment objects for instant startup and offline resilience.
