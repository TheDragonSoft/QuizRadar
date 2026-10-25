//! Auto study-block candidate generation (`01` §3 "Study block",
//! §4.3 "Schedule smart study blocks" action): for a given day, list free
//! 90-minute windows inside 08:00–21:30, **evening first** (a block before
//! the night-before-an-exam respects bedtimes), excluding windows that
//! overlap the weekly timetable or a custom event on that day.
//!
//! The candidate *windows* are pure output; the caller (phase 07 desktop
//! shell) persists them as `study-block-{assessment_id}` custom events —
//! one per assessment, titled after it, dated the day before its exam
//! ([`block_date_for`] / [`block_id_for`] provide the exact convention the
//! planner's own [`crate::plan::conflicts`] then recognizes for
//! mitigation). Persisting is the caller's job, so no IO happens here and
//! the same candidates can be re-derived at any time.
//!
//! Interference semantics (honest, no fabricated rooms):
//! - a timetabled slot blocks any window it overlaps (weekday matched
//!   liberally via `weekday_index`, same-day interval semantics — slots
//!   spanning midnight are unsupported, as in v4)
//! - a custom event on the date blocks the windows it overlaps *only when
//!   it carries both times*; a dated event with unknown times is assumed
//!   busy for the whole day (a free window cannot be verified); an undated
//!   event can parry nothing.
//!
//! Timezone honesty (`03` §C7): windows live in the same naive local-time
//! domain as the timetable; the platform shell produced those
//! `NaiveTime`s once at its boundary (module docs in `plan::mod`).

use chrono::{Datelike, Duration, NaiveDate, NaiveTime};

use crate::parse::util::{weekday_index, weekday_to_index};
use crate::types::{CustomCalendarEvent, ScheduleData};

use serde::{Deserialize, Serialize};

/// One bookable candidate window for `date`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StudyBlockCandidate {
    pub date: NaiveDate,
    pub start: NaiveTime,
    pub end: NaiveTime,
}

/// Candidate windows, quantized every 90 minutes from 08:00 to 21:30
/// (starts 08:00, 09:30, … 20:00, each ending +90min), ordered by
/// preference: evening starts (≥16:00) first, earliest evening first so the
/// student still gets a reasonable bedtime before an exam; then the
/// afternoon starts nearest the evening; then the morning starts nearest
/// midday.
#[must_use]
pub fn study_window_candidates() -> Vec<(NaiveTime, NaiveTime)> {
    let midnight = NaiveTime::from_hms_opt(0, 0, 0).unwrap_or_default();
    let from_minutes = |minutes: u32| -> NaiveTime {
        NaiveTime::from_hms_opt(minutes / 60, minutes % 60, 0).unwrap_or(NaiveTime::MIN)
    };
    let mut windows: Vec<(NaiveTime, NaiveTime)> = Vec::new();
    let mut start_minutes = 8 * 60;
    while start_minutes <= 20 * 60 {
        windows.push((
            from_minutes(start_minutes),
            from_minutes(start_minutes + 90),
        ));
        start_minutes += 90;
    }
    windows.sort_by_key(|&(start, _)| {
        let minutes = (start - midnight).num_minutes() as u32;
        if minutes >= 16 * 60 {
            (0u8, minutes) // evening band: earliest first
        } else if minutes >= 12 * 60 {
            (1u8, 24 * 60 - minutes) // afternoon: nearest the evening first
        } else {
            (2u8, 24 * 60 - minutes) // morning: nearest midday first
        }
    });
    windows
}

/// Free candidate windows for `day`, evening-first: every candidate of
/// [`study_window_candidates`] that overlaps neither a timetabled slot on
/// that weekday nor a timed custom event on that date.
#[must_use]
pub fn study_block_candidates(
    schedule: &ScheduleData,
    custom_events: &[CustomCalendarEvent],
    day: NaiveDate,
) -> Vec<StudyBlockCandidate> {
    let target_day_index = weekday_to_index(day.weekday());
    study_window_candidates()
        .into_iter()
        .filter(|&(window_start, window_end)| {
            !schedule.slots.iter().any(|slot| {
                weekday_index(&slot.day) == Some(target_day_index)
                    && overlaps(slot.start_time, slot.end_time, window_start, window_end)
            })
        })
        .filter(|&(window_start, window_end)| {
            !custom_events.iter().any(|event| match event.date {
                None => false,
                Some(event_date) if event_date != day => false,
                Some(_) => match (event.start_time, event.end_time) {
                    (Some(start), Some(end)) => overlaps(start, end, window_start, window_end),
                    // Dated but untimed: a free window cannot be verified,
                    // so every window for that day stays unbookable.
                    _ => true,
                },
            })
        })
        .map(|(start, end)| StudyBlockCandidate {
            date: day,
            start,
            end,
        })
        .collect()
}

/// Same-day overlap: `[start, end)` intervals share more than a boundary.
/// (Half-open comparisons: touching intervals — `end ≤ other.start` — do
/// not conflict; v4 compared the same way on `HH:MM` strings.)
fn overlaps(a_start: NaiveTime, a_end: NaiveTime, b_start: NaiveTime, b_end: NaiveTime) -> bool {
    !(a_end <= b_start || a_start >= b_end)
}

/// The date an auto block for an assessment on `assessment_date` is booked
/// on: the day before the exam (desktop v4 semantics).
#[must_use]
pub fn block_date_for(assessment_date: NaiveDate) -> NaiveDate {
    assessment_date - Duration::days(1)
}

/// The stable id of the auto block for an assessment (the prefix
/// [`crate::plan::conflicts`] recognizes as mitigation).
#[must_use]
pub fn block_id_for(assessment_id: &str) -> String {
    format!("study-block-{assessment_id}")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::types::{CustomCalendarEvent, ScheduleSlot};

    // `hour`/`minute` helpers need `Timelike` in test-only scope.
    use chrono::Timelike;

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    fn slot(day_name: &str, day_index: u8, start_hour: u32, end_hour: u32) -> ScheduleSlot {
        ScheduleSlot {
            id: format!("slot-{day_name}-{start_hour}"),
            day: day_name.to_string(),
            day_index,
            course_id: "CSE241".to_string(),
            course_name: "Object-Oriented Programming".to_string(),
            slot_type: "Lecture".to_string(),
            group: Some("Sec 1".to_string()),
            room: Some("Hall A".to_string()),
            start_time: time(start_hour, 0),
            end_time: time(end_hour, 0),
            display_time: String::new(),
            has_quiz: false,
            quiz_title: None,
        }
    }

    fn timed_event(
        id: &str,
        date: NaiveDate,
        start_hour: u32,
        end_hour: u32,
    ) -> CustomCalendarEvent {
        CustomCalendarEvent {
            id: id.to_string(),
            title: "Custom".to_string(),
            course_id: None,
            event_type: None,
            date: Some(date),
            start_time: Some(time(start_hour, 0)),
            end_time: Some(time(end_hour, 0)),
            room: None,
            notes: None,
            color: None,
        }
    }

    fn minutes_at(time_in: NaiveTime) -> u32 {
        time_in.hour() * 60 + time_in.minute()
    }

    /// 2026-10-23 is a Friday; the fixture lecture lives on Sundays, so a
    /// fully free Friday yields every window in evening-first order.
    #[test]
    fn free_day_yields_every_window_in_fixed_evening_first_order() {
        let schedule = ScheduleData::default();
        let candidates = study_block_candidates(&schedule, &[], day(2026, 10, 23));
        let expected_start_minutes: [u32; 9] = [
            17 * 60,
            18 * 60 + 30,
            20 * 60,
            15 * 60 + 30,
            14 * 60,
            12 * 60 + 30,
            11 * 60,
            9 * 60 + 30,
            8 * 60,
        ];
        assert_eq!(candidates.len(), expected_start_minutes.len());
        for (candidate, expected_start) in candidates.iter().zip(expected_start_minutes) {
            assert_eq!(minutes_at(candidate.start), expected_start);
            assert_eq!(minutes_at(candidate.end), expected_start + 90);
        }
        assert_eq!(minutes_at(candidates[2].end), 21 * 60 + 30);
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.date)
                .collect::<Vec<_>>(),
            vec![day(2026, 10, 23); 9]
        );
    }

    /// A Sunday 08:00–10:00 lecture blocks the 08:00 and 09:30 windows and
    /// must be irrelevant on other weekdays.
    #[test]
    fn lecture_slots_block_windows_on_their_weekday_only() {
        let schedule = ScheduleData {
            slots: vec![slot("Sunday", 0, 8, 10)],
            courses: Vec::new(),
            semester: None,
        };
        let friday = study_block_candidates(&schedule, &[], day(2026, 10, 23));
        assert_eq!(
            friday.len(),
            9,
            "the Sunday lecture must not touch a Friday request"
        );

        let sunday = study_block_candidates(&schedule, &[], day(2026, 10, 25));
        let blocked: Vec<u32> = sunday
            .iter()
            .map(|candidate| minutes_at(candidate.start))
            .filter(|start| *start < 11 * 60)
            .collect();
        assert!(
            blocked.is_empty(),
            "windows under 11:00 must all be blocked by the 08:00–10:00 lecture, got {blocked:?}"
        );
        assert_eq!(sunday.len(), 7, "7 of 9 windows survive the lecture");
    }

    /// Touching boundaries do not conflict: a lecture ending 10:30 leaves
    /// the 10:30-onwards windows free, and a lecture starting 20:00 leaves
    /// up-to-20:00 windows free.
    #[test]
    fn touching_boundaries_do_not_conflict() {
        let schedule = ScheduleData {
            slots: vec![slot("Friday", 5, 9, 10)],
            courses: Vec::new(),
            semester: None,
        };
        let candidates = study_block_candidates(&schedule, &[], day(2026, 10, 23));
        // Blocks 08:00 (09:00 starts inside), 09:30; keeps 11:00 (ends 10:00 ≤ 11:00).
        assert_eq!(candidates.len(), 7);
        assert!(
            candidates
                .iter()
                .all(|candidate| minutes_at(candidate.start) >= 11 * 60),
            "free windows must start at 11:00 or later, found {:?}",
            candidates
                .iter()
                .map(|candidate| minutes_at(candidate.start))
                .collect::<Vec<_>>()
        );

        let late = ScheduleData {
            slots: vec![slot("Friday", 5, 20, 22)],
            courses: Vec::new(),
            semester: None,
        };
        let late_candidates = study_block_candidates(&late, &[], day(2026, 10, 23));
        assert_eq!(late_candidates.len(), 8);
        assert!(
            late_candidates
                .iter()
                .all(|candidate| minutes_at(candidate.end) <= 20 * 60),
            "the 20:00–21:30 window must be blocked by the 20:00 lecture"
        );
    }

    #[test]
    fn custom_events_block_their_windows_on_their_date_only() {
        let schedule = ScheduleData::default();
        let block_day = day(2026, 10, 23);
        let events = vec![timed_event("custom-1", block_day, 16, 18)];
        let candidates = study_block_candidates(&schedule, &events, block_day);
        let starts: Vec<u32> = candidates
            .iter()
            .map(|candidate| minutes_at(candidate.start))
            .collect();
        // 16:00–18:00 eats both the 15:30–17:00 and the 17:00–18:30 windows;
        // touching 18:30 stays free, the rest of the series is untouched.
        assert_eq!(
            starts,
            vec![
                18 * 60 + 30,
                20 * 60,
                14 * 60,
                12 * 60 + 30,
                11 * 60,
                9 * 60 + 30,
                8 * 60
            ]
        );

        // Same event, next day: full evening-first series again.
        let other_day = study_block_candidates(&schedule, &events, block_day + Duration::days(1));
        assert_eq!(other_day.len(), 9);
    }

    #[test]
    fn untimed_and_undated_custom_events_bear_honest_interference() {
        let schedule = ScheduleData::default();
        let block_day = day(2026, 10, 23);
        let untimed = CustomCalendarEvent {
            id: "custom-2".to_string(),
            title: "Mystery session".to_string(),
            course_id: None,
            event_type: None,
            date: Some(block_day), // dated, but with no times — the free window can't be verified
            start_time: None,
            end_time: None,
            room: None,
            notes: None,
            color: None,
        };
        assert!(
            study_block_candidates(&schedule, &[untimed], block_day).is_empty(),
            "a dated event without times blocks every window that day (cannot be verified free)"
        );

        let undated = CustomCalendarEvent {
            id: "custom-3".to_string(),
            title: "Undated note".to_string(),
            course_id: None,
            event_type: None,
            date: None,
            start_time: Some(time(16, 0)),
            end_time: Some(time(18, 0)),
            room: None,
            notes: None,
            color: None,
        };
        assert_eq!(
            study_block_candidates(&schedule, &[undated], block_day).len(),
            9,
            "an undated event has no schedulable day to interfere with"
        );
    }

    #[test]
    fn block_convention_helpers_are_stable() {
        assert_eq!(block_date_for(day(2026, 11, 2)), day(2026, 11, 1));
        assert_eq!(block_id_for("gmail-3"), "study-block-gmail-3");
    }
}
