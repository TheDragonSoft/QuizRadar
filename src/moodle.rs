use crate::models::{AppConfig, Assessment, Course, ScheduleData};
use chrono::{Local, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;
use std::time::Duration;

static MOODLE_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build shared Moodle HTTP client")
});

static RE_VEVENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)BEGIN:VEVENT(.*?)END:VEVENT").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoodleTestResult {
    pub success: bool,
    pub message: String,
    pub events_found: usize,
    pub mode: String,
}

/// Parses iCal/ICS datetime strings such as "20261018T080000Z" or "20261018T080000" or "20261018".
/// UTC values (trailing `Z`) are converted into the student's local timezone so the
/// date/time shown matches the wall-clock the student actually experiences.
fn parse_ical_datetime(val: &str) -> Option<(String, String, String)> {
    let trimmed = val.trim();
    let is_utc = trimmed.ends_with('Z');
    let cleaned = trimmed.trim_end_matches('Z');
    if cleaned.len() >= 15 && cleaned.contains('T') {
        let parts: Vec<&str> = cleaned.split('T').collect();
        if parts[0].len() == 8 && parts[1].len() >= 4 {
            let y: i32 = parts[0][0..4].parse().ok()?;
            let m: u32 = parts[0][4..6].parse().ok()?;
            let d: u32 = parts[0][6..8].parse().ok()?;
            let hh: u32 = parts[1][0..2].parse().ok()?;
            let mm: u32 = parts[1][2..4].parse().ok()?;
            let naive = chrono::NaiveDate::from_ymd_opt(y, m, d)?.and_hms_opt(hh, mm, 0)?;
            if is_utc {
                let local_dt = naive.and_utc().with_timezone(&Local);
                return Some((
                    local_dt.format("%Y-%m-%d").to_string(),
                    local_dt.format("%H:%M").to_string(),
                    cleaned.to_string(),
                ));
            }
            let date_iso = format!("{}-{:02}-{:02}", y, m, d);
            let time_str = format!("{:02}:{:02}", hh, mm);
            return Some((date_iso, time_str, cleaned.to_string()));
        }
    } else if cleaned.len() == 8 {
        let y = &cleaned[0..4];
        let m = &cleaned[4..6];
        let d = &cleaned[6..8];
        return Some((
            format!("{}-{}-{}", y, m, d),
            "09:00".to_string(),
            cleaned.to_string(),
        ));
    }
    None
}

/// Parse raw VEVENT blocks from Moodle's personal calendar export feed (.ics)
pub fn parse_moodle_ics_content(
    ics_text: &str,
    schedule: &ScheduleData,
    portal_url: Option<&str>,
) -> Vec<Assessment> {
    let mut assessments = Vec::new();
    let upper_courses: Vec<(String, String, &Course)> = schedule
        .courses
        .iter()
        .map(|c| (c.id.to_uppercase(), c.name.to_uppercase(), c))
        .collect();

    for cap in RE_VEVENT.captures_iter(ics_text) {
        let block = &cap[1];
        let mut summary = String::new();
        let mut description = String::new();
        let mut dtstart_raw = String::new();
        let mut dtend_raw = String::new();
        let mut uid = String::new();
        let mut url = String::new();

        for line in block.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("SUMMARY:") {
                summary = rest
                    .replace("\\,", ",")
                    .replace("\\n", " ")
                    .trim()
                    .to_string();
            } else if let Some(rest) = line.strip_prefix("DESCRIPTION:") {
                description = rest
                    .replace("\\,", ",")
                    .replace("\\n", "\n")
                    .trim()
                    .to_string();
            } else if let Some(rest) = line.strip_prefix("DTSTART:") {
                dtstart_raw = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("DTSTART;") {
                if let Some(idx) = rest.find(':') {
                    dtstart_raw = rest[idx + 1..].to_string();
                }
            } else if let Some(rest) = line.strip_prefix("DTEND:") {
                dtend_raw = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("DTEND;") {
                if let Some(idx) = rest.find(':') {
                    dtend_raw = rest[idx + 1..].to_string();
                }
            } else if let Some(rest) = line.strip_prefix("UID:") {
                uid = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("URL:") {
                url = rest.to_string();
            }
        }

        if summary.is_empty() {
            continue;
        }

        let summary_lower = summary.to_lowercase();
        let description_lower = description.to_lowercase();
        let is_quiz_or_exam = summary_lower.contains("quiz")
            || summary_lower.contains("exam")
            || summary_lower.contains("midterm")
            || summary_lower.contains("assessment")
            || summary_lower.contains("assignment")
            || description_lower.contains("quiz")
            || description_lower.contains("exam");

        if !is_quiz_or_exam {
            continue;
        }

        // Skip events that carry no parseable start date — inventing a fallback
        // date would pollute the study plan with fabricated deadlines.
        let Some((date_iso, start_time, _)) = parse_ical_datetime(&dtstart_raw) else {
            continue;
        };

        let end_time = parse_ical_datetime(&dtend_raw)
            .map(|(_, t, _)| t)
            .unwrap_or_else(|| {
                // Default 1h30m after start
                if let Ok(st) = chrono::NaiveTime::parse_from_str(&start_time, "%H:%M") {
                    let et = st + chrono::Duration::minutes(90);
                    et.format("%H:%M").to_string()
                } else {
                    "10:30".to_string()
                }
            });

        // Determine course code by matching against schedule
        let mut matched_course_id = "GEN100".to_string();
        let mut matched_course_name = "General Academic Course".to_string();
        let mut course_color = "#f97316".to_string(); // Moodle energetic orange
        let mut course_room = "E-Learning Lab / Online".to_string();
        let matched_instructor = "Course Faculty".to_string();

        let combined_text = format!("{} {}", summary, description).to_uppercase();
        for (id_upper, name_upper, c) in &upper_courses {
            if combined_text.contains(id_upper.as_str())
                || combined_text.contains(name_upper.as_str())
            {
                matched_course_id = c.id.clone();
                matched_course_name = c.name.clone();
                course_color = c.color.clone();
                break;
            }
        }

        // Try matching a room from the student's slot for that course
        if let Some(slot) = schedule
            .slots
            .iter()
            .find(|s| s.course_id == matched_course_id)
        {
            if !slot.room.is_empty() {
                course_room = slot.room.clone();
            }
        }

        let ref_date = crate::parser::current_reference_date();
        let parsed_date = NaiveDate::parse_from_str(&date_iso, "%Y-%m-%d").unwrap_or(ref_date);
        let days_until = (parsed_date - ref_date).num_days();
        let is_upcoming = days_until >= 0;

        let urgency_level = match days_until {
            d if d < 0 => "past",
            0..=1 => "critical",
            2..=4 => "high",
            5..=7 => "medium",
            _ => "upcoming",
        }
        .to_string();

        let day_name = parsed_date.format("%A").to_string();
        let display_time = format!("{}, {} ({} – {})", day_name, date_iso, start_time, end_time);

        let assessment_type = if summary_lower.contains("midterm") {
            "Midterm Exam".to_string()
        } else if summary_lower.contains("final") {
            "Final Exam".to_string()
        } else if summary_lower.contains("lab") {
            "Lab Assessment".to_string()
        } else if summary_lower.contains("assignment") {
            "Assignment".to_string()
        } else {
            "Online Quiz".to_string()
        };

        // Extract topics or warnings from description
        let mut warnings =
            vec!["🎓 Synced directly from your official Moodle LMS calendar.".to_string()];
        if description.contains("time limit") || description.contains("minute") {
            warnings.push("⏱️ Timed submission on Moodle portal.".to_string());
        }
        if description.contains("password") {
            warnings.push("🔑 Requires quiz password provided in lecture.".to_string());
        }

        let mut topics = Vec::new();
        if !description.is_empty() {
            for line in description.lines() {
                let l = line.trim();
                let l_lower = l.to_lowercase();
                if (l.starts_with("•")
                    || l.starts_with("-")
                    || l.starts_with("*")
                    || l_lower.contains("lecture")
                    || l_lower.contains("chapter"))
                    && l.len() > 3
                {
                    topics.push(
                        l.trim_start_matches(['•', '-', '*', ' '])
                            .to_string(),
                    );
                }
            }
        }
        if topics.is_empty() {
            topics.push(format!("Review all materials for {}", summary));
            topics.push("Check Moodle course forums for recent lecture slides".to_string());
        }

        let elearning_url = if !url.is_empty() {
            url
        } else if let Some(base) = portal_url {
            format!(
                "{}/calendar/view.php?view=upcoming",
                base.trim_end_matches('/')
            )
        } else {
            "https://moodle.org".to_string()
        };

        let id = if !uid.is_empty() {
            format!("moodle-{}", uid.replace(['@', '/'], "_"))
        } else {
            format!("moodle-{}-{}", matched_course_id, date_iso.replace('-', ""))
        };

        let (bg, border) = crate::gemini::generate_course_palette(&course_color);

        let mut assess = Assessment {
            id,
            course_id: matched_course_id,
            course_name: matched_course_name,
            title: summary,
            assessment_type,
            date_iso,
            day_name,
            start_time,
            end_time,
            display_time,
            room: course_room,
            group: "All Sections".to_string(),
            instructor: matched_instructor,
            is_upcoming,
            days_until,
            urgency_level,
            priority_score: 85,
            topics,
            warnings,
            ai_inference_note:
                "Synced via Moodle Calendar Feed with automatic Course & Slot matching.".to_string(),
            ai_study_plan:
                "Complete assigned online quizzes and revise corresponding Moodle lecture slides."
                    .to_string(),
            estimated_study_hours: 3.0,
            elearning_url,
            google_cal_url: String::new(),
            gcal_synced: false,
            gcal_event_id: None,
            color: course_color,
            bg,
            border,
            semester: "Fall 2026".to_string(),
            email_subject: "Moodle Calendar Event".to_string(),
            email_sent_date: Local::now().format("%Y-%m-%d").to_string(),
            source: "Moodle".to_string(),
            source_icon: "graduation-cap".to_string(),
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
        };
        assess.google_cal_url = crate::parser::build_google_calendar_template_url(&assess);
        assessments.push(assess);
    }

    assessments
}

/// Fetch Moodle Calendar events via the private iCal Export URL
pub async fn fetch_moodle_ical_events(
    ical_url: &str,
    schedule: &ScheduleData,
) -> Result<Vec<Assessment>, String> {
    let client = &*MOODLE_HTTP_CLIENT;

    let resp = client
        .get(ical_url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Moodle calendar feed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Moodle responded with HTTP {}", resp.status()));
    }

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let assessments = parse_moodle_ics_content(&text, schedule, None);
    Ok(assessments)
}

/// Fetch Moodle calendar events via Moodle Web Services REST API (`core_calendar_get_calendar_events`)
pub async fn fetch_moodle_api_events(
    base_url: &str,
    wstoken: &str,
    schedule: &ScheduleData,
) -> Result<Vec<Assessment>, String> {
    let client = &*MOODLE_HTTP_CLIENT;

    let clean_url = base_url.trim_end_matches('/');
    let endpoint = format!("{}/webservice/rest/server.php", clean_url);

    // POST the credentials in the request body: a Web Services token must never
    // sit inside a URL that can end up in server access logs or browser history.
    let params = [
        ("wstoken", wstoken.to_string()),
        (
            "wsfunction",
            "core_calendar_get_calendar_events".to_string(),
        ),
        ("moodlewsrestformat", "json".to_string()),
    ];

    let resp = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", wstoken))
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to call Moodle REST API: {}", e))?;

    let val: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Moodle JSON response: {}", e))?;

    if let Some(err) = val.get("message").and_then(|m| m.as_str()) {
        return Err(format!("Moodle API error: {}", err));
    }

    let mut assessments = Vec::new();
    if let Some(events) = val.get("events").and_then(|e| e.as_array()) {
        for ev in events {
            let name = ev
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("Moodle Assessment");
            let _desc = ev.get("description").and_then(|d| d.as_str()).unwrap_or("");
            let timestart = ev.get("timestart").and_then(|t| t.as_i64()).unwrap_or(0);
            let timeduration = ev
                .get("timeduration")
                .and_then(|t| t.as_i64())
                .unwrap_or(3600);

            if timestart == 0 {
                continue;
            }

            // Moodle timestamps are UTC epoch seconds; project them onto the
            // student's local timezone so dates match the wall-clock experience.
            let dt_utc = chrono::DateTime::from_timestamp(timestart, 0)
                .unwrap_or_else(chrono::Utc::now);
            let dt = dt_utc.with_timezone(&Local);
            let date_iso = dt.format("%Y-%m-%d").to_string();
            let start_time = dt.format("%H:%M").to_string();
            let end_dt = dt + chrono::Duration::seconds(timeduration);
            let end_time = end_dt.format("%H:%M").to_string();

            let ref_date = crate::parser::current_reference_date();
            let parsed_date = NaiveDate::parse_from_str(&date_iso, "%Y-%m-%d").unwrap_or(ref_date);
            let days_until = (parsed_date - ref_date).num_days();

            let course_name = ev
                .get("course")
                .and_then(|c| c.get("fullname"))
                .and_then(|n| n.as_str())
                .unwrap_or("Course");
            let mut course_id = "MDL101".to_string();
            let mut color = "#f97316".to_string();

            for c in &schedule.courses {
                if course_name.contains(&c.id) || name.contains(&c.id) {
                    course_id = c.id.clone();
                    color = c.color.clone();
                    break;
                }
            }

            let (bg, border) = crate::gemini::generate_course_palette(&color);

            assessments.push(Assessment {
                id: format!(
                    "moodle-api-{}",
                    ev.get("id").and_then(|i| i.as_i64()).unwrap_or(timestart)
                ),
                course_id,
                course_name: course_name.to_string(),
                title: name.to_string(),
                assessment_type: "Online Quiz".to_string(),
                date_iso,
                day_name: dt.format("%A").to_string(),
                start_time: start_time.clone(),
                end_time: end_time.clone(),
                display_time: format!(
                    "{}, {} ({} – {})",
                    dt.format("%A"),
                    dt.format("%Y-%m-%d"),
                    start_time,
                    end_time
                ),
                room: "Moodle LMS Portal".to_string(),
                group: "All Groups".to_string(),
                instructor: "Faculty".to_string(),
                is_upcoming: days_until >= 0,
                days_until,
                urgency_level: "upcoming".to_string(),
                priority_score: 80,
                topics: vec![format!("Moodle Module: {}", name)],
                warnings: vec!["Synced live via Moodle Web Services API".to_string()],
                ai_inference_note:
                    "Synced via Moodle Web Services core_calendar_get_calendar_events".to_string(),
                ai_study_plan: "Review assignment requirements on Moodle portal.".to_string(),
                estimated_study_hours: 2.5,
                elearning_url: format!("{}/calendar/view.php", clean_url),
                google_cal_url: String::new(),
                gcal_synced: false,
                gcal_event_id: None,
                color,
                bg,
                border,
                semester: "Fall 2026".to_string(),
                email_subject: "Moodle API Sync".to_string(),
                email_sent_date: Local::now().format("%Y-%m-%d").to_string(),
                source: "Moodle".to_string(),
                source_icon: "graduation-cap".to_string(),
                weightage_percent: None,
                achieved_score: None,
                max_score: None,
                conflict_warning: None,
            });
        }
    }

    Ok(assessments)
}

/// Unified sync function for Moodle: tries iCal feed first, then REST API if configured
pub async fn sync_moodle_assessments(
    config: &AppConfig,
    schedule: &ScheduleData,
) -> Result<Vec<Assessment>, String> {
    if !config.moodle_enabled {
        return Ok(Vec::new());
    }

    let ical_fut = async {
        if let Some(ref ical_url) = config.moodle_ical_url {
            if !ical_url.trim().is_empty() {
                return fetch_moodle_ical_events(ical_url.trim(), schedule).await;
            }
        }
        Ok(Vec::new())
    };

    let api_fut = async {
        if let (Some(ref url), Some(ref token)) = (&config.moodle_url, &config.moodle_token) {
            if !url.trim().is_empty() && !token.trim().is_empty() {
                return fetch_moodle_api_events(url.trim(), token.trim(), schedule).await;
            }
        }
        Ok(Vec::new())
    };

    let (ical_result, api_result) = tokio::join!(ical_fut, api_fut);

    let mut all = Vec::new();
    match ical_result {
        Ok(events) => all.extend(events),
        Err(e) => eprintln!("Moodle iCal sync failed: {}", e),
    }
    match api_result {
        Ok(events) => all.extend(events),
        Err(e) => eprintln!("Moodle REST API sync failed: {}", e),
    }

    // Nothing configured: return an honest empty result. Never fabricate "sample" quizzes.
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Course, ScheduleData, ScheduleSlot};

    fn sample_schedule() -> ScheduleData {
        ScheduleData {
            semester: "Fall 2026".to_string(),
            courses: vec![
                Course {
                    id: "CS101".to_string(),
                    name: "Introduction to Computer Science".to_string(),
                    color: "#3b82f6".to_string(),
                    bg: "".to_string(),
                    border: "".to_string(),
                },
                Course {
                    id: "MATH201".to_string(),
                    name: "Calculus II".to_string(),
                    color: "#ef4444".to_string(),
                    bg: "".to_string(),
                    border: "".to_string(),
                },
            ],
            slots: vec![ScheduleSlot {
                id: "s1".to_string(),
                day: "Monday".to_string(),
                day_index: 1,
                course_id: "CS101".to_string(),
                course_name: "Introduction to Computer Science".to_string(),
                room: "Lab 301".to_string(),
                slot_type: "Lab".to_string(),
                group: "G1".to_string(),
                start_time: "10:00".to_string(),
                end_time: "11:30".to_string(),
                display_time: "".to_string(),
                has_quiz: false,
                quiz_title: None,
            }],
        }
    }

    #[test]
    fn test_parse_moodle_ics_content_happy_path() {
        let schedule = sample_schedule();
        let ics = r#"
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:CS101 Online Quiz 1
DESCRIPTION:Covering Chapter 1 and Chapter 2
DTSTART:20261020T100000Z
DTEND:20261020T110000Z
UID:quiz123@moodle.univ.edu
URL:https://moodle.univ.edu/mod/quiz/view.php?id=123
END:VEVENT
END:VCALENDAR
"#;

        let assessments = parse_moodle_ics_content(ics, &schedule, None);
        assert_eq!(assessments.len(), 1);
        let a = &assessments[0];
        assert_eq!(a.id, "moodle-quiz123_moodle.univ.edu");
        assert_eq!(a.course_id, "CS101");
        assert_eq!(a.course_name, "Introduction to Computer Science");
        assert_eq!(a.title, "CS101 Online Quiz 1");
        assert_eq!(a.assessment_type, "Online Quiz");
        // The feed stamps UTC times; convert to the machine's local zone so the
        // assertion holds on hosts in any timezone.
        let expected_start = chrono::DateTime::parse_from_rfc3339("2026-10-20T10:00:00Z")
            .unwrap()
            .with_timezone(&Local);
        let expected_end = chrono::DateTime::parse_from_rfc3339("2026-10-20T11:00:00Z")
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(a.date_iso, expected_start.format("%Y-%m-%d").to_string());
        assert_eq!(a.start_time, expected_start.format("%H:%M").to_string());
        assert_eq!(a.end_time, expected_end.format("%H:%M").to_string());
        assert_eq!(a.room, "Lab 301");
        assert_eq!(
            a.elearning_url,
            "https://moodle.univ.edu/mod/quiz/view.php?id=123"
        );
        assert_eq!(a.source, "Moodle");
    }

    #[test]
    fn test_parse_moodle_ics_content_course_and_slot_matching() {
        let schedule = sample_schedule();
        let ics = r#"
BEGIN:VEVENT
SUMMARY:Calculus II Midterm Exam
DESCRIPTION:Calculus II midterm review
DTSTART:20261105T140000
DTEND:20261105T160000
UID:midterm456
END:VEVENT
"#;

        let assessments = parse_moodle_ics_content(ics, &schedule, None);
        assert_eq!(assessments.len(), 1);
        let a = &assessments[0];
        assert_eq!(a.course_id, "MATH201");
        assert_eq!(a.course_name, "Calculus II");
        assert_eq!(a.color, "#ef4444");
        assert_eq!(a.room, "E-Learning Lab / Online");
    }

    #[test]
    fn test_parse_moodle_ics_content_filtering() {
        let schedule = sample_schedule();
        let ics = r#"
BEGIN:VEVENT
SUMMARY:General Lecture Intro
DESCRIPTION:Welcome to the term orientation
DTSTART:20260901T090000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Study Group Meeting
DESCRIPTION:Weekly sync up for project discussions
DTSTART:20260902T100000Z
END:VEVENT
"#;

        let assessments = parse_moodle_ics_content(ics, &schedule, None);
        assert!(assessments.is_empty());
    }

    #[test]
    fn test_parse_moodle_ics_content_assessment_types() {
        let schedule = sample_schedule();
        let ics = r#"
BEGIN:VEVENT
SUMMARY:CS101 Midterm
DTSTART:20261010T090000
END:VEVENT
BEGIN:VEVENT
SUMMARY:CS101 Final Exam
DTSTART:20261210T090000
END:VEVENT
BEGIN:VEVENT
SUMMARY:CS101 Lab Assessment 1
DTSTART:20261015T090000
END:VEVENT
BEGIN:VEVENT
SUMMARY:CS101 Homework Assignment
DTSTART:20261020T090000
END:VEVENT
BEGIN:VEVENT
SUMMARY:CS101 Quiz 2
DTSTART:20261025T090000
END:VEVENT
"#;

        let assessments = parse_moodle_ics_content(ics, &schedule, None);
        assert_eq!(assessments.len(), 5);
        assert_eq!(assessments[0].assessment_type, "Midterm Exam");
        assert_eq!(assessments[1].assessment_type, "Final Exam");
        assert_eq!(assessments[2].assessment_type, "Lab Assessment");
        assert_eq!(assessments[3].assessment_type, "Assignment");
        assert_eq!(assessments[4].assessment_type, "Online Quiz");
    }

    #[test]
    fn test_parse_moodle_ics_content_date_parsing_and_fallbacks() {
        let schedule = sample_schedule();
        let ics = r#"
BEGIN:VEVENT
SUMMARY:CS101 Quiz Date Only
DTSTART:20261018
END:VEVENT
BEGIN:VEVENT
SUMMARY:CS101 Exam Fallback Date
UID:no-date-1
END:VEVENT
"#;

        let assessments = parse_moodle_ics_content(ics, &schedule, None);
        assert_eq!(assessments.len(), 1);

        assert_eq!(assessments[0].date_iso, "2026-10-18");
        assert_eq!(assessments[0].start_time, "09:00");
        assert_eq!(assessments[0].end_time, "10:30");

        // An event without DTSTART is skipped outright: no invented dates.
        assert!(assessments.iter().all(|a| a.id != "moodle-no-date-1"));
    }

    #[test]
    fn test_parse_moodle_ics_content_formatting_topics_warnings() {
        let schedule = sample_schedule();
        let ics = r#"
BEGIN:VEVENT
SUMMARY:CS101 Quiz\, Chapter 1
DESCRIPTION:Instructions:\n• Lecture 1 - Basics\n- Chapter 2 - Functions\n* Arrays and Strings\nNote: 30 minute time limit\, password required
DTSTART:20261020T100000Z
END:VEVENT
"#;

        let assessments = parse_moodle_ics_content(ics, &schedule, None);
        assert_eq!(assessments.len(), 1);
        let a = &assessments[0];

        assert_eq!(a.title, "CS101 Quiz, Chapter 1");
        assert!(a.warnings.iter().any(|w| w.contains("Timed submission")));
        assert!(a.warnings.iter().any(|w| w.contains("password")));
        assert!(a.topics.contains(&"Lecture 1 - Basics".to_string()));
        assert!(a.topics.contains(&"Chapter 2 - Functions".to_string()));
        assert!(a.topics.contains(&"Arrays and Strings".to_string()));
    }

    #[test]
    fn test_parse_moodle_ics_content_portal_url_fallback() {
        let schedule = sample_schedule();
        let ics_no_url = r#"
BEGIN:VEVENT
SUMMARY:CS101 Quiz 3
DTSTART:20261020T100000Z
END:VEVENT
"#;

        let assessments_with_portal = parse_moodle_ics_content(
            ics_no_url,
            &schedule,
            Some("https://moodle.university.edu/"),
        );
        assert_eq!(assessments_with_portal.len(), 1);
        assert_eq!(
            assessments_with_portal[0].elearning_url,
            "https://moodle.university.edu/calendar/view.php?view=upcoming"
        );

        let assessments_default = parse_moodle_ics_content(ics_no_url, &schedule, None);
        assert_eq!(assessments_default.len(), 1);
        assert_eq!(assessments_default[0].elearning_url, "https://moodle.org");
    }
}
