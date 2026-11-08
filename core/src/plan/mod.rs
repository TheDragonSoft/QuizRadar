//! Derivations and the deterministic planner (phase 03,
//! `prompts/p03-core-plan-derive.md`) — pure functions from stored inputs to
//! every UI payload, with no IO, AI or clock of its own:
//! - `dashboard.rs` — `DashboardSummary` (next-up, week window, KPIs,
//!   recommendation cards with `why_study_now` copy, topic-check items)
//! - `tasks.rs` — `StudyTasksPayload` (14-day deterministic roadmap +
//!   readiness cards; AI optimization is an optional layer on top and is
//!   always labeled, never silently replacing this plan)
//! - `conflicts.rs` — 48h exam-overload detection (same-day critical /
//!   adjacent-day warning) + `study-block-` mitigation
//! - `study_blocks.rs` — evening-first free 90-min candidate windows for
//!   auto study blocks (the caller persists them as `study-block-` events)
//!
//! # Reference-date injection & timezone honesty (`03` §C7)
//!
//! Nothing here reads a clock or an offset: every derivation takes "today"
//! "today" as an explicit `chrono::NaiveDate` argument and all interior
//! math runs in a single `NaiveDate`/`NaiveTime` domain. Wall-clock time
//! never crosses a timezone boundary inside the core. The conversion points
//! are platform-boundary-only, documented here once:
//!
//! - Desktop/Tauri shell: `Local::now().date_naive()` at poll time, passed
//!   into these calls; background-day rollover is therefore a new argument,
//!   not hidden state.
//! - Android shell: the Kotlin side passes `LocalDate.now()` (device local
//!   date) across UniFFI as `Y, M, D`.
//! - PWA/WASM shell: the JS adapter passes the browser's local
//!   `new Date()` date parts.
//!
//! Corollary: `days_until`, urgency and priority recomputed here are derived
//! *at render time* (day-rollover semantics — the desktop v4 behavior,
//! `recalculateAssessmentDeadlines`), so a scan made three days ago still
//! reports honest countdowns today without any persisted migration.

pub mod conflicts;
pub mod cushion;
pub mod dashboard;
pub mod gpa;
pub mod parity;
pub mod study;
pub mod study_blocks;
pub mod tasks;

#[cfg(test)]
pub(crate) mod fixtures;
