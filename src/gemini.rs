use crate::auth::get_valid_access_token;
use crate::models::{CachedEmail, ScheduleData};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;

const GEMINI_CACHE_FILE: &str = "data/gemini_parsed_cache.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiExtractedAssessment {
    pub is_assessment: bool,
    pub course_id: String,
    pub course_name: String,
    pub title: String,
    pub assessment_type: String,
    pub date_iso: String,
    pub start_time: String,
    pub end_time: String,
    pub room: String,
    pub group: String,
    pub instructor: String,
    pub topics: Vec<String>,
    pub warnings: Vec<String>,
    pub ai_inference_note: String,
    pub ai_study_plan: String,
    pub estimated_study_hours: f32,
}

pub fn load_gemini_cache() -> HashMap<String, GeminiExtractedAssessment> {
    if let Ok(raw) = fs::read_to_string(GEMINI_CACHE_FILE) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, GeminiExtractedAssessment>>(&raw) {
            return map;
        }
    }
    HashMap::new()
}

pub fn save_gemini_cache(cache: &HashMap<String, GeminiExtractedAssessment>) {
    let _ = fs::create_dir_all("data");
    if let Ok(json) = serde_json::to_string_pretty(cache) {
        let _ = fs::write(GEMINI_CACHE_FILE, json);
    }
}

pub async fn analyze_email_with_gemini(
    email: &CachedEmail,
    schedule: &ScheduleData,
    api_key: Option<&str>,
) -> Option<GeminiExtractedAssessment> {
    let schedule_json = serde_json::to_string(&schedule.slots).unwrap_or_default();

    let prompt = format!(
        r#"You are an intelligent university academic assistant inside QuizRadar.
Analyze the following university announcement email and determine the exact assessment details by cross-referencing the email's sent date and body with the student's enrolled weekly class schedule.

STUDENT'S WEEKLY CLASS SCHEDULE (Fall 2026):
{schedule_json}

Note on Cross-Listed Courses:
- Course forum "CSE354" (Algorithm Efficiency & Recursion) corresponds to course_id "CSE261" (Algorithms and Data Structures) on the student's schedule.
- Always match "during the lecture", "in tutorial", or "in lab" to the student's actual scheduled slot for that course to determine the exact date_iso (YYYY-MM-DD), start_time (HH:MM), end_time (HH:MM), room, and group.
- Anchor relative phrases like "this week", "next week (not this week)", or "next Wednesday" to the email's Sent Date!

EMAIL METADATA:
- Subject: {subject}
- From: {from}
- Sent Date: {date}
- Body:
{body}

Return ONLY a valid JSON object matching this exact structure:
{{
  "is_assessment": true,
  "course_id": "CSE263",
  "course_name": "Machine Learning and Pattern Recognition",
  "title": "Quiz 1: Machine Learning",
  "assessment_type": "Class Quiz",
  "date_iso": "2026-10-19",
  "start_time": "13:00",
  "end_time": "15:30",
  "room": "C203 O",
  "group": "Group B",
  "instructor": "Dr. Mohamed Hussien Rehan",
  "topics": ["Lecture 1: Introduction", "Lecture 2: Regression"],
  "warnings": ["Bring printed Quiz Template"],
  "ai_inference_note": "Brief explanation of how the exact date, time, and room were inferred from the email + student schedule.",
  "ai_study_plan": "Specific, actionable 2-sentence study recommendation for these topics.",
  "estimated_study_hours": 3.5
}}"#,
        schedule_json = schedule_json,
        subject = email.subject,
        from = email.from,
        date = email.date,
        body = email.body
    );

    let payload = json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    });

    let client = reqwest::Client::new();

    // 1. Try explicit Gemini API key if provided by user or environment
    let env_key = std::env::var("GEMINI_API_KEY")
        .ok()
        .or_else(|| std::env::var("GOOGLE_API_KEY").ok());
    let effective_key = api_key
        .filter(|k| !k.trim().is_empty())
        .map(|k| k.to_string())
        .or(env_key);

    if let Some(key) = effective_key {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
            crate::urlencoding::encode(&key)
        );
        if let Ok(resp) = client.post(&url).json(&payload).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(parsed) = extract_candidate_json(&v) {
                        return Some(parsed);
                    }
                }
            }
        }
    }

    // 2. Try signed-in user's Google OAuth Bearer token with Gemini API
    if let Ok(stored) = get_valid_access_token().await {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
        if let Ok(resp) = client
            .post(url)
            .bearer_auth(&stored.token)
            .json(&payload)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(parsed) = extract_candidate_json(&v) {
                        return Some(parsed);
                    }
                }
            }
        }
    }

    None
}

fn extract_candidate_json(v: &Value) -> Option<GeminiExtractedAssessment> {
    let text = v
        .get("candidates")?
        .get(0)?
        .get("content")?
        .get("parts")?
        .get(0)?
        .get("text")?
        .as_str()?;

    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str::<GeminiExtractedAssessment>(cleaned).ok()
}

pub fn generate_course_palette(hex_color: &str) -> (String, String) {
    let clean = hex_color.trim().trim_start_matches('#');
    let (r, g, b) = if clean.len() == 6 {
        (
            u8::from_str_radix(&clean[0..2], 16).unwrap_or(26),
            u8::from_str_radix(&clean[2..4], 16).unwrap_or(115),
            u8::from_str_radix(&clean[4..6], 16).unwrap_or(232),
        )
    } else {
        (26, 115, 232)
    };
    let bg = format!("rgba({}, {}, {}, 0.12)", r, g, b);
    let border = format!("#{}", clean);
    (bg, border)
}

pub fn normalize_day_index(day: &str) -> u8 {
    match day.trim().to_lowercase().as_str() {
        "sunday" | "sun" => 0,
        "monday" | "mon" => 1,
        "tuesday" | "tue" => 2,
        "wednesday" | "wed" => 3,
        "thursday" | "thu" => 4,
        "friday" | "fri" => 5,
        "saturday" | "sat" => 6,
        _ => 0,
    }
}

pub async fn extract_schedule_with_gemini(
    file_base64: &str,
    mime_type: &str,
    api_key: Option<&str>,
) -> Result<ScheduleData, String> {
    let prompt = r##"You are an intelligent university timetable extraction assistant inside QuizRadar.
Analyze the provided university weekly timetable / class schedule image or document.
Extract all enrolled courses and recurring weekly class timeslots.

Requirements:
1. "semester": The semester title if visible, e.g. "Fall 2026" (or "Current Semester").
2. "courses": Array of all distinct enrolled courses/subjects:
   - "id": The course code (e.g. "CSE261", "MATH201", "CS101", etc.)
   - "name": Full course name/title
   - "color": A distinct vibrant hex color code (e.g. "#1a73e8", "#0f9d58", "#ea8600", "#d93025", "#8e24aa", "#00acc1", "#e67c73", "#3949ab")
3. "slots": Array of all weekly recurring class sessions:
   - "id": unique identifier like "slot-1", "slot-2"
   - "course_id": matching course code
   - "course_name": matching course name
   - "day": full day name (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday)
   - "day_index": 0 for Sunday, 1 for Monday, 2 for Tuesday, 3 for Wednesday, 4 for Thursday, 5 for Friday, 6 for Saturday
   - "start_time": "HH:MM" in 24-hour format
   - "end_time": "HH:MM" in 24-hour format
   - "display_time": e.g. "9:00 AM - 10:30 AM"
   - "room": room or hall number (e.g. "C203", "Online", or "TBA")
   - "type": "Lecture", "Lab", or "Tutorial"
   - "group": group name if any (e.g. "Group A" or empty "")

Return ONLY a valid JSON object matching the exact structure above with no markdown formatting or commentary."##;

    let raw_b64 = if let Some(idx) = file_base64.find(";base64,") {
        &file_base64[idx + 8..]
    } else {
        file_base64
    };

    let effective_mime = if mime_type.is_empty() {
        "image/png"
    } else {
        mime_type
    };

    let payload = json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                {
                    "inline_data": {
                        "mime_type": effective_mime,
                        "data": raw_b64
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    });

    let client = reqwest::Client::new();

    let env_key = std::env::var("GEMINI_API_KEY")
        .ok()
        .or_else(|| std::env::var("GOOGLE_API_KEY").ok());
    let effective_key = api_key
        .filter(|k| !k.trim().is_empty())
        .map(|k| k.to_string())
        .or(env_key);

    if let Some(key) = effective_key {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
            crate::urlencoding::encode(&key)
        );
        match client.post(&url).json(&payload).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    if let Ok(v) = resp.json::<Value>().await {
                        if let Some(mut sched) = extract_candidate_schedule_json(&v) {
                            post_process_extracted_schedule(&mut sched);
                            return Ok(sched);
                        } else {
                            return Err("Gemini responded, but could not parse structured timetable JSON.".to_string());
                        }
                    }
                } else {
                    let status = resp.status();
                    let err_txt = resp.text().await.unwrap_or_default();
                    return Err(format!("Gemini API error ({}): {}", status, err_txt));
                }
            }
            Err(e) => return Err(format!("Failed to connect to Gemini API: {}", e)),
        }
    }

    if let Ok(stored) = get_valid_access_token().await {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
        if let Ok(resp) = client
            .post(url)
            .bearer_auth(&stored.token)
            .json(&payload)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(mut sched) = extract_candidate_schedule_json(&v) {
                        post_process_extracted_schedule(&mut sched);
                        return Ok(sched);
                    }
                }
            }
        }
    }

    Err("Gemini API key is required to analyze schedule images. Please configure your Gemini API Key in Settings or sign in with Google.".to_string())
}

fn extract_candidate_schedule_json(v: &Value) -> Option<ScheduleData> {
    let text = v
        .get("candidates")?
        .get(0)?
        .get("content")?
        .get("parts")?
        .get(0)?
        .get("text")?
        .as_str()?;

    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str::<ScheduleData>(cleaned).ok()
}

fn post_process_extracted_schedule(sched: &mut ScheduleData) {
    if sched.semester.is_empty() {
        sched.semester = "Extracted Semester Schedule".to_string();
    }

    for c in &mut sched.courses {
        if c.color.is_empty() {
            c.color = "#1a73e8".to_string();
        }
        let (bg, border) = generate_course_palette(&c.color);
        if c.bg.is_empty() {
            c.bg = bg;
        }
        if c.border.is_empty() {
            c.border = border;
        }
    }

    for (idx, slot) in sched.slots.iter_mut().enumerate() {
        if slot.id.is_empty() {
            slot.id = format!("slot-{}", idx + 1);
        }
        slot.day_index = normalize_day_index(&slot.day);
        if slot.display_time.is_empty() && !slot.start_time.is_empty() && !slot.end_time.is_empty() {
            slot.display_time = format!("{} – {}", slot.start_time, slot.end_time);
        }
        if slot.course_name.is_empty() {
            if let Some(c) = sched.courses.iter().find(|x| x.id == slot.course_id) {
                slot.course_name = c.name.clone();
            }
        }
    }
}
