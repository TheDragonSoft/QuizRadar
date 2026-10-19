use crate::auth::get_valid_access_token;
use crate::models::{AppConfig, Assessment, AssessmentGrade, CustomCalendarEvent, ScheduleData};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

const DRIVE_FILE_NAME: &str = "quizradar_cloud_state.json";
const CALENDAR_SYNC_TITLE: &str = "[QuizRadar-Device-Sync-State]";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizRadarCloudState {
    pub schema_version: u32,
    pub client_device_id: String,
    pub updated_at: String, // ISO 8601 UTC
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub schedule: ScheduleData,
    pub assessments: Vec<Assessment>,
    pub grades: HashMap<String, AssessmentGrade>,
    pub completed_topics: HashMap<String, bool>,
    pub custom_events: Vec<CustomCalendarEvent>,
    pub teams_enabled: bool,
    pub teams_token: Option<String>,
    pub moodle_enabled: bool,
    pub classroom_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSyncReport {
    pub success: bool,
    pub channel: String, // "Google Drive AppData" or "Google Calendar Extended Sync"
    pub action: String,  // "pushed", "pulled", "merged"
    pub timestamp: String,
    pub assessments_count: usize,
    pub courses_count: usize,
    pub completed_topics_count: usize,
    pub message: String,
}

/// Discovers the local machine's preferred IPv4 address for mobile device pairing
pub fn get_local_pairing_ip() -> String {
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

/// Push local application state to the user's Google Cloud account
pub async fn push_cloud_state(
    cfg: &AppConfig,
    schedule: &ScheduleData,
    assessments: &[Assessment],
    device_id: &str,
) -> Result<CloudSyncReport, String> {
    let token = get_valid_access_token().await?;
    let client = reqwest::Client::new();
    let now_iso = Utc::now().to_rfc3339();

    let cloud_state = QuizRadarCloudState {
        schema_version: 1,
        client_device_id: device_id.to_string(),
        updated_at: now_iso.clone(),
        user_email: cfg.user_email.clone(),
        user_name: cfg.user_name.clone(),
        schedule: schedule.clone(),
        assessments: assessments.to_vec(),
        grades: cfg.grades.clone(),
        completed_topics: cfg.completed_topics.clone(),
        custom_events: cfg.custom_events.clone(),
        teams_enabled: cfg.teams_enabled,
        teams_token: cfg.teams_token.clone(),
        moodle_enabled: cfg.moodle_enabled,
        classroom_enabled: cfg.classroom_enabled,
    };

    let serialized = serde_json::to_string(&cloud_state)
        .map_err(|e| format!("Serialization error: {}", e))?;

    // Attempt 1: Google Drive AppData folder
    if let Ok(res) = push_to_google_drive(&client, &token.token, &serialized).await {
        return Ok(CloudSyncReport {
            success: true,
            channel: "Google Drive AppData".to_string(),
            action: "pushed".to_string(),
            timestamp: now_iso,
            assessments_count: cloud_state.assessments.len(),
            courses_count: cloud_state.schedule.courses.len(),
            completed_topics_count: cloud_state.completed_topics.len(),
            message: format!("State safely stored in hidden Google Drive AppData ({})", res),
        });
    }

    // Attempt 2: Fallback to Google Calendar Private Sync Record
    // Since Google Calendar scope is already authorized on the user's account
    let cal_res = push_to_google_calendar(&client, &token.token, &serialized).await?;
    Ok(CloudSyncReport {
        success: true,
        channel: "Google Calendar Cloud Sync".to_string(),
        action: "pushed".to_string(),
        timestamp: now_iso,
        assessments_count: cloud_state.assessments.len(),
        courses_count: cloud_state.schedule.courses.len(),
        completed_topics_count: cloud_state.completed_topics.len(),
        message: format!("Synchronized state across devices via Google Account Cloud Store ({})", cal_res),
    })
}

/// Pull cloud state from Google Cloud account
pub async fn pull_cloud_state() -> Result<Option<QuizRadarCloudState>, String> {
    let token = get_valid_access_token().await?;
    let client = reqwest::Client::new();

    // Try Google Drive AppData first
    if let Ok(Some(state)) = pull_from_google_drive(&client, &token.token).await {
        return Ok(Some(state));
    }

    // Try Google Calendar Cloud Store fallback
    pull_from_google_calendar(&client, &token.token).await
}

async fn push_to_google_drive(
    client: &reqwest::Client,
    access_token: &str,
    content: &str,
) -> Result<String, String> {
    // 1. Search for existing file in appDataFolder
    let search_url = format!(
        "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='{}' and trashed=false&fields=files(id,name)",
        DRIVE_FILE_NAME
    );
    let search_resp = client
        .get(&search_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Drive search request failed: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!("Drive API search returned {}", search_resp.status()));
    }

    let search_json: Value = search_resp
        .json()
        .await
        .map_err(|e| format!("Invalid search json: {}", e))?;

    let existing_id = search_json
        .get("files")
        .and_then(|f| f.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("id"))
        .and_then(|id| id.as_str())
        .map(|s| s.to_string());

    if let Some(file_id) = existing_id {
        // Update existing file content
        let upload_url = format!(
            "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media",
            file_id
        );
        let resp = client
            .patch(&upload_url)
            .bearer_auth(access_token)
            .header("Content-Type", "application/json")
            .body(content.to_string())
            .send()
            .await
            .map_err(|e| format!("Drive update failed: {}", e))?;

        if resp.status().is_success() {
            return Ok(format!("Updated file {}", file_id));
        }
        return Err(format!("Drive update error: HTTP {}", resp.status()));
    }

    // Create new file via multipart upload
    let boundary = "-------QuizRadarBoundary7MA4YWxkTrZu0gW";
    let body_multipart = format!(
        "--{}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{}\r\nContent-Type: application/json\r\n\r\n{}\r\n--{}--",
        boundary,
        json!({
            "name": DRIVE_FILE_NAME,
            "parents": ["appDataFolder"]
        }),
        boundary,
        content,
        boundary
    );

    let create_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    let resp = client
        .post(create_url)
        .bearer_auth(access_token)
        .header("Content-Type", format!("multipart/related; boundary={}", boundary))
        .body(body_multipart)
        .send()
        .await
        .map_err(|e| format!("Drive create failed: {}", e))?;

    if resp.status().is_success() {
        return Ok("Created new appData file".to_string());
    }
    Err(format!("Drive create error: HTTP {}", resp.status()))
}

async fn pull_from_google_drive(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Option<QuizRadarCloudState>, String> {
    let search_url = format!(
        "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='{}' and trashed=false&fields=files(id,name,modifiedTime)",
        DRIVE_FILE_NAME
    );
    let search_resp = client
        .get(&search_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Drive search failed: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!("Drive HTTP {}", search_resp.status()));
    }

    let search_json: Value = search_resp.json().await.map_err(|e| e.to_string())?;
    let file_id = search_json
        .get("files")
        .and_then(|f| f.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("id"))
        .and_then(|id| id.as_str());

    let fid = match file_id {
        Some(id) => id,
        None => return Ok(None),
    };

    let download_url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?alt=media",
        fid
    );
    let dl_resp = client
        .get(&download_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Drive download failed: {}", e))?;

    if dl_resp.status().is_success() {
        let state: QuizRadarCloudState = dl_resp
            .json()
            .await
            .map_err(|e| format!("Corrupt cloud json: {}", e))?;
        return Ok(Some(state));
    }

    Err(format!("Drive download returned {}", dl_resp.status()))
}

async fn push_to_google_calendar(
    client: &reqwest::Client,
    access_token: &str,
    content: &str,
) -> Result<String, String> {
    // Search for existing sync event in primary calendar
    let search_url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?q={}&maxResults=5",
        crate::urlencoding::encode(CALENDAR_SYNC_TITLE)
    );
    let search_resp = client
        .get(&search_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Calendar search failed: {}", e))?;

    let existing_event_id = if search_resp.status().is_success() {
        let v: Value = search_resp.json().await.unwrap_or(Value::Null);
        v.get("items")
            .and_then(|i| i.as_array())
            .and_then(|arr| {
                arr.iter().find(|e| {
                    e.get("summary")
                        .and_then(|s| s.as_str())
                        .map(|s| s.contains(CALENDAR_SYNC_TITLE))
                        .unwrap_or(false)
                })
            })
            .and_then(|e| e.get("id"))
            .and_then(|id| id.as_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    let encoded_payload = format!("---QUIZRADAR_DATA_START---\n{}\n---QUIZRADAR_DATA_END---", content);
    // Fallback storage via a private calendar bookmark event. Diff the event to
    // today so it never accumulates stale remnants in the user's calendar.
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let event_body = json!({
        "summary": CALENDAR_SYNC_TITLE,
        "description": encoded_payload,
        "start": { "dateTime": format!("{}T00:00:00Z", today) },
        "end": { "dateTime": format!("{}T00:05:00Z", today) },
        "transparency": "transparent"
    });

    if let Some(event_id) = existing_event_id {
        let url = format!(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events/{}",
            event_id
        );
        let resp = client
            .put(&url)
            .bearer_auth(access_token)
            .json(&event_body)
            .send()
            .await
            .map_err(|e| format!("Calendar sync update failed: {}", e))?;

        if resp.status().is_success() {
            return Ok(format!("Updated sync record {}", event_id));
        }
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Calendar sync update error HTTP {} - {}", status, text));
    }

    let url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    let resp = client
        .post(url)
        .bearer_auth(access_token)
        .json(&event_body)
        .send()
        .await
        .map_err(|e| format!("Calendar sync create failed: {}", e))?;

    if resp.status().is_success() {
        return Ok("Created initial cross-device sync record".to_string());
    }

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    Err(format!("Calendar sync create error HTTP {} - {}", status, text))
}

async fn pull_from_google_calendar(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Option<QuizRadarCloudState>, String> {
    let search_url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?q={}&maxResults=5",
        crate::urlencoding::encode(CALENDAR_SYNC_TITLE)
    );
    let search_resp = client
        .get(&search_url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Calendar search failed: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!("Calendar search returned HTTP {}", search_resp.status()));
    }

    let v: Value = search_resp.json().await.map_err(|e| e.to_string())?;
    let description = v
        .get("items")
        .and_then(|i| i.as_array())
        .and_then(|arr| {
            arr.iter().find(|e| {
                e.get("summary")
                    .and_then(|s| s.as_str())
                    .map(|s| s.contains(CALENDAR_SYNC_TITLE))
                    .unwrap_or(false)
            })
        })
        .and_then(|e| e.get("description"))
        .and_then(|d| d.as_str());

    let raw_desc = match description {
        Some(d) => d,
        None => return Ok(None),
    };

    if let Some(start) = raw_desc.find("---QUIZRADAR_DATA_START---\n") {
        let after = &raw_desc[start + "---QUIZRADAR_DATA_START---\n".len()..];
        if let Some(end) = after.find("\n---QUIZRADAR_DATA_END---") {
            let json_str = &after[..end];
            let state: QuizRadarCloudState = serde_json::from_str(json_str)
                .map_err(|e| format!("Invalid sync payload: {}", e))?;
            return Ok(Some(state));
        }
    }

    Ok(None)
}
