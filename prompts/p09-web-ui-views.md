# Phase 09 — Web UI views: Dashboard, Tasks, Calendar (full behavior)

> After phase 08. This is the dashboard-to-acceptance phase: implement `01` §4.3–§4.6 EXACTLY, driven by the phase-07 IPC.

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §4.3 (dashboard incl. conflict banner), §4.4 (tasks), §4.5 (calendar), §4.6 (assessment detail + grading + what-if); `docs/rebuild/02-current-architecture.md` §3 (derived shapes); `docs/rebuild/03-issues-and-pain-points.md` §C10 (perf lesson: no whole-grid rebuilds per keystroke).

**Reference implementation (visual semantics!):** `git show v4-final:static/index.html` (structure/classes of KPI cards, conflict banner, rec cards, timeline rows, readiness grid, roadmap, week grid, event-detail modal) and `git show v4-final:static/app.js` (renderers 5540–6610, grid lanes 6273–6602, grade what-if 6558–6602) — port the VISUAL RESULT, not the string-building approach.

## Build

1. **Dashboard** view: KPI row (7-day count + type pills, readiness, sync/accounts), source filter pills (gated per source enabled), type dropdown synced with pills, **conflict banner** (severity chips, smart-study-blocks action wired to core command, dismiss persistence), "What Should I Study?" numbered cards with optimistic topic toggles (checkbox strike + progress bar before IPC resolves; rollback on error + honest toast), timeline rows (source icon, conflict chip, score chip, TODAY/TOMORROW/N-days pill, ≤2 warnings). Mobile sub-tab bar (Overview/Assessments/Study) gated <1024px.
2. **Tasks** view: summary line (pending topics × grades × est hrs), course filter, readiness card grid (per-assessment %, color state, avg badge), Daily Study Roadmap day cards ("Today" ring/pulse) with per-task checkboxes tied to the same optimistic toggle path.
3. **Calendar** view: week grid 08:00–21:00 [7-day; clamp 3-day window <768px], lane-overlap algorithm (pure function, ported from v4 math but extracted and unit-tested with overlap cases), four block types (merged slot+exam with exam-glow, slot→popover, standalone assessment, custom event pink w/ inline edit/delete), mini-cal navigation + jump-to-today + jump-from-assessment. Rendering per-block with recompose (NO grid-wide re-render on minor changes — memoized per column).
4. **Event/assessment detail modal** (opens from timeline/calendar/search): header course-color bar, course/type/source badges ("Gmail Ingestion" default source display; room "—" when null), topics checkboxes, warnings list, study list, elearning URL link, actions: Add to Google Calendar (on push success show event id state; on `needs_scope` honest error + retry), Export .ics (single/all via core), **grade editor** (weight/score/max; per-field partial update; explicit-null clears a value; honest status pill; **what-if** projector showing remaining-weighted-average requirement with equal-weight honesty note — port the arithmetic, keep the honesty).
5. Optimistic state framework: shared `applyOptimistic(persisted updater, networked sender, rollback fn)` used everywhere (topic toggles, grade edits, dismiss conflicts) with per-action honest toasts.
6. Tests: derive-time interactions (toggle → readiness recompute), grade semantics tests (partial update + explicit null clear), lane algorithm, 3-day/7-day clamp logic, conflict banner dismiss persistence.

## Acceptance
- [ ] `01` §8 checklist items under "Dashboard / tasks / calendar" all ticked in STATUS with screenshots noted as `/dev` still captures (optional)
- [ ] Every string from `copy.ts`; no inline event attrs; lint/test green
- [ ] Perf guard: `renderDashboard` not re-triggered by unrelated keystrokes (unit-guarded via change-tracker)
- [ ] STATUS updated

## Commit
`phase(9): web dashboard/tasks/calendar views + assessment detail`
