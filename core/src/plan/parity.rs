//! Week parity calculation (ISO 8601 calendar week and timetable-anchored week) and alternating slot matching.
//!
//! Honesty rules:
//! - Determines whether a calendar date is "week_a" or "week_b" based on the institution's timetable week start.
//! - Matches timetable slots by both weekday index and recurrence parity ("all", "week_a", "week_b").

use crate::parse::util::{weekday_index, weekday_to_index};
use crate::types::{ScheduleData, ScheduleSlot};
use chrono::{Datelike, NaiveDate, Weekday};

pub const DEFAULT_ANCHOR_DATE: (i32, u32, u32) = (2026, 1, 5); // Monday of Week 2

pub fn parse_weekday_name(name: &str) -> Option<Weekday> {
    match name.trim().to_ascii_lowercase().as_str() {
        "monday" | "mon" => Some(Weekday::Mon),
        "tuesday" | "tue" => Some(Weekday::Tue),
        "wednesday" | "wed" => Some(Weekday::Wed),
        "thursday" | "thu" => Some(Weekday::Thu),
        "friday" | "fri" => Some(Weekday::Fri),
        "saturday" | "sat" => Some(Weekday::Sat),
        "sunday" | "sun" => Some(Weekday::Sun),
        _ => None,
    }
}

pub fn timetable_week_start(schedule: &ScheduleData) -> (Weekday, Option<&'static str>) {
    if let Some(ref start) = schedule.academic_week_start {
        if let Some(wd) = parse_weekday_name(start) {
            return (wd, None);
        }
    }
    (
        Weekday::Mon,
        Some("Academic week start assumed Monday — set in timetable"),
    )
}

pub fn week_start_on_or_before(date: NaiveDate, week_start: Weekday) -> NaiveDate {
    let diff = (date.weekday().num_days_from_monday() + 7 - week_start.num_days_from_monday()) % 7;
    date - chrono::Duration::days(diff as i64)
}

pub fn date_week_parity_anchored(
    date: NaiveDate,
    anchor_date: NaiveDate,
    week_start: Weekday,
) -> &'static str {
    let w_date = week_start_on_or_before(date, week_start);
    let w_anchor = week_start_on_or_before(anchor_date, week_start);
    let weeks = (w_date - w_anchor).num_days() / 7;
    if weeks.rem_euclid(2) == 1 {
        "week_a"
    } else {
        "week_b"
    }
}

pub fn date_week_parity_for_schedule(date: NaiveDate, schedule: &ScheduleData) -> &'static str {
    let (week_start, _) = timetable_week_start(schedule);
    let anchor = NaiveDate::from_ymd_opt(
        DEFAULT_ANCHOR_DATE.0,
        DEFAULT_ANCHOR_DATE.1,
        DEFAULT_ANCHOR_DATE.2,
    )
    .unwrap_or(date);
    date_week_parity_anchored(date, anchor, week_start)
}

/// Returns "week_a" for odd ISO calendar weeks, and "week_b" for even ISO weeks.
#[must_use]
pub fn date_week_parity(date: NaiveDate) -> &'static str {
    if !date.iso_week().week().is_multiple_of(2) {
        "week_a"
    } else {
        "week_b"
    }
}

/// Checks whether a slot's parity configuration matches the given date.
#[must_use]
pub fn slot_matches_parity(slot: &ScheduleSlot, date: NaiveDate) -> bool {
    match slot
        .week_parity
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "all" | "" => true,
        "week_a" => date_week_parity(date) == "week_a",
        "week_b" => date_week_parity(date) == "week_b",
        _ => true,
    }
}

/// Checks whether a slot runs on the given date (matching both weekday and parity).
#[must_use]
pub fn slot_matches_date(slot: &ScheduleSlot, date: NaiveDate) -> bool {
    let target_day_index = weekday_to_index(date.weekday());
    weekday_index(&slot.day) == Some(target_day_index) && slot_matches_parity(slot, date)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use chrono::NaiveTime;

    fn sample_slot(parity: Option<&str>, day: &str) -> ScheduleSlot {
        ScheduleSlot {
            id: "slot-1".to_string(),
            day: day.to_string(),
            day_index: 1,
            course_id: "CSE101".to_string(),
            course_name: "Intro to CS".to_string(),
            slot_type: "Lecture".to_string(),
            group: None,
            room: None,
            start_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(10, 30, 0).unwrap(),
            display_time: "09:00–10:30".to_string(),
            has_quiz: false,
            quiz_title: None,
            week_parity: parity.map(str::to_string),
        }
    }

    #[test]
    fn parity_alternates_by_iso_week() {
        // 2026-10-19: Monday of ISO week 43 (odd -> week_a)
        let week43_mon = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
        assert_eq!(week43_mon.iso_week().week(), 43);
        assert_eq!(date_week_parity(week43_mon), "week_a");

        // 2026-10-26: Monday of ISO week 44 (even -> week_b)
        let week44_mon = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
        assert_eq!(week44_mon.iso_week().week(), 44);
        assert_eq!(date_week_parity(week44_mon), "week_b");
    }

    #[test]
    fn timetable_anchored_parity_saturday_first() {
        let schedule = ScheduleData {
            academic_week_start: Some("Saturday".to_string()),
            ..Default::default()
        };
        // Saturday 2026-10-17 and Sunday 2026-10-18 belong to the same academic week as Monday 2026-10-19
        let sat = NaiveDate::from_ymd_opt(2026, 10, 17).unwrap();
        let sun = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
        let mon = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
        let parity_sat = date_week_parity_for_schedule(sat, &schedule);
        let parity_sun = date_week_parity_for_schedule(sun, &schedule);
        let parity_mon = date_week_parity_for_schedule(mon, &schedule);

        assert_eq!(parity_sat, parity_sun);
        assert_eq!(parity_sun, parity_mon);
    }

    #[test]
    fn slot_matching_honors_parity() {
        let slot_all = sample_slot(Some("all"), "Mon");
        let slot_a = sample_slot(Some("week_a"), "Mon");
        let slot_b = sample_slot(Some("week_b"), "Mon");

        let week43_mon = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(); // week_a
        let week44_mon = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap(); // week_b
        let week43_tue = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(); // Tuesday

        assert!(slot_matches_date(&slot_all, week43_mon));
        assert!(slot_matches_date(&slot_all, week44_mon));

        assert!(slot_matches_date(&slot_a, week43_mon));
        assert!(!slot_matches_date(&slot_a, week44_mon));

        assert!(!slot_matches_date(&slot_b, week43_mon));
        assert!(slot_matches_date(&slot_b, week44_mon));

        // Wrong day of week
        assert!(!slot_matches_date(&slot_a, week43_tue));
    }
}
