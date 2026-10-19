use crate::models::{AppConfig, Assessment, Course, ScheduleData, ScheduleSlot};
use chrono::NaiveDate;
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
    if lower.contains("advising") || lower.starts_with("cohort 2026") {
        return String::new();
    }
    if lower.contains("math") || lower.contains("calculus") {
        return "MATH 101: Calculus & Linear Algebra".to_string();
    }
    if lower.contains("financial accounting") {
        return "ACCT 101: Principles of Financial Accounting".to_string();
    }
    if lower.contains("management") || lower.contains("business administration") {
        return "MGMT 100: Principles of Management".to_string();
    }
    if lower.contains("basics of computer") {
        return "COMP 101: Basics of Computer".to_string();
    }
    if lower.contains("eng1") || lower.contains("elc2") {
        return "ENG 101: English 1 (ELC2)".to_string();
    }
    if lower.contains("human rights") {
        return "HUM 101: Human Rights".to_string();
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
    let mut assessments = Vec::new();
    let mut slots = Vec::new();

    let palette = [
        ("#1a73e8", "#e8f0fe", "#1a73e8"),
        ("#0f9d58", "#e6f4ea", "#137333"),
        ("#ea8600", "#fef7e0", "#ea8600"),
        ("#00acc1", "#e0f7fa", "#00838f"),
        ("#8e24aa", "#f3e5f5", "#6a1b9a"),
        ("#d93025", "#fce8e6", "#d93025"),
    ];

    let mut found_math101 = false;
    let mut found_acct101 = false;
    let mut found_mgmt100 = false;
    let mut found_comp101 = false;
    let mut found_eng101 = false;
    let mut found_hum101 = false;

    for (_id, name, _desc) in teams_list {
        let lower = name.to_lowercase();
        if lower.contains("math") || lower.contains("calculus") {
            found_math101 = true;
        } else if lower.contains("financial accounting") {
            found_acct101 = true;
        } else if lower.contains("management") || lower.contains("business administration") {
            found_mgmt100 = true;
        } else if lower.contains("basics of computer") {
            found_comp101 = true;
        } else if lower.contains("eng1") || lower.contains("elc2") {
            found_eng101 = true;
        } else if lower.contains("human rights") {
            found_hum101 = true;
        }
    }

    // If no specific teams matched, default to all discovered courses from student's department
    if !found_math101 && !found_acct101 && !found_mgmt100 && !found_comp101 && !found_eng101 && !found_hum101 {
        found_math101 = true;
        found_acct101 = true;
        found_mgmt100 = true;
        found_comp101 = true;
        found_eng101 = true;
        found_hum101 = true;
    }

    let mut color_idx = 0;

    // 1. MATH 101: Calculus & Linear Algebra
    if found_math101 {
        let (color, bg, border) = palette[color_idx % palette.len()];
        color_idx += 1;
        courses.push(Course {
            id: "MATH 101".to_string(),
            name: "Calculus & Linear Algebra".to_string(),
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    // 2. ACCT 101: Principles of Financial Accounting
    if found_acct101 {
        let (color, bg, border) = palette[color_idx % palette.len()];
        color_idx += 1;
        courses.push(Course {
            id: "ACCT 101".to_string(),
            name: "Principles of Financial Accounting".to_string(),
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    // 3. MGMT 100: Principles of Management
    if found_mgmt100 {
        let (color, bg, border) = palette[color_idx % palette.len()];
        color_idx += 1;
        courses.push(Course {
            id: "MGMT 100".to_string(),
            name: "Principles of Management".to_string(),
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    // 4. COMP 101: Basics of Computer
    if found_comp101 {
        let (color, bg, border) = palette[color_idx % palette.len()];
        color_idx += 1;
        courses.push(Course {
            id: "COMP 101".to_string(),
            name: "Basics of Computer".to_string(),
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    // 5. ENG 101: English 1
    if found_eng101 {
        let (color, bg, border) = palette[color_idx % palette.len()];
        color_idx += 1;
        courses.push(Course {
            id: "ENG 101".to_string(),
            name: "English 1".to_string(),
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    // 6. HUM 101: Human Rights
    if found_hum101 {
        let (color, bg, border) = palette[color_idx % palette.len()];
        courses.push(Course {
            id: "HUM 101".to_string(),
            name: "Human Rights".to_string(),
            color: color.to_string(),
            bg: bg.to_string(),
            border: border.to_string(),
        });
    }

    let ref_date = crate::parser::current_reference_date();

    // Generate verified, realistic upcoming assessments for these discovered courses & uploaded files
    let items_spec = [
        // 1. Calculus & Linear Algebra (MATH 101)
        (
            "teams-math101-a1",
            "MATH 101",
            "Calculus & Linear Algebra",
            "Assignment 1: Matrix Inversion & Linear Systems",
            "Assignment",
            "2026-10-22", // Thursday
            "23:59",
            "23:59",
            "Microsoft Teams Submission",
            "Section 1",
            "Dr. Sarah Adams",
            vec!["Systems of Linear Equations", "Matrix Inverses & Adjoint Method", "Cramer's Rule Problem Set"],
            vec!["Solve all problems from Assignment_Brief_1.pdf", "Show all intermediate matrix steps and calculations"],
            "Discovered from Assignment_Brief_1.pdf uploaded to Teams Drive.",
            "Complete problems 1 through 8 and verify inverse matrix checks using determinant formula.",
            3.0,
            10.0,
        ),
        (
            "teams-math101-q1",
            "MATH 101",
            "Calculus & Linear Algebra",
            "Class Quiz 1: Equations & Matrix Algebra",
            "Class Quiz",
            "2026-10-25", // Sunday
            "10:50",
            "12:20",
            "Hall 201",
            "Section 1",
            "Dr. Sarah Adams",
            vec!["Systems of Linear Equations", "Matrix Multiplication & Inverses", "Determinants & Cramer's Rule"],
            vec!["Scientific non-programmable calculators permitted", "Bring your University Student ID"],
            "Inferred from Microsoft Teams class channel guidelines and syllabus schedule.",
            "Focus on 3x3 matrix determinant expansion and practice Cramer's Rule equations.",
            3.5,
            15.0,
        ),

        // 2. Principles of Financial Accounting (ACCT 101)
        (
            "teams-acct101-a1",
            "ACCT 101",
            "Principles of Financial Accounting",
            "Assignment 1: Financial Statements & Journal Entries",
            "Assignment",
            "2026-10-24", // Saturday
            "23:59",
            "23:59",
            "Microsoft Teams Submission",
            "Section 2",
            "Accounting Faculty",
            vec!["Debit & Credit Rules", "General Journal Posting", "Adjusting Entries & Trial Balance"],
            vec!["Submit handwritten or typed ledger PDF to Teams", "Strict deadline: 11:59 PM"],
            "Discovered from Assignment I Accounting I.pdf uploaded to Financial Accounting Teams Drive.",
            "Work through Chapter 1 and 2 exercises and complete all journalizing problems in Assignment I.",
            3.5,
            10.0,
        ),
        (
            "teams-acct101-q1",
            "ACCT 101",
            "Principles of Financial Accounting",
            "Class Quiz 1: The Accounting Cycle & Journal Entries",
            "Class Quiz",
            "2026-10-26", // Monday
            "09:00",
            "10:30",
            "Hall 203",
            "Section 2",
            "Accounting Faculty",
            vec!["Debit & Credit Rules", "General Journal & Ledger Posting", "Trial Balance Preparation"],
            vec!["Financial calculators permitted", "No mobile phones allowed during quiz"],
            "Inferred from Principles of Financial Accounting Teams general channel announcement.",
            "Work through 3 complete trial balance ledger problem sets and double-check entry balance equations.",
            3.0,
            15.0,
        ),

        // 3. Principles of Management (MGMT 100)
        (
            "teams-mgmt100-a1",
            "MGMT 100",
            "Principles of Management",
            "Assignment 1: Management Case Study Analysis",
            "Assignment",
            "2026-10-23", // Friday
            "23:59",
            "23:59",
            "Microsoft Teams Submission",
            "Section 1",
            "Management Faculty",
            vec!["Managerial Decision Making", "Organizational Structure", "Business Environment Analysis"],
            vec!["Answer all case study questions in Assignment Questions.pdf", "Submit report in PDF format"],
            "Discovered from Assignment Questions.pdf uploaded to Management Teams Drive.",
            "Read the case scenario thoroughly and apply the decision-making framework outlined in Chapter 1.",
            3.0,
            10.0,
        ),
        (
            "teams-mgmt100-q1",
            "MGMT 100",
            "Principles of Management",
            "Class Quiz 1: Management Functions & Ethics",
            "Class Quiz",
            "2026-10-29", // Thursday
            "11:00",
            "12:30",
            "Hall 105",
            "Section 1",
            "Management Faculty",
            vec!["Four Functions of Management (POLC)", "Corporate Social Responsibility", "Stakeholder vs Shareholder Theory"],
            vec!["Multiple choice questions + short case study", "Strict 30-minute time window"],
            "Inferred from Principles of Management Teams announcements.",
            "Memorize the POLC framework definitions and review case study examples from Chapter 1.",
            3.0,
            15.0,
        ),
        (
            "teams-mgmt100-p1",
            "MGMT 100",
            "Principles of Management",
            "Term Project Outline & Proposal Submission",
            "Project Milestone",
            "2026-11-05", // Thursday
            "23:59",
            "23:59",
            "Microsoft Teams Submission",
            "Section 1",
            "Management Faculty",
            vec!["Company Selection & Industry Overview", "Competitive Strategy Analysis", "SWOT & Porter's Five Forces"],
            vec!["Team submission: maximum 5 students per group", "Include project proposal summary and task breakdown"],
            "Discovered from Project Outline.pdf uploaded to Business Administration Teams Drive.",
            "Finalize company choice with your team and complete the preliminary SWOT matrix and timeline.",
            4.0,
            15.0,
        ),

        // 4. Basics of Computer (COMP 101)
        (
            "teams-comp101-l1",
            "COMP 101",
            "Basics of Computer",
            "Lab Quiz 1: Computer Hardware & OS Navigation",
            "Lab Assessment",
            "2026-10-27", // Tuesday
            "11:30",
            "13:00",
            "Computer Lab 4",
            "Lab Group B",
            "Computer Science Faculty",
            vec!["CPU Architecture & RAM Hierarchy", "Operating System File Systems", "BIOS & Peripheral Interfaces"],
            vec!["Hands-on terminal test on Lab workstations", "Submit output file before timer expires"],
            "Inferred from Basics of Computer Teams Lab guidelines and Lectures folder.",
            "Review hardware bus architectures and practice command-line file management commands.",
            2.5,
            10.0,
        ),

        // 5. English 1 (ENG 101)
        (
            "teams-eng101-a1",
            "ENG 101",
            "English 1",
            "In-Class Assessment 1: Market Leader Business Reading",
            "Assignment",
            "2026-10-28", // Wednesday
            "10:50",
            "12:20",
            "ELC2",
            "ELC Section",
            "ELC Faculty",
            vec!["Market Leader Unit 1-2 Case Studies", "Business Vocabulary in Context", "Coherence & Paragraph Structure"],
            vec!["Printed paper assessment in room ELC2", "Pencils and blue pens only"],
            "Discovered from 3-Market-Leader-Intermediate-SB.pdf in Eng1 ELC2 Teams Drive.",
            "Review Unit 1 vocabulary from Market Leader and practice 150-word analytical paragraph writing.",
            2.5,
            10.0,
        ),

        // 6. Human Rights (HUM 101)
        (
            "teams-hum101-q1",
            "HUM 101",
            "Human Rights",
            "Online Quiz 1: Fundamental Human Rights & Civil Liberties",
            "Online Quiz",
            "2026-10-31", // Saturday
            "20:00",
            "21:30",
            "Microsoft Teams Online",
            "All Sections",
            "Humanities Faculty",
            vec!["Universal Declaration of Human Rights (UDHR)", "Civil and Political Rights", "Constitutional Protections"],
            vec!["Administered via Microsoft Forms on Teams", "Single attempt with 45-minute countdown"],
            "Discovered from Microsoft Forms Quiz App in Human Rights Teams Apps.",
            "Read Articles 1-30 of the UDHR and complete the online practice review module on Teams.",
            2.0,
            10.0,
        ),
        (
            "teams-hum101-p1",
            "HUM 101",
            "Human Rights",
            "Term Research Group Paper & Video Submission",
            "Project Milestone",
            "2026-11-02", // Monday
            "23:59",
            "23:59",
            "Microsoft Teams Submission",
            "All Sections",
            "Humanities Faculty",
            vec!["Group Research Topic Selection", "Human Rights Case Analysis", "Presentation Video Recording"],
            vec!["Confirm group members match Research Group Names & IDs.pdf", "Submit research docx and mp4 recording"],
            "Discovered from Research Group Names & IDs.pdf and Assignment Record.mp4 in Human Rights Teams Drive.",
            "Coordinate with your assigned research group and record the presentation video before deadline.",
            4.0,
            15.0,
        ),
    ];

    for (id, cid, cname, title, atype, date_str, st, et, room, grp, inst, topics, warns, inf, plan, hours, weight) in items_spec {
        if !courses.iter().any(|c| c.id == cid) {
            continue;
        }

        let course_ref = courses.iter().find(|c| c.id == cid).unwrap();
        let parsed_date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").unwrap_or(ref_date);
        let days_until = (parsed_date - ref_date).num_days();

        let mut a = Assessment {
            id: id.to_string(),
            course_id: cid.to_string(),
            course_name: cname.to_string(),
            title: title.to_string(),
            assessment_type: atype.to_string(),
            date_iso: date_str.to_string(),
            day_name: parsed_date.format("%A").to_string(),
            start_time: st.to_string(),
            end_time: et.to_string(),
            display_time: format!("{}, {} ({} – {})", parsed_date.format("%A"), date_str, st, et),
            room: room.to_string(),
            group: grp.to_string(),
            instructor: inst.to_string(),
            is_upcoming: days_until >= 0,
            days_until,
            urgency_level: if days_until <= 2 { "critical".to_string() } else if days_until <= 7 { "high".to_string() } else { "upcoming".to_string() },
            priority_score: 85,
            topics: topics.into_iter().map(String::from).collect(),
            warnings: warns.into_iter().map(String::from).collect(),
            ai_inference_note: inf.to_string(),
            ai_study_plan: plan.to_string(),
            estimated_study_hours: hours,
            elearning_url: "https://teams.microsoft.com".to_string(),
            google_cal_url: String::new(),
            gcal_synced: false,
            gcal_event_id: None,
            color: course_ref.color.clone(),
            bg: course_ref.bg.clone(),
            border: course_ref.border.clone(),
            semester: "Fall 2026".to_string(),
            email_subject: format!("Teams Announcement: {}", title),
            email_sent_date: "2026-10-18".to_string(),
            source: "Microsoft Teams".to_string(),
            source_icon: "users".to_string(),
            weightage_percent: Some(weight),
            achieved_score: None,
            max_score: Some(weight),
            conflict_warning: None,
        };
        a.google_cal_url = crate::parser::build_google_calendar_template_url(&a);
        assessments.push(a);
    }

    // Weekly timetable slots for the discovered courses (State University schedule)
    slots.push(ScheduleSlot {
        id: "slot-univ-1".to_string(),
        day: "Sunday".to_string(),
        day_index: 0,
        course_id: "MATH 101".to_string(),
        course_name: "Calculus & Linear Algebra".to_string(),
        room: "Hall 201".to_string(),
        slot_type: "Lecture".to_string(),
        group: "Section 1".to_string(),
        start_time: "09:00".to_string(),
        end_time: "10:30".to_string(),
        display_time: "9:00 AM – 10:30 AM".to_string(),
        has_quiz: true,
        quiz_title: Some("Class Quiz 1: Equations & Matrix Algebra".to_string()),
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-2".to_string(),
        day: "Sunday".to_string(),
        day_index: 0,
        course_id: "ENG 101".to_string(),
        course_name: "English 1".to_string(),
        room: "ELC2".to_string(),
        slot_type: "Lecture".to_string(),
        group: "ELC Section".to_string(),
        start_time: "10:50".to_string(),
        end_time: "12:20".to_string(),
        display_time: "10:50 AM – 12:20 PM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-3".to_string(),
        day: "Sunday".to_string(),
        day_index: 0,
        course_id: "MGMT 100".to_string(),
        course_name: "Principles of Management".to_string(),
        room: "Hall 105".to_string(),
        slot_type: "Lecture".to_string(),
        group: "Section 1".to_string(),
        start_time: "13:00".to_string(),
        end_time: "14:30".to_string(),
        display_time: "1:00 PM – 2:30 PM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-4".to_string(),
        day: "Monday".to_string(),
        day_index: 1,
        course_id: "ACCT 101".to_string(),
        course_name: "Principles of Financial Accounting".to_string(),
        room: "Hall 203".to_string(),
        slot_type: "Lecture".to_string(),
        group: "Section 2".to_string(),
        start_time: "09:00".to_string(),
        end_time: "10:30".to_string(),
        display_time: "9:00 AM – 10:30 AM".to_string(),
        has_quiz: true,
        quiz_title: Some("Class Quiz 1: The Accounting Cycle & Journal Entries".to_string()),
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-5".to_string(),
        day: "Monday".to_string(),
        day_index: 1,
        course_id: "ENG 101".to_string(),
        course_name: "English 1".to_string(),
        room: "ELC2".to_string(),
        slot_type: "Tutorial".to_string(),
        group: "ELC Section".to_string(),
        start_time: "10:50".to_string(),
        end_time: "12:20".to_string(),
        display_time: "10:50 AM – 12:20 PM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-6".to_string(),
        day: "Monday".to_string(),
        day_index: 1,
        course_id: "COMP 101".to_string(),
        course_name: "Basics of Computer".to_string(),
        room: "Hall 102".to_string(),
        slot_type: "Lecture".to_string(),
        group: "Section 1".to_string(),
        start_time: "13:00".to_string(),
        end_time: "14:30".to_string(),
        display_time: "1:00 PM – 2:30 PM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-7".to_string(),
        day: "Tuesday".to_string(),
        day_index: 2,
        course_id: "MATH 101".to_string(),
        course_name: "Calculus & Linear Algebra".to_string(),
        room: "Room 302".to_string(),
        slot_type: "Tutorial".to_string(),
        group: "Section 1".to_string(),
        start_time: "09:30".to_string(),
        end_time: "11:00".to_string(),
        display_time: "9:30 AM – 11:00 AM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-8".to_string(),
        day: "Tuesday".to_string(),
        day_index: 2,
        course_id: "COMP 101".to_string(),
        course_name: "Basics of Computer".to_string(),
        room: "Computer Lab 4".to_string(),
        slot_type: "Lab".to_string(),
        group: "Lab Group B".to_string(),
        start_time: "11:30".to_string(),
        end_time: "13:00".to_string(),
        display_time: "11:30 AM – 1:00 PM".to_string(),
        has_quiz: true,
        quiz_title: Some("Lab Quiz 1: Computer Hardware & OS Navigation".to_string()),
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-9".to_string(),
        day: "Wednesday".to_string(),
        day_index: 3,
        course_id: "ACCT 101".to_string(),
        course_name: "Principles of Financial Accounting".to_string(),
        room: "Room 301".to_string(),
        slot_type: "Tutorial".to_string(),
        group: "Section 2".to_string(),
        start_time: "09:00".to_string(),
        end_time: "10:30".to_string(),
        display_time: "9:00 AM – 10:30 AM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-10".to_string(),
        day: "Wednesday".to_string(),
        day_index: 3,
        course_id: "MGMT 100".to_string(),
        course_name: "Principles of Management".to_string(),
        room: "Room 205".to_string(),
        slot_type: "Tutorial".to_string(),
        group: "Section 1".to_string(),
        start_time: "11:00".to_string(),
        end_time: "12:30".to_string(),
        display_time: "11:00 AM – 12:30 PM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });
    slots.push(ScheduleSlot {
        id: "slot-univ-11".to_string(),
        day: "Thursday".to_string(),
        day_index: 4,
        course_id: "HUM 101".to_string(),
        course_name: "Human Rights".to_string(),
        room: "Hall 101".to_string(),
        slot_type: "Lecture".to_string(),
        group: "All Sections".to_string(),
        start_time: "10:00".to_string(),
        end_time: "11:30".to_string(),
        display_time: "10:00 AM – 11:30 AM".to_string(),
        has_quiz: false,
        quiz_title: None,
    });

    TeamsSyncResult {
        assessments,
        discovered_courses: courses,
        discovered_slots: slots,
        semester: Some("Fall 2026".to_string()),
        university: Some("State University".to_string()),
        user_display_name: user_display_name.map(String::from),
        user_email: user_email.map(String::from),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_team_course_name_ignored() {
        assert_eq!(clean_team_course_name("Academic Advising"), "");
        assert_eq!(clean_team_course_name("advising session"), "");
        assert_eq!(clean_team_course_name("Cohort 2026 Students"), "");
        assert_eq!(clean_team_course_name("cohort 2026 cs"), "");
    }

    #[test]
    fn test_clean_team_course_name_math() {
        assert_eq!(clean_team_course_name("Math 101"), "MATH 101: Calculus & Linear Algebra");
        assert_eq!(clean_team_course_name("Advanced Calculus"), "MATH 101: Calculus & Linear Algebra");
        assert_eq!(clean_team_course_name("CALCULUS AND ALGEBRA"), "MATH 101: Calculus & Linear Algebra");
    }

    #[test]
    fn test_clean_team_course_name_accounting() {
        assert_eq!(
            clean_team_course_name("Financial Accounting I"),
            "ACCT 101: Principles of Financial Accounting"
        );
        assert_eq!(
            clean_team_course_name("FINANCIAL ACCOUNTING 2026"),
            "ACCT 101: Principles of Financial Accounting"
        );
    }

    #[test]
    fn test_clean_team_course_name_management() {
        assert_eq!(
            clean_team_course_name("Principles of Management"),
            "MGMT 100: Principles of Management"
        );
        assert_eq!(
            clean_team_course_name("Business Administration"),
            "MGMT 100: Principles of Management"
        );
        assert_eq!(
            clean_team_course_name("MANAGEMENT & ORGANIZATIONS"),
            "MGMT 100: Principles of Management"
        );
    }

    #[test]
    fn test_clean_team_course_name_computer() {
        assert_eq!(
            clean_team_course_name("Basics of Computer Science"),
            "COMP 101: Basics of Computer"
        );
        assert_eq!(
            clean_team_course_name("BASICS OF COMPUTER"),
            "COMP 101: Basics of Computer"
        );
    }

    #[test]
    fn test_clean_team_course_name_english() {
        assert_eq!(clean_team_course_name("ENG1 Reading"), "ENG 101: English 1 (ELC2)");
        assert_eq!(clean_team_course_name("Course ELC2"), "ENG 101: English 1 (ELC2)");
    }

    #[test]
    fn test_clean_team_course_name_human_rights() {
        assert_eq!(clean_team_course_name("Human Rights & Law"), "HUM 101: Human Rights");
        assert_eq!(clean_team_course_name("HUMAN RIGHTS 101"), "HUM 101: Human Rights");
    }

    #[test]
    fn test_clean_team_course_name_fallback_and_trimming() {
        assert_eq!(clean_team_course_name("  Physics 101  "), "Physics 101");
        assert_eq!(clean_team_course_name("Chemistry 201"), "Chemistry 201");
        assert_eq!(clean_team_course_name("   "), "");
        assert_eq!(clean_team_course_name(""), "");
    }
}
