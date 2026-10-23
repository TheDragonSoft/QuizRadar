# Prompts — QuizRadar v5 build order

_One prompt file = one AI-agent session (opencode/codex/jules/cursor, any). Run them strictly in order; each phase depends on its predecessors. Keep this folder immutable: fix phases by adding follow-up `pNN-fix*` prompts, never by editing history._

## How to run a prompt

1. Open a fresh agent session at the repo root (this directory).
2. Paste the full content of the phase file verbatim.
3. The agent reads `AGENTS.md` + `docs/STATUS.md` first, then works.
4. Phase ends with: tests+lint green, commit `phase(N): <summary>`, `docs/STATUS.md` updated.
5. If the agent is blocked, it commits honest partial state + blockers in STATUS and stops.

## Manifest

| # | File | Ship after | One-line goal |
|---|---|---|---|
| 01 | `p01-scaffold-monorepo.md` | — | Empty correct monorepo: core crate, Tauri shell, React web app, Android app skeleton, version tooling, STATUS tracker |
| 02 | `p02-core-types-parse.md` | 01 | `core/` types + email/ICS parsing with golden fixtures (the honest merger of v4 Rust + JS engine parsers) |
| 03 | `p03-core-plan-derive.md` | 02 | Dashboard/tasks/readiness/conflicts/study-blocks derivation + deterministic planner |
| 04 | `p04-core-store-backup.md` | 02 | rusqlite store, migrations, v4-backup importer, Drive-appdata data-only backup |
| 05 | `p05-core-sources-sync.md` | 04 | Source fetchers (Gmail/Teams/Moodle/ICS-feeds/Classroom) + sync orchestrator with honest progress |
| 06 | `p06-core-cal-ai.md` | 05 | GCal push + ICS export + AI provider layer (BYOK Gemini, quota, practice quizzes) |
| 07 | `p07-desktop-tauri.md` | 06 | Tauri 2 desktop shell: IPC commands over the core, keyring, PKCE loopback, signed updater |
| 08 | `p08-web-ui-foundation.md` | 07 | React design system + app chrome: tokens, theme, nav, modals framework, honest sync footer |
| 09 | `p09-web-ui-views.md` | 08 | Dashboard + Tasks + Calendar views (full `01` §4.3–§4.6 behavior) |
| 10 | `p10-web-ui-flows.md` | 09 | All remaining modals/flows: onboarding, settings, accounts/AI, search, backup/pairing, updater pill, practice, pomodoro |
| 11 | `p11-pwa.md` | 10 | WASM core bindings + service worker + manifest + truthful install/docs |
| 12 | `p12-android-scaffold.md` | 06 | Android gradle app + UniFFI Kotlin bindings of core + Compose skeleton + CI build |
| 13 | `p13-android-ui.md` | 12 | Compose M3: 3 main views + modals per `01` §5 mobile behavior |
| 14 | `p14-android-native.md` | 13 | Native edge: Glance widget, share-sheet ingest, notifications, PKCE custom-scheme OAuth, haptics/back-button |
| 15 | `p15-release-ci.md` | 11, 14 | GitHub Actions: PR CI + tag-release building all 4 artifacts, signing, updater notes |
| 16 | `p16-polish-migration.md` | 15 | Old-data import UX, docs honesty pass (README truth audit), dogfood checklist, v1.0 cut |

## Parallelization rules

- 02→05 may merge early if 07–09 need the store; but never start 12 before 04 is merged (needs store bindings).
- 07 must precede 08/09/10 (shell contract). 08 may start once 07's IPC surface is stubbed honest.
- If a phase revises the dossier sections, add a `pNN-fix` note pointing at the dossier amendment — never silently edit `docs/rebuild/` (scope rule: it is the immutable spec).
- Special: phases 02–06 should run with the maintainer available for semantic spot-checks of inferred behavior (exact copy strings, date anchoring, merge semantics) — ask, don't guess.

## Verification ritual (every phase)

1. `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test` (workspace) — for Rust phases.
2. `pnpm -r lint && pnpm -r typecheck` + `pnpm -w vitest run` — for web phases (as wired in phase 01).
3. `gradlew ktlint`/`lint` + unit tests — for phase 12–14.
4. Tick the `01` §8 checklist items completed (in `docs/STATUS.md`), commit.
