//! Derivations and the deterministic planner (phase 03,
//! `prompts/p03-core-plan-derive.md`):
//! - `tasks.rs` — "What Should I Study?" ordering + daily roadmap
//!   (deterministic default planner; AI optimization is an optional layer on
//!   top, never silently replacing it)
//! - `readiness.rs` — per-assessment/global % from `completed_topics`
//! - `conflicts.rs` — 48h clash detection (same-day critical / adjacent-day
//!   warning) + dismissible banner state
//! - `study_blocks.rs` — auto study blocks day-before-exam in free 90-min
//!   windows (evening-first, avoiding lectures + custom events)
