//! Week parity calculation (ISO 8601 calendar week) and alternating slot matching.
//!
//! Honesty rules:
//! - Determines whether a calendar date is "week_a" (odd ISO week) or "week_b" (even ISO week).
//! - Matches timetable slots by both weekday index and recurrence parity ("all", "week_a", "week_b").

use crate::parse::util::{weekday_index, weekday_to_index};
use crate::types::ScheduleSlot;
use chrono::{Datelike, NaiveDate};

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
