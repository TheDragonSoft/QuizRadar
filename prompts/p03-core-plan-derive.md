# Phase 03 — Core: plan/derive (dashboard, tasks, readiness, conflicts, study blocks)

> After phase 02. Pure derivation — no IO, no AI, fully testable.

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §3 (readiness/topic keys/conflict/study-block semantics) + §4.3–§4.4 (dashboard & tasks behavior); `docs/rebuild/02-current-architecture.md` §3 (DashboardSummary/StudyRecommendation/StudyTasksPayload shapes); `docs/rebuild/03-issues-and-pain-points.md` §A8 + §C6.

**Reference implementation:** `git show v4-final:src/parser.rs` (build_dashboard_summary §723–996, build_study_tasks §1230–1428, conflict logic), `git show v4-final:static/app.js` (`recomputeDashboard`, `recalculateAssessmentDeadlines`, day-rollover semantics — desktop wins where they disagree).

## Build

1. `core/src/plan/dashboard.rs` — `DashboardSummary` derivation: next-up, upcoming_this_week (0–7d window from a *passed-in* reference date — no wall-clock in core; crates call with `Local::now()`), all_upcoming, exam_type_counts, per-source counts, readiness % (completed topics ÷ total, both from data), recommendation cards with `why_study_now` (deterministic phrasing rules), topic-check items keyed `"{assessment_id}::{idx}"`.
2. `core/src/plan/tasks.rs` — deterministic `StudyTasksPayload`: 14-day horizon, ≤5 prep days, topic distribution `idx % (prep_days+1)`, hours clamp 0.5–2.5, day groups with honest labels (`ai_generated: false`); readiness cards per assessment.
3. `core/src/plan/conflicts.rs` — conflict detection (same-day < gap-threshold ⇒ critical; adjacent-day ⇒ warning; mitigated when a `study-block-*` custom event covers either) returning typed `ConflictAlert`s with computed message copy matching `01` §3 semantics (no invented instructor/room in copy).
4. `core/src/plan/study_blocks.rs` — `study_block_candidates(schedule, custom_events, day)`: evening-first 90-min windows within 08:00–21:30, excluding lecture slots + custom events; emits candidate blocks (caller persists).
5. **Timezone/date honesty rules** (from `03` §C7): all internal comparisons date/time-based in a single `chrono::Naive*` domain; the only local-tz conversions happen at the platform boundary (document the conversion points in module docs).
6. Unit tests: readiness math, urgency boundaries (2/5/14 days), conflict/mitigation logic, study-block non-interference with lectures, reference-date injection (no flaky time tests).

## Acceptance
- [ ] ≥16 unit tests green; dashboard derived ONLY from inputs (inject reference date; no `Utc::now` in core — grep-enforced)
- [ ] No fabricated stats (hours/streak/readiness defaults) — tested absence
- [ ] clippy/fmt clean
- [ ] STATUS updated, phase 03 ticked

## Commit
`phase(3): core plan/derive (dashboard, tasks, conflicts, study blocks)`
