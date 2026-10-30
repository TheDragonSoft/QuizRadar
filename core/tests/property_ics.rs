//! Property-based tests for the ICS parser (`core/src/parse/ics.rs`).
//!
//! `tests/ics_fixtures.rs` pins a handful of real calendar exports; the
//! properties here pin the *rules* those exports happen to satisfy: a
//! malformed calendar never panics and never yields an invented date, a
//! date-only and a timed `DTSTART` agree on the calendar date, timezone-free
//! ("floating") times are never silently shifted across midnight, folded
//! lines unfold into one value, RFC 5545 escapes survive a round trip, and a
//! `DURATION`-only event gets no invented end time. The ICS API is total —
//! it returns values, never `Result`s — so "never panics" is the whole of
//! its error contract; `proptest`'s `handle-panics` feature turns a parser
//! panic into a shrunk property failure instead of aborting the test binary.
//!
//! Configuration: every `proptest!` block carries its own inner
//! `#![proptest_config(ProptestConfig { cases: 64, .. })]` attribute — proptest
//! 1.12 only accepts that attribute *inside* a `proptest! { … }` block (there
//! is no crate-level `proptest_config` attribute macro in this version).

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout
)]

use chrono::{Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use proptest::prelude::*;
use quizradar_core::parse::ics::{
    parse_ical_datetime, parse_ics_assessments, parse_ics_events, IcsOrigin,
};
use quizradar_core::types::ScheduleData;

// ---------------------------------------------------------------------------
// Fixed inputs — the parser takes "today" and the local offset from its
// caller, so the tests never read a wall clock.
// ---------------------------------------------------------------------------

/// The reference date ("today") handed to the parser.
fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 17).expect("fixed reference date")
}

/// The deterministic local offset used by the assessment pipeline.
fn utc() -> FixedOffset {
    FixedOffset::east_opt(0).expect("UTC offset")
}

/// The Moodle origin used by every assessment-level property (no portal, so
/// no fallback link is fabricated).
fn origin() -> IcsOrigin {
    IcsOrigin::Moodle { portal_url: None }
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/// Arbitrary printable text. `proptest::string::string()` is not part of the
/// proptest 1.x API any more; `string_regex("\\PC*")` is the same default
/// strategy (`proptest::string::StringParam::default()`).
fn arb_text() -> impl Strategy<Value = String> {
    ::proptest::string::string_regex("\\PC*").expect("valid string regex")
}

/// One arbitrary content line of a calendar file — free text plus the
/// structural keywords the scanner reacts to.
fn arb_line() -> impl Strategy<Value = String> {
    prop_oneof![
        arb_text(),
        prop::sample::select(vec![
            "BEGIN:VCALENDAR",
            "END:VCALENDAR",
            "BEGIN:VEVENT",
            "END:VEVENT",
            "BEGIN:VALARM",
            "END:VALARM",
            "SUMMARY:CSE241 Quiz 1",
            "DTSTART:20260115T090000Z",
            "DTEND:20260115T103000Z",
            "UID:event-1",
        ])
        .prop_map(str::to_string),
    ]
}

/// An arbitrary calendar document: random lines, some of them written as
/// RFC 5545 continuation lines (a leading space or tab).
fn arb_ics_document() -> impl Strategy<Value = String> {
    prop::collection::vec((arb_line(), any::<bool>(), any::<bool>()), 0..12).prop_map(|parts| {
        let mut out = String::new();
        for (line, folded, tab) in parts {
            if !out.is_empty() {
                out.push_str("\r\n");
            }
            if folded {
                out.push(if tab { '\t' } else { ' ' });
            }
            out.push_str(&line);
        }
        out
    })
}

/// Characters that survive the ICS value pipeline untouched: no whitespace,
/// nothing that needs RFC 5545 escaping.
const FOLD_CHARS: &[char] = &['a', 'b', 'c', 'x', 'z', '0', '7', '-', '_', '.', ':', '!'];

/// A foldable summary: the parser trims the *raw* value, so the text must
/// not start or end with whitespace.
fn arb_foldable_text() -> impl Strategy<Value = String> {
    (
        prop::sample::select(FOLD_CHARS),
        prop::collection::vec(prop::sample::select(FOLD_CHARS), 0..16),
    )
        .prop_map(|(first, rest)| {
            let mut text = String::new();
            text.push(first);
            text.extend(rest);
            text
        })
}

/// Characters an escaped SUMMARY may carry. `,` `;` `\` and newline are the
/// RFC 5545 escapes; the rest pass through untouched.
const ESCAPE_CHARS: &[char] = &['a', 'b', 'x', 'z', '0', '7', ' ', ',', ';', '\\', '\n'];

/// Characters allowed at the edges of an escaped SUMMARY (no whitespace —
/// the raw value is trimmed before it is unescaped).
const ESCAPE_EDGE_CHARS: &[char] = &['a', 'b', 'x', 'z', '0', '7', ',', ';', '\\'];

/// An escaped SUMMARY body: non-whitespace at both ends, anything in between.
fn arb_escapable_text() -> impl Strategy<Value = String> {
    (
        prop::sample::select(ESCAPE_EDGE_CHARS),
        prop::collection::vec(prop::sample::select(ESCAPE_CHARS), 0..12),
        prop::sample::select(ESCAPE_EDGE_CHARS),
    )
        .prop_map(|(first, middle, last)| {
            let mut text = String::new();
            text.push(first);
            text.extend(middle);
            text.push(last);
            text
        })
}

/// Escapes a value the way RFC 5545 §3.3.11 requires.
fn encode_ics_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            ',' => out.push_str("\\,"),
            ';' => out.push_str("\\;"),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            other => out.push(other),
        }
    }
    out
}

/// Folds a summary into RFC 5545 continuation lines: the first chunk stays
/// on the property line, every following chunk goes on its own line behind
/// the fold marker (one leading space).
fn fold_summary(text: &str, chunk: usize) -> String {
    let chunk = chunk.max(1);
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::from("SUMMARY:");
    for (index, piece) in chars.chunks(chunk).enumerate() {
        if index > 0 {
            out.push('\n');
            out.push(' ');
        }
        out.extend(piece.iter());
    }
    out
}

// ---------------------------------------------------------------------------
// P1 — the parser never panics
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P1 — arbitrary text and arbitrary (structurally broken) calendar
    /// documents go through the scanner, the value parser and the whole
    /// assessment pipeline without a panic. With proptest's `handle-panics`
    /// feature a panic would be reported as a shrunk property failure
    /// instead of aborting the test binary.
    #[test]
    fn p1_parser_never_panics(document in prop_oneof![arb_text(), arb_ics_document()]) {
        let events = parse_ics_events(&document);
        let _ = parse_ical_datetime(&document);
        let (items, stats) = parse_ics_assessments(
            &document,
            &ScheduleData::default(),
            &origin(),
            ref_date(),
            utc(),
        );
        prop_assert_eq!(stats.scanned, events.len());
        prop_assert_eq!(stats.parsed, items.len());
        prop_assert!(stats.candidates >= stats.parsed);
    }
}

// ---------------------------------------------------------------------------
// P2 — event count and order
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P2 — a calendar with N well-formed VEVENT blocks yields exactly N
    /// parsed events, in document order (the i-th event carries the i-th
    /// UID), and the assessment pipeline scans exactly N of them. Nothing is
    /// merged away and nothing is invented.
    #[test]
    fn p2_event_count_matches_the_vevent_blocks(
        count in 1usize..=8,
        month in 1u32..=12,
        day in 1u32..=28,
    ) {
        let date = NaiveDate::from_ymd_opt(2026, month, day).expect("valid date");
        let stamp = date.format("%Y%m%d").to_string();
        let mut ics = String::from("BEGIN:VCALENDAR\r\n");
        for index in 0..count {
            ics.push_str(&format!(
                "BEGIN:VEVENT\r\nUID:uid-{index}\r\nSUMMARY:CSE241 Quiz {index}\r\nDTSTART:{stamp}T090000Z\r\nEND:VEVENT\r\n"
            ));
        }
        ics.push_str("END:VCALENDAR");

        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), count);
        for (index, event) in events.iter().enumerate() {
            prop_assert_eq!(&event.uid, &format!("uid-{index}"));
        }

        let (items, stats) = parse_ics_assessments(
            &ics,
            &ScheduleData::default(),
            &origin(),
            ref_date(),
            utc(),
        );
        prop_assert_eq!(stats.scanned, count);
        prop_assert_eq!(stats.parsed, count);
        prop_assert_eq!(items.len(), count);
    }
}

// ---------------------------------------------------------------------------
// P3 — date normalization
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P3 — a date-only DTSTART and a timed DTSTART on the same day agree on
    /// the calendar date. The date-only form carries no time at all (the v4
    /// "09:00" default is gone), the timed form keeps its clock and its UTC
    /// marker.
    #[test]
    fn p3_date_only_and_timed_forms_agree_on_the_calendar_date(
        year in 2020i32..=2030,
        month in 1u32..=12,
        day in 1u32..=31,
        hour in 0u32..=23,
        minute in 0u32..=59,
    ) {
        prop_assume!(NaiveDate::from_ymd_opt(year, month, day).is_some());
        let date = NaiveDate::from_ymd_opt(year, month, day).expect("valid date");
        let time = NaiveTime::from_hms_opt(hour, minute, 0).expect("valid time");
        let stamp = date.format("%Y%m%d").to_string();

        let date_only = parse_ical_datetime(&stamp).expect("a date-only value parses");
        prop_assert_eq!(date_only.date, date);
        prop_assert_eq!(date_only.time, None);

        let timed = parse_ical_datetime(&format!("{stamp}T{hour:02}{minute:02}00Z"))
            .expect("a timed value parses");
        prop_assert_eq!(timed.date, date);
        prop_assert_eq!(timed.time, Some(time));
        prop_assert!(timed.is_utc);

        let ics = format!(
            "BEGIN:VEVENT\r\nUID:allday\r\nSUMMARY:CSE241 All Day Quiz\r\nDTSTART;VALUE=DATE:{stamp}\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:timed\r\nSUMMARY:CSE241 Timed Quiz\r\nDTSTART:{stamp}T{hour:02}{minute:02}00Z\r\nEND:VEVENT"
        );
        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), 2);
        prop_assert_eq!(
            events[0].dtstart.as_ref().map(|dt| dt.date),
            Some(date),
            "the date-only event keeps the calendar date"
        );
        prop_assert_eq!(events[0].dtstart.as_ref().and_then(|dt| dt.time), None);
        prop_assert_eq!(
            events[1].dtstart.as_ref().map(|dt| dt.date),
            Some(date),
            "the timed event keeps the same calendar date"
        );
        prop_assert_eq!(events[1].dtstart.as_ref().and_then(|dt| dt.time), Some(time));
    }
}

// ---------------------------------------------------------------------------
// P4 — timezone-free times are never shifted
// ---------------------------------------------------------------------------

/// Local offsets (in minutes) the assessment pipeline may be called with.
const LOCAL_OFFSETS_MINUTES: &[i32] = &[120, 330, -420, 840];

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P4 — a timezone-free ("floating") DTSTART and a TZID DTSTART are wall
    /// clock values: they keep their date *and* their clock no matter which
    /// local offset the caller passes. Only a value that is explicitly
    /// marked `Z` is converted into the local offset. This is the guard
    /// against a class time silently jumping across midnight.
    #[test]
    fn p4_floating_times_are_never_shifted_by_the_local_offset(
        offset_minutes in prop::sample::select(LOCAL_OFFSETS_MINUTES),
        hour in 0u32..=23,
        minute in 0u32..=59,
        day in 1u32..=28,
    ) {
        let date = NaiveDate::from_ymd_opt(2026, 1, day).expect("valid date");
        let time = NaiveTime::from_hms_opt(hour, minute, 0).expect("valid time");
        let stamp = date.format("%Y%m%d").to_string();
        let clock = format!("{hour:02}{minute:02}00");
        let local = FixedOffset::east_opt(offset_minutes * 60).expect("valid offset");

        let ics = format!(
            "BEGIN:VEVENT\r\nUID:floating\r\nSUMMARY:CSE241 Floating Quiz\r\nDTSTART:{stamp}T{clock}\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:tzid\r\nSUMMARY:CSE241 TZID Quiz\r\nDTSTART;TZID=Asia/Cairo:{stamp}T{clock}\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:utc\r\nSUMMARY:CSE241 UTC Quiz\r\nDTSTART:{stamp}T{clock}Z\r\nEND:VEVENT"
        );
        let (items, stats) = parse_ics_assessments(
            &ics,
            &ScheduleData::default(),
            &origin(),
            ref_date(),
            local,
        );
        prop_assert_eq!(stats.parsed, 3);

        let floating = items
            .iter()
            .find(|item| item.id == "moodle-floating")
            .expect("the floating event is parsed");
        prop_assert_eq!(floating.date, Some(date));
        prop_assert_eq!(
            floating.start_time,
            Some(time),
            "a floating time must not be shifted by the local offset"
        );

        let tzid = items
            .iter()
            .find(|item| item.id == "moodle-tzid")
            .expect("the TZID event is parsed");
        prop_assert_eq!(tzid.date, Some(date));
        prop_assert_eq!(
            tzid.start_time,
            Some(time),
            "a TZID value is a wall clock, not a UTC instant"
        );

        let utc_item = items
            .iter()
            .find(|item| item.id == "moodle-utc")
            .expect("the UTC event is parsed");
        let shifted =
            NaiveDateTime::new(date, time) + Duration::minutes(i64::from(offset_minutes));
        prop_assert_eq!(utc_item.date, Some(shifted.date()));
        prop_assert_eq!(utc_item.start_time, Some(shifted.time()));
    }
}

// ---------------------------------------------------------------------------
// P5 — line folding
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P5 — a SUMMARY folded across many continuation lines is one value:
    /// the unfolded concatenation of the chunks, in one event. v4's regex
    /// silently dropped folded properties — this keeps that bug dead.
    #[test]
    fn p5_folded_summary_is_unfolded_into_one_value(
        text in arb_foldable_text(),
        chunk in 1usize..=5,
    ) {
        prop_assume!(text.chars().count() > chunk, "the summary must really be folded");
        let folded = fold_summary(&text, chunk);
        let ics = format!("BEGIN:VEVENT\r\nUID:folded\r\n{folded}\r\nEND:VEVENT");

        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), 1);
        prop_assert_eq!(
            &events[0].summary,
            &text,
            "the folded summary must unfold to the original text"
        );
    }
}

// ---------------------------------------------------------------------------
// P6 — escaping
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P6 — `\,` `\;` `\n` `\\` round-trip to the characters they stand for:
    /// the parser unescapes exactly once and invents nothing.
    #[test]
    fn p6_escaped_text_round_trips_to_the_original_characters(
        text in arb_escapable_text(),
    ) {
        let encoded = encode_ics_text(&text);
        let ics = format!(
            "BEGIN:VEVENT\r\nUID:escaped\r\nSUMMARY:{encoded}\r\nEND:VEVENT"
        );

        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), 1);
        prop_assert_eq!(
            &events[0].summary,
            &text,
            "escaped summary {:?} must decode back to {:?}",
            encoded,
            text
        );
    }
}

// ---------------------------------------------------------------------------
// P7 — duration
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P7 — a DTSTART/DTEND pair carries exactly the stated duration, and a
    /// DURATION-only event gets no end time at all: the parser has no
    /// DURATION vocabulary and never invents an end (v4's "+90 minutes").
    #[test]
    fn p7_duration_comes_from_dtend_and_is_never_invented(
        start_minutes in 0u32..=1319,
        duration_minutes in 1u32..=120,
        day in 1u32..=28,
    ) {
        let date = NaiveDate::from_ymd_opt(2026, 3, day).expect("valid date");
        let end_minutes = start_minutes + duration_minutes;
        prop_assume!(end_minutes < 24 * 60, "the end must stay inside the day");
        let start = NaiveTime::from_hms_opt(start_minutes / 60, start_minutes % 60, 0)
            .expect("valid time");
        let end = NaiveTime::from_hms_opt(end_minutes / 60, end_minutes % 60, 0)
            .expect("valid time");
        let stamp = date.format("%Y%m%d").to_string();
        let start_text = format!("{:02}{:02}00", start_minutes / 60, start_minutes % 60);
        let end_text = format!("{:02}{:02}00", end_minutes / 60, end_minutes % 60);

        let ics = format!(
            "BEGIN:VEVENT\r\nUID:timed\r\nSUMMARY:CSE241 Timed Quiz\r\nDTSTART:{stamp}T{start_text}Z\r\nDTEND:{stamp}T{end_text}Z\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:duration\r\nSUMMARY:CSE241 Duration Quiz\r\nDTSTART:{stamp}T{start_text}Z\r\nDURATION:PT{duration_minutes}M\r\nEND:VEVENT"
        );
        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), 2);

        let timed = &events[0];
        prop_assert_eq!(timed.dtstart.as_ref().and_then(|dt| dt.time), Some(start));
        prop_assert_eq!(timed.dtend.as_ref().and_then(|dt| dt.time), Some(end));
        let actual = timed
            .dtend
            .as_ref()
            .and_then(|dt| dt.time)
            .expect("the timed event has an end time")
            - timed
                .dtstart
                .as_ref()
                .and_then(|dt| dt.time)
                .expect("the timed event has a start time");
        prop_assert_eq!(actual, Duration::minutes(i64::from(duration_minutes)));

        prop_assert!(
            events[1].dtend.is_none(),
            "a DURATION-only event must not gain an invented end time"
        );
    }
}

// ---------------------------------------------------------------------------
// P8 — all-day vs timed
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P8 — a `VALUE=DATE` event carries no time of day at all (not even a
    /// made-up 09:00), while a timed event carries its clock into the
    /// assessment.
    #[test]
    fn p8_all_day_events_carry_no_time_of_day(
        month in 1u32..=12,
        day in 1u32..=28,
        hour in 0u32..=23,
        minute in 0u32..=59,
    ) {
        let date = NaiveDate::from_ymd_opt(2026, month, day).expect("valid date");
        let time = NaiveTime::from_hms_opt(hour, minute, 0).expect("valid time");
        let stamp = date.format("%Y%m%d").to_string();
        let clock = format!("{hour:02}{minute:02}00");

        let ics = format!(
            "BEGIN:VEVENT\r\nUID:allday\r\nSUMMARY:CSE241 All Day Quiz\r\nDTSTART;VALUE=DATE:{stamp}\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:timed\r\nSUMMARY:CSE241 Timed Quiz\r\nDTSTART:{stamp}T{clock}Z\r\nEND:VEVENT"
        );
        let (items, stats) = parse_ics_assessments(
            &ics,
            &ScheduleData::default(),
            &origin(),
            ref_date(),
            utc(),
        );
        prop_assert_eq!(stats.parsed, 2);

        let all_day = items
            .iter()
            .find(|item| item.id == "moodle-allday")
            .expect("the all-day event is parsed");
        prop_assert_eq!(all_day.date, Some(date));
        prop_assert_eq!(all_day.start_time, None, "an all-day event has no start time");
        prop_assert_eq!(all_day.end_time, None, "an all-day event has no end time");

        let timed = items
            .iter()
            .find(|item| item.id == "moodle-timed")
            .expect("the timed event is parsed");
        prop_assert_eq!(timed.date, Some(date));
        prop_assert_eq!(timed.start_time, Some(time));
    }
}

// ---------------------------------------------------------------------------
// P9 — malformed input is honest
// ---------------------------------------------------------------------------

/// DTSTART values that cannot be a calendar date at all.
const MALFORMED_DTSTART: &[&str] = &[
    "",
    "garbage",
    "not-a-date",
    "2026",
    "T",
    "20261301",
    "20260230",
    "20260431",
    "20261131",
    "2026-13-01",
    "00000000",
    "99999999",
];

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P9 — a broken DTSTART is dropped, never silently defaulted to the
    /// epoch: the event carries no date at all and the assessment pipeline
    /// skips it instead of inventing one.
    #[test]
    fn p9_malformed_dtstart_is_dropped_not_defaulted(
        malformed in prop::sample::select(MALFORMED_DTSTART),
    ) {
        prop_assert!(
            parse_ical_datetime(malformed).is_none(),
            "{malformed:?} is not a calendar date and must not parse"
        );

        let ics = format!(
            "BEGIN:VEVENT\r\nUID:broken\r\nSUMMARY:CSE241 Broken Quiz\r\nDTSTART:{malformed}\r\nEND:VEVENT"
        );
        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), 1);
        prop_assert!(
            events[0].dtstart.is_none(),
            "a broken DTSTART must not become a date"
        );

        let (items, stats) = parse_ics_assessments(
            &ics,
            &ScheduleData::default(),
            &origin(),
            ref_date(),
            utc(),
        );
        prop_assert_eq!(stats.scanned, 1);
        prop_assert_eq!(stats.candidates, 1);
        prop_assert_eq!(stats.parsed, 0, "an event without a date is skipped");
        prop_assert!(items.is_empty());
    }
}

/// DTSTART values whose calendar date is fine but whose clock is impossible.
const IMPOSSIBLE_CLOCKS: &[&str] = &["T240000", "T250000", "T236000", "T126000"];

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P10 — an impossible clock (hour > 23 or minute > 59) never turns
    /// into a time of day: the event either keeps the calendar date it
    /// really read with an empty clock, or it is dropped entirely. What it
    /// must never do is invent a plausible-looking time.
    #[test]
    fn p10_impossible_clock_never_becomes_a_fabricated_time(
        clock in prop::sample::select(IMPOSSIBLE_CLOCKS),
        day in 1u32..=28,
    ) {
        let date = NaiveDate::from_ymd_opt(2026, 5, day).expect("valid date");
        let stamp = date.format("%Y%m%d").to_string();
        let ics = format!(
            "BEGIN:VEVENT\r\nUID:clock\r\nSUMMARY:CSE241 Clock Quiz\r\nDTSTART:{stamp}{clock}\r\nEND:VEVENT"
        );

        let events = parse_ics_events(&ics);
        prop_assert_eq!(events.len(), 1);
        match &events[0].dtstart {
            None => {}
            Some(dtstart) => {
                prop_assert_eq!(dtstart.date, date, "the calendar date is still readable");
                prop_assert_eq!(
                    dtstart.time,
                    None,
                    "an impossible clock must not become a time of day"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Controls — the properties above must not pass vacuously.
// ---------------------------------------------------------------------------

/// Control for P2/P3: an ordinary event really is parsed into the values
/// its lines state.
#[test]
fn control_well_formed_event_is_read_as_written() {
    let ics = "BEGIN:VEVENT\r\nUID:quiz-1@moodle.univ.edu\r\nSUMMARY:CSE241 Quiz 1\r\nDTSTART;VALUE=DATE:20260115\r\nEND:VEVENT";
    let events = parse_ics_events(ics);

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].uid, "quiz-1@moodle.univ.edu");
    assert_eq!(events[0].summary, "CSE241 Quiz 1");
    let dtstart = events[0].dtstart.as_ref().expect("the event has a date");
    assert_eq!(dtstart.date, NaiveDate::from_ymd_opt(2026, 1, 15).unwrap());
    assert_eq!(dtstart.time, None);
}

/// Control for P4: a floating time keeps its clock while a UTC value is
/// converted — the two must not be confused.
#[test]
fn control_floating_time_is_kept_and_utc_time_is_converted() {
    let ics = "BEGIN:VEVENT\r\nUID:f\r\nSUMMARY:CSE241 Floating Quiz\r\nDTSTART:20260115T233000\r\nEND:VEVENT\r\n\
        BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:CSE241 UTC Quiz\r\nDTSTART:20260115T233000Z\r\nEND:VEVENT";
    let local = FixedOffset::east_opt(120 * 60).expect("valid offset");
    let (items, _) =
        parse_ics_assessments(ics, &ScheduleData::default(), &origin(), ref_date(), local);

    let floating = items.iter().find(|item| item.id == "moodle-f").unwrap();
    assert_eq!(
        floating.date,
        Some(NaiveDate::from_ymd_opt(2026, 1, 15).unwrap())
    );
    assert_eq!(
        floating.start_time,
        Some(NaiveTime::from_hms_opt(23, 30, 0).unwrap()),
        "the floating clock stays at 23:30"
    );

    let utc_item = items.iter().find(|item| item.id == "moodle-u").unwrap();
    assert_eq!(
        utc_item.date,
        Some(NaiveDate::from_ymd_opt(2026, 1, 16).unwrap()),
        "23:30 UTC is 01:30 the next day at +02:00"
    );
    assert_eq!(
        utc_item.start_time,
        Some(NaiveTime::from_hms_opt(1, 30, 0).unwrap())
    );
}

/// Control for P6: the four RFC 5545 escapes decode exactly once.
#[test]
fn control_escapes_decode_once() {
    let ics = "BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:Quiz\\, Chapter 1\\; N\\nLine\\\\End\r\nEND:VEVENT";
    let events = parse_ics_events(ics);

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].summary, "Quiz, Chapter 1; N\nLine\\End");
}

/// Control for P9: the parser's honest answer to a broken DTSTART is "no
/// date" — not the epoch, not today.
#[test]
fn control_broken_dtstart_yields_no_date() {
    assert!(parse_ical_datetime("20261301").is_none());
    assert!(parse_ical_datetime("20260230").is_none());
    assert!(parse_ical_datetime("garbage").is_none());
    assert!(parse_ical_datetime("").is_none());
}
