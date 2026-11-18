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
//! - an announcement older than the 60-day recency window (`01` §4.2) never
//!   reaches the radar, and the skip is counted, not hidden,
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

use chrono::{DateTime, Datelike, Duration, NaiveDate};

use crate::parse::merge::merge_key;
use crate::parse::util::{
    build_display_time, compute_priority_score, day_name_for, format_12h, infer_semester_from_date,
    urgency_for, weekday_index, weekday_to_index,
};
use crate::types::{
    Assessment, AssessmentSource, AssessmentType, CachedEmail, Course, ScheduleData, ScheduleSlot,
};

/// v4 forwarded-announcement separator (69 dashes) professors use to quote
/// the original notice.
pub const EMAIL_SEPARATOR: &str =
    "---------------------------------------------------------------------";

/// Sanity cap on numbered topic candidates so a pathological announcement
/// cannot explode the topic-key space (v4 had no cap).
const MAX_TOPICS: usize = 32;

/// The subject the Gmail fetcher writes when a message carries no `Subject:`
/// header (`sources/gmail.rs`). It is an honest *label* for a missing
/// header — but it is not data: an assessment may never carry it as its
/// title or its instructor.
pub const PLACEHOLDER_SUBJECT: &str = "(No Subject)";

/// The sender the Gmail fetcher writes when a message carries no `From:`
/// header — same rule as [`PLACEHOLDER_SUBJECT`]: a placeholder is never an
/// instructor.
pub const PLACEHOLDER_SENDER: &str = "(Unknown Sender)";

/// The honest title for an announcement whose subject header was missing:
/// generic on purpose — it names no course and no quiz number nobody
/// wrote.
pub const UNTITLED_ASSESSMENT: &str = "Untitled assessment";

/// True when `value` is one of the placeholder headers above (compared
/// case-insensitively) — such a value carries no information about the
/// message it came from.
#[must_use]
pub fn is_placeholder_header(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.eq_ignore_ascii_case(PLACEHOLDER_SUBJECT)
        || trimmed.eq_ignore_ascii_case(PLACEHOLDER_SENDER)
}

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
    /// Messages dropped by the recency window ([`MAX_EMAIL_AGE_DAYS`]) —
    /// announcements that are already too old to belong on the radar.
    pub skipped_stale: usize,
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
                // One trailing digit is part of the tag NAME (`h1`–`h6`):
                // a letters-only collector produced "h" for `<h1>`, so the
                // h1–h6 block arm below was dead and heading text glued to
                // the previous word — silently breaking date word boundaries.
                while j < len
                    && (chars[j].is_ascii_alphabetic()
                        || (chars[j].is_ascii_digit() && name.len() == 1 && name.starts_with('h')))
                {
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

const ENTITIES: [(&str, &str); 20] = [
    ("&nbsp;", " "),
    ("&#160;", " "),
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&amp;", "&"),
    ("&quot;", "\""),
    ("&#39;", "'"),
    ("&#x27;", "'"),
    ("&apos;", "'"),
    ("&ndash;", "-"),
    ("&#8211;", "-"),
    ("&mdash;", "—"),
    ("&#8212;", "—"),
    ("&rsquo;", "'"),
    ("&#8217;", "'"),
    ("&lsquo;", "'"),
    ("&ldquo;", "\""),
    ("&rdquo;", "\""),
    ("&bull;", "•"),
    ("&hellip;", "..."),
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

/// Removes Gmail/Outlook forwarded header blocks (`---------- Forwarded message ---------`
/// followed by `From:` / `Date:` / `Sent:` / `To:` / `Cc:` / `Subject:`) and
/// `"On <date>, <sender> wrote:"` quote attribution lines so forwarded send
/// timestamps cannot hijack the assessment's actual exam date or leak header
/// lines into topics.
fn strip_forwarded_header_blocks(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut i = 0usize;

    let is_header_key = |trimmed_lower: &str| {
        [
            "from:",
            "sent:",
            "date:",
            "to:",
            "cc:",
            "bcc:",
            "subject:",
            "reply-to:",
        ]
        .iter()
        .any(|prefix| trimmed_lower.starts_with(prefix))
    };

    while i < lines.len() {
        let trimmed = lines[i].trim();
        let lower = trimmed.to_ascii_lowercase();

        // Forwarded banner line + contiguous RFC-style header stanza.
        if (lower.contains("forwarded message") || lower.contains("original message"))
            && trimmed.starts_with("---")
        {
            i += 1;
            while i < lines.len() && lines[i].trim().is_empty() {
                i += 1;
            }
            while i < lines.len() && is_header_key(&lines[i].trim().to_ascii_lowercase()) {
                i += 1;
            }
            continue;
        }

        // Outlook/inline forwarded header stanza without a dashed banner: requires
        // `From:` plus a `Date:` or `Sent:` line in the same contiguous header block.
        if lower.starts_with("from:") {
            let mut end = i + 1;
            let mut has_send_date = false;
            while end < lines.len() && is_header_key(&lines[end].trim().to_ascii_lowercase()) {
                let next_lower = lines[end].trim().to_ascii_lowercase();
                if next_lower.starts_with("date:") || next_lower.starts_with("sent:") {
                    has_send_date = true;
                }
                end += 1;
            }
            if has_send_date {
                i = end;
                continue;
            }
        }

        // One- or two-line quote attribution (`On Sun, 11 Oct 2026 ... wrote:`).
        if lower.starts_with("on ") && lower.chars().any(|c| c.is_ascii_digit()) {
            if lower.ends_with("wrote:") {
                i += 1;
                continue;
            }
            if i + 1 < lines.len() {
                let next_lower = lines[i + 1].trim().to_ascii_lowercase();
                if next_lower.ends_with("wrote:") && !next_lower.is_empty() {
                    i += 2;
                    continue;
                }
            }
        }

        kept.push(lines[i]);
        i += 1;
    }

    kept.join("\n")
}

// ---------------------------------------------------------------------------
// Date scanners
// ---------------------------------------------------------------------------

/// Month names for the explicit-date scanner: full names first (v4 `RE_DMY`
/// alternation order), then 3-letter abbreviations (`prompts/p02` includes
/// `d Mon YYYY` in the ladder; v4 knew only full names — documented
/// divergence).
const MONTHS: [&str; 25] = [
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
    "sept",
    "sep",
    "oct",
    "nov",
    "dec",
];

/// Index of `"jan"` inside [`MONTHS`].
const MONTH_ABBREV_START: usize = 12;

fn month_number_from_index(idx: usize) -> u32 {
    match idx {
        0..=11 => (idx + 1) as u32,
        12..=19 => (idx - 12 + 1) as u32, // jan (12)->1 .. aug (19)->8
        20 | 21 => 9,                     // sept (20)->9, sep (21)->9
        22 => 10,                         // oct (22)->10
        23 => 11,                         // nov (23)->11
        24 => 12,                         // dec (24)->12
        _ => 1,
    }
}

/// 3-letter or 4-letter ("sept") month abbreviation (case-insensitive) → 1..=12.
fn lookup_month_abbrev(chars: &[char], at: usize) -> Option<u32> {
    if at + 4 <= chars.len() {
        let mut four = String::with_capacity(4);
        for k in 0..4 {
            four.push(*chars.get(at + k)?);
        }
        if four.eq_ignore_ascii_case("sept") {
            return Some(9);
        }
    }
    let mut name = String::with_capacity(3);
    for k in 0..3 {
        name.push(*chars.get(at + k)?);
    }
    let lowered = name.to_ascii_lowercase();
    let idx = MONTHS
        .iter()
        .skip(MONTH_ABBREV_START)
        .position(|candidate| *candidate == lowered)?;
    Some(month_number_from_index(MONTH_ABBREV_START + idx))
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
    let trimmed = date_header.trim();
    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        return Some(dt.date_naive());
    }

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

/// The announcement recency window (`01` §4.2 / §8): a message older than
/// this many days is not part of the radar any more — a two-year-old "quiz
/// next week" must not sit on the dashboard forever.
pub const MAX_EMAIL_AGE_DAYS: i64 = 60;

/// True when the announcement was sent within `max_age_days` of the
/// reference date. The radar's recency window ([`MAX_EMAIL_AGE_DAYS`]) is
/// built on this: an announcement older than the window is dropped instead
/// of staying on the radar forever. A message whose date header cannot be
/// parsed has an UNKNOWN age — it is never counted as fresh, and it is
/// never dropped on a guessed age either (see [`parse_emails_from_source`]).
#[must_use]
pub fn is_email_recent(sent: NaiveDate, reference: NaiveDate, max_age_days: i64) -> bool {
    let diff = (reference - sent).num_days();
    diff >= -1 && diff <= max_age_days
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

/// Match a course from text against the student's enrolled schedule courses.
/// Deterministic matching order:
/// 1. Course ID match (e.g. "CSE241" or "cse 241")
/// 2. Course Name match (case-insensitive substring, requiring at least 3 characters)
/// 3. Hand-written course code regex scanner (`find_course_code`), matched against `schedule.courses`.
#[must_use]
pub fn match_course_from_text<'a>(
    text: &str,
    schedule: &'a ScheduleData,
) -> Option<(&'a Course, &'static str)> {
    let text_lower = text.to_ascii_lowercase();
    // 1. Direct course ID match
    for course in &schedule.courses {
        if !course.id.is_empty() {
            let id_lower = course.id.to_ascii_lowercase();
            if text_lower.contains(&id_lower) {
                return Some((course, "id-match"));
            }
        }
    }
    // 1b. User-configured course code alias match
    for course in &schedule.courses {
        for alias in &course.aliases {
            let alias_lower = alias.trim().to_ascii_lowercase();
            if !alias_lower.is_empty() && text_lower.contains(&alias_lower) {
                return Some((course, "alias-match"));
            }
        }
    }
    // 2. Direct course Name match
    for course in &schedule.courses {
        let name_lower = course.name.trim().to_ascii_lowercase();
        if name_lower.len() >= 3 && text_lower.contains(&name_lower) {
            return Some((course, "name-match"));
        }
    }
    // 3. Fallback to course code scanner (e.g. spaced codes like "CSE 241")
    if let Some(code) = find_course_code(text) {
        if let Some(course) = schedule.find_course(&code) {
            return Some((course, "code-scanner"));
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
    /// A bare `"not this week"` with no `"next week"` in the same
    /// announcement. The announcement says the event is NOT in the current
    /// week, so it must never be anchored to *this* week — that would move
    /// the date EARLIER than the professor said. It gets the same later-week
    /// estimate as the strict pair (`+8` days), and the inference note says
    /// which wording produced the anchor.
    NotThisWeek,
}

impl WeekPhrase {
    /// The wording the estimate was derived from — quoted verbatim in the
    /// inference note so the note describes what actually happened.
    fn wording(self) -> &'static str {
        match self {
            Self::ThisWeek => "this week",
            Self::NextWeek => "next week",
            Self::NextWeekStrict => "next week (not this week)",
            Self::NotThisWeek => "not this week",
        }
    }

    /// The day offset from the sent date (v4 ladder: `+8/+5/+3`).
    fn offset_days(self) -> i64 {
        match self {
            Self::ThisWeek => 3,
            Self::NextWeek => 5,
            Self::NextWeekStrict | Self::NotThisWeek => 8,
        }
    }
}

fn find_week_phrase(lower: &str) -> Option<WeekPhrase> {
    if lower.contains("next week") && lower.contains("not this week") {
        Some(WeekPhrase::NextWeekStrict)
    } else if lower.contains("next week") {
        Some(WeekPhrase::NextWeek)
    } else if lower.contains("not this week") {
        // The negation stands on its own: "the quiz is not this week" says
        // nothing about *this* week, so it is anchored like the strict pair
        // instead of falling into the `this week` branch.
        Some(WeekPhrase::NotThisWeek)
    } else if lower.contains("this week") {
        Some(WeekPhrase::ThisWeek)
    } else {
        None
    }
}

fn contains_ascii_word(haystack_lower: &str, word: &str) -> bool {
    let bytes = haystack_lower.as_bytes();
    let needle = word.as_bytes();
    if needle.is_empty() || needle.len() > bytes.len() {
        return false;
    }
    let mut from = 0usize;
    while let Some(offset) = haystack_lower[from..].find(word) {
        let abs = from + offset;
        let before_ok = abs == 0 || !bytes[abs - 1].is_ascii_alphanumeric();
        let after = abs + needle.len();
        let after_ok = after == bytes.len() || !bytes[after].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        from = abs + 1;
    }
    false
}

fn contains_any_ascii_word(haystack_lower: &str, words: &[&str]) -> bool {
    words
        .iter()
        .any(|word| contains_ascii_word(haystack_lower, word))
}

fn contains_ascii_prefix_digits(haystack_lower: &str, prefix: &str) -> bool {
    let bytes = haystack_lower.as_bytes();
    let needle = prefix.as_bytes();
    if needle.is_empty() || needle.len() >= bytes.len() {
        return false;
    }
    let mut from = 0usize;
    while let Some(offset) = haystack_lower[from..].find(prefix) {
        let abs = from + offset;
        let before_ok = abs == 0 || !bytes[abs - 1].is_ascii_alphanumeric();
        let after = abs + needle.len();
        if before_ok && after < bytes.len() && bytes[after].is_ascii_digit() {
            let mut end = after;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            let after_ok = end == bytes.len() || !bytes[end].is_ascii_alphabetic();
            if after_ok {
                return true;
            }
        }
        from = abs + 1;
    }
    false
}

fn contains_ascii_phrase(haystack_lower: &str, phrase: &str) -> bool {
    let bytes = haystack_lower.as_bytes();
    let needle = phrase.as_bytes();
    if needle.is_empty() || needle.len() > bytes.len() {
        return false;
    }
    let mut from = 0usize;
    while let Some(offset) = haystack_lower[from..].find(phrase) {
        let abs = from + offset;
        let before_ok = abs == 0 || !bytes[abs - 1].is_ascii_alphanumeric();
        let after = abs + needle.len();
        let after_ok = after == bytes.len() || !bytes[after].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        from = abs + 1;
    }
    false
}

/// Detects real clock meridiem tokens (`10am`, `10 am`, `1:30 pm`, `9 a.m.`)
/// without falsely matching common English words like "campus", "team",
/// "program", or "example".
fn contains_time_meridiem(haystack_lower: &str) -> bool {
    let bytes = haystack_lower.as_bytes();
    for marker in ["am", "pm", "a.m.", "p.m."] {
        let mut from = 0usize;
        while let Some(offset) = haystack_lower[from..].find(marker) {
            let abs = from + offset;
            let after = abs + marker.len();
            let after_ok = after == bytes.len() || !bytes[after].is_ascii_alphabetic();
            if after_ok && abs > 0 {
                let mut prev = abs;
                let mut spaces = 0usize;
                while prev > 0 && bytes[prev - 1].is_ascii_whitespace() {
                    prev -= 1;
                    spaces += 1;
                }
                if spaces <= 2 && prev > 0 && bytes[prev - 1].is_ascii_digit() {
                    return true;
                }
            }
            from = abs + 1;
        }
    }
    false
}

fn is_decorative_symbol(ch: char) -> bool {
    let code = ch as u32;
    matches!(
        code,
        0x1F300..=0x1FAFF
            | 0x2600..=0x27BF
            | 0xFE0E..=0xFE0F
            | 0x200D
            | 0x200B
            | 0x00AD
    )
}

/// Strips decorative emojis, Markdown emphasis markers (`**`, `__`, `` ` ``),
/// and excess whitespace from announcement titles, rooms, and topics while
/// keeping normal text and balanced punctuation intact.
#[must_use]
pub(crate) fn clean_inline_decorations(raw: &str) -> String {
    let mut cleaned = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if is_decorative_symbol(ch) || matches!(ch, '\n' | '\r' | '\t') {
            cleaned.push(' ');
        } else {
            cleaned.push(ch);
        }
    }
    let cleaned = cleaned.replace("**", "").replace("__", "").replace('`', "");
    let mut collapsed = String::with_capacity(cleaned.len());
    let mut prev_space = true;
    for ch in cleaned.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                collapsed.push(' ');
                prev_space = true;
            }
        } else {
            collapsed.push(ch);
            prev_space = false;
        }
    }
    let trimmed = collapsed
        .trim()
        .trim_matches(|c: char| matches!(c, '|' | '•' | '·'));
    let trimmed = trimmed.trim();
    let trimmed = trimmed
        .strip_prefix(": ")
        .or_else(|| trimmed.strip_prefix("- "))
        .or_else(|| trimmed.strip_prefix("— "))
        .unwrap_or(trimmed);
    let trimmed = trimmed
        .strip_suffix(" -")
        .or_else(|| trimmed.strip_suffix(" —"))
        .or_else(|| trimmed.strip_suffix(" :"))
        .unwrap_or(trimmed);
    trimmed.trim().to_string()
}

/// Candidate email filter: detects graded course assessment announcements
/// while filtering replies, pure grade/material uploads, attendance warnings,
/// course evaluation surveys, commercial student offers, and extracurricular
/// workshops/club events (`subject_lower`, `from_lower`, `body_lower` all
/// lower-cased by the caller).
pub fn is_candidate_assessment_email(
    subject_lower: &str,
    from_lower: &str,
    body_lower: &str,
) -> bool {
    // Filter out the student's own outgoing replies
    if subject_lower.starts_with("re:") {
        return false;
    }

    // Filter out bare "REMINDER" one-word replies in forwarded threads
    if body_lower.contains("----") {
        let parts: Vec<&str> = body_lower.split(EMAIL_SEPARATOR).collect();
        if parts.len() > 1 && parts[1].trim() == "reminder" {
            return false;
        }
    }

    // Filter out pure file-upload notification emails
    if body_lower.contains("is new in the course") && !body_lower.contains("will be held") {
        return false;
    }

    let from_is_lms = from_lower.contains("e-learning")
        || from_lower.contains("canvas")
        || from_lower.contains("moodle")
        || from_lower.contains("blackboard")
        || from_lower.contains("gradescope")
        || from_lower.contains("classroom.google.com");

    let has_remake = body_lower.contains("remake will be held")
        || body_lower.contains("makeup will be held")
        || body_lower.contains("make-up will be held")
        || body_lower.contains("remake quiz")
        || body_lower.contains("makeup quiz")
        || body_lower.contains("make-up quiz");

    let has_assessment_keyword = |s: &str| {
        contains_any_ascii_word(
            s,
            &[
                "quiz",
                "quizzes",
                "midterm",
                "midterms",
                "exam",
                "exams",
                "assignment",
                "assignments",
                "assessment",
                "assessments",
                "test",
                "tests",
            ],
        ) || s.contains("mid-term")
            || s.contains("/mod/quiz/")
            || contains_ascii_prefix_digits(s, "quiz")
            || contains_ascii_prefix_digits(s, "test")
    };

    let subject_has_core_assessment = contains_any_ascii_word(
        subject_lower,
        &[
            "quiz",
            "quizzes",
            "midterm",
            "midterms",
            "assignment",
            "assignments",
        ],
    ) || subject_lower.contains("mid-term")
        || subject_lower.contains("final exam")
        || contains_ascii_prefix_digits(subject_lower, "quiz");

    // Transactional / auth / billing noise never represents a course exam.
    if [
        "verification code",
        "one-time password",
        "two-factor",
        "2fa code",
        "password reset",
        "sign-in attempt",
        "payment receipt",
        "tax invoice",
        "invoice #",
        "billing statement",
        "order confirmation",
    ]
    .iter()
    .any(|phrase| subject_lower.contains(phrase))
    {
        return false;
    }

    // Filter out attendance/absence/disciplinary warnings (often mention
    // "barred from the final exam" in the body without scheduling an exam).
    let attendance_subject = (contains_ascii_word(subject_lower, "attendance")
        || contains_ascii_word(subject_lower, "absence")
        || contains_ascii_word(subject_lower, "absenteeism")
        || contains_ascii_word(subject_lower, "disciplinary"))
        && contains_any_ascii_word(
            subject_lower,
            &["warning", "alert", "notice", "barred", "deprived"],
        );
    let attendance_body = (body_lower.contains("attendance warning")
        || body_lower.contains("absence warning")
        || body_lower.contains("first warning")
        || body_lower.contains("second warning")
        || body_lower.contains("third warning")
        || body_lower.contains("barred from")
        || body_lower.contains("deprived from")
        || body_lower.contains("not allowed to enter the final")
        || (body_lower.contains("exceeded") && body_lower.contains("absence")))
        && !subject_has_core_assessment;
    if (attendance_subject || attendance_body) && !has_remake {
        return false;
    }

    // Course/instructor evaluation surveys frequently use "final" and "deadline".
    // A real assessment email that merely asks students to fill out a survey
    // afterwards ("Quiz 3 on Sunday — please fill out the survey") survives:
    // a core assessment word in the subject rescues it from this filter.
    let is_survey = [
        "course evaluation",
        "instructor evaluation",
        "teaching evaluation",
        "faculty evaluation",
        "evaluation survey",
        "feedback survey",
        "complete the survey",
        "fill out the survey",
    ]
    .iter()
    .any(|phrase| subject_lower.contains(phrase) || body_lower.contains(phrase))
        || contains_ascii_word(subject_lower, "survey");
    if is_survey && !subject_has_core_assessment && !has_remake {
        return false;
    }

    // Scheduling language anywhere in the email separates a combined
    // announcement ("Quiz 3 grades — Quiz 4 moved to Sunday") from a pure
    // results notice ("Quiz 3 grades posted"); the accept ladder reuses it.
    let subject_has_scheduling = contains_any_ascii_word(
        subject_lower,
        &[
            "moved",
            "rescheduled",
            "postponed",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
            "tomorrow",
            "today",
        ],
    ) || contains_ascii_phrase(subject_lower, "next week")
        || contains_time_meridiem(subject_lower);
    let body_has_scheduling = contains_any_ascii_word(
        body_lower,
        &[
            "held",
            "due",
            "scheduled",
            "deadline",
            "submission",
            "room",
            "hall",
            "tomorrow",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ],
    ) || body_lower.contains("take place")
        || body_lower.contains("next week")
        || contains_time_meridiem(body_lower);

    // Pure grade/result notices are not assessments unless a remake/makeup is
    // announced, or the subject pairs a core assessment word with concrete
    // scheduling language ("Midterm Exam grades posted" stays out).
    if contains_any_ascii_word(subject_lower, &["result", "results", "grades", "marks"])
        && !has_remake
        && !(subject_has_core_assessment && (subject_has_scheduling || body_has_scheduling))
    {
        return false;
    }

    // Filter out bare cancellations, answer keys / solution posts, appeals, and
    // slide/recording upload notices unless they carry an active reschedule or
    // remake/makeup assessment.
    let has_reschedule_or_remake = has_remake
        || subject_lower.contains("rescheduled")
        || body_lower.contains("rescheduled")
        || body_lower.contains("moved to")
        || body_lower.contains("new date")
        || body_lower.contains("instead be held")
        || body_lower.contains("postponed to")
        || body_lower.contains("shifted to")
        || subject_has_scheduling;

    let is_cancellation_notice =
        (contains_any_ascii_word(subject_lower, &["cancellation", "cancelled", "canceled"])
            || subject_lower.contains("called off")
            || subject_lower.contains("postponed until further notice")
            || body_lower.contains("cancelled until further notice")
            || body_lower.contains("canceled until further notice"))
            && !has_reschedule_or_remake;
    if is_cancellation_notice {
        return false;
    }

    let is_solution_or_material_only = (subject_lower.contains("model answer")
        || subject_lower.contains("answer key")
        || subject_lower.contains("solution posted")
        || subject_lower.contains("solutions posted")
        || subject_lower.contains("solution uploaded")
        || subject_lower.contains("solutions uploaded")
        || subject_lower.contains("solution sheet")
        || subject_lower.contains("marking scheme")
        || subject_lower.contains("grading rubric")
        || subject_lower.contains("appeal")
        || subject_lower.contains("upload your course materials")
        || ((contains_ascii_word(subject_lower, "slides")
            || contains_ascii_phrase(subject_lower, "notes uploaded")
            || contains_ascii_phrase(subject_lower, "recording available"))
            && !subject_has_core_assessment
            && !subject_has_scheduling
            && !body_lower.contains("will be held")))
        && !has_remake;
    if is_solution_or_material_only {
        return false;
    }

    // Commercial product promos, subscriptions & student-discount blasts
    // (e.g., Gemini AI Plus / Quizlet / Spotify promos).
    let promo_hit = [
        "exclusive student offer",
        "student offer",
        "student discount",
        "claim your free",
        "activate your free",
        "free for students",
        "free access",
        "free subscription",
        "free trial",
        "limited-time offer",
        "limited time offer",
        "special offer",
        "promo code",
        "coupon code",
        "upgrade now",
        "upgrade to",
        "pricing plan",
        "google one",
        "gemini ai",
        "chatgpt plus",
        "quizlet plus",
        "grammarly",
        "perplexity",
        "unsubscribe from promotional",
    ]
    .iter()
    .any(|p| subject_lower.contains(p) || body_lower.contains(p));
    let promo_footer_combo = (body_lower.contains("unsubscribe")
        || body_lower.contains("manage email preferences")
        || body_lower.contains("view in browser"))
        && contains_any_ascii_word(
            body_lower,
            &["offer", "discount", "subscription", "upgrade", "trial"],
        );
    if (promo_hit || promo_footer_combo) && !from_is_lms && !has_remake {
        let has_course_tag = find_course_code(subject_lower).is_some();
        if !(has_course_tag && subject_has_core_assessment) {
            return false;
        }
    }

    // Extracurricular workshops, webinars, career events, club trivia nights,
    // external coding assessments & student club/activities notices.
    // Org branding is matched against the sender and subject only: a course
    // email that merely mentions an office ("cc: student affairs") in its
    // body must not be dropped, while club blasts brand themselves in the
    // From address or the subject line.
    let org_event_hit = [
        "activities dept",
        "activities department",
        "student activities",
        "student affairs",
        "student union",
        "student club",
        "career center",
        "career services",
        "careers office",
        "digital content & activities",
        "digital content and activities",
    ]
    .iter()
    .any(|p| from_lower.contains(p) || subject_lower.contains(p));
    let club_quiz_hit = find_course_code(subject_lower).is_none()
        && (contains_ascii_phrase(subject_lower, "quiz night")
            || contains_ascii_phrase(subject_lower, "trivia quiz")
            || contains_ascii_phrase(subject_lower, "trivia night")
            || contains_ascii_phrase(subject_lower, "pub quiz")
            || contains_ascii_word(subject_lower, "kahoot"));
    let external_recruiting_hit = find_course_code(subject_lower).is_none()
        && (contains_ascii_phrase(subject_lower, "coding assessment")
            || contains_ascii_phrase(subject_lower, "online assessment")
            || contains_ascii_phrase(subject_lower, "coding challenge")
            || contains_ascii_phrase(subject_lower, "technical assessment")
            || contains_ascii_word(body_lower, "hackerrank")
            || contains_ascii_word(body_lower, "codility")
            || contains_ascii_word(body_lower, "codesignal"))
        && (contains_any_ascii_word(
            subject_lower,
            &["intern", "internship", "career", "recruiting"],
        ) || contains_any_ascii_word(
            body_lower,
            &["internship", "application", "recruiting", "recruitment"],
        ) || body_lower.contains("software engineer")
            || body_lower.contains("talent acquisition"));
    let workshop_subject_hit = [
        "workshop",
        "webinar",
        "hackathon",
        "bootcamp",
        "career fair",
        "job fair",
        "info session",
        "information session",
        "open house",
        "guest lecture",
        "guest speaker",
        "networking event",
        "panel discussion",
    ]
    .iter()
    .any(|p| contains_ascii_phrase(subject_lower, p));
    let workshop_body_hit = [
        "hands-on workshop",
        "register now",
        "register here",
        "reserve your spot",
        "reserve your seat",
        "limited seats",
        "rsvp",
        "scan the qr",
        "fun quiz",
        "trivia quiz",
    ]
    .iter()
    .any(|p| contains_ascii_phrase(body_lower, p));

    if !from_is_lms && !has_remake {
        if org_event_hit
            && !(find_course_code(subject_lower).is_some() && subject_has_core_assessment)
        {
            return false;
        }
        if club_quiz_hit || external_recruiting_hit {
            return false;
        }
        if workshop_subject_hit && !subject_has_core_assessment {
            return false;
        }
        if workshop_body_hit
            && !subject_has_core_assessment
            && !contains_ascii_word(body_lower, "midterm")
            && !contains_ascii_phrase(body_lower, "final exam")
        {
            return false;
        }
    }

    if has_assessment_keyword(subject_lower) {
        return true;
    }

    if has_assessment_keyword(body_lower) {
        if from_is_lms {
            return true;
        }
        if body_has_scheduling {
            return true;
        }
    }

    false
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
/// addresses yield `None` — an address is not an instructor name, and the
/// fetcher's `"(Unknown Sender)"` placeholder is not one either.
fn instructor_from(from: &str) -> Option<String> {
    let with_quotes = from.split('<').next().unwrap_or("");
    let no_groups = strip_via_groups(with_quotes.replace('"', "").as_str());
    let name = no_groups.trim();
    if name.is_empty() || name.contains('@') || is_placeholder_header(name) {
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

/// Type ladder: midterm first, final exam second (excluding disciplinary/attendance
/// negative phrasing), online quiz third, assignment/lab/class quiz after, with
/// explicit subject cues preventing body chatter from hijacking a titled Quiz.
fn classify_assessment(lower: &str, subject_lower: &str) -> AssessmentType {
    let scrubbed_for_final = lower
        .replace("barred from the final exam", "")
        .replace("barred from final exam", "")
        .replace("deprived of the final exam", "")
        .replace("deprived from the final exam", "");
    let subject_mentions_quiz = contains_any_ascii_word(subject_lower, &["quiz", "quizzes"])
        || contains_ascii_prefix_digits(subject_lower, "quiz");
    let subject_mentions_assignment =
        contains_any_ascii_word(subject_lower, &["assignment", "assignments"]);
    let subject_is_midterm =
        contains_ascii_word(subject_lower, "midterm") || subject_lower.contains("mid-term");
    let subject_is_final = contains_ascii_phrase(subject_lower, "final exam");

    if subject_is_midterm
        || ((contains_ascii_word(lower, "midterm") || lower.contains("mid-term"))
            && !subject_mentions_quiz
            && !subject_mentions_assignment)
    {
        AssessmentType::MidtermExam
    } else if subject_is_final
        || (contains_ascii_phrase(&scrubbed_for_final, "final exam")
            && !subject_mentions_quiz
            && !subject_mentions_assignment)
    {
        AssessmentType::FinalExam
    } else if lower.contains("online quiz") || lower.contains("/mod/quiz/") {
        AssessmentType::OnlineQuiz
    } else if subject_mentions_assignment
        || (lower.contains("in-class assignment") && !subject_mentions_quiz)
    {
        AssessmentType::Assignment
    } else if lower.contains("lab session")
        || lower.contains("during the lab")
        || lower.contains("lab exam")
        || lower.contains("lab quiz")
        || lower.contains("lab assessment")
    {
        AssessmentType::LabAssessment
    } else {
        AssessmentType::ClassQuiz
    }
}

/// Type ladder for calendar items (`summary` + `description`), used by
/// `ics.rs` and Classroom coursework. Word-boundary checks prevent `"syllabus"`
/// or `"available"` from matching `"lab"`, and explicit Quiz summaries stay quizzes
/// even if the body says `"assignment"`.
#[must_use]
pub fn classify_ics_text(summary: &str, description: &str) -> AssessmentType {
    let summary_lower = summary.to_ascii_lowercase();
    let desc_lower = description.to_ascii_lowercase();
    let text = format!("{summary_lower} {desc_lower}");

    if contains_ascii_word(&text, "midterm") || text.contains("mid-term") {
        AssessmentType::MidtermExam
    } else if contains_ascii_phrase(&text, "final exam") {
        AssessmentType::FinalExam
    } else if contains_any_ascii_word(&summary_lower, &["quiz", "quizzes"])
        || contains_ascii_prefix_digits(&summary_lower, "quiz")
    {
        AssessmentType::OnlineQuiz
    } else if contains_any_ascii_word(&text, &["lab", "laboratory"])
        || contains_ascii_phrase(&text, "lab assessment")
    {
        AssessmentType::LabAssessment
    } else if contains_any_ascii_word(&text, &["assignment", "assignments"]) {
        AssessmentType::Assignment
    } else {
        AssessmentType::OnlineQuiz
    }
}

/// Title ladder (v4 order: quiz 3 → 2 → 1, then midterm, then the subject).
/// No fabricated course labels: courseless quiz titles keep just the number
/// (`"Quiz 1"`, not v4's `"GENERAL"`). A missing subject stays generic —
/// the fetcher's `"(No Subject)"` placeholder is a label, not a title.
fn decide_title(
    lower: &str,
    course_code: Option<&str>,
    assessment_type: AssessmentType,
    subject: &str,
) -> String {
    for quiz in (1..=3).rev() {
        // Word-boundary check: `contains("quiz 1")` also matched "quiz 10"
        // and "quiz 12", fabricating a wrong number (and a different dedupe
        // key) for courses past nine quizzes.
        let needle = format!("quiz {quiz}");
        let matched = lower.match_indices(&needle).any(|(at, _)| {
            lower[at + needle.len()..]
                .chars()
                .next()
                .is_none_or(|ch| !ch.is_ascii_digit())
        });
        if matched {
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
    let cleaned_subject = clean_inline_decorations(subject);
    if cleaned_subject.is_empty() || is_placeholder_header(&cleaned_subject) {
        return UNTITLED_ASSESSMENT.to_string();
    }
    cleaned_subject
}

// ---------------------------------------------------------------------------
// Topics / warnings / study plan (honest v5 replacements for v4 hardcoding)
// ---------------------------------------------------------------------------

fn strip_list_marker(line: &str) -> (bool, bool, &str) {
    let trimmed = line.trim();
    // Bullet prefixes (`•`, `-`, `*`, `▪`, `◦`, `‣`), avoiding `--` divider rules.
    if let Some(first) = trimmed.chars().next() {
        if matches!(first, '•' | '▪' | '◦' | '‣')
            || (matches!(first, '-' | '*') && !trimmed.starts_with("--"))
        {
            let rest = trimmed
                .trim_start_matches(['•', '▪', '◦', '‣', '-', '*'])
                .trim_start();
            return (true, false, rest);
        }
    }
    // Numbered list prefixes: `1. ...`, `2) ...`, `(1) ...` (1 or 2 digits, followed by space).
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_digit() {
        let mut idx = 1usize;
        if idx < bytes.len() && bytes[idx].is_ascii_digit() {
            idx += 1;
        }
        if idx < bytes.len() && matches!(bytes[idx], b'.' | b')') {
            let after_sep = &trimmed[idx + 1..];
            if after_sep.starts_with(char::is_whitespace) {
                return (false, true, after_sep.trim_start());
            }
        }
    }
    if let Some(after_open) = trimmed.strip_prefix('(') {
        let inner = after_open.as_bytes();
        if inner.len() >= 3 && inner[0].is_ascii_digit() {
            let mut idx = 1usize;
            if idx < inner.len() && inner[idx].is_ascii_digit() {
                idx += 1;
            }
            if idx < inner.len() && inner[idx] == b')' {
                let after = &after_open[idx + 1..];
                if after.starts_with(char::is_whitespace) {
                    return (false, true, after.trim_start());
                }
            }
        }
    }
    (false, false, trimmed)
}

fn is_closing_signature_line(lower: &str) -> bool {
    let prefixes = [
        "best regards",
        "kind regards",
        "warm regards",
        "regards,",
        "sincerely",
        "yours sincerely",
        "with gratitude",
        "thanks,",
        "thank you,",
        "cheers,",
        "sent from my",
        "to unsubscribe",
    ];
    prefixes.iter().any(|p| lower.starts_with(p)) || lower == "regards" || lower == "thanks"
}

fn is_metadata_key_prefix(lower: &str) -> bool {
    let keys = [
        "time",
        "date",
        "day",
        "room",
        "location",
        "venue",
        "hall",
        "section",
        "sections",
        "group",
        "groups",
        "duration",
        "when",
        "where",
        "instructor",
        "professor",
        "lecturer",
        "ta",
        "course",
        "link",
        "url",
        "platform",
        "format",
        "weight",
        "weightage",
        "grade",
        "grades",
        "marks",
        "points",
        "total marks",
        "submission",
        "deadline",
        "due",
        "due date",
        "note",
        "notes",
        "from",
        "to",
        "sent",
        "subject",
    ];
    let Some((label, _rest)) = lower.split_once(':') else {
        return false;
    };
    let clean_label = label.trim();
    keys.contains(&clean_label)
}

fn match_topic_section_header(cleaned: &str) -> Option<&str> {
    let trimmed = cleaned.trim();
    if let Some((label, inline)) = trimmed.split_once(':') {
        let clean_label = label.trim();
        let lower_label = clean_label.to_ascii_lowercase();
        let exact_labels = [
            "topics covered",
            "covered topics",
            "topics included",
            "included topics",
            "topics for the quiz",
            "topics for the exam",
            "topics for the midterm",
            "exam topics",
            "quiz topics",
            "topics",
            "topic",
            "syllabus",
            "material covered",
            "covered material",
            "material included",
            "exam material",
            "quiz material",
            "scope of the exam",
            "scope",
            "will cover",
            "covers",
            "study guide",
        ];
        if exact_labels.contains(&lower_label.as_str()) {
            return Some(inline.trim());
        }
        // Extended headings such as "Topics covered in Quiz 2:" or "Quiz 2 will cover:"
        let trimmed_lower = trimmed.to_ascii_lowercase();
        if clean_label.chars().count() <= 56 && !is_metadata_key_prefix(&trimmed_lower) {
            let matches_phrase = [
                "topics covered",
                "covered topics",
                "topics included",
                "topics for ",
                "chapters covered",
                "chapters included",
                "material covered",
                "material included",
                "material for ",
                "exam scope",
                "quiz scope",
                "midterm scope",
                "study guide",
            ]
            .iter()
            .any(|p| lower_label.contains(p))
                || lower_label.ends_with("will cover")
                || lower_label.ends_with(" covers");
            if matches_phrase {
                return Some(inline.trim());
            }
        }
        return None;
    }

    // Colonless headings on their own line (e.g. "Topics covered in Quiz 2")
    let lower = trimmed.to_ascii_lowercase();
    if trimmed.chars().count() <= 45
        && !trimmed.ends_with('.')
        && [
            "topics covered",
            "covered topics",
            "topics included",
            "topics for ",
            "material covered",
            "syllabus",
        ]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return Some("");
    }
    None
}

fn is_topic_section_header(lower: &str) -> Option<&'static str> {
    match_topic_section_header(lower).map(|_| "")
}

/// Returns `true` when `cleaned` is metadata, a greeting/signature, URL,
/// procedural exam rule, or conversational noise rather than a study topic.
#[must_use]
pub(crate) fn is_non_topic_text(cleaned: &str) -> bool {
    let trimmed = cleaned.trim();
    if trimmed.chars().count() <= 3 {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("http://") || lower.contains("https://") || lower.contains("mailto:") {
        return true;
    }
    if is_metadata_key_prefix(&lower) || is_closing_signature_line(&lower) {
        return true;
    }
    // Greetings / filler / contact pointers
    let non_topic_starts = [
        "dear ",
        "hello",
        "hi ",
        "good morning",
        "good afternoon",
        "good evening",
        "good luck",
        "all the best",
        "please find",
        "please note",
        "let me know",
        "if you have any questions",
        "for more details",
        "for more information",
        "do not reply",
        "unsubscribe",
    ];
    if non_topic_starts.iter().any(|p| lower.starts_with(p)) {
        return true;
    }
    // Pure clock ranges or single time tokens (e.g. "1:00 PM", "1:00 PM - 2:30 PM")
    if contains_time_meridiem(&lower)
        && trimmed.split_whitespace().count() <= 6
        && !lower.contains("chapter")
        && !lower.contains("lecture")
    {
        return true;
    }
    // Procedural / logistical exam rules that belong in warnings or prose, not study checkboxes
    let rule_phrases = [
        "you are allowed",
        "are not allowed",
        "strictly prohibited",
        "not permitted",
        "make sure to",
        "please make sure",
        "ensure that you",
        "adhere to your",
        "registered group",
        "registered lecture",
        "registered section",
        "assigned group",
        "assigned slot",
        "assigned time slot",
        "bring your",
        "do not forget to",
        "don't forget to",
        "remember to bring",
        "one a4",
        "a4 page",
        "a4 sheet",
        "handwritten on",
        "cheat sheet",
        "formula sheet",
        "no calculators",
        "programmable calculator",
        "mobile phone",
        "smartwatch",
        "electronic device",
        "cannot go back",
        "will not be able to go back",
        "please arrive",
        "be on time",
        "seat number",
        "student id card",
        "bring your student id",
        "late submission",
        "no makeup",
        "no make-up",
        "calculators are",
        "no calculator",
        "not allowed to",
        "must be submitted",
        "submit your",
        "submission via",
        "upload your",
        "please bring",
        "students must",
        "arriving late",
        "exam duration",
        "quiz duration",
        "duration of the",
        "time limit",
        "academic integrity",
        "plagiarism policy",
        "attendance is mandatory",
        "attendance will be taken",
    ];
    if rule_phrases.iter().any(|p| lower.contains(p)) {
        return true;
    }
    // Must contain at least two letters so divider lines or numeric stubs stay out.
    let letter_count = trimmed.chars().filter(|c| c.is_alphabetic()).count();
    letter_count < 2
}

fn ends_with_wrap_connector(prev: &str, prev_raw_len: usize, prev_was_list_item: bool) -> bool {
    let trimmed = prev.trim_end();
    if trimmed.ends_with(['-', '&', '/', '(']) {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    let is_salutation = [
        "dear ",
        "hello",
        "hi ",
        "good morning",
        "good afternoon",
        "good evening",
    ]
    .iter()
    .any(|p| lower.starts_with(p));
    if is_salutation {
        return false;
    }
    if trimmed.ends_with(',') && (prev_raw_len >= 35 || prev_was_list_item) {
        return true;
    }
    let Some(last_word) = trimmed.split_whitespace().last() else {
        return false;
    };
    let word = last_word
        .trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .to_ascii_lowercase();
    matches!(
        word.as_str(),
        "and"
            | "or"
            | "of"
            | "in"
            | "on"
            | "at"
            | "to"
            | "for"
            | "from"
            | "with"
            | "by"
            | "the"
            | "a"
            | "an"
            | "covering"
            | "including"
            | "using"
            | "about"
            | "until"
            | "through"
    )
}

fn unwrap_logical_lines(announcement: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    let mut prev_raw_len = 0usize;
    let mut prev_was_list_item = false;

    for raw_line in announcement.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            if blocks.last().is_some_and(|s| !s.is_empty()) {
                blocks.push(String::new());
            }
            prev_raw_len = 0;
            prev_was_list_item = false;
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if is_closing_signature_line(&lower) {
            break;
        }
        let (is_bullet, is_numbered, _) = strip_list_marker(trimmed);
        let starts_label =
            is_metadata_key_prefix(&lower) || is_topic_section_header(&lower).is_some();
        let is_indented = raw_line.starts_with([' ', '\t']);
        let starts_scope_heading = [
            "chapter ",
            "chapters ",
            "lecture ",
            "lectures ",
            "unit ",
            "module ",
            "section ",
            "week ",
        ]
        .iter()
        .any(|p| lower.starts_with(p));
        let prev_looks_wrapped = blocks.last().is_some_and(|prev| {
            !prev.is_empty()
                && !prev.ends_with(['.', '!', '?', ':'])
                && (prev_raw_len >= 55
                    || is_indented
                    || ends_with_wrap_connector(prev, prev_raw_len, prev_was_list_item))
                && !(prev_was_list_item
                    && starts_scope_heading
                    && !is_indented
                    && !ends_with_wrap_connector(prev, prev_raw_len, prev_was_list_item))
        });

        let should_start_new = blocks.is_empty()
            || blocks.last().is_some_and(String::is_empty)
            || is_bullet
            || is_numbered
            || starts_label
            || !prev_looks_wrapped;

        if should_start_new {
            if blocks.last().is_some_and(String::is_empty) {
                blocks.pop();
            }
            blocks.push(trimmed.to_string());
            prev_was_list_item = is_bullet || is_numbered;
        } else if let Some(last) = blocks.last_mut() {
            last.push(' ');
            last.push_str(trimmed);
        }
        prev_raw_len = trimmed.chars().count();
    }
    blocks.into_iter().filter(|s| !s.is_empty()).collect()
}

fn push_unique_topic(items: &mut Vec<String>, candidate: String, max_topics: usize) -> bool {
    let cleaned = clean_inline_decorations(&candidate);
    let cleaned = cleaned.trim_end_matches([';', ',']).trim().to_string();
    if cleaned.chars().count() > 140 || cleaned.split_whitespace().count() > 18 {
        return false;
    }
    if is_non_topic_text(&cleaned) {
        return false;
    }
    let key = cleaned.to_ascii_lowercase();
    if items
        .iter()
        .any(|existing| existing.to_ascii_lowercase() == key)
    {
        return false;
    }
    items.push(cleaned);
    items.len() >= max_topics
}

/// Extracts clean, unwrapped, de-duplicated syllabus topic strings without a
/// fallback item (shared by email and ICS/Classroom extractors).
#[must_use]
pub(crate) fn extract_topics_from_text(announcement: &str, max_topics: usize) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    let mut in_topic_section = false;

    for block in unwrap_logical_lines(announcement) {
        let block_cleaned = clean_inline_decorations(&block);
        if block_cleaned.is_empty() {
            continue;
        }
        let lower_block = block_cleaned.to_ascii_lowercase();

        // Check explicit "Topics:" / "Syllabus:" headers (potentially inline CSV/list)
        if let Some(inline) = match_topic_section_header(&block_cleaned) {
            in_topic_section = true;
            if !inline.is_empty() {
                if inline.contains(',') || inline.contains(';') {
                    for part in inline.split([';', ',']) {
                        let part = part
                            .trim()
                            .strip_prefix("and ")
                            .or_else(|| part.trim().strip_prefix("And "))
                            .unwrap_or(part)
                            .trim();
                        if !part.is_empty()
                            && push_unique_topic(&mut items, part.to_string(), max_topics)
                        {
                            return items;
                        }
                    }
                } else if push_unique_topic(&mut items, inline.to_string(), max_topics) {
                    return items;
                }
            }
            continue;
        }

        let (is_bullet, is_numbered, body_after_marker) = strip_list_marker(&block);
        let stripped = clean_inline_decorations(body_after_marker);
        if stripped.is_empty() {
            continue;
        }
        let lower_stripped = stripped.to_ascii_lowercase();

        if is_bullet {
            if push_unique_topic(&mut items, stripped, max_topics) {
                return items;
            }
            continue;
        }

        let has_concrete_scope_term = contains_any_ascii_word(
            &lower_stripped,
            &[
                "chapter",
                "chapters",
                "lecture",
                "lectures",
                "unit",
                "units",
                "module",
                "modules",
                "section",
                "sections",
                "week",
                "weeks",
                "topic",
                "topics",
                "tutorial",
                "tutorials",
                "sheet",
                "sheets",
                "deck",
                "slides",
            ],
        );

        let is_conversational_or_logistics = [
            "we ",
            "you ",
            "your ",
            "please ",
            "students ",
            "all students",
            "kindly ",
            "attend ",
            "submit ",
            "upload ",
            "check ",
            "make sure",
            "remember ",
            "do not ",
            "don't ",
            "the quiz ",
            "this quiz ",
            "the exam ",
            "this exam ",
            "the midterm ",
            "note that",
            "for more",
            "good luck",
            "if you",
        ]
        .iter()
        .any(|p| lower_stripped.starts_with(p));

        if is_numbered {
            // Outside an explicit "Topics:" section, skip numbered administrative prose
            // starting with conversational cues ("1. We have...", "2. Please check...")
            // unless it names concrete syllabus units/chapters.
            if (in_topic_section || has_concrete_scope_term)
                && !(is_conversational_or_logistics && !in_topic_section)
                && push_unique_topic(&mut items, stripped, max_topics)
            {
                return items;
            }
            continue;
        }

        // Unbulleted lines directly beneath a `Topics:` heading (including HTML `<ul><li>` blocks
        // converted to plain lines by `strip_html_tags`) count while concise and non-procedural.
        if in_topic_section {
            let word_count = stripped.split_whitespace().count();
            let looks_like_sentence = stripped.ends_with(['!', '?'])
                || (stripped.ends_with('.')
                    && (word_count > 6
                        || contains_any_ascii_word(
                            &lower_stripped,
                            &[
                                "is", "are", "was", "were", "will", "be", "have", "has", "can",
                                "must", "should",
                            ],
                        )));
            if is_metadata_key_prefix(&lower_block)
                || is_closing_signature_line(&lower_stripped)
                || is_non_topic_text(&stripped)
                || is_conversational_or_logistics
                || looks_like_sentence
                || word_count > 12
                || contains_time_meridiem(&lower_stripped)
                || find_explicit_date(&lower_stripped).is_some()
            {
                in_topic_section = false;
            } else if push_unique_topic(&mut items, stripped, max_topics) {
                return items;
            }
            continue;
        }

        // Non-bulleted prose lines outside a topics block only count when they concisely
        // state a lecture/chapter scope.
        let mentions_scope = contains_any_ascii_word(
            &lower_stripped,
            &["lecture", "lectures", "chapter", "chapters"],
        );
        if mentions_scope {
            in_topic_section = false;
            if push_unique_topic(&mut items, stripped, max_topics) {
                return items;
            }
        } else if is_metadata_key_prefix(&lower_block) {
            in_topic_section = false;
        }
    }

    items
}

/// Topic extraction for lecture-note announcements: bullet lines, explicit
/// topics sections, or concise lecture/chapter scope lines (with hard wraps
/// rejoined and Markdown/metadata/exam-rules filtered). Falls back honestly to
/// pointing at the course page when no syllabus topics are stated.
fn extract_topics(announcement: &str, course_code: Option<&str>) -> Vec<String> {
    let mut items = extract_topics_from_text(announcement, MAX_TOPICS);
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
            // The stop set must include HTML delimiters: URL extraction runs
            // on the RAW body, and `<a href="…">` otherwise stored the
            // quote/tag tail as part of the link.
            while j < len
                && !chars[j].is_whitespace()
                && chars[j] != ']'
                && chars[j] != '"'
                && chars[j] != '\''
                && chars[j] != '<'
                && chars[j] != '>'
            {
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
    let announcement_clean = strip_forwarded_header_blocks(&announcement);

    let subject_lower = email.subject.to_ascii_lowercase();
    let announcement_lower = announcement_clean.to_ascii_lowercase();
    let lower = format!("{subject_lower} {announcement_lower}");

    let sent_date = parse_email_sent_date(&email.date);
    let anchor = sent_date.unwrap_or(ref_date);

    let subj_and_announcement = format!("{} {announcement}", email.subject);
    let matched = match_course_from_text(&subj_and_announcement, schedule);
    let course = matched.map(|(c, _)| c);
    let (course_id, course_name) = match course {
        Some(c) => (Some(c.id.clone()), Some(c.name.clone())),
        None => {
            let raw_code = find_course_code(&subj_and_announcement);
            (raw_code, None)
        }
    };
    let instructor = instructor_from(&email.from);

    // Date ladder: explicit → week-phrase estimate (snapped forward to the
    // nearest candidate slot weekday) → undated draft (no invented date).
    let preferred = preferred_slot_type(&lower);
    let candidates = candidate_slots(schedule, course_id.as_deref(), preferred);
    let explicit_date = find_explicit_date(&lower);
    let week_phrase = find_week_phrase(&lower);
    let base_date = explicit_date
        .or_else(|| week_phrase.map(|phrase| anchor + Duration::days(phrase.offset_days())));
    // The note quotes the wording the estimate came from — a bare "not this
    // week" must never be reported as "this/next week".
    let phrase_wording = week_phrase.map_or("the week wording", WeekPhrase::wording);
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

    let elearning_url = find_announcement_url(&email.body);
    let url_hint = elearning_url
        .as_deref()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let lower_for_classify = if url_hint.is_empty() {
        lower.clone()
    } else {
        format!("{lower} {url_hint}")
    };
    let assessment_type = classify_assessment(&lower_for_classify, &subject_lower);
    let title = decide_title(
        &lower,
        course_id.as_deref(),
        assessment_type,
        &email.subject,
    );
    let topics = extract_topics(&announcement_clean, course_id.as_deref());
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
                "Estimated (local heuristic): the announcement had no explicit date — approximate timing inferred from wording (\"{phrase_wording}\"), snapped to the nearest {preferred} slot {slot_detail}. Configure a Gemini API key for precise extraction."
            )
        }
    } else {
        "No date in the announcement — needs manual confirmation; shown as an upcoming placeholder until a date is verified.".to_string()
    };
    // The study hours are a flat local heuristic, not a duration anybody
    // stated — the note has to say so wherever the estimate is attached.
    let ai_inference_note = format!(
        "{ai_inference_note} Study time is a flat {hours:.1} h local heuristic estimate — the announcement states no duration."
    );

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
        elearning_url,
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
        last_seen_source_run: None,
        retired_source_run: None,
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
///
/// The recency window ([`MAX_EMAIL_AGE_DAYS`], `01` §4.2 / §8) applies to
/// every announcement mail: a message that is already too old is dropped
/// before it can become an assessment, because a two-year-old "quiz next
/// week" must not stay on the radar forever. The drop is counted in
/// [`ScanStats::skipped_stale`] so the scan report can say what was skipped.
///
/// A message whose `Date:` header cannot be parsed has an UNKNOWN age: it is
/// neither proven fresh nor proven stale, so it is kept (dropping it would
/// destroy an announcement we merely cannot date) — but it is never counted
/// as fresh anywhere else either.
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
        if let Some(sent) = parse_email_sent_date(&email.date) {
            if !is_email_recent(sent, ref_date, MAX_EMAIL_AGE_DAYS) {
                stats.skipped_stale += 1;
                continue;
            }
        }
        let subject_lower = email.subject.to_ascii_lowercase();
        let body_for_filter = if looks_like_html(&email.body) {
            let stripped = strip_html_tags(&email.body);
            match find_announcement_url(&email.body) {
                Some(url) => format!("{stripped}\n{url}"),
                None => stripped,
            }
        } else {
            email.body.clone()
        };
        let body_lower = body_for_filter.to_ascii_lowercase();
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
            internal_date_ms: None,
            history_id: None,
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
                credits: None,
                max_absences: None,
                aliases: Vec::new(),
            },
            Course {
                id: "CSE346".to_string(),
                name: "Computer Networks".to_string(),
                color: "#4285f4".to_string(),
                bg: None,
                border: None,
                credits: None,
                max_absences: None,
                aliases: Vec::new(),
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
                week_parity: None,
            }
        };
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            academic_week_start: None,
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

    // --- recency window -------------------------------------------------------

    #[test]
    fn announcements_older_than_the_recency_window_are_skipped() {
        let schedule = fixture_schedule();
        let (items, stats) = parse_emails(
            &[announcement(
                "mail-old",
                "Quiz 1 heads up",
                "Dr. X <x@univ.edu>",
                "Sat, 01 Aug 2026 09:00:00 +0000",
                "CSE241 quiz 1 on 25 October 2026",
            )],
            &schedule,
            date(2026, 10, 23),
        );
        // 2026-10-23 − 2026-08-01 = 83 days ⇒ outside the 60-day window.
        assert!(
            items.is_empty(),
            "a stale announcement must not reach the radar"
        );
        assert_eq!(stats.scanned, 1);
        assert_eq!(stats.candidates, 0);
        assert_eq!(stats.parsed, 0);
        assert_eq!(stats.skipped_stale, 1, "the skip is counted, not hidden");
    }

    #[test]
    fn the_recency_window_boundary_is_inclusive() {
        let schedule = fixture_schedule();
        // 2026-10-23 − 2026-08-24 = exactly 60 days ⇒ still on the radar.
        let (items, stats) = parse_emails(
            &[announcement(
                "mail-60",
                "Quiz 1 heads up",
                "Dr. X <x@univ.edu>",
                "Mon, 24 Aug 2026 09:00:00 +0000",
                "CSE241 quiz 1 on 25 October 2026",
            )],
            &schedule,
            date(2026, 10, 23),
        );
        assert_eq!(items.len(), 1);
        assert_eq!(stats.skipped_stale, 0);

        // One day older (61 days) ⇒ dropped.
        let (items, stats) = parse_emails(
            &[announcement(
                "mail-61",
                "Quiz 1 heads up",
                "Dr. X <x@univ.edu>",
                "Sun, 23 Aug 2026 09:00:00 +0000",
                "CSE241 quiz 1 on 25 October 2026",
            )],
            &schedule,
            date(2026, 10, 23),
        );
        assert!(items.is_empty());
        assert_eq!(stats.skipped_stale, 1);
    }

    #[test]
    fn a_message_without_a_readable_date_is_kept_but_never_called_fresh() {
        let schedule = fixture_schedule();
        // The `Date:` header cannot be read ⇒ the age is UNKNOWN: the
        // announcement stays (dropping it would destroy mail we merely
        // cannot date) and it is not counted as recent anywhere.
        let (items, stats) = parse_emails(
            &[announcement(
                "mail-undated",
                "Quiz 2 heads up",
                "Dr. X <x@univ.edu>",
                "recently",
                "CSE241 quiz 2 on 27 October 2026",
            )],
            &schedule,
            date(2026, 10, 23),
        );
        assert_eq!(items.len(), 1);
        assert_eq!(stats.skipped_stale, 0);
        assert_eq!(items[0].email_sent_date, None);
    }

    // --- week wording ---------------------------------------------------------

    #[test]
    fn a_bare_not_this_week_never_anchors_to_this_week() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-negated",
            "CSE241 quiz 1",
            "Dr. X <x@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "The CSE241 tutorial quiz 1 is not this week.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        // Sent Sat 10-17 → the strict later-week anchor is +8 = Sun 10-25,
        // snapped forward to the next Tutorial slot: Tue 10-27. The old
        // "this week" branch anchored +3 = Tue 10-20 — an EARLIER date than
        // the announcement rules out.
        assert_eq!(parsed.date, Some(date(2026, 10, 27)));
        assert_eq!(parsed.day_name.as_deref(), Some("Tuesday"));
        assert_eq!(parsed.start_time, Some(time(11, 0)));
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.contains("inferred from wording (\"not this week\")"),
            "note was: {note}"
        );
        assert!(
            !note.contains("this/next week"),
            "the note must not claim a wording that was not written: {note}"
        );
    }

    #[test]
    fn the_strict_pair_still_wins_over_the_bare_negation() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-pair",
            "CSE241 quiz 1",
            "Dr. X <x@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "The CSE241 tutorial quiz 1 is next week, not this week.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.date, Some(date(2026, 10, 27)));
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.contains("inferred from wording (\"next week (not this week)\")"),
            "note was: {note}"
        );
    }

    // --- placeholder headers ---------------------------------------------------

    #[test]
    fn placeholder_headers_never_become_data() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-placeholder",
            PLACEHOLDER_SUBJECT,
            PLACEHOLDER_SENDER,
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "The class quiz will be held on 25 October 2026.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(
            parsed.instructor, None,
            "a placeholder sender is not an instructor"
        );
        assert_eq!(
            parsed.title, UNTITLED_ASSESSMENT,
            "a placeholder subject is not a title"
        );
        // The real facts the announcement did state are still read.
        assert_eq!(parsed.date, Some(date(2026, 10, 25)));
    }

    #[test]
    fn placeholder_recognition_is_case_insensitive() {
        assert!(is_placeholder_header("(No Subject)"));
        assert!(is_placeholder_header("  (no subject)  "));
        assert!(is_placeholder_header("(Unknown Sender)"));
        assert!(is_placeholder_header("(unknown sender)"));
        assert!(!is_placeholder_header("Dr. X <x@univ.edu>"));
        assert!(!is_placeholder_header(""));
        assert_eq!(instructor_from("(Unknown Sender)"), None);
        assert_eq!(instructor_from("(No Subject)"), None);
    }

    #[test]
    fn a_placeholder_subject_never_becomes_the_title() {
        let schedule = fixture_schedule();
        let (items, stats) = parse_emails(
            &[announcement(
                "mail-no-subject",
                PLACEHOLDER_SUBJECT,
                "e-learning@univ.edu",
                "Sat, 17 Oct 2026 09:00:00 +0000",
                "The online quiz opens on 25 October 2026.",
            )],
            &schedule,
            date(2026, 10, 23),
        );
        assert_eq!(stats.parsed, 1, "an e-learning quiz mail is a candidate");
        assert_eq!(items[0].title, UNTITLED_ASSESSMENT);
        assert_eq!(
            items[0].instructor, None,
            "a bare address is not an instructor name"
        );
    }

    // --- study-hour honesty ----------------------------------------------------

    #[test]
    fn the_inference_note_states_the_study_hour_heuristic() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-hours",
            "Quiz 1 heads up",
            "Dr. X <x@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "CSE241 quiz 1 on 25 October 2026.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.estimated_study_hours, Some(2.5));
        let note = parsed.ai_inference_note.clone().unwrap_or_default();
        assert!(
            note.contains("Study time is a flat 2.5 h local heuristic estimate"),
            "the flat estimate must be labeled: {note}"
        );
    }

    #[test]
    fn match_course_by_name_and_id_and_scanner() {
        let schedule = fixture_schedule();
        // 1. By ID
        let m1 = match_course_from_text("Midterm in CSE241 next week", &schedule);
        assert!(m1.is_some());
        assert_eq!(m1.unwrap().0.id, "CSE241");
        assert_eq!(m1.unwrap().1, "id-match");

        // 2. By Name
        let m2 = match_course_from_text(
            "Midterm in Object-Oriented Programming next week",
            &schedule,
        );
        assert!(m2.is_some());
        assert_eq!(m2.unwrap().0.id, "CSE241");
        assert_eq!(m2.unwrap().1, "name-match");

        // 3. Spaced code via scanner
        let m3 = match_course_from_text("Quiz in CSE 346 tomorrow", &schedule);
        assert!(m3.is_some());
        assert_eq!(m3.unwrap().0.id, "CSE346");

        // 4. Non-matching text
        let m4 = match_course_from_text("Welcome back everyone", &schedule);
        assert!(m4.is_none());
    }

    #[test]
    fn match_course_by_alias() {
        let mut schedule = fixture_schedule();
        schedule.courses[0].aliases = vec!["CS241".to_string(), "COMP-241".to_string()];
        let m1 = match_course_from_text("Quiz 1 for CS241 next Tuesday", &schedule);
        assert!(m1.is_some());
        assert_eq!(m1.unwrap().0.id, "CSE241");
        assert_eq!(m1.unwrap().1, "alias-match");

        let m2 = match_course_from_text("Lab in comp-241 tomorrow", &schedule);
        assert!(m2.is_some());
        assert_eq!(m2.unwrap().0.id, "CSE241");
    }

    #[test]
    fn candidate_filter_catches_assessment_in_body_with_schedule() {
        // Generic subject, but body clearly announces a scheduled quiz
        assert!(is_candidate_assessment_email(
            "class announcement",
            "prof@university.edu",
            "Dear students, please note that quiz 2 will take place on Wednesday at 10 am in hall 101."
        ));
        // Random body mention without scheduling should NOT match
        assert!(!is_candidate_assessment_email(
            "class announcement",
            "prof@university.edu",
            "Hope you enjoyed yesterday's lecture slides."
        ));
    }

    #[test]
    fn rejects_promo_student_offer_and_workshop_blasts() {
        assert!(!is_candidate_assessment_email(
            "Students: Unlock Gemini AI Plus free for one year",
            "Google AI <noreply@google.com>",
            "Get Google AI Pro for students free for a year. Offer ends next week."
        ));
        assert!(!is_candidate_assessment_email(
            "Reminder: Hands-on RAG Workshop ✨🚀",
            "Digital Content & Activities Dept <activities@univ.edu>",
            "Join our hands-on RAG workshop on Thursday at 2:00 PM in Hall 5. Register now!"
        ));
    }

    #[test]
    fn rejects_attendance_warning_and_evaluation_survey() {
        assert!(!is_candidate_assessment_email(
            "CSE354: First Attendance Warning",
            "Academic Advising <advising@univ.edu>",
            "Your attendance dropped below the threshold; further absences may result in being barred from the final exam."
        ));
        assert!(!is_candidate_assessment_email(
            "Mid-Semester Course Evaluation Survey",
            "Quality Assurance <qa@univ.edu>",
            "Please fill in the course evaluation survey for your enrolled courses before Sunday."
        ));
    }

    #[test]
    fn a_core_assessment_subject_survives_survey_grade_and_org_filters() {
        // A real quiz email that asks students to fill out a survey survives.
        assert!(is_candidate_assessment_email(
            "quiz 3",
            "instructor@university.edu",
            "quiz 3 will be held on sunday. please fill out the survey from last week."
        ));
        // A combined grades announcement keeps the upcoming quiz when the
        // subject itself carries scheduling language.
        assert!(is_candidate_assessment_email(
            "quiz 3 grades - quiz 4 moved to sunday",
            "instructor@university.edu",
            "quiz 4 covers chapter 5."
        ));
        // ...and when the scheduling language only appears in the body.
        assert!(is_candidate_assessment_email(
            "quiz 3 grades",
            "instructor@university.edu",
            "quiz 4 will be held on sunday in hall 3."
        ));
        // Pure grades notices stay rejected even with a core subject word.
        assert!(!is_candidate_assessment_email(
            "quiz 3 grades posted",
            "instructor@university.edu",
            "check the portal for your marks."
        ));
        assert!(!is_candidate_assessment_email(
            "midterm exam grades posted",
            "instructor@university.edu",
            "results are on the portal now."
        ));
        // An office mentioned only in the body footer must not drop a quiz.
        assert!(is_candidate_assessment_email(
            "quiz 3 on sunday",
            "instructor@university.edu",
            "quiz 3 is scheduled for sunday. cc: student affairs office."
        ));
        // Club blasts that brand themselves in the sender or subject stay rejected.
        assert!(!is_candidate_assessment_email(
            "student activities quiz night",
            "activities@university.edu",
            "join us for a fun quiz night, rsvp now!"
        ));
    }

    #[test]
    fn word_boundaries_stop_substring_false_positives() {
        assert!(!contains_ascii_word("this is the latest update", "test"));
        assert!(!contains_ascii_word(
            "programming contest on Friday",
            "test"
        ));
        assert!(!contains_ascii_word("join our team on campus", "am"));
        assert!(!contains_time_meridiem("join our team on campus"));
        assert!(!contains_ascii_word("see the updated syllabus", "lab"));
        assert!(!contains_ascii_word("materials are now available", "lab"));
        assert!(contains_time_meridiem("quiz at 10:30am tomorrow"));
        assert!(contains_ascii_word("midterm test on Monday", "test"));
    }

    #[test]
    fn quiz_type_is_not_hijacked_by_assignment_or_lab_words_in_body() {
        let schedule = fixture_schedule();
        let email = announcement(
            "mail-quiz-type",
            "Quiz 1: CSE241",
            "Dr. X <x@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "Quiz 1 on 25 October 2026. Please review your previous homework solutions and syllabus.",
        );
        let parsed = parse_email_announcement(&email, &schedule, date(2026, 10, 23));
        assert_eq!(parsed.assessment_type, AssessmentType::ClassQuiz);
    }

    #[test]
    fn topic_extraction_strips_decorations_excludes_metadata_and_rules_and_unwraps_continuations() {
        let body = "\
Dear students,
Reminder for ✨ **Quiz 2** 🚀
TIME: 1:00 PM - 2:30 PM
ROOM: Hall 102
Topics:
- Binary Search Trees and
  Balanced AVL Trees
- **Dynamic Programming** 📝
- You are allowed one A4 sheet handwritten on both sides
- Please make sure you attend your registered lecture section
For more details: https://lms.univ.edu/quiz2
Best regards,
Dr. X";
        let extracted = extract_topics(body, Some("CSE241"));
        assert_eq!(
            extracted,
            vec![
                "Binary Search Trees and Balanced AVL Trees",
                "Dynamic Programming",
            ]
        );

        let inline = "Topics covered: Finite Automata, Regular Expressions, and Context-Free Grammars\nROOM: H12";
        assert_eq!(
            extract_topics(inline, Some("CSE241")),
            vec![
                "Finite Automata",
                "Regular Expressions",
                "Context-Free Grammars",
            ]
        );
    }
}
