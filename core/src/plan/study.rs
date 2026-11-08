//! Pure study algorithms (streak tracking, Leitner spaced repetition, focus charts).
//! Shared between SQLite store repositories (`core::store::repo`) and WASM adapters (`bindings::wasm`).

use chrono::NaiveDate;
use std::collections::HashMap;

use crate::types::{DailyFocusStat, Flashcard};

/// Advances a flashcard's Leitner box level and returns `(new_box_level, interval_days)`.
///
/// If `correct`: box level advances up to 5 (`(box_level + 1).min(5)`).
/// If `!correct`: box level drops back to 1.
///
/// Interval schedule:
/// - Box 1: 1 day
/// - Box 2: 3 days
/// - Box 3: 7 days
/// - Box 4: 14 days
/// - Box 5+: 30 days
pub fn advance_leitner_box(box_level: u8, correct: bool) -> (u8, i64) {
    let new_box = if correct { (box_level + 1).min(5) } else { 1 };
    let interval_days = match new_box {
        1 => 1,
        2 => 3,
        3 => 7,
        4 => 14,
        _ => 30,
    };
    (new_box, interval_days)
}

/// Applies Leitner box advancement and dates in-place to a [`Flashcard`].
pub fn apply_leitner_review(card: &mut Flashcard, correct: bool, today: NaiveDate) {
    let (new_box, interval_days) = advance_leitner_box(card.box_level, correct);
    card.box_level = new_box;
    card.last_reviewed_iso = Some(today.format("%Y-%m-%d").to_string());
    card.next_review_iso = Some(
        (today + chrono::Duration::days(interval_days))
            .format("%Y-%m-%d")
            .to_string(),
    );
}

/// Calculates current streak and all-time best streak in days from daily focus minutes.
///
/// An active day is any date with at least 1 focus minute recorded.
/// Current streak is maintained if the user studied today (`ref_date`) or yesterday (`ref_date - 1d`).
pub fn calculate_study_streak(
    daily_totals: &HashMap<NaiveDate, u32>,
    ref_date: NaiveDate,
) -> (u32, u32) {
    let is_active = |d: NaiveDate| daily_totals.get(&d).copied().unwrap_or(0) >= 1;

    let current_streak_days = if is_active(ref_date) {
        let mut streak = 1u32;
        let mut d = ref_date - chrono::Duration::days(1);
        while is_active(d) {
            streak += 1;
            d -= chrono::Duration::days(1);
        }
        streak
    } else if is_active(ref_date - chrono::Duration::days(1)) {
        let mut streak = 1u32;
        let mut d = ref_date - chrono::Duration::days(2);
        while is_active(d) {
            streak += 1;
            d -= chrono::Duration::days(1);
        }
        streak
    } else {
        0u32
    };

    let mut active_dates: Vec<NaiveDate> = daily_totals
        .keys()
        .copied()
        .filter(|d| is_active(*d))
        .collect();
    active_dates.sort_unstable();

    let mut best_streak_days = 0u32;
    let mut current_consecutive = 0u32;
    let mut prev_date: Option<NaiveDate> = None;

    for d in active_dates {
        match prev_date {
            Some(prev) if d == prev + chrono::Duration::days(1) => {
                current_consecutive += 1;
            }
            _ => {
                current_consecutive = 1;
            }
        }
        prev_date = Some(d);
        best_streak_days = best_streak_days.max(current_consecutive);
    }
    best_streak_days = best_streak_days.max(current_streak_days);

    (current_streak_days, best_streak_days)
}

/// Builds the 7-day daily focus stat chart (`ref_date - 6d ..= ref_date`).
pub fn calculate_weekly_focus_chart(
    daily_totals: &HashMap<NaiveDate, u32>,
    ref_date: NaiveDate,
) -> Vec<DailyFocusStat> {
    let mut weekly_chart = Vec::with_capacity(7);
    for i in (0..=6).rev() {
        let d = ref_date - chrono::Duration::days(i);
        let mins = daily_totals.get(&d).copied().unwrap_or(0);
        let day_label = d.format("%a").to_string();
        weekly_chart.push(DailyFocusStat {
            date_iso: d,
            day_label,
            minutes: mins,
        });
    }
    weekly_chart
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn leitner_progression_and_capping() {
        let (box1, d1) = advance_leitner_box(1, true);
        assert_eq!((box1, d1), (2, 3));

        let (box2, d2) = advance_leitner_box(2, true);
        assert_eq!((box2, d2), (3, 7));

        let (box3, d3) = advance_leitner_box(3, true);
        assert_eq!((box3, d3), (4, 14));

        let (box4, d4) = advance_leitner_box(4, true);
        assert_eq!((box4, d4), (5, 30));

        let (box5, d5) = advance_leitner_box(5, true);
        assert_eq!((box5, d5), (5, 30)); // Capped at box 5

        let (reset_box, reset_d) = advance_leitner_box(5, false);
        assert_eq!((reset_box, reset_d), (1, 1)); // Drops to box 1 on failure
    }

    #[test]
    fn study_streak_evaluation() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 8).unwrap();
        let mut daily = HashMap::new();

        // 3 consecutive days leading up to today
        daily.insert(today - chrono::Duration::days(2), 30);
        daily.insert(today - chrono::Duration::days(1), 45);
        daily.insert(today, 60);

        let (curr, best) = calculate_study_streak(&daily, today);
        assert_eq!(curr, 3);
        assert_eq!(best, 3);

        // If today has 0 minutes, but yesterday had minutes, streak is still alive at 2
        daily.remove(&today);
        let (curr2, best2) = calculate_study_streak(&daily, today);
        assert_eq!(curr2, 2);
        assert_eq!(best2, 2);
    }
}
