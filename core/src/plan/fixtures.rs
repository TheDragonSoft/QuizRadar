//! Test-only constructors shared by the plan modules' unit tests. Compiled
//! under `cfg(test)` only (declared so in `plan/mod.rs`) — never shipped.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use chrono::NaiveDate;

use crate::parse::util::{build_display_time, day_name_for};
use crate::types::{Assessment, AssessmentSource, AssessmentType, UrgencyLevel};

/// Fixed reference date ("today") for every plan test: Friday, 2026-10-23.
#[must_use]
pub fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
}

/// Parser-shaped assessment stub that mirrors what `parse::email` emits
/// for a dated (or undated) announcement: derived `day_name`/`display_time`/
/// urgency placeholder values, no fabricated room/group/instructor/grade.
/// Reference-relative countdown fields are left blank — the planner's
/// `refresh_assessment` (and the tasks builder) are the only code allowed
/// to fill them, from the injected reference date.
#[must_use]
pub fn assessment_on(
    id: &str,
    course_id: Option<&str>,
    title: &str,
    date: Option<NaiveDate>,
    topics: Vec<&str>,
) -> Assessment {
    Assessment {
        id: id.to_string(),
        course_id: course_id.map(str::to_string),
        course_name: None,
        title: title.to_string(),
        assessment_type: AssessmentType::ClassQuiz,
        date,
        day_name: day_name_for(date),
        start_time: None,
        end_time: None,
        display_time: date.map(|derived| build_display_time(derived, None, None)),
        room: None,
        group: None,
        instructor: None,
        // Placeholder — the planner recomputes from the injected date.
        is_upcoming: true,
        days_until: None,
        urgency_level: UrgencyLevel::Upcoming,
        priority_score: 0,
        topics: topics.into_iter().map(str::to_string).collect(),
        warnings: Vec::new(),
        ai_inference_note: None,
        ai_study_plan: None,
        estimated_study_hours: None,
        elearning_url: None,
        google_cal_url: None,
        gcal_synced: false,
        gcal_event_id: None,
        color: None,
        bg: None,
        border: None,
        semester: None,
        email_subject: None,
        email_sent_date: None,
        source: AssessmentSource::Gmail,
        source_icon: None,
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
    }
}
