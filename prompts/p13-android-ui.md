# Phase 13 — Android UI: Compose views + modals (behavioral parity with web tier)

> After phase 12. Implement `01` §4.3–§4.6 **mobile behavior** in Compose M3. The mobile guideline list in `01` §4.8 explicitly applies.

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §4.3–§4.6 + mobile modifiers ([M] marks), §4.8 mobile system behaviors; `docs/rebuild/02-current-architecture.md` §1.2 mobile M3 bottom-nav/tablet behaviors; `docs/rebuild/reference-v4-audit.md` F (verified-good mobile behaviors: pull-to-refresh, haptics, theme, M3 nav).

## Build

1. **Dashboard** (Compose): sub-tab bar Overview/Assessments/Study; KPI row + type/source filter chips; conflict banner with schedule-blocks action button; "What Should I Study?" cards (Compose cards with color accent bar, urgency badge, optimistic topic toggles); timeline rows with source icon, conflict/score chips, urgency pill. Pull-to-refresh via `PullToRefreshBox` respecting opened sheets.
2. **Tasks** screen: readiness cards grid + Daily Roadmap day cards (Today ring) with checkboxes → same core toggle path.
3. **Calendar** screen: 3-day window <600dp, 7-day else; lane-overlap implemented as a pure function (port the algorithm from the web phase-09 implementation); slot/assessment/custom event block interactions (bottom sheet detail on tap).
4. **Detail bottom sheet**: same info architecture as web phase-09 event modal (badges, topics checkboxes, warnings, study list, honest room "—"), actions: calendar push (on Android: gcal: intent template or core push with browser-less token; per decision core push w/ custom-scheme OAuth — phase 14 wires), export .ics (FileShare), grade editor (per-field semantics, what-if text), edit/delete for custom events.
5. **Week/month selection**: mini-calendar composable with week navigation, jump-to-today; focus-mode screen: pomodoro (25/5/15) + practice quiz modal same semantics + scoring-state.
6. Adaptive: point any inconsistency between web and android against the `01` §8 checklist items — the checklist decides.
7. Tests: Compose UI tests for nav + optimistic toggle flow + grade sheet semantics; Robolectric where emulator-independent.

## Acceptance
- [ ] All `01` §5 modal-equivalents implemented as sheets/modals; mobile behaviors [M] from §8 ticked in STATUS (widget/share excluded — phase 14)
- [ ] Pull-to-refresh, haptics feedback, theme switch, M3 nav — live
- [ ] UI tests green; ktlint clean
- [ ] STATUS updated (dogfood notes)

## Commit
`phase(13): android compose UI parity (views + detail/pomodoro/practice)`
