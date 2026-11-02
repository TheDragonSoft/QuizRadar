//! Google Classroom source (`02` §5.5, `01` §4.2): active courses + their
//! courseWork, **due-date-gated** — items without a real `dueDate` are
//! skipped, never assigned a fallback date (`03` §A5).
//!
//! Uses the Classroom read scopes from the declarative registry
//! (`auth::providers::GoogleCapability::ClassroomRead`), structurally fixing
//! v4's never-requested `classroom.*` scope bug (`03` §B5). Honest mapping:
//! no fabricated room/group/instructor/end-time ("Google Classroom Stream",
//! "Classroom Teacher", "12:00" are all deleted), type classification runs
//! through the same ladder as the ICS pipeline.

use chrono::NaiveDate;
use futures::StreamExt;
use serde_json::Value;

use crate::auth::providers::{GoogleCapability, ProviderCapability};
use crate::parse::email::{classify_ics_text, strip_html_tags};
use crate::parse::ics::{extract_ics_topics, match_course_with_how};
use crate::parse::util::{
    compute_priority_score, day_name_for, days_until, infer_semester_from_date, urgency_for,
};
use crate::sources::{authed_get, net_err, Progress, TokenProvider};
use crate::types::{Assessment, AssessmentSource, ScheduleData};

pub const CLASSROOM_API_BASE: &str = "https://classroom.googleapis.com/v1";
/// Upper bound on pages per collection (v4 parity).
pub const MAX_PAGES: usize = 10;
/// Bounded concurrency for per-course coursework fetches (v4 parity: 5).
pub const COURSE_CONCURRENCY: usize = 5;

/// What actually ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ClassroomStats {
    pub courses: usize,
    pub coursework_scanned: usize,
    pub with_due_date: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClassroomScan {
    pub assessments: Vec<Assessment>,
    pub stats: ClassroomStats,
    pub notes: Vec<String>,
}

/// Full Classroom scan. `base_url` is the API root (production:
/// [`CLASSROOM_API_BASE`], tests: fixture server).
pub async fn scan_classroom(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    progress: &Progress<'_>,
) -> Result<ClassroomScan, String> {
    let capability = ProviderCapability::Google(GoogleCapability::ClassroomRead);

    progress.emit("connecting", 0, 0);
    let courses = paged_collection(
        client,
        provider,
        capability,
        &format!("{base_url}/courses?courseStates=ACTIVE&pageSize=100"),
        "courses",
    )
    .await
    .map_err(|error| {
        // The 403 apology copy is kept honest: the scope must exist in the
        // grant, and the registry now requests it.
        format!("{error} (the Classroom scope may need granting at the next Google sign-in)")
    })?;

    let course_count = courses.len();
    progress.emit("fetching", course_count, 0);
    let per_course: Vec<(usize, Vec<Assessment>)> = futures::stream::iter(courses)
        .map(|course| async move {
            let Some(course_id) = course.get("id").and_then(Value::as_str) else {
                return (0, Vec::new());
            };
            let items = paged_collection(
                client,
                provider,
                capability,
                &format!("{base_url}/courses/{course_id}/courseWork?pageSize=100"),
                "courseWork",
            )
            .await
            .unwrap_or_default();
            let scanned = items.len();
            let mapped = items
                .iter()
                .filter_map(|item| assessment_from_coursework(item, &course, schedule, ref_date))
                .collect::<Vec<_>>();
            (scanned, mapped)
        })
        .buffer_unordered(COURSE_CONCURRENCY)
        .collect()
        .await;

    let mut stats = ClassroomStats {
        courses: course_count,
        ..ClassroomStats::default()
    };
    let mut assessments: Vec<Assessment> = Vec::new();
    for (scanned, batch) in per_course {
        stats.coursework_scanned += scanned;
        assessments.extend(batch);
    }
    stats.with_due_date = assessments.len();

    progress.emit("done", assessments.len(), course_count);
    Ok(ClassroomScan {
        assessments,
        stats,
        notes: Vec::new(),
    })
}

/// Maps one courseWork item onto the honest assessment shape. `None` when the
/// teacher posted no (valid) due date or the item has no id — both are real
/// gaps, not values to invent.
fn assessment_from_coursework(
    item: &Value,
    course: &Value,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
) -> Option<Assessment> {
    let id = item.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() {
        return None;
    }
    let title = item
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())?;
    let description = strip_html_tags(
        item.get("description")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );

    let (year, month, day) = (
        item.get("dueDate")
            .and_then(|d| d.get("year"))
            .and_then(Value::as_i64)?,
        item.get("dueDate")
            .and_then(|d| d.get("month"))
            .and_then(Value::as_i64)?,
        item.get("dueDate")
            .and_then(|d| d.get("day"))
            .and_then(Value::as_i64)?,
    );
    let date = NaiveDate::from_ymd_opt(
        i32::try_from(year).ok()?,
        u32::try_from(month).ok()?,
        u32::try_from(day).ok()?,
    )?;
    let start_time = item
        .get("dueTime")
        .and_then(|t| {
            let hours = t.get("hours").and_then(Value::as_i64);
            let minutes = t.get("minutes").and_then(Value::as_i64);
            Some((hours?, minutes?))
        })
        .and_then(|(hours, minutes)| {
            chrono::NaiveTime::from_hms_opt(
                u32::try_from(hours).ok()?,
                u32::try_from(minutes).ok()?,
                0,
            )
        });

    // v4 matched on the Classroom course name OR the item title; the
    // Classroom course name participates in the same sweep here.
    let classroom_course_name = course
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let context_lower =
        format!("{classroom_course_name} {title} {description}").to_ascii_lowercase();
    let match_found = match_course_with_how(schedule, &context_lower);
    let course_record = match_found.map(|(found, _)| found);
    let assessment_type = classify_ics_text(
        &title.to_ascii_lowercase(),
        &description.to_ascii_lowercase(),
    );
    let topics = extract_ics_topics(&description, title);

    let days_i64 = days_until(Some(date), ref_date).map(i64::from);
    let days_until_i32 = days_i64.map(|days| i32::try_from(days).unwrap_or(i32::MAX));

    let mut warnings = vec!["🏫 Synced from your Google Classroom coursework.".to_string()];
    let context_for_warnings = context_lower.as_str();
    if context_for_warnings.contains("time limit") || context_for_warnings.contains("minute") {
        warnings.push("⏱️ Timed submission.".to_string());
    }
    if context_for_warnings.contains("password") {
        warnings.push("🔑 Requires a password provided in lecture.".to_string());
    }

    let mut note = match match_found {
        Some((found, how)) => format!(
            "Parsed from Google Classroom coursework: due date read from the posted dueDate; matched to {} by {how}.",
            found.id
        ),
        None => "Parsed from Google Classroom coursework: due date read from the posted dueDate; no course in your weekly schedule matched this item.".to_string(),
    };
    if start_time.is_none() {
        note.push_str(" No due time was posted; the deadline is that day.");
    }

    let elearning_url = item
        .get("alternateLink")
        .and_then(Value::as_str)
        .filter(|link| link.starts_with("https://") || link.starts_with("http://"))
        .map(str::to_string);

    Some(Assessment {
        id: format!("classroom-{id}"),
        course_id: course_record.map(|c| c.id.clone()),
        course_name: course
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string),
        title: title.to_string(),
        assessment_type,
        date: Some(date),
        day_name: day_name_for(Some(date)),
        start_time,
        end_time: None, // v4's fabricated "12:00" is gone
        display_time: Some(crate::parse::util::build_display_time(
            date, start_time, None,
        )),
        room: None,       // never fabricated
        group: None,      // v4's "Classroom Enrolled" is gone
        instructor: None, // v4's "Classroom Teacher" is gone
        is_upcoming: days_i64.map(|days| days >= 0).unwrap_or(true),
        days_until: days_until_i32,
        urgency_level: urgency_for(days_i64),
        priority_score: compute_priority_score(days_i64, assessment_type, topics.len()),
        topics,
        warnings,
        ai_inference_note: Some(note),
        ai_study_plan: Some(
            "Complete the coursework on Google Classroom and revise the linked materials."
                .to_string(),
        ),
        estimated_study_hours: None, // no honest basis to estimate one
        elearning_url,
        google_cal_url: None,
        gcal_synced: false,
        gcal_event_id: None,
        color: course_record.map(|c| c.color.clone()),
        bg: course_record.and_then(|c| c.bg.clone()),
        border: course_record.and_then(|c| c.border.clone()),
        semester: Some(infer_semester_from_date(date)),
        email_subject: None,
        email_sent_date: None,
        source: AssessmentSource::GoogleClassroom,
        source_icon: Some(AssessmentSource::GoogleClassroom.as_icon().to_string()),
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
        last_seen_source_run: None,
        retired_source_run: None,
    })
}

async fn paged_collection(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    capability: ProviderCapability,
    first_url: &str,
    array_field: &str,
) -> Result<Vec<Value>, String> {
    let mut items: Vec<Value> = Vec::new();
    let mut page_token: Option<String> = None;
    for page in 0..MAX_PAGES {
        let mut url = first_url.to_string();
        if let Some(token) = &page_token {
            url.push_str(&format!(
                "&pageToken={}",
                crate::auth::providers::percent_encode(token)
            ));
        }
        let response = authed_get(client, provider, capability, &url).await?;
        if !response.status().is_success() {
            return Err(format!(
                "Google Classroom returned HTTP {}",
                response.status()
            ));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|e| net_err("Google Classroom response was not JSON", e))?;
        if let Some(arr) = value.get(array_field).and_then(Value::as_array) {
            items.extend(arr.iter().cloned());
        }
        match value
            .get("nextPageToken")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
        {
            Some(next) if page + 1 < MAX_PAGES => page_token = Some(next.to_string()),
            _ => break,
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::sources::{http_client, FixedTokenProvider};
    use crate::types::{Course, ScheduleSlot};
    use wiremock::matchers::{method, path, path_regex};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn provider() -> FixedTokenProvider {
        FixedTokenProvider {
            access_token: "g-bearer".to_string(),
        }
    }

    fn schedule() -> ScheduleData {
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            courses: vec![Course {
                id: "CSE241".to_string(),
                name: "Object-Oriented Programming".to_string(),
                color: "#e67c73".to_string(),
                bg: None,
                border: None,
            }],
            slots: vec![ScheduleSlot {
                id: "slot-1".to_string(),
                day: "Tue".to_string(),
                day_index: 2,
                course_id: "CSE241".to_string(),
                course_name: "Object-Oriented Programming".to_string(),
                slot_type: "Lecture".to_string(),
                group: None,
                room: Some("Lab 301".to_string()),
                start_time: chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                end_time: chrono::NaiveTime::from_hms_opt(10, 30, 0).unwrap(),
                display_time: "09:00–10:30".to_string(),
                has_quiz: false,
                quiz_title: None,
            }],
        }
    }

    fn ref_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
    }

    async fn mount_courses(server: &MockServer, work_items: serde_json::Value) {
        Mock::given(method("GET"))
            .and(path("/courses"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "courses": [{"id": "c1", "name": "CSE241 - Object-Oriented Programming"}]
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/courses/[^/]+/courseWork$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(work_items))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn coursework_with_due_dates_maps_honestly() {
        let server = MockServer::start().await;
        mount_courses(
            &server,
            serde_json::json!({"courseWork": [
                {
                    "id": "w1",
                    "title": "Quiz 1",
                    "description": "<p>Chapters 1-2</p>",
                    "dueDate": {"year": 2026, "month": 11, "day": 2},
                    "dueTime": {"hours": 9, "minutes": 30},
                    "alternateLink": "https://classroom.google.com/w1"
                },
                {
                    "id": "w2",
                    "title": "Worksheet without a due date",
                    "description": ""
                }
            ]}),
        )
        .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Google Classroom", &|_| {});
        let scan = scan_classroom(
            &client,
            &provider(),
            &server.uri(),
            &schedule(),
            ref_date(),
            &progress,
        )
        .await
        .unwrap();

        // Due-date-gated: the undated worksheet is skipped, never assigned one.
        assert_eq!(scan.stats.coursework_scanned, 2);
        assert_eq!(scan.stats.with_due_date, 1);
        assert_eq!(scan.assessments.len(), 1);
        let item = &scan.assessments[0];
        assert_eq!(item.id, "classroom-w1");
        assert_eq!(
            item.date.map(|d| d.to_string()).as_deref(),
            Some("2026-11-02")
        );
        assert_eq!(
            item.start_time.map(|t| t.format("%H:%M").to_string()),
            Some("09:30".to_string())
        );
        assert_eq!(item.end_time, None, "no fabricated 12:00 end time");
        assert_eq!(item.room, None, "no fabricated Classroom Stream room");
        assert_eq!(item.instructor, None, "no fabricated teacher name");
        assert_eq!(item.group, None);
        // Matched through the Classroom course name carrying the course code.
        assert_eq!(item.course_id.as_deref(), Some("CSE241"));
        assert_eq!(item.source.as_str(), "Google Classroom");
        assert!(item
            .ai_inference_note
            .as_deref()
            .is_some_and(|note| note.contains("due date read from the posted dueDate")));
        assert_eq!(
            item.elearning_url.as_deref(),
            Some("https://classroom.google.com/w1")
        );
    }

    #[tokio::test]
    async fn missing_due_time_is_recorded_in_the_note() {
        let server = MockServer::start().await;
        mount_courses(
            &server,
            serde_json::json!({"courseWork": [{
                "id": "w3",
                "title": "Assignment 2",
                "dueDate": {"year": 2026, "month": 11, "day": 9}
            }]}),
        )
        .await;
        let client = http_client().unwrap();
        let progress = Progress::new("Google Classroom", &|_| {});
        let scan = scan_classroom(
            &client,
            &provider(),
            &server.uri(),
            &schedule(),
            ref_date(),
            &progress,
        )
        .await
        .unwrap();
        let item = &scan.assessments[0];
        assert_eq!(item.start_time, None);
        assert!(item
            .ai_inference_note
            .as_deref()
            .is_some_and(|note| note.contains("No due time was posted")));
        assert_eq!(
            item.assessment_type,
            crate::types::AssessmentType::Assignment
        );
    }

    #[tokio::test]
    async fn scope_or_auth_failures_fail_with_the_honest_apology() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/courses"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let client = http_client().unwrap();
        let progress = Progress::new("Google Classroom", &|_| {});
        let error = scan_classroom(
            &client,
            &provider(),
            &server.uri(),
            &schedule(),
            ref_date(),
            &progress,
        )
        .await
        .unwrap_err();
        assert!(
            error.contains("HTTP 403") && error.contains("scope"),
            "honest failure: {error}"
        );
    }
}
