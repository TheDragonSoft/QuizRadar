---
bump: patch
surfaces: [core, android, web]
agent: zcode
branch: feat/android-quality-overhaul
date: 2026-11-11
---

### Summary

Android quality overhaul: repaired event date_iso write contract, OAuth client resolution + token lifetime + persisted PKCE transactions, exposed canonical store ops (feeds, attendance, study sessions, quiz attempts, reset_all) through UniFFI, honest persisted Focus analytics and attendance, real reminder countdowns with stale-notification cleanup, weighted grade-target sharing the GPA weighting with parity tests, labeled practice-quiz provider fallback, native scan cancellation before the transactional reset, six-step onboarding with the verbatim AI free-tier disclosure and consent-before-import, manual assessment creation, Grade Center with honest unknowns, compact dashboard with persistent Settings entry and Grades destination, calendar pager affordance with re-anchoring and time/room on class blocks, and split theme_mode/preferred_dark_theme so AMOLED survives mode switches. All implementation by GLM 5.3 Flash subagents; parent performed independent review, fresh-install emulator acceptance and routed repairs.

Round 2 (design-system overhaul, "Quiet instrument"): new docs/ANDROID-DESIGN-SYSTEM.md; theme token layer (typography scale, radius slots, StatusColors with measured WCAG ratios) in ui/theme/QuizRadarTheme.kt plus reusable control styles in ui/theme/ComponentStyles.kt (filledPill/tonalPill/destructivePill, quietChipColors+ChipLeadingCheck, quietCard trio, quietTextFieldColors); calendar chrome rebuilt per researched calendar-UI patterns into one title row (tappable range -> M3 DatePickerDialog, Today pill, Day/3-Day/Week segments, week arrows) + a single day strip that IS the pager (M3 SingleChoiceSegmentedButton replaced by a hand-built selectable row because material3 1.3.1's SegmentedButton swallows synthetic taps in this app; labels content-sized so "3-Day" never ellipsizes); viewModel.today exposed from the injected clock so Today marks match the core; every remaining screen group (dashboard, tasks/focus, settings, onboarding, sheets, grades, app shell) swept onto one system - zero hardcoded fontSize literals left in polished files, one filled pill per flow, destructive pills only for destructive actions, tnum on all data, 8/12/16/24/32 spacing, 20dp screen padding; honest strings, test-pinned labels and the verbatim AI disclosure byte-preserved.

### Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace
- node apps/web/src/contract/regenerate.mjs --check
- node tooling/generate-version.mjs --check
- pnpm lint (0 errors, 6 pre-existing warnings)
- pnpm --dir apps/web typecheck
- pnpm --dir apps/web test
- gradlew uniffiGenerate ktlintCheck testDebugUnitTest lintDebug (188 tests, 0 failures)
- gradlew assembleDebug assembleStaging
- impeccable detector (detect --json) over apps/mobile-android .../ui: 0 findings
- fresh-install emulator acceptance on emulator-5554: onboarding, dashboard, calendar (light/dark-obsidian/amoled), settings; theme bug scenario re-verified from the DB (theme_mode=system + preferred_dark_theme=amoled + system night=yes renders pure-black AMOLED without touching the app, AMOLED chip stays selected)

### Handoff / Follow-ups

- pnpm format:check still fails on 31 pre-existing files at HEAD (none introduced here). Sibling branch chore/web-desktop-deslop also adds list_quiz_attempts to core/src/store with a different signature - reconcile on merge. Real OAuth sign-in, live Gemini and Drive flows remain unverified (no credentials authorized). TalkBack and large-font sweeps only spot-checked. The legacy single theme key migrates once (amoled -> dark + amoled). No commit made - left for maintainer review.
