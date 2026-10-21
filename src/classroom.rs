use crate::auth::get_valid_access_token;
use crate::models::{AppConfig, Assessment, ScheduleData};
use chrono::{Local, NaiveDate};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;
use std::time::Duration;

static CLASSROOM_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build shared Google Classroom HTTP client")
});

const MAX_PAGES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassroomTestResult {
    pub success: bool,
    pub message: String,
    pub courses_found: usize,
    pub coursework_count: usize,
}

async fn fetch_courses(client: &reqwest::Client, token: &str) -> Vec<Value> {
    let mut courses = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut url =
            "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100"
                .to_string();
        if let Some(page) = &page_token {
            url.push_str("&pageToken=");
            url.push_str(&crate::urlencoding::encode(page));
        }
        let resp = match client.get(&url).bearer_auth(token).send().await {
            Ok(resp) => resp,
            Err(_) => break,
        };
        if !resp.status().is_success() {
            break;
        }
        let val = match resp.json::<Value>().await {
            Ok(val) => val,
            Err(_) => break,
        };
        if let Some(arr) = val.get("courses").and_then(|c| c.as_array()) {
            courses.extend(arr.iter().cloned());
        }
        match val.get("nextPageToken").and_then(|t| t.as_str()) {
            Some(next) if !next.is_empty() => page_token = Some(next.to_string()),
            _ => break,
        }
    }
    courses
}

async fn fetch_course_work(client: &reqwest::Client, token: &str, course_id: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut page_token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut url = format!(
            "https://classroom.googleapis.com/v1/courses/{}/courseWork?pageSize=100",
            course_id
        );
        if let Some(page) = &page_token {
            url.push_str("&pageToken=");
            url.push_str(&crate::urlencoding::encode(page));
        }
        let resp = match client.get(&url).bearer_auth(token).send().await {
            Ok(resp) => resp,
            Err(_) => break,
        };
        if !resp.status().is_success() {
            break;
        }
        let val = match resp.json::<Value>().await {
            Ok(val) => val,
            Err(_) => break,
        };
        if let Some(arr) = val.get("courseWork").and_then(|w| w.as_array()) {
            items.extend(arr.iter().cloned());
        }
        match val.get("nextPageToken").and_then(|t| t.as_str()) {
            Some(next) if !next.is_empty() => page_token = Some(next.to_string()),
            _ => break,
        }
    }
    items
}

async fn fetch_course_assessments(
    client: &reqwest::Client,
    token: &str,
    course: Value,
    schedule: &ScheduleData,
) -> Vec<Assessment> {
    let course_id_raw = course.get("id").and_then(|i| i.as_str()).unwrap_or("");
    let course_name_raw = course
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Course");
    let items = fetch_course_work(client, token, course_id_raw).await;
    let ref_date = crate::parser::current_reference_date();
    let mut assessments = Vec::new();

    for item in &items {
        let title = item
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("Classroom Quiz");
        let link = item
            .get("alternateLink")
            .and_then(|l| l.as_str())
            .unwrap_or("https://classroom.google.com");

        // Extract due date if present; skip items without one
        let mut date_iso = String::new();
        let mut start_time = "10:00".to_string();
        if let Some(due_date) = item.get("dueDate") {
            let y = due_date.get("year").and_then(|y| y.as_i64()).unwrap_or(0);
            let m = due_date.get("month").and_then(|m| m.as_i64()).unwrap_or(1);
            let d = due_date.get("day").and_then(|d| d.as_i64()).unwrap_or(1);
            date_iso = format!("{:04}-{:02}-{:02}", y, m, d);
        }
        if let Some(due_time) = item.get("dueTime") {
            let hh = due_time.get("hours").and_then(|h| h.as_i64()).unwrap_or(12);
            let mm = due_time
                .get("minutes")
                .and_then(|m| m.as_i64())
                .unwrap_or(0);
            start_time = format!("{:02}:{:02}", hh, mm);
        }
        if date_iso.is_empty() || NaiveDate::parse_from_str(&date_iso, "%Y-%m-%d").is_err() {
            // No real due date published by the teacher — do NOT invent one.
            continue;
        }

        let parsed_date = NaiveDate::parse_from_str(&date_iso, "%Y-%m-%d").unwrap_or(ref_date);
        let days_until = (parsed_date - ref_date).num_days();

        let mut matched_cid = "GCL101".to_string();
        let mut color = "#10b981".to_string(); // Emerald Classroom color

        for sc in &schedule.courses {
            if course_name_raw.contains(&sc.id) || title.contains(&sc.id) {
                matched_cid = sc.id.clone();
                color = sc.color.clone();
                break;
            }
        }

        let (bg, border) = crate::gemini::generate_course_palette(&color);

        let mut a = Assessment {
            id: format!(
                "classroom-{}",
                item.get("id").and_then(|i| i.as_str()).unwrap_or("item")
            ),
            course_id: matched_cid,
            course_name: course_name_raw.to_string(),
            title: title.to_string(),
            assessment_type: "Online Quiz".to_string(),
            date_iso: date_iso.clone(),
            day_name: parsed_date.format("%A").to_string(),
            start_time: start_time.clone(),
            end_time: "12:00".to_string(),
            display_time: format!(
                "{}, {} ({})",
                parsed_date.format("%A"),
                date_iso,
                start_time
            ),
            room: "Google Classroom Stream".to_string(),
            group: "Classroom Enrolled".to_string(),
            instructor: "Classroom Teacher".to_string(),
            is_upcoming: days_until >= 0,
            days_until,
            urgency_level: "upcoming".to_string(),
            priority_score: 83,
            topics: vec![format!("Classroom Topic: {}", title)],
            warnings: vec!["🏫 Synced from your Google Classroom stream.".to_string()],
            ai_inference_note: "Synced via Google Classroom courseWork API.".to_string(),
            ai_study_plan: "Complete Google Forms submission and submit before due time."
                .to_string(),
            estimated_study_hours: 2.0,
            elearning_url: link.to_string(),
            google_cal_url: String::new(),
            gcal_synced: false,
            gcal_event_id: None,
            color,
            bg,
            border,
            semester: crate::parser::infer_semester_from_date(parsed_date),
            email_subject: "Google Classroom Post".to_string(),
            email_sent_date: Local::now().format("%Y-%m-%d").to_string(),
            source: "Google Classroom".to_string(),
            source_icon: "book-open".to_string(),
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
        };
        a.google_cal_url = crate::parser::build_google_calendar_template_url(&a);
        assessments.push(a);
    }

    assessments
}

pub async fn test_classroom_connection() -> Result<ClassroomTestResult, String> {
    let token = get_valid_access_token()
        .await
        .map_err(|e| format!("Not signed in to Google: {}", e))?;

    let client = &*CLASSROOM_HTTP_CLIENT;
    let resp = client
        .get("https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE")
        .bearer_auth(&token.token)
        .send()
        .await
        .map_err(|e| format!("Network error reaching Google Classroom: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Google Classroom API returned HTTP {}. (Classroom scope may need granting upon next Google Sign-In)",
            resp.status()
        ));
    }

    // Count real background tests per course instead of reporting a hardcoded
    // placeholder number.
    let courses_items = fetch_courses(client, &token.token).await;
    let courses_found = courses_items.len();
    let token_for_work = token.token.clone();
    let course_ids: Vec<String> = courses_items
        .iter()
        .filter_map(|course| course.get("id").and_then(|i| i.as_str()).map(String::from))
        .collect();
    let coursework_counts = stream::iter(course_ids)
        .map(move |id| {
            let tok = token_for_work.clone();
            async move { fetch_course_work(client, &tok, &id).await.len() }
        })
        .buffered(5)
        .collect::<Vec<usize>>()
        .await;
    let coursework_count: usize = coursework_counts.into_iter().sum();

    Ok(ClassroomTestResult {
        success: true,
        message: format!(
            "Google Classroom connected! Found {} active courses & {} coursework items.",
            courses_found, coursework_count
        ),
        courses_found,
        coursework_count,
    })
}

pub async fn sync_classroom_assessments(
    config: &AppConfig,
    schedule: &ScheduleData,
) -> Result<Vec<Assessment>, String> {
    if !config.classroom_enabled {
        return Ok(Vec::new());
    }

    let token = match get_valid_access_token().await {
        Ok(t) => t,
        Err(e) => {
            // Honest error instead of fabricated "sample" coursework
            return Err(format!(
                "Google Classroom sync failed: Google account is not connected ({}). Sign in and grant the Classroom scope first.",
                e
            ));
        }
    };

    let client = &*CLASSROOM_HTTP_CLIENT;
    let access_token = token.token.as_str();
    let courses = fetch_courses(client, access_token).await;

    let mut per_course: Vec<(usize, Vec<Assessment>)> =
        stream::iter(courses.into_iter().enumerate())
            .map(|(index, course)| async move {
                let assessments =
                    fetch_course_assessments(client, access_token, course, schedule).await;
                (index, assessments)
            })
            .buffer_unordered(5)
            .collect()
            .await;
    per_course.sort_by_key(|(index, _)| *index);

    let mut assessments = Vec::new();
    for (_, items) in per_course {
        assessments.extend(items);
    }

    // No sample fabrication: return whatever coursework genuinely had due dates
    Ok(assessments)
}
