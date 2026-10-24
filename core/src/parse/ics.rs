//! ICS calendar parsing (`03` §A3): RFC 5545 VEVENTs from the Moodle
//! personal-calendar export and generic university subscription feeds,
//! cross-referenced against the student's weekly schedule.
//!
//! Ported from v4 `moodle.rs` + `feeds.rs` with the `03` deletions applied —
//! no default room ("E-Learning Lab / Online"), no instructor fabrication
//! ("Course Faculty"), no "All Sections" group, no invented end time
//! (+90min), no `"09:00"/"10:30"` defaults on date-only events, no hardcoded
//! `email_sent_date` or `moodle.org` fallback links, no fixed priority `85`,
//! and the urgency/priority ladders come from [`crate::parse::util`] so
//! `01` §3 wins over v4's divergent ICS tables. v5 divergences
//! (deliberate): unfolding of continuation lines (v4's regex silently
//! dropped folded properties), VALARM sub-components are skipped, TEXT
//! unescaping is one honest pass, and UTC conversion takes the caller's
//! [`FixedOffset`] so core stays pure — no hidden local clock ever enters a
//! fixture test.

use chrono::{FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Timelike};
use serde::{Deserialize, Serialize};

use crate::parse::email::{classify_ics_text, find_course_code, ScanStats};
use crate::parse::merge::merge_key;
use crate::parse::util::{
    build_display_time, compute_priority_score, day_name_for, days_until, infer_semester_from_date,
    urgency_for,
};
use crate::types::{Assessment, AssessmentSource, Course, ScheduleData};

/// Sanity cap on topic candidates (matches the email pipeline; v4 had none).
const MAX_ICS_TOPICS: usize = 32;

// ---------------------------------------------------------------------------
// Structural model
// ---------------------------------------------------------------------------

/// The provider a `.ics` file came from — drives ids, honesty notes and the
/// fallback calendar link without any fabricated branding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum IcsOrigin {
    /// The student's own Moodle LMS personal calendar export.
    Moodle {
        /// Moodle base URL (portal home page), if the import configuration
        /// established one; events without their own link fall back to
        /// `{portal}/calendar/view.php?view=upcoming`.
        portal_url: Option<String>,
    },
    /// A generic university `.ics` subscription feed (`sources/`, later
    /// phase). `name` is the user's own label and becomes each item's
    /// `source`; `feed_url` is the validated `https://` link (fallback URL).
    /// The URL normally embeds a personal token and is never echoed into
    /// notes or logs.
    Feed {
        name: String,
        feed_url: Option<String>,
    },
}

impl IcsOrigin {
    /// v4 id-prefix convention (`moodle-` / `feed-`; `AssessmentSource::id_prefix`
    /// maps the feed *label* to v4's `custom-` gate — these stay distinct).
    #[must_use]
    pub fn id_prefix(&self) -> &'static str {
        match self {
            Self::Moodle { .. } => "moodle-",
            Self::Feed { .. } => "feed-",
        }
    }

    /// The user-facing source label: `"Moodle"` or the feed's own name.
    #[must_use]
    pub fn source(&self) -> AssessmentSource {
        match self {
            Self::Moodle { .. } => AssessmentSource::Moodle,
            Self::Feed { name, .. } => AssessmentSource::Feed(name.clone()),
        }
    }

    /// Fallback link for events that carry none: Moodle's upcoming-events
    /// view; a generic feed honestly falls back to the feed URL itself
    /// (v4's hardcoded `https://moodle.org` hero-link is deleted).
    #[must_use]
    pub fn fallback_url(&self) -> Option<String> {
        match self {
            Self::Moodle { portal_url } => portal_url
                .as_deref()
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .map(|p| {
                    let base = p.trim_end_matches('/');
                    format!("{base}/calendar/view.php?view=upcoming")
                }),
            Self::Feed { feed_url, .. } => feed_url
                .as_deref()
                .map(str::trim)
                .filter(|u| !u.is_empty())
                .map(str::to_string),
        }
    }

    /// Base warning sentence (per announcement, honest about the origin).
    #[must_use]
    pub fn base_warning(&self) -> String {
        match self {
            Self::Moodle { .. } => {
                "🎓 Synced directly from your official Moodle LMS calendar.".to_string()
            }
            Self::Feed { name, .. } => {
                format!("📅 Synced from your subscribed calendar feed \"{name}\".")
            }
        }
    }
}

/// One parsed VEVENT, with the structural fields the honest pipeline needs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct IcsEvent {
    pub uid: String,
    pub summary: String,
    pub description: String,
    pub dtstart: Option<IcsDateTime>,
    pub dtend: Option<IcsDateTime>,
    pub url: Option<String>,
}

/// A DTSTART/DTEND value. `time` is `None` for date-only values — the v4
/// `"09:00"` default on date-only slots was fabrication and is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IcsDateTime {
    pub date: NaiveDate,
    pub time: Option<NaiveTime>,
    pub is_utc: bool,
    /// Recorded for honesty only; v4 (and v5) evaluates TZID values as local
    /// wall time rather than shipping a timezone database into core.
    pub tzid: Option<String>,
}

// ---------------------------------------------------------------------------
// Low-level RFC 5545 scanners (char-safe, no regex)
// ---------------------------------------------------------------------------

/// Unfolds RFC 5545 continuation lines (a leading space or HTAB belongs to
/// the previous line) — v4's regex approach left them as silent no-op lines,
/// so any folded property was lost. Runs before block splitting.
fn unfold_ics_lines(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(normalized.len());
    for line in normalized.split('\n') {
        let Some(rest) = line.strip_prefix([' ', '\t']) else {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line);
            continue;
        };
        out.push_str(rest);
    }
    out
}

/// Splits unfolded text into VEVENT interiors (v4 `RE_VEVENT` parity), plus
/// skipping VALARM sub-components instead of letting their lines leak into
/// the event body.
fn collect_vevent_blocks(unfolded: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut in_vevent = false;
    let mut in_valarm = false;
    for line in unfolded.split('\n') {
        let line = line.trim_end();
        if in_vevent && line.eq_ignore_ascii_case("END:VEVENT") {
            if !current.is_empty() {
                blocks.push(current.join("\n"));
            }
            current = Vec::new();
            in_vevent = false;
            in_valarm = false;
            continue;
        }
        if in_vevent && line.eq_ignore_ascii_case("BEGIN:VALARM") {
            in_valarm = true;
            continue;
        }
        if in_valarm {
            if line.eq_ignore_ascii_case("END:VALARM") {
                in_valarm = false;
            }
            continue;
        }
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            in_vevent = true;
            continue;
        }
        if in_vevent {
            current.push(line.to_string());
        }
    }
    // An unfinished trailing VEVENT is honest partial input: still yielded.
    if in_vevent && !current.is_empty() {
        blocks.push(current.join("\n"));
    }
    blocks
}

/// Byte length of the char at `index` (guarded so indexing never panics).
fn char_len_at(text: &str, index: usize) -> usize {
    text[index..].chars().next().map_or(0, char::len_utf8)
}

/// Splits a content line into full property name (with params) and value at
/// the first `:` that is not inside a double-quoted parameter. `None` for
/// malformed lines.
fn split_property(line: &str) -> Option<(&str, &str)> {
    let mut in_quotes = false;
    for (index, ch) in line.char_indices() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                return Some((&line[..index], &line[index + char_len_at(line, index)..]));
            }
            _ => {}
        }
    }
    None
}

/// Base property token of a name-with-params: `"DTSTART;TZID=X"` →
/// `"DTSTART"`.
fn property_base(full_name: &str) -> &str {
    full_name.split(';').next().unwrap_or(full_name).trim()
}

/// Parameter value lookup on a full property name (`"DTSTART;TZID=Cairo"` →
/// `"Cairo"`).
fn property_param(full_name: &str, param: &str) -> Option<String> {
    full_name.split(';').skip(1).find_map(|p| {
        p.split_once('=').and_then(|(k, v)| {
            if k.eq_ignore_ascii_case(param) {
                Some(v.trim_matches('"').to_string())
            } else {
                None
            }
        })
    })
}

/// One escape pass: `\,` `\;` `\n` `\N` and `\\` (RFC 5545 §3.3.1/§3.3.11).
/// Unknown backslashes survive verbatim — nothing is silently invented.
fn unescape_ics_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.peek().copied() {
            Some(',') => {
                out.push(',');
                chars.next();
            }
            Some(';') => {
                out.push(';');
                chars.next();
            }
            Some('n') | Some('N') => {
                out.push('\n');
                chars.next();
            }
            Some('\\') => {
                out.push('\\');
                chars.next();
            }
            _ => out.push('\\'),
        }
    }
    out
}

fn clean_ics_value(raw: &str) -> String {
    unescape_ics_text(raw.trim())
}

/// Parses a DTSTART/DTEND value into [`IcsDateTime`]. Tolerates the shapes
/// v4 understood (`20261018T100000Z`, `20261018T100000`, `20261018`,
/// `2026-10-18`) — the date is the first 8 digits, the optional time the two
/// leading digit pairs after the `T` separator. Invalid values (e.g. "10
/// October is a lie" digit soup like `20261010` for a live month scan) yield
/// `None`; such events are skipped, never given an invented date.
#[must_use]
pub fn parse_ical_datetime(value: &str) -> Option<IcsDateTime> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let is_utc = trimmed.ends_with('Z');
    let cleaned = trimmed.trim_end_matches('Z').trim();

    let separator = cleaned
        .char_indices()
        .find(|(_, ch)| *ch == 'T' || *ch == 't')
        .map(|(index, _)| index);
    let (date_part, time_part) = match separator {
        Some(at) => (
            &cleaned[..at],
            Some(&cleaned[at + char_len_at(cleaned, at)..]),
        ),
        None => (cleaned, None),
    };

    let date_digits: String = date_part.chars().filter(char::is_ascii_digit).collect();
    if date_digits.len() < 8 {
        return None;
    }
    let (year, month, day) = (
        date_digits[..4].parse::<i32>().ok()?,
        date_digits[4..6].parse::<u32>().ok()?,
        date_digits[6..8].parse::<u32>().ok()?,
    );
    let date = NaiveDate::from_ymd_opt(year, month, day)?;

    let time = time_part.and_then(|tp| {
        let digits: Vec<u32> = tp
            .chars()
            .filter(char::is_ascii_digit)
            .take(6)
            .map(|c| u32::from(c as u8 - b'0'))
            .collect();
        if digits.len() < 4 {
            return None;
        }
        let (hh, mm) = (digits[0] * 10 + digits[1], digits[2] * 10 + digits[3]);
        if hh > 23 || mm > 59 {
            return None;
        }
        NaiveTime::from_hms_opt(hh, mm, 0)
    });

    Some(IcsDateTime {
        date,
        time,
        is_utc,
        tzid: None,
    })
}

/// The two description keywords v4's candidate filter understood (the
/// summary uses the fuller list below).
fn description_candidate(lower: &str) -> bool {
    lower.contains("quiz") || lower.contains("exam")
}

fn summary_candidate(lower: &str) -> bool {
    ["quiz", "exam", "midterm", "assessment", "assignment"]
        .iter()
        .any(|keyword| lower.contains(keyword))
}

/// ASCII-case-insensitive containment; haystacks are pre-lowered here so the
/// byte windows stay valid.
fn ascii_ci_contains(haystack: &[u8], needle: &str) -> bool {
    let nee = needle.as_bytes();
    if nee.is_empty() {
        return true;
    }
    if haystack.len() < nee.len() {
        return false;
    }
    (0..=haystack.len() - nee.len()).any(|i| {
        haystack[i..i + nee.len()]
            .iter()
            .zip(nee.iter())
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
    })
}

/// One combined event context string (summary + space + description),
/// pre-lowered, for matching/filtering passes.
fn event_context(event: &IcsEvent) -> String {
    let mut combined = event.summary.to_ascii_lowercase();
    combined.push(' ');
    combined.push_str(&event.description.to_ascii_lowercase());
    combined
}

/// Combined candidate check used by [`parse_ics_assessments`] and by the
/// `sources/` fetchers that map structured events (Moodle REST) through the
/// same honesty filter.
pub(crate) fn is_ics_candidate(event: &IcsEvent) -> bool {
    let context_lower = event_context(event);
    let summary_lower = event.summary.to_ascii_lowercase();
    summary_candidate(&summary_lower) || description_candidate(&context_lower)
}

/// v4 course matching, one sweep: id substring, then name, then the
/// announcement course-code scanner (`"CSE 241"` with the spaced code). The
/// returned label feeds the honesty note.
pub(crate) fn match_course_with_how<'a>(
    schedule: &'a ScheduleData,
    context_lower: &str,
) -> Option<(&'a Course, &'static str)> {
    for course in &schedule.courses {
        if !course.id.is_empty() && ascii_ci_contains(context_lower.as_bytes(), &course.id) {
            return Some((course, "id-matching"));
        }
    }
    for course in &schedule.courses {
        if !course.name.is_empty() && ascii_ci_contains(context_lower.as_bytes(), &course.name) {
            return Some((course, "name-matching"));
        }
    }
    find_course_code(context_lower).and_then(|code| {
        schedule
            .find_course(&code)
            .map(|course| (course, "course-code"))
    })
}

/// First slot of the matched course whose room is genuinely known — v4 parity
/// without the "E-Learning Lab / Online" default. No slot ⇒ `None` ("—").
fn room_for_course(schedule: &ScheduleData, course_id: &str) -> Option<String> {
    schedule
        .slots
        .iter()
        .find(|slot| slot.course_id.eq_ignore_ascii_case(course_id))
        .and_then(|slot| slot.room.clone())
        .filter(|room| !room.trim().is_empty())
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Stable id: v4's `{prefix}{uid}` with `@`/`/` sanitized, or — for uid-less
/// events (v4 used `{prefix}{course}-{date}`, which cannot survive a
/// course-less event) — a deterministic content hash so identical items
/// still merge across rescans.
fn assessment_id(event: &IcsEvent, origin: &IcsOrigin) -> String {
    let uid = event.uid.trim();
    if !uid.is_empty() {
        return format!("{}{}", origin.id_prefix(), uid.replace(['@', '/'], "_"));
    }
    let date_text = event
        .dtstart
        .as_ref()
        .map(|dt| dt.date.format("%Y%m%d").to_string())
        .unwrap_or_default();
    let fingerprint = format!("{}|{date_text}|{}", event.summary, event.description);
    format!(
        "{}{:016x}",
        origin.id_prefix(),
        fnv1a64(fingerprint.as_bytes())
    )
}

/// Builds one VEVENT from a block interior. First property occurrence wins
/// (v4 regex parity); malformed lines are ignored.
#[must_use]
pub fn event_from_block(block: &str) -> IcsEvent {
    let mut event = IcsEvent::default();
    for line in block.split('\n') {
        let Some((name_part, raw_value)) = split_property(line) else {
            continue;
        };
        let value = clean_ics_value(raw_value);
        match property_base(name_part).to_ascii_uppercase().as_str() {
            "UID" if event.uid.is_empty() => event.uid = value,
            "SUMMARY" if event.summary.is_empty() => event.summary = value,
            "DESCRIPTION" if event.description.is_empty() => event.description = value,
            "DTSTART" if event.dtstart.is_none() => {
                if let Some(mut parsed) = parse_ical_datetime(&value) {
                    parsed.tzid = property_param(name_part, "TZID");
                    event.dtstart = Some(parsed);
                }
            }
            "DTEND" if event.dtend.is_none() => {
                if let Some(mut parsed) = parse_ical_datetime(&value) {
                    parsed.tzid = property_param(name_part, "TZID");
                    event.dtend = Some(parsed);
                }
            }
            "URL"
                if event.url.is_none()
                    && (value.starts_with("https://") || value.starts_with("http://")) =>
            {
                event.url = Some(value);
            }
            _ => {}
        }
    }
    event
}

/// Structural parse of a whole calendar into raw events.
#[must_use]
pub fn parse_ics_events(text: &str) -> Vec<IcsEvent> {
    collect_vevent_blocks(&unfold_ics_lines(text))
        .into_iter()
        .map(|block| event_from_block(&block))
        .collect()
}

// ---------------------------------------------------------------------------
// Honest assessment construction
// ---------------------------------------------------------------------------

/// Description-line topic scraper (v4 parity + v5 honesty): bullet lines or
/// "lecture"/"chapter" lines of real length become topics; anything else
/// falls back to generic-but-true guidance, never hardcoded course topics
/// like v4's BJT/MOSFET bedroom lists.
pub(crate) fn extract_ics_topics(description: &str, summary: &str) -> Vec<String> {
    let mut topics: Vec<String> = Vec::new();
    for raw in description.split('\n') {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let lowered = line.to_ascii_lowercase();
        let is_bullet = line.starts_with(['•', '-', '*']);
        let is_keyword = lowered.contains("lecture") || lowered.contains("chapter");
        if !(is_bullet || is_keyword) {
            continue;
        }
        let cleaned = line
            .trim_start_matches(['•', '-', '*', ' '])
            .trim()
            .to_string();
        if cleaned.chars().count() > 3 {
            topics.push(cleaned);
        }
        if topics.len() >= MAX_ICS_TOPICS {
            break;
        }
    }
    if topics.is_empty() {
        return vec![
            format!("Review all materials for \"{summary}\"."),
            "Check the course page for the announced topic list.".to_string(),
        ];
    }
    topics
}

/// Planner-shaped fallback study plan: origin-specific wording, always true,
/// and labeled as a heuristic through `ai_inference_note` (no Gemini).
fn fallback_ics_study_plan(origin: &IcsOrigin) -> (String, f32) {
    match origin {
        IcsOrigin::Moodle { .. } => (
            "Complete assigned online quizzes and revise corresponding Moodle lecture slides."
                .to_string(),
            3.0,
        ),
        IcsOrigin::Feed { .. } => (
            "Complete the assigned material in the feed and revise the corresponding course materials."
                .to_string(),
            3.0,
        ),
    }
}

/// Honest inference note: what was read from the event and how the course
/// was matched — same machine-checkable prefix as the email pipeline.
fn build_ics_note(matched: Option<(&str, &str)>, is_utc: bool) -> String {
    let mut note = match matched {
        Some((code, how)) => format!(
            "Parsed from calendar event: date/time read from DTSTART; matched to {code} by {how}."
        ),
        None => "Parsed from calendar event: date/time read from DTSTART; no course in your weekly schedule matched this event.".to_string(),
    };
    if is_utc {
        note.push_str(" UTC start converted to local time.");
    }
    note
}

/// Warnings: origin base, then event-level timed/password facts (v4 list,
/// feed-generic wording; title-template phrasing is an email-pipeline
/// concept and never fires here).
fn build_ics_warnings(context_lower: &str, origin: &IcsOrigin) -> Vec<String> {
    let mut warnings = vec![origin.base_warning()];
    if context_lower.contains("time limit") || context_lower.contains("minute") {
        warnings.push("⏱️ Timed submission on the portal.".to_string());
    }
    if context_lower.contains("password") {
        warnings.push("🔑 Requires quiz password provided in lecture.".to_string());
    }
    warnings
}

/// ICS titles are already human summaries — v4 never prepended course codes
/// here and neither does v5. An empty summary honestly degrades to the type
/// label (never v4's `GENERAL`).
fn decide_ics_title(summary: &str, assessment_type: crate::types::AssessmentType) -> String {
    if summary.trim().is_empty() {
        assessment_type.as_str().to_string()
    } else {
        summary.to_string()
    }
}

/// The full pipeline: raw ICS text → (assessments, honest stats).
/// * keyword filter keeps only assessment-looking events (v4 parity),
/// * no-DTSTART events are skipped (no date, no invention),
/// * within one file, duplicates collapse first-wins via the shared
///   [`merge_key`] — cross-scan merge/refresh is the planner's job (phase 03).
///
/// Ordering is NOT normalized: the planner owns radar order.
#[must_use]
pub fn parse_ics_assessments(
    ics_text: &str,
    schedule: &ScheduleData,
    origin: &IcsOrigin,
    ref_date: NaiveDate,
    local: FixedOffset,
) -> (Vec<Assessment>, ScanStats) {
    let mut stats = ScanStats::default();
    let events = parse_ics_events(ics_text);
    stats.scanned = events.len();

    let mut assessments: Vec<Assessment> = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();
    for event in events {
        if !is_ics_candidate(&event) {
            continue;
        }
        stats.candidates += 1;

        let Some(candidate) = assessment_from_event(&event, schedule, origin, ref_date, local)
        else {
            continue;
        };

        let key = merge_key(&candidate);
        if !seen_keys.insert(key) {
            stats.skipped_duplicates += 1;
            continue;
        }
        assessments.push(candidate);
        stats.parsed += 1;
    }
    (assessments, stats)
}

/// One parsed VEVENT → an honest [`Assessment`] (or `None` when it carries no
/// parseable DTSTART — a missing date is never invented). The single builder
/// shared by the ICS text pipeline *and* the `sources/` fetchers that map
/// structured items (Moodle REST events) onto this same honesty surface.
pub(crate) fn assessment_from_event(
    event: &IcsEvent,
    schedule: &ScheduleData,
    origin: &IcsOrigin,
    ref_date: NaiveDate,
    local: FixedOffset,
) -> Option<Assessment> {
    let context_lower = event_context(event);
    let summary_lower = event.summary.to_ascii_lowercase();

    let dtstart = event.dtstart.as_ref()?;

    // UTC values convert through the caller's offset; TZID stays a wall
    // clock (recorded in `tzid`, not resolved — core is tzdb-free).
    let (date, time, is_utc) = match (dtstart.time, dtstart.is_utc) {
        (Some(elapsed), true) => {
            let naive = NaiveDateTime::new(dtstart.date, elapsed);
            let converted = naive.and_utc().with_timezone(&local);
            let wall =
                NaiveTime::from_hms_opt(converted.hour(), converted.minute(), 0).unwrap_or(elapsed);
            (converted.date_naive(), Some(wall), true)
        }
        (elapsed, utc_flag) => (dtstart.date, elapsed, utc_flag),
    };

    let match_found = match_course_with_how(schedule, &context_lower);
    let course = match_found.map(|(found, _)| found);
    let course_id = course.map(|c| c.id.clone());
    let course_name = course.map(|c| c.name.clone());

    // End time only when DTEND carries its own clock — v4 invented +90min
    // (and default "10:30" for date-only events); both deleted per `03`.
    let end_time = event.dtend.as_ref().and_then(|end| end.time);
    let room = course_id
        .as_deref()
        .and_then(|id| room_for_course(schedule, id));

    let assessment_type = classify_ics_text(&summary_lower, "");
    let topics = extract_ics_topics(&event.description, &event.summary);
    let (plan, hours) = fallback_ics_study_plan(origin);

    let days_i64 = days_until(Some(date), ref_date).map(i64::from);
    let days_until_i32 = days_i64.map(|days| i32::try_from(days).unwrap_or(i32::MAX));

    Some(Assessment {
        id: assessment_id(event, origin),
        course_id,
        course_name,
        title: decide_ics_title(&event.summary, assessment_type),
        assessment_type,
        date: Some(date),
        day_name: day_name_for(Some(date)),
        start_time: time,
        end_time,
        display_time: Some(build_display_time(date, time, end_time)),
        room,
        group: None,      // v4's "All Sections" fabrication is gone
        instructor: None, // v4's "Course Faculty" fabrication is gone
        is_upcoming: days_i64.map(|days| days >= 0).unwrap_or(true),
        days_until: days_until_i32,
        urgency_level: urgency_for(days_i64),
        priority_score: compute_priority_score(days_i64, assessment_type, topics.len()),
        topics,
        warnings: build_ics_warnings(&context_lower, origin),
        ai_inference_note: Some(build_ics_note(
            match_found.map(|found| (found.0.id.as_str(), found.1)),
            is_utc,
        )),
        ai_study_plan: Some(plan),
        estimated_study_hours: Some(hours),
        elearning_url: event
            .url
            .clone()
            .filter(|link| link.starts_with("https://") || link.starts_with("http://"))
            .or_else(|| {
                // A generic feed honestly falls back to nothing: only its
                // own URL property can name an event page. Moodle keeps
                // the portal upcoming-view fallback.
                if matches!(origin, IcsOrigin::Moodle { .. }) {
                    origin.fallback_url()
                } else {
                    None
                }
            }),
        google_cal_url: None,
        gcal_synced: false,
        gcal_event_id: None,
        color: course.map(|c| c.color.clone()),
        bg: course.and_then(|c| c.bg.clone()),
        border: course.and_then(|c| c.border.clone()),
        semester: Some(infer_semester_from_date(date)),
        email_subject: None,   // no fabricated "Moodle Calendar Event" header
        email_sent_date: None, // calendar events carry no sent date
        source: origin.source(),
        source_icon: Some(origin.source().as_icon().to_string()),
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
    })
}

// ---------------------------------------------------------------------------
// Feed URL validation (pure core half of the later `sources/` fetch layer)
// ---------------------------------------------------------------------------

/// A feed URL usually embeds a personal access token, so it must never be
/// fetched over plaintext HTTP. Ported verbatim from v4 `feeds.rs`.
pub fn validate_feed_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Feed URL is empty.".to_string());
    }
    if trimmed.to_ascii_lowercase().starts_with("http://") {
        return Err(
            "Feed URL must use HTTPS (http:// would send any access token embedded in the link in the clear). Re-copy the link starting with https://."
                .to_string(),
        );
    }
    if !trimmed.to_ascii_lowercase().starts_with("https://") {
        return Err("Feed URL must be an https:// link to an .ics calendar file.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::types::{AssessmentType, ScheduleSlot, UrgencyLevel};
    use chrono::NaiveTime;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }
    fn time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }
    fn slot(
        id: &str,
        course: &str,
        slot_type: &str,
        day: &str,
        day_index: u8,
        room: &str,
    ) -> ScheduleSlot {
        ScheduleSlot {
            id: id.to_string(),
            day: day.to_string(),
            day_index,
            course_id: course.to_string(),
            course_name: format!("{course} Course"),
            slot_type: slot_type.to_string(),
            group: Some("Group 1".to_string()),
            room: Some(room.to_string()),
            start_time: time(9, 0),
            end_time: time(10, 30),
            display_time: "9:00 AM – 10:30 AM".to_string(),
            has_quiz: false,
            quiz_title: None,
        }
    }
    fn schedule() -> ScheduleData {
        ScheduleData {
            semester: None,
            courses: vec![
                Course {
                    id: "CS101".to_string(),
                    name: "Intro to Computer Science".to_string(),
                    color: "#ef4444".to_string(),
                    bg: None,
                    border: None,
                },
                Course {
                    id: "MATH201".to_string(),
                    name: "Calculus II".to_string(),
                    color: "#0ea5e9".to_string(),
                    bg: None,
                    border: None,
                },
            ],
            slots: vec![slot("slot-1", "CS101", "Lecture", "Sun", 0, "Room CT S1 9")],
        }
    }

    const CALENDAR: &str = "BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
BEGIN:VEVENT\r\n\
UID:quiz123@moodle.univ.edu\r\n\
SUMMARY:CS101 Quiz 1\\, Chapter 1-2\r\n\
DESCRIPTION:Instructions:\\n• Lecture 1 - Basics\\n- Chapter 2 - Functions\\nNote: 30 minute time limit\\, password required\r\n\
DTSTART:20261018T100000Z\r\n\
DTEND:20261018T120000Z\r\n\
URL:https://e-learning.univ.edu/mod/quiz/view.php?id=55\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:midterm@moodle.univ.edu\r\n\
SUMMARY:Calculus II Midterm Exam\r\n\
DESCRIPTION:Hall 2\\; bring your student card\r\n\
DTSTART;TZID=Asia/Cairo:20261019T080000\r\n\
DTEND;TZID=Asia/Cairo:20261019T100000\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:lecture@x\r\n\
SUMMARY:CS101 Lecture Intro\r\n\
DESCRIPTION:Syllabus overview\r\n\
DTSTART:20261020T090000\r\n\
END:VEVENT\r\n\
END:VCALENDAR";

    #[test]
    fn parses_datetime_shapes() {
        let utc = parse_ical_datetime("20261018T100000Z").unwrap();
        assert_eq!(utc.date, date(2026, 10, 18));
        assert_eq!(utc.time, Some(time(10, 0)));
        assert!(utc.is_utc);

        let local = parse_ical_datetime("20261019T080000").unwrap();
        assert_eq!(local.date, date(2026, 10, 19));
        assert_eq!(local.time, Some(time(8, 0)));
        assert!(!local.is_utc);

        let date_only = parse_ical_datetime("20261018").unwrap();
        assert_eq!(date_only.date, date(2026, 10, 18));
        assert_eq!(
            date_only.time, None,
            "date-only keeps time None — no 09:00 default"
        );

        let dashed = parse_ical_datetime("2026-10-21T14:30:00").unwrap();
        assert_eq!(dashed.date, date(2026, 10, 21));
        assert_eq!(dashed.time, Some(time(14, 30)));

        let bad_month = parse_ical_datetime("20261310");
        assert!(
            bad_month.is_none(),
            "month 13 is not a calendar date — no invented date from garbage"
        );
        assert!(parse_ical_datetime("").is_none());
        assert!(parse_ical_datetime("13:45-pm-not-a-date").is_none());
    }

    #[test]
    fn unfolds_folding_lines() {
        let ics =
            "BEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Quiz 1\r\n WEEK\r\nDESCRIPTION:x\r\nEND:VEVENT";
        let events = parse_ics_events(ics);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary, "Quiz 1WEEK");
        assert_eq!(events[0].description, "x");
        assert_eq!(events[0].uid, "abc");
    }

    #[test]
    fn unescapes_text_one_pass() {
        let events = parse_ics_events(
            "BEGIN:VEVENT\nUID:u\nSUMMARY:Quiz\\, Chapter 1\\; N\nDESCRIPTION:a\\nb\\\\c\nEND:VEVENT",
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary, "Quiz, Chapter 1; N");
        assert_eq!(events[0].description, "a\nb\\c");
    }

    #[test]
    fn skips_valarm_blocks() {
        let ics = "BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:CS101 Quiz 1\r\nDTSTART:20261018T100000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT";
        let events = parse_ics_events(ics);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary, "CS101 Quiz 1");
        assert!(events[0].description.is_empty());
    }

    #[test]
    fn course_matched_by_id_with_room_and_colors() {
        let (items, stats) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Moodle {
                portal_url: Some("https://moodle.univ.edu".to_string()),
            },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(stats.scanned, 3);
        assert_eq!(stats.candidates, 2);
        assert_eq!(stats.parsed, 2);
        assert_eq!(stats.skipped_duplicates, 0);

        let quiz = &items[0];
        assert_eq!(quiz.id, "moodle-quiz123_moodle.univ.edu");
        assert_eq!(quiz.course_id.as_deref(), Some("CS101"));
        assert_eq!(
            quiz.course_name.as_deref(),
            Some("Intro to Computer Science")
        );
        assert_eq!(quiz.title, "CS101 Quiz 1, Chapter 1-2");
        assert_eq!(
            quiz.assessment_type,
            AssessmentType::OnlineQuiz,
            "v4 ICS ladder: portal-synced events default to Online Quiz (no class/online signal)"
        );
        assert_eq!(quiz.date, Some(date(2026, 10, 18)));
        assert_eq!(quiz.start_time, Some(time(10, 0)));
        assert_eq!(quiz.end_time, Some(time(12, 0)));
        assert_eq!(quiz.room.as_deref(), Some("Room CT S1 9"));
        assert_eq!(quiz.source, AssessmentSource::Moodle);
        assert_eq!(quiz.color.as_deref(), Some("#ef4444"));
        assert_eq!(quiz.day_name.as_deref(), Some("Sunday"));
        assert_eq!(
            quiz.elearning_url.as_deref(),
            Some("https://e-learning.univ.edu/mod/quiz/view.php?id=55")
        );
        let note = quiz.ai_inference_note.as_deref().unwrap_or_default();
        assert!(note.starts_with("Parsed from calendar event:"));
        assert!(note.contains("matched to CS101 by id-matching"));
        assert!(note.contains("UTC start converted to local time."));
    }

    #[test]
    fn midterm_matches_by_name_without_invented_details() {
        let (items, _) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        let midterm = &items[1];
        assert_eq!(midterm.assessment_type, AssessmentType::MidtermExam);
        assert_eq!(midterm.course_id.as_deref(), Some("MATH201"));
        assert_eq!(midterm.title, "Calculus II Midterm Exam");
        assert_eq!(midterm.date, Some(date(2026, 10, 19)));
        assert_eq!(midterm.start_time, Some(time(8, 0)));
        assert_eq!(midterm.end_time, Some(time(10, 0)));
        assert_eq!(midterm.room, None, "no MATH201 slot ⇒ no invented room");
        assert_eq!(midterm.group, None, "no All Sections fabrication");
        assert_eq!(midterm.instructor, None, "no Course Faculty fabrication");
        assert_eq!(
            midterm.elearning_url, None,
            "no portal configured ⇒ honest None (moodle.org hero-link gone)"
        );
        let note = midterm.ai_inference_note.as_deref().unwrap_or_default();
        assert!(note.contains("matched to MATH201 by name-matching"));
        assert!(!note.contains("UTC"), "TZID is wall time — no conversion");
    }

    #[test]
    fn lecture_event_is_filtered() {
        let (items, stats) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(items.len(), 2);
        assert_eq!(stats.candidates, 2, "CS101 Lecture Intro is filtered out");
    }

    #[test]
    fn type_ladder_on_summaries() {
        let classify = |summary: &str| classify_ics_text(&summary.to_ascii_lowercase(), "");
        assert_eq!(classify("Quiz 1"), AssessmentType::OnlineQuiz);
        assert_eq!(
            classify("Midterm Review Session"),
            AssessmentType::MidtermExam
        );
        assert_eq!(classify("Final Exam Review"), AssessmentType::FinalExam);
        assert_eq!(
            classify("Lab Experiment Setup"),
            AssessmentType::LabAssessment
        );
        assert_eq!(classify("Assignment 2"), AssessmentType::Assignment);
    }

    #[test]
    fn date_only_and_missing_dtstart_render_honestly() {
        let ics =
            "BEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:CS101 Quiz 2\r\nDTSTART:20261018\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:u2\r\nSUMMARY:CS101 Quiz 3\r\nDTSTART:20261018T140000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:u3\r\nSUMMARY:CS101 Assignment 1\r\nDTEND:20261018T160000Z\r\nEND:VEVENT";
        let (items, stats) = parse_ics_assessments(
            ics,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(stats.candidates, 3);
        assert_eq!(stats.parsed, 2, "no DTSTART ⇒ skipped (no invented date)");
        let u1 = items.iter().find(|i| i.id == "moodle-u1").unwrap();
        assert_eq!(u1.start_time, None);
        assert_eq!(u1.end_time, None);
        assert_eq!(u1.days_until, Some(1));
        assert!(u1.is_upcoming);
        assert_eq!(u1.display_time.as_deref(), Some("Sunday, 18 October 2026"));
        let u2 = items.iter().find(|i| i.id == "moodle-u2").unwrap();
        assert_eq!(u2.start_time, Some(time(14, 0)));
        assert_eq!(u2.end_time, None, "no invented +90min end");
        assert_eq!(u2.end_time, None);
    }

    #[test]
    fn blank_summary_uses_type_label() {
        let ics = "BEGIN:VEVENT\r\nUID:u\r\nSUMMARY: \r\nDESCRIPTION:quiz\r\nDTSTART:20261018T100000\r\nEND:VEVENT";
        let (items, _) = parse_ics_assessments(
            ics,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Online Quiz");
    }

    #[test]
    fn spaced_course_code_matches_via_scanner() {
        let ics = "BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:Spaced CSE241 Quiz 1\r\nDTSTART:20261018T100000\r\nEND:VEVENT";
        let (items, _) = parse_ics_assessments(
            ics,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].course_id, None,
            "CSE241 is not enrolled — stays course-less"
        );
    }

    #[test]
    fn feed_origin_rebrands_and_keeps_its_own_link_only() {
        let (items, _) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Feed {
                name: "University Timetable".to_string(),
                feed_url: Some("https://uni.edu/timetable.ics".to_string()),
            },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        let quiz = &items[0];
        assert_eq!(quiz.id, "feed-quiz123_moodle.univ.edu");
        assert_eq!(
            quiz.source,
            AssessmentSource::Feed("University Timetable".to_string())
        );
        assert_eq!(quiz.source_icon.as_deref(), Some("calendar"));
        assert_eq!(
            quiz.elearning_url.as_deref(),
            Some("https://e-learning.univ.edu/mod/quiz/view.php?id=55")
        );
        assert_eq!(
            quiz.warnings[0],
            "📅 Synced from your subscribed calendar feed \"University Timetable\"."
        );
        let midterm = &items[1];
        assert_eq!(
            midterm.elearning_url, None,
            "feed events without URLs get no portal link"
        );
        let note = midterm.ai_inference_note.as_deref().unwrap_or_default();
        assert!(
            !note.contains("UTC"),
            "TZID is wall time — no UTC conversion"
        );
        assert!(note.contains("matched to MATH201 by name-matching"));
    }

    #[test]
    fn timed_and_password_warnings_fire_per_event() {
        let (items, _) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Moodle {
                portal_url: Some("https://moodle.univ.edu".to_string()),
            },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        let quiz = &items[0];
        assert_eq!(quiz.warnings.len(), 3);
        assert!(quiz
            .warnings
            .iter()
            .any(|w| w == "⏱️ Timed submission on the portal."));
        assert!(quiz
            .warnings
            .iter()
            .any(|w| w == "🔑 Requires quiz password provided in lecture."));
        let midterm = &items[1];
        assert_eq!(
            midterm.warnings.len(),
            1,
            "plain exam text gets only the base warning"
        );
    }

    #[test]
    fn portal_link_fallback_only_when_configured() {
        let ics = "BEGIN:VEVENT\r\nUID:nolink\r\nSUMMARY:CS101 Quiz 1\r\nDTSTART:20261018T100000\r\nEND:VEVENT";
        let (with_portal, _) = parse_ics_assessments(
            ics,
            &schedule(),
            &IcsOrigin::Moodle {
                portal_url: Some("https://moodle.univ.edu/".to_string()),
            },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(
            with_portal[0].elearning_url.as_deref(),
            Some("https://moodle.univ.edu/calendar/view.php?view=upcoming")
        );
        let (without_portal, _) = parse_ics_assessments(
            ics,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(without_portal[0].elearning_url, None);
    }

    #[test]
    fn uidless_events_hash_ids_and_collapse_duplicates() {
        let ics = "BEGIN:VEVENT\r\nUID:@dup/\r\nSUMMARY:CS101 Quiz 1\r\nDTSTART:20261018T100000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nSUMMARY:CS101 Quiz 1\r\nDTSTART:20261018T100000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nSUMMARY:CS101 Quiz 2\r\nDTSTART:20261019T100000Z\r\nEND:VEVENT";
        let (items, stats) = parse_ics_assessments(
            ics,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(items.len(), 2);
        assert_eq!(stats.parsed, 2);
        assert_eq!(
            stats.skipped_duplicates, 1,
            "same source/course/title/date collapses first-wins"
        );
        assert_eq!(
            items[0].id, "moodle-_dup_",
            "uid id keeps v4 sanitization shape"
        );
        assert_eq!(
            items[1].id.len(),
            "moodle-".len() + 16,
            "uid-less id is a content hash"
        );
        assert_eq!(items[0].course_id.as_deref(), Some("CS101"));
    }

    #[test]
    fn topics_from_bullets_and_keywords() {
        let events = parse_ics_events(CALENDAR);
        let topics = extract_ics_topics(&events[0].description, "CS101 Quiz 1");
        assert_eq!(
            topics,
            vec![
                "Lecture 1 - Basics".to_string(),
                "Chapter 2 - Functions".to_string()
            ]
        );
        let none = extract_ics_topics("Plain prose without markers.", "CS101 Quiz 2");
        assert_eq!(none.len(), 2);
        assert_eq!(none[0], "Review all materials for \"CS101 Quiz 2\".");
        assert_eq!(
            none[1],
            "Check the course page for the announced topic list."
        );
    }

    #[test]
    fn past_items_render_as_past() {
        let (items, _) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 20),
            FixedOffset::east_opt(0).unwrap(),
        );
        let quiz = &items[0];
        assert!(!quiz.is_upcoming);
        assert_eq!(quiz.days_until, Some(-2));
        assert_eq!(quiz.urgency_level, UrgencyLevel::Past);
        assert_eq!(quiz.priority_score, 10);
    }

    #[test]
    fn study_hours_are_labeled_heuristic() {
        let (items, _) = parse_ics_assessments(
            CALENDAR,
            &schedule(),
            &IcsOrigin::Moodle { portal_url: None },
            date(2026, 10, 17),
            FixedOffset::east_opt(0).unwrap(),
        );
        assert_eq!(items[0].estimated_study_hours, Some(3.0));
        let plan = items[0].ai_study_plan.as_deref().unwrap_or_default();
        assert!(
            plan.contains("Moodle lecture slides"),
            "Moodle-origin plan wording"
        );
        let (feed_plan, feed_hours) = fallback_ics_study_plan(&IcsOrigin::Feed {
            name: "F".to_string(),
            feed_url: None,
        });
        assert_eq!(feed_hours, 3.0);
        assert!(feed_plan.contains("feed"));
    }

    #[test]
    fn feed_url_validation() {
        assert!(validate_feed_url("https://uni.edu/timetable.ics").is_ok());
        assert!(validate_feed_url("HTTPS://UNI.EDU/FEED.ICS").is_ok());
        assert!(validate_feed_url("  https://uni.edu/t?token=abc  ").is_ok());

        assert!(validate_feed_url("").is_err());
        assert!(validate_feed_url("   ").is_err());
        assert!(validate_feed_url("http://uni.edu/timetable.ics").is_err());
        assert!(validate_feed_url("ftp://uni.edu/timetable.ics").is_err());
        assert!(validate_feed_url("uni.edu/timetable.ics").is_err());
        assert!(validate_feed_url("https:/uni.edu/typo.ics").is_err());
    }

    #[test]
    fn fnv1a64_matches_reference_vectors() {
        // cpython test vectors for FNV-1a 64-bit.
        assert_eq!(fnv1a64(b""), 0xcbf29ce484222325);
        assert_eq!(fnv1a64(b"a"), 0xaf63dc4c8601ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x85944171f73967e8);
    }
}
