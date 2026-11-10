//! System tray and OS notification manager for QuizRadar desktop.
//!
//! Semantics mirror Android `NotificationHelper.kt`:
//! - Tray tooltip:
//!   - When no assessments exist: `"QuizRadar — No upcoming assessments"` (honest fallback)
//!   - When an assessment is within the 120-minute notification window:
//!     `"🎯 Exam Soon: {title} (in {countdown})"`
//!   - Otherwise: `"QuizRadar — Next: {title} in {days}d {hours}h"`
//! - OS Notification window:
//!   - 24h before / morning of upcoming exam (`Today: ...` or `Tomorrow: ...`)
//!   - Imminent exam countdown (<= 120 minutes)

use chrono::{NaiveDateTime, NaiveTime};
use quizradar_core::types::Assessment;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssessmentCountdownInfo {
    pub id: String,
    pub title: String,
    pub course: String,
    pub room: Option<String>,
    pub display_time: Option<String>,
    pub minutes_remaining: i64,
    pub is_same_day: bool,
    pub is_tomorrow: bool,
}

/// Formats minutes into human-readable countdown text matching Android `NotificationHelper.kt`.
/// - <= 60: "{minutes} mins"
/// - > 60: "{hours}h {mins}m"
#[must_use]
pub fn format_countdown_minutes(minutes: i64) -> String {
    if minutes <= 60 {
        format!("{minutes} mins")
    } else {
        format!("{}h {}m", minutes / 60, minutes % 60)
    }
}

/// Formats the tray tooltip according to the next assessment status.
///
/// Honesty doctrine: if no upcoming assessment exists, says so plainly — never fabricates a countdown.
#[must_use]
pub fn format_tray_tooltip(next: Option<&AssessmentCountdownInfo>) -> String {
    match next {
        None => "QuizRadar — No upcoming assessments".to_string(),
        Some(info) => {
            if info.minutes_remaining <= 0 {
                format!("QuizRadar — In Progress: {}", info.title)
            } else if info.minutes_remaining <= 120 {
                let cd = format_countdown_minutes(info.minutes_remaining);
                format!("🎯 Exam Soon: {} (in {})", info.title, cd)
            } else {
                let total_hours = info.minutes_remaining / 60;
                let days = total_hours / 24;
                let rem_hours = total_hours % 24;
                if days > 0 {
                    format!(
                        "QuizRadar — Next: {} in {}d {}h",
                        info.title, days, rem_hours
                    )
                } else {
                    format!("QuizRadar — Next: {} in {}h", info.title, rem_hours)
                }
            }
        }
    }
}

/// Builds notification title and body mirroring Android `NotificationHelper.kt`.
#[must_use]
pub fn build_exam_notification_content(info: &AssessmentCountdownInfo) -> (String, String) {
    let title = if info.minutes_remaining <= 120 && info.minutes_remaining > 0 {
        let cd = format_countdown_minutes(info.minutes_remaining);
        format!("🎯 Exam Soon: {} (in {cd})", info.title)
    } else if info.is_same_day {
        format!("Today: {}", info.title)
    } else if info.is_tomorrow {
        format!("Tomorrow: {}", info.title)
    } else {
        format!("Upcoming: {}", info.title)
    };

    let time_str = info
        .display_time
        .as_deref()
        .filter(|t| !t.is_empty())
        .map(|t| format!(" at {t}"))
        .unwrap_or_default();

    let room_str = info
        .room
        .as_deref()
        .filter(|r| !r.is_empty() && *r != "—")
        .map(|r| format!(" · Room {r}"))
        .unwrap_or_default();

    let body = format!("{}{}{}", info.course, time_str, room_str);
    (title, body)
}

/// Inspects a list of assessments against reference date/time and determines the earliest upcoming assessment.
#[must_use]
pub fn find_next_assessment(
    assessments: &[Assessment],
    now: NaiveDateTime,
) -> Option<AssessmentCountdownInfo> {
    let mut upcoming: Vec<AssessmentCountdownInfo> = assessments
        .iter()
        .filter(|a| a.is_upcoming)
        .filter_map(|a| {
            let assessment_date = a.date?;
            let start_time = a
                .start_time
                .unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).unwrap_or_default());
            let assessment_dt = NaiveDateTime::new(assessment_date, start_time);

            let diff = assessment_dt.signed_duration_since(now);
            let minutes_remaining = diff.num_minutes();

            // Ignore assessments completed in the past (older than 2 hours past start)
            if minutes_remaining < -120 {
                return None;
            }

            let today = now.date();
            let is_same_day = assessment_date == today;
            let is_tomorrow = assessment_date == today + chrono::Duration::days(1);

            let course = a
                .course_name
                .clone()
                .or_else(|| a.course_id.clone())
                .unwrap_or_else(|| "Exam".to_string());

            Some(AssessmentCountdownInfo {
                id: a.id.clone(),
                title: a.title.clone(),
                course,
                room: a.room.clone(),
                display_time: a.display_time.clone(),
                minutes_remaining,
                is_same_day,
                is_tomorrow,
            })
        })
        .collect();

    upcoming.sort_by_key(|info| info.minutes_remaining);
    upcoming.into_iter().next()
}

/// In-memory tracker for emitted notification windows to avoid spamming the user.
#[derive(Default)]
pub struct NotificationTracker {
    notified_windows: HashSet<String>,
}

impl NotificationTracker {
    #[must_use]
    pub fn new() -> Self {
        Self {
            notified_windows: HashSet::new(),
        }
    }

    /// Determines if a notification should be fired for this assessment window.
    pub fn should_notify(&mut self, info: &AssessmentCountdownInfo) -> bool {
        let window_key = if info.minutes_remaining <= 120 && info.minutes_remaining > 0 {
            format!("{}_imminent", info.id)
        } else if info.is_same_day {
            format!("{}_sameday", info.id)
        } else if info.is_tomorrow {
            format!("{}_tomorrow", info.id)
        } else {
            return false;
        };

        if self.notified_windows.contains(&window_key) {
            false
        } else {
            self.notified_windows.insert(window_key);
            true
        }
    }
}

pub type SharedNotificationTracker = Arc<Mutex<NotificationTracker>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_countdown_minutes() {
        assert_eq!(format_countdown_minutes(30), "30 mins");
        assert_eq!(format_countdown_minutes(60), "60 mins");
        assert_eq!(format_countdown_minutes(75), "1h 15m");
        assert_eq!(format_countdown_minutes(120), "2h 0m");
    }

    #[test]
    fn test_format_tray_tooltip_honest_fallback() {
        let tooltip = format_tray_tooltip(None);
        assert_eq!(tooltip, "QuizRadar — No upcoming assessments");
    }

    #[test]
    fn test_format_tray_tooltip_imminent_window() {
        let info = AssessmentCountdownInfo {
            id: "a1".into(),
            title: "Math Midterm".into(),
            course: "Calculus II".into(),
            room: Some("Auditorium B".into()),
            display_time: Some("10:00 AM".into()),
            minutes_remaining: 45,
            is_same_day: true,
            is_tomorrow: false,
        };
        let tooltip = format_tray_tooltip(Some(&info));
        assert_eq!(tooltip, "🎯 Exam Soon: Math Midterm (in 45 mins)");

        let (title, body) = build_exam_notification_content(&info);
        assert_eq!(title, "🎯 Exam Soon: Math Midterm (in 45 mins)");
        assert_eq!(body, "Calculus II at 10:00 AM · Room Auditorium B");
    }

    #[test]
    fn test_format_tray_tooltip_future_days() {
        let info = AssessmentCountdownInfo {
            id: "a2".into(),
            title: "Physics Final".into(),
            course: "Physics 101".into(),
            room: None,
            display_time: None,
            minutes_remaining: 24 * 60 * 3 + 120,
            is_same_day: false,
            is_tomorrow: false,
        };
        let tooltip = format_tray_tooltip(Some(&info));
        assert_eq!(tooltip, "QuizRadar — Next: Physics Final in 3d 2h");
    }

    #[test]
    fn test_notification_tracker_dedup() {
        let mut tracker = NotificationTracker::new();
        let info = AssessmentCountdownInfo {
            id: "a1".into(),
            title: "Quiz".into(),
            course: "CS".into(),
            room: None,
            display_time: None,
            minutes_remaining: 50,
            is_same_day: true,
            is_tomorrow: false,
        };

        assert!(tracker.should_notify(&info));
        assert!(!tracker.should_notify(&info));
    }
}
