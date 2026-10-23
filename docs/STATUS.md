# STATUS — QuizRadar v5 rebuild tracker

_Agents update this file after every phase. Prompts are defined in `prompts/README.md`._

## Phases

- [x] 01 scaffold-monorepo (`prompts/p01-scaffold-monorepo.md`) — shipped: Rust workspace (`core` + Tauri shell), pnpm root scripts, React 19/Vite/Tailwind 3 web skeleton, Android Compose skeleton, version generator + 5 stamped sinks, PR CI (3 jobs), lint/test gates everywhere green.
- [x] 02 core: types + email/ICS parsing + fixtures (`prompts/p02-core-types-parse.md`) — shipped: serde types (`core/src/types.rs` incl. `ScheduleData`/`Course`/`ScheduleSlot`/`CachedEmail`/`Assessment` with honest `None` semantics + v4-compatible serde adapters), announcement email parser (`core/src/parse/email.rs`, hand-written char scanners — no regex dependency in core), ICS parser (`core/src/parse/ics.rs`, Moodle + generic feeds with `IcsOrigin`, RFC 5545 unfolding/VALARM-skip/TEXT-unescape, UTC conversion through caller-provided `FixedOffset`), shared dedupe key (`core/src/parse/merge.rs`) and pure helpers (`core/src/parse/util.rs`: urgency/priority ladders, 12h formatting, semester inference). Golden fixtures: 11 email cases + 2 ICS files × 3 runs (`core/tests/fixtures/`, harnesses `email_fixtures.rs` + `ics_fixtures.rs` with ignored dumper). 55 lib unit tests + 9 fixture/smoke tests green; clippy/fmt clean.
- [ ] 03 core: plan/derive (dashboard, tasks, conflicts, study blocks)
- [ ] 04 core: store + migrations + v4 importer + Drive backup (data-only)
- [ ] 05 core: source fetchers (Gmail/Teams/Moodle/Classroom/feeds) + honest sync orchestrator
- [ ] 06 core: GCal push + ICS export + BYOK AI provider layer
- [ ] 07 desktop: Tauri 2 shell + full IPC surface + keyring + PKCE loopback + updater state
- [ ] 08 web: UI foundation (tokens, chrome, modal stack, state layer)
- [ ] 09 web: dashboard/tasks/calendar views + assessment detail
- [ ] 10 web: flows (onboarding, settings, AI, search, backup, updater, practice)
- [ ] 11 PWA: wasm core + adapters + service worker + help parity page
- [ ] 12 android: scaffold + UniFFI core bindings + Compose skeleton
- [ ] 13 android: Compose UI parity (views + detail/pomodoro/practice)
- [ ] 14 android: native edge (PKCE custom-scheme OAuth, Glance widget, share ingest, notifications)
- [ ] 15 release pipeline (signed tauri updater, release APK/AAB, PWA deploy, notes)
- [ ] 16 migration UX + docs honesty pass + v1.0 cut

## Feature-parity checklist status

_Track against `docs/rebuild/01-product-spec.md` §8. Tick items only with a CITATION to the §4/§5 item implemented + the commit hash._

- [x] Parse announcement emails → quizzes/exams/assignments with course matching (`01` §4.1 / `02` §3.2): `core/src/parse/email.rs` — placeholder commit this phase (`phase(2): core types + email/ics parsing with golden fixtures`).
- [x] Moodle/ICS calendar feed parsing with week/time inference (`01` §4.2 / `02` §3.2): `core/src/parse/ics.rs` (structural parse + course/slot matching + honesty notes; the *fetch* layer itself is phase 05).
- [x] No-fabrication honesty rules for parsed items (`01` §5 honesty): missing room/time renders "—", undated drafts stay dateless, wrong/missing course matching falls back course-less, notes always label estimates ("Estimated (local heuristic):…") — enforced through unit + fixture tests.
- [x] Dedupe/stable ids across sources (`02` §3.3/merge): `core/src/parse/merge.rs` normalized merge key + `moodle-`/`feed-`/uid-hash id scheme (cross-scan merge belongs to phase 03, which reuses the same key).

## Phase-02 divergence log (deliberate deviations from v4, per 03/01 §3)

- Urgency/priority ladders UNIFIED (`01` §3): ICS constant priority `85` and the divergent ICS urgency table are gone — everything runs through `parse/util.rs` (`urgency_for`, `compute_priority_score`), so ICS as_on_ref+1d quiz scores are computed, not fixed.
- No defaults on sparse ICS events: date-only DTSTART no longer invents `09:00`; missing DTEND no longer invents +90min / `10:30`; room only when a course slot actually carries one (v4's "E-Learning Lab / Online" default deleted); instructor/group never fabricated.
- `classify_ics_text` defaults to Online Quiz (v4 ICS ladder), while email-pipeline text classification defaults to Class Quiz after the explicit ladders (v4 email parity) — surfaced for review.
- Email link domain: v4 accepted only `e-learning.*` hosts; v5 accepts any `https://` link, preferring `/mod/quiz/` paths (host-lock dropped as host-specific).
- `"15 minutes"` warning fixed at digit boundary (v4's bare `"115 minutes"` false positive).
- MCQ warning reworded: `"+ Explain & Discuss"` fabrication dropped.
- Course-code months: v4 regex-accepted only full month names; v5 also accepts 3-letter abbreviations per the phase prompt's explicit-date ladder ("d Mon YYYY").
- Courseless quiz titles keep just `"Quiz N"` (v4's `"GENERAL"` fabrication deleted); ICS uid-less events get deterministic `fnv1a64` content-hash ids instead of v4's course-keyed id.
- Numeric garbage dates (e.g. month 13, `"118-…"` runs) yield `None` — the event/email is skipped or undated, never silently re-dated.
- Feed URL validation ported verbatim (https-only, token-in-URL honesty) from v4 `feeds.rs`.

## Compile-time TODO list (honest, no NotImplemented stubs)

- Phase 07 owns the full Tauri IPC surface (only `version()` implemented honestly in phase 01): `list_state`, `run_scan` (progress events, cancel), `push_gcal`, `extract_schedule`, `save_grade`, `toggle_topic`, `set_pin`, `check_update`, keyring token storage commands, onboarding complete/reset. Enumerated from `04-rebuild-architecture.md` §4.2; no fake `state() -> ()` stubs shipped.
- Single-instance plugin registered; window-focus handoff (re-focusing existing window on second launch) wired in phase 07 when the command surface exists.
- `tauri.conf.json` → `app.security.csp: null` for now; exact CSP locked in phase 07/08 once the dev-server/font/img sources are known.
- Updater plugin scaffolded with honest empty config (`endpoints: []`, `pubkey: ""`) — real release endpoint + signature key are generated in phase 15. Update pill UI stays unwired until then.
- `apps/web/src/generated/version.ts` provides `SW_CACHE_KEY_PREFIX`; the actual service worker (phase 11) consumes it. `__APP_VERSION__` is also defined in vite.config.ts as the compile-time define.

## Commands (append as established)

### Rust core (phase-02 established)

```powershell
cargo test -p quizradar-core                                    # 55 lib unit tests + email/ics fixtures + smoke
cargo test -p quizradar-core --test email_fixtures dump_email_outputs -- --ignored --nocapture
                                                                # ignored dumper: prints actual parse JSON per case
cargo clippy -p quizradar-core --all-targets -- -D warnings     # gate (denies panics/unwrap/expect outside test modules)
cargo fmt -p quizradar-core                                     # format
```

### Rust workspace (repo root)

```powershell
cargo fmt --all --check                                        # rustfmt gate
cargo clippy --workspace --all-targets -- -D warnings          # clippy gate (warnings = blockers)
cargo test --workspace                                         # unit + fixture tests (core has 4 smoke tests)
cargo check --workspace                                        # fast compile check
```

### Root pnpm culture (repo root, pnpm ≥ 12)

```powershell
pnpm install                     # workspace install (root + apps/*; esbuild build approved via allowBuilds)
pnpm lint                        # eslint flat config (root-only shared config)
pnpm typecheck                   # tsc per package (web: src + vite.config)
pnpm test                        # vitest run per package (web: 9 tests, jsdom)
pnpm format:check                # prettier gate (docs/ and prompts/ are unformatted by policy)
pnpm generate:version            # stamp all version sinks from tooling/version.json
pnpm generate:version:check      # CI check — exits 1 when any sink is stale
pnpm --filter "@quizradar/web" build   # vite production build → apps/web/dist (tauri frontendDist)
```

### Desktop (Tauri 2 shell)

```powershell
pnpm --dir apps/desktop dev      # cargo tauri dev (starts vite dev server + app window)
pnpm --dir apps/desktop build    # cargo tauri build (bundles installers)
cargo tauri build --debug --no-bundle   # fast debug exe: target\debug\quizradar-desktop.exe
```

`cargo-tauri` CLI: `cargo install tauri-cli --version ^2` (v2.12.4 currently installed locally).

### Android (JDK 21 Temurin required: `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` locally; `JAVA_HOME` must point at it)

```powershell
.\gradlew.bat assembleDebug testDebugUnitTest ktlintCheck   # from apps\mobile-android (CI runs assembleDebug only)
./gradlew assembleDebug                                     # linux/CI
```

- Toolchain: Gradle **8.11.1** wrapper (bootstrap jar downloaded from gradle/gradle v8.11.1), AGP **8.9.1**, Kotlin **2.1.0**, Compose BOM 2025.01.00, compileSdk 35, minSdk 26, ktlint plugin 12.1.2 (Compose naming via `.editorconfig` `ktlint_standard_function-naming = disabled`).
- **UniFFI generation (documented for phase 12)** — once core contains `#[derive(Object)]`-annotated items:
  `cargo install uniffi-cli` then, from `core/`, `cargo build` (cdylib) + `uniffi-bindgen generate --library <lib> --language kotlin --out-dir apps/mobile-android/app/src/main/java` (final wiring per `prompts/p12-android-scaffold.md`; binding stub lives at `app/src/main/java/com/quizradar/app/core/QuizRadarCore.kt`).
- Android SDK used locally: `C:\Users\ANXOMXR\AppData\Local\Android\Sdk` (`ANDROID_HOME` already set), cmdline-tools 19.0 installed fresh (previous local install was a broken extraction), license accepted, `platforms;android-35` installed during this phase.

### CI

`.github/workflows/ci.yml` — three PR jobs running the exact commands above: `rust` (fmt/clippy/test + version check), `web` (pnpm lint/typecheck/test + version check), `android` (temurin 21 + `./gradlew assembleDebug`). Replace/extend in phase 15.

## Dogfood notes

- Desktop debug exe (`target\debug\quizradar-desktop.exe`) launched headless-smoke: process stays alive >10s (window + WebView create, web dist loads), killed programmatically. Phase 07+ gets a real eyeball-verification note from the maintainer for `cargo tauri dev`.

## Blockers / open decisions

- ~~Android local build requires JDK 21 + Android SDK~~ — resolved during phase 01: Temurin JDK 21 installed via winget; platform 35 + working cmdline-tools installed into the local SDK. CI still uses ubuntu + temurin 21 (`ci.yml`).
- `pnpm core:watch` requires `cargo-watch` (not installed locally; optional dev nicety — plain `pnpm core:test` always works).
- `cargo tauri dev` opens a real window on this machine; the headless shell cannot visually confirm the placeholder rendering — the maintainer should run `pnpm --dir apps/desktop dev` once and confirm the shell (verified equivalent: built exe + dist smoke above).
