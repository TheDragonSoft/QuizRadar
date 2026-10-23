# 02 — Current Architecture (as-built, v4.3.0, Oct 2026)

_This doc is the factual "how it works today" record. Sizes/line counts verified in the static audit._

## 1. Stack map (bird's eye)

```
┌────────────────────────── ONE WEB BUNDLE (static/, ~1.2 MB) ──────────────────────────┐
│  index.html (2,759 lines) · app.js (10,474 lines, 453 KB, global-namespace SPA)       │
│  tailwind.css (prebuilt, self-hosted) · Inter fonts (self-hosted) · lucide.min.js     │
│  sw.js (PWA precache) · qrcode.js · manifest.webmanifest                              │
└───────────────┬────────────────────────────┬─────────────────────────┬────────────────┘
                │                            │                         │
   ┌────────────▼─────────────┐  ┌───────────▼────────────┐  ┌─────────▼─────────────┐
   │ DESKTOP: Rust + tao/wry  │  │ ANDROID: Capacitor 6   │  │ WEB: PWA (GH Pages/   │
   │ WebView2 loading its OWN │  │ WebView loads assets   │  │ vercel deploy of      │
   │ Axum server on 127.0.0.1 │  │ locally; window.fetch  │  │ static/)              │
   │ :5050 (probe list)       │  │ intercepted → in-JS    │  └───────────────────────┘
   │ REST API on /api/*       │  │ "QuizRadarAutonomous-  │
   │ (real sync, real OAuth,  │  │ Engine" re-implements  │
   │ pairing, updater…5,744   │  │ the desktop API in JS  │
   │ LOC Rust)                │  │ (native-only gate)     │
   └──────────────────────────┘  └────────────────────────┘
                 also: Java native layer (MainActivity + 3 classes) — loopback HTTP
                 OAuth server on :3000, widget bridge, share ingest, refresh tokens
```

**The defining quirk:** the same HTTP API is implemented **three times**:
1. **Axum/Rust** (`src/main.rs`) — the desktop reality.
2. **JavaScript** (`static/app.js` class `QuizRadarAutonomousEngine`) — installed **only when `IS_NATIVE`** (`app.js:2258-2307`); answers every `/api/*` route the UI calls, does real Gmail/Graph/Moodle scanning directly from the WebView with access tokens.
3. **Java** (`android/app/src/main/java/com/quizradar/app/LocalOAuthServer.java`, 642 lines) — raw `ServerSocket` loopback on `127.0.0.1:3000` for the Android OAuth bridge (`/api/auth/prepare|refresh|callback...`), holding **hardcoded OAuth client credentials**.

## 2. Code inventory

| Component | File(s) | Size | Notes |
|---|---|---|---|
| Rust backend | `src/main.rs` | 3,118 lines / 115 KB | router + 30+ handlers + session middleware + inline HTML templates + pairing + updater glue + percent-encoder + tests |
| | `src/parser.rs` | 1,747 / 64 KB | email→assessment pipeline, dashboard builder, deterministic planner |
| | `src/gemini.rs` | 1,424 / 56 KB | all six AI call sites + fallback heuristics |
| | `src/teams.rs` | 784 / 28 KB | Graph client + OAuth + heuristic exploration |
| | `src/moodle.rs` | 791 / 29 KB | iCal parser + REST + sample-generation legacy |
| | `src/auth.rs` | ~19 KB | Google OAuth + token cache + XOR-obfuscated fallback creds |
| | others | classroom 11 KB, gcal 12 KB, cloud_sync 16 KB, feeds 4 KB, gmail 13 KB, models 14 KB, updater 8 KB | |
| Desktop shell | `src/main.rs` | — | tao 0.30 window + wry 0.47; WebView2 user-data pinned to `%LOCALAPPDATA%\QuizRadar\WebView2`; `std::process::exit(0)` on close |
| Frontend | `static/app.js` | 10,474 lines | no modules; ~300 global fns bound via inline `onclick`; includes a parity port of parser.rs email logic |
| | `static/index.html` | 2,759 lines | one 300-line inline `<style>`; all template-heavy content emitted from JS string literals |
| Android | `MainActivity.java` (436), `LocalOAuthServer.java` (642), `OAuthSigninService.java` (89), `QuizRadarWidgetProvider.java` (157) | — | plus gradle project (AGP 8.2.1, minSdk 23, target 34) |
| Legal/branding | `installer/QuizRadar.iss`, `scripts/*.ps1/.sh/.py` | — | Inno, dmg, deb, Android asset generator |
| Tests | `cargo test` 32/32 green (Rust only) | — | **zero frontend tests, zero PR CI** |

## 3. Data model (exact schemas, as serialized today)

### 3.1 `data/schedule.json` — the timetable
```jsonc
{
  "semester": "My Semester",              // inferred "Fall 2026" style strings exist too
  "courses": [ { "id": "CSE241", "name": "...", "color": "#hex", "bg": "rgba(...)", "border": "rgba(...)" } ],
  "slots": [ {
    "id": "slot-1", "day": "Sun", "day_index": 0, "course_id": "CSE241", "course_name": "...",
    "room": "Hall B-204", "type": "Lecture",      // field renamed from slot_type via serde
    "group": "Sec 1", "start_time": "08:00", "end_time": "10:30", "display_time": "08:00–10:30",
    "has_quiz": false, "quiz_title": null
  } ]
}
```
First run seeds from bundled `data/schedule.template.json` (empty) — `parser.rs:42-53`.

### 3.2 `data/app_config.json` — everything else (AppConfig, 27+ keys)
```jsonc
{
  "onboarding_completed": false,
  "auto_sync_gcal": true,                  // NOTE: true by default pre-auth (issue)
  "sync_weekly_classes_to_gcal": false,
  "gemini_enabled": false, "gemini_api_key": null,       // plaintext on disk
  "user_email": null, "user_name": null, "user_picture": null,
  "last_gmail_sync": null, "last_gcal_sync": null,       // "YYYY-MM-DD HH:MM"
  "completed_topics": { "assessment_id::0": true },       // single source of truth
  "synced_gcal_map": { "<assessment_id>": "<gcal_event_id>" },
  "custom_events": [ { "id","title","course_id","event_type","date_iso","start_time","end_time","room","notes","color" } ],
  "feeds": [ { "id": "feed-<unix_ms>", "name", "url", "enabled" } ],
  "pairing_pin": null,
  "moodle_enabled": false, "moodle_url": null, "moodle_token": null, "moodle_ical_url": null,
  "teams_enabled": false, "teams_client_id": null, "teams_token": null, "teams_account_name": null, "teams_account_email": null,
  "classroom_enabled": false,
  "grades": { "<assessment_id>": { "achieved_score","max_score","weightage_percent" } },
  "dismiss_conflict_banner": false
}
```

### 3.3 `Assessment` (the radar item — serialized into nearly every API payload)
`id`, `course_id`, `course_name`, `title`, `assessment_type`, `date_iso (YYYY-MM-DD)`, `day_name`, `start_time/end_time (HH:MM)`, `display_time`, `room`, `group`, `instructor`, `is_upcoming`, `days_until`, `urgency_level` (critical/high/medium/upcoming/past), `priority_score 0..=100`, `topics[]`, `warnings[]`, `ai_inference_note`, `ai_study_plan`, `estimated_study_hours f32`, `elearning_url`, `google_cal_url`, `gcal_synced`, `gcal_event_id`, `color/bg/border`, `semester`, `email_subject`, `email_sent_date`, `source` (Gmail/Moodle/Microsoft Teams/Microsoft Outlook/Google Classroom/feed label), `source_icon`, `weightage_percent/achieved_score/max_score`, `conflict_warning`. Ids conventionally `<source>-…` (`teams-`, `moodle-`, `classroom-`, `feed-`) — source gating keys off these prefixes (`models.rs:147-182`).

### 3.4 All runtime state files (paths relative to process CWD!)
| Path | Contents | Notes |
|---|---|---|
| `data/app_config.json` | see 3.2 | atomic tmp+rename writes |
| `data/schedule.json` | see 3.1 | atomic writes |
| `processed_quizzes.json` | full snapshot of parsed assessments | repo root |
| `quiz_emails_cache.json` | last 500 Gmail emails (subject/from/date/body ≤4500 chars) | repo root |
| `data/gemini_parsed_cache.json` | AI extractions keyed by Gmail message id, pruned to live set | |
| `token.json` | Google OAuth incl. client_secret in plaintext | repo root |
| `microsoft_token.json` | Graph tokens | repo root |
| `panic.log`, `credentials.json` | — | root |
| `%LOCALAPPDATA%\QuizRadar\` | fallback CWD if install dir unwritable + WebView2 data dir | |
| `%TEMP%\QuizRadar-Setup-Update.exe` | updater download | |

**CWD resolution quirk** (`main.rs:303-331`): walks up from exe if `Cargo.toml` exists; else exe dir; then falls back to `%LOCALAPPDATA%\QuizRadar` when unwritable — tokens land wherever CWD lands (portable vs installed differ).

## 4. HTTP API surface (Axum, desktop reality)

Shared state = `Arc<RwLock<…>>` over `{config, schedule, assessments}`. Port probe `[5050, 5000, 3000, 8080, 5150, 5250, 0]`. **Session middleware**: per-launch token (`?kr_session=…` → HttpOnly cookie `kr_session`); tokenless requests (except 5 OAuth callback paths) get a 403 "Private Desktop Interface" page. `--lan` ⇒ bind `0.0.0.0` + permissive CORS + optional `x-quizradar-pin` header gate for non-loopback callers.

| Method+Path | Purpose | Notes |
|---|---|---|
| GET `/` | index.html (ETag-cached, compiled-in fallback) | |
| GET `/api/state` | full state: config (secrets redacted if remote) + auth + schedule + assessments (source-filtered) + dashboard + study tasks | main poll |
| GET `/api/status` · `/api/quizzes` | legacy | **dead** |
| GET `/api/schedule` | schedule | rarely used (state covers it) |
| GET `/api/auth/google/url` · `/api/auth/google`(+`/login` alias) | OAuth redirect/URL | UI uses `/url` |
| GET `/api/auth/callback` | Google OAuth callback; success/cancel/error HTML cards | external browser |
| POST `/api/auth/logout` (+alias) | delete token.json, reset onboarding | |
| POST `/api/onboarding/complete` / `/reset` | complete accepts profile+flags; **reset has no UI caller** | |
| POST `/api/sync` | full multi-source pipeline (`run_sync_pipeline`, ~285 lines) | |
| POST `/api/gcal/sync` | push upcoming to primary calendar (idempotent upsert via `synced_gcal_map`) | |
| POST `/api/study/toggle` · GET `/api/study/tasks` · POST `/api/study/tasks/optimize` | topic toggle (dashboard/tasks payload), deterministic plan, AI optimize w/ fallback note | |
| POST `/api/events/custom` · DELETE `/api/events/custom/:id` | custom events | hardcoded demo-color fallbacks |
| POST `/api/schedule/extract` | AI timetable extraction from base64 image/PDF | honest errors |
| POST `/api/schedule/save` · POST/DELETE `/api/schedule/courses[/:id]` | schedule editing | re-parses email cache after |
| GET `/api/calendar/ics/:id` · `/ics_all` | .ics export (floating local times, 2 VALARMs) | |
| POST `/api/config/update` | config merge; enable⇒spawn sync | |
| POST `/api/moodle/test` · `/api/moodle/sync` | test iCal/REST; **empty config ⇒ fabricated success "Demo Moodle connection active! Verified 2 sample course quizzes", count=2** | sync handler hardcodes `"synced_count": 2` |
| GET `/api/feeds` · `/api/feeds/test|save|delete` | ICS feeds CRUD (https-only, ≤10) | |
| GET `/api/microsoft/url` · `/login` · `/api/auth/microsoft/callback` | Graph OAuth | |
| POST `/api/microsoft/test` · `/logout` | test/save token; **test returns UNREDACTED full config** | security issue |
| GET+POST `/api/classroom/test` | probe | broken by scope absence (see §6.5) |
| POST `/api/assessments/:id/practice` · `/grade` | AI quiz or deterministic fallback; grade partial update | |
| POST `/api/study/blocks/schedule` · `/api/conflicts/dismiss` | auto study blocks / banner dismiss | |
| GET `/api/updater/check` · POST `/api/updater/install` | GitHub release check (allow-listed download), installer handoff | URL allow-list enforced |
| POST `/api/sync/cloud/push|pull` | Drive AppData sync (fallback: calendar-event storage) | |
| GET `/api/sync/pair/info` · POST `/api/pairing/pin` | LAN pairing info (local IP, QR payload, PIN) · PIN set/clear (loopback-only) | |
| GET `/static/*` + aliases, `/sw.js`, `/manifest.webmanifest`, `/styles.css` | static serving w/ ETag; ServeDir fallback | |

**The Java loopback server** (Android only, port 3000): `/api/auth/prepare`, `/api/auth/refresh`, `/api/auth/callback`, `/api/auth/microsoft/callback`, `/api/state` — exists so refresh tokens never enter the WebView (kept in app-private SharedPrefs; JS receives only short-lived access tokens + `\_\_quizradarBridgeKey`).

## 5. Integrations (as implemented)

### 5.1 Google OAuth (`auth.rs`)
Desktop-app style flow: authorize `accounts.google.com/o/oauth2/v2/auth` → token exchange → `token.json` (contains `client_secret`) + 5-min RAM cache + bearer-ping validity check. Scopes: `gmail.readonly`, `userinfo.email/profile`, `calendar.events`, **`drive.appdata`**. CSRF: single pending state, single-use, 15 min. Client creds precedence: `credentials.json` → env → **XOR-obfuscated constants in the binary** (`auth.rs:13-36`).

### 5.2 Gmail (`gmail.rs`)
5 text queries ×35 ids, dedupe, ≤10 refreshes of cached, 8-way concurrent fetches, MIME walk (plain → stripped HTML), body cap 4,500 chars, cache cap 500 sorted by hex id.

### 5.3 Microsoft Teams (`teams.rs`)
OAuth v2 `login.microsoftonline.com/common`, client id = "Microsoft Graph Command Line Tools" (`14d82eec-…`) or user-supplied; scopes `offline_access User.Read Mail.Read Calendars.Read`. Fetch `/me/joinedTeams` → per team: channels → tabs → drive root + 1 level of subfolders → conversations (paged ≤10, 4-way concurrency). AI exploration (`gemini.rs explore_and_extract_academic_universe`) adopted wholesale IF it returns courses; else heuristic fallback producing courses-only (noise-name filter, no keyword renaming anymore). Adoption rule: Teams courses/slots overwrite schedule only when schedule is empty or AI found a semester.

### 5.4 Moodle (`moodle.rs`)
Two channels run concurrently: personal **iCal URL** (token embedded in URL, https-enforced) and **REST** `{base}/webservice/rest/server.php` w/ `wstoken` + `core_calendar_get_calendar_events`. ICS parser: VEVENT regex, quiz/exam keyword filter, `U`-suffix UTC→local, course match by code substring else `GEN100` fallback, urgency ladder, warnings for time-limit/password. Empty config ⇒ honest empty result.

### 5.5 Google Classroom (`classroom.rs`)
`courses?courseStates=ACTIVE` + `courseWork` paginated; uses the Google `token.json` bearer. **But `classroom.*` scopes are never requested in the OAuth URL** (`auth.rs:248-258`) ⇒ 403 apology path is by-design-broken: works only if grant pre-exists. Items without `dueDate` are skipped (honest).

### 5.6 Google Calendar (`gcal.rs`)
Push/update via `calendars/primary/events` POST/PUT keyed by `synced_gcal_map` (404⇒re-create; 403/401⇒never marked synced). Event body: title `⚡ [COURSE] Title`, location "University Campus - Room X (group)", description = topics + warnings + AI strategy + inference note + link, reminders −1d/−2h, **local-offset datetimes** (no IANA tz). Template URLs (`/calendar/render?action=TEMPLATE`) stored per assessment. Degradation: no calendar scope ⇒ report `needs_calendar_scope`.

### 5.7 Cloud sync + pairing (`cloud_sync.rs`)
- **Drive channel:** search/PATCH-or-create `appDataFolder/quizradar_cloud_state.json` containing `{schema_version:1, client_device_id, updated_at, profile ids, schedule, assessments, grades, completed_topics, custom_events, teams_enabled+teams_token, moodle/classroom flags}` — **uploads the Microsoft token to Google Drive**.
- **Calendar fallback:** a "today" 5-min transparent event `[QuizRadar-Device-Sync-State]` whose description holds JSON between `---QUIZRADAR_DATA_START/END---` (≤8 KB, refuse-to-truncate); MS token stripped here.
- **Pairing/--lan:** bind 0.0.0.0, permissive CORS, PIN `x-quizradar-pin` gate; local IP via UDP-connect trick; QR payload = URL + optional `#pin-required` (PIN itself never in QR).

### 5.8 Feeds (`feeds.rs`)
HTTPS-only .ics subscriptions (≤10) reusing the Moodle parser; ids `feed-*`; bypass source toggles by design.

### 5.9 Updater (`updater.rs`)
`api.github.com/repos/TheDragonSoft/QuizRadar/releases/latest`; asset match by filename substrings (`Setup|installer|quizradar`, `Portable`); download → `%TEMP%` → spawn installer → `exit(0)` after 1.5 s. URLs allow-listed (https + repo path prefix, MITM-tested).

## 6. AI layer (`gemini.rs`, all 1,424 lines)

- **Model/endpoint everywhere:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, temp 0.1–0.2, `responseMimeType:"application/json"`, key sent via `x-goog-api-key` header (never in URL), errors key-redacted. Timeouts 10–60 s.
- **Key management:** `AppConfig.gemini_api_key` (plaintext) OR env `GEMINI_API_KEY`/`GOOGLE_API_KEY`. **OAuth-bearer fallback:** most AI call sites silently retry with the user's Google access token — AI runs on the user's Google account without any consent surface (flagged in `03`).
- **Cache:** per-Gmail-id extraction cache persisted + pruned; populated only when `gemini_enabled` && live Gemini on.

| # | Call site | Input | Output | Fallback (no key/failure) |
|---|---|---|---|---|
| 1 | Email extraction | subject/from/date/body + timetable slots | exact assessment JSON | parser heuristics (`"next week (not this week)"` ⇒ sent+8d; slot-day snapping; default room/time) |
| 2 | Timetable extraction (vision) | base64 image/PDF | courses+slots+semester | **honest error** requiring manual entry (fallback demo-schedule generation deleted) |
| 3 | Study-plan rank | full assessments + schedule | readiness cards + day tasks | deterministic planner (`parser::build_study_tasks`, 14-day horizon, topics modulo distribution) |
| 4 | Practice quizzes | assessment context | 5 MCQs | deterministic generator — **contains hardcoded demo question banks for MATH 101/DATA 201/CS 101** |
| 5 | Teams source discovery | raw Teams context | courses/slots/assessments/semester (strict no-invent prompt) | heuristic courses-only |
| 6 | (Gmail candidate gating) | `use_live_gemini && gemini_enabled` → analyze ≤60d-old candidates 3-at-a-time | cached JSON | heuristic parse |

## 7. Platform shells

### 7.1 Desktop (Windows/macOS): tao + wry, hand-rolled
- Window 1420×880 (min 960×620), icon embedded, custom UA (`Chrome/131`), WebView2 data pinned to LOCALAPPDATA, new-window requests → system browser, close ⇒ `std::process::exit(0)`.
- Server on a dedicated std::thread + its own tokio runtime; port/session returned via mpsc; headless mode `--headless`/`--server` prints tokened URL.
- Linux/Android-ish mode: `open::that(tokened URL)` and keep serving.
- Windows singleton mutex `QuizRadarAppMutex` (Inno coordination); `winresource` icon; panic hook → `panic.log`.

### 7.2 Android: Capacitor 6 + custom Java
- Manifest permissions: INTERNET, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE. `usesCleartextTraffic=true`, deep link scheme `com.quizradar.app`, ACTION_SEND share ingest, widget receiver, **`OAuthSigninService` special-use foreground service** keeping the loopback OAuth server alive while Chrome steals focus.
- `MainActivity`: binds `LocalOAuthServer` (:3000), injects bridge key into WebView, share ingest (`__quizradarHandleShared`), widget snapshot bridge (`__quizradarWidgetSnapshot`, 60 s throttle) → `QuizRadarWidgetProvider` RemoteViews update.
- Capacitor plugins: App, Browser, Haptics, LocalNotifications, Preferences, StatusBar (all official, none custom).
- **Assets are committed**: `android/app/src/main/assets/public/` is a `cap sync` copy of `static/` (verified byte-identical at audit time; CI re-checks only `app.js` + `sw.js`).

### 7.3 PWA
- `sw.js` precaches 14 local assets + `skipWaiting/clients.claim`; `/api|/auth` network-first with 503 JSON; cross-origin cache-first. Offline-safe because every asset is local (fonts/lucide vendored).

## 8. Build & release pipeline (as-is)

| Platform | Tooling | Output | Problems highlighted in `03` |
|---|---|---|---|
| Windows | `scripts/build-release.ps1` → cargo, stage dist, **SHA256SUMS**, Inno (`ISCC.exe` lookup) | Setup EXE + Portable ZIP | version default stale `3.3.0`; no signing |
| macOS | `scripts/package-dmg.sh` (sips/iconutil/hdiutil) | unsigned .app + DMG | notarization absent |
| Linux | `scripts/package-deb.sh` + inline workflow tarball | .deb + tar.gz | FHS launcher symlinks XDG data |
| Android | CI `assembleDebug` | **debug-signed APK** | no keystore, no release build type built |
| CI | `.github/workflows/release.yml` tag-triggered, 4 jobs + publish | GH Release w/ hardcoded marketing body | version resolution duplicated 4×; no PR CI |
| Icons | `scripts/build_android_assets.py` (Pillow + headless Edge, hardcoded path) | mipmaps/splash | manual, Windows-only, machine-specific |
| Version | — | `4.3.0` | hand-edited in ≥8 places (Cargo.toml, package.json, gradle `430/4.3.0`, app.js, index.html, sw.js cache, README, 4× in release.yml) + stale defaults in build scripts |
| Sync | `npx cap sync android` manual; committed assets | — | drift possible beyond the 2 files CI compares |

## 9. What's surprisingly good (preserve in v5)

- **Atomic tmp+rename persistence discipline** for every important JSON.
- **Honesty doctrine** in the newer code paths: "no data configured" errors instead of fabrications; tests enforcing "no fabricated assessments" in Teams/moodle/classroom.
- **Real OAuth** works end-to-end on desktop (loopback + external browser + state single-use) and mobile (native bridge keeps refresh tokens out of the WebView).
- **Drive AppData → Calendar fallback chain** with refuse-to-truncate guard; loopback-only PIN management; Drive allow-list + MITM tests in updater.
- **Per-sync in-flight guards** preventing overlapping pipelines.
- **Secret redaction** for remote-config responses (`redact_secrets_for_remote`, tested).
- **UX honesty artifacts:** inference notes, scramble-safe demo mode skips, "On-Device Engine" truthfulness labels.
