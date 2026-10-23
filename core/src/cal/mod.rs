//! Calendar outputs (phase 06, `prompts/p06-core-cal-ai.md`):
//! - `ics_export.rs` — single/all `.ics` export (floating local times, no
//!   IANA tz in the attendee payload — mirrors v4's working behavior)
//! - `gcal.rs` — Google Calendar push via stored idempotent map (404 ⇒
//!   re-create; no auto-sync default — first-push consent gate lives here)
