//! Shared pure helpers for every parser: 12-hour formatting, weekday/month
//! names, semester inference and the urgency/priority ladders (`01` §3).
//! Everything here is deterministic and unit-table-tested — no hidden clock
//! or locale state ever enters a fixture test.

use chrono::{Datelike, NaiveDate, NaiveTime, Timelike, Weekday};

use crate::types::{AssessmentType, UrgencyLevel};

/// 64-bit FNV-1a over raw bytes — the one content-hash primitive
/// (uid-less ICS ids, Teams palette assignment, content-addressed topic
/// keys). Reference-vector-tested in `parse::ics`.
#[must_use]
pub(crate) fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Full weekday name (core owns display strings; the UI never formats dates).
#[must_use]
pub fn weekday_full_name(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Sun => "Sunday",
        Weekday::Mon => "Monday",
        Weekday::Tue => "Tuesday",
        Weekday::Wed => "Wednesday",
        Weekday::Thu => "Thursday",
        Weekday::Fri => "Friday",
        Weekday::Sat => "Saturday",
    }
}

/// v4 day name (`"Sun"`, `"Wed"`, …) → 0–6, Sunday-first. Accepts 3-letter
/// abbreviations and full names; `None` for unknown strings.
#[must_use]
pub fn weekday_index(day: &str) -> Option<u8> {
    let lowered = day.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "sun" | "sunday" => Some(0),
        "mon" | "monday" => Some(1),
        "tue" | "tuesday" => Some(2),
        "wed" | "wednesday" => Some(3),
        "thu" | "thursday" => Some(4),
        "fri" | "friday" => Some(5),
        "sat" | "saturday" => Some(6),
        _ => None,
    }
}

/// `Weekday` → v4 `day_index` (Sunday-first 0–6).
#[must_use]
pub fn weekday_to_index(weekday: Weekday) -> u8 {
    match weekday {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

/// Full month name for the 1–12 range.
#[must_use]
pub fn month_full_name(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        _ => "December",
    }
}

/// Formats a `NaiveTime` as v4's 12-hour string (`"9:05 AM"`, `"12:00 PM"`).
#[must_use]
pub fn format_12h(time: NaiveTime) -> String {
    let (hour, minute) = (time.hour(), time.minute());
    let am_pm = if hour >= 12 { "PM" } else { "AM" };
    let h12 = match hour {
        0 => 12,
        1..=12 => hour,
        _ => hour - 12,
    };
    format!("{h12}:{minute:02} {am_pm}")
}

/// Labels the academic semester a date falls into (e.g. `"Fall 2026"`).
/// Derived from the date itself so the parser keeps working in 2027+.
#[must_use]
pub fn infer_semester_from_date(date: NaiveDate) -> String {
    match date.month() {
        2..=5 => format!("Spring {}", date.year()),
        6..=8 => format!("Summer {}", date.year()),
        9..=12 => format!("Fall {}", date.year()),
        // January is ambiguous: early January usually belongs to the fall
        // term that started the previous September; late January can already
        // be the spring term.
        1 if date.day() <= 20 => format!("Fall {}", date.year() - 1),
        1 => format!("Spring {}", date.year()),
        _ => format!("Fall {}", date.year()),
    }
}

/// Days from `ref_date` to `date`; `None` when there is no (verifiable) date.
#[must_use]
pub fn days_until(date: Option<NaiveDate>, reference: NaiveDate) -> Option<i32> {
    let date = date?;
    Some(i32::try_from((date - reference).num_days()).unwrap_or(i32::MAX))
}

/// The urgency ladder (`01` §3 beats v4's divergent ICS ladder): critical
/// ≤2d, high ≤5d, medium ≤14d, `upcoming`, `past`. Undated items stay the
/// "upcoming" placeholder until a date is confirmed (maintainer decision).
#[must_use]
pub fn urgency_for(days_until: Option<i64>) -> UrgencyLevel {
    match days_until {
        None => UrgencyLevel::Upcoming,
        Some(days) if days < 0 => UrgencyLevel::Past,
        Some(0..=2) => UrgencyLevel::Critical,
        Some(3..=5) => UrgencyLevel::High,
        Some(6..=14) => UrgencyLevel::Medium,
        Some(_) => UrgencyLevel::Upcoming,
    }
}

/// Priority score 0–100 (v4 table, ported): urgency base + type bonus +
/// topic bonus, capped at 100. Past items score a fixed 10; undated items
/// have no urgency base (they sort below dated radar items).
#[must_use]
pub fn compute_priority_score(
    days_until: Option<i64>,
    ty: AssessmentType,
    topic_count: usize,
) -> u8 {
    let urgency_base: i32 = match days_until {
        Some(days) if days < 0 => return 10,
        Some(0) => 98,
        Some(1) => 95,
        Some(2) => 90,
        Some(3) => 84,
        Some(4) => 80,
        Some(5) => 76,
        Some(6..=7) => 70,
        Some(8..=14) => 60,
        Some(_) => 50,
        None => 0,
    };
    let type_bonus: i32 = match ty {
        AssessmentType::MidtermExam | AssessmentType::FinalExam => 12,
        AssessmentType::ClassQuiz | AssessmentType::OnlineQuiz => 6,
        AssessmentType::LabAssessment | AssessmentType::Assignment => 3,
    };
    let topic_bonus = (topic_count as i32).min(6);
    (urgency_base + type_bonus + topic_bonus).clamp(0, 100) as u8
}

/// `day_name` for a (possibly missing) date: `None` stays `None`.
#[must_use]
pub fn day_name_for(date: Option<NaiveDate>) -> Option<String> {
    date.map(|d| weekday_full_name(d.weekday()).to_string())
}

/// Pre-formatted display string for a dated assessment:
/// `"Sunday, 18 October 2026 (9:00 AM – 10:30 AM)"`. Known start with unknown
/// end renders as `"… (9:00 AM)"`; end-only never renders a fake start — the
/// string then omits the time entirely.
#[must_use]
pub fn build_display_time(
    date: NaiveDate,
    start: Option<NaiveTime>,
    end: Option<NaiveTime>,
) -> String {
    let date_text = format!(
        "{}, {} {} {}",
        weekday_full_name(date.weekday()),
        date.day(),
        month_full_name(date.month()),
        date.year()
    );
    match (start, end) {
        (Some(s), Some(e)) => format!("{date_text} ({} – {})", format_12h(s), format_12h(e)),
        (Some(s), None) => format!("{date_text} ({})", format_12h(s)),
        (None, _) => date_text,
    }
}
