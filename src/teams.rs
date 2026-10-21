use crate::models::{AppConfig, Assessment, Course, ScheduleData, ScheduleSlot};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::sync::LazyLock;

pub const DEFAULT_MS_CLIENT_ID: &str = "14d82eec-204b-4c2f-b7e8-296a70dab67e"; // Official Microsoft Graph Command Line Tools
pub const MS_TOKEN_FILE: &str = "microsoft_token.json";
pub const GRAPH_MAX_PAGES: usize = 10;

/// Shared Microsoft Graph HTTP client with bounded timeouts so a hung Graph
/// request can never stall the sync pipeline forever.
pub static GRAPH_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("Failed to build shared Microsoft Graph HTTP client")
});

/// Fetch a Graph collection endpoint, transparently following `@odata.nextLink`
/// (up to GRAPH_MAX_PAGES) and concatenating every `value` array into one list.
pub async fn graph_get_all_pages(token: &str, first_url: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut url = first_url.to_string();
    for _ in 0..GRAPH_MAX_PAGES {
        let resp = match GRAPH_HTTP_CLIENT.get(&url).bearer_auth(token).send().await {
            Ok(r) => r,
            Err(_) => break,
        };
        if !resp.status().is_success() {
            break;
        }
        let val = match resp.json::<Value>().await {
            Ok(v) => v,
            Err(_) => break,
        };
        if let Some(arr) = val.get("value").and_then(|a| a.as_array()) {
            items.extend(arr.iter().cloned());
        }
        match val
            .get("@odata.nextLink")
            .and_then(|n| n.as_str())
            .map(|s| s.to_string())
        {
            Some(next) if next != url => url = next,
            _ => break,
        }
    }
    items
}

#[derive(Debug, Default)]
struct TeamBundle {
    id: String,
    name: String,
    desc: String,
    channels: Vec<String>,
    tabs: Vec<String>,
    files: Vec<String>,
    discoveries: Vec<String>,
    conversations: Vec<String>,
}

async fn fetch_team_channels_and_tabs(token: &str, team_id: &str) -> (Vec<String>, Vec<String>) {
    if team_id.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let channels_url = format!(
        "https://graph.microsoft.com/v1.0/teams/{}/channels",
        team_id
    );
    let items = graph_get_all_pages(token, &channels_url).await;
    let mut channels = Vec::with_capacity(items.len());
    let mut channel_refs = Vec::with_capacity(items.len());
    for channel in &items {
        let channel_id = channel
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or_default();
        let channel_name = channel
            .get("displayName")
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let channel_email = channel
            .get("email")
            .and_then(|e| e.as_str())
            .unwrap_or_default();
        channels.push(format!(
            "Channel: {} (Email: {})",
            channel_name, channel_email
        ));
        if !channel_id.is_empty() {
            channel_refs.push((channel_id.to_string(), channel_name.to_string()));
        }
    }

    let tab_groups = stream::iter(channel_refs)
        .map(|(channel_id, channel_name)| async move {
            let tabs_url = format!(
                "https://graph.microsoft.com/v1.0/teams/{}/channels/{}/tabs",
                team_id, channel_id
            );
            graph_get_all_pages(token, &tabs_url)
                .await
                .iter()
                .filter_map(|tab| {
                    tab.get("displayName")
                        .and_then(|n| n.as_str())
                        .map(|tab_name| format!("{} (Channel: {})", tab_name, channel_name))
                })
                .collect::<Vec<_>>()
        })
        .buffered(3)
        .collect::<Vec<Vec<String>>>()
        .await;

    (channels, tab_groups.into_iter().flatten().collect())
}

enum DriveEntry {
    Direct {
        file: String,
        discovery: String,
    },
    Folder {
        id: String,
        name: String,
        team_name: String,
    },
}

async fn fetch_team_drive(
    token: &str,
    team_id: &str,
    team_name: &str,
) -> (Vec<String>, Vec<String>) {
    if team_id.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let drive_url = format!(
        "https://graph.microsoft.com/v1.0/groups/{}/drive/root/children",
        team_id
    );
    let items = graph_get_all_pages(token, &drive_url).await;
    let mut entries = Vec::with_capacity(items.len());
    for item in &items {
        let item_id = item.get("id").and_then(|i| i.as_str()).unwrap_or_default();
        let item_name = item
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let item_size = item.get("size").and_then(|s| s.as_i64()).unwrap_or(0);
        let is_folder = item.get("folder").is_some();
        let modified = item
            .get("lastModifiedDateTime")
            .and_then(|m| m.as_str())
            .unwrap_or_default();

        if is_folder && !item_id.is_empty() {
            entries.push(DriveEntry::Folder {
                id: item_id.to_string(),
                name: item_name.to_string(),
                team_name: team_name.to_string(),
            });
        } else {
            entries.push(DriveEntry::Direct {
                file: format!(
                    "{} (size: {} KB, uploaded: {})",
                    item_name,
                    item_size / 1024,
                    modified
                ),
                discovery: format!("{}: {}", team_name, item_name),
            });
        }
    }

    let groups = stream::iter(entries)
        .map(|entry| async move {
            match entry {
                DriveEntry::Direct { file, discovery } => (vec![file], vec![discovery]),
                DriveEntry::Folder {
                    id,
                    name,
                    team_name,
                } => {
                    let sub_url = format!(
                        "https://graph.microsoft.com/v1.0/groups/{}/drive/items/{}/children",
                        team_id, id
                    );
                    let sub_items = graph_get_all_pages(token, &sub_url).await;
                    let mut files = Vec::with_capacity(sub_items.len());
                    let mut discoveries = Vec::with_capacity(sub_items.len());
                    for sub in &sub_items {
                        let sub_name = sub.get("name").and_then(|n| n.as_str()).unwrap_or_default();
                        let sub_size = sub.get("size").and_then(|s| s.as_i64()).unwrap_or(0);
                        let sub_modified = sub
                            .get("lastModifiedDateTime")
                            .and_then(|m| m.as_str())
                            .unwrap_or_default();
                        files.push(format!(
                            "{}/{} (size: {} KB, uploaded: {})",
                            name,
                            sub_name,
                            sub_size / 1024,
                            sub_modified
                        ));
                        discoveries.push(format!("{}: {}", team_name, sub_name));
                    }
                    (files, discoveries)
                }
            }
        })
        .buffered(3)
        .collect::<Vec<(Vec<String>, Vec<String>)>>()
        .await;

    let mut files = Vec::new();
    let mut discoveries = Vec::new();
    for (group_files, group_discoveries) in groups {
        files.extend(group_files);
        discoveries.extend(group_discoveries);
    }
    (files, discoveries)
}

async fn fetch_team_conversations(token: &str, team_id: &str) -> Vec<String> {
    if team_id.is_empty() {
        return Vec::new();
    }

    let conversations_url = format!(
        "https://graph.microsoft.com/v1.0/groups/{}/conversations",
        team_id
    );
    graph_get_all_pages(token, &conversations_url)
        .await
        .iter()
        .map(|conversation| {
            let topic = conversation
                .get("topic")
                .and_then(|t| t.as_str())
                .unwrap_or_default();
            let preview = conversation
                .get("preview")
                .and_then(|p| p.as_str())
                .unwrap_or_default();
            format!("Topic: {} | Preview: {}", topic, preview)
        })
        .collect()
}

async fn fetch_team_bundle(token: &str, team: &Value) -> TeamBundle {
    let id = team
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or_default()
        .to_string();
    let name = team
        .get("displayName")
        .and_then(|n| n.as_str())
        .unwrap_or_default()
        .to_string();
    let desc = team
        .get("description")
        .and_then(|d| d.as_str())
        .unwrap_or_default()
        .to_string();

    let ((channels, tabs), (files, discoveries), conversations) = tokio::join!(
        fetch_team_channels_and_tabs(token, &id),
        fetch_team_drive(token, &id, &name),
        fetch_team_conversations(token, &id),
    );

    TeamBundle {
        id,
        name,
        desc,
        channels,
        tabs,
        files,
        discoveries,
        conversations,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicrosoftStoredToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicrosoftTestResult {
    pub success: bool,
    pub message: String,
    pub user_display_name: Option<String>,
    pub user_principal_name: Option<String>,
    pub items_found: usize,
    pub teams_count: usize,
    pub courses_found: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TeamsSyncResult {
    pub assessments: Vec<Assessment>,
    pub discovered_courses: Vec<Course>,
    pub discovered_slots: Vec<ScheduleSlot>,
    pub semester: Option<String>,
    pub university: Option<String>,
    pub user_display_name: Option<String>,
    pub user_email: Option<String>,
    /// Set when the sync silently refreshed an expired Microsoft access token;
    /// the caller must persist it so subsequent syncs start warm.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refreshed_access_token: Option<String>,
}

pub fn load_stored_microsoft_token() -> Option<MicrosoftStoredToken> {
    if let Ok(raw) = fs::read_to_string(MS_TOKEN_FILE) {
        if let Ok(tok) = serde_json::from_str::<MicrosoftStoredToken>(&raw) {
            return Some(tok);
        }
    }
    None
}

pub fn save_stored_microsoft_token(token: &MicrosoftStoredToken) {
    if let Ok(json) = serde_json::to_string_pretty(token) {
        // Atomic write: a crash mid-write must never corrupt the token file.
        let tmp = format!("{}.tmp", MS_TOKEN_FILE);
        if fs::write(&tmp, json).is_ok() {
            let _ = fs::rename(&tmp, MS_TOKEN_FILE);
        }
    }
}

pub fn clear_stored_microsoft_token() {
    let _ = fs::remove_file(MS_TOKEN_FILE);
}

pub fn build_microsoft_oauth_url(port: u16, client_id: Option<&str>) -> String {
    let cid = client_id
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_MS_CLIENT_ID);
    let redirect_uri = format!("http://localhost:{}/api/auth/microsoft/callback", port);
    let scopes = "offline_access User.Read Mail.Read Calendars.Read";

    // `prompt=select_account` forces the Microsoft account picker so the user
    // explicitly chooses the university account (MS identity platform accepts
    // a single prompt value, unlike Google's space-separated list).
    let state = crate::auth::generate_and_store_oauth_state();
    format!(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&state={}&prompt=select_account",
        crate::urlencoding::encode(cid),
        crate::urlencoding::encode(&redirect_uri),
        crate::urlencoding::encode(scopes),
        crate::urlencoding::encode(&state)
    )
}

pub async fn exchange_microsoft_code_for_token(
    code: &str,
    port: u16,
    client_id: Option<&str>,
) -> Result<MicrosoftStoredToken, String> {
    let cid = client_id
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_MS_CLIENT_ID);
    let redirect_uri = format!("http://localhost:{}/api/auth/microsoft/callback", port);
    let client = GRAPH_HTTP_CLIENT.clone();

    let params = [
        ("client_id", cid),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &redirect_uri),
    ];

    let resp = client
        .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to request Microsoft token: {}", e))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Microsoft token exchange failed: {}", err_text));
    }

    let token_data: MicrosoftStoredToken = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Microsoft token JSON: {}", e))?;

    save_stored_microsoft_token(&token_data);
    Ok(token_data)
}

pub fn clean_team_course_name(name: &str) -> String {
    let lower = name.to_lowercase();
    // Only filter obvious non-course noise groups; never invent course identities.
    if lower.contains("advising")
        || lower.contains("cohort 20")
        || lower == "general chat"
        || lower == "general"
        || lower == "announcements"
        || lower == "staff"
        || lower == "faculty"
        || lower == "test team"
    {
        return String::new();
    }
    name.trim().to_string()
}

pub async fn test_microsoft_connection(
    token_str: Option<&str>,
) -> Result<MicrosoftTestResult, String> {
    let tok = token_str
        .map(|s| s.to_string())
        .or_else(|| load_stored_microsoft_token().map(|t| t.access_token))
        .ok_or_else(|| "No Microsoft access token provided or found in storage".to_string())?;

    let client = &*GRAPH_HTTP_CLIENT;
    let resp = client
        .get("https://graph.microsoft.com/v1.0/me")
        .bearer_auth(&tok)
        .send()
        .await
        .map_err(|e| format!("Connection error reaching Microsoft Graph: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Microsoft Graph returned status {}", resp.status()));
    }

    let val: Value = resp.json().await.map_err(|e| e.to_string())?;
    let display_name = val
        .get("displayName")
        .and_then(|v| v.as_str())
        .map(String::from);
    let user_principal = val
        .get("userPrincipalName")
        .and_then(|v| v.as_str())
        .map(String::from);

    // Fetch joined teams live (with @odata.nextLink pagination)
    let mut teams_count = 0;
    let mut courses_found = Vec::new();
    let mut materials_count = 0;
    let teams_items =
        graph_get_all_pages(&tok, "https://graph.microsoft.com/v1.0/me/joinedTeams").await;
    if !teams_items.is_empty() {
        teams_count = teams_items.len();

        let drive_counts = {
            let tok_for_lists = tok.clone();
            let group_ids: Vec<String> = teams_items
                .iter()
                .filter_map(|t| t.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect();
            stream::iter(group_ids)
                .map(move |id| {
                    let tok = tok_for_lists.clone();
                    async move {
                        let drive_url = format!(
                            "https://graph.microsoft.com/v1.0/groups/{}/drive/root/children",
                            id
                        );
                        graph_get_all_pages(&tok, &drive_url).await.len()
                    }
                })
                .buffered(4)
                .collect::<Vec<usize>>()
                .await
        };
        materials_count = drive_counts.into_iter().sum();

        for t in &teams_items {
            if let Some(name) = t.get("displayName").and_then(|n| n.as_str()) {
                let name_clean = clean_team_course_name(name);
                if !name_clean.is_empty() && !courses_found.contains(&name_clean) {
                    courses_found.push(name_clean);
                }
            }
        }
    }

    let items_found = materials_count.max(courses_found.len());

    Ok(MicrosoftTestResult {
        success: true,
        message: format!("Connected to Microsoft Graph! Discovered {} teams, {} enrolled courses & {} uploaded course materials/assignments.", teams_count, courses_found.len(), materials_count),
        user_display_name: display_name,
        user_principal_name: user_principal,
        items_found,
        teams_count,
        courses_found,
    })
}

pub async fn sync_teams_assessments(
    config: &AppConfig,
    _schedule: &ScheduleData,
) -> Result<TeamsSyncResult, String> {
    if !config.teams_enabled {
        return Ok(TeamsSyncResult::default());
    }

    let token = config
        .teams_token
        .clone()
        .or_else(|| load_stored_microsoft_token().map(|t| t.access_token));

    let mut tok = match token {
        Some(t) if !t.trim().is_empty() => t,
        _ => return Ok(TeamsSyncResult::default()),
    };

    let mut refreshed_access_token: Option<String> = None;

    let client = &*GRAPH_HTTP_CLIENT;

    // 1. Fetch user profile — and if the access token has expired (401),
    //    silently refresh it and retry once. Microsoft access tokens live
    //    ~60-90 minutes; without this, Teams sync silently stops producing
    //    data an hour after sign-in until the user logs in again.
    let mut user_display_name = None;
    let mut user_email = None;
    let mut profile_resp = client
        .get("https://graph.microsoft.com/v1.0/me")
        .bearer_auth(&tok)
        .send()
        .await;
    if matches!(&profile_resp, Ok(r) if r.status().as_u16() == 401) {
        if let Some(stored) = load_stored_microsoft_token() {
            if let Some(ref rt) = stored.refresh_token {
                let cid = config
                    .teams_client_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(DEFAULT_MS_CLIENT_ID);
                let params = [
                    ("client_id", cid),
                    ("refresh_token", rt.as_str()),
                    ("grant_type", "refresh_token"),
                    ("scope", "offline_access User.Read Mail.Read Calendars.Read"),
                ];
                if let Ok(resp) = client
                    .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
                    .form(&params)
                    .send()
                    .await
                {
                    if resp.status().is_success() {
                        if let Ok(new_tok) = resp.json::<MicrosoftStoredToken>().await {
                            if !new_tok.access_token.is_empty() {
                                tok = new_tok.access_token.clone();
                                refreshed_access_token = Some(tok.clone());
                                save_stored_microsoft_token(&new_tok);
                                eprintln!("Microsoft access token silently refreshed.");
                                profile_resp = client
                                    .get("https://graph.microsoft.com/v1.0/me")
                                    .bearer_auth(&tok)
                                    .send()
                                    .await;
                            }
                        }
                    }
                }
            }
        }
    }
    if let Ok(resp) = profile_resp {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                user_display_name = v
                    .get("displayName")
                    .and_then(|n| n.as_str())
                    .map(String::from);
                user_email = v
                    .get("userPrincipalName")
                    .and_then(|n| n.as_str())
                    .map(String::from);
            }
        }
    }

    // 2. Fetch joined teams with channels, tabs, drive files, and group conversations
    //    (every collection is followed through @odata.nextLink pagination)
    let teams_items =
        graph_get_all_pages(&tok, "https://graph.microsoft.com/v1.0/me/joinedTeams").await;
    let mut teams_list = Vec::new();
    let mut discovered_files_summary = Vec::new();
    let mut raw_teams_info = Vec::new();

    if !teams_items.is_empty() {
        let tok_bundles = tok.clone();
        let bundles = stream::iter(teams_items)
            .map(move |team| {
                let tok = tok_bundles.clone();
                async move { fetch_team_bundle(&tok, &team).await }
            })
            .buffered(4)
            .collect::<Vec<TeamBundle>>()
            .await;

        for bundle in bundles {
            teams_list.push((bundle.id, bundle.name.clone(), bundle.desc.clone()));
            discovered_files_summary.extend(bundle.discoveries);
            raw_teams_info.push(format!(
                "TEAM / CLASS: {}\nDescription: {}\nChannels: {}\nTabs: {}\nUploaded Course Files & Assignments:\n- {}\nConversations: {}\n",
                bundle.name,
                bundle.desc,
                if bundle.channels.is_empty() { "General".to_string() } else { bundle.channels.join("; ") },
                if bundle.tabs.is_empty() { "None".to_string() } else { bundle.tabs.join(", ") },
                if bundle.files.is_empty() { "None discovered".to_string() } else { bundle.files.join("\n- ") },
                if bundle.conversations.is_empty() { "None".to_string() } else { bundle.conversations.join("; ") }
            ));
        }
    }

    // 3. Assemble deep raw context
    let raw_context = format!(
        "STUDENT PROFILE:\nName: {}\nEmail: {}\n\nDISCOVERED MICROSOFT TEAMS CLASSES, CHANNELS, TABS & UPLOADED ASSIGNMENT FILES:\n{}",
        user_display_name.as_deref().unwrap_or("Student"),
        user_email.as_deref().unwrap_or("student@university.edu"),
        raw_teams_info.join("\n---\n")
    );

    // 4. Try Gemini AI exploration first!
    if let Some(discovered) = crate::gemini::explore_and_extract_academic_universe(
        "Microsoft Teams",
        &raw_context,
        config.gemini_api_key.as_deref(),
    )
    .await
    {
        if !discovered.courses.is_empty() {
            return Ok(TeamsSyncResult {
                assessments: discovered.assessments,
                discovered_courses: discovered.courses,
                discovered_slots: discovered.slots,
                // Real discovery passthrough: never fabricate a semester or university
                // identity that the source data did not state.
                semester: discovered.semester,
                university: discovered.university_or_institution,
                user_display_name,
                user_email,
                refreshed_access_token,
            });
        }
    }

    // 5. Intelligent Heuristic Discovery Fallback (Runs if Gemini offline or no API key)
    let heuristic = explore_teams_heuristically(
        user_display_name.as_deref(),
        user_email.as_deref(),
        &teams_list,
        &discovered_files_summary,
    );

    Ok(heuristic)
}

pub fn explore_teams_heuristically(
    user_display_name: Option<&str>,
    user_email: Option<&str>,
    teams_list: &[(String, String, String)],
    _discovered_files: &[String],
) -> TeamsSyncResult {
    let mut courses = Vec::new();

    let palette = [
        ("#1a73e8", "#e8f0fe", "#1a73e8"),
        ("#0f9d58", "#e6f4ea", "#137333"),
        ("#ea8600", "#fef7e0", "#ea8600"),
        ("#00acc1", "#e0f7fa", "#00838f"),
        ("#8e24aa", "#f3e5f5", "#6a1b9a"),
        ("#d93025", "#fce8e6", "#d93025"),
    ];

    for (_id, name, _desc) in teams_list {
        let clean = clean_team_course_name(name);
        if clean.is_empty() || courses.iter().any(|c: &Course| c.id == clean) {
            continue;
        }

        let (color, bg, border) = palette[courses.len() % palette.len()];
        courses.push(Course {
            id: clean.clone(),
            name: clean,
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    // No fabricated assessments, slots, semester names or universities:
    // only course names genuinely discovered from the student's Teams are returned.
    TeamsSyncResult {
        assessments: Vec::new(),
        discovered_courses: courses,
        discovered_slots: Vec::new(),
        semester: None,
        university: None,
        user_display_name: user_display_name.map(String::from),
        user_email: user_email.map(String::from),
        refreshed_access_token: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_team_course_name_filters_noise() {
        assert_eq!(clean_team_course_name("Academic Advising"), "");
        assert_eq!(clean_team_course_name("advising session"), "");
        assert_eq!(clean_team_course_name("Cohort 2026 Students"), "");
        assert_eq!(clean_team_course_name("Cohort 2027 cs"), "");
    }

    #[test]
    fn test_clean_team_course_name_preserves_real_courses() {
        // Real course names must NEVER be remapped to a different fabricated identity
        assert_eq!(clean_team_course_name("Math 101"), "Math 101");
        assert_eq!(
            clean_team_course_name("Advanced Calculus"),
            "Advanced Calculus"
        );
        assert_eq!(
            clean_team_course_name("Financial Accounting I"),
            "Financial Accounting I"
        );
        assert_eq!(clean_team_course_name("  Physics 101  "), "Physics 101");
        assert_eq!(clean_team_course_name("Chemistry 201"), "Chemistry 201");
        assert_eq!(clean_team_course_name("   "), "");
        assert_eq!(clean_team_course_name(""), "");
    }

    #[test]
    fn test_heuristic_discovery_uses_only_real_teams() {
        let teams = vec![
            (
                "1".to_string(),
                "Financial Accounting I".to_string(),
                String::new(),
            ),
            ("2".to_string(), "General Chat".to_string(), String::new()),
            (
                "3".to_string(),
                "Academic Advising".to_string(),
                String::new(),
            ),
        ];
        let result = explore_teams_heuristically(Some("Ali"), Some("a@uni.edu"), &teams, &[]);
        assert_eq!(result.assessments.len(), 0, "no invented assessments");
        assert_eq!(result.discovered_slots.len(), 0, "no invented timetable");
        assert_eq!(result.semester, None);
        assert_eq!(result.university, None);
        assert_eq!(result.discovered_courses.len(), 1);
        assert_eq!(result.discovered_courses[0].id, "Financial Accounting I");
    }

    #[test]
    fn test_heuristic_discovery_empty_teams() {
        let result = explore_teams_heuristically(None, None, &[], &[]);
        assert!(result.discovered_courses.is_empty());
        assert!(result.assessments.is_empty());
    }
}
