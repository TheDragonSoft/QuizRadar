//! Announcement → assessment parsing and timetable/date resolution:
//! `email.rs` (Gmail/Teams/Outlook/Classroom announcement pipeline),
//! `ics.rs` (Moodle personal-calendar export and generic `.ics` feeds),
//! `merge.rs` (shared dedupe key), `util.rs` (pure helpers).
//!
//! Ported and merged from the v4 Rust parser (`v4-final:src/parser.rs`) and
//! the v4 JS engine parity port (`prompts/p02-core-types-parse.md`); where
//! the two disagree the Rust one wins except where `docs/rebuild/03` marks
//! it broken. Golden fixtures live in `tests/fixtures/`.

pub mod email;
pub mod ics;
pub mod merge;
pub mod util;
