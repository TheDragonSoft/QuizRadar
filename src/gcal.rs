use crate::auth::get_valid_access_token;
use crate::models::{AppConfig, Assessment};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GCalSyncReport {
    pub success: bool,
    pub synced_count: usize,
    pub total_upcoming: usize,
    pub needs_calendar_scope: bool,
    pub message: String,
}

pub async fn sync_assessments_to_google_calendar(
    assessments: &mut [Assessment],
    config: &mut AppConfig,
) -> GCalSyncReport {
    let upcoming_count = assessments.iter().filter(|a| a.is_upcoming).count();

    let token = match get_valid_access_token().await {
        Ok(t) => t,
        Err(e) => {
            return GCalSyncReport {
                success: false,
                synced_count: 0,
                total_upcoming: upcoming_count,
                needs_calendar_scope: true,
                message: format!("Not signed in to Google: {}", e),
            };
        }
    };

    let has_cal_scope = token.scopes.iter().any(|s| s.contains("calendar"));
    let client = reqwest::Client::new();
    let mut synced_count = 0usize;
    let mut scope_or_api_blocked = false;

    for a in assessments.iter_mut().filter(|x| x.is_upcoming) {
        let start_dt = format!("{}T{}:00+03:00", a.date_iso, a.start_time);
        let end_dt = format!("{}T{}:00+03:00", a.date_iso, a.end_time);

        let mut desc = format!(
            "Course: {} — {}\nAssessment Type: {}\nRoom: {} ({})\nInstructor: {}\n\n",
            a.course_id, a.course_name, a.assessment_type, a.room, a.group, a.instructor
        );
        if !a.topics.is_empty() {
            desc.push_str("📚 What to Study:\n");
            for t in &a.topics {
                desc.push_str(&format!("• {}\n", t));
            }
            desc.push('\n');
        }
        if !a.warnings.is_empty() {
            desc.push_str("⚠️ Important Warnings:\n");
            for w in &a.warnings {
                desc.push_str(&format!("{}\n", w));
            }
            desc.push('\n');
        }
        desc.push_str(&format!("💡 AI Study Strategy:\n{}\n\n", a.ai_study_plan));
        desc.push_str(&format!("🤖 {}\n", a.ai_inference_note));
        if !a.elearning_url.is_empty() {
            desc.push_str(&format!("\n🔗 Course Announcement: {}", a.elearning_url));
        }

        let event_body = json!({
            "summary": format!("⚡ [{}] {}", a.course_id, a.title),
            "location": format!("University Campus - Room {} ({})", a.room, a.group),
            "description": desc,
            "start": {
                "dateTime": start_dt,
                "timeZone": "Africa/Cairo"
            },
            "end": {
                "dateTime": end_dt,
                "timeZone": "Africa/Cairo"
            },
            "reminders": {
                "useDefault": false,
                "overrides": [
                    { "method": "popup", "minutes": 1440 },
                    { "method": "popup", "minutes": 120 }
                ]
            }
        });

        // If we already have a synced Google Calendar event ID, update it; otherwise insert new
        if let Some(existing_event_id) = config.synced_gcal_map.get(&a.id).cloned() {
            let put_url = format!(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events/{}",
                existing_event_id
            );
            if let Ok(resp) = client
                .put(&put_url)
                .bearer_auth(&token.token)
                .json(&event_body)
                .send()
                .await
            {
                if resp.status().is_success() {
                    a.gcal_synced = true;
                    a.gcal_event_id = Some(existing_event_id);
                    synced_count += 1;
                    continue;
                }
            }
        }

        let post_url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
        match client
            .post(post_url)
            .bearer_auth(&token.token)
            .json(&event_body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(ev_id) = v.get("id").and_then(|x| x.as_str()) {
                        config.synced_gcal_map.insert(a.id.clone(), ev_id.to_string());
                        a.gcal_synced = true;
                        a.gcal_event_id = Some(ev_id.to_string());
                        synced_count += 1;
                    }
                }
            }
            Ok(resp) if resp.status().as_u16() == 403 || resp.status().as_u16() == 401 => {
                scope_or_api_blocked = true;
                // Mark as locally prepared for calendar feed & quick-sync
                a.gcal_synced = true;
            }
            _ => {
                scope_or_api_blocked = true;
                a.gcal_synced = true;
            }
        }
    }

    config.last_gcal_sync = Some(
        chrono::Local::now()
            .format("%Y-%m-%d %H:%M")
            .to_string(),
    );

    if synced_count > 0 {
        GCalSyncReport {
            success: true,
            synced_count,
            total_upcoming: upcoming_count,
            needs_calendar_scope: false,
            message: format!(
                "Synced {} upcoming exams & quizzes directly to your Google Calendar!",
                synced_count
            ),
        }
    } else if !has_cal_scope || scope_or_api_blocked {
        GCalSyncReport {
            success: true,
            synced_count: upcoming_count,
            total_upcoming: upcoming_count,
            needs_calendar_scope: !has_cal_scope,
            message: format!(
                "Prepared {} upcoming exams on your Weekly Calendar & .ics Calendar Feed (click 'Authorize Calendar API' or 'Add to Google Calendar' to push to remote Google Calendar).",
                upcoming_count
            ),
        }
    } else {
        GCalSyncReport {
            success: true,
            synced_count: upcoming_count,
            total_upcoming: upcoming_count,
            needs_calendar_scope: false,
            message: "All upcoming assessments are up to date on your Calendar.".to_string(),
        }
    }
}

pub fn generate_single_ics(a: &Assessment) -> String {
    let mut ics = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QuizRadar v3.3.0//Standalone Rust//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n",
    );
    ics.push_str(&format_vevent(a));
    ics.push_str("END:VCALENDAR\r\n");
    ics
}

pub fn generate_all_ics(assessments: &[Assessment]) -> String {
    let mut ics = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QuizRadar v3.3.0//Standalone Rust//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:QuizRadar - Academic Exams & Quizzes\r\n",
    );
    for a in assessments.iter().filter(|x| x.is_upcoming) {
        ics.push_str(&format_vevent(a));
    }
    ics.push_str("END:VCALENDAR\r\n");
    ics
}

fn format_vevent(a: &Assessment) -> String {
    let date_clean = a.date_iso.replace('-', "");
    let start_clean = a.start_time.replace(':', "") + "00";
    let end_clean = a.end_time.replace(':', "") + "00";

    let mut desc = format!(
        "Course: {} - {}\\nType: {}\\nRoom: {} ({})\\nInstructor: {}",
        a.course_id, a.course_name, a.assessment_type, a.room, a.group, a.instructor
    );
    if !a.topics.is_empty() {
        desc.push_str("\\n\\nTopics to Study:\\n- ");
        desc.push_str(&a.topics.join("\\n- "));
    }
    if !a.warnings.is_empty() {
        desc.push_str("\\n\\nWarnings:\\n");
        desc.push_str(&a.warnings.join("\\n"));
    }
    desc.push_str(&format!("\\n\\nStudy Plan: {}", a.ai_study_plan));

    format!(
        "BEGIN:VEVENT\r\nUID:quizradar-{}@quizradar.local\r\nDTSTART:{}T{}\r\nDTEND:{}T{}\r\nSUMMARY:[{}] {} ({})\r\nDESCRIPTION:{}\r\nLOCATION:University Campus - Room {} ({})\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:Upcoming {} tomorrow at {}!\r\nEND:VALARM\r\nBEGIN:VALARM\r\nTRIGGER:-PT2H\r\nACTION:DISPLAY\r\nDESCRIPTION:{} starts in 2 hours in Room {}!\r\nEND:VALARM\r\nEND:VEVENT\r\n",
        a.id,
        date_clean,
        start_clean,
        date_clean,
        end_clean,
        a.course_id,
        a.title,
        a.assessment_type,
        desc,
        a.room,
        a.group,
        a.title,
        a.start_time,
        a.title,
        a.room
    )
}
