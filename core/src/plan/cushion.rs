//! Study cushion and availability deficit calculator (`01` §4.4, cross-platform engine).
//!
//! Honesty doctrine:
//! - Daily available study capacity = waking hours (default 15.0h) minus committed hours
//!   (timetabled classes matching day + week parity, timed custom events, scheduled exams).
//! - If any pending task lacks an hour estimate, `cushion_hours` is set to `None` with an
//!   honest warning note ("Cushion calculation unavailable: N tasks lack hour estimates").
//!   No default hour estimates are fabricated.
//! - When all pending tasks have hour estimates, if required hours exceed available capacity,
//!   `is_deficit: true` with honest `deficit_hours: Some(...)`.

use chrono::NaiveDate;

use crate::plan::parity::slot_matches_date;
use crate::plan::tasks::DailyStudyTask;
use crate::types::{Assessment, CustomCalendarEvent, DailyStudyCushion, ScheduleSlot};

/// Default waking hours allocated for classes and study (e.g. 08:00 to 23:00).
pub const DEFAULT_WAKING_HOURS: f32 = 15.0;

/// Calculates the study cushion and deficit for a specific date.
#[must_use]
pub fn calculate_daily_cushion(
    date: NaiveDate,
    slots: &[ScheduleSlot],
    custom_events: &[CustomCalendarEvent],
    assessments: &[Assessment],
    tasks: &[DailyStudyTask],
    waking_hours: Option<f32>,
) -> DailyStudyCushion {
    let waking = waking_hours
        .unwrap_or(DEFAULT_WAKING_HOURS)
        .clamp(1.0, 24.0);

    // 1. Timetabled class slot duration
    let mut slot_minutes: i64 = 0;
    for slot in slots {
        if slot_matches_date(slot, date) {
            let duration = (slot.end_time - slot.start_time).num_minutes();
            if duration > 0 {
                slot_minutes += duration;
            }
        }
    }

    // 2. Timed custom events on this date
    let mut event_minutes: i64 = 0;
    for event in custom_events {
        if event.date == Some(date) {
            if let (Some(start), Some(end)) = (event.start_time, event.end_time) {
                let duration = (end - start).num_minutes();
                if duration > 0 {
                    event_minutes += duration;
                }
            }
        }
    }

    // 3. Scheduled exams / assessments on this date
    let mut exam_minutes: i64 = 0;
    for assessment in assessments {
        if assessment.date == Some(date) && assessment.retired_source_run.is_none() {
            if let (Some(start), Some(end)) = (assessment.start_time, assessment.end_time) {
                let duration = (end - start).num_minutes();
                if duration > 0 {
                    exam_minutes += duration;
                }
            } else {
                // If untimed assessment on date, count 2.0 hours (standard exam block)
                exam_minutes += 120;
            }
        }
    }

    let total_committed_minutes = slot_minutes + event_minutes + exam_minutes;
    let committed_hours = ((total_committed_minutes as f32 / 60.0) * 10.0).round() / 10.0;
    let available_hours = (((waking - committed_hours).max(0.0)) * 10.0).round() / 10.0;

    // 4. Tasks for this date
    let date_tasks: Vec<&DailyStudyTask> = tasks
        .iter()
        .filter(|t| t.target_date == date && !t.completed)
        .collect();

    let missing_count = date_tasks
        .iter()
        .filter(|t| t.estimated_hours.is_none())
        .count();

    if missing_count > 0 {
        let warning_note = if missing_count == 1 {
            Some("Cushion calculation unavailable: 1 task lacks hour estimates".to_string())
        } else {
            Some(format!(
                "Cushion calculation unavailable: {missing_count} tasks lack hour estimates"
            ))
        };
        DailyStudyCushion {
            date,
            waking_hours: waking,
            committed_hours,
            available_hours,
            required_hours: None,
            cushion_hours: None,
            is_deficit: false,
            deficit_hours: None,
            warning_note,
        }
    } else {
        let req_sum: f32 = date_tasks
            .iter()
            .map(|t| t.estimated_hours.unwrap_or(0.0))
            .sum();
        let required_hours = (req_sum * 10.0).round() / 10.0;
        let cushion = ((available_hours - required_hours) * 10.0).round() / 10.0;

        if cushion < 0.0 {
            let deficit = -cushion;
            DailyStudyCushion {
                date,
                waking_hours: waking,
                committed_hours,
                available_hours,
                required_hours: Some(required_hours),
                cushion_hours: Some(cushion),
                is_deficit: true,
                deficit_hours: Some(deficit),
                warning_note: Some(format!(
                    "Study deficit of {deficit:.1}h detected: scheduled commitments leave insufficient study time"
                )),
            }
        } else {
            DailyStudyCushion {
                date,
                waking_hours: waking,
                committed_hours,
                available_hours,
                required_hours: Some(required_hours),
                cushion_hours: Some(cushion),
                is_deficit: false,
                deficit_hours: None,
                warning_note: None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use crate::types::{AssessmentType, UrgencyLevel};
    use chrono::NaiveTime;

    fn sample_slot(day: &str, start_h: u32, end_h: u32) -> ScheduleSlot {
        ScheduleSlot {
            id: "slot-1".to_string(),
            day: day.to_string(),
            day_index: 1,
            course_id: "CSE101".to_string(),
            course_name: "Intro to CS".to_string(),
            slot_type: "Lecture".to_string(),
            group: None,
            room: None,
            start_time: NaiveTime::from_hms_opt(start_h, 0, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(end_h, 0, 0).unwrap(),
            display_time: format!("{start_h:02}:00–{end_h:02}:00"),
            has_quiz: false,
            quiz_title: None,
            week_parity: None,
        }
    }

    fn sample_task(date: NaiveDate, hours: Option<f32>, completed: bool) -> DailyStudyTask {
        DailyStudyTask {
            id: "task-1".to_string(),
            key: "key-1".to_string(),
            assessment_id: "ass-1".to_string(),
            course_id: Some("CSE101".to_string()),
            course_name: Some("Intro to CS".to_string()),
            assessment_title: "Quiz 1".to_string(),
            assessment_type: AssessmentType::ClassQuiz,
            topic: "Logic".to_string(),
            day_offset: 0,
            target_date: date,
            display_day: "Today".to_string(),
            priority_rank: 50,
            urgency: UrgencyLevel::Critical,
            estimated_hours: hours,
            ai_reasoning: "Review".to_string(),
            completed,
            color: None,
            days_until_assessment: 1,
            assessment_date: date,
        }
    }

    #[test]
    fn cushion_calculates_available_and_surplus() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(); // Monday
        let slots = vec![sample_slot("Mon", 9, 12)]; // 3 hours
        let tasks = vec![
            sample_task(date, Some(2.0), false),
            sample_task(date, Some(3.0), false),
            sample_task(date, Some(1.5), true), // completed, not counted
        ];

        let cushion = calculate_daily_cushion(date, &slots, &[], &[], &tasks, Some(15.0));

        assert_eq!(cushion.waking_hours, 15.0);
        assert_eq!(cushion.committed_hours, 3.0);
        assert_eq!(cushion.available_hours, 12.0);
        assert_eq!(cushion.required_hours, Some(5.0));
        assert_eq!(cushion.cushion_hours, Some(7.0));
        assert!(!cushion.is_deficit);
        assert_eq!(cushion.deficit_hours, None);
        assert_eq!(cushion.warning_note, None);
    }

    #[test]
    fn cushion_flags_deficit_when_commitments_and_tasks_exceed_capacity() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(); // Monday
        let slots = vec![
            sample_slot("Mon", 8, 14),  // 6 hours
            sample_slot("Mon", 15, 21), // 6 hours
        ]; // 12 hours committed
        let tasks = vec![
            sample_task(date, Some(2.5), false),
            sample_task(date, Some(2.0), false),
        ]; // 4.5 hours required

        let cushion = calculate_daily_cushion(date, &slots, &[], &[], &tasks, Some(15.0));

        assert_eq!(cushion.waking_hours, 15.0);
        assert_eq!(cushion.committed_hours, 12.0);
        assert_eq!(cushion.available_hours, 3.0);
        assert_eq!(cushion.required_hours, Some(4.5));
        assert_eq!(cushion.cushion_hours, Some(-1.5));
        assert!(cushion.is_deficit);
        assert_eq!(cushion.deficit_hours, Some(1.5));
        assert!(cushion
            .warning_note
            .unwrap()
            .contains("Study deficit of 1.5h detected"));
    }

    #[test]
    fn honesty_doctrine_sets_none_when_task_lacks_estimate() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
        let tasks = vec![
            sample_task(date, Some(2.0), false),
            sample_task(date, None, false), // missing estimate
        ];

        let cushion = calculate_daily_cushion(date, &[], &[], &[], &tasks, None);

        assert_eq!(cushion.required_hours, None);
        assert_eq!(cushion.cushion_hours, None);
        assert!(!cushion.is_deficit);
        assert_eq!(cushion.deficit_hours, None);
        assert!(cushion
            .warning_note
            .unwrap()
            .contains("1 task lacks hour estimates"));
    }
}
