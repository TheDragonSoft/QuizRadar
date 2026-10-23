//! Announcement → assessment parsing and timetable import:
//! `email.rs` (Gmail/Teams announcement pipeline), `ics.rs` (Moodle/feeds
//! calendars), `schedule.rs` (timetable slots, manual + AI extraction).
//!
//! Ported and merged from the v4 Rust parser (`v4-final:src/parser.rs`) and
//! the v4 JS engine in phase 02 (`prompts/p02-core-types-parse.md`); where the
//! two disagree the Rust one wins except where `docs/rebuild/03` marks it
//! broken. Golden fixtures live in `tests/fixtures/`.
