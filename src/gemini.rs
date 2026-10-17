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
