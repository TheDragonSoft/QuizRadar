//! Announcement → assessment pipeline (Gmail/Teams/Outlook/Classroom text
//! bodies), ported from the v4 Rust parser (`v4-final:src/parser.rs`) and
//! merged with the v4 JS engine parity port. Rule provenance is documented
//! per function; everything `docs/rebuild/03` marks deleted is NOT ported:
//! demo course tables, hardcoded topic keyword lists, default palettes,
//! `"Room unspecified"` / `"All Groups"` / `"09:00"` any-time defaults,
//! `+90`-minute fabricated end times, host-specific `(via …)` injections,
//! per-email-id branches and the global template-notice spread.
//!
//! Honesty invariants (tested):
//! - a date is produced only from an explicit date or a week phrase;
//!   anything unverifiable stays `None` with a "needs manual confirmation"
//!   note — the v4 "sent date ⇒ today" fallback is gone,
//! - times/rooms come only from the student's own timetable slot that
//!   actually matches the resolved date's weekday; unknown → `None` (UI
//!   renders "—", never a default room string),
//! - explicit dates are never moved (maintainer decision; v4 snapped them
//!   to a slot weekday), relative dates snap forward to the nearest
//!   candidate slot weekday (v4 Rust behavior, ported),
//! - no course code at all ⇒ `course_id: None`; a scanned-but-unenrolled
//!   code keeps `course_id: Some(code)` with `course_name: None` and no
//!   fabricated palette.

use std::collections::HashSet;

use chrono::{Datelike, Duration, NaiveDate};

use crate::parse::merge::merge_key;
use crate::parse::util::{
    build_display_time, compute_priority_score, day_name_for, format_12h, infer_semester_from_date,
    urgency_for, weekday_index, weekday_to_index,
};
use crate::types::{
    Assessment, AssessmentSource, AssessmentType, CachedEmail, ScheduleData, ScheduleSlot,
};

/// v4 forwarded-announcement separator (69 dashes) professors use to quote
/// the original notice.
pub const EMAIL_SEPARATOR: &str =
    "---------------------------------------------------------------------";

/// Sanity cap on numbered topic candidates so a pathological announcement
/// cannot explode the topic-key space (v4 had no cap).
const MAX_TOPICS: usize = 32;

// ---------------------------------------------------------------------------
// Honest scan bookkeeping
// ---------------------------------------------------------------------------

/// What actually ran in a scan — a shell displays this; nothing fabricates a
/// success summary when sources failed or found nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ScanStats {
    pub scanned: usize,
    pub candidates: usize,
    pub parsed: usize,
    pub skipped_duplicates: usize,
}

// ---------------------------------------------------------------------------
// Low-level char scanners (patterns are ASCII; text may be any UTF-8)
// ---------------------------------------------------------------------------

/// ASCII-case-insensitive prefix test over pre-lowered chars.
fn char_text_starts(chars_lower: &[char], at: usize, needle: &str) -> bool {
    let needle: Vec<char> = needle.chars().collect();
    if at + needle.len() > chars_lower.len() {
        return false;
    }
    needle
        .iter()
        .enumerate()
        .all(|(k, expected)| chars_lower[at + k].to_ascii_lowercase() == *expected)
}

fn find_char(chars: &[char], from: usize, target: char) -> Option<usize> {
    (from..chars.len()).find(|&p| chars[p] == target)
}

/// ASCII-case-insensitive substring search over pre-lowered chars.
fn find_char_text(chars_lower: &[char], from: usize, needle: &str) -> Option<usize> {
    let needle: Vec<char> = needle.chars().collect();
    if needle.len() > chars_lower.len() {
        return None;
    }
    (from..=chars_lower.len() - needle.len())
        .find(|&p| chars_lower[p..p + needle.len()] == needle[..])
}

/// Regex `\b` word character (unicode letters/digits, plus underscore).
fn char_is_word(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

/// Length of the ASCII digit run starting at `at`.
fn digit_run_len(chars: &[char], at: usize) -> usize {
    let mut n = 0;
    while at + n < chars.len() && chars[at + n].is_ascii_digit() {
        n += 1;
    }
    n
}

/// Parses `count` ASCII digits starting at `at` as `u32`.
fn first_digits(chars: &[char], at: usize, count: usize) -> Option<u32> {
    let mut value = 0u32;
    for k in 0..count {
        let ch = *chars.get(at + k)?;
        value = value.checked_mul(10)?.checked_add(ch.to_digit(10)?)?;
    }
    Some(value)
}

// ---------------------------------------------------------------------------
// HTML → plain text (port of the v4 engine's `stripHtmlTags`)
// ---------------------------------------------------------------------------

/// True when a body carries HTML markup (Gmail HTML parts); callers run the
/// body through [`strip_html_tags`] before parsing.
#[must_use]
pub fn looks_like_html(body: &str) -> bool {
    let lower: Vec<char> = body.chars().map(|c| c.to_ascii_lowercase()).collect();
    ["<p", "<br", "<div", "<html", "<table"]
        .iter()
        .any(|tag| find_char_text(&lower, 0, tag).is_some())
}

/// HTML → plain text: style/script blocks dropped when properly closed
/// (unclosed blocks fall through to the generic tag stripper, regex parity),
/// `<br>` and closing block tags become line breaks, generic tags removed,
/// entities decoded in a single pass (fixes v4's `&amp;lt;` double decode),
/// space runs collapsed, 3+ newlines folded to two. Idempotent on plain text.
#[must_use]
pub fn strip_html_tags(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_ascii_lowercase()).collect();
    let len = chars.len();
    let mut prose = String::new();
    let mut i = 0;

    while i < len {
        if chars[i] == '<' {
            // Style/script blocks are removed only when properly closed —
            // otherwise the v4 generic `<[^>]+>` stripper handled them, so we
            // fall through to exactly that.
            // (Phase-05 fix: the old `lower[i+1] == 's'` discriminator matched
            // BOTH `<style` and `<script`, so script blocks with content were
            // never removed — the shipped test only passed because its script
            // body was empty.)
            let is_style = char_text_starts(&lower, i, "<style");
            let is_script = char_text_starts(&lower, i, "<script");
            if is_style || is_script {
                let (tag_len, close_marker) = if is_style {
                    (6, "</style>")
                } else {
                    (7, "</script>")
                };
                if let Some(close_at) = find_char_text(&lower, i + tag_len, close_marker) {
                    i = close_at + close_marker.len();
                    continue;
                }
            }
            // `<br\s*/?>` → line break (whitespace variation tolerated).
            if char_text_starts(&lower, i, "<br") {
                let mut j = i + 3;
                while j < len && chars[j].is_whitespace() {
                    j += 1;
                }
                let mut k = j;
                if k < len && chars[k] == '/' {
                    k += 1;
                }
                if k < len && chars[k] == '>' {
                    prose.push('\n');
                    i = k + 1;
                    continue;
                }
                // Malformed br stays fall-through to the generic stripper.
            }
            // Block tags — opening or closing — separate prose lines.
            // Outlook mails ship unclosed `<td>`/`<tr>` cells; without this,
            // "New Date: …" and "Previous Date: …" ran together into one
            // word-soup title. Inline tags (`<b>`, `<span>`, …) stay silent.
            let is_block_name = |name: &str| -> bool {
                matches!(
                    name,
                    "p" | "div" | "tr" | "td" | "th" | "li" | "table" | "blockquote" | "ul" | "ol"
                ) || (name.len() == 2
                    && name.starts_with('h')
                    && matches!(name.chars().nth(1), Some('1'..='6')))
            };
            if i + 1 < len && (chars[i + 1] == '/' || chars[i + 1].is_ascii_alphabetic()) {
                let mut j = i + 1;
                if chars[j] == '/' {
                    j += 1;
                }
                let mut name = String::new();
                while j < len && chars[j].is_ascii_alphabetic() {
                    name.push(chars[j].to_ascii_lowercase());
                    j += 1;
                }
                if is_block_name(&name) && j < len && (chars[j] == '>' || chars[j].is_whitespace())
                {
                    // Skip through the tag's closing `>` (opening tags may
                    // carry attributes).
                    if let Some(gt) = find_char(&chars, j, '>') {
                        prose.push('\n');
                        i = gt + 1;
                        continue;
                    }
                }
            }
            // Generic tag: skip through its closing '>'.
            match find_char(&chars, i, '>') {
                Some(gt) => {
                    i = gt + 1;
                }
                None => {
                    prose.push('<');
                    i += 1;
                }
            }
            continue;
        }
        prose.push(chars[i]);
        i += 1;
    }

    let decoded = decode_entities(&prose);
    normalize_whitespace(&decoded)
}

const ENTITIES: [(&str, &str); 7] = [
    ("&nbsp;", " "),
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&amp;", "&"),
    ("&quot;", "\""),
    ("&#39;", "'"),
    ("&apos;", "'"),
];

/// Single-pass HTML entity decode — the v4 engine decoded twice, corrupting
/// text like `&amp;lt;` into `<`; the honest output is `&`.
fn decode_entities(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_ascii_lowercase()).collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '&' {
            let mut matched = None;
            for (needle, replacement) in ENTITIES {
                if char_text_starts(&lower, i, needle) {
                    matched = Some((needle, replacement));
                    break;
                }
            }
            if let Some((needle, replacement)) = matched {
                out.push_str(replacement);
                i += needle.chars().count();
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// `space/tab` runs → one space, then `3+` newlines → two, then trim
/// (the v4 replace chain, applied in the same order).
fn normalize_whitespace(text: &str) -> String {
    let mut spaced = String::with_capacity(text.len());
    let mut in_space = false;
    for ch in text.chars() {
        if ch == ' ' || ch == '\t' {
            if !in_space {
                spaced.push(' ');
                in_space = true;
            }
        } else {
            in_space = false;
            spaced.push(ch);
        }
    }
    let mut out = String::with_capacity(spaced.len());
    let mut newline_run = 0usize;
    for ch in spaced.chars() {
        if ch == '\n' {
            newline_run += 1;
            if newline_run > 2 {
                continue;
            }
        } else {
            newline_run = 0;
        }
        out.push(ch);
    }
    out.trim().to_string()
}

/// Body content between the first separator pair (a forwarded announcement);
/// otherwise the whole body (v4 `extract_announcement_body`, ported as-is).
#[must_use]
pub fn extract_announcement_body(body: &str) -> &str {
    if let Some(start) = body.find(EMAIL_SEPARATOR) {
        let after = &body[start + EMAIL_SEPARATOR.len()..];
        if let Some(end) = after.find(EMAIL_SEPARATOR) {
            return &after[..end];
        }
        return after;
    }
    body
}

// ---------------------------------------------------------------------------
// Date scanners
// ---------------------------------------------------------------------------

/// Month names for the explicit-date scanner: full names first (v4 `RE_DMY`
/// alternation order), then 3-letter abbreviations (`prompts/p02` includes
/// `d Mon YYYY` in the ladder; v4 knew only full names — documented
/// divergence).
const MONTHS: [&str; 24] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
];

/// Index of `"jan"` inside [`MONTHS`].
const MONTH_ABBREV_START: usize = 12;

fn month_number_from_index(idx: usize) -> u32 {
    let base = if idx >= MONTH_ABBREV_START {
        idx - MONTH_ABBREV_START
    } else {
        idx
    };
    (base + 1) as u32
}

/// 3-letter month abbreviation (case-insensitive) → 1..=12.
fn lookup_month_abbrev(chars: &[char], at: usize) -> Option<u32> {
    let mut name = String::with_capacity(3);
    for k in 0..3 {
        name.push(*chars.get(at + k)?);
    }
    let lowered = name.to_ascii_lowercase();
    let idx = MONTHS
        .iter()
        .skip(MONTH_ABBREV_START)
        .position(|candidate| *candidate == lowered)?;
    Some((idx + 1) as u32)
}

/// Scanner for `(?i)\b(\d{1,2})\s+(january|…|december)\s+(\d{4})\b`.
/// v4 semantic ported exactly: the FIRST structurally complete match decides;
/// an invalid calendar date (e.g. `31 February 2026`) reports
/// `Some(None)` so the numeric form gets no second chance downstream.
fn find_month_named_date(text: &str) -> Option<Option<NaiveDate>> {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_ascii_lowercase()).collect();
    let len = chars.len();

    for i in 0..len {
        if !chars[i].is_ascii_digit() {
            continue;
        }
        if i > 0 && char_is_word(chars[i - 1]) {
            continue; // `\b` before the day digits
        }
        let run = digit_run_len(&chars, i);
        let max_day_len = run.min(2); // `\d{1,2}` greedy
        let mut decided: Option<Option<NaiveDate>> = None;

        for day_off in 0..max_day_len {
            let day_len = max_day_len - day_off;
            let mut ws1 = 0usize;
            while i + day_len + ws1 < len && chars[i + day_len + ws1].is_whitespace() {
                ws1 += 1;
            }
            if ws1 == 0 {
                continue;
            }
            let month_at = i + day_len + ws1;
            for (month_idx, name) in MONTHS.iter().copied().enumerate() {
                if !char_text_starts(&lower, month_at, name) {
                    continue;
                }
                let tail = month_at + name.chars().count();
                let mut ws2 = 0usize;
                while tail + ws2 < len && chars[tail + ws2].is_whitespace() {
                    ws2 += 1;
                }
                if ws2 == 0 {
                    continue;
                }
                let year_at = tail + ws2;
                if digit_run_len(&chars, year_at) != 4 {
                    continue; // `\d{4}\b`: a 5th digit breaks the boundary
                }
                let year_end = year_at + 4;
                if year_end < len && char_is_word(chars[year_end]) {
                    continue;
                }
                let day = match first_digits(&chars, i, day_len) {
                    Some(value) => value,
                    None => continue,
                };
                let year = match first_digits(&chars, year_at, 4) {
                    Some(value) => value,
                    None => continue,
                };
                decided = Some(NaiveDate::from_ymd_opt(
                    year as i32,
                    month_number_from_index(month_idx),
                    day,
                ));
                break;
            }
            if decided.is_some() {
                break;
            }
        }
        if let Some(decision) = decided {
            return Some(decision);
        }
    }
    None
}

/// Scanner for `\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b` with the same
/// leftmost-complete-match semantics as [`find_month_named_date`] (an
/// invalid calendar date aborts further numeric scanning, v4 parity).
fn find_numeric_date(text: &str) -> Option<NaiveDate> {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    for i in 0..len {
        if !chars[i].is_ascii_digit() {
            continue;
        }
        if i > 0 && char_is_word(chars[i - 1]) {
            continue;
        }
        let day_run = digit_run_len(&chars, i);
        let max_day_len = day_run.min(2);
        let mut decided: Option<Option<NaiveDate>> = None;

        for day_off in 0..max_day_len {
            let day_len = max_day_len - day_off;
            let day_end = i + day_len;
            if day_end >= len || (chars[day_end] != '-' && chars[day_end] != '/') {
                continue;
            }
            let month_start = day_end + 1;
            if month_start >= len || !chars[month_start].is_ascii_digit() {
                continue;
            }
            let max_month_len = digit_run_len(&chars, month_start).min(2);
            for month_off in 0..max_month_len {
                let month_len = max_month_len - month_off;
                let month_end = month_start + month_len;
                if month_end >= len || (chars[month_end] != '-' && chars[month_end] != '/') {
                    continue;
                }
                let year_start = month_end + 1;
                if digit_run_len(&chars, year_start) < 4 {
                    continue;
                }
                let year_end = year_start + 4;
                if year_end < len && char_is_word(chars[year_end]) {
                    continue;
                }
                let day = match first_digits(&chars, i, day_len) {
                    Some(value) => value,
                    None => continue,
                };
                let month = match first_digits(&chars, month_start, month_len) {
                    Some(value) => value,
                    None => continue,
                };
                let year = match first_digits(&chars, year_start, 4) {
                    Some(value) => value,
                    None => continue,
                };
                decided = Some(NaiveDate::from_ymd_opt(year as i32, month, day));
                break;
            }
            if decided.is_some() {
                break;
            }
        }
        if let Some(decision) = decided {
            return decision;
        }
    }
    None
}

/// Explicit announcement date: full/abbreviated month names first, then
/// `D-M-YYYY` / `D/M/YYYY` — the numeric form only runs when NO month-name
/// pattern matched structurally (v4 parity: `31 Februrary`-style invalid
/// matches abort all scanning). Strongly trusted — explicit dates are never
/// moved or reinterpreted downstream.
#[must_use]
pub fn find_explicit_date(text: &str) -> Option<NaiveDate> {
    match find_month_named_date(text) {
        Some(decision) => decision,
        None => find_numeric_date(text),
    }
}

/// Sender date header → date, porting `(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})`
/// (no word boundaries in v4 — quirks preserved: any digit-run ≤ 2 may be
/// the day, month letters must be exactly three followed by whitespace).
/// Handles `"Sat, 10 Oct 2026 09:00:00 +0000"`. Unparseable headers yield
/// `None` — the stored `email_sent_date` stays `None`, no invented date.
#[must_use]
pub fn parse_email_sent_date(date_header: &str) -> Option<NaiveDate> {
    let chars: Vec<char> = date_header.chars().collect();
    let len = chars.len();

    for i in 0..len {
        if !chars[i].is_ascii_digit() {
            continue;
        }
        let run = digit_run_len(&chars, i);
        if run > 2 {
            continue;
        }
        for day_len in (1..=run).rev() {
            let mut ws1 = 0usize;
            while i + day_len + ws1 < len && chars[i + day_len + ws1].is_whitespace() {
                ws1 += 1;
            }
            if ws1 == 0 {
                continue;
            }
            let mon_at = i + day_len + ws1;
            let mut mon_run = 0usize;
            while mon_at + mon_run < len && chars[mon_at + mon_run].is_ascii_alphabetic() {
                mon_run += 1;
            }
            if mon_run != 3 {
                continue;
            }
            let mon_end = mon_at + 3;
            let mut ws2 = 0usize;
            while mon_end + ws2 < len && chars[mon_end + ws2].is_whitespace() {
                ws2 += 1;
            }
            if ws2 == 0 {
                continue;
            }
            let year_at = mon_end + ws2;
            if digit_run_len(&chars, year_at) < 4 {
                continue;
            }
            let day = match first_digits(&chars, i, day_len) {
                Some(value) => value,
                None => continue,
            };
            let month = match lookup_month_abbrev(&chars, mon_at) {
                Some(value) => value,
                None => continue,
            };
            let year = match first_digits(&chars, year_at, 4) {
                Some(value) => value,
                None => continue,
            };
            return NaiveDate::from_ymd_opt(year as i32, month, day);
        }
    }
    None
}

/// True when the announcement was sent within `max_age_days` of the
/// reference date (gates LIVE AI analysis only — parsing checks every
/// message regardless of age; maintainer decision). Unparseable dates make
/// this false: unknown-age mail must never count as fresh.
#[must_use]
pub fn is_email_recent(sent: NaiveDate, reference: NaiveDate, max_age_days: i64) -> bool {
    (reference - sent).num_days() <= max_age_days
}

// ---------------------------------------------------------------------------
// Course code scanner (hand port of `(?i)\b([A-Z]{2,4}\s*\d{3}[a-zA-Z]?)\b`)
// ---------------------------------------------------------------------------

/// Finds the first course-code-looking token, normalized (uppercase,
/// whitespace removed). The backtracking order is regex-exact: longest
/// letter run first, optional whitespace then three digits, optional
/// trailing letter, word boundary on both ends — with positional rescan so
/// prefixed digit runs (`"118-10-2026datethis"`) do not poison later matches.
#[must_use]
pub fn find_course_code(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    for start in 0..len {
        if !chars[start].is_ascii_alphabetic() {
            continue;
        }
        if start > 0 && char_is_word(chars[start - 1]) {
            continue; // `\b` prefix
        }
        let mut letters: Vec<char> = Vec::with_capacity(4);
        let mut j = start;
        while j < len && letters.len() < 4 && chars[j].is_ascii_alphabetic() {
            letters.push(chars[j].to_ascii_uppercase());
            j += 1;
        }
        if letters.len() < 2 {
            continue;
        }

        for take in (2..=letters.len()).rev() {
            for ws_len in 0..=1 {
                let letter_end = start + take;
                if ws_len == 1 && (letter_end >= len || !chars[letter_end].is_whitespace()) {
                    continue;
                }
                let digits_start = letter_end + ws_len;
                if digits_start + 3 > len
                    || !chars[digits_start].is_ascii_digit()
                    || !chars[digits_start + 1].is_ascii_digit()
                    || !chars[digits_start + 2].is_ascii_digit()
                {
                    continue;
                }
                for trailer in [1, 0] {
                    let digit_end = digits_start + 3;
                    let probe = digit_end + trailer;
                    if trailer == 1 && (digit_end >= len || !chars[digit_end].is_ascii_alphabetic())
                    {
                        continue;
                    }
                    if probe < len && char_is_word(chars[probe]) {
                        continue; // trailing `\b`
                    }
                    let mut code = String::with_capacity(7);
                    for letter in &letters[..take] {
                        code.push(*letter);
                    }
                    code.push(chars[digits_start]);
                    code.push(chars[digits_start + 1]);
                    code.push(chars[digits_start + 2]);
                    if trailer == 1 {
                        code.push(chars[digit_end].to_ascii_uppercase());
                    }
                    return Some(code);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Announcement wording helpers
// ---------------------------------------------------------------------------

/// Week-phrase ladder from the v4 estimates (`+8/+5/+3` days from the sent
/// date). `"next week (not this week)"` must be checked before `"next week"`
/// (v4 order).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WeekPhrase {
    ThisWeek,
    NextWeek,
    NextWeekStrict,
}

fn find_week_phrase(lower: &str) -> Option<WeekPhrase> {
    if lower.contains("next week") && lower.contains("not this week") {
        Some(WeekPhrase::NextWeekStrict)
    } else if lower.contains("next week") {
        Some(WeekPhrase::NextWeek)
    } else if lower.contains("this week") {
        Some(WeekPhrase::ThisWeek)
    } else {
        None
    }
}

/// Candidate filter, ported verbatim from v4 (`subject_lower`, `from_lower`,
/// `body_lower` all lower-cased by the caller). The literal `"lecture 1
/// slides"` reject is kept for parity and flagged in STATUS as the one
/// literal-based filter that deserves a generic pass later.
fn is_candidate_assessment_email(subject_lower: &str, from_lower: &str, body_lower: &str) -> bool {
    // Filter out the student's own outgoing replies
    if subject_lower.starts_with("re:") {
        return false;
    }

    // Filter out pure grade/result announcements unless they announce a
    // remake/makeup quiz
    if (subject_lower.contains("result")
        || subject_lower.contains("grades")
        || subject_lower.contains("marks")
        || subject_lower.contains("model answer")
        || subject_lower.contains("cancellation")
        || subject_lower.contains("appeal")
        || subject_lower.contains("upload your course materials")
        || subject_lower.contains("lecture 1 slides"))
        && !body_lower.contains("remake will be held")
    {
        return false;
    }

    // Filter out pure file-upload notification emails
    if body_lower.contains("is new in the course") && !body_lower.contains("will be held") {
        return false;
    }

    // Filter out bare "REMINDER" one-word replies in forwarded threads
    if body_lower.contains("----") {
        let parts: Vec<&str> = body_lower.split(EMAIL_SEPARATOR).collect();
        if parts.len() > 1 && parts[1].trim() == "reminder" {
            return false;
        }
    }

    subject_lower.contains("quiz")
        || subject_lower.contains("midterm")
        || subject_lower.contains("exam")
        || subject_lower.contains("assignment")
        || subject_lower.contains("assessment")
        || (body_lower.contains("quiz") && from_lower.contains("e-learning"))
}

/// Which weekly slot kind this announcement is about (v4 ladder).
fn preferred_slot_type(lower: &str) -> &'static str {
    if lower.contains("tutorial") && !lower.contains("tutorial sheets") {
        "Tutorial"
    } else if lower.contains("lab session") || lower.contains("during the lab") {
        "Lab"
    } else {
        "Lecture"
    }
}

/// Sender display name (v4 semantics, genericized): text before `<`, quotes
/// stripped, `(via …)` groups removed (v4 hardcoded one host-specific
/// instance — a generic strip is the honest equivalent), trimmed. Bare email
/// addresses yield `None` — an address is not an instructor name.
fn instructor_from(from: &str) -> Option<String> {
    let with_quotes = from.split('<').next().unwrap_or("");
    let no_groups = strip_via_groups(with_quotes.replace('"', "").as_str());
    let name = no_groups.trim();
    if name.is_empty() || name.contains('@') {
        None
    } else {
        Some(name.to_string())
    }
}

/// Removes `(via …)` / `( Via anything)` parenthesized groups.
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

/// Type ladder, ported from v4 `parse_single_email` (order matters: midterm
/// first, final exam second — an email mentioning both counts as Midterm).
fn classify_assessment(lower: &str, subject_lower: &str) -> AssessmentType {
    if lower.contains("midterm") {
        AssessmentType::MidtermExam
    } else if lower.contains("final exam") {
        AssessmentType::FinalExam
    } else if lower.contains("online quiz") || lower.contains("/mod/quiz/") {
        AssessmentType::OnlineQuiz
    } else if lower.contains("in-class assignment") || subject_lower.contains("assignment") {
        AssessmentType::Assignment
    } else if lower.contains("lab session") || lower.contains("during the lab") {
        AssessmentType::LabAssessment
    } else {
        AssessmentType::ClassQuiz
    }
}

/// Type ladder for calendar items (`summary` + `description`), used by
/// `ics.rs` (v4 ICS variant, with the unified urgency/priority ladders from
/// `01` §3 applied downstream).
#[must_use]
pub fn classify_ics_text(summary: &str, description: &str) -> AssessmentType {
    let mut text = summary.to_ascii_lowercase();
    text.push(' ');
    text.push_str(&description.to_ascii_lowercase());
    if text.contains("midterm") {
        AssessmentType::MidtermExam
    } else if text.contains("final exam") {
        AssessmentType::FinalExam
    } else if text.contains("lab") {
        AssessmentType::LabAssessment
    } else if text.contains("assignment") {
        AssessmentType::Assignment
    } else {
        AssessmentType::OnlineQuiz
    }
}

/// Title ladder (v4 order: quiz 3 → 2 → 1, then midterm, then the subject).
/// No fabricated course labels: courseless quiz titles keep just the number
/// (`"Quiz 1"`, not v4's `"GENERAL"`).
fn decide_title(
    lower: &str,
    course_code: Option<&str>,
    assessment_type: AssessmentType,
    subject: &str,
) -> String {
    for quiz in (1..=3).rev() {
        if lower.contains(&format!("quiz {quiz}")) {
            return match course_code {
                Some(code) => format!("Quiz {quiz}: {code}"),
                None => format!("Quiz {quiz}"),
            };
        }
    }
    if assessment_type == AssessmentType::MidtermExam {
        return match course_code {
            Some(code) => format!("{code} Midterm Exam"),
            None => "Midterm Exam".to_string(),
        };
    }
    subject.to_string()
}

// ---------------------------------------------------------------------------
// Topics / warnings / study plan (honest v5 replacements for v4 hardcoding)
// ---------------------------------------------------------------------------

/// Topic extraction for lecture-note announcements: bullet lines or lines
/// mentioning "lecture"/"chapter" (raw casing preserved). v4 traded this for
/// a hardcoded `BJT`/`MOSFET` keyword list — deleted per `03` `A3`. A
/// course-agnostic fallback points to the course page instead of naming
/// topics nobody announced.
fn extract_topics(announcement: &str, course_code: Option<&str>) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    for raw_line in announcement.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let is_bullet = line.starts_with('•') || line.starts_with('-') || line.starts_with('*');
        let lower_line = line.to_ascii_lowercase();
        let mentions_scope = lower_line.contains("lecture") || lower_line.contains("chapter");
        if !is_bullet && !mentions_scope {
            continue;
        }
        let candidate = if is_bullet {
            let mut cursor = line;
            while let Some(rest) = cursor.strip_prefix(|c: char| c == '•' || c == '-' || c == '*')
            {
                cursor = rest;
            }
            cursor.trim_start()
        } else {
            line
        };
        if candidate.chars().count() > 3 {
            items.push(candidate.to_string());
            if items.len() >= MAX_TOPICS {
                break;
            }
        }
    }
    if items.is_empty() {
        items.push(match course_code {
            Some(code) => format!(
                "Announced syllabus material for {code} — see the course page for the topic list"
            ),
            None => {
                "Announced syllabus material — see the course page for the topic list".to_string()
            }
        });
    }
    items
}

/// Boundary-faithful "15 minute limit" check: v4 matched the bare substring,
/// so `"115 minutes"` falsely triggered the warning. A preceding digit no
/// longer counts (v5 fix, documented in STATUS).
fn contains_15_minute_limit(lower: &str) -> bool {
    for needle in ["15 minutes", "15 mins"] {
        let mut from = 0usize;
        while let Some(offset) = lower[from..].find(needle) {
            let abs = from + offset;
            let prev_is_digit = lower[..abs]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_digit());
            if !prev_is_digit {
                return true;
            }
            from = abs + needle.len();
        }
    }
    false
}

/// Warning extraction on PRE-LOWERED text (the caller passes `subject +
/// announcement` lowered). v4 ladder; the MCQ copy is reworded — the
/// fabricated `"+ Explain & Discuss"` tail is gone per `03`; template
/// notices are strictly per-announcement, never spread from other emails.
fn extract_warnings(lower: &str) -> Vec<String> {
    let mut warnings = Vec::new();

    if lower.contains("quiz template") || lower.contains("assignment template") {
        warnings.push("⚠️ Bring your printed Quiz Template to the lecture!".to_string());
    }
    if lower.contains("will not be able to go back")
        || lower.contains("cannot go back")
        || lower.contains("won't be able to go back")
    {
        warnings.push(
            "⚠️ Strict Navigation: Once you move to the next question, you CANNOT go back!"
                .to_string(),
        );
    }
    if lower.contains("closed-book") || lower.contains("mobile phones are strictly prohibited") {
        warnings.push(
            "⚠️ Closed-Book: Mobile phones and outside notes are strictly prohibited.".to_string(),
        );
    }
    if contains_15_minute_limit(lower) {
        warnings.push("⏱️ Strict Time Limit: 15 minutes duration.".to_string());
    }
    if lower.contains("mcq") {
        warnings.push("📝 Exam Format: Multiple Choice Questions (MCQ).".to_string());
    }
    if lower.contains("assigned time slot") || lower.contains("assigned group") {
        warnings.push(
            "📍 Group Enforcement: You must attend ONLY during your registered group slot."
                .to_string(),
        );
    }

    warnings
}

/// Honest fallback study plan (course-agnostic; the v4 per-course tables and
/// the `"GENERAL"` midterm plan are deleted per `03`). Hours are a labeled
/// heuristic (2.5 h) that the UI must render as an estimate.
fn fallback_study_plan(
    course_code: Option<&str>,
    topics: &[String],
    warnings: &[String],
) -> (String, f32) {
    let scope = match course_code {
        Some(code) => format!("{code} lecture slides"),
        None => "this course's lecture slides".to_string(),
    };
    let areas = topics.len();
    let area_word = if areas == 1 { "area" } else { "areas" };
    let warn_hint = if warnings.iter().any(|w| w.contains("Template")) {
        " Don't forget to print your required template before class."
    } else {
        ""
    };
    (
        format!(
            "Review {scope} and solve the corresponding tutorial sheet problems ({areas} core topic {area_word}).{warn_hint}"
        ),
        2.5,
    )
}

// ---------------------------------------------------------------------------
// Slot matching
// ---------------------------------------------------------------------------

/// Course slots, preferring the announced slot kind, falling back to all
/// slots of that course (v4 `matched_slot` logic, generalized per-date).
fn candidate_slots<'a>(
    schedule: &'a ScheduleData,
    course_id: Option<&str>,
    preferred: &str,
) -> Vec<&'a ScheduleSlot> {
    let Some(code) = course_id else {
        return Vec::new();
    };
    let own: Vec<&ScheduleSlot> = schedule
        .slots
        .iter()
        .filter(|slot| slot.course_id.eq_ignore_ascii_case(code))
        .collect();
    let preferred_slots: Vec<&ScheduleSlot> = own
        .iter()
        .copied()
        .filter(|slot| slot.slot_type.eq_ignore_ascii_case(preferred))
        .collect();
    if preferred_slots.is_empty() {
        own
    } else {
        preferred_slots
    }
}

/// The course slot running on `date`'s weekday (time/room/group may only be
/// inherited from a slot that actually matches the resolved date).
fn carrier_slot<'a>(candidates: &[&'a ScheduleSlot], date: NaiveDate) -> Option<&'a ScheduleSlot> {
    let index = weekday_to_index(date.weekday());
    candidates
        .iter()
        .copied()
        .find(|slot| weekday_index(&slot.day) == Some(index))
}

/// Nearest date ≥ `from` whose weekday has a candidate slot (0..=6 covers
/// every weekday once — v4 Rust behavior for relative dates).
fn snap_forward_date(from: NaiveDate, candidates: &[&ScheduleSlot]) -> Option<NaiveDate> {
    for offset in 0..=6u8 {
        let date = from + Duration::days(i64::from(offset));
        if carrier_slot(candidates, date).is_some() {
            return Some(date);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

/// Scans all `https://` links (v4 knew only the `e-learning.*` LMS domain —
/// dropped as a host-specific fabrication; any https link is honest signal).
/// Preferred: a link carrying a Moodle quiz path (`/mod/quiz/`), else the
/// first link. Trailing sentence punctuation (`.` `,` `;`) is trimmed; the
/// URL extends to whitespace or `]` (v4 stop set).
#[must_use]
pub fn find_announcement_url(body: &str) -> Option<String> {
    let chars: Vec<char> = body.chars().collect();
    let len = chars.len();
    let marker: Vec<char> = "https://".chars().collect();
    let mut first: Option<String> = None;
    let mut preferred: Option<String> = None;
    let mut i = 0;

    while i + marker.len() <= len {
        if chars[i..i + marker.len()] == marker[..] {
            let mut j = i + marker.len();
            while j < len && !chars[j].is_whitespace() && chars[j] != ']' {
                j += 1;
            }
            let raw: String = chars[i..j].iter().collect();
            let link = raw.trim_end_matches(['.', ',', ';']).to_string();
            if first.is_none() {
                first = Some(link.clone());
            }
            if preferred.is_none() && link.contains("/mod/quiz/") {
                preferred = Some(link);
            }
            i = j;
        } else {
            i += 1;
        }
    }
    preferred.or(first)
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/// Parses one candidate announcement into an honest [`Assessment`]. Optional
/// fields stay `None` unless the announcement or the student's own timetable
/// established them; every derivation is explained in `ai_inference_note`
/// (machine-checkable prefixes: "Parsed from announcement:", "Estimated
/// (local heuristic):", "No date in the announcement —").
///
/// Gmail-flavoured entry point; other mail sources (Outlook/Teams) use
/// [`parse_email_announcement_from_source`] so the assessment carries the
/// source it actually came from (v4's JS engine parameterized this label).
#[must_use]
pub fn parse_email_announcement(
    email: &CachedEmail,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
) -> Assessment {
    parse_email_announcement_from_source(email, schedule, ref_date, AssessmentSource::Gmail)
}

/// Source-parameterized pipeline (the real body of [`parse_email_announcement`]).
#[must_use]
pub fn parse_email_announcement_from_source(
    email: &CachedEmail,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    source: AssessmentSource,
) -> Assessment {
    // Sanitize first (HTML bodies), then cut away forwarded-thread noise —
    // the v4 JS order (the separator survives the sanitizer as plain text).
    let sanitized = if looks_like_html(&email.body) {
        strip_html_tags(&email.body)
    } else {
        email.body.clone()
    };
    let announcement = extract_announcement_body(&sanitized).to_string();

    let subject_lower = email.subject.to_ascii_lowercase();
    let announcement_lower = announcement.to_ascii_lowercase();
    let lower = format!("{subject_lower} {announcement_lower}");

    let sent_date = parse_email_sent_date(&email.date);
    let anchor = sent_date.unwrap_or(ref_date);

    let subj_and_announcement = format!("{} {announcement}", email.subject);
    let raw_course = find_course_code(&subj_and_announcement);
    let course = raw_course
        .as_deref()
        .and_then(|code| schedule.find_course(code));
    let course_id = raw_course.clone();
    let course_name = course.map(|c| c.name.clone());
    let instructor = instructor_from(&email.from);

    // Date ladder: explicit → week-phrase estimate (snapped forward to the
    // nearest candidate slot weekday) → undated draft (no invented date).
    let preferred = preferred_slot_type(&lower);
    let candidates = candidate_slots(schedule, course_id.as_deref(), preferred);
    let explicit_date = find_explicit_date(&lower);
    let base_date = explicit_date.or_else(|| {
        find_week_phrase(&lower).map(|phrase| match phrase {
            WeekPhrase::NextWeekStrict => anchor + Duration::days(8),
            WeekPhrase::NextWeek => anchor + Duration::days(5),
            WeekPhrase::ThisWeek => anchor + Duration::days(3),
        })
    });
    let date = if let Some(explicit) = explicit_date {
        Some(explicit)
    } else {
        base_date
            .and_then(|base| snap_forward_date(base, &candidates))
            .or(base_date)
    };
    let carrier = date.and_then(|d| carrier_slot(&candidates, d));

    let days_i64 = date.map(|d| (d - ref_date).num_days());
    let days_until = days_i64.map(|v| i32::try_from(v).unwrap_or(i32::MAX));
    let is_upcoming = match days_i64 {
        Some(days) => days >= 0,
        None => true, // dateless drafts stay on the radar as "upcoming"
    };
    let urgency_level = urgency_for(days_i64);

    // Time/room/group may only be inherited from a slot that actually runs on
    // the resolved date's weekday. Empty slot strings stay unknown.
    let (start_time, end_time, room, group) = carrier
        .map(|slot| {
            (
                Some(slot.start_time),
                Some(slot.end_time),
                slot.room.clone().filter(|r| !r.trim().is_empty()),
                slot.group.clone().filter(|g| !g.trim().is_empty()),
            )
        })
        .unwrap_or((None, None, None, None));

    let assessment_type = classify_assessment(&lower, &subject_lower);
    let title = decide_title(
        &lower,
        course_id.as_deref(),
        assessment_type,
        &email.subject,
    );
    let topics = extract_topics(&announcement, course_id.as_deref());
    let warnings = extract_warnings(&lower);
    let (plan, hours) = fallback_study_plan(course_id.as_deref(), &topics, &warnings);

    let day_name = day_name_for(date);
    let display_time = date.map(|d| build_display_time(d, start_time, end_time));

    let course_label = course_id.as_deref().unwrap_or("this course");
    let slot_detail = carrier
        .map(|slot| {
            let room_part = slot
                .room
                .as_deref()
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .map(|r| format!(", Room {r}"))
                .unwrap_or_default();
            format!(
                "({} – {}{})",
                format_12h(slot.start_time),
                format_12h(slot.end_time),
                room_part
            )
        })
        .unwrap_or_default();

    let ai_inference_note: String = if explicit_date.is_some() {
        match carrier {
            Some(_) => format!(
                "Parsed from announcement: explicit date found and aligned with your {course_label} {preferred} slot {slot_detail}"
            ),
            None if candidates.is_empty() => {
                "Parsed from announcement: explicit date found. Time/room are not in the announcement and this course is not in your weekly schedule.".to_string()
            }
            None => "Parsed from announcement: explicit date found. The course's weekly slots do not run on that weekday, so no time/room were inherited.".to_string(),
        }
    } else if date.is_some() {
        if candidates.is_empty() {
            if course_id.is_none() {
                "Estimated (local heuristic): the announcement had no explicit date and this course is not in your weekly schedule, so the date/timing is an approximation. Add the course to your weekly schedule or configure a Gemini API key for precise extraction."
                    .to_string()
            } else {
                "Estimated (local heuristic): the announcement had no explicit date and no matching weekly slot could anchor it, so the date/timing is an approximation. Add the course's weekly slots or configure a Gemini API key for precise extraction."
                    .to_string()
            }
        } else {
            format!(
                "Estimated (local heuristic): the announcement had no explicit date — approximate timing inferred from wording (\"this/next week\"), snapped to the nearest {preferred} slot {slot_detail}. Configure a Gemini API key for precise extraction."
            )
        }
    } else {
        "No date in the announcement — needs manual confirmation; shown as an upcoming placeholder until a date is verified.".to_string()
    };

    Assessment {
        id: email.id.clone(),
        course_id,
        course_name,
        title,
        assessment_type,
        date,
        day_name,
        start_time,
        end_time,
        display_time,
        room,
        group,
        instructor,
        is_upcoming,
        days_until,
        urgency_level,
        priority_score: compute_priority_score(days_i64, assessment_type, topics.len()),
        topics,
        warnings,
        ai_inference_note: Some(ai_inference_note),
        ai_study_plan: Some(plan),
        estimated_study_hours: Some(hours),
        elearning_url: find_announcement_url(&email.body),
        google_cal_url: None,
        gcal_synced: false,
        gcal_event_id: None,
        color: course.map(|c| c.color.clone()),
        bg: course.and_then(|c| c.bg.clone()),
        border: course.and_then(|c| c.border.clone()),
        semester: date.map(infer_semester_from_date),
        email_subject: Some(email.subject.clone()),
        email_sent_date: sent_date.map(|d| d.format("%Y-%m-%d").to_string()),
        source: source.clone(),
        source_icon: Some(source.as_icon().to_string()),
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
    }
}

/// Scans announcement emails → (assessments, honest stats). Only candidate
/// emails are parsed; duplicates inside one scan are skipped (first wins)
/// using the shared [`merge_key`] — cross-scan merge/refresh is the planner's
/// job (`plan/`, phase 03). Ordering is NOT normalized here: the planner owns
/// radar order (v4's parser-side sort was dropped with the demo-purge).
///
/// Gmail-flavoured entry point; see [`parse_emails_from_source`].
#[must_use]
pub fn parse_emails(
    emails: &[CachedEmail],
    schedule: &ScheduleData,
    ref_date: NaiveDate,
) -> (Vec<Assessment>, ScanStats) {
    parse_emails_from_source(emails, schedule, ref_date, AssessmentSource::Gmail)
}

/// [`parse_emails`] with the source label carried onto every produced
/// assessment (Outlook/Teams mail flows through this same honest pipeline).
#[must_use]
pub fn parse_emails_from_source(
    emails: &[CachedEmail],
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    source: AssessmentSource,
) -> (Vec<Assessment>, ScanStats) {
    let mut stats = ScanStats {
        scanned: emails.len(),
        ..ScanStats::default()
    };
    let mut parsed = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for email in emails {
        let subject_lower = email.subject.to_ascii_lowercase();
        let body_lower = email.body.to_ascii_lowercase();
        let from_lower = email.from.to_ascii_lowercase();
        if !is_candidate_assessment_email(&subject_lower, &from_lower, &body_lower) {
            continue;
        }
        stats.candidates += 1;
        let assessment =
            parse_email_announcement_from_source(email, schedule, ref_date, source.clone());
        if seen.insert(merge_key(&assessment)) {
            parsed.push(assessment);
            stats.parsed += 1;
        } else {
            stats.skipped_duplicates += 1;
        }
    }
    (parsed, stats)
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::types::Course;
    use chrono::{NaiveTime, Weekday};

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    fn announcement(id: &str, subject: &str, from: &str, date: &str, body: &str) -> CachedEmail {
        CachedEmail {
            id: id.to_string(),
            subject: subject.to_string(),
            from: from.to_string(),
            date: date.to_string(),
            snippet: None,
            body: body.to_string(),
            body_truncated: false,
        }
    }

    fn fixture_schedule() -> ScheduleData {
        let courses = vec![
            Course {
                id: "CSE241".to_string(),
                name: "Object-Oriented Programming".to_string(),
                color: "#e67c73".to_string(),
                bg: Some("#fee2e2".to_string()),
                border: None,
            },
            Course {
                id: "CSE346".to_string(),
                name: "Computer Networks".to_string(),
                color: "#4285f4".to_string(),
                bg: None,
                border: None,
            },
        ];
        let slot = |id: &str,
                    day: &str,
                    day_index: u8,
                    course: &str,
                    ty: &str,
                    room: Option<&str>,
                    start_h: u32,
                    end_h: u32| {
            ScheduleSlot {
                id: id.to_string(),
                day: day.to_string(),
                day_index,
                course_id: course.to_string(),
                course_name: String::new(),
                slot_type: ty.to_string(),
                group: Some("Sec 1".to_string()),
                room: room.map(str::to_string),
                start_time: time(start_h, 0),
                end_time: time(end_h, 0),
                display_time: String::new(),
                has_quiz: false,
                quiz_title: None,
            }
        };
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            courses,
            slots: vec![
                slot("s1", "Sun", 0, "CSE241", "Lecture", Some("Lab A"), 9, 10),
                slot("s2", "Tue", 2, "CSE241", "Tutorial", None, 11, 12),
                slot("s3", "Wed", 3, "CSE241", "Lab", Some("Lab C"), 14, 16),
                slot("s4", "Mon", 1, "CSE346", "Lecture", Some("Hall 2"), 8, 10),
            ],
        }
    }

    // --- body chains ---------------------------------------------------------

    #[test]
    fn email_separator_is_sixty_nine_dashes() {
        assert_eq!(EMAIL_SEPARATOR.len(), 69);
    }

    #[test]
    fn announcement_body_between_separators() {
        let body = format!(
            "Prof forwarded this.\n{EMAIL_SEPARATOR}\nQuiz 1 for CSE241 on 18 October 2026.\n{EMAIL_SEPARATOR}\nRegards"
        );
        assert_eq!(
            extract_announcement_body(&body),
            "\nQuiz 1 for CSE241 on 18 October 2026.\n"
        );
        assert_eq!(
            extract_announcement_body("plain quiz body"),
            "plain quiz body"
        );
        let half = format!("x\n{EMAIL_SEPARATOR}\nquiz tail");
        assert_eq!(extract_announcement_body(&half), "\nquiz tail");
    }

    #[test]
    fn looks_like_html_detection() {
        assert!(looks_like_html("<p>hi</p>"));
        assert!(looks_like_html("A <BR> tag"));
        assert!(!looks_like_html("plain quiz 1 body without markup"));
    }

    #[test]
    fn strip_html_tags_basics() {
        // `</p>` and `<br>` become breaks; opening block tags now ALSO break —
        // Outlook mails ship unclosed `<td>` cells, and the old silent-strip
        // glued "New Date: …" onto "Previous Date: …" (sweep fix, 2026-10-29).
        let strip = strip_html_tags("<p>Quiz 1</p><br>CSE241<div>18 October</div>");
        assert_eq!(strip, "Quiz 1\n\nCSE241\n18 October");
        assert_eq!(
            strip_html_tags("plain body 15 minutes"),
            "plain body 15 minutes"
        );
        // Unclosed table cells (Outlook) separate instead of running on.
        assert_eq!(
            strip_html_tags("<tr><td>New Date: 7 Nov 2026<td>Previous Date: 31 Oct</tr>"),
            "New Date: 7 Nov 2026\nPrevious Date: 31 Oct"
        );
    }

    #[test]
    fn strip_html_tags_entities_decode_once() {
        // `&amp;lt;` is already-escaped markup meaning the literal text
        // `&lt;` — v4 double-decoded it into `<`; the honest output keeps
        // the escaped remainder (`&` decoded once).
        assert_eq!(
            strip_html_tags("a&nbsp;b &lt;2&gt; &amp;lt;3&amp;gt;"),
            "a b <2> &lt;3&gt;"
        );
    }

    #[test]
    fn strip_html_tags_drops_closed_style_blocks() {
        assert_eq!(strip_html_tags("<style>p{color:red}</style>Quiz"), "Quiz");
        assert_eq!(strip_html_tags("<SCRIPT src=x></script>Quiz"), "Quiz");
    }

    #[test]
    fn strip_html_tags_fallthroughs() {
        // Unclosed style block: the generic stripper consumes up to the next
        // '>', exactly like v4's `<[^>]+>` fallback.
        assert_eq!(strip_html_tags("<style nowrap=true> keep me"), "keep me");
        assert_eq!(strip_html_tags("<br-something>keep"), "keep");
    }

    // --- date scanners --------------------------------------------------------

    #[test]
    fn explicit_month_named_dates_full_and_abbrev() {
        assert_eq!(
            find_explicit_date("Quiz 1 on 18 October 2026."),
            Some(date(2026, 10, 18))
        );
        assert_eq!(
            find_explicit_date("quiz 18 sep 2026 today"),
            Some(date(2026, 9, 18))
        );
        assert_eq!(find_explicit_date("on 05/06/2026"), Some(date(2026, 6, 5)));
        assert_eq!(
            find_explicit_date("on 26-12-2026!"),
            Some(date(2026, 12, 26))
        );
    }

    #[test]
    fn invalid_dates_abort_not_fall_through() {
        assert_eq!(
            find_explicit_date("31 February 2026 fallback 05/06/2026"),
            None
        );
        assert_eq!(find_explicit_date("2026-13-40"), None);
    }

    #[test]
    fn date_scanner_boundary_rules() {
        assert_eq!(find_explicit_date("x118 September 2026"), None);
        assert_eq!(find_explicit_date("8 September 20267"), None);
        // regex `\b` blocks digit-internal restarts: no date inside "118-…"
        assert_eq!(find_explicit_date("118-06-2026"), None);
        assert_eq!(
            find_explicit_date("18 September 2026"),
            Some(date(2026, 9, 18))
        );
        assert_eq!(find_explicit_date("5-06-2026"), Some(date(2026, 6, 5)));
    }

    #[test]
    fn sent_date_parsing() {
        assert_eq!(
            parse_email_sent_date("Sat, 10 Oct 2026 09:00:00 +0000"),
            Some(date(2026, 10, 10))
        );
        assert_eq!(parse_email_sent_date("no date here"), None);
        assert_eq!(parse_email_sent_date(""), None);
    }

    #[test]
    fn recency_gate_boundary() {
        let reference = date(2026, 10, 23);
        let sent = date(2026, 10, 10);
        assert!(is_email_recent(sent, reference, 13));
        assert!(!is_email_recent(sent, reference, 12));
        assert!(!is_email_recent(date(2025, 1, 3), reference, 60));
    }

    // --- course scanner --------------------------------------------------------

    #[test]
    fn course_code_scanner_matches() {
        assert_eq!(find_course_code("CSE 241 quiz"), Some("CSE241".to_string()));
        assert_eq!(find_course_code("cs101a quiz"), Some("CS101A".to_string()));
        assert_eq!(
            find_course_code("SWE 301B midterm"),
            Some("SWE301B".to_string())
        );
        assert_eq!(
            find_course_code("topic: MATH204-01"),
            Some("MATH204".to_string())
        );
    }

    #[test]
    fn course_code_scanner_rejections() {
        assert_eq!(find_course_code("CSE2023 stands"), None);
        assert_eq!(find_course_code("hotCSE241breakfast"), None);
        assert_eq!(find_course_code("118-10-2026datethis"), None);
    }

    #[test]
    fn course_code_scanner_rescans_after_prefix_run() {
        assert_eq!(
            find_course_code("118-10-2026datethe CSE241"),
            Some("CSE241".to_string())
        );
    }

    // --- wording helpers --------------------------------------------------------

    #[test]
    fn instructor_extraction() {
        assert_eq!(
            instructor_from("Dr. Mostafa Sweifi <m.sweifi@univ.edu>"),
            Some("Dr. Mostafa Sweifi".to_string())
        );
        assert_eq!(
            instructor_from("\"Prof. X\" <x@univ.edu>"),
            Some("Prof. X".to_string())
        );
        assert_eq!(instructor_from("x@univ.edu"), None);
        assert_eq!(instructor_from(""), None);
        assert_eq!(
            instructor_from("LMS Bot (via system) <bot@lms.edu>"),
            Some("LMS Bot".to_string())
        );
    }

    #[test]
    fn assessment_type_ladder() {
        let subject_empty = String::new();
        assert_eq!(
            classify_assessment("final exam on monday", &subject_empty),
            AssessmentType::FinalExam
        );
        assert_eq!(
            classify_assessment(" midterm this week", &subject_empty),
            AssessmentType::MidtermExam
        );
        assert_eq!(
            classify_assessment("online quiz opens friday", &subject_empty),
            AssessmentType::OnlineQuiz
        );
        assert_eq!(
            classify_assessment("see /mod/quiz/view.php", &subject_empty),
            AssessmentType::OnlineQuiz
        );
        assert_eq!(
            classify_assessment("in-class assignment due thursday", "assignment update"),
            AssessmentType::Assignment
        );
        assert_eq!(
            classify_assessment("lab session graded", &subject_empty),
            AssessmentType::LabAssessment
        );
        assert_eq!(
            classify_assessment("quiz 1 next week", &subject_empty),
            AssessmentType::ClassQuiz
        );
        assert_eq!(
            classify_assessment("midterm also says online quiz", &subject_empty),
            AssessmentType::MidtermExam
        );
    }

    #[test]
    fn title_ladder() {
        assert_eq!(
            decide_title(
                "quiz 3 on friday",
                Some("CSE241"),
                AssessmentType::ClassQuiz,
                "s"
            ),
            "Quiz 3: CSE241"
        );
        assert_eq!(
            decide_title(
                "quiz 1 next",
                None,
                AssessmentType::ClassQuiz,
                "Subject text"
            ),
            "Quiz 1"
        );
        assert_eq!(
            decide_title(
                "study the midterm chapters",
                Some("MATH101"),
                AssessmentType::MidtermExam,
                "ignored"
            ),
            "MATH101 Midterm Exam"
        );
        assert_eq!(
            decide_title(
                "courseless midterm",
                None,
                AssessmentType::MidtermExam,
                "ignored"
            ),
            "Midterm Exam"
        );
        assert_eq!(
            decide_title(
                "no keywords here",
                None,
                AssessmentType::ClassQuiz,
                "Important subject"
            ),
            "Important subject"
        );
    }

    #[test]
    fn topic_extraction_bullets_scope_and_fallback() {
        let body = "notes were shared:\n- Newton's method derivation\n• Fixed-point iteration\nChapter 4 on eigenvalues in the lecture deck\nhello world this line stays out";
        assert_eq!(
            extract_topics(body, Some("MATH204")),
            vec![
                "Newton's method derivation",
                "Fixed-point iteration",
                "Chapter 4 on eigenvalues in the lecture deck",
            ]
        );
        let fallback = extract_topics("quiz on monday", Some("MATH204"));
        assert_eq!(
            fallback,
            vec![
                "Announced syllabus material for MATH204 — see the course page for the topic list"
            ]
        );
        assert_eq!(
            extract_topics("quiz on monday", None),
            vec!["Announced syllabus material — see the course page for the topic list"]
        );
    }

    #[test]
    fn warning_ladder_copy() {
        let nav = extract_warnings("you will not be able to go back to a previous question");
        assert_eq!(
            nav,
            vec!["⚠️ Strict Navigation: Once you move to the next question, you CANNOT go back!"]
        );
        let closed = extract_warnings("this quiz is closed-book and phones are banned");
        assert_eq!(
            closed,
            vec!["⚠️ Closed-Book: Mobile phones and outside notes are strictly prohibited."]
        );
        assert!(extract_warnings("the exam takes 115 minutes").is_empty());
        assert_eq!(
            extract_warnings("limit is 15 minutes"),
            vec!["⏱️ Strict Time Limit: 15 minutes duration."]
        );
        assert_eq!(
            extract_warnings("about 15 mins only"),
            vec!["⏱️ Strict Time Limit: 15 minutes duration."]
        );
        assert_eq!(
            extract_warnings("format: mcq"),
            vec!["📝 Exam Format: Multiple Choice Questions (MCQ)."]
        );
        assert_eq!(
            extract_warnings("sit in your assigned time slot"),
            vec!["📍 Group Enforcement: You must attend ONLY during your registered group slot."]
        );
        assert_eq!(
            extract_warnings("bring your printed quiz template"),
            vec!["⚠️ Bring your printed Quiz Template to the lecture!"]
        );
    }

    #[test]
    fn template_warning_is_per_announcement() {
        // A quiz mention alone must NOT create the template warning (v4
        // spread the warning from OTHER template emails — deleted per `03`).
        assert!(extract_warnings("quiz 1 heads up lecture notes uploaded").is_empty());
        let with_template =
            extract_warnings("reminder: print the assignment template before class");
        assert_eq!(
            with_template,
            vec!["⚠️ Bring your printed Quiz Template to the lecture!"]
        );
    }

    #[test]
    fn candidate_filter_rules() {
        assert!(is_candidate_assessment_email(
            "quiz 1 tuesday",
            "prof@uni.edu",
            "the quiz"
        ));
        assert!(!is_candidate_assessment_email(
            "re: quiz 1",
            "student@uni.edu",
            "ok"
        ));
        assert!(!is_candidate_assessment_email(
            "quiz 1 results",
            "prof@uni.edu",
            "empty"
        ));
        assert!(is_candidate_assessment_email(
            "quiz 1 grades",
            "prof@uni.edu",
            "remake will be held monday"
        ));
        assert!(!is_candidate_assessment_email(
            "materials",
            "lms@uni.edu",
            "this file is new in the course library"
        ));
        let reminder = format!("fwd\n----\n{EMAIL_SEPARATOR}\nreminder\n");
        assert!(!is_candidate_assessment_email(
            "fwd",
            "student@uni.edu",
            &reminder.to_ascii_lowercase()
        ));
        assert!(is_candidate_assessment_email(
            "news",
            "e-learning@uni.edu",
            "an online quiz opened"
        ));
    }

    #[test]
    fn announcement_url_extraction() {
        assert_eq!(
            find_announcement_url(
                "see https://uni.edu/course/ or https://lms.univ.edu/mod/quiz/view.php?id=7. mail us"
            ),
            Some("https://lms.univ.edu/mod/quiz/view.php?id=7".to_string())
        );
        assert_eq!(
            find_announcement_url("first https://a.edu/x.html then done"),
            Some("https://a.edu/x.html".to_string())
        );
        assert_eq!(find_announcement_url("no links here"), None);
    }

    // --- shared util tables -----------------------------------------------------

    #[test]
    fn format_12h_table() {
        assert_eq!(format_12h(time(0, 0)), "12:00 AM");
        assert_eq!(format_12h(time(9, 30)), "9:30 AM");
        assert_eq!(format_12h(time(12, 0)), "12:00 PM");
        assert_eq!(format_12h(time(13, 45)), "1:45 PM");
    }

    #[test]
    fn semester_inference_table() {
        assert_eq!(infer_semester_from_date(date(2026, 10, 18)), "Fall 2026");
        assert_eq!(infer_semester_from_date(date(2026, 3, 15)), "Spring 2026");
        assert_eq!(infer_semester_from_date(date(2026, 7, 20)), "Summer 2026");
        assert_eq!(infer_semester_from_date(date(2026, 1, 10)), "Fall 2025");
        assert_eq!(infer_semester_from_date(date(2026, 1, 25)), "Spring 2026");
    }

    #[test]
    fn urgency_and_priority_tables() {
        use crate::types::UrgencyLevel;
        assert_eq!(urgency_for(Some(-1)), UrgencyLevel::Past);
        assert_eq!(urgency_for(Some(0)), UrgencyLevel::Critical);
        assert_eq!(urgency_for(Some(2)), UrgencyLevel::Critical);
        assert_eq!(urgency_for(Some(3)), UrgencyLevel::High);
        assert_eq!(urgency_for(Some(5)), UrgencyLevel::High);
        assert_eq!(urgency_for(Some(6)), UrgencyLevel::Medium);
        assert_eq!(urgency_for(Some(14)), UrgencyLevel::Medium);
        assert_eq!(urgency_for(Some(15)), UrgencyLevel::Upcoming);
        assert_eq!(urgency_for(None), UrgencyLevel::Upcoming);

        assert_eq!(
            compute_priority_score(Some(-3), AssessmentType::ClassQuiz, 0),
            10
        );
        assert_eq!(
            compute_priority_score(Some(0), AssessmentType::ClassQuiz, 6),
            100
        );
        assert_eq!(
            compute_priority_score(Some(3), AssessmentType::MidtermExam, 2),
            98
        );
        assert_eq!(
            compute_priority_score(None, AssessmentType::ClassQuiz, 1),
            7
        );
    }

    #[test]
    fn weekday_name_helpers() {
        assert_eq!(weekday_index("Sun"), Some(0));
        assert_eq!(weekday_index("Saturday"), Some(6));
        assert_eq!(weekday_to_index(Weekday::Mon), 1);
    }

    // --- pipeline -----------------------------------------------------------------

    #[test]
    fn explicit_date_on_slot_day_inherits_slot() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-1",
            "Quiz 1 next Sunday",
            "Dr. X <x@univ.edu>",
            "Sat, 17 Oct 2026 10:00:00 +0000",
            "CSE241 quiz 1 on 25 October 2026 during the lecture. Print your quiz template before class.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.id, "mail-1");
        assert_eq!(parsed.course_id.as_deref(), Some("CSE241"));
        assert_eq!(
            parsed.course_name.as_deref(),
            Some("Object-Oriented Programming")
        );
        assert_eq!(parsed.date, Some(date(2026, 10, 25)));
        assert_eq!(parsed.day_name.as_deref(), Some("Sunday"));
        assert_eq!(parsed.start_time, Some(time(9, 0)));
        assert_eq!(parsed.end_time, Some(time(10, 0)));
        assert_eq!(parsed.room.as_deref(), Some("Lab A"));
        assert_eq!(parsed.group.as_deref(), Some("Sec 1"));
        assert_eq!(parsed.title, "Quiz 1: CSE241");
        assert_eq!(
            parsed.display_time.as_deref(),
            Some("Sunday, 25 October 2026 (9:00 AM – 10:00 AM)")
        );
        assert_eq!(parsed.instructor.as_deref(), Some("Dr. X"));
        assert_eq!(parsed.color.as_deref(), Some("#e67c73"));
        assert_eq!(parsed.days_until, Some(2));
        assert!(parsed.is_upcoming);
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.starts_with("Parsed from announcement:"),
            "note was: {note}"
        );
        let plan = parsed.ai_study_plan.clone().unwrap_or_default();
        assert!(plan.contains(" Don't forget to print your required template before class."));
        assert_eq!(parsed.estimated_study_hours, Some(2.5));
        assert!(parsed
            .warnings
            .contains(&"⚠️ Bring your printed Quiz Template to the lecture!".to_string()));
    }

    #[test]
    fn explicit_date_off_slot_day_stays_unknown() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-2",
            "Quiz heads up",
            "Dr. Y <y@univ.edu>",
            "Sat, 17 Oct 2026 10:00:00 +0000",
            "CSE346 quiz 1 on 18 October 2026.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.course_id.as_deref(), Some("CSE346"));
        assert_eq!(parsed.date, Some(date(2026, 10, 18)));
        assert_eq!(parsed.start_time, None, "no slot runs on that weekday");
        assert_eq!(parsed.end_time, None);
        assert_eq!(parsed.room, None);
        assert_eq!(
            parsed.display_time.as_deref(),
            Some("Sunday, 18 October 2026")
        );
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.contains("do not run on that weekday"),
            "note was: {note}"
        );
    }

    #[test]
    fn estimated_phrase_snaps_forward_to_slot() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-3",
            "Networks news",
            "Dr. Y <y@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "CSE346 quiz 2 next week.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        // Sent Sat 10-17 → "next week" +5 = Thu 10-22 → snap to Mon 10-26.
        assert_eq!(parsed.date, Some(date(2026, 10, 26)));
        assert_eq!(parsed.day_name.as_deref(), Some("Monday"));
        assert_eq!(parsed.start_time, Some(time(8, 0)));
        assert_eq!(parsed.room.as_deref(), Some("Hall 2"));
        assert_eq!(parsed.days_until, Some(3));
        assert!(parsed.is_upcoming);
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.starts_with("Estimated (local heuristic):"),
            "note was: {note}"
        );
    }

    #[test]
    fn undated_draft_is_upcoming_placeholder() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-4",
            "Quiz 3 heads up",
            "Dr. X <x@univ.edu>",
            "recently",
            "CSE241 quiz 3 materials were posted today.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.date, None);
        assert_eq!(parsed.days_until, None);
        assert!(parsed.is_upcoming);
        assert_eq!(parsed.email_sent_date, None);
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.starts_with("No date in the announcement — needs manual confirmation"),
            "note was: {note}"
        );
        assert_eq!(parsed.estimated_study_hours, Some(2.5));
    }

    #[test]
    fn courseless_quiz_stays_honest() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-5",
            "Quiz 2 next week",
            "Prof. Y <y@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "class quiz 2 next week in the usual room",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.course_id, None);
        assert_eq!(parsed.course_name, None);
        assert_eq!(parsed.color, None);
        assert_eq!(parsed.title, "Quiz 2");
        // No weekly slot can anchor "next week" → keep sent+5, no slot data.
        assert_eq!(parsed.date, Some(date(2026, 10, 22)));
        assert_eq!(parsed.start_time, None);
        let topics = parsed.topics;
        assert_eq!(
            topics,
            vec!["Announced syllabus material — see the course page for the topic list"]
        );
        let plan = parsed.ai_study_plan.unwrap_or_default();
        assert!(
            plan.starts_with("Review this course's lecture slides"),
            "plan: {plan}"
        );
        assert_eq!(parsed.estimated_study_hours, Some(2.5));
    }

    #[test]
    fn scan_stats_and_dedupe() {
        let schedule = fixture_schedule();
        let a = announcement(
            "mail-10",
            "Quiz 1 heads up",
            "x@univ.edu",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "CSE241 quiz 1 on 25 October 2026",
        );
        let b = announcement(
            "mail-11",
            "Quiz 1 heads up",
            "x@univ.edu",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "CSE241 quiz 1 on 25 October 2026",
        );
        let noise = announcement(
            "mail-12",
            "syllabus pdf attached",
            "x@univ.edu",
            "recently",
            "nothing here",
        );
        let (assessments, stats) = parse_emails(&[a, noise, b], &schedule, date(2026, 10, 23));
        assert_eq!(stats.scanned, 3);
        assert_eq!(stats.candidates, 2);
        assert_eq!(stats.parsed, 1);
        assert_eq!(stats.skipped_duplicates, 1);
        assert_eq!(assessments.len(), 1);
        assert_eq!(assessments[0].id, "mail-10");
    }

    #[test]
    fn html_sanitized_pipeline() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-20",
            "Quiz 1 heads up",
            "Dr. X <x@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "<p>CSE241 quiz 1 on 25 October 2026</p><br><span>bring your&nbsp;quiz template</span>",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.date, Some(date(2026, 10, 25)));
        assert!(parsed
            .warnings
            .contains(&"⚠️ Bring your printed Quiz Template to the lecture!".to_string()));
    }

    #[test]
    fn scan_stats_after_sanitize() {
        let schedule = fixture_schedule();
        let (parsed, stats) = parse_emails(
            &[
                announcement(
                    "mail-30",
                    "Quiz 1 heads up",
                    "x@univ.edu",
                    "Sat, 17 Oct 2026 09:00:00 +0000",
                    "CSE241 quiz 1 on 25 October 2026",
                ),
                announcement(
                    "mail-31",
                    "Quiz 1 heads up",
                    "y@univ.edu",
                    "Sat, 17 Oct 2026 09:00:00 +0000",
                    "CSE241 quiz 1 on 25 October 2026 again",
                ),
            ],
            &schedule,
            date(2026, 10, 23),
        );
        // "Quiz 1" + same date + same course = duplicate of mail-30
        assert_eq!(stats.parsed, 1);
        assert_eq!(stats.skipped_duplicates, 1);
        assert_eq!(parsed[0].course_id.as_deref(), Some("CSE241"));
    }
}
