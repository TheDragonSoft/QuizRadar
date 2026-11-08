//! Property-based tests for the announcement → assessment pipeline
//! (`core/src/parse/email.rs`).
//!
//! Four properties, all driven through the crate's public API only:
//!
//! - **P1 — never panics.** Arbitrary text (and realistic-but-mangled
//!   announcements) go through the parser without a panic.
//! - **P2 — no fabricated facts.** A populated `room` / `group` /
//!   `instructor` is always derivable from the parse input. The parser only
//!   ever inherits room/group from the student's *own* timetable slot and
//!   the instructor from the `From:` header, so those are the only legal
//!   sources — never the announcement text, never a constant.
//! - **P3 — date sanity.** A parsed date is a real calendar date that
//!   round-trips through `chrono::NaiveDate`; a date in the text that cannot
//!   be parsed yields *no* date instead of a bogus one.
//! - **P4 — time sanity.** Start/end are inherited verbatim from one of the
//!   student's own slots, so they are never invented and never reordered.
//!
//! Three deterministic *controls* keep the properties from passing
//! vacuously: they pin that room/group/instructor/dates really are populated
//! for ordinary announcements.
//!
//! Configuration: every `proptest!` block below carries
//! `#![proptest_config(ProptestConfig { cases: 100, max_shrink_iters: 2000,
//! ..ProptestConfig::default() })]`. `proptest` 1.12 only accepts that inner
//! attribute *inside* a `proptest! { … }` block (there is no crate-level
//! `proptest_config` attribute macro in this version), so the identical
//! config expression is repeated per block.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout
)]

use chrono::{Datelike, Duration, NaiveDate, NaiveTime};
use proptest::prelude::*;
use quizradar_core::parse::email::{parse_email_announcement, parse_emails};
use quizradar_core::parse::util::{month_full_name, weekday_index, weekday_to_index};
use quizradar_core::types::{CachedEmail, Course, ScheduleData, ScheduleSlot};

// ---------------------------------------------------------------------------
// Fixed inputs — the parser takes "today" from its caller, so the tests never
// read a wall clock.
// ---------------------------------------------------------------------------

/// The reference date ("today") handed to the parser.
fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 29).expect("fixed reference date")
}

/// The first date on or after the reference date that falls on `day`
/// (`"Sun"`, `"Wed"`, …).
fn next_date_on(day: &str) -> Option<NaiveDate> {
    let index = weekday_index(day)?;
    (0..7)
        .map(|offset| ref_date() + Duration::days(offset))
        .find(|date| weekday_to_index(date.weekday()) == index)
}

// ---------------------------------------------------------------------------
// Realistic announcement corpora (mangled by the strategies below).
// ---------------------------------------------------------------------------

const REALISTIC_SUBJECTS: &[&str] = &[
    "Quiz 1 announcement",
    "Quiz 3 - CSE241",
    "Midterm exam schedule",
    "Final exam timetable",
    "Lab session assessment",
    "Assignment 2 submission window",
    "Online quiz: /mod/quiz/view.php?id=4211",
    "Class Quiz 1 next week (not this week)",
    "Reminder: quiz will be held on 18 October 2026",
];

const REALISTIC_BODIES: &[&str] = &[
    "Dear students,\nThe quiz will be held on 18 October 2026 at Lab A.\nDuration: 15 minutes.\nYou will not be able to go back to a previous question.\nMobile phones are strictly prohibited.\nBest regards",
    "<p>Quiz on <b>3 November 2026</b></p><br>Room: Hall 2<br>Closed-book exam, format: MCQ.",
    "---------------------------------------------------------------------\nQuiz 2 for CSE241 on 05/06/2026\n---------------------------------------------------------------------\nSent from my phone",
    "The assignment is due next week. Please submit the tutorial sheet solutions to the course page.",
    "Midterm exam will be held on 31 February 2026 in Lab C.",
    "During the lab session on 2026-10-20 we will run a short quiz in your assigned group slot.",
    "",
];

const REALISTIC_FROM: &[&str] = &[
    "Dr. Alice Smith <alice.smith@univ.edu>",
    "\"Prof. Bob Jones\" <bob@univ.edu>",
    "LMS Bot (via system) <bot@lms.edu>",
    "alice.smith@univ.edu",
    "Teaching Team",
    "",
];

const REALISTIC_DATE_HEADERS: &[&str] = &[
    "Sat, 10 Oct 2026 09:00:00 +0000",
    "Mon, 02 Nov 2026 13:45:00 +0300",
    "garbage",
    "",
];

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/// Arbitrary printable text. `proptest::string::string()` is not part of the
/// proptest 1.x API any more; `string_regex("\\PC*")` is the same default
/// strategy (`proptest::string::StringParam::default()`).
fn arb_text() -> impl Strategy<Value = String> {
    ::proptest::string::string_regex("\\PC*").expect("valid string regex")
}

/// Byte offset of the `n`-th character boundary in `text`.
fn char_cut(text: &str, n: usize) -> usize {
    text.char_indices().nth(n).map_or(text.len(), |(i, _)| i)
}

/// Splices arbitrary noise into a realistic announcement at a random
/// character offset, optionally upper-cases it and truncates it — the
/// "realistic but mangled" shape that breaks naive parsers.
fn mangle(base: &str, noise: &str, cut_chars: usize, keep_chars: usize, upper: bool) -> String {
    let mut text = base.to_string();
    if upper {
        text = text.to_ascii_uppercase();
    }
    let cut = char_cut(&text, cut_chars);
    let (head, tail) = text.split_at(cut);
    let mut mangled = format!("{head}{noise}{tail}");
    let keep = char_cut(&mangled, keep_chars);
    mangled.truncate(keep);
    mangled
}

/// A realistic string from `corpus`, mangled.
fn arb_mangled(corpus: &'static [&'static str]) -> impl Strategy<Value = String> {
    (
        prop::sample::select(corpus),
        arb_text(),
        0usize..16,
        0usize..160,
        any::<bool>(),
    )
        .prop_map(|(base, noise, cut, keep, upper)| mangle(base, &noise, cut, keep, upper))
}

/// A sender header: realistic ones plus arbitrary junk.
fn arb_from() -> impl Strategy<Value = String> {
    prop_oneof![arb_mangled(REALISTIC_FROM), arb_text()]
}

/// A `Date:` header: realistic ones plus arbitrary junk.
fn arb_date_header() -> impl Strategy<Value = String> {
    prop_oneof![
        prop::sample::select(REALISTIC_DATE_HEADERS).prop_map(str::to_string),
        arb_text()
    ]
}

/// A whole cached email with arbitrary / mangled announcement text.
fn arb_email() -> impl Strategy<Value = CachedEmail> {
    (
        arb_mangled(REALISTIC_SUBJECTS),
        arb_mangled(REALISTIC_BODIES),
        arb_from(),
        arb_date_header(),
    )
        .prop_map(|(subject, body, from, date)| CachedEmail {
            id: "email-1".to_string(),
            subject,
            from,
            date,
            snippet: None,
            body,
            body_truncated: false,
            internal_date_ms: None,
            history_id: None,
        })
}

const DAYS: &[&str] = &["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COURSE_IDS: &[&str] = &["CSE241", "CSE346"];
const SLOT_TYPES: &[&str] = &["Lecture", "Tutorial", "Lab"];
const ROOMS: &[&str] = &["Lab A", "Hall 2", "Room 101", "Auditorium", "Lab C"];
const GROUPS: &[&str] = &["Sec 1", "Sec 2", "Group A", "Group B"];

/// A random student timetable (slots may be missing a room or a group).
fn arb_schedule() -> impl Strategy<Value = ScheduleData> {
    prop::collection::vec(
        (
            prop::sample::select(DAYS),
            prop::sample::select(COURSE_IDS),
            prop::sample::select(SLOT_TYPES),
            prop::option::of(prop::sample::select(ROOMS)),
            prop::option::of(prop::sample::select(GROUPS)),
            (0u32..24, 0u32..60),
            (0u32..24, 0u32..60),
        ),
        0..6,
    )
    .prop_map(|slots| {
        let mut courses: Vec<Course> = Vec::new();
        let mut built: Vec<ScheduleSlot> = Vec::new();
        for (index, (day, course_id, slot_type, room, group, start, end)) in
            slots.into_iter().enumerate()
        {
            if !courses.iter().any(|course| course.id == course_id) {
                courses.push(Course {
                    id: course_id.to_string(),
                    name: format!("Course {course_id}"),
                    color: "#4285f4".to_string(),
                    bg: None,
                    border: None,
                    credits: None,
                    max_absences: None,
                });
            }
            built.push(ScheduleSlot {
                id: format!("slot-{index}"),
                day: day.to_string(),
                day_index: weekday_index(day).unwrap_or(0),
                course_id: course_id.to_string(),
                course_name: String::new(),
                slot_type: slot_type.to_string(),
                group: group.map(str::to_string),
                room: room.map(str::to_string),
                start_time: NaiveTime::from_hms_opt(start.0, start.1, 0).unwrap(),
                end_time: NaiveTime::from_hms_opt(end.0, end.1, 0).unwrap(),
                display_time: String::new(),
                has_quiz: false,
                quiz_title: None,
                week_parity: None,
            });
        }
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            academic_week_start: None,
            courses,
            slots: built,
        }
    })
}

/// An announcement tailored to the given timetable: it names one of the
/// student's own courses and the date of one of that course's slots, so the
/// parser really has to resolve the slot (and with it room, group and
/// start/end) instead of falling back to "unknown".
fn arb_email_for(schedule: &ScheduleData) -> impl Strategy<Value = CachedEmail> {
    let mut carriers: Vec<(String, String, NaiveDate)> = schedule
        .slots
        .iter()
        .filter_map(|slot| {
            next_date_on(&slot.day)
                .map(|date| (slot.course_id.clone(), slot.slot_type.clone(), date))
        })
        .collect();
    if carriers.is_empty() {
        // The timetable has no slots at all — keep the branch alive (the
        // announcement then simply resolves no slot, which is the honest
        // outcome for a student without a timetable).
        carriers.push(("CSE241".to_string(), "Lecture".to_string(), ref_date()));
    }

    let tailored = prop::sample::select(carriers).prop_map(|(course_id, slot_type, date)| {
        let date_text = format!(
            "{} {} {}",
            date.day(),
            month_full_name(date.month()),
            date.year()
        );
        let body = match slot_type.as_str() {
            "Tutorial" => {
                format!("Tutorial session for {course_id} on {date_text}. Bring your notes.")
            }
            "Lab" => format!(
                "During the lab session on {date_text} for {course_id} there will be a short quiz."
            ),
            _ => format!("Quiz 1 for {course_id} will be held on {date_text}."),
        };
        CachedEmail {
            id: "email-1".to_string(),
            subject: format!("Quiz announcement for {course_id}"),
            from: "Dr. Alice Smith <alice.smith@univ.edu>".to_string(),
            date: "Sat, 10 Oct 2026 09:00:00 +0000".to_string(),
            snippet: None,
            body,
            body_truncated: false,
            internal_date_ms: None,
            history_id: None,
        }
    });

    prop_oneof![tailored, arb_email()]
}

/// A timetable plus an announcement that may refer to one of its slots.
fn arb_schedule_and_email() -> impl Strategy<Value = (ScheduleData, CachedEmail)> {
    arb_schedule().prop_flat_map(|schedule| {
        let email = arb_email_for(&schedule);
        email.prop_map(move |email| (schedule.clone(), email))
    })
}

const MONTH_NAMES: &[&str] = &[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// `(day, month)` pairs that never exist on the calendar, for the
/// `D Month YYYY` form.
const INVALID_NAMED_DAY_MONTH: &[(u32, u32)] = &[
    (0, 1),
    (32, 1),
    (31, 2),
    (30, 2),
    (31, 4),
    (31, 6),
    (31, 9),
    (31, 11),
];

/// `(day, month)` pairs that never exist on the calendar, for the
/// `DD/MM/YYYY` form — the numeric form rejects month 0 and month 13 too.
const INVALID_NUMERIC_DAY_MONTH: &[(u32, u32)] = &[
    (0, 1),
    (32, 1),
    (31, 2),
    (30, 2),
    (31, 4),
    (31, 6),
    (31, 9),
    (31, 11),
    (15, 0),
    (15, 13),
];

/// A date string that looks like a date but does not exist on the calendar.
fn arb_invalid_date() -> impl Strategy<Value = String> {
    (
        prop::sample::select(INVALID_NAMED_DAY_MONTH),
        prop::sample::select(INVALID_NUMERIC_DAY_MONTH),
        1000u32..=9999,
        any::<bool>(),
    )
        .prop_map(|(named, numeric, year, use_numeric)| {
            let (day, month) = if use_numeric { numeric } else { named };
            if use_numeric {
                format!("{day:02}/{month:02}/{year}")
            } else {
                format!("{day} {} {year}", MONTH_NAMES[(month - 1) as usize])
            }
        })
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

/// Case-insensitive, whitespace-normalized form used for every comparison.
fn normalize(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .to_lowercase()
}

/// Removes a `(via …)` parenthesized group — the only transformation the
/// parser applies to a `From:` display name besides cutting at `<` and
/// dropping quote characters.
fn strip_via_groups(name: &str) -> String {
    let mut working = name.to_string();
    while let Some(open) = working.find('(') {
        let close = match working[open..].find(')') {
            Some(rel) => open + rel,
            None => break,
        };
        let inner = working[open + 1..close].trim().to_ascii_lowercase();
        if inner.starts_with("via") {
            working.replace_range(open..=close, "");
        } else {
            break;
        }
    }
    working
}

/// Every string a sender display name could legitimately be cut from: the raw
/// header, the header without quote characters, both with `(via …)` groups
/// removed, and the part of each before the first `<`.
fn from_header_candidates(from: &str) -> Vec<String> {
    let no_quotes = from.replace('"', "");
    let bases = [
        from.to_string(),
        no_quotes.clone(),
        strip_via_groups(from),
        strip_via_groups(&no_quotes),
    ];
    let mut candidates = Vec::with_capacity(bases.len() * 2);
    for base in bases {
        candidates.push(base.clone());
        if let Some((head, _)) = base.split_once('<') {
            candidates.push(head.to_string());
        }
    }
    candidates
}

/// True when `value` can be read out of one of `candidates`
/// (case-insensitive, whitespace-normalized substring match).
fn derivable_from(value: &str, candidates: &[String]) -> bool {
    let needle = normalize(value);
    !needle.is_empty() && candidates.iter().any(|c| normalize(c).contains(&needle))
}

/// Normalized rooms of the student's own slots — the only place the parser
/// may take a room from.
fn schedule_rooms(schedule: &ScheduleData) -> Vec<String> {
    schedule
        .slots
        .iter()
        .filter_map(|slot| slot.room.as_ref())
        .map(|room| normalize(room))
        .collect()
}

/// Normalized groups of the student's own slots.
fn schedule_groups(schedule: &ScheduleData) -> Vec<String> {
    schedule
        .slots
        .iter()
        .filter_map(|slot| slot.group.as_ref())
        .map(|group| normalize(group))
        .collect()
}

/// The whole parse input as one searchable blob: announcement text, sender
/// header and the student's own timetable strings.
fn input_haystack(email: &CachedEmail, schedule: &ScheduleData) -> String {
    let mut parts = vec![
        email.subject.clone(),
        email.body.clone(),
        email.from.clone(),
    ];
    for slot in &schedule.slots {
        if let Some(room) = &slot.room {
            parts.push(room.clone());
        }
        if let Some(group) = &slot.group {
            parts.push(group.clone());
        }
    }
    parts.join("\n")
}

// ---------------------------------------------------------------------------
// P1 — the parser never panics
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P1 — arbitrary and realistic-but-mangled announcement text must be
    /// parsed without a panic, and the scan bookkeeping must stay coherent.
    #[test]
    fn p1_parser_never_panics(
        (schedule, email) in arb_schedule_and_email(),
    ) {
        let assessment = parse_email_announcement(&email, &schedule, ref_date());
        prop_assert_eq!(&assessment.id, &email.id);
        prop_assert_eq!(
            assessment.email_subject.as_deref(),
            Some(email.subject.as_str())
        );

        let (items, stats) = parse_emails(std::slice::from_ref(&email), &schedule, ref_date());
        prop_assert_eq!(stats.scanned, 1);
        prop_assert_eq!(items.len(), stats.parsed);
        prop_assert!(stats.candidates <= 1);
        prop_assert!(stats.skipped_duplicates <= 1);
        for item in &items {
            prop_assert_eq!(&item.id, &email.id);
        }
    }
}

// ---------------------------------------------------------------------------
// P2 — no fabricated facts
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P2 — honesty: a populated room/group/instructor must be derivable from
    /// the parse input. `room` and `group` may only come from the student's
    /// own timetable slot, `instructor` only from the `From:` header — the
    /// parser must never invent one out of nothing.
    #[test]
    fn p2_room_instructor_and_group_are_never_fabricated(
        (schedule, email) in arb_schedule_and_email(),
    ) {
        let assessment = parse_email_announcement(&email, &schedule, ref_date());
        let haystack = normalize(&input_haystack(&email, &schedule));

        if let Some(room) = &assessment.room {
            let room = normalize(room);
            prop_assert!(!room.is_empty(), "room must not be an empty string");
            prop_assert!(
                schedule_rooms(&schedule).iter().any(|known| known == &room),
                "room {room:?} is not a room of the student's own timetable"
            );
            prop_assert!(
                haystack.contains(&room),
                "room {room:?} is not derivable from the parse input"
            );
        }

        if let Some(group) = &assessment.group {
            let group = normalize(group);
            prop_assert!(!group.is_empty(), "group must not be an empty string");
            prop_assert!(
                schedule_groups(&schedule).iter().any(|known| known == &group),
                "group {group:?} is not a group of the student's own timetable"
            );
            prop_assert!(
                haystack.contains(&group),
                "group {group:?} is not derivable from the parse input"
            );
        }

        if let Some(instructor) = &assessment.instructor {
            prop_assert!(
                !normalize(instructor).is_empty(),
                "instructor must not be an empty string"
            );
            let candidates = from_header_candidates(&email.from);
            prop_assert!(
                derivable_from(instructor, &candidates),
                "instructor {instructor:?} is not derivable from the From header {:?}",
                email.from
            );
        }
    }
}

// ---------------------------------------------------------------------------
// P3 — date sanity
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P3a — a parsed date is a real calendar date that round-trips through
    /// `chrono::NaiveDate` (never month 13, never day 32, never a day that
    /// does not exist in that month).
    #[test]
    fn p3_parsed_dates_are_valid_calendar_dates(
        (schedule, email) in arb_schedule_and_email(),
    ) {
        let assessment = parse_email_announcement(&email, &schedule, ref_date());
        if let Some(date) = assessment.date {
            let text = date.format("%Y-%m-%d").to_string();
            let round_tripped = NaiveDate::parse_from_str(&text, "%Y-%m-%d")
                .expect("date round-trips through the ISO form");
            prop_assert_eq!(round_tripped, date);

            prop_assert!((1..=12).contains(&date.month()), "month out of range");
            prop_assert!((1..=31).contains(&date.day()), "day out of range");
            prop_assert_eq!(
                NaiveDate::from_ymd_opt(date.year(), date.month(), date.day()),
                Some(date),
                "date is not a valid calendar date"
            );
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P3b — a date in the announcement that cannot be parsed yields *no*
    /// date at all instead of a bogus one (no week phrase in the text, so no
    /// heuristic estimate may take its place).
    #[test]
    fn p3_unparseable_date_yields_no_date(date_text in arb_invalid_date()) {
        let email = CachedEmail {
            id: "email-1".to_string(),
            subject: "Quiz announcement".to_string(),
            from: "Dr. Alice Smith <alice@univ.edu>".to_string(),
            date: "Sat, 10 Oct 2026 09:00:00 +0000".to_string(),
            snippet: None,
            body: format!("The quiz will be held on {date_text}. Bring your student id."),
            body_truncated: false,
            internal_date_ms: None,
            history_id: None,
        };
        let assessment = parse_email_announcement(&email, &ScheduleData::default(), ref_date());
        prop_assert!(
            assessment.date.is_none(),
            "bogus date {:?} parsed from {date_text:?}",
            assessment.date
        );
    }
}

// ---------------------------------------------------------------------------
// P4 — time sanity
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100,
        max_shrink_iters: 2000,
        ..ProptestConfig::default()
    })]
    /// P4 — start/end are inherited verbatim from one of the student's own
    /// slots: they are never invented and never reordered. Whenever the
    /// timetable itself is ordered (`end_time` >= `start_time`), the parsed
    /// times are ordered too; a negative duration can only come from a slot
    /// that the student themselves entered that way.
    #[test]
    fn p4_times_are_inherited_verbatim_from_the_students_own_slot(
        (schedule, email) in arb_schedule_and_email(),
    ) {
        let assessment = parse_email_announcement(&email, &schedule, ref_date());

        prop_assert_eq!(
            assessment.start_time.is_none(),
            assessment.end_time.is_none(),
            "start and end must both be present or both be absent"
        );

        if let (Some(start), Some(end)) = (assessment.start_time, assessment.end_time) {
            prop_assert!(
                schedule
                    .slots
                    .iter()
                    .any(|slot| slot.start_time == start && slot.end_time == end),
                "times {start}–{end} do not belong to any slot of the student's timetable"
            );

            let timetable_is_ordered = schedule
                .slots
                .iter()
                .all(|slot| slot.end_time >= slot.start_time);
            if timetable_is_ordered {
                prop_assert!(
                    end >= start,
                    "end {end} is before start {start} although every slot is ordered"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Controls — the properties above must not pass vacuously.
// ---------------------------------------------------------------------------

/// The deterministic timetable used by the controls.
fn control_schedule() -> ScheduleData {
    ScheduleData {
        semester: Some("Fall 2026".to_string()),
        academic_week_start: None,
        courses: vec![Course {
            id: "CSE241".to_string(),
            name: "Object-Oriented Programming".to_string(),
            color: "#e67c73".to_string(),
            bg: None,
            border: None,
            credits: None,
            max_absences: None,
        }],
        slots: vec![ScheduleSlot {
            id: "s1".to_string(),
            day: "Wed".to_string(),
            day_index: 3,
            course_id: "CSE241".to_string(),
            course_name: String::new(),
            slot_type: "Lecture".to_string(),
            group: Some("Sec 1".to_string()),
            room: Some("Lab A".to_string()),
            start_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            display_time: String::new(),
            has_quiz: false,
            quiz_title: None,
            week_parity: None,
        }],
    }
}

/// Control for P2: an ordinary announcement really does resolve room, group
/// and instructor — so the honesty property above is not vacuously true.
#[test]
fn p2_control_room_group_and_instructor_are_populated() {
    let email = CachedEmail {
        id: "email-1".to_string(),
        subject: "Quiz announcement for CSE241".to_string(),
        from: "Dr. Alice Smith <alice.smith@univ.edu>".to_string(),
        date: "Sat, 10 Oct 2026 09:00:00 +0000".to_string(),
        snippet: None,
        body: "Quiz 1 for CSE241 will be held on 21 October 2026.".to_string(),
        body_truncated: false,
        internal_date_ms: None,
        history_id: None,
    };

    let assessment = parse_email_announcement(&email, &control_schedule(), ref_date());

    assert_eq!(assessment.room.as_deref(), Some("Lab A"));
    assert_eq!(assessment.group.as_deref(), Some("Sec 1"));
    assert_eq!(assessment.instructor.as_deref(), Some("Dr. Alice Smith"));
    assert_eq!(assessment.date, NaiveDate::from_ymd_opt(2026, 10, 21));
    assert_eq!(
        assessment.start_time,
        Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap())
    );
    assert_eq!(
        assessment.end_time,
        Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap())
    );
}

/// Control for P3: a *valid* explicit date is parsed (and kept verbatim),
/// while an impossible one yields no date at all.
#[test]
fn p3_control_valid_date_is_parsed_and_impossible_date_is_not() {
    let valid = CachedEmail {
        id: "email-1".to_string(),
        subject: "Quiz announcement".to_string(),
        from: "Dr. Alice Smith <alice.smith@univ.edu>".to_string(),
        date: "Sat, 10 Oct 2026 09:00:00 +0000".to_string(),
        snippet: None,
        body: "The quiz will be held on 21 October 2026.".to_string(),
        body_truncated: false,
        internal_date_ms: None,
        history_id: None,
    };
    let impossible = CachedEmail {
        body: "The quiz will be held on 31 February 2026.".to_string(),
        ..valid.clone()
    };

    let parsed = parse_email_announcement(&valid, &ScheduleData::default(), ref_date());
    assert_eq!(parsed.date, NaiveDate::from_ymd_opt(2026, 10, 21));

    let rejected = parse_email_announcement(&impossible, &ScheduleData::default(), ref_date());
    assert_eq!(rejected.date, None);
}

/// Documents the real P4 behaviour: the parser inherits slot times verbatim
/// and does not validate them, so a timetable slot that runs past midnight
/// (`end_time` < `start_time`) is carried into the assessment as-is — the
/// negative duration is the student's own data, not a parser invention.
#[test]
fn p4_overnight_slot_times_are_preserved_verbatim() {
    let mut schedule = control_schedule();
    schedule.slots[0].start_time = NaiveTime::from_hms_opt(22, 0, 0).unwrap();
    schedule.slots[0].end_time = NaiveTime::from_hms_opt(2, 0, 0).unwrap();

    let email = CachedEmail {
        id: "email-1".to_string(),
        subject: "Quiz announcement for CSE241".to_string(),
        from: "Dr. Alice Smith <alice.smith@univ.edu>".to_string(),
        date: "Sat, 10 Oct 2026 09:00:00 +0000".to_string(),
        snippet: None,
        body: "Quiz 1 for CSE241 will be held on 21 October 2026.".to_string(),
        body_truncated: false,
        internal_date_ms: None,
        history_id: None,
    };

    let assessment = parse_email_announcement(&email, &schedule, ref_date());

    // 21 October 2026 is a Wednesday, so the overnight slot is the carrier.
    assert_eq!(
        assessment.start_time,
        Some(NaiveTime::from_hms_opt(22, 0, 0).unwrap())
    );
    assert_eq!(
        assessment.end_time,
        Some(NaiveTime::from_hms_opt(2, 0, 0).unwrap())
    );
    assert!(assessment.end_time < assessment.start_time);
}
