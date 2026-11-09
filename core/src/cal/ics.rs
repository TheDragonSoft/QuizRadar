//! `.ics` calendar export (`01` §4.6 "Export .ics (single/all)"): RFC 5545
//! text written from the user's own assessment data only.
//!
//! Honesty rules:
//! - times are **floating local** (no `Z`, no `TZID`) — v4's working export
//!   shape, kept deliberately: the file says what the student's device
//!   shows, and the core owns no timezone database (`03` §C7);
//! - an assessment without a confirmed date exports nothing (single export
//!   is an honest error; the all-export skips it) — a dateless draft is
//!   never silently pinned to a calendar day;
//! - missing rooms/times never render as invented strings; the alarm text
//!   only claims what the data actually says;
//! - `PRODID` is fixed to the v5 identity (`-//QuizRadar//v5//EN`).

use crate::types::Assessment;

/// The v5 product identity in every exported calendar file.
pub const ICS_PRODID: &str = "-//QuizRadar//v5//EN";

/// The all-export's calendar name (v4 parity).
const CALENDAR_NAME: &str = "QuizRadar - Academic Exams & Quizzes";

/// CRLF line terminator required by RFC 5545 §3.1.
const CRLF: &str = "\r\n";

/// Why an export produced nothing. The message is user-presentable.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IcsExportError {
    #[error("This assessment has no confirmed date yet — nothing to place on a calendar. Confirm the date first (the radar keeps it as an undated draft).")]
    Undated,
}

/// Exports one assessment as a single-event VCALENDAR. Undated drafts are an
/// honest [`IcsExportError::Undated`], never an invented date.
pub fn export_ics_single(assessment: &Assessment) -> Result<String, IcsExportError> {
    let Some(date) = assessment.date else {
        return Err(IcsExportError::Undated);
    };
    Ok(format!(
        "BEGIN:VCALENDAR{CRLF}\
         VERSION:2.0{CRLF}\
         PRODID:{ICS_PRODID}{CRLF}\
         CALSCALE:GREGORIAN{CRLF}\
         METHOD:PUBLISH{CRLF}\
         {vevent}\
         END:VCALENDAR{CRLF}",
        vevent = format_vevent(assessment, date)
    ))
}

/// Exports every dated upcoming assessment into one calendar. Undated and
/// past items are skipped (they are not calendar events); the export is
/// still produced even when that leaves it empty — the count is the
/// caller's to report honestly.
pub fn export_ics_all(assessments: &[Assessment]) -> String {
    let mut out = format!(
        "BEGIN:VCALENDAR{CRLF}\
         VERSION:2.0{CRLF}\
         PRODID:{ICS_PRODID}{CRLF}\
         CALSCALE:GREGORIAN{CRLF}\
         METHOD:PUBLISH{CRLF}\
         X-WR-CALNAME:{CALENDAR_NAME}{CRLF}"
    );
    for assessment in assessments
        .iter()
        .filter(|item| item.is_upcoming && item.date.is_some())
    {
        // `filter` guarantees the date exists.
        out.push_str(&format_vevent(
            assessment,
            assessment.date.unwrap_or_default(),
        ));
    }
    out.push_str("END:VCALENDAR");
    out.push_str(CRLF);
    out
}

/// RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, newline.
/// Carriage returns are dropped (the writer emits CRLF itself).
fn ical_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            other => out.push(other),
        }
    }
    out
}

/// Folds one content line to the RFC 5545 §3.1 75-octet limit using
/// space-prefixed continuations. Chunks are counted by characters with a
/// byte budget, so multibyte text stays shorter (never over) the octet cap.
fn fold_line(line: &str) -> String {
    if line.len() <= 75 {
        return line.to_string();
    }
    let mut out = String::with_capacity(line.len() + line.len() / 74 * 3);
    let mut budget = 75usize;
    let mut chunk_bytes = 0usize;
    for ch in line.chars() {
        let width = ch.len_utf8();
        if chunk_bytes + width > budget {
            out.push_str(CRLF);
            out.push(' ');
            budget = 74; // continuations carry one leading space
            chunk_bytes = 0;
        }
        out.push(ch);
        chunk_bytes += width;
    }
    out
}

/// A property line: escaped, folded, CRLF-terminated.
fn property(name: &str, value: &str) -> String {
    fold_line(&format!("{name}:{value}")) + CRLF
}

/// A property line with parameters (e.g. `DTSTART;VALUE=DATE:…`).
fn property_with_param(name: &str, param: &str, value: &str) -> String {
    fold_line(&format!("{name};{param}:{value}")) + CRLF
}

/// `YYYYMMDD` from the stored `YYYY-MM-DD` date.
fn compact_date(date: chrono::NaiveDate) -> String {
    date.format("%Y%m%d").to_string()
}

/// `HHMMSS` from the stored `HH:MM` time.
fn compact_time(time: chrono::NaiveTime) -> String {
    time.format("%H%M%S").to_string()
}

/// One VEVENT with its two VALARMs (−1 day and −2 hours, v4 parity).
fn format_vevent(assessment: &Assessment, date: chrono::NaiveDate) -> String {
    let mut event = String::new();

    event.push_str(&property("BEGIN", "VEVENT"));
    // UID stability: the assessment id is the identity across re-exports, so
    // re-importing a newer export replaces the same event everywhere.
    // Strip control characters and escape for safety.
    let safe_uid: String = assessment
        .id
        .chars()
        .filter(|c| !c.is_control() && *c != '\r' && *c != '\n')
        .collect();
    event.push_str(&property(
        "UID",
        &format!("quizradar-{}@quizradar.local", safe_uid),
    ));

    match (assessment.start_time, assessment.end_time) {
        (Some(start), Some(end)) => {
            event.push_str(&property(
                "DTSTART",
                &format!("{}T{}", compact_date(date), compact_time(start)),
            ));
            let end_date = if end <= start {
                date.succ_opt().unwrap_or(date)
            } else {
                date
            };
            event.push_str(&property(
                "DTEND",
                &format!("{}T{}", compact_date(end_date), compact_time(end)),
            ));
        }
        (Some(start), None) => {
            // Start time known, duration never claimed: a zero-length event
            // says "starts at" and nothing more.
            let stamp = format!("{}T{}", compact_date(date), compact_time(start));
            event.push_str(&property("DTSTART", &stamp));
            event.push_str(&property("DTEND", &stamp));
        }
        (None, _) => {
            // Date-only: all-day VALUE=DATE form; DTEND is the exclusive
            // next day (RFC 5545 §3.6.1), not an invented end time.
            event.push_str(&property_with_param(
                "DTSTART",
                "VALUE=DATE",
                &compact_date(date),
            ));
            event.push_str(&property_with_param(
                "DTEND",
                "VALUE=DATE",
                &compact_date(date.succ_opt().unwrap_or(date)),
            ));
        }
    }

    let summary = match &assessment.course_id {
        Some(code) => format!(
            "[{code}] {} ({})",
            assessment.title,
            assessment.assessment_type.as_str()
        ),
        None => format!(
            "{} ({})",
            assessment.title,
            assessment.assessment_type.as_str()
        ),
    };
    event.push_str(&property("SUMMARY", &ical_escape(&summary)));

    // Location: only what the student's data actually established. No
    // default campus/hall strings (v4's fabrication is deleted).
    let mut location_parts: Vec<String> = Vec::new();
    if let Some(room) = assessment
        .room
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        location_parts.push(format!("Room {room}"));
    }
    if let Some(group) = assessment
        .group
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
    {
        location_parts.push(format!("({group})"));
    }
    if !location_parts.is_empty() {
        event.push_str(&property(
            "LOCATION",
            &ical_escape(&location_parts.join(" ")),
        ));
    }

    event.push_str(&property(
        "DESCRIPTION",
        &ical_escape(&description(assessment)),
    ));

    let day_alarm = match assessment.start_time {
        Some(start) => format!(
            "Upcoming {} tomorrow at {}!",
            assessment.title,
            crate::parse::util::format_12h(start)
        ),
        None => format!("Upcoming {} tomorrow!", assessment.title),
    };
    let soon_alarm = match (assessment.start_time, assessment.room.as_deref()) {
        (Some(start), Some(room)) => format!(
            "{} starts in 2 hours at {} in Room {}!",
            assessment.title,
            crate::parse::util::format_12h(start),
            room
        ),
        (Some(start), None) => format!(
            "{} starts in 2 hours at {}!",
            assessment.title,
            crate::parse::util::format_12h(start)
        ),
        (None, Some(room)) => format!("{} starts in 2 hours in Room {}!", assessment.title, room),
        (None, None) => format!("{} starts in 2 hours!", assessment.title),
    };

    event.push_str(&property("BEGIN", "VALARM"));
    event.push_str(&property("TRIGGER", "-P1D"));
    event.push_str(&property("ACTION", "DISPLAY"));
    event.push_str(&property("DESCRIPTION", &ical_escape(&day_alarm)));
    event.push_str(&property("END", "VALARM"));
    event.push_str(&property("BEGIN", "VALARM"));
    event.push_str(&property("TRIGGER", "-PT2H"));
    event.push_str(&property("ACTION", "DISPLAY"));
    event.push_str(&property("DESCRIPTION", &ical_escape(&soon_alarm)));
    event.push_str(&property("END", "VALARM"));
    event.push_str(&property("END", "VEVENT"));
    event
}

/// The DESCRIPTION body: only sections the data actually carries.
fn description(assessment: &Assessment) -> String {
    let mut desc = String::new();
    match (&assessment.course_id, &assessment.course_name) {
        (Some(code), Some(name)) => desc.push_str(&format!("Course: {code} - {name}\n")),
        (Some(code), None) => desc.push_str(&format!("Course: {code}\n")),
        (None, Some(name)) => desc.push_str(&format!("Course: {name}\n")),
        (None, None) => {}
    }
    desc.push_str(&format!("Type: {}\n", assessment.assessment_type.as_str()));
    if let Some(room) = assessment
        .room
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        desc.push_str(&format!("Room: {room}\n"));
    }
    if let Some(group) = assessment
        .group
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
    {
        desc.push_str(&format!("Group: {group}\n"));
    }
    if let Some(instructor) = assessment
        .instructor
        .as_deref()
        .map(str::trim)
        .filter(|i| !i.is_empty())
    {
        desc.push_str(&format!("Instructor: {instructor}\n"));
    }
    if !assessment.topics.is_empty() {
        desc.push_str("\nTopics to Study:\n- ");
        desc.push_str(&assessment.topics.join("\n- "));
        desc.push('\n');
    }
    if !assessment.warnings.is_empty() {
        desc.push_str("\nWarnings:\n");
        desc.push_str(&assessment.warnings.join("\n"));
        desc.push('\n');
    }
    if let Some(plan) = assessment
        .ai_study_plan
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        desc.push_str(&format!("\nStudy Plan: {plan}\n"));
    }
    if let Some(note) = assessment
        .ai_inference_note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        desc.push_str(&format!("\n{note}\n"));
    }
    if let Some(url) = assessment
        .elearning_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        desc.push_str(&format!("\nCourse Announcement: {url}\n"));
    }
    desc
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::plan::fixtures::assessment_on;
    use chrono::NaiveTime;

    fn timed(id: &str, title: &str, date: chrono::NaiveDate, topics: Vec<&str>) -> Assessment {
        let mut item = assessment_on(id, Some("CSE241"), title, Some(date), topics);
        item.start_time = NaiveTime::from_hms_opt(9, 30, 0);
        item.end_time = NaiveTime::from_hms_opt(11, 0, 0);
        item.room = Some("Hall A-101".to_string());
        item.group = Some("Sec 1".to_string());
        item.instructor = Some("Dr. Ada Lovelace".to_string());
        item.warnings = vec!["Bring your student ID".to_string()];
        item.ai_study_plan = Some("Revise lecture 4 and 5.".to_string());
        item.ai_inference_note = Some("Parsed from announcement: explicit date found.".to_string());
        item.elearning_url = Some("https://lms.univ.edu/mod/quiz/view.php?id=7".to_string());
        item
    }

    #[test]
    fn prodid_is_fixed_to_the_v5_identity() {
        let item = timed(
            "gmail-1",
            "Quiz 1",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
            vec!["Loops"],
        );
        let ics = export_ics_single(&item).unwrap();
        assert!(ics.contains("PRODID:-//QuizRadar//v5//EN\r\n"), "{ics}");
        assert!(!ics.contains("v4.3.0"));
        assert!(ics.contains("VERSION:2.0\r\n"));
        assert!(ics.contains("CALSCALE:GREGORIAN\r\n"));
    }

    #[test]
    fn uid_is_stable_across_exports() {
        let item = timed(
            "gmail-quiz-7",
            "Quiz 1",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
            vec!["Loops"],
        );
        let first = export_ics_single(&item).unwrap();
        let second = export_ics_single(&item).unwrap();
        assert_eq!(first, second, "same input ⇒ byte-identical export");
        assert!(first.contains("UID:quizradar-gmail-quiz-7@quizradar.local\r\n"));
    }

    #[test]
    fn event_has_exactly_two_valarms_with_v4_triggers() {
        let item = timed(
            "gmail-1",
            "Quiz 1",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
            vec!["Loops"],
        );
        let ics = export_ics_single(&item).unwrap();
        assert_eq!(ics.matches("BEGIN:VALARM").count(), 2);
        assert_eq!(ics.matches("TRIGGER:-P1D").count(), 1);
        assert_eq!(ics.matches("TRIGGER:-PT2H").count(), 1);
        assert_eq!(ics.matches("END:VALARM").count(), 2);
    }

    #[test]
    fn text_is_escaped_and_lines_are_folded() {
        let mut item = timed(
            "gmail-1",
            "Quiz 1",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
            vec!["Loops"],
        );
        item.title = "Quiz 1; Theory, Practice & Notes".to_string();
        item.topics = vec![format!("Very long topic {} that keeps going and going and going and going and going and going so the line must fold", "x".repeat(40))];
        let ics = export_ics_single(&item).unwrap();

        assert!(
            ics.contains("SUMMARY:[CSE241] Quiz 1\\; Theory\\, Practice & Notes (Class Quiz)"),
            "{ics}"
        );
        // Every physical line respects the 75-octet limit (CRLF-separated).
        for line in ics.split("\r\n") {
            assert!(line.len() <= 75, "unfolded line is too long: {line}");
        }
        // Unfolding reconstructs the logical line exactly.
        let unfolded = ics.replace("\r\n ", "");
        assert!(unfolded.contains("Very long topic"), "{unfolded}");
        assert!(
            !unfolded.contains("\r\n  "),
            "no double-space continuation artifacts"
        );
    }

    #[test]
    fn times_are_floating_local_without_zone_suffixes() {
        let item = timed(
            "gmail-1",
            "Quiz 1",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
            vec!["Loops"],
        );
        let ics = export_ics_single(&item).unwrap();
        assert!(ics.contains("DTSTART:20261025T093000\r\n"), "{ics}");
        assert!(ics.contains("DTEND:20261025T110000\r\n"), "{ics}");
        assert!(
            !ics.contains('Z'),
            "floating times never carry a UTC marker"
        );
        assert!(!ics.contains("TZID"), "no timezone id is fabricated");
    }

    #[test]
    fn date_only_items_export_as_all_day_with_exclusive_end() {
        let item = assessment_on(
            "gmail-2",
            None,
            "Dateless-time draft",
            Some(chrono::NaiveDate::from_ymd_opt(2026, 11, 3).unwrap()),
            vec![],
        );
        let ics = export_ics_single(&item).unwrap();
        assert!(ics.contains("DTSTART;VALUE=DATE:20261103\r\n"), "{ics}");
        assert!(ics.contains("DTEND;VALUE=DATE:20261104\r\n"), "{ics}");
    }

    #[test]
    fn undated_drafts_are_refused_not_invented() {
        let item = assessment_on("gmail-3", None, "No date", None, vec![]);
        let error = export_ics_single(&item).unwrap_err();
        assert_eq!(error, IcsExportError::Undated);
        assert!(error.to_string().contains("no confirmed date"));
    }

    #[test]
    fn all_export_skips_undated_and_past_and_keeps_v4_calendar_name() {
        let dated = timed(
            "gmail-1",
            "Quiz 1",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap(),
            vec!["Loops"],
        );
        let mut past = timed(
            "gmail-2",
            "Old",
            chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            vec![],
        );
        past.is_upcoming = false;
        let undated = assessment_on("gmail-3", None, "Draft", None, vec![]);

        let ics = export_ics_all(&[dated, past, undated]);
        assert!(ics.contains("X-WR-CALNAME:QuizRadar - Academic Exams & Quizzes\r\n"));
        assert_eq!(
            ics.matches("BEGIN:VEVENT").count(),
            1,
            "only the dated upcoming item exports"
        );
        assert!(ics.contains("UID:quizradar-gmail-1@quizradar.local"));
    }

    #[test]
    fn missing_room_never_becomes_a_default_string() {
        let item = assessment_on(
            "gmail-4",
            None,
            "Sparse quiz",
            Some(chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()),
            vec![],
        );
        let ics = export_ics_single(&item).unwrap();
        assert!(
            !ics.contains("LOCATION:"),
            "no location line without a real room/group"
        );
        assert!(!ics.contains("Hall"), "no default hall fabrication");
        assert!(!ics.contains("University Campus"));
        // Alarms stay honest about the unknowns too.
        assert!(ics.contains("DESCRIPTION:Upcoming Sparse quiz tomorrow!"));
        assert!(ics.contains("DESCRIPTION:Sparse quiz starts in 2 hours!"));
    }

    #[test]
    fn courseless_summary_has_no_general_fabrication() {
        let item = assessment_on(
            "moodle-9",
            None,
            "Quiz 3",
            Some(chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()),
            vec![],
        );
        let ics = export_ics_single(&item).unwrap();
        assert!(ics.contains("SUMMARY:Quiz 3 (Class Quiz)"), "{ics}");
        assert!(!ics.to_uppercase().contains("GENERAL"));
    }
}
