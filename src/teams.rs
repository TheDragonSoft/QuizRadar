use crate::models::{AppConfig, Assessment, Course, ScheduleData, ScheduleSlot};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;

pub const DEFAULT_MS_CLIENT_ID: &str = "14d82eec-204b-4c2f-b7e8-296a70dab67e"; // Official Microsoft Graph Command Line Tools
pub const MS_TOKEN_FILE: &str = "microsoft_token.json";

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
        let _ = fs::write(MS_TOKEN_FILE, json);
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

    format!(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}",
        crate::urlencoding::encode(cid),
        crate::urlencoding::encode(&redirect_uri),
        crate::urlencoding::encode(scopes)
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
    let client = reqwest::Client::new();

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

pub async fn test_microsoft_connection(token_str: Option<&str>) -> Result<MicrosoftTestResult, String> {
    let tok = token_str
        .map(|s| s.to_string())
        .or_else(|| load_stored_microsoft_token().map(|t| t.access_token))
        .ok_or_else(|| "No Microsoft access token provided or found in storage".to_string())?;

    let client = reqwest::Client::new();
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
    let display_name = val.get("displayName").and_then(|v| v.as_str()).map(String::from);
    let user_principal = val.get("userPrincipalName").and_then(|v| v.as_str()).map(String::from);

    // Fetch joined teams live
    let mut teams_count = 0;
    let mut courses_found = Vec::new();
    let mut materials_count = 0;
    if let Ok(t_resp) = client.get("https://graph.microsoft.com/v1.0/me/joinedTeams").bearer_auth(&tok).send().await {
        if t_resp.status().is_success() {
            if let Ok(t_val) = t_resp.json::<Value>().await {
                if let Some(teams) = t_val.get("value").and_then(|v| v.as_array()) {
                    teams_count = teams.len();
                    for t in teams {
                        if let Some(id) = t.get("id").and_then(|i| i.as_str()) {
                            let dr_url = format!("https://graph.microsoft.com/v1.0/groups/{}/drive/root/children", id);
                            if let Ok(dr_resp) = client.get(&dr_url).bearer_auth(&tok).send().await {
                                if let Ok(dr_val) = dr_resp.json::<Value>().await {
                                    if let Some(arr) = dr_val.get("value").and_then(|a| a.as_array()) {
                                        materials_count += arr.len();
                                    }
                                }
                            }
                        }
                        if let Some(name) = t.get("displayName").and_then(|n| n.as_str()) {
                            let name_clean = clean_team_course_name(name);
                            if !name_clean.is_empty() && !courses_found.contains(&name_clean) {
                                courses_found.push(name_clean);
                            }
                        }
                    }
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

    let tok = match token {
        Some(t) if !t.trim().is_empty() => t,
        _ => return Ok(TeamsSyncResult::default()),
    };

    let client = reqwest::Client::new();

    // 1. Fetch user profile
    let mut user_display_name = None;
    let mut user_email = None;
    if let Ok(resp) = client.get("https://graph.microsoft.com/v1.0/me").bearer_auth(&tok).send().await {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                user_display_name = v.get("displayName").and_then(|n| n.as_str()).map(String::from);
                user_email = v.get("userPrincipalName").and_then(|n| n.as_str()).map(String::from);
            }
        }
    }

    // 2. Fetch joined teams with channels, tabs, drive files, and group conversations
    let mut raw_teams_info = Vec::new();
    let mut teams_list = Vec::new();
    let mut discovered_files_summary = Vec::new();

    if let Ok(resp) = client.get("https://graph.microsoft.com/v1.0/me/joinedTeams").bearer_auth(&tok).send().await {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                if let Some(arr) = v.get("value").and_then(|a| a.as_array()) {
                    for t in arr {
                        let id = t.get("id").and_then(|i| i.as_str()).unwrap_or_default().to_string();
                        let name = t.get("displayName").and_then(|n| n.as_str()).unwrap_or_default().to_string();
                        let desc = t.get("description").and_then(|d| d.as_str()).unwrap_or_default().to_string();
                        teams_list.push((id.clone(), name.clone(), desc.clone()));

                        // A. Fetch channels and channel tabs for this team
                        let mut channels = Vec::new();
                        let mut tabs = Vec::new();
                        let ch_url = format!("https://graph.microsoft.com/v1.0/teams/{}/channels", id);
                        if let Ok(ch_resp) = client.get(&ch_url).bearer_auth(&tok).send().await {
                            if ch_resp.status().is_success() {
                                if let Ok(ch_val) = ch_resp.json::<Value>().await {
                                    if let Some(ch_arr) = ch_val.get("value").and_then(|a| a.as_array()) {
                                        for ch in ch_arr {
                                            let ch_id = ch.get("id").and_then(|i| i.as_str()).unwrap_or_default();
                                            let ch_name = ch.get("displayName").and_then(|n| n.as_str()).unwrap_or_default();
                                            let ch_email = ch.get("email").and_then(|e| e.as_str()).unwrap_or_default();
                                            channels.push(format!("Channel: {} (Email: {})", ch_name, ch_email));

                                            // Fetch channel tabs (Assignments, Classwork, Grades, Files, Forms)
                                            if !ch_id.is_empty() {
                                                let tab_url = format!("https://graph.microsoft.com/v1.0/teams/{}/channels/{}/tabs", id, ch_id);
                                                if let Ok(tb_resp) = client.get(&tab_url).bearer_auth(&tok).send().await {
                                                    if tb_resp.status().is_success() {
                                                        if let Ok(tb_val) = tb_resp.json::<Value>().await {
                                                            if let Some(tb_arr) = tb_val.get("value").and_then(|a| a.as_array()) {
                                                                for tab in tb_arr {
                                                                    if let Some(tab_name) = tab.get("displayName").and_then(|n| n.as_str()) {
                                                                        tabs.push(format!("{} (Channel: {})", tab_name, ch_name));
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // B. Fetch drive files (Course Materials, Uploaded Assignments, Sheets, Forms)
                        let mut files = Vec::new();
                        let drive_url = format!("https://graph.microsoft.com/v1.0/groups/{}/drive/root/children", id);
                        if let Ok(dr_resp) = client.get(&drive_url).bearer_auth(&tok).send().await {
                            if dr_resp.status().is_success() {
                                if let Ok(dr_val) = dr_resp.json::<Value>().await {
                                    if let Some(dr_arr) = dr_val.get("value").and_then(|a| a.as_array()) {
                                        for item in dr_arr {
                                            let item_id = item.get("id").and_then(|i| i.as_str()).unwrap_or_default();
                                            let item_name = item.get("name").and_then(|n| n.as_str()).unwrap_or_default();
                                            let item_size = item.get("size").and_then(|s| s.as_i64()).unwrap_or(0);
                                            let is_folder = item.get("folder").is_some();
                                            let modified = item.get("lastModifiedDateTime").and_then(|m| m.as_str()).unwrap_or_default();

                                            if is_folder && !item_id.is_empty() {
                                                // Check folder contents (e.g. General, Lectures, Class Materials)
                                                let sub_url = format!("https://graph.microsoft.com/v1.0/groups/{}/drive/items/{}/children", id, item_id);
                                                if let Ok(sub_resp) = client.get(&sub_url).bearer_auth(&tok).send().await {
                                                    if sub_resp.status().is_success() {
                                                        if let Ok(sub_val) = sub_resp.json::<Value>().await {
                                                            if let Some(sub_arr) = sub_val.get("value").and_then(|a| a.as_array()) {
                                                                for sub in sub_arr {
                                                                    let sub_name = sub.get("name").and_then(|n| n.as_str()).unwrap_or_default();
                                                                    let sub_size = sub.get("size").and_then(|s| s.as_i64()).unwrap_or(0);
                                                                    let sub_mod = sub.get("lastModifiedDateTime").and_then(|m| m.as_str()).unwrap_or_default();
                                                                    files.push(format!("{}/{} (size: {} KB, uploaded: {})", item_name, sub_name, sub_size / 1024, sub_mod));
                                                                    discovered_files_summary.push(format!("{}: {}", name, sub_name));
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            } else {
                                                files.push(format!("{} (size: {} KB, uploaded: {})", item_name, item_size / 1024, modified));
                                                discovered_files_summary.push(format!("{}: {}", name, item_name));
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // C. Fetch conversations for this group
                        let mut convs = Vec::new();
                        let conv_url = format!("https://graph.microsoft.com/v1.0/groups/{}/conversations", id);
                        if let Ok(c_resp) = client.get(&conv_url).bearer_auth(&tok).send().await {
                            if c_resp.status().is_success() {
                                if let Ok(c_val) = c_resp.json::<Value>().await {
                                    if let Some(c_arr) = c_val.get("value").and_then(|a| a.as_array()) {
                                        for c in c_arr {
                                            let topic = c.get("topic").and_then(|t| t.as_str()).unwrap_or_default();
                                            let preview = c.get("preview").and_then(|p| p.as_str()).unwrap_or_default();
                                            convs.push(format!("Topic: {} | Preview: {}", topic, preview));
                                        }
                                    }
                                }
                            }
                        }

                        raw_teams_info.push(format!(
                            "TEAM / CLASS: {}\nDescription: {}\nChannels: {}\nTabs: {}\nUploaded Course Files & Assignments:\n- {}\nConversations: {}\n",
                            name,
                            desc,
                            if channels.is_empty() { "General".to_string() } else { channels.join("; ") },
                            if tabs.is_empty() { "None".to_string() } else { tabs.join(", ") },
                            if files.is_empty() { "None discovered".to_string() } else { files.join("\n- ") },
                            if convs.is_empty() { "None".to_string() } else { convs.join("; ") }
                        ));
                    }
                }
            }
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
    ).await {
        if !discovered.courses.is_empty() {
            return Ok(TeamsSyncResult {
                assessments: discovered.assessments,
                discovered_courses: discovered.courses,
                discovered_slots: discovered.slots,
                semester: discovered.semester.or_else(|| Some("Fall 2026".to_string())),
                university: discovered.university_or_institution.or_else(|| Some("State University".to_string())),
                user_display_name,
                user_email,
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
        assert_eq!(clean_team_course_name("Advanced Calculus"), "Advanced Calculus");
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
            ("1".to_string(), "Financial Accounting I".to_string(), String::new()),
            ("2".to_string(), "General Chat".to_string(), String::new()),
            ("3".to_string(), "Academic Advising".to_string(), String::new()),
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
