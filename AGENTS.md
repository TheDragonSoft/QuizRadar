# AGENTS.md — QuizRadar Engineering Protocol

_Single canonical rulebook for human contributors and AI agents. Product & system truth live in [`docs/`](./docs/README.md); architectural exceptions live in [`docs/adr/`](./docs/adr/README.md); historical pre-purge docs live under git tag `docs-pre-purge-2026-11` (and v4 under `v4-final`)._

---

## 1. What We Are Building

**QuizRadar** — a local-first, zero-server academic radar that resolves fuzzy announcements ("Class Quiz 1 next week") against a student's weekly timetable and manages exams, study tasks, readiness, grades, practice quizzes, Google Calendar push, notifications, and widgets.

| Layer | Locked Choice |
|---|---|
| Core logic | **One Rust crate (`core/`)** — parsers, planner, conflicts, study blocks, ICS, GCal, Drive backup, AI client, SQLite store. Implemented once. |
| Desktop | **Tauri 2** (in-process IPC, signed updater, OS keyring) + **React 19 + Vite** (`apps/web`) |
| Mobile | **Android-only (Kotlin + Jetpack Compose M3 + Glance)** bound to `core/` via **UniFFI** |
| Web tier | PWA companion: same `apps/web` React UI + `core/` compiled to **WASM**; browser fetch adapters in TS |
| Auth & Sync | **PKCE OAuth**, per-device tokens (tokens never leave the device). Optional Drive-appdata / QR / ephemeral LAN data-only sync. See [ADR-0001](./docs/adr/0001-desktop-oauth-secret.md) and [ADR-0002](./docs/adr/0002-ephemeral-lan-https-pairing.md). |
| AI | BYOK Gemini (`x-goog-api-key` header), quota tracker, labeled deterministic fallbacks, plus opt-in stateless Trial AI Relay ([ADR-0003](./docs/adr/0003-zero-key-trial-ai-relay.md)). |

## 2. Read-First Map

1. Run `pnpm agent:preflight` and read [`docs/STATUS.md`](./docs/STATUS.md) (live version, worktrees, verification commands).
2. Read [`docs/README.md`](./docs/README.md) for the doc system and find the exact evergreen doc for your task (`product-spec.md`, `architecture.md`, `android-design.md`, `testing.md`, `release.md`, `oauth.md`, `roadmap.md`).
3. Check [`docs/adr/`](./docs/adr/README.md) before questioning or reverting scoped architectural overrides.

## 3. Golden Rules (Violations = Failed Review)

1. **Honesty doctrine:** Never fabricate data, stats, rooms, instructors, countdowns, or success messages. Empty scans report `"0 found"` and which sources ran; missing rooms render `"—"`; estimates carry provenance notes.
2. **No secrets, ever:** No OAuth `client_secret`, API keys, or tokens in code, configs, fixtures, logs, error strings, or the web bundle (sole scoped desktop exception: [ADR-0001](./docs/adr/0001-desktop-oauth-secret.md)). AI keys use `x-goog-api-key` only. Secrets live in OS keyring (Desktop), EncryptedSharedPreferences (Android), or ephemeral memory (PWA).
3. **Core purity:** `core/` is pure Rust — no Tauri/wry/Android/DOM dependencies. Shells stay thin glue.
4. **No banned v4 patterns:** Never reintroduce demo palettes/banks, `Hall B-204`, `?demo=` hacks, `teams_token` cloud channels, calendar-event sync fallback, `LocalOAuthServer.java`, the persistent Axum HTTP server, or `auto_sync_gcal: true` default. (See [`docs/architecture.md`](./docs/architecture.md).)
5. **Single source of truth for versions (`tooling/version.json` + `changes/*.md`):** Never hardcode version literals or edit `tooling/version.json` / `CHANGELOG.md` on feature branches. Record work via `pnpm agent:note`; `.github/workflows/version-bump.yml` rolls up SemVer on merge to `main`.
6. **Documentation hygiene (enforced by `agent-gate.mjs`):** Never drop dated audits, demos, or essays into `docs/` or `docs/STATUS.md`. Keep evergreen docs under their line budgets, put architectural exceptions in `docs/adr/`, and put per-branch change records in `changes/<slug>.md`.
7. **Tests & contract gates pass before merge:** If `core/src/types.rs` or `core/src/ffi.rs` changes, immediately run `node apps/web/src/contract/regenerate.mjs` and `.\gradlew.bat uniffiGenerate`. Never fake green gates — record blockers honestly in `changes/<slug>.md`.
8. **Data safety & scope discipline:** Never commit user data (`.env`, tokens, schedules, DBs, `.pem`, `.keystore`). Touch only files relevant to your task; never rewrite git history or touch sibling worktrees.
9. **Shell reality:** Local dev runs on Linux (`devbox`, bash) or Windows (PowerShell 5.1 — avoid `&&` in PowerShell). Toolchain: Rust stable, Node **22+** (≥ 22.23.4), `pnpm` ≥ 9, Temurin JDK **21**, Android SDK 35 + NDK r27b.

## 4. Git Remotes, CI/CD & Multi-Agent Workflow

1. **Session start:** Run `pnpm agent:preflight`. Never commit directly to `main` or inside another agent's dirty worktree; use an isolated branch (`feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/`, `ci/`).
2. **Forgejo-first (`origin` = Forgejo, see [ADR-0004](./docs/adr/0004-forgejo-first-git-and-ci.md)):**
   - Always fetch, branch, push, and open PRs against **`origin`** (`git@forgejo:GordyTheKat/QuizRadar.git`, auto-mirrored to GitHub `TheDragonSoft/QuizRadar`). Never push directly to `github` unless explicitly asked.
   - **Forgejo Actions (`.forgejo/workflows/`):** Fast local Linux/Rust/Web/Android checks on `devbox-runner` (`devbox-host`). Keep Forgejo workflows here (Forgejo ignores `.github/workflows/` when `.forgejo/workflows/` exists).
   - **GitHub Actions (`.github/workflows/`):** Multi-OS releases (`release.yml`), GitHub Pages (`pages.yml`), SemVer rollups (`version-bump.yml`), and heavy/Android Emulator suites (`ci.yml`, `performance.yml`).
3. **Auto-finish (commit & push without waiting to be asked):** Once approved work is complete and all required verification gates pass, **automatically** record a handoff fragment, commit with Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, etc.), and push your branch (and any created tags) to **`origin` (Forgejo)** — never stop at an uncommitted working tree unless blocked by a failing gate or ambiguity:
   ```bash
   pnpm agent:note --bump <patch|minor|major|none> --surfaces <core,web,...> --agent <name> --summary "<what & why>" --verify "<commands run>" --handoff "<follow-ups or None>"
   ```

## 5. Security & Privacy Checklist (Every PR)

- [ ] Zero secrets/keys/tokens in code, fixtures, logs, or error messages (sole exception: [ADR-0001](./docs/adr/0001-desktop-oauth-secret.md))
- [ ] Token storage: OS keyring (Desktop) / EncryptedSharedPreferences (Android) / memory-only (PWA)
- [ ] OAuth uses PKCE + single-use random `state` (15 min); Drive/QR/LAN payloads are data-only
- [ ] AI enable flow keeps verbatim free-tier disclosure ([`docs/product-spec.md`](./docs/product-spec.md)) and zero OAuth-bearer AI fallback
- [ ] All network calls use `https://` (pinned TLS for ephemeral LAN sync); no telemetry, accounts, or analytics
