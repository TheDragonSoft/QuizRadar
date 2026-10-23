# 01 — QuizRadar Product Specification (v4.3.0, compiled 2026-10-23)

_Acceptance-grade inventory of what the v5 rebuild must reproduce. Everything here is behavior currently shipped in `static/` + `src/` + `android/`. Companion doc `02` describes how it is implemented today; `03` lists its defects._

---

## 1. Identity & positioning

- **Name:** QuizRadar (TheDragonSoft). Tagline: "Never miss a quiz, lab assessment, or midterm buried in your university inbox, Microsoft Teams, Moodle, or Google Classroom."
- **Core promise:** professors and portals often announce fuzzy dates ("Class Quiz 1 next week, not this week, during your lecture"). QuizRadar resolves that fuzziness into exact dates/rooms/times by cross-referencing each announcement against **the student's own weekly timetable**, then manages the resulting exam radar end-to-end.
- **Data honesty doctrine (brand pillar):**
  - Zero cloud servers; data stays on the user's hardware.
  - OAuth tokens never leave the device they were created on.
  - Dates come from: (a) explicit announcement dates, (b) the user's timetable slots, or (c) are clearly labeled **estimates** with an inference note saying what heuristic/AI produced them. Never silently invented.
  - Every "scan"/"sync" reports what actually ran and what was actually found (honest counts; empty results are allowed).
- **Platforms:** Desktop (Windows/macOS/Linux), Android APK, installable PWA (also iPhone/iPad via Add-to-Home-Screen). Current version `4.3.0` (tags v2.0.0 → v4.3.0).

## 2. Users & primary journeys

Primary persona: one student, one university, 4–8 enrolled courses. No institution server, no admin. Secondary: the PWA visitor on iPhone (no desktop).

### Journey A — Desktop first-run (target)
1. Launch → onboarding wizard (3 steps) opens on a truly blank canvas (zero preloaded courses).
2. Step 1/2: connect accounts — Google (real OAuth via `GET /api/auth/google/url` → system browser → loopback callback), Microsoft Teams (real Graph OAuth), Moodle card (URL + token or iCal URL), Classroom toggle (needs Google sign-in), optional Gemini key, timetable-image upload.
3. Step 3: enroll courses ("Add your first course…" / AI-extracted preview), pick theme → finish → dashboard.
4. Sync runs → assessments appear with source icons; a wrong/empty result must be honest (no "Connection active" theatre).
5. Push to Google Calendar per item or all; `Last synced` reflects real fetches only.

### Journey B — Android first-run
1. Install APK → splash → wizard (same 3 steps, native status bar, haptics).
2. "Scan All Sources" runs the **on-device scan engine** (OAuth via native bridge; Gmail/Graph/Moodle fetches happen on the phone, no desktop needed).
3. Desktop pairing optional later (Settings → Pair Phone → QR/PIN → pull desktop data via LAN).
4. Exam notifications + home-screen widget work locally after first scan.

### Journey C — iPhone/PWA
1. Open hosted URL → Add to Home Screen → runs offline-capable PWA.
2. Connects accounts in browser where OAuth allows; relies on heuristic engine otherwise; can pair with desktop for data.

## 3. Domain glossary (exact semantics to preserve)

| Term | Semantics |
|---|---|
| **Course** | `{id ("CSE241"), name, color, bg, border}`. Manual entry or extracted by AI; code is unique key (`renaming would fork the course`). |
| **Slot (ScheduleSlot)** | Weekly recurring class: `day/day_index (0–6)`, `course_id + course_name`, `room`, `type` (Lecture/Tutorial/Lab), `group` (section), `start_time/end_time/display_time` ("08:00–10:30"), `has_quiz`, `quiz_title`. |
| **Assessment** | The radar item: quiz/exam/assignment from a source or manually created. `date_iso, start_time, end_time, room, group, instructor, topics[], warnings[], ai_inference_note, ai_study_plan, estimated_study_hours, source (Gmail/Teams/Moodle/Classroom/"Custom"/feed label), source_icon, elearning_url, google_cal_url, weightage/achieved/max`. |
| **Assessment type ladder** | "Class Quiz" default; "Online Quiz" (`/mod/quiz/` or "online quiz"), "Midterm Exam", "Final Exam", "Lab Assessment" (lab-session wording), "Assignment" (in-class/subject assignment). |
| **Urgency ladder** | critical ≤2d, high ≤5d, medium ≤14d, upcoming, past; badges "TODAY / TOMORROW / IN N DAYS". |
| **Priority score** | 0–100 composite; caps at 100. Drives "What Should I Study?" ordering. |
| **Topic key** | `"assessment_id::topic_index"` map in `completed_topics` (single source of truth for readiness). |
| **Readiness %** | completed topics ÷ total topics across upcoming; per-assessment and global KPI. |
| **Retention/filter memory** | Disabling a source (Teams/Moodle/Classroom) hides (desktop: filters; mobile engine: deletes) its assessments; re-enabling + rescan restores. Feed items (`feed-*` ids) bypass source toggles once synced. |
| **Dedupe key** | Same `(source, course_id, title, date_iso)` = one item; user grading/gcal edits preserved on refresh. |
| **Study block** | Auto-generated `study-block-<assessment_id>` custom event placed day-before-exam in a free 90-min window (evening-first candidates within 08:00–21:30, avoiding lectures and custom events). Mitigates conflict alerts. |
| **Conflict alert** | Two dates within 48h without a mitigating block; same-day ⇒ critical (simulated 4h gap), adjacent-day ⇒ warning (26h); dismissible banner. |

## 4. Feature inventory by area

### 4.1 Onboarding & connections
- 3-step wizard with stepper; never resets mid-flow on backgrounding; first-run auto-opens (persisted per-device flag); track/rhythm chips (Medicine/Business/Sciences presets) persisted.
- Google connect: real OAuth redirect (desktop) / native bridge (Android); profile badge shows real name/email/picture. Manual name/email entry is admitted in-UI as a **local profile anchor** ("never claim authentication").
- Teams connect: real Microsoft OAuth; account name/email resolved.
- Moodle: URL + token or personal iCal URL; "Test" then "Sync"; on native the endpoint is honestly unsupported ("use the desktop app" / run paired-desktop sync).
- Classroom: toggle + test (requires Google token).
- Gemini: paste key → validated with a real ping; explicit AI toggle; onboarding auto-gcal checkbox.
- Timetable import: image/PDF upload → AI extraction → **preview modal** → apply or manual fallback (manual editor always available).
- Theme choice applied from onboarding.

### 4.2 Sources & scanning (the radar)
- **"Scan All Sources"** button (desktop top bar + mobile icon) with scan-progress overlay (staged progress, cancel/abort) and haptic/toast feedback; sets real `Last synced` only on real fetch.
- Source filter pills on the dashboard (All/Gmail/Moodle/Teams/Classroom) reflect enabled-state.
- **Gmail:** five search queries (`quiz`; `exam OR midterm OR final`; `assignment OR test OR homework OR project OR deadline`; from e-learning/edu senders; from canvas/blackboard/gradescope/classroom), newest-first, dedupe by id, refresh-cap of already-cached emails, HTML→text, candidate filtering (rejects grades/results/cancellations/material-upload notices and reminder tails), 60-day recency.
- **Teams:** Graph `/me/joinedTeams` + channels/tabs/drive files/conversations, optional AI source-discovery with strict "never invent deadlines" prompt; heuristic fallback maps team names to courses only (no invented assessments).
- **Moodle:** iCal feed and/or REST `core_calendar_get_calendar_events`; keyword filtering; no invented dates.
- **Feeds:** any user-subscribed HTTPS `*.ics` (≤10, token-bearing URLs allowed by design), reusing the Moodle parser with `feed-*` ids and user-facing source labels.
- **Classroom:** active courses + coursework with due dates; no invented due dates.
- Merge preserves user grading/gcal fields; per-source counts displayed.

### 4.3 Dashboard
- KPI row: **next-7-days count** (+ type breakdown pills), **readiness %**, **account/sync KPI** (sources connected, last-sync timestamp).
- **Exam Overload & Clash Detection** banner: conflict alerts with severity chips, built-in "Schedule smart study blocks" action, dismiss persistence.
- Type filter dropdown + synced pills; mobile sub-tab bar (Overview KPI / Assessments / Study).
- **"What Should I Study?"** numbered recommendation cards: course color bar, urgency badge, live progress bar (optimistic topic toggles), computed class schedule string ("Sun & Wed, 08:00–10:30 @ Hall B-204"), topic/warning counts, honest empty states ("Add your first course…").
- **Timeline list** (filterable): source icon badge, conflict chip, achieved-score chip, TODAY/TOMORROW/N-days pill, up to 2 warnings shown per row.

### 4.4 Tasks view
- Summary line ("N pending topics across M upcoming exams • Est. X hrs"), course filter dropdown, readiness card grid (per-assessment % with color states; "avg" badge), **Daily Study Roadmap** day cards ("Today" ring/pulse), per-task checkboxes writing `completed_topics`, urgency badges, estimated hours, AI reasoning notes when AI-planned; deterministic default planner with every feature.

### 4.5 Calendar view
- Google-Calendar-style week grid 08:00–21:00 (desktop 7-day; mobile <768px 3-day window with clamped offset); time gutter; overlap **lane assignment**; four block kinds: merged slot+exam (exam glow), plain slot (popover with room/group/type), standalone assessment, custom event (pink palette, inline edit/delete).
- Mini month calendar (sidebar + brand icon), week navigation, jump-to-today, jump from assessment modal; course filters + layer toggles (exams/classes); mobile-friendly scroll.

### 4.6 Assessment detail & grading
- Detail modal: course-color header, course/type/source badges (default "Gmail Ingestion"), date/time/room/instructor, topics checkboxes, warnings list, "what to study" (AI note or heuristic), e-learning link, actions: Add to Google Calendar (real push or template URL), Export .ics (single/all), **Edit grade** (weight/score/max; per-field partial updates; explicit-null clears — never coerces a blank into 0), status pill ("Recorded…/Not Graded"), **what-if projector** (remaining weighted average needed; honest equal-weight note).

### 4.7 Practice & focus
- **Practice quiz** per assessment: AI-generated 5 MCQs when AI enabled; otherwise honest **on-device fallback** built from the assessment's topics (label states which). Click-to-score feedback, explanation reveal, next/restart.
- **Pomodoro:** 25/5/15 modes, WebAudio chime, "mark current pomodoro task done" hooks into topic completion.

### 4.8 Cross-platform system features (the easily-forgotten ones)
- **Day rollover watchdog:** re-render every 30s + on visibility change; relative dates never go stale ("TODAY" flips at midnight).
- **Notifications (Android/mobile):** prefs `{exams, digest, digest_hour}`; T-24h exam reminder ("Tomorrow: …"), same-day reminder, 7-day morning digest built from class slots; permission flow; ≤48 nearest scheduled; change-hook dedupe (cancel+reschedule on data change).
- **Home-screen widget (Android):** 2×1 next-assessment countdown (course, title, date, "Today/Tomorrow/in Xd" badge states); snapshot contract `window.__quizradarWidgetSnapshot` fetched by native (throttled 60s).
- **Share-sheet ingest (Android):** share text/URL into QuizRadar → pre-filled custom event modal (`__quizradarHandleShared`, Gmail "subject\n\ntext" split).
- **Pull-to-refresh** (mobile) respecting modal-open state; swipe/haptics.
- **Search:** desktop palette (`/` or Ctrl/⌘K, recents, suggestions, top-4 matches across title/course/instructor/topics, debounced) + mobile bottom-sheet search with type chips; typing re-renders dashboard + calendar.
- **Back button (Android):** ordered modal-close stack → search palette → sidebar → dashboard → exit.
- **Keyboard:** Escape closes any open layer (ordered), `/` or ⌘K focuses search.
- **Theme:** light/dark, smooth cross-fade, persisted; native status bar tint follows; reduced-motion respect.
- **Updater (desktop):** delayed check → pill + popover with markdown release notes, skip-this-version, download-with-honest-progress → installer handoff → recovery message; settings-side check button. (On native, stubbed honestly.)
- **Backup/restore/reset:** JSON export scrubbing all secrets (gemini key, ms/moodle tokens); restore validates shape and confirms; reset rebuilds initial DB.
- **Pairing (desktop⇄mobile):** Settings card shows LAN connect URL + QR (deep link `com.quizradar.app://pair?url=…`, stock-camera openable) + optional 4–8 digit PIN; phone-side test/pull imports only data (tokens never cross); emulator URL hint (10.0.2.2).
- **Cloud backup (desktop):** Google Drive appDataFolder `quizradar_cloud_state.json` push/pull with schema_version, device id, additive merge rules; fallback = special calendar event ("Extended Sync") — see issues doc; mobile-side stub is local-storage backup only.
- **PWA:** offline precache of all local assets (fonts, JS, CSS, icons), network-first `/api/` with 503 JSON, cache-first cross-origin, old-cache sweep; portrait standalone; theme #0b0f19.
- **Haptics** on meaningful actions (native, with `navigator.vibrate` fallback).

### 4.9 Settings modal (3 tabs)
- Account: identity, connect/disconnect, Gemini key + validator.
- Courses: enrolled-course grid (edit/delete), re-open onboarding.
- Integrations: Moodle, Teams, Classroom toggles + test/sync buttons, auto-gcal, **notify prefs**, **ICS feeds list** (add/toggle/delete; native shows "fetched by paired desktop"), **Pair Phone** card (QR/PIN), updater check.

## 5. Screen & modal inventory (must exist in v5)

**Views:** single-page shell with 3 main views — Dashboard / Tasks / Calendar — M3 bottom nav on mobile (adds Focus entry), left sidebar on desktop (nav tabs, mini-cal, course filters, layer toggles, sync status footer).

**Modals (13):** onboarding wizard · scan-progress overlay · account/profile · settings (3 tabs) · add-course (with manual slot rows) · schedule-preview (AI extraction review) · create/edit event · event-detail (assessment) with grading + what-if · practice quiz · pomodoro · app-confirm (custom, no `window.confirm`) · cloud-sync/pairing · search (mobile sheet).

**Chrome regions:** top bar (sync button, search, theme toggle, user chip, settings gear with spin stage, update pill), sidebar footer sync honesty label ("On-Device Engine · No live sources" / "Signed in · Auto-scan off" / "Radar Active · N sources"), toast notify, mobile pull-refresh indicator.

## 6. Design language (preserve)

- Accent `#1a73e8` (Google-blue family); surfaces `#f8fafc/#ffffff` light; `#0b0f19` dark base; slate text/border scale; exam-glow red shadow; per-course palette derivation from 8 preset colors; custom-event pink `#db2777`.
- Typography: Inter variable (self-hosted woff2, latin subset); lucide icon set (vendored locally); Tailwind utility classes with `darkMode:'class'`.
- Material-3-ish mobile affordances (bottom nav, bottom sheets), desktop density with hour grid.

## 7. Non-goals (explicit)

- No server-side user accounts, no analytics/telemetry, no multi-university admin, no rich-text editor. No AI inference without explicit key/opt-in (see `05`).

---

## 8. v5 acceptance checklist (feature parity matrix)

Require ALL boxes on the shipped surface unless marked `[D]` desktop-only or `[M]` mobile-only.

**Core radar**
- [ ] Announcement→assessment pipeline with timetable cross-reference, explicit-date parsing, relative-phrase anchoring ("next week (not this week)" ⇒ week+1 heuristic), estimates labeled with inference note
- [ ] 5 Gmail queries + dedupe + 60-day window
- [ ] Teams Graph ingestion with honest heuristics fallback
- [ ] Moodle iCal + REST; feeds .ics ≤10 (https-only); no invented dates
- [ ] Classroom coursework (due-date-gated)
- [ ] Source enable/disable retention behavior + rescan restore
- [ ] Dedupe across sources preserving user edits
- [ ] Manual assessment/custom event create-edit-delete

**Dashboard / tasks / calendar**
- [ ] KPIs: 7-day count + type pills, readiness %, sync/accounts KPI
- [ ] What Should I Study cards with optimistic topic toggles
- [ ] Timeline rows with urgency/source/conflict/warnings/score chips
- [ ] Conflict banner + smart study blocks + dismiss `[D blocks]`
- [ ] Roadmap day cards, readiness grid, per-course filter
- [ ] Week grid 7-day `[D]` / 3-day `[M]`, lane overlap, 4 block kinds, mini-cal jump, semester label
- [ ] Assessment detail with grade edit + what-if + gcal push + .ics

**Study support**
- [ ] Practice quiz (AI or labeled on-device fallback)
- [ ] Pomodoro with chime + topic-done hook
- [ ] Deterministic study planner default (no AI needed)

**System**
- [ ] Real OAuth Google + Microsoft, tokens local-only, disconnect wipes
- [ ] Gemini BYOK validate + honest quota errors
- [ ] Timetable image import + preview + manual fallback
- [ ] Notifications: T-24/day + digest, prefs `[M]`
- [ ] Widget snapshot `[M]`; Share-sheet ingest `[M]`; back-button stack `[M]`; pull-to-refresh `[M]`; haptics `[M]`
- [ ] Search palette + mobile sheet; keyboard/Escape order; search re-render
- [ ] Day-rollover refresh; sync-status honesty footer; scan overlay w/ cancel
- [ ] Backup export/restore (secret-scrubbed) + reset
- [ ] Pairing QR + PIN + data pull `[D+M]`; `[D]` cloud Drive backup; `[M]` local backup label
- [ ] Updater with release notes + honest progress `[D]`; settings check `[D]`
- [ ] PWA offline installability; theme + status-bar sync; reduced motion
- [ ] Onboarding wizard full flow incl. track/rhythm, theme card, upload, auto-gcal
- [ ] Honest sync messaging everywhere (counts of what actually ran)

**Data migration (from v4 users)**
- [ ] One-click import of v4 exports (`assessments[]` + `schedule.courses[]` + `completed_topics` + `grades` + `custom_events`)
