# QuizRadar — Full Feature Audit & First-Run Experience Report

_Audit performed 2026-10-19 on repo state `HEAD = a7b0717 (v3.2.0)`._
_Methods: static code audit of all Rust modules + `static/app.js`/`index.html`, live "fresh install" simulation (binary copied to an empty dir, `--headless` run, API probed via HTTP), and headless-browser DOM dump of the real UI._

---

## Executive summary

The single biggest source of the "weird data when I first install" complaints is **fabricated demo data wired into the product on every platform**:

1. The Rust binary **embeds a hardcoded demo timetable** (`include_str!("../data/schedule.json")`) and **writes it to the user's disk on first launch** — a fresh install already contains 6 fake courses + 11 pre-filled slots with quiz flags. On some builds this was the **developer's own real timetable** ("CSE241/GSE211, Semester 91") — it has already leaked into shipped artifacts.
2. The frontend engine (shared by Desktop, Android APK and the PWA) **intercepts every `/api/*` call** (unconditionally — not only on mobile), so the entire Rust backend (OAuth, Gmail/Moodle/Teams/Classroom ingestion, Cal sync, pairing) is **orphaned dead code from the UI's perspective**. The UI is a 100% local-storage app with success-toast theatre.
3. Every "connect account" and "scan" flow that a first-time user can *actually* click is a **simulation** — fabricating demo courses, fake "Gemini Schedule Inference" notes, fake streak/hours stats, and fake success messages even with zero sources connected.
4. Miscellaneous 404/dead infrastructure: the updater's GitHub repo URL returns 404, drive-scope is never requested so Drive cloud sync can never work (falls back to embedding app data in a calendar event), there is no mobile UI to pair with the desktop despite README/pairing claims.

Below: detailed findings, each with file/line references, severity, and platform impact.

---

## A. Critical: fabricated demo / "weird" data on first run

### A1. Demo timetable is baked into the binary and written to disk on first run — CONFIRMED LIVE
- **Where:** `src/parser.rs:31-48` (`load_schedule()` → `include_str!("../data/schedule.json")` → `fs::write("data/schedule.json", embedded)`), `src/main.rs:189`.
- **Proof (fresh install simulation):** after copying `quizradar.exe` to an empty dir and starting it, `data/schedule.json` was auto-created with 6 courses (`MATH 101, ACCT 101, MGMT 100, COMP 101, ENG 101, HUM 101`) and 11 slots — several flagged `"has_quiz": true` with concrete quiz titles ("Class Quiz 1: Equations & Matrix Algebra", "Lab Quiz 1: Computer Hardware & OS Navigation"), rooms ("Hall 201", "Computer Lab 4") and an embedded `"Fall 2026"` semester. All served by `/api/state` + `/api/schedule` as if it were the user's data.
- **Why it matters:** the README (v3.0 feature list) claims *"Clean First-Run State: Zero preloaded personal data or hardcoded subjects"* — demonstrably false for desktop.
- **Personal-data leak vector:** because `data/schedule.json` is the app's **live data file** for the developer too, whatever schedule exists at build time gets baked in. A past shipped build (target exe dated Oct 18) embedded & served **`CSE241/CSE252/CSE261/CSE262/CSE263/GSE211 — "Fall 2026 (Semester 91)"` with rooms like "C212 O"** — the developer's real semester. File `data/schedule.json` is committed to git (`git ls-files` confirms) — the leak cycle is: use app → app writes your real schedule → commit → release → every user gets your schedule.
- **Severity: Critical (trust + privacy).**

### A2. "Scan my timetable" fabricates a fake schedule instead of reading the image
- **Mobile/PWA/engine path (this is what users hit):** `static/app.js:590-633` (`/api/schedule/extract` handler inside the intercepted engine). If no Gemini API key is present (default for a new user), the handler **ignores the uploaded image entirely** and returns a hardcoded 5-course fictional schedule:
  - courses: `CS 101 "Introduction to Computer Science"` (instructor *Dr. Sarah Adams*), `MATH 101` (*Prof. Elena Rostova*), `DATA 201`, `MGMT 100` (*Prof. Claire Sterling*), `PHYS 101` (*Dr. David Chen*);
  - 5 slots with fixed rooms in "Hall B-204", "Hall A-101", "Lab C-302"…
  - reported extractor name: **"On-Device Neural OCR Extractor"** — no OCR of any kind exists on-device.
- The result is then rendered into "Enrolled courses & timetable" and persisted via `/api/schedule/save`.
- **Desktop backend path (currently orphaned by B1, but still wrong):** `src/gemini.rs:327-332` — on any Gemini error **or missing API key**, returns `Ok(fallback_sched)` (the on-disk demo schedule or the hardcoded one in `extract_fallback_schedule_heuristically()`, `gemini.rs:335-475`) presented as a successful extraction of *the user's uploaded file*.
- **First-run story:** student uploads *their* timetable screenshot with no API key → gets the dev's fake schedule "extracted" → their real data is "weird". **This is almost certainly the exact weird-data incident reported.**
- **Severity: Critical.**

### A3. Microsoft Teams sync invents classes & quizzes for every user
- `src/teams.rs:447-455` — heuristic fallback: if none of the user's Teams matches six hardcoded keywords (math/calculus, financial accounting, management, "basics of computer", eng1/elc2, human rights), the code **force-enables all six demo courses** and generates assessments with fabricated titles, dates ("2026-10-22 … 2026-10-26", already in the past for a release user), instructors ("Dr. Sarah Adams", "Accounting Faculty"), rooms ("Hall 201", "Microsoft Teams Submission") at `teams.rs:539+`.
- `src/teams.rs:115-121` (`clean_team_course_name`): **any** team whose name contains "math"/"calculus" is renamed to *"MATH 101: Calculus & Linear Algebra"* — the unit tests (`teams.rs:1007-1009`) codify this: `"Advanced Calculus"` → demo course name. So even real users' courses get renamed/merged into the demo course set.
- `src/main.rs:772-782` — when Teams returns discovered courses, it **overwrites the user's existing schedule** (`sched.courses = teams_res.discovered_courses`) — so one bad sync replaces their real timetable with the fabrication.
- **Severity: Critical.**

### A4. Moodle "connect" shows quiz data for a non-configured LMS
- `src/moodle.rs:424-427` — if Moodle is enabled but **no iCal URL/token configured** (the exact state a first-time toggler produces), `sync_moodle_assessments()` returns `generate_moodle_sample_assessments()` — fake items "Moodle Lab Quiz 2: Pattern Classification" for `DATA 201`, "Moodle Online Assignment: Graph Traversal" for `CS 101`, with a fake portal URL `https://moodle.university.edu`, fake weightage 10%, fake grading warnings.
- `src/main.rs:1228` even toasts "Demo Moodle connection active! Verified 2 sample course quizzes."
- **Severity: High.**

### A5. Google Classroom sync fabricates data when unauthenticated
- `src/classroom.rs:57-59` — if Classroom is toggled on without a Google token, returns `generate_classroom_sample_assessments(schedule)` (fake coursework). Also `classroom.rs:84-96` — hardcoded fallback due date **2026-10-30, 12:00** when the API item has no due date/item set.
- **Severity: High.**

### A6. Email parser is hardwired to the developer's inbox
- `src/parser.rs:255-261` — instructor name overridden by **exact Gmail message IDs** (`if email.id == "1a13437e51244663" { instructor = "Dr. Marcus Vance" }` …).
- `src/parser.rs:466-576` — `infer_schedule_date_and_slot()` returns **exact dates/times/rooms/titles for 9 specific message IDs** from the developer's inbox, presented as "Gemini Schedule Inference:" notes (regardless of whether Gemini was actually used).
- `src/parser.rs:638-698` (`extract_topics`) and `src/parser.rs:700-760` (`extract_warnings`) — more per‑message-ID hardcoded topics/warnings.
- Everyone else falls through to heuristics: "next week" → **+5 days**) (`parser.rs:579-589`), room default "Lecture Hall", time default 09:00–10:30 — i.e. **arbitrary dates** that look legit but are guesses, in the exact "AI inference" style the UI shows.
- **Severity: Critical (the "weird data" the parser produces for normal users).**

### A7. Keyword course forcing & filter brittleness
- `src/parser.rs:221-227` — any email body mentioning "physics" → forced to `PHYS 101`; "computer science" → `CS 101`; "data structure/algorithm" → `DATA 201`, independent of the user's enrolled courses.
- `src/parser.rs:137-185` (`is_candidate_assessment_email`) — filters are dev-specific (datacamp, Imagine Cup, "she impacts", tot program…). Any newsletter containing "exam/quiz/assignment/test" in the subject (marketing emails, campus notices) becomes a fake "Class Quiz".
- `src/parser.rs:194` — no parseable sent date → `unwrap_or(ref_date)` → the announcement is dated **today** → "TODAY" critical red urgency banner for garbage emails.
- **Severity: High.**

### A8. Fabricated engagement stats & default rooms in the shared engine
- `static/app.js:203-204` (`recomputeDashboard`): `hours_studied = 12 + completed*1.5` and `study_streak_days = 4` whenever any assessment exists — users see a 4‑day streak they never earned (fields currently rendered nowhere, but shipped in the payload and any future UI will surface them).
- `static/app.js:156`: default `room: a.room || "Hall B-204"` — a missing room displays a **specific fake room** instead of "TBA".
- `static/app.js:185`: fake readiness 80% when recommendations list is empty but assessments exist.
- **Severity: Medium (currently partially latent, root of "weird numbers" tags after refactors).**

### A9. `?demo=` screenshot mode mutates real user state
- `static/app.js:2085-2122` + `applyDemoDummyData()` (`app.js:2171-2249`): opening the app with `?demo=dashboard` (etc.) — e.g. from a link — overwrites assessments' instructors with *Prof. Alan Turing / Prof. Carl Gauss / Dr. Grace Hopper / Dr. Richard Feynman*, marks two topics completed (`completed_topics[key]=true` — these keys **persist via saveStateCache**), pins readiness to `26/23 topics`. No banner ever explains it, and the pollution persists after the demo URL is removed.
- **Severity: Medium.**

---

## B. Critical: split-brain architecture — the UI never talks to the Rust backend

### B1. `window.fetch` interceptor is installed unconditionally
- `static/app.js:721-748` — the interception is installed **for every platform** (desktop, Android, PWA), despite the comment *"Intercept all /api calls on mobile or in standalone mode"*. There is no `IS_NATIVE` gate and no try-original-first fallback.
- Verified in a headless browser against the live backend (`http://127.0.0.1:5000/`): the UI rendered the wizard + empty dashboard while the backend simultaneously served a full schedule at `/api/state` — **the two halves of the app never connect**.
- Consequences:
  - Real OAuth (`/api/auth/google`, token.json, gmail.readonly scopes) is unreachable from the UI.
  - Real Gmail/Moodle/Teams/Classroom sync (`run_sync_pipeline`, `src/main.rs:743-862`) is unreachable — including the parts that are honest and only produce real data.
  - Google Calendar push (`/api/gcal/sync`), updater, grading, pairing (`/api/sync/pair/info`) — all orphaned.
  - Every button exists in the UI as theatre (see C).
- **Severity: Critical (defines the entire product behavior).**

### B2. Because of B1, the desktop's *real* features are dead code but still dangerous
- The backend on first-run still writes the demo `data/schedule.json` (A1) and, when Teams sync *is* triggered by API, overwrites schedules (A3). Anyone pairing an HTTP client (or restoring the fetch gate) inherits all of A.
- Startup filter (`main.rs:195-210`) keeps assessments that belong to the demo schedule — the demo courses actively *uncancel* filtered demo emails.
- **Severity: High (time bomb).**

---

## C. First-run UX theatre (success toasts for fake work)

### C1. Onboarding "Scan All Sources" is staged fiction
- `static/app.js:5307-5341` — hardcoded progress stages: *"Connecting to Gmail API & fetching university announcements…"* and *"Cross-referencing emails against **6 Fall 2026 courses & 14 weekly slots**…"* — dev's numbers, shown even when the user has zero courses and zero accounts.
- On mobile the intercepted `/api/sync` returns `{success:true}` with no data; the UI then toasts *"Scan complete — N upcoming assessments… resolved!"* or the generic success line. On desktop the real `/api/sync` would respond honestly-but-misleadingly *"Omni-Channel Sync complete! Scanned Gmail, Moodle, Teams & Classroom"* even with **nothing connected** (verified live: fresh instance, no accounts, message claims a full multi-source scan occurred).
- `/api/sync` sets `last_gmail_sync` **even when not authenticated** (verified: `sync.json` had the timestamp with `user_email: null`) → top bar shows "Last synced 21:08" implying a Gmail scan happened.
- **Severity: High.**

### C2. Account "connecting" = typing an email
- Google: `static/app.js:907-958` (`saveGoogleAccountProfile`) — typing a name+email sets `auth.authenticated = true`. No OAuth anywhere.
- Teams: `static/app.js:988-1029` — typing a university email sets `teams_enabled = true`.
- Wizard: `finishOnboarding()` (`app.js:5363-5374`) does the same; the wizard's three "hub.cards" (`handleOnboardGoogleCardClick` etc., `app.js:4633-4674`) just focus an input — yet the UI copy promises "Connect →", "Configured in Step 1", and badge states default to **"Ready" for Google/Classroom in the raw HTML** (`index.html:1515,1563`) even though nothing is connected.
- All of this runs **on desktop too** — `startGoogleAuth()` opens the manual-entry modal rather than the real OAuth endpoint; the real flow would only be reachable via `<a href="/api/auth/google">`, which the click-guard intercepts (`app.js:1156-1179`).
- **Severity: High.**

### C3. Mobile "cloud sync" and pairing are fictional
- Engine `/api/sync/cloud/push|pull` (`app.js:660-672`): replies *"Data backed up to on-device encrypted storage."* — it merely re-saves plain-text `localStorage` (`STANDALONE_STORAGE_KEY`). Nothing is encrypted, nothing is pushed anywhere.
- There is **no UI to pair with the desktop** — the only handler for `/api/sync/pair/info` is the engine stub that claims `standalone: true`. The desktop's pairing endpoint (`get_pairing_info_handler`, `main.rs:1695-1713`, verified live returning `connect_url: http://192.168.1.103:5050/`) is unused by the app itself. The `package.json` description "Cross-Device Cloud Sync" and the README pairing story are not wired.
- Desktop cloud sync (`src/cloud_sync.rs`): requests **no `drive.appdata` OAuth scope** (`auth.rs:149-157`), so Drive push always fails and the fallback **writes the whole app state into a Google Calendar event description** (`cloud_sync.rs:302-308`) — Calendar descriptions cap around 8 KB → silent truncation makes pulls fail with "Invalid sync payload"; the sync event also lands in the user's real calendar (hardcoded 2026-10-18 date, `transparency:transparent` only makes it non-busy — it is still visible in monthly printouts/exports). `teams_token` is serialized into that calendar event — tokens synced into a calendar render is questionable.
- **Severity: High (feature integrity + security smell).**

### C4. Onboarding → backend mismatch
- `main.rs:531-579` `complete_onboarding` ignores `user_name`/`user_email`/`teams_*` fields sent by the wizard (`app.js:5388-5400`) — the backend never records them; if the server config is later served (paired mode), the wizard's typed identity evaporates.
- **Severity: Medium.**

---

## D. Broken / dead infrastructure a new user will hit

### D1. Updater and all GitHub release links 404
- `src/updater.rs:27` checks `https://api.github.com/repos/TheDragonSoft/QuizRadar/releases/latest` — verified **404** (repo doesn't exist / is private). So `/api/updater/check` always returns an error and every `README.md` download link (Setup exe, APK, DMG, deb, "Latest Release" badge, PWA URL `thedragonsoft.github.io/QuizRadar/`) is dead for the public.
- **Severity: Critical for distribution; every first-time user starts at a 404.**

### D2. Offline PWA / styling depends on CDNs not covered by the service worker
- `index.html:19` loads Tailwind from `cdn.tailwindcss.com` (dev JIT CDN — prints "should not be used in production", slow, and `sw.js` does **not** cache it) + Google Fonts (`index.html:27-29`) + unpkg lucide fallback (`index.html:35-39`).
- `sw.js` STATIC_ASSETS only lists local files → first offline launch (or blocked CDN) = **completely unstyled app**. This hits Android WebView cold starts too (needs internet once for styling).
- **Severity: High on flaky networks.**

### D3. Server binds `0.0.0.0` with no auth
- `src/main.rs:172-183` — the app's HTTP API (including `/api/sync/pair/info`, auth callbacks, whatever ends up wired) listens on **all network interfaces**; neighbors on the same Wi‑Fi can enumerate `/api/state` (incl. schedule, email-derived data). Also binds arbitrary common ports (5000/3000/8080) if 5050 is taken.
- `token.json` with gmail.readonly scope is written **next to the exe** (CWD) in plaintext (`auth.rs:139-143`, `main.rs:521`) — survives uninstalls, readable by other local programs.
- **Severity: Medium-High.**

### D4. Stale mobile version identity
- Engine returns `current_version: "2.1.0-standalone"` (`app.js:682`) while the app is v3.2.0; README APK says v3.1.0; `package.json`/`Cargo.toml` say 3.2.0. Any update-diff UI would immediately be wrong.
- **Severity: Low-Medium.**

### D5. Stale shipped binary vs source (already observed)
- The installed app currently running on the dev machine (PID built Oct 18) answered `reference_date: 2026-10-17` and 404'd `/api/sync/pair/info` — source fixed these; the *installed* copy didn't have them. Release discipline needed: always build from a clean tree (see A1's leak note).
- **Severity: Process.**

---

## E. Smaller correctness issues spotted along the way

| # | Issue | Location | Notes |
|---|-------|----------|-------|
| E1 | Gmail sync refetches up to 10 already-cached emails every sync (wasted quota/latency) | `gmail.rs:161` | `fetched_count > 10` gate inverted logic |
| E2 | Live Gemini analysis gate is `email.date.contains("Oct 2026")` | `parser.rs:85-89` | hard month filter — stops working in November |
| E3 | Dedupe key ignores source: same course+title+date from Gmail and Teams collapse | `parser.rs:101-104` | minor |
| E4 | Discord-style multi-source counts include fabrications (A3-A5) so counts lie | `parser.rs:1006-1011` | cosmetic once A fixed |
| E5 | `days_until` fixed by engine for old recs but `study_recommendations` not recalculated at load | `app.js:2045-2070` | stale "IN X DAYS" after midnight |
| E6 | Study-block scheduler hardcodes 17:00-18:30 placement for all blocks (no clash detection w/ classes) | `main.rs:1542-1600` | books a conflict if lecture is at that hour |
| E7 | Proof of demo-inbox usage in production config: real user's `completed_topics` contained keys `1a125bc4af1ed819::0…` (the dev demo email IDs) | observed on live installed instance | the hardcoded-id pipeline actually ran |
| E8 | `/api/sync` "message" copy says "Gemini Schedule Reasoning" even when no key configured | `main.rs:863+` | overpromise in UI copy |
| E9 | ICS `PRODID` says v2.0 | `main.rs` templates | cosmetic |
| E10 | `README.md` claims a 3-step setup wizard on a clean canvas and autonomous on-device engine; reality = manual email entry, no engine ingestion (B/C) | docs | docs/UX mismatch |
| E11 | Cloud-sync fallback event uses hardcoded date `2026-10-18` (shows in Cal) | `cloud_sync.rs:306-307` | |
| E12 | `PopulateAcademicData()` now a no-op (good), but legacy mock scrub list (`app.js:51-56`) hardcodes only 4 assessment ids — other ghosts survive | `app.js:50-57` | cf5d32c partial fix |

---

## F. Verified-working areas (for balance)

- **Real Rust features that work when API is called directly:** fresh-install config/onboarding state honest (`onboarding_completed: false`), `/api/sync` honest "Found 0" when nothing connected (modulo the "scanned everything" wording), `/api/schedule` endpoints (add/delete course) update & repersist correctly, `/api/calendar/ics_all` returns valid ICS, `cargo test` green (32/32), rebuild `cargo build --release` 1m05s OK, mobile engine mock-scrub (cf5d32c) works on the client, first-run wizard does open on a truly-empty browser profile (DOM dump proof), theme switch + haptics + local toggle flows intact, Android assets (`assets/public/`) are byte-identical to `static/` — no stale APK webview code.
- **Mobile engine's own custom-event flow** (`app.js:416-449`) stores what the user actually provided (except `days_until: 3` hardcode which recompute overrides later — minor).

---

## G. First-time-user journey verbatim (what actually happens)

**Desktop (fresh install, verified):**
1. Launch →WebView opens → UI immediately reads *its own* localStorage (empty) → **wizard opens** ✔.
2. User enters name/email (no OAuth), chooses theme → "Scan All Sources" → staged progress ("Connecting to Gmail API… 6 Fall 2026 courses & 14 weekly slots…") → nothing fetches → success toast + empty dashboard.
3. Meanwhile the *backend* wrote its demo MATH 101… schedule.json to disk (invisible to the user, but shipped).
4. Try "Add to Google Calendar" → engine stub "succeeds" (no token involved); if the real backend were wired, `auto_sync_gcal: true` default would push even without scope checks.
5. Update check → GitHub 404 (D1) → "GitHub API returned status: 404".

**Android (fresh install, same UI in Capacitor; verified via identical assets + engine audit):**
1. Wizard opens (blank canvas ✔ — commit cf5d32c purged the starter courses).
2. "Connect Google Workspace" → focus email field; type Gmail → "Google-authenticated" (no OAuth). Teams likewise.
3. "Scan All Sources" → intercepted → "Radar synced. No connected university accounts found." toast but progress bar previously claimed Gmail API connection; KPI "Last sync: Just now" (engine writes it).
4. Upload timetable image → **fabricated 5-course schedule** (A2) labeled "On-Device Neural OCR Extractor".
5. Cloud Sync modal → "Backed up to on-device encrypted storage" (localStorage, C3), no pairing.

**PWA (GitHub Pages URL from README)** — the URL 404s (D1), so iOS users can't even install.

---

## H. Recommended fix order

1. **Unblock the backend from the frontend:** gate the fetch interceptor behind `IS_NATIVE` (or remove it and wire the real `/api/*` endpoints in the UI so OAuth/sync truly run). This single change re-enables all the *real* features already implemented in Rust.
2. **Kill all seed/demo data paths:** empty `data/schedule.json` embedded string (serve `{courses:[],slots:[]}`); delete `extract_fallback_schedule_heuristically()`, `generate_moodle_sample_assessments`, `generate_classroom_sample_assessments`, the Teams `explore_teams_heuristically` fabricated courses & assessments, and every hardcoded `email.id` branch in `parser.rs`. Return **"no data configured" errors**, never fake data.
3. **Remove the personal-data pipeline:** stop committing `data/schedule.json` (it's the dev's live data), move developer data to `data/` (gitignored dir) — embed a truly empty schedule.
4. Make `/api/sync`, `/api/gcal/*`, `/api/updater` **fail honestly** with a "connect an account first" message instead of success toasts; set `last_gmail_sync` only after a real fetch; drop auto_sync_gcal default true pre-auth.
5. Onboarding: real OAuth buttons (desktop `window.location = /api/auth/google`), honest badges (not "Ready"), and persist `user_name/user_email` server-side.
6. Fix the release channel: create the public GitHub repo/release assets (updater 404), update README links, align APK/web versions to 3.2.0, and replace Tailwind CDN with a self-hosted built CSS (served locally + precached in `sw.js`, fonts self-hosted too).
7. Security: bind `127.0.0.1` by default (add explicit "LAN pairing" toggle that rebinds 0.0.0.0), request `drive.appdata` scope for cloud sync (or replace the calendar-event storage), store `token.json` under an OS-appropriate profile dir, prompt on uninstall.
8. Stats honesty: delete fabricated `hours_studied/streak/readiness` defaults and the `Hall B-204` default room; show "—" when unknown; remove `?demo=` state-mutation or make it read-only/ephemeral.

_Everything above was reproduced or traced to exact code lines; no speculative findings are included._
