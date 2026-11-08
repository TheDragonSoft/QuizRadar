# AGENTS.md — QuizRadar v5 Multi-Agent Engineering Protocol

_QuizRadar v5 is shipped and actively developed by multiple concurrent AI agents (Antigravity, Claude Code, Codex, Cursor, Jules/Bolt/Palette, GitHub Copilot) across isolated git branches and worktrees. Product specs and architecture live in `docs/rebuild/`; live operational status lives in `docs/STATUS.md`; historical v4 reference lives only under git tag **`v4-final`**._

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

1. **Run `pnpm agent:preflight`** + read `docs/STATUS.md` — live SemVer, active peer worktrees, file-collision warnings, pending `changes/*.md` handoffs, and required gates.
2. `docs/rebuild/01-product-spec.md` — **the acceptance spec**: every feature, all screens/modals (§4–§5), domain glossary (§3), design language (§6), feature parity checklist (§8).
3. `docs/rebuild/04-rebuild-architecture.md` — locked architecture (§0), repo layout (§4), banned v4 features (§5).
4. `docs/rebuild/02-current-architecture.md` + `docs/rebuild/03-issues-and-pain-points.md` + `docs/rebuild/05-ai-features-plan.md` — schemas, v4 anti-checklist, and verbatim AI consent/quota design.
5. `docs/TESTING-PLAYBOOK.md` + `docs/RELEASE-RUNBOOK.md` — 7-layer verification & release procedures.
6. **Historical references (only when needed):** `docs/archive/STATUS-v5.0-rebuild.md` (Phases 01–20 & Rounds 1–15) and `git show v4-final:<path>`.

## 3. Golden rules (violations = failed review)

1. **Honesty doctrine:** never fabricate data, stats, rooms, instructors, countdowns or success messages. An empty scan says "0 found, these sources ran", a failed check fails loudly, an estimate is labeled with its inference note. Missing room → render "—", never a default room string.
2. **No secrets, ever:** no OAuth client_secret anywhere (PKCE only), keys/tokens never enter the repo, binaries, logs, error strings or the web bundle. AI keys via `x-goog-api-key` header only. Secrets live in OS keyring (desktop) / EncryptedSharedPreferences (Android) / memory (PWA).
   - **Maintainer override (2026-10-28):** the Google OAuth client of project `gmail-summary-511914` is a *Web application* client, and Google refuses a secretless token exchange for it (`invalid_request: client_secret is missing`, verified against `oauth2.googleapis.com/token`). The maintainer therefore asked for that client id **and its secret** to be hardcoded — so the desktop shell ships both (`apps/desktop/src-tauri/src/state.rs`: `DEFAULT_GOOGLE_CLIENT_ID` / `DEFAULT_GOOGLE_CLIENT_SECRET`). Scope of that exception: the **desktop shell only**, used for the Google token exchange and refresh grant; it never enters `core/` (so never the WASM/PWA bundle), the SQLite DB, the UI, the logs or an error string, and the authorize URL stays secret-free (guarded by a unit test). Runtime overrides (OS keyring `google_client_secret`, `QUIZRADAR_GOOGLE_CLIENT_SECRET`) win. **Do not revert this as a "spec violation"** — and do not extend it to the web bundle, the core crate or the Android app. **Amendment (2026-11-05):** the maintainer replaced that registration with an *Installed*-type client of the same project (`341760934836-60toi8rjgkid0gmc69tmt598teghbgv4.apps.googleusercontent.com`, secret in `state.rs`) and asked for it to be baked into **both** desktop and Android. The desktop keeps the same id+secret rules as above; the Android app ships the client **id only** (its flow is a PKCE public client — no secret ever), a user-supplied id still wins (Settings → Sources), and the legacy placeholder ids remain refused.
3. **Core purity:** `core/` is pure Rust — no tao/wry/tauri/Android deps, UI-agnostic, no DOM/HTML. Every shell stays thin glue (≤ a few hundred LOC of its own logic).
4. **Nothing fabricated, nothing whimsical from v4:** do not port: demo course palettes/plans/practice banks, `Hall B-204`, "(via Home-Su25)", dev email-ID branches, `_KEYWORD` course forcing, `?demo=` hacks, the `teams_token`-to-Drive channel, the calendar-event sync fallback, `LocalOAuthServer.java`, the Axum HTTP server, `auto_sync_gcal: true` default. (Full delete list: `04` §5.)
5. **Single source of truth for versions (`tooling/version.json` + `changes/*.md`):** `tooling/generate-version.mjs` stamps all 5 sinks (`apps/web/package.json`, `tauri.conf.json`, `Cargo.toml`, `build.gradle.kts`, `version.ts`). Never hardcode version literals, and **never edit `tooling/version.json` on feature branches** — write a `changes/<slug>.md` fragment via `pnpm agent:note` so `.github/workflows/version-bump.yml` bumps SemVer conflict-free on merge to `main`.
6. **Conflict-free agent communication:** Never dump task logs into `docs/STATUS.md` (capped at ≤ 250 lines). Every non-trivial branch communicates its summary, verification commands, and follow-ups via `changes/<slug>.md`, archived automatically to `docs/worklog/YYYY-MM.md`.
7. **Tests & contract gates pass before merge:** `core` golden-fixture tests + shell unit tests + contract wire-map freshness + lint clean (rustfmt/clippy, eslint/prettier, ktlint). CI defines green.
8. **Data safety:** never commit user data — schedule JSONs, email caches, tokens, credentials, pems, `.env` (see `.gitignore`). Large generated files ship as CI artifacts, not as repo content.
9. **Scope discipline:** touch only files relevant to your task. Never modify `docs/rebuild/`, `prompts/`, sibling git worktrees, git history, or the `v4-final` tag. Never rewrite git history without an explicit maintainer instruction.
10. **Windows shell reality:** local commands often run in PowerShell 5.1 — avoid `&&` (run separate commands or `; if ($?) { }`), and prefer passing working directory arguments over `cd`.

## 4. Repo layout

```
core/                  # Pure Rust crate — THE app logic (one implementation)
  src/{types,parse,plan,cal,ai,store,auth,sources,ffi}/…
  bindings/{uniffi.toml, wasm/}
  tests/fixtures/      # golden emails/ICS/schedules + property suites
apps/
  desktop/             # Tauri 2 + src-tauri/ (consumes apps/web dist)
  web/                 # React 19 + Vite SPA → dist (desktop webview + PWA)
  mobile-android/      # Kotlin + Compose M3 + Glance (UniFFI bindings)
changes/               # Per-branch agent handoff & SemVer fragments (<slug>.md)
tooling/               # Preflight, agent-note, version-rollup, gates, hooks, build scripts
docs/                  # STATUS.md, RELEASE-RUNBOOK.md, TESTING-PLAYBOOK.md, worklog/, archive/, rebuild/
prompts/               # Historical v5.0 phase prompts (immutable)
```

## 5. Environment

- OS/Shell: Windows (PowerShell 5.1) locally; Ubuntu/macOS/Windows in GitHub Actions.
- Toolchain: Rust stable (`rustfmt`, `clippy`, `wasm32-unknown-unknown`), Node 20+, `pnpm` ≥ 9, Temurin JDK **21**, Android SDK 35 + NDK r27b.
- Canonical commands live in `docs/STATUS.md` §Canonical Verification Commands.

## 6. Multi-agent workflow & versioning protocol

1. **Session start (`pnpm agent:preflight`):**
   - Inspect your current branch, active sibling `git worktree` checkouts, `CONFLICT RADAR` file-overlap warnings, and pending `changes/*.md` notes left by other agents.
   - Never work directly on `main` or inside another agent's dirty worktree. Use an isolated branch (`feat/<slug>`, `fix/<slug>`, `refactor/<slug>`, `test/<slug>`, `docs/<slug>`, `chore/<slug>`).
2. **During implementation:**
   - Keep `core/` pure and shells thin.
   - If you edit `core/src/types.rs` or `core/src/ffi.rs`, immediately regenerate `node apps/web/src/contract/regenerate.mjs` and Android UniFFI bindings (`.\gradlew.bat uniffiGenerate`).
   - If blocked by missing credentials/hardware, commit only compiling code, record the exact blocker honestly in `changes/<slug>.md` under `### Handoff / Follow-ups`, and stop — never fake green gates.
3. **Before pushing / finishing (`pnpm agent:note`):**
   - Run every required gate listed by `pnpm agent:preflight`.
   - Record your handoff & SemVer impact in `changes/<slug>.md` (one file per branch, zero merge conflicts):
     ```powershell
     pnpm agent:note --bump <patch|minor|major|none> --surfaces <core,web,...> --agent <your-agent-name> --summary "<what shipped & why>" --verify "<exact commands run>" --handoff "<follow-ups or None>"
     ```
   - Commit using **Conventional Commits** (`feat(scope): ...`, `fix(scope): ...`, `perf(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `docs(scope): ...`, `chore(scope): ...`, `ci(scope): ...`). Local git hooks (`tooling/git-hooks/`) and CI (`tooling/agent-gate.mjs --ci`) enforce this automatically.
4. **How versions advance:**
   - Do **not** edit `tooling/version.json` or `CHANGELOG.md` on feature branches.
   - Merging to `main` triggers `.github/workflows/version-bump.yml`, which runs `node tooling/version-rollup.mjs --apply` to bump SemVer, stamp all 5 sinks + `Cargo.lock`, update `CHANGELOG.md`, archive `changes/*.md` into `docs/worklog/YYYY-MM.md`, and keep `changes/` clean.

## 7. Definition of Done (per task / PR)

- Behavior matches `docs/rebuild/01-product-spec.md` (including exact honesty/error copy in `apps/web/src/copy.ts`).
- Covered by automated unit/fixture/integration tests; all touched-surface lints, typechecks, and tests pass.
- Valid `changes/<slug>.md` handoff & version fragment committed (`pnpm agent:note --validate`).
- No new runtime dependencies without explicit justification in the fragment summary.
- Security & privacy checklist (§8) passes.

## 8. Security & privacy checklist (every PR)

- [ ] No client_secret / API key / token in code, configs, fixtures, logs, or error messages (sole scoped exception: `AGENTS.md` §3.2)
- [ ] Token storage path = keyring (desktop) / EncryptedSharedPreferences (Android) / memory (PWA)
- [ ] Every OAuth URL uses PKCE + random state (single-use, 15 min)
- [ ] Cloud payloads (Drive backup) contain data only — never tokens
- [ ] AI enable-flow includes the verbatim free-tier disclosure copy (`05` §5.1) and zero OAuth-bearer AI fallback
- [ ] All network calls `https://`; no logging of PII beyond the user's own device

## 9. Non-negotiable non-goals

No backend server/user accounts/telemetry/analytics/cloud relay, no shared-secret OAuth, no timeline fabrication, no keyword-renaming of user courses, no generic `.ics` writing into a user's calendar as storage.
