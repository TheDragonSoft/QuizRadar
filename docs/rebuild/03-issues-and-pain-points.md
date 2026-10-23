# 03 — Issues, Pain Points & Everything Hard to Fix (v4.3.0 audit)

_Compiled 2026-10-23. Extends the 2026-10-19 audit (`reference-v4-audit.md`, repo state v3.2.0) with the current v4.3.0 state. **Status column tells you what was already fixed** so you don't re-fix ghosts; "Difficulty" tells you why patching further on the current architecture is a bad deal._

Severity legend: **CRIT** user-facing breakage or trust/privacy damage · **HIGH** feature broken/fragile · **MED** friction, latent bugs · **LOW** hygiene.

---

## Part I — The seven root causes (why fixing anything is miserable)

These are the reasons the app is "very hard to fix both on mobile and desktop." Everything in Part II either flows from one of these or thrives because of them.

### RC1. The API contract is implemented three times (Rust + JS + Java) — the split brain
- The UI calls `/api/*`; which implementation answers depends on platform:
  - Desktop/PWA browser → **Axum** (`src/main.rs`).
  - Android → `window.fetch` intercepted **only on native** (`app.js:2258-2307`) → `QuizRadarAutonomousEngine.handleApi` — a 10,000-ft re-implementation of the desktop REST semantics in JS, including a parity port of the Rust email parser (`app.js:276-795`), Gmail queries, ICS parsing, grade partial-update semantics, dashboard derivation, ICS export builder.
  - Android OAuth → a **third HTTP server in Java** (`LocalOAuthServer.java`, 642 lines) with `/api/auth/prepare|refresh` on `127.0.0.1:3000`.
- **Consequence:** every semantic (dedupe keys, "explicit-null clears grade", error strings, `days_until` recompute rules) must be hand-mirrored in 3 languages. It already drifted repeatedly (dead `/api/status`, engine answering desktop-only endpoints with 501s, `/api/study/blocks/schedule` stub on mobile while real on desktop).
- **Difficulty:** a one-line parser fix is a three-place fix with three test suites that don't exist. This is the #1 reason the app "can't be fixed, only re-grown."

### RC2. Frontend monolith: one global-namespace SPA
- `app.js` = 10,474 lines / 453 KB, zero modules, ~300 global functions bound via inline `onclick="…"` in HTML strings; `index.html` = 2,759 lines with a 300-line inline `<style>` and 13 hardcoded modal skeletons. Template-heavy DOM is emitted as JS string literals, re-rendered wholesale, then Lucide icons re-scanned.
- No bundler, no TypeScript, no lint/typecheck hooks, no tests. Renaming a helper risks silent shadow collisions (a duplicate `openMobileSyncTab` bug already happened once).
- Escape-close stack (JS), Android back-button stack (JS + hardcoded 11-modals list), update-pill copy, and the ~30-id baggage applier `updateTopBarAndUser` are all maintained by hand.
- **Difficulty:** any UI fix = full-file surgery in 453 KB of strings; regression risk is high and uninstrumented (no PR CI).

### RC3. Backend monolith + coarse state
- `main.rs` = 3,118 lines: router, 30+ handlers, session middleware, **6 inline HTML string-template pages** (success/error/cancel cards, block page), FNV-1a ETag hand-rolled, percent-encoder module inline, pairing logic, updater glue, tests at bottom of file. `run_sync_pipeline` alone spans ~285 lines (main.rs:1462-1746).
- State = three global `Arc<RwLock<…>>`s; every mutation clones the whole `AppConfig`, writes it whole, and the sync pipeline later **hand-merges 12 hand-picked fields back** into live state to avoid clobbering (main.rs:1692-1714) — a lost-update generator that grows with every config field added.
- Token state double-books: `token.json` + mirror columns in AppConfig (email/name/picture), `microsoft_token.json` + `teams_token` mirror; two caches.
- **Difficulty:** "add a config field" touches: struct, Default, merge fn, 12-field merge list, redact list, frontend save handler (desktop + engine twin), onboarding payload, settings modal. Miss one = silent bugs.

### RC4. Platform logic duplication inside the frontend
- `IS_NATIVE` checks sprinkled through nearly every feature (auth, export, backup, notifications, feeds, practice, updater); `filterStateByEnabledSources` **destructively deletes** assessments client-side when a source is toggled off (desktop filters instead); same pairing/help flows re-implemented; course grids rendered near-identically in settings and onboarding.
- **Difficulty:** desktop bugs get fixed and re-broken on mobile (or vice versa) because the branches diverge invisibly.

### RC5. Honesty debt woven into hot code
The v3.x era shipped fabrications as fallbacks; v4.3.0 fixed several but the *pattern* of fallback-to-fiction still lives in hot paths (see B-section below: Moodle test success-theatre, deterministic practice banks for MATH 101/C S101/DATA 201, default color map keyed on those same courses, "(via Home-Su25)", BJT/MOSFET topic lists). Because there are no contract tests, new fallbacks sneak in during refactors.
- **Difficulty:** trust bugs recurred 3 times (v3 audit A-section). Each patch was whack-a-mole; a rebuild must structurally ban fallback-fiction (types where "unknown" is representable, no default rooms, no default palettes).

### RC6. Build, versioning, and artifacts are manual and multi-source-of-truth
- Version `4.3.0` in ≥8 hand-edited places (+stale `3.3.0`/`4.1.0` defaults in ps1/iss/sh). Android web assets are a **committed blob** that drifts (CI compares only app.js/sw.js). Icons require Python + Pillow + **headless Edge at a hardcoded Windows path**. Releases hand-rolled per platform: unsigned Windows EXE, unsigned/unnotarized DMG, **debug-signed APK only**, no keystore, no minify, updater couples to artifact filename substrings.
- **Difficulty:** every release is a checklist you cannot automate into safety with the current layout.

### RC7. Secrets and transport security are structural, not incidental
- Hardcoded OAuth **client secrets**: XOR-fallback in the Rust binary + plaintext constants in the APK (`LocalOAuthServer.java:30-32`, mirrored in `MainActivity.java`) — once shipped they're in public git history forever; the only real fix is PKCE (no secret) in v5.
- Plaintext secrets on disk (`token.json` w/ client_secret, `microsoft_token.json`, `gemini_api_key` in app_config.json) — no OS keyring.
- `microsoft/login/test` handler returns the **unredacted full config** to any LAN caller that knows the PIN (`main.rs:2502-2517`).
- Cloud Drive sync uploads the **MS Teams token** to Google Drive (`cloud_sync.rs`); calendar-event fallback writes app JSON into the user's primary calendar (8 KB cap, visible event).
- Android `cleartext:true` + `androidScheme:http` + `allowMixedContent` + `usesCleartextTraffic`.
- LAN PIN compare = plain string comparison, no rate limiting.
- **Difficulty:** pure patches can't remove the embedded secret (it's already public); only a protocol change (PKCE) + artifact rotation can.

---

## Part II — Concrete issues inventory (with live status)

> Status as of v4.3.0: ✅ fixed since the v3.2.0 audit · ⚠️ partial/improved · ❌ still open. File refs are current where known.

### A. Data honesty & fabrication (was reference-v4-audit.md section A)

| # | Issue | Status | Where/remnant | Notes for v5 |
|---|---|---|---|---|
| A1 | Demo timetable baked into binary & written to user disk on first run (once leaked dev's real schedule into a shipped exe) | ✅ | `data/schedule.template.json` now empty and shipped as template; build script copies it guarded (`onlyifdoesntexist`) | keep "ship empty" + add test that template ≠ personal data |
| A2 | Timetable upload fabricates a 5-course schedule w/o Gemini key ("On-Device Neural OCR Extractor") | ⚠️ | Desktop extract path now honest (requires key + manual-entry nudge, `gemini.rs:266-418`); mobile engine path now does a **real** Gemini call with honest errors + `local_note` fallbacks | never resurrect default schedules; keep explicit "needs a key" |
| A3 | Teams sync invents all six demo courses + quizzes; keyword renaming ("any math team"→MATH 101) | ✅ | heuristics now courses-only w/ noise filters, tests assert no fabricated assessments; but adoption rule `sched.courses = discovered` still overwrites schedule when empty or AI-found-semester | keep overwrite-guard; v5 should make "adopted sources" explicit |
| A4 | Moodle connect shows fabricated quizzes for unconfigured LMS + "Demo Moodle connection active!" toast + hardcoded `synced_count: 2` | ❌ | `/api/moodle/test` `main.rs:2166-2171` still returns fabricated success (count=2) when empty; `/api/moodle/sync` `:2200` hardcodes 2 | make both honest errors like the sync core did |
| A5 | Classroom fabricates coursework when unauthenticated; hardcoded 2026-10-30 fallback due date | ✅/❌ | fabrications removed; but the flow is still **broken-for-everyone by the missing `classroom.*` scope** | v5: request scope properly (see B5) |
| A6 | Email parser hardwired to dev's Gmail message IDs (instructors, dates, topics, warnings) | ✅/⚠️ | per-ID branches gone; demo remnants remain: "(via Home-Su25)" literal `parser.rs:323`, topics only know BJT/MOSFET `parser.rs:597-609`, demo course palettes/plans/hours `parser.rs:649-721, 1185-1218`, `main.rs:1847-1854` | delete the whole demo-universe in v5 |
| A7 | Keyword filters force courses (physics→PHYS 101), news letter noise becomes "Class Quiz"; unparseable date ⇒ TODAY | ⚠️ | candidate filtering improved + 60-day recency; general keyword-detector brittleness remains by design; date-fallback now heuristic+labeled | v5: make "unknown date ⇒ not radar" strict option |
| A8 | Fabricated engagement stats (streak=4, hours=12+…) and default room "Hall B-204" | ✅ | engine recompute honest now; default room generic; still: computed `recent_activity` is a mock string | fine |
| A9 | `?demo=` screenshot mode persisted mutations into user state | ⚠️ | demo now skips cache writes + in-memory only; demo branches still sprinkled through loadFullState; ghost id scrub lists (`cs101-a1…`, `st-1..4`) still run on every load | v5: demo mode as build-time storybook, not URL hack |

### B. Architecture & platform behavior (was section B + new findings from v4)

| # | Issue | Status | Evidence | v5 fix |
|---|---|---|---|---|
| B1 | Fetch interceptor installed unconditionally → desktop UI never talked to real backend (the defining v3 bug) | ✅ | now native-gated `app.js:2258-2307`; browser keeps real fetch | v5: delete the interceptor pattern entirely — one core, thin platform adapters |
| B2 | Real backend features unreachable + dangerous leftovers | ✅/⚠️ | OAuth/sync reachable on desktop now; orphan endpoints remain (`/api/status`, `/api/quizzes`, `/api/onboarding/reset` no caller; `data/quizzes.json` orphan file) | v5: route table as single source, generated client |
| B3 | Scan-progress overlay stages claim Gmail API connecting even when nothing connected; sync message says "Scanned Gmail, Moodle, Teams & Classroom" regardless | ⚠️ | overlay copy `beginScanProgress("Scanning Gmail / Teams / Classroom / Feeds…")`; backend counts honest but "omni" wording persists | v5: per-source progress fed by actual source run results |
| B4 | Onboarding manual email = "authenticated" theatre (fixed honestly on desktop+mobile w/ real OAuth; manual entry now labeled profile anchor) | ✅ | comment `app.js:2493+` | keep label |
| B5 | **Classroom scope never requested** — feature broken by design; UI apologizes with 403 copy | ❌ | `auth.rs:248-258` scope list; `classroom.rs:227-231` apology | v5: declarative per-source scope registry → one OAuth URL builder |
| B6 | Cloud sync (Drive) uploads `teams_token` to Drive; calendar fallback stores app payload in a visible calendar event (8 KB cap) | ❌ | `cloud_sync.rs:93-108` vs `:134-145` | v5: per-device accounts auth directly; cross-device sync = share *data* only; ban token sync; drop calendar fallback |
| B7 | Version identity drift (engine said "2.1.0-standalone" in v3) | ✅ | `APP_VERSION = "4.3.0"` everywhere-ish; but 8-place manual bump is the systemic issue | v5: generate |
| B8 | Mobile pairing flows: engine `/api/sync/pair/info` answered locally; desktop pairing endpoint + QR + PIN real now | ✅/⚠️ | `testDesktopPairing`/`importFromDesktop` real `:10331-10473`; QR deep-link real | keep; simplify with per-device accounts (see 04) |
| B9 | Three-way OAuth secret duplication (Rust XOR + APK constants + token.json secret storage) | ❌ | RC7 | v5: **PKCE everywhere, zero secrets** |
| B10 | Android OAuth needs a foreground service + custom HTTP server to survive Chrome | ✅ workaround → architecturally ❌ | FGS 12-min timeout `OAuthSigninService.java:27` | v5: custom-scheme deep-link OAuth (RFC 8252) removes server + FGS |

### C. Functional/pages-level bugs & gaps (smaller)

| # | Issue | Status | Ref |
|---|---|---|---|
| C1 | `auto_sync_gcal` defaults **true** before any scope exists | ❌ | `models.rs` Default |
| C2 | Updater repo 404 (public repo absent) + all download links dead in README/PWA URL | ❌ (external) | `updater.rs:35` |
| C3 | Gmail body truncated at 4,500 chars before AI/heuristics see it | ❌ | `gmail.rs:14-15` |
| C4 | Config-during-sync 12-field hand-merge list (lost-update shadowbox) | ❌ | `main.rs:1692-1714` |
| C5 | Startup parses only Gmail cache; Moodle/Teams/feeds appear only after first sync | ⚠️ | `main.rs:485-535` |
| C6 | `process::exit(0)` on close/update/second-instance — no graceful drain | ❌ | `main.rs:437`, `updater.rs:206-209` |
| C7 | Timezone seams: gcal push (local-offset), ICS export (floating), Moodle (UTC→local) can disagree | ❌ | `gcal.rs:35-42` |
| C8 | Stringly-typed scheduling: `HH:MM` str compare for clashes; day names re-parsed in gemini.rs; two color conventions (`#hex` vs `rgba()`) | ❌ | `main.rs:2728-2737`, `gemini.rs:237-264` |
| C9 | Grade editor: NaN/undefined paths, what-if assumes equal weight of remaining (honest but blunt) | ⚠️ | `renderGradeWhatIf` |
| C10 | Search re-renders the whole dashboard + 7×13 grid per keystroke (debounced 120 ms) — perf cliff on low-end phones | ❌ | `app.js:8472-8514` |
| C11 | `?preview=true` param still sent to updater (ignored server-side), legacy theatre | ⚠️ | `app.js:8747`, `main.rs:1957` |
| C12 | ICS `PRODID` says v2.0; `styles.css` handler returns empty 200 when missing; orphan `data/quizzes.json`; `.vercel` debris inside the APK asset tree | ❌ (hygiene) | various |
| C13 | Desktop app has no offline-install resilience story if WebView2 runtime missing (relies on user machine) | ⚠️ | |
| C14 | Practice-quiz deterministic fallback still contains hardcoded demo banks (MATH 101/DATA 201/CS 101) | ❌ | `gemini.rs:979-1158` |
| C15 | Notification scheduling cap 48, FNV-id hashing – fine, but no core-based re-derive on restore | ⚠️ | `scheduleStudyNotifications` |
| C16 | `?auth=success` history cleanup + anchor capture guard — brittle string contracts between modules | ⚠️ | `loadFullState`, `app.js:3209-3232` |

### D. Build / release / repo hygiene

| # | Issue | Status | Ref |
|---|---|---|---|
| D1 | Version in ≥8 hand-edited places + stale defaults (ps1 3.3.0, iss 4.1.0, sh 3.3.0) | ❌ | see 02 §8 |
| D2 | Committed Android asset blob; drift detectable for only 2 files | ❌ | `release.yml:152-162` |
| D3 | APK: debug-signed only, no keystore/AAB/minify; target SDK 34; no Play pipeline | ❌ | `release.yml:164-168` |
| D4 | No code signing anywhere (Windows SmartScreen friction by design, macOS Gatekeeper) | ❌ | |
| D5 | Icon pipeline Windows-only w/ hardcoded Edge path, manual | ❌ | `build_android_assets.py:11` |
| D6 | 4× duplicated version-detection steps + hardcoded marketing body in workflow | ❌ | `release.yml` |
| D7 | Updater asset matching couples to filenames (renaming breaks updates silently) | ⚠️ | `updater.rs:82-107` |
| D8 | No PR CI, no frontend tests, no lint/typecheck for JS, no rustfmt/clippy gate | ❌ | |
| D9 | Tailwind CSS checked in and hand-maintained; safelist hack for a missing class | ❌ | `tailwind.config.js:9-13` |
| D10 | Stray data files at repo root (emails cache, credentials.json pattern), `.vercel` inside assets | ❌ | |

### E. Privacy/dynamics trade-offs to surface in v5

| # | Topic | Note |
|---|---|---|
| E1 | Gemini free-tier data trade | Free tier sends content to Google "used to improve products" — the "100% local privacy" badge requires **explicit opt-in + disclosure copy** at AI enable time |
| E2 | Silent OAuth-bearer AI fallback | Today AI silently runs on the user's Google account when no key — must become an explicit toggle in v5 (`05`) |
| E3 | Email content scope | Gmail bodies go to AI; cache keeps 500 emails in plaintext JSON — v5: encrypt-at-rest (OS keystore-backed) + purge policy |

---

## Part III — Difficulty ranking: what is effectively unfixable without a rebuild

1. **RC1 (triple implementation)** — every further feature shifts cost ×3 and guarantees divergence. Unfixable incrementally: the abstraction boundary doesn't exist.
2. **RC2 (453 KB global-namespace JS)** — refactoring to modules would be a rewrite in place; no tests to catch the rewrite errors. Rebuild with tooling is cheaper.
3. **RC3 (coarse config merge)** — each new config field re-fights the 12-field merge; already lost-update-prone.
4. **RC6 (release engineering)** — cannot be retrofitted: signing, monorepo versioning, generated artifacts all assume a project layout that doesn't exist.
5. **RC7 (embedded OAuth secrets)** — public invariant; only a PKCE migration in a new artifact generation ends it.

Everything else (A4/C1–C16, D1–D10) is genuinely fixable in place — but every fix lands on the R1–R3 software, so it has to be re-tested on 3 platforms each time. **The economics say rebuild the core, port the goodwill (see §9 of doc 02), and steal the fixed features back one by one.**
