//! Calendar outputs (phase 06, `prompts/p06-core-cal-ai.md`):
//! - `gcal.rs` — Google Calendar push/update of upcoming assessments:
//!   idempotent via the caller-supplied `synced_gcal_map`, 404 ⇒ re-create,
//!   403/401 ⇒ honest `needs_scope` report (never marked synced); event
//!   bodies carry only the user's own data; the machine's UTC offset is
//!   caller-injected (`03` §C7 — the core owns no timezone)
//! - `ics.rs` — single/all `.ics` export (RFC 5545, floating local times,
//!   no IANA tz in the payload — mirrors v4's working behavior)

pub mod gcal;
pub mod ics;
