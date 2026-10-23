# STATUS — QuizRadar v5 rebuild tracker

_Agents update this file after every phase. Prompts are defined in `prompts/README.md`._

## Phases

- [ ] 01 scaffold-monorepo (`prompts/p01-scaffold-monorepo.md`)
- [ ] 02 core: types + email/ICS parsing + fixtures (`prompts/p02-core-types-parse.md`)
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

(competitive reproduction: leave empty until phases 02+ start producing features)

## Commands (append as established)

_(phases 01+ record exact build/test/lint commands here)_

## Dogfood notes

_(phase 10+ records manual-run findings)_

## Blockers / open decisions

- Android local build requires JDK 21 + Android SDK on this machine; if absent, phases 12–14 land code + gradle wrapper and rely on CI (per AGENTS §5).
