use crate::auth::get_valid_access_token;
use crate::models::{AppConfig, Assessment};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;

static GCAL_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build shared Google Calendar HTTP client")
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GCalSyncReport {
    pub success: bool,
    pub synced_count: usize,
    pub total_upcoming: usize,
    pub needs_calendar_scope: bool,
    pub message: String,
}

enum GcalOutcome {
    Updated(String),
    Created(String),
    Blocked,
    Noop,
}

/// The machine's actual UTC offset as an RFC3339-style string (e.g. "+02:00"),
/// computed from the OS timezone — never a hardcoded zone.
fn local_utc_offset_string() -> String {
    let secs = chrono::Local::now().offset().local_minus_utc();
    if secs < 0 {
        format!("-{:02}:{:02}", secs.abs() / 3600, (secs.abs() % 3600) / 60)
    } else {
        format!("+{:02}:{:02}", secs / 3600, (secs % 3600) / 60)
    }
}

fn build_event_body(a: &Assessment) -> Value {
    let offset = local_utc_offset_string();
    let start_dt = format!("{}T{}:00{}", a.date_iso, a.start_time, offset);
    let end_dt = format!("{}T{}:00{}", a.date_iso, a.end_time, offset);

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

    json!({
        "summary": format!("⚡ [{}] {}", a.course_id, a.title),
        "location": format!("University Campus - Room {} ({})", a.room, a.group),
        "description": desc,
        // The dateTime carries its own UTC offset, which fully identifies the
        // moment — no timezone-ID claim is needed or safe to fabricate.
        "start": {
            "dateTime": start_dt
        },
        "end": {
            "dateTime": end_dt
        },
        "reminders": {
            "useDefault": false,
            "overrides": [
                { "method": "popup", "minutes": 1440 },
                { "method": "popup", "minutes": 120 }
            ]
        }
    })
}

async fn sync_one_event(
    client: &reqwest::Client,
    token: &str,
    index: usize,
    existing_event_id: Option<String>,
    event_body: Value,
) -> (usize, GcalOutcome) {
    if let Some(existing_event_id) = existing_event_id {
        let put_url = format!(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events/{}",
            existing_event_id
        );
        let mut not_found = false;
        for _ in 0..2 {
            if let Ok(resp) = client
                .put(&put_url)
                .bearer_auth(token)
                .json(&event_body)
                .send()
                .await
            {
                let status = resp.status();
                if status.is_success() {
                    return (index, GcalOutcome::Updated(existing_event_id));
                }
                if status.as_u16() == 404 {
                    // The remote event was deleted by the user: forget the
                    // stale mapping and create a fresh event instead of
                    // blocking this assessment from ever syncing again.
                    not_found = true;
                    break;
                }
            }
        }
        if not_found {
            // The remote event was deleted: create a fresh one (extracted into
            // a non-recursive helper so the async fn stays boxable).
            return create_event(client, token, index, event_body).await;
        }
        return (index, GcalOutcome::Blocked);
    }

    create_event(client, token, index, event_body).await
}

async fn create_event(
    client: &reqwest::Client,
    token: &str,
    index: usize,
    event_body: Value,
) -> (usize, GcalOutcome) {
    let post_url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    match client
        .post(post_url)
        .bearer_auth(token)
        .json(&event_body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(v) = resp.json::<Value>().await {
                if let Some(ev_id) = v.get("id").and_then(|x| x.as_str()) {
                    return (index, GcalOutcome::Created(ev_id.to_string()));
                }
            }
            (index, GcalOutcome::Noop)
        }
        Ok(resp) if resp.status().as_u16() == 403 || resp.status().as_u16() == 401 => {
            (index, GcalOutcome::Blocked)
        }
        _ => (index, GcalOutcome::Blocked),
    }
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
    let client = &*GCAL_HTTP_CLIENT;
    let mut synced_count = 0usize;
    let mut scope_or_api_blocked = false;

    let pending: Vec<(usize, Option<String>, Value)> = assessments
        .iter()
        .enumerate()
        .filter(|(_, a)| a.is_upcoming)
        .map(|(index, a)| {
            (
                index,
                config.synced_gcal_map.get(&a.id).cloned(),
                build_event_body(a),
            )
        })
        .collect();

    let mut results: Vec<(usize, GcalOutcome)> = stream::iter(pending)
        .map(|(index, existing_event_id, event_body)| {
            sync_one_event(client, &token.token, index, existing_event_id, event_body)
        })
        .buffer_unordered(4)
        .collect()
        .await;
    results.sort_by_key(|(index, _)| *index);

    for (index, outcome) in results {
        let a = &mut assessments[index];
        match outcome {
            GcalOutcome::Updated(event_id) => {
                a.gcal_synced = true;
                a.gcal_event_id = Some(event_id.clone());
                config.synced_gcal_map.insert(a.id.clone(), event_id);
                synced_count += 1;
            }
            GcalOutcome::Created(event_id) => {
                config
                    .synced_gcal_map
                    .insert(a.id.clone(), event_id.clone());
                a.gcal_synced = true;
                a.gcal_event_id = Some(event_id);
                synced_count += 1;
            }
            GcalOutcome::Blocked => {
                // Honest state: the event was NOT pushed, so it must not be
                // flagged as synced.
                scope_or_api_blocked = true;
            }
            GcalOutcome::Noop => {}
        }
    }

    config.last_gcal_sync = Some(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());

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
        // An auth/scope/API failure is NOT success: callers that only check
        // the flag must not report a full failure as a clean sync.
        GCalSyncReport {
            success: upcoming_count == 0,
            synced_count: 0,
            total_upcoming: upcoming_count,
            needs_calendar_scope: !has_cal_scope,
            message: format!(
                "Prepared {} upcoming exams on your Weekly Calendar & .ics Calendar Feed ({} pushed to remote Google Calendar — click 'Authorize Calendar API' or 'Add to Google Calendar' to upload).",
                upcoming_count, synced_count
            ),
        }
    } else {
        GCalSyncReport {
            success: true,
            synced_count: 0,
            total_upcoming: upcoming_count,
            needs_calendar_scope: false,
            message: format!(
                "All upcoming assessments are up to date on your Google Calendar ({} new pushes were needed).",
                synced_count
            ),
        }
    }
}

pub fn generate_single_ics(a: &Assessment) -> String {
    let mut ics = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QuizRadar v4.2.0//Standalone Rust//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n",
    );
    ics.push_str(&format_vevent(a));
    ics.push_str("END:VCALENDAR\r\n");
    ics
}

pub fn generate_all_ics(assessments: &[Assessment]) -> String {
    let mut ics = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QuizRadar v4.2.0//Standalone Rust//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:QuizRadar - Academic Exams & Quizzes\r\n",
    );
    for a in assessments.iter().filter(|x| x.is_upcoming) {
        ics.push_str(&format_vevent(a));
    }
    ics.push_str("END:VCALENDAR\r\n");
    ics
}

fn ical_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
        .replace('\r', "")
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

    let summary = ical_escape(&format!(
        "[{}] {} ({})",
        a.course_id, a.title, a.assessment_type
    ));
    let location = ical_escape(&format!(
        "University Campus - Room {} ({})",
        a.room, a.group
    ));
    let description = ical_escape(&desc);
    let alarm_soon = ical_escape(&format!(
        "Upcoming {} tomorrow at {}!",
        a.title, a.start_time
    ));
    let alarm_later = ical_escape(&format!(
        "{} starts in 2 hours in Room {}!",
        a.title, a.room
    ));

    format!(
        "BEGIN:VEVENT\r\nUID:quizradar-{}@quizradar.local\r\nDTSTART:{}T{}\r\nDTEND:{}T{}\r\nSUMMARY:{}\r\nDESCRIPTION:{}\r\nLOCATION:{}\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:{}\r\nEND:VALARM\r\nBEGIN:VALARM\r\nTRIGGER:-PT2H\r\nACTION:DISPLAY\r\nDESCRIPTION:{}\r\nEND:VALARM\r\nEND:VEVENT\r\n",
        a.id,
        date_clean,
        start_clean,
        date_clean,
        end_clean,
        summary,
        description,
        location,
        alarm_soon,
        alarm_later
    )
}
