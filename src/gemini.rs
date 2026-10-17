use crate::auth::get_valid_access_token;
use crate::models::{
    AppConfig, Assessment, CachedEmail, DailyStudyDayGroup, DailyStudyTask, ExamReadinessCard,
    ScheduleData, StudyTasksPayload,
};
use chrono::Duration;
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

#[derive(Debug, Deserialize)]
struct GeminiPlanRawTask {
    pub assessment_id: String,
    pub course_id: String,
    #[serde(default)]
    pub course_name: String,
    pub assessment_title: String,
    #[serde(default)]
    pub assessment_type: String,
    pub topic: String,
    pub day_offset: i32,
    #[serde(default)]
    pub priority_rank: u32,
    #[serde(default)]
    pub urgency: String,
    #[serde(default = "default_est_hours")]
    pub estimated_hours: f32,
    #[serde(default)]
    pub ai_reasoning: String,
}

fn default_est_hours() -> f32 {
    1.0
}

#[derive(Debug, Deserialize)]
struct GeminiPlanRawReadiness {
    pub assessment_id: String,
    pub course_id: String,
    #[serde(default)]
    pub course_name: String,
    pub title: String,
    #[serde(default)]
    pub assessment_type: String,
    #[serde(default)]
    pub date_iso: String,
    #[serde(default)]
    pub display_date: String,
    #[serde(default)]
    pub days_until: i64,
    #[serde(default = "default_readiness")]
    pub readiness_percent: u32,
    #[serde(default)]
    pub priority_score: u32,
    #[serde(default)]
    pub recommended_focus: String,
}

fn default_readiness() -> u32 {
    50
}

#[derive(Debug, Deserialize)]
struct GeminiPlanRawResponse {
    #[serde(default)]
    pub readiness_cards: Vec<GeminiPlanRawReadiness>,
    #[serde(default)]
    pub tasks: Vec<GeminiPlanRawTask>,
}

pub async fn rank_and_plan_with_gemini(
    assessments: &[Assessment],
    schedule: &ScheduleData,
    config: &AppConfig,
    api_key_override: Option<&str>,
) -> Result<StudyTasksPayload, String> {
    let api_key = match api_key_override.or(std::env::var("GEMINI_API_KEY").ok().as_deref()) {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => return Err("Gemini API key is not configured.".to_string()),
    };

    let ref_date = crate::parser::current_reference_date();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let prompt = r##"
You are an elite University Academic Advisor & Cognitive Study Strategist.
Given the student's upcoming assessments (quizzes, midterms, labs, assignments) and their weekly schedule, create an optimal, high-retention Daily Study Plan.

RULES:
1. Prioritize tasks based on:
   - Days remaining (urgent deadlines <= 2 days take immediate precedence).
   - Exam weight and cognitive difficulty (Midterms/Finals > Quizzes > Assignments).
   - Balanced daily load (recommend realistic study blocks of 0.5 to 2.5 hours per topic).
2. For each assessment, provide:
   - `readiness_percent` (estimated initial score 0-100 based on preparation stage).
   - `recommended_focus` (the single most vital topic or area to master first).
3. For each study task, provide:
   - `day_offset`: 0 for Today, 1 for Tomorrow, 2 for Day +2, etc. (up to 5 days).
   - `priority_rank`: 1 (highest urgency) to 100.
   - `urgency`: "critical", "high", "medium", or "normal".
   - `estimated_hours`: 0.5 to 2.5 hours.
   - `ai_reasoning`: A short, actionable coaching tip explaining WHY this topic is scheduled now (e.g., "Critical prerequisite for Exam questions 2 & 3. 48h until exam.").
4. Return ONLY a single raw JSON object conforming strictly to this JSON schema:
{
  "readiness_cards": [
    {
      "assessment_id": "...",
      "course_id": "...",
      "course_name": "...",
      "title": "...",
      "assessment_type": "...",
      "date_iso": "YYYY-MM-DD",
      "display_date": "...",
      "days_until": 0,
      "readiness_percent": 65,
      "priority_score": 90,
      "recommended_focus": "..."
    }
  ],
  "tasks": [
    {
      "assessment_id": "...",
      "course_id": "...",
      "course_name": "...",
      "assessment_title": "...",
      "assessment_type": "...",
      "topic": "...",
      "day_offset": 0,
      "priority_rank": 95,
      "urgency": "critical",
      "estimated_hours": 1.5,
      "ai_reasoning": "..."
    }
  ]
}
"##;

    let payload = json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                { "text": format!("Assessments:\n{}", serde_json::to_string(assessments).unwrap_or_default()) },
                { "text": format!("Weekly Schedule:\n{}", serde_json::to_string(schedule).unwrap_or_default()) }
            ]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
        api_key
    );

    let resp = client.post(&url).json(&payload).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini API error: {}", err_text));
    }

    let json_val: Value = resp.json().await.map_err(|e| e.to_string())?;
    let raw_text = json_val
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Invalid response format from Gemini".to_string())?;

    let cleaned = raw_text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let raw_plan: GeminiPlanRawResponse = serde_json::from_str(cleaned).map_err(|e| e.to_string())?;

    // Map raw readiness cards and match colors from assessments
    let mut readiness_cards = Vec::new();
    for r in raw_plan.readiness_cards {
        let matching_a = assessments.iter().find(|a| a.id == r.assessment_id || a.course_id == r.course_id);
        let color = matching_a.map(|a| a.color.clone()).unwrap_or_else(|| "#1a73e8".to_string());
        let date_iso = if !r.date_iso.is_empty() {
            r.date_iso
        } else {
            matching_a.map(|a| a.date_iso.clone()).unwrap_or_default()
        };
        let display_date = if !r.display_date.is_empty() {
            r.display_date
        } else {
            matching_a.map(|a| a.display_time.clone()).unwrap_or_default()
        };
        let days_until = matching_a.map(|a| a.days_until).unwrap_or(r.days_until);
        let total_count = matching_a.map(|a| a.topics.len()).unwrap_or(3);
        let completed_count = matching_a.map(|a| {
            a.topics.iter().enumerate().filter(|(idx, _)| {
                let key = format!("{}::{}", a.id, idx);
                *config.completed_topics.get(&key).unwrap_or(&false)
            }).count()
        }).unwrap_or(0);

        let readiness_percent = if total_count > 0 {
            ((completed_count as f32 / total_count as f32) * 100.0).round() as u32
        } else {
            r.readiness_percent
        };

        readiness_cards.push(ExamReadinessCard {
            assessment_id: r.assessment_id,
            course_id: r.course_id,
            course_name: r.course_name,
            title: r.title,
            assessment_type: r.assessment_type,
            date_iso,
            display_date,
            days_until,
            readiness_percent,
            completed_count,
            total_count,
            priority_score: r.priority_score,
            color,
            recommended_focus: r.recommended_focus,
        });
    }

    // Map raw tasks
    let mut all_tasks = Vec::new();
    for (idx, t) in raw_plan.tasks.into_iter().enumerate() {
        let matching_a = assessments.iter().find(|a| a.id == t.assessment_id || a.course_id == t.course_id);
        let color = matching_a.map(|a| a.color.clone()).unwrap_or_else(|| "#1a73e8".to_string());
        let days_until = matching_a.map(|a| a.days_until).unwrap_or(3);
        let assessment_date = matching_a.map(|a| a.date_iso.clone()).unwrap_or_default();

        let day_offset = t.day_offset.max(0).min(6);
        let task_date = ref_date + Duration::days(day_offset as i64);
        let display_day = match day_offset {
            0 => "Today".to_string(),
            1 => "Tomorrow".to_string(),
            _ => task_date.format("%A, %b %-d").to_string(),
        };

        let topic_idx = matching_a.and_then(|a| a.topics.iter().position(|top| top.eq_ignore_ascii_case(&t.topic))).unwrap_or(idx);
        let key = format!("{}::{}", t.assessment_id, topic_idx);
        let completed = *config.completed_topics.get(&key).unwrap_or(&false);

        all_tasks.push(DailyStudyTask {
            id: format!("ai-task-{}-{}-{}", t.assessment_id, idx, day_offset),
            key,
            assessment_id: t.assessment_id,
            course_id: t.course_id,
            course_name: t.course_name,
            assessment_title: t.assessment_title,
            assessment_type: t.assessment_type,
            topic: t.topic,
            day_offset,
            target_date_iso: task_date.format("%Y-%m-%d").to_string(),
            display_day,
            priority_rank: t.priority_rank,
            urgency: if t.urgency.is_empty() { "normal".to_string() } else { t.urgency },
            estimated_hours: t.estimated_hours,
            ai_reasoning: t.ai_reasoning,
            completed,
            color,
            days_until_assessment: days_until,
            assessment_date,
        });
    }

    // Group tasks by day_offset
    let mut day_map: HashMap<i32, Vec<DailyStudyTask>> = HashMap::new();
    for task in all_tasks.iter() {
        day_map.entry(task.day_offset).or_default().push(task.clone());
    }

    let mut day_offsets: Vec<i32> = day_map.keys().cloned().collect();
    if !day_offsets.contains(&0) {
        day_offsets.push(0);
    }
    if !day_offsets.contains(&1) {
        day_offsets.push(1);
    }
    day_offsets.sort();

    let mut days = Vec::new();
    for offset in day_offsets {
        let date = ref_date + Duration::days(offset as i64);
        let date_iso = date.format("%Y-%m-%d").to_string();
        let display_day = match offset {
            0 => format!("Today • {}", date.format("%A, %b %-d")),
            1 => format!("Tomorrow • {}", date.format("%A, %b %-d")),
            _ => date.format("%A • %b %-d").to_string(),
        };

        let mut day_tasks = day_map.remove(&offset).unwrap_or_default();
        day_tasks.sort_by(|a, b| {
            a.completed
                .cmp(&b.completed)
                .then_with(|| b.priority_rank.cmp(&a.priority_rank))
        });

        let total_estimated_hours = day_tasks.iter().map(|t| t.estimated_hours).sum::<f32>();

        days.push(DailyStudyDayGroup {
            day_offset: offset,
            date_iso,
            display_day,
            is_today: offset == 0,
            total_estimated_hours: (total_estimated_hours * 10.0).round() / 10.0,
            tasks: day_tasks,
        });
    }

    let total_tasks = all_tasks.len();
    let completed_tasks = all_tasks.iter().filter(|t| t.completed).count();
    let pending_tasks = total_tasks.saturating_sub(completed_tasks);
    let total_hours = all_tasks.iter().map(|t| t.estimated_hours).sum::<f32>();

    Ok(StudyTasksPayload {
        days,
        readiness_cards,
        total_tasks,
        pending_tasks,
        completed_tasks,
        total_hours: (total_hours * 10.0).round() / 10.0,
        ai_generated: true,
    })
}

