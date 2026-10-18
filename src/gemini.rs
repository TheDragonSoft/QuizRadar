use crate::auth::get_valid_access_token;
use crate::models::{
    AppConfig, Assessment, CachedEmail, DailyStudyDayGroup, DailyStudyTask,
    DiscoveredAcademicData, ExamReadinessCard, PracticeQuestion, PracticeQuizPayload, ScheduleData,
    StudyTasksPayload,
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

pub async fn generate_practice_quiz(
    assessment: &Assessment,
    api_key: Option<&str>,
) -> Result<PracticeQuizPayload, String> {
    let topics_str = if assessment.topics.is_empty() {
        assessment.title.clone()
    } else {
        assessment.topics.join(", ")
    };

    let prompt = format!(
        r#"You are an expert university professor for the course "{course_name}" ({course_id}).
Create 5 rigorous, practical multiple-choice quiz questions based on the following topics:
Topics: {topics}
Assessment Title: {title}

Return ONLY a JSON array of 5 objects matching this exact structure:
[
  {{
    "id": "q1",
    "question": "What is ...?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 0,
    "explanation": "Clear explanation of why Option A is correct and why other choices are invalid."
  }}
]"#,
        course_name = assessment.course_name,
        course_id = assessment.course_id,
        topics = topics_str,
        title = assessment.title
    );

    let payload = json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
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
        if let Ok(resp) = client.post(&url).json(&payload).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(questions) = parse_practice_questions_json(&v) {
                        return Ok(PracticeQuizPayload {
                            assessment_id: assessment.id.clone(),
                            course_id: assessment.course_id.clone(),
                            assessment_title: assessment.title.clone(),
                            questions,
                            generated_by_ai: true,
                        });
                    }
                }
            }
        }
    }

    if let Ok(stored) = get_valid_access_token().await {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
        if let Ok(resp) = client.post(url).bearer_auth(&stored.token).json(&payload).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(questions) = parse_practice_questions_json(&v) {
                        return Ok(PracticeQuizPayload {
                            assessment_id: assessment.id.clone(),
                            course_id: assessment.course_id.clone(),
                            assessment_title: assessment.title.clone(),
                            questions,
                            generated_by_ai: true,
                        });
                    }
                }
            }
        }
    }

    // High quality deterministic fallback generator so offline / no-API key students get great practice
    let questions = generate_deterministic_practice_questions(assessment);
    Ok(PracticeQuizPayload {
        assessment_id: assessment.id.clone(),
        course_id: assessment.course_id.clone(),
        assessment_title: assessment.title.clone(),
        questions,
        generated_by_ai: false,
    })
}

fn parse_practice_questions_json(val: &Value) -> Option<Vec<PracticeQuestion>> {
    let candidate_text = val
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|cand| cand.get("content"))
        .and_then(|cont| cont.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|part| part.get("text"))
        .and_then(|t| t.as_str())?;

    if let Ok(list) = serde_json::from_str::<Vec<PracticeQuestion>>(candidate_text) {
        if !list.is_empty() {
            return Some(list);
        }
    }

    // Try finding JSON array substring
    if let (Some(start), Some(end)) = (candidate_text.find('['), candidate_text.rfind(']')) {
        if start < end {
            if let Ok(list) = serde_json::from_str::<Vec<PracticeQuestion>>(&candidate_text[start..=end]) {
                if !list.is_empty() {
                    return Some(list);
                }
            }
        }
    }
    None
}

fn generate_deterministic_practice_questions(assessment: &Assessment) -> Vec<PracticeQuestion> {
    let cid = assessment.course_id.as_str();
    match cid {
        "GSE211" => vec![
            PracticeQuestion {
                id: "q1".to_string(),
                question: "Which of the following is true regarding Simpson's 1/3 Rule compared to the Trapezoidal Rule?".to_string(),
                options: vec![
                    "Simpson's 1/3 rule fits parabolic arcs across triplets of points and requires an even number of sub-intervals.".to_string(),
                    "Simpson's 1/3 rule requires an odd number of sub-intervals.".to_string(),
                    "Trapezoidal rule yields higher precision for quadratic polynomials.".to_string(),
                    "Simpson's 1/3 rule assumes piecewise linear segments.".to_string(),
                ],
                correct_index: 0,
                explanation: "Simpson's 1/3 rule approximates the integrand with a degree-2 parabola over adjacent pairs of panels, requiring an even number of sub-intervals (n % 2 == 0).".to_string(),
            },
            PracticeQuestion {
                id: "q2".to_string(),
                question: "What is the global truncation error order of the composite Trapezoidal Rule with step size h?".to_string(),
                options: vec![
                    "O(h)".to_string(),
                    "O(h^2)".to_string(),
                    "O(h^3)".to_string(),
                    "O(h^4)".to_string(),
                ],
                correct_index: 1,
                explanation: "The composite Trapezoidal Rule has a local truncation error of O(h^3) and a global truncation error of O(h^2).".to_string(),
            },
            PracticeQuestion {
                id: "q3".to_string(),
                question: "In numerical differentiation, which finite difference formula provides second-order O(h^2) accuracy for the first derivative?".to_string(),
                options: vec![
                    "Forward difference [f(x+h) - f(x)] / h".to_string(),
                    "Backward difference [f(x) - f(x-h)] / h".to_string(),
                    "Central difference [f(x+h) - f(x-h)] / (2h)".to_string(),
                    "One-sided forward extrapolation".to_string(),
                ],
                correct_index: 2,
                explanation: "By Taylor expansion, odd power error terms cancel out in the central difference scheme, leaving the leading error term as O(h^2).".to_string(),
            },
            PracticeQuestion {
                id: "q4".to_string(),
                question: "When applying Simpson's 3/8 rule, how many sub-intervals (n) are required?".to_string(),
                options: vec![
                    "Must be an even integer".to_string(),
                    "Must be a multiple of 3".to_string(),
                    "Any positive integer >= 1".to_string(),
                    "Must be a power of 2".to_string(),
                ],
                correct_index: 1,
                explanation: "Simpson's 3/8 rule fits a cubic polynomial across sets of 3 intervals; thus the total number of sub-intervals must be a multiple of 3.".to_string(),
            },
        ],
        "CSE263" => vec![
            PracticeQuestion {
                id: "q1".to_string(),
                question: "In the k-Nearest Neighbors (k-NN) classification algorithm, what typically happens when k is set very small (e.g., k = 1)?".to_string(),
                options: vec![
                    "The model underfits and creates very smooth decision boundaries.".to_string(),
                    "The model is highly susceptible to noise and may overfit the training data.".to_string(),
                    "The classification boundary becomes completely linear.".to_string(),
                    "The training time becomes significantly slower than testing time.".to_string(),
                ],
                correct_index: 1,
                explanation: "With k=1, every single training noise or outlier forms its own decision region, leading to high variance (overfitting).".to_string(),
            },
            PracticeQuestion {
                id: "q2".to_string(),
                question: "What fundamental assumption allows Naïve Bayes to compute the posterior class probability efficiently?".to_string(),
                options: vec![
                    "Features are conditionally independent given the target class label.".to_string(),
                    "Features follow a strict Bernoulli distribution only.".to_string(),
                    "All features must have zero correlation with the class label.".to_string(),
                    "The loss function is strictly non-convex.".to_string(),
                ],
                correct_index: 0,
                explanation: "Naïve Bayes assumes conditional feature independence: P(x1, x2, ... | C) = P(x1 | C) * P(x2 | C) * ..., greatly simplifying computation.".to_string(),
            },
            PracticeQuestion {
                id: "q3".to_string(),
                question: "In ordinary least-squares Linear Regression, what does the closed-form normal equation compute?".to_string(),
                options: vec![
                    "theta = (X^T * X)^(-1) * X^T * y".to_string(),
                    "theta = X * y^T * (X * X^T)".to_string(),
                    "theta = X^T * (X * y)^(-1)".to_string(),
                    "theta = (X + y)^(-1) * X^T".to_string(),
                ],
                correct_index: 0,
                explanation: "Setting the gradient of the sum of squared errors to zero yields the normal equation theta = (X^T * X)^(-1) * X^T * y.".to_string(),
            },
            PracticeQuestion {
                id: "q4".to_string(),
                question: "Why is feature scaling (e.g. Min-Max or Z-score normalization) critical before running k-NN?".to_string(),
                options: vec![
                    "Because distance metrics (such as Euclidean distance) are dominated by features with larger numerical scales.".to_string(),
                    "Because k-NN requires all feature values to be strictly non-zero.".to_string(),
                    "Because scaling reduces the dimensionality of the feature space.".to_string(),
                    "Because unscaled data causes division by zero in majority voting.".to_string(),
                ],
                correct_index: 0,
                explanation: "Since k-NN computes geometric distances (sqrt(sum (xi - yi)^2)), unscaled features with large ranges overshadow features with small ranges.".to_string(),
            },
        ],
        "CSE261" => vec![
            PracticeQuestion {
                id: "q1".to_string(),
                question: "What is the worst-case time complexity of standard QuickSort when the pivot is always chosen as the first or last element of an already sorted array?".to_string(),
                options: vec![
                    "O(N log N)".to_string(),
                    "O(N^2)".to_string(),
                    "O(N)".to_string(),
                    "O(log N)".to_string(),
                ],
                correct_index: 1,
                explanation: "When partitions are maximally unbalanced (size 0 and size N-1), the recurrence relation becomes T(N) = T(N-1) + O(N), which solves to O(N^2).".to_string(),
            },
            PracticeQuestion {
                id: "q2".to_string(),
                question: "What is the primary condition required to prevent infinite recursion and stack overflow in a recursive function?".to_string(),
                options: vec![
                    "A well-defined base case that does not make a recursive call.".to_string(),
                    "A global counter variable incremented on every pass.".to_string(),
                    "Allocating memory on the heap rather than the call stack.".to_string(),
                    "Ensuring all parameters are passed by reference.".to_string(),
                ],
                correct_index: 0,
                explanation: "Every valid recursive function must possess one or more reachable base cases that terminate execution without recursive dispatch.".to_string(),
            },
            PracticeQuestion {
                id: "q3".to_string(),
                question: "Which Master Theorem case applies to the recurrence T(N) = 2T(N/2) + O(N)?".to_string(),
                options: vec![
                    "Case 1: Leaves dominate, O(N^(log_b a))".to_string(),
                    "Case 2: Balanced work at every level, O(N log N)".to_string(),
                    "Case 3: Root dominates, O(N^2)".to_string(),
                    "The Master Theorem cannot be applied to this recurrence.".to_string(),
                ],
                correct_index: 1,
                explanation: "Here a = 2, b = 2, so log_b(a) = log_2(2) = 1. Since f(N) = Theta(N^1), Case 2 applies, yielding T(N) = Theta(N log N).".to_string(),
            },
        ],
        _ => vec![
            PracticeQuestion {
                id: "q1".to_string(),
                question: format!("Regarding {}, which principle is most critical for mastery?", assessment.title),
                options: vec![
                    "Understanding core theoretical definitions and working through assigned practice problem sets.".to_string(),
                    "Memorizing final numerical answers without deriving formulas.".to_string(),
                    "Ignoring instructor guidelines and lecture slides.".to_string(),
                    "Relying solely on external intuition during the exam.".to_string(),
                ],
                correct_index: 0,
                explanation: "Solid mastery requires combining conceptual understanding of the syllabus topics with verified tutorial problem sheets.".to_string(),
            },
            PracticeQuestion {
                id: "q2".to_string(),
                question: "When managing exam time under strict navigation constraints (no backtracking), what is the optimal strategy?".to_string(),
                options: vec![
                    "Pace evenly: answer questions methodically and confirm each answer before submitting.".to_string(),
                    "Spend 80% of the allocated time on the first problem.".to_string(),
                    "Guess randomly on all questions immediately.".to_string(),
                    "Leave tricky questions blank hoping to return later.".to_string(),
                ],
                correct_index: 0,
                explanation: "Under strict navigation rules, once you advance you cannot return; steady pacing with careful verification before advancing is optimal.".to_string(),
            },
            PracticeQuestion {
                id: "q3".to_string(),
                question: format!("What is the recommended focus for {} before exam day?", assessment.course_id),
                options: vec![
                    "Review all lecture slide modules, tutorial sheets, and instructor warnings.".to_string(),
                    "Skip past exam solutions.".to_string(),
                    "Study unrelated elective materials.".to_string(),
                    "Arrive at the examination hall without required materials.".to_string(),
                ],
                correct_index: 0,
                explanation: "Reviewing the specified lecture modules and confirming required materials ensures complete exam readiness.".to_string(),
            },
        ],
    }
}

const ACADEMIC_DISCOVERY_PROMPT_TEMPLATE: &str = r##"You are an intelligent university academic discovery agent in QuizRadar.
Your task is to explore and discover the student's REAL enrolled courses, course codes, subjects, instructors, and upcoming academic assessments (quizzes, assignments, midterms, lab exams, project milestones) from the provided raw data from university sources.

CRITICAL INSTRUCTIONS:
1. EXPLORE REAL ENROLLED SUBJECTS — DO NOT HARDCODE:
   - Extract the student's ACTUAL courses and course codes from the raw classes/teams (e.g., "BASC 110", "ACCT 101", "MGMT 101", "COMP 101", "ENG 101", "HUM 101").
   - Filter out administrative/non-course groups (such as "cohort Business tech 2026 advising" or "COHORT 2026"), but use them to infer the student's faculty and program ("Business Technology").
   - Assign each course a vibrant aesthetic hex color from: ["#1a73e8", "#0f9d58", "#ea8600", "#d93025", "#8e24aa", "#00acc1", "#6366f1", "#059669"]

2. EXTRACT DETAILED ACADEMIC ASSESSMENTS:
   - Extract realistic, syllabus-aligned upcoming quizzes, assignments, midterm exams, and lab assessments across all discovered courses.
   - For each assessment, include:
     * course_id (matching the course code)
     * course_name
     * title (e.g. "Quiz 1: Equations & Matrix Algebra", "Assignment 1: Financial Statements Analysis", "Lab Quiz: Computer Hardware & OS", "Midterm Exam")
     * assessment_type ("Class Quiz", "Assignment", "Midterm Exam", "Lab Assessment", "Online Quiz")
     * date_iso ("YYYY-MM-DD", anchored starting from late October 2026 onwards)
     * start_time & end_time ("HH:MM")
     * room (hall/room or "Microsoft Teams" / "ELC2")
     * group (section or group)
     * instructor (faculty names discovered)
     * topics (3-4 specific syllabus topics)
     * warnings (2 essential test instructions)
     * ai_inference_note (explanation of how this was inferred from Teams / syllabus)
     * ai_study_plan (actionable 2-sentence study strategy)
     * estimated_study_hours (e.g. 3.0 or 3.5)
     * source ("Microsoft Teams")
     * source_icon ("users")
     * weightage_percent (e.g. 15.0)

3. WEEKLY RECURRING TIMETABLE SLOTS:
   - Synthesize weekly recurring class timeslots for these courses (Sunday to Thursday).
   - If specific timeslots or rooms are indicated in channel titles (e.g. "Eng1, ELC2, Sun/Mon 10:50"), accurately schedule Sunday 10:50-12:20 and Monday 10:50-12:20 in ELC2!
   - Distribute the remaining lectures and tutorials across Sunday to Thursday so the student has a complete, realistic timetable.

Return ONLY valid JSON matching this exact structure:
{
  "semester": "Fall 2026 (CIC Cairo)",
  "university_or_institution": "Canadian International College (CIC Cairo)",
  "student_name": "Aseel Mohamed Anwar Metwaly",
  "student_email": "aseel_m2602195@cic-cairo.edu.eg",
  "courses": [
    {
      "id": "BASC 110",
      "name": "Business Math",
      "color": "#1a73e8",
      "bg": "#e8f0fe",
      "border": "#1a73e8"
    }
  ],
  "assessments": [
    {
      "id": "teams-basc110-q1",
      "course_id": "BASC 110",
      "course_name": "Business Math",
      "title": "Quiz 1: Equations & Matrix Algebra",
      "assessment_type": "Class Quiz",
      "date_iso": "2026-10-25",
      "day_name": "Sunday",
      "start_time": "10:50",
      "end_time": "12:20",
      "display_time": "Sunday, 25 October 2026 (10:50 AM - 12:20 PM)",
      "room": "Room 204",
      "group": "Section 1",
      "instructor": "Dr. Shehab & Dr. Waheed",
      "is_upcoming": true,
      "days_until": 8,
      "urgency_level": "upcoming",
      "priority_score": 85,
      "topics": ["Linear Equations", "Matrix Multiplication", "Determinants", "Cramer's Rule"],
      "warnings": ["Scientific calculators permitted", "Bring college ID"],
      "ai_inference_note": "Inferred by Gemini from Microsoft Teams class channel announcements.",
      "ai_study_plan": "Practice determinant evaluation and 3-variable systems of equations.",
      "estimated_study_hours": 3.5,
      "elearning_url": "https://teams.microsoft.com",
      "google_cal_url": "",
      "gcal_synced": false,
      "color": "#1a73e8",
      "bg": "#e8f0fe",
      "border": "#1a73e8",
      "semester": "Fall 2026",
      "email_subject": "Teams Course Announcement",
      "email_sent_date": "2026-10-18",
      "source": "Microsoft Teams",
      "source_icon": "users",
      "weightage_percent": 15.0
    }
  ],
  "slots": [
    {
      "id": "slot-1",
      "day": "Sunday",
      "day_index": 0,
      "course_id": "BASC 110",
      "course_name": "Business Math",
      "room": "Room 204",
      "type": "Lecture",
      "group": "Section 1",
      "start_time": "09:00",
      "end_time": "10:30",
      "display_time": "9:00 AM - 10:30 AM",
      "has_quiz": true,
      "quiz_title": "Quiz 1: Equations & Matrix Algebra"
    }
  ]
}"##;

pub async fn explore_and_extract_academic_universe(
    source_name: &str,
    raw_context: &str,
    api_key: Option<&str>,
) -> Option<DiscoveredAcademicData> {
    let prompt = format!(
        "{}\n\n=== RAW SOURCE CONTEXT ({}) ===\n{}",
        ACADEMIC_DISCOVERY_PROMPT_TEMPLATE,
        source_name,
        raw_context
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
    let env_key = std::env::var("GEMINI_API_KEY")
        .ok()
        .or_else(|| std::env::var("GOOGLE_API_KEY").ok());
    let effective_key = api_key
        .filter(|k| !k.trim().is_empty())
        .map(|k| k.to_string())
        .or(env_key);

    let mut result_json: Option<Value> = None;

    if let Some(key) = effective_key {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={}",
            crate::urlencoding::encode(&key)
        );
        if let Ok(resp) = client.post(&url).json(&payload).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    result_json = Some(v);
                }
            }
        }
    }

    if result_json.is_none() {
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
                        result_json = Some(v);
                    }
                }
            }
        }
    }

    let parsed_val = result_json.as_ref().and_then(|v| {
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
        serde_json::from_str::<DiscoveredAcademicData>(cleaned).ok()
    });

    if let Some(mut data) = parsed_val {
        let ref_date = crate::parser::current_reference_date();
        for a in &mut data.assessments {
            if a.google_cal_url.is_empty() {
                a.google_cal_url = crate::parser::build_google_calendar_template_url(a);
            }
            if a.bg.is_empty() || a.border.is_empty() {
                let (bg, border) = generate_course_palette(&a.color);
                a.bg = bg;
                a.border = border;
            }
            if let Ok(p_date) = chrono::NaiveDate::parse_from_str(&a.date_iso, "%Y-%m-%d") {
                a.days_until = (p_date - ref_date).num_days();
                a.is_upcoming = a.days_until >= 0;
            }
        }
        for c in &mut data.courses {
            if c.bg.is_empty() || c.border.is_empty() {
                let (bg, border) = generate_course_palette(&c.color);
                c.bg = bg;
                c.border = border;
            }
        }
        Some(data)
    } else {
        None
    }
}

