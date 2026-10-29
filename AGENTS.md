# AGENTS.md — QuizRadar v5 rebuild

_This repo is being rebuilt by AI agents. The entire v4 implementation was purged; it lives **only in git history** under tag **`v4-final`** and is the porting reference. The product spec, architecture, issue history and AI plan live in `docs/rebuild/`. Working sequence lives in `docs/STATUS.md`._

---

## 1. What you are building

**QuizRadar** — a local-first, zero-server dashboard for university students that resolves fuzzy announcements ("Class Quiz 1 next week, not this week") into exact calendar items by cross-referencing each announcement against the student's weekly timetable, then manages the resulting exam radar (dashboard, week calendar, study tasks, readiness, practice quizzes, grades, Google-Calendar push, notifications, Android widget).

**Locked stack (see `docs/rebuild/04-rebuild-architecture.md` §0 — this table wins over everything else):**

| Layer | Choice |
|---|---|
| Core logic | **One Rust crate `core/`** — parsers, planner, conflicts, study blocks, ICS, GCal, Drive backup, AI client, SQLite store. Implemented exactly once. |
| Desktop | **Tauri 2** shell (in-process IPC, signed updater, OS keyring) + **React 19 + Vite** UI |
| Mobile | **Android-only, forever: Kotlin + Jetpack Compose M3** (Glance widget, first-party notifications/share) bound to the core via **UniFFI** | 
| Web tier | PWA companion: same React UI + core compiled to **WASM**; browser fetch adapters in TS |
| Auth | **PKCE OAuth, zero client secrets.** Google + Microsoft. Desktop = loopback redirect, Android = custom scheme, PWA = GIS token client (1h, memory-only) |
| Sync | Per-device accounts (each device scans with its own tokens; tokens never leave the device or cross a network). Optional Drive-appdata **data-only** backup |
| AI | BYOK Google Gemini (header key `x-goog-api-key`), typed provider interface, quota tracker, honest deterministic fallbacks |
| Server | **None. Ever. No HTTP server, no relay, no LAN daemon** (maintainer decision) |

## 2. Read-first map (in order)

1. `docs/rebuild/00-READ-ME-FIRST.md` — TL;DR + 7 root causes why v4 died.
2. `docs/rebuild/01-product-spec.md` — **the acceptance spec**: every feature, all screens/modals (§4–§5), domain glossary (§3), design language (§6), feature parity checklist (§8).
3. `docs/rebuild/04-rebuild-architecture.md` — the architecture you must implement (§0 locked, §4 layout, §5 deleted features, §6 phases, §7 risks).
4. `docs/rebuild/02-current-architecture.md` — exact schemas/API semantics of v4 you are porting (data models §3, API route table §4, integrations §5, AI §6).
5. `docs/rebuild/03-issues-and-pain-points.md` + `docs/rebuild/reference-v4-audit.md` — every defect; do not port any item listed as ❌ open there.
6. `docs/rebuild/05-ai-features-plan.md` — AI feature/consent/quota design.
7. **v4 reference code:** `git show v4-final:<path>` (e.g. `v4-final:src/parser.rs`, `v4-final:static/app.js`, `v4-final:src/gemini.rs`, `v4-final:src/models.rs`, `v4-final:src/main.rs`). Use it when behavior details are ambiguous — but **port the honest parts of both the Rust backend AND the JS engine** and *merge* them; where they disagree, the Rust one wins except where `03` marks it wrong.
8. `prompts/README.md` — phase manifest.

## 3. Golden rules (violations = failed review)

1. **Honesty doctrine:** never fabricate data, stats, rooms, instructors, countdowns or success messages. An empty scan says "0 found, these sources ran", a failed check fails loudly, an estimate is labeled with its inference note. Missing room → render "—", never a default room string.
2. **No secrets, ever:** no OAuth client_secret anywhere (PKCE only), keys/tokens never enter the repo, binaries, logs, error strings or the web bundle. AI keys via `x-goog-api-key` header only. Secrets live in OS keyring (desktop) / EncryptedSharedPreferences (Android) / memory (PWA).
   - **Maintainer override (2026-10-28):** the Google OAuth client of project `gmail-summary-511914` is a *Web application* client, and Google refuses a secretless token exchange for it (`invalid_request: client_secret is missing`, verified against `oauth2.googleapis.com/token`). The maintainer therefore asked for that client id **and its secret** to be hardcoded — so the desktop shell ships both (`apps/desktop/src-tauri/src/state.rs`: `DEFAULT_GOOGLE_CLIENT_ID` / `DEFAULT_GOOGLE_CLIENT_SECRET`). Scope of that exception: the **desktop shell only**, used for the Google token exchange and refresh grant; it never enters `core/` (so never the WASM/PWA bundle), the SQLite DB, the UI, the logs or an error string, and the authorize URL stays secret-free (guarded by a unit test). Runtime overrides (OS keyring `google_client_secret`, `QUIZRADAR_GOOGLE_CLIENT_SECRET`) win. **Do not revert this as a "spec violation"** — and do not extend it to the web bundle, the core crate or the Android app.
3. **Core purity:** `core/` is pure Rust — no tao/wry/tauri/Android deps, UI-agnostic, no DOM/HTML. Every shell stays thin glue (≤ a few hundred LOC of its own logic).
4. **Nothing fabricated, nothing whimsical from v4:** do not port: demo course palettes/plans/practice banks, `Hall B-204`, "(via Home-Su25)", dev email-ID branches,_KEYWORD course forcing, `?demo=` hacks, the `teams_token`-to-Drive channel, the calendar-event sync fallback, `LocalOAuthServer.java`, the Axum HTTP server, `auto_sync_gcal: true` default. (Full delete list: `04` §5.)
5. **Single source of truth for versions:** `tooling/generate-version.*` writes it into package.json, tauri.conf, gradle, SW cache key. No file may hardcode a version literal.
6. **Acceptance = `01` §8 checklist.** Every feature PR ticks checklist items in `docs/STATUS.md` and cites the §4–§5 spec item it implements.
7. **Tests pass before merge:** `core` golden-fixture tests + shell unit tests + lint clean (rustfmt/clippy, eslint/prettier, ktlint). CI defines green.
8. **Data safety:** never commit user data — schedule JSONs, email caches, tokens, credentials, pems, `.env` (see `.gitignore`). Large generated files ship as CI artifacts, not as repo content.
9. **Scope discipline:** touch only the files your phase prompt names (plus the obvious minimum). Do not modify `docs/rebuild/`, `prompts/`, git history, or the `v4-final` tag. Never rewrite git history without an explicit maintainer instruction.
10. **Windows shell reality:** commands run in PowerShell 5.1 — no `&&`, use `; if ($?) { }`; prefer `workdir` over `cd`.

## 4. Repo layout (target)

```
core/                  # Rust crate — THE app logic (one implementation)
  src/{types,parse,plan,cal,ai,store,auth,sources}/…
  bindings/{uniffi.toml, wasm/}
  tests/fixtures/      # golden emails/ICS/schedules
apps/
  desktop/             # Tauri 2 + src-tauri/ + React app (consumes apps/web dist)
  web/                 # React 19 + Vite SPA → dist (desktop webview asset + PWA)
  mobile-android/      # Kotlin + Compose + Glance (UniFFI bindings)
tooling/               # version generator, icons, release tasks, CI helpers
docs/                  # rebuild dossier + STATUS.md
prompts/               # phase prompts (immutable)
```

## 5. Environment

- OS/Shell: Windows, PowerShell 5.1.
- Toolchain: Rust stable (rustfmt + clippy), Node 20+, pnpm ≥9, JDK **21** (Temurin), Android SDK (cmdline-tools, platform 34, build-tools 34), Gradle wrapper per Android app.
- Record the exact build/test/lint commands you establish into `docs/STATUS.md` §Commands so later agents don't rediscover them.
- If the local machine lacks the Android SDK/keystore, still deliver code + gradle wrapper; CI builds it (Phase 15 wire).

## 6. Agent workflow protocol

- Run **one prompt file per agent session**, in `prompts/README.md` order. Phases strictly depend on predecessors.
- At session start: read this file + relevant dossier sections + `docs/STATUS.md`.
- Work on the current main (or a `phase/N-*` branch if the harness supports it) and end the phase with:
  - all tests + lints green,
  - commit message `phase(N): <summary>` (conventional, concise),
  - `docs/STATUS.md` updated: what shipped, commands used, checklist items ✅, open blockers.
- If blocked (toolchain absent, API docs inaccessible), **commit the honest partial state** (things that compile + failing tests marked `#[ignore]`), write blockers into STATUS, and stop — do not fabricate "done".
- No placeholder code (`todo!()` in shipped paths), no stubs that return fake success. Stubs that return *honest* "not available on this platform" are allowed temporarily.

## 7. Definition of Done (per feature)

- Behavior matches `01` §4 item exactly (including its honesty/error copy).
- Checklist item ticked in STATUS; feature covered by at least one test (core fixture or shell unit test).
- Lint/typecheck/compile clean per §5 commands.
- No new dependencies without noting a rationale in STATUS (bundle-size and maintenance matter here).
- Secrets/data safety checklist §8 passes.

## 8. Security & privacy checklist (every phase)

- [ ] No client_secret / API key / token in code, configs, fixtures, logs, error messages
- [ ] Token storage path = keyring (desktop) / EncryptedSharedPreferences (Android) / memory (PWA)
- [ ] Every OAuth URL uses PKCE + random state (single-use, 15 min)
- [ ] Cloud payloads (Drive backup) contain data only — never tokens
- [ ] AI enable-flow includes the free-tier disclosure copy (`05` §5.1) and the OAuth-bearer AI fallback is ABSENT (or explicit-off toggle)
- [ ] All network calls https; no logging of PII beyond the user's own device

## 9. Non-negotiable non-goals

No backend server/user accounts/telemetry/analytics/cloud relay, no shared-secret OAuth, no timeline fabrication, no keyword-renaming of user courses, no generic .ics writing into a user's calendar as storage.
