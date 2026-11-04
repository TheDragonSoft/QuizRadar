//! The four v5 AI call sites (`05` §4; v4's six minus Teams discovery minus
//! the render-path gating — both deleted on purpose):
//!
//! a. [`extract_assessment`] — email → assessment draft, schema-compatible
//!    with `parse::email` output via [`merge_extraction`] (any non-empty AI
//!    field wins; `is_assessment=false` drops; derived fields are ALWAYS
//!    recomputed locally — never trusted from the model).
//! b. [`extract_timetable`] — timetable image → courses/slots/semester with
//!    a strict "never invent unknowns" prompt and row-level validation
//!    (invalid rows are dropped and counted, never coerced into existence).
//! c. [`optimize_plan`] — study-plan optimize button → an AI-labeled
//!    [`crate::plan::tasks::StudyTasksPayload`] validated against the real
//!    completion state: readiness %, completed counts, urgency and topics are
//!    recomputed from the user's data; model-invented topics/ids are dropped.
//! d. [`generate_practice`] — 5-MCQ practice quiz; every question is
//!    validated (non-empty options, in-range `correct_index`) and invalid
//!    rows are dropped honestly.
//!
//! Every failure maps to a typed [`AiUnavailable`] so the caller falls back
//! to its deterministic path (degradation ladder, `05` §3.5) — no silent
//! None, no fabricated success. The model ladder per task follows `05` §3.3:
//! `flash-lite` for (a)+(d), `flash` for (b)+(c).

use std::collections::{HashMap, HashSet};

use chrono::{Duration, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ai::provider::{
    AiCreditNote, AiError, AiModel, AiProvider, AiUnavailable, StructuredPrompt, VisionRequest,
};
use crate::parse::util::{
    build_display_time, compute_priority_score, day_name_for, urgency_for, weekday_index,
};
use crate::plan::dashboard::{readiness_percent, topic_key_for_text};
use crate::plan::tasks::{
    reasoning_for_days, study_day_display, DailyStudyDayGroup, DailyStudyTask, ExamReadinessCard,
    StudyTasksPayload, FALLBACK_TOPICS, HORIZON_DAYS,
};
use crate::sources::preset_course_colors;
use crate::types::{
    Assessment, AssessmentType, CachedEmail, CompletedTopics, Course, ScheduleData, ScheduleSlot,
};

// ---------------------------------------------------------------------------
// Practice payload (shared with practice_fallback)
// ---------------------------------------------------------------------------

/// One practice MCQ. `correct_index` points into `options`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PracticeQuestion {
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
    pub explanation: String,
}

/// A practice quiz payload (`01` §4.7). Provenance is explicit and double:
/// the v4 `generated_by_ai` flag plus the honesty `authored_locally` label,
/// and a typed [`AiCreditNote`] naming the exact source (model id or
/// on-device). A fallback quiz can never masquerade as AI output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PracticeQuizPayload {
    pub assessment_id: String,
    pub course_id: Option<String>,
    pub assessment_title: String,
    pub questions: Vec<PracticeQuestion>,
    /// v4 wire flag: `true` only for provider-authored quizzes.
    pub generated_by_ai: bool,
    /// Honesty label: `true` only for the deterministic on-device authoring.
    pub authored_locally: bool,
    /// Typed provenance (model id or on-device).
    pub credit: AiCreditNote,
}

// ---------------------------------------------------------------------------
// Shared honesty helpers
// ---------------------------------------------------------------------------

/// Empty/whitespace strings become `None` — the AI wire shape mirrors the
/// parser's `None` semantics instead of v4's sentinel empty strings.
fn de_optional(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// `HH:MM` (24-hour, seconds tolerated) — anything else is unparseable and
/// therefore unknown, never coerced.
fn parse_hm(text: &str) -> Option<NaiveTime> {
    let mut parts = text.trim().split(':');
    let hour: u32 = parts.next()?.parse().ok()?;
    let minute: u32 = parts.next()?.parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    NaiveTime::from_hms_opt(hour, minute, 0)
}

/// Strict `YYYY-MM-DD` — a malformed date string is discarded, never
/// re-interpreted into a real date.
fn parse_iso_date(text: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(text.trim(), "%Y-%m-%d").ok()
}

/// Positive, finite, sane study-hours estimate; anything else is unknown.
fn positive_hours(raw: Option<f32>) -> Option<f32> {
    raw.filter(|hours| hours.is_finite() && *hours > 0.0 && *hours <= 100.0)
}

/// Keeps trimmed, non-empty strings only.
fn non_empty_strings(raw: Vec<String>) -> Vec<String> {
    raw.into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// Some models wrap the object in a one-element array; take the object.
fn unwrap_array(value: Value) -> Value {
    match value {
        Value::Array(items) => items.into_iter().next().unwrap_or(Value::Null),
        other => other,
    }
}

/// The assessment's real topic list for plan validation — the deterministic
/// planner's fallback set when the sources posted none (`plan::tasks`).
fn real_topic_list(assessment: &Assessment) -> Vec<String> {
    if assessment.topics.is_empty() {
        FALLBACK_TOPICS
            .iter()
            .map(|topic| (*topic).to_string())
            .collect()
    } else {
        assessment.topics.clone()
    }
}

/// AI-proposed assessment types are accepted only when the label matches the
/// v5 ladder exactly or by an honest keyword ("midterm", "final", …);
/// unrecognized labels are dropped rather than coerced to the default rung.
fn normalize_ai_type(label: &str) -> Option<AssessmentType> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lowered = trimmed.to_ascii_lowercase();
    let (kind, fuzzy) = AssessmentType::from_import_label(trimmed);
    if !fuzzy {
        return Some(kind);
    }
    let keyworded = ["final", "midterm", "online", "lab", "assignment", "quiz"]
        .iter()
        .any(|keyword| lowered.contains(keyword));
    keyworded.then_some(kind)
}

// ---------------------------------------------------------------------------
// Task a — email assessment extraction (flash-lite)
// ---------------------------------------------------------------------------

/// The AI's extraction of one announcement email, field-compatible with
/// `parse::email` output. Every unknown stays `None`; junk values are
/// discarded at parse time, never coerced.
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedAssessment {
    /// `false` = the model judged this a non-assessment email — the caller
    /// drops it (`05` §4 merge rule).
    pub is_assessment: bool,
    pub course_id: Option<String>,
    pub course_name: Option<String>,
    pub title: Option<String>,
    pub assessment_type: Option<AssessmentType>,
    pub date: Option<NaiveDate>,
    pub start_time: Option<NaiveTime>,
    pub end_time: Option<NaiveTime>,
    pub room: Option<String>,
    pub group: Option<String>,
    pub instructor: Option<String>,
    pub topics: Vec<String>,
    pub warnings: Vec<String>,
    pub ai_inference_note: Option<String>,
    pub ai_study_plan: Option<String>,
    pub estimated_study_hours: Option<f32>,
}

const EXTRACT_INSTRUCTION: &str = r#"You are an intelligent university academic assistant inside QuizRadar.
Analyze the following university announcement email and determine the exact assessment details by cross-referencing the email's sent date and body with the student's enrolled weekly class schedule.

Note on Schedule Matching:
- Always match "during the lecture", "in tutorial", or "in lab" to the student's actual scheduled slot for that course to determine the exact date_iso (YYYY-MM-DD), start_time (HH:MM), end_time (HH:MM), room, and group.
- Anchor relative phrases like "this week", "next week", or "next Wednesday" to the email's Sent Date.

HONESTY RULES (strict):
- Use null for any field the announcement and schedule do not establish. NEVER guess rooms, instructors, groups, times or dates.
- If the email is not an assessment announcement (grades, results, cancellations, material uploads), set "is_assessment": false and leave every other field null or empty.
- "ai_inference_note" must explain exactly how the date, time and room were derived; prefix it with "Estimated:" whenever the date was not explicit in the announcement.
- "topics" and "warnings" must quote what the announcement actually says — never invent syllabus content.
- "assessment_type" must be one of: "Class Quiz", "Online Quiz", "Midterm Exam", "Final Exam", "Lab Assessment", "Assignment".

Return ONLY a valid JSON object matching this exact structure (null when unknown, never invented):
{
  "is_assessment": true,
  "course_id": "CS 101",
  "course_name": "Introduction to Computer Science",
  "title": "Quiz 1: Programming Fundamentals",
  "assessment_type": "Class Quiz",
  "date_iso": "2026-10-19",
  "start_time": "13:00",
  "end_time": "15:30",
  "room": "Hall A-101",
  "group": "Group B",
  "instructor": "Prof. Alan Turing",
  "topics": ["Lecture 1: Introduction"],
  "warnings": ["Bring printed Quiz Template"],
  "ai_inference_note": "Brief explanation of how the exact date, time, and room were inferred from the email + student schedule.",
  "ai_study_plan": "Specific, actionable 2-sentence study recommendation for these topics.",
  "estimated_study_hours": 3.5
}"#;

/// Extracts one announcement email into a validated draft (FlashLite,
/// temperature 0.1, v4's prompt with strict null semantics). The draft merges
/// into the radar via [`merge_extraction`].
pub async fn extract_assessment(
    provider: &dyn AiProvider,
    email: &CachedEmail,
    schedule: &ScheduleData,
) -> Result<ExtractedAssessment, AiUnavailable> {
    let slots_json = serde_json::to_string(&schedule.slots).unwrap_or_else(|_| "[]".to_string());
    let mut metadata = format!(
        "STUDENT'S WEEKLY CLASS SCHEDULE:\n{slots_json}\n\nEMAIL METADATA:\n- Subject: {}\n- From: {}\n- Sent Date: {}\n- Body:\n{}",
        email.subject, email.from, email.date, email.body
    );
    if email.body_truncated {
        metadata.push_str(
            "\n\nNOTE: the body above was truncated when it was fetched — the tail of the email may be missing; do not assume you saw everything.",
        );
    }

    let prompt =
        StructuredPrompt::new(AiModel::FlashLite, 0.1, EXTRACT_INSTRUCTION).with_context(metadata);
    let value = provider.chat_json(prompt).await?.into_value();

    let raw: RawExtraction = serde_json::from_value(unwrap_array(value)).map_err(|error| {
        AiError::BadResponse(format!("extraction JSON did not match the schema: {error}"))
    })?;

    Ok(ExtractedAssessment {
        is_assessment: raw.is_assessment,
        course_id: de_optional(raw.course_id.as_deref()),
        course_name: de_optional(raw.course_name.as_deref()),
        title: de_optional(raw.title.as_deref()),
        assessment_type: raw.assessment_type.as_deref().and_then(normalize_ai_type),
        date: raw.date_iso.as_deref().and_then(parse_iso_date),
        start_time: raw.start_time.as_deref().and_then(parse_hm),
        end_time: raw.end_time.as_deref().and_then(parse_hm),
        room: de_optional(raw.room.as_deref()),
        group: de_optional(raw.group.as_deref()),
        instructor: de_optional(raw.instructor.as_deref()),
        topics: non_empty_strings(raw.topics),
        warnings: non_empty_strings(raw.warnings),
        ai_inference_note: de_optional(raw.ai_inference_note.as_deref()),
        ai_study_plan: de_optional(raw.ai_study_plan.as_deref()),
        estimated_study_hours: positive_hours(raw.estimated_study_hours),
    })
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawExtraction {
    #[serde(default = "default_true")]
    is_assessment: bool,
    course_id: Option<String>,
    course_name: Option<String>,
    title: Option<String>,
    assessment_type: Option<String>,
    date_iso: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    room: Option<String>,
    group: Option<String>,
    instructor: Option<String>,
    topics: Vec<String>,
    warnings: Vec<String>,
    ai_inference_note: Option<String>,
    ai_study_plan: Option<String>,
    estimated_study_hours: Option<f32>,
}

fn default_true() -> bool {
    true
}

/// The merge rule (`05` §4): any non-empty AI field wins over the heuristic
/// parse; `is_assessment=false` leaves the heuristic untouched (the caller
/// drops the item). Derived fields (day name, display time, countdown,
/// urgency, priority) are recomputed from the caller's reference date —
/// never taken from either path on trust. The output keeps `parse::email`'s
/// exact schema, so it lands in the store through the normal merge paths.
#[must_use]
pub fn merge_extraction(
    mut base: Assessment,
    ai: &ExtractedAssessment,
    reference_date: NaiveDate,
) -> Assessment {
    if !ai.is_assessment {
        return base;
    }
    if let Some(code) = &ai.course_id {
        let changed = base.course_id.as_deref() != Some(code.as_str());
        base.course_id = Some(code.clone());
        if let Some(name) = &ai.course_name {
            base.course_name = Some(name.clone());
        } else if changed {
            // The old name belonged to a different course — dropping it is
            // honest, inventing a new one is not.
            base.course_name = None;
        }
    } else if let Some(name) = &ai.course_name {
        base.course_name = Some(name.clone());
    }
    if let Some(title) = &ai.title {
        base.title = title.clone();
    }
    if let Some(kind) = ai.assessment_type {
        base.assessment_type = kind;
    }
    if let Some(date) = ai.date {
        base.date = Some(date);
    }
    if let Some(start) = ai.start_time {
        base.start_time = Some(start);
    }
    if let Some(end) = ai.end_time {
        base.end_time = Some(end);
    }
    if let Some(room) = &ai.room {
        base.room = Some(room.clone());
    }
    if let Some(group) = &ai.group {
        base.group = Some(group.clone());
    }
    if let Some(instructor) = &ai.instructor {
        base.instructor = Some(instructor.clone());
    }
    if !ai.topics.is_empty() {
        base.topics = ai.topics.clone();
    }
    if !ai.warnings.is_empty() {
        base.warnings = ai.warnings.clone();
    }
    if let Some(note) = &ai.ai_inference_note {
        base.ai_inference_note = Some(note.clone());
    }
    if let Some(plan) = &ai.ai_study_plan {
        base.ai_study_plan = Some(plan.clone());
    }
    if let Some(hours) = ai.estimated_study_hours {
        base.estimated_study_hours = Some(hours);
    }

    recompute_derived_fields(&mut base, reference_date);
    base
}

fn recompute_derived_fields(base: &mut Assessment, reference_date: NaiveDate) {
    let days_i64 = base.date.map(|date| (date - reference_date).num_days());
    base.day_name = day_name_for(base.date);
    base.display_time = base
        .date
        .map(|date| build_display_time(date, base.start_time, base.end_time));
    base.days_until = days_i64.map(|days| i32::try_from(days).unwrap_or(i32::MAX));
    base.is_upcoming = match days_i64 {
        Some(days) => days >= 0,
        // Dateless drafts stay on the radar as "upcoming" (v5 semantics).
        None => true,
    };
    base.urgency_level = urgency_for(days_i64);
    base.priority_score = compute_priority_score(days_i64, base.assessment_type, base.topics.len());
}

// ---------------------------------------------------------------------------
// Task b — timetable vision import (flash)
// ---------------------------------------------------------------------------

/// The vision import result: the validated schedule plus honest counts of
/// what the model returned that could NOT be trusted (shown in the preview
/// modal — `01` §4.1 "preview modal → apply or manual fallback").
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractedTimetable {
    pub schedule: ScheduleData,
    /// Course rows dropped (missing/empty id or name).
    pub dropped_courses: usize,
    /// Slot rows dropped (unknown course, unparseable day/time, negative duration).
    pub dropped_slots: usize,
}

const TIMETABLE_INSTRUCTION: &str = r##"You are an intelligent university timetable extraction assistant inside QuizRadar.
Analyze the provided university weekly timetable / class schedule image or document.
Extract all enrolled courses and recurring weekly class timeslots.

HONESTY RULES (strict — never invent anything):
- "semester": ONLY the semester title actually printed on the timetable (e.g. "Fall 2026"); null when it is not shown. Never write a default like "Current Semester".
- "courses": every distinct enrolled course actually visible:
  - "id": the course code exactly as printed (e.g. "CS101")
  - "name": the full course title exactly as printed
  - "color": one hex color from this list: "#1a73e8", "#0f9d58", "#ea8600", "#d93025", "#8e24aa", "#00acc1", "#e67c73", "#3949ab"
- "slots": every weekly recurring class session actually visible:
  - "id": "slot-1", "slot-2", …
  - "course_id": the matching course code
  - "day": full day name (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday)
  - "start_time" / "end_time": 24-hour "HH:MM" exactly as printed — omit the whole slot when the times are not printed
  - "room": the room/hall exactly as printed, or null when not shown (never "TBA" or a placeholder unless the image itself shows it)
  - "type": "Lecture", "Lab", or "Tutorial" — null when not stated
  - "group": the section/group exactly as printed, or null
- Skip anything unreadable instead of guessing.

Return ONLY a valid JSON object matching this exact structure:
{
  "semester": "Fall 2026",
  "courses": [
    { "id": "CS101", "name": "Introduction to Computer Science", "color": "#1a73e8" }
  ],
  "slots": [
    { "id": "slot-1", "course_id": "CS101", "day": "Sunday", "start_time": "09:00", "end_time": "10:30", "display_time": "9:00 AM - 10:30 AM", "room": null, "type": "Lecture", "group": null }
  ]
}"##;

/// Imports a timetable image/PDF page into a validated [`ScheduleData`]
/// (Flash, temperature 0.1, manual-triggered only — `05` §3.3). Rows the
/// model got wrong are dropped and counted, never repaired into existence.
pub async fn extract_timetable(
    provider: &dyn AiProvider,
    image_b64: &str,
    mime: &str,
) -> Result<ExtractedTimetable, AiUnavailable> {
    let request = VisionRequest {
        image_b64: image_b64.to_string(),
        mime: mime.to_string(),
        prompt: StructuredPrompt::new(AiModel::Flash, 0.1, TIMETABLE_INSTRUCTION),
    };
    let value = provider.vision_json(request).await?.into_value();
    let raw: RawTimetable = serde_json::from_value(unwrap_array(value)).map_err(|error| {
        AiError::BadResponse(format!("timetable JSON did not match the schema: {error}"))
    })?;

    let mut courses: Vec<Course> = Vec::new();
    let mut dropped_courses = 0usize;
    for item in raw.courses {
        match serde_json::from_value::<RawCourse>(item) {
            Ok(course) => {
                let (Some(id), Some(name)) = (
                    de_optional(course.id.as_deref()),
                    de_optional(course.name.as_deref()),
                ) else {
                    dropped_courses += 1;
                    continue;
                };
                if courses.iter().any(|kept| kept.id.eq_ignore_ascii_case(&id)) {
                    continue; // the same course printed twice — one entry
                }
                let (color, bg, border) = match valid_hex_color(course.color.as_deref()) {
                    Some(hex) => (
                        hex.clone(),
                        Some(format!("{hex}18")),
                        Some(format!("{hex}55")),
                    ),
                    None => preset_course_colors(&id),
                };
                courses.push(Course {
                    id,
                    name,
                    color,
                    bg,
                    border,
                });
            }
            Err(_) => dropped_courses += 1,
        }
    }

    let mut slots: Vec<ScheduleSlot> = Vec::new();
    let mut dropped_slots = 0usize;
    for item in raw.slots {
        match serde_json::from_value::<RawSlot>(item) {
            Ok(slot) => {
                let Some(course_id) = de_optional(slot.course_id.as_deref()) else {
                    dropped_slots += 1;
                    continue;
                };
                let Some(course) = courses
                    .iter()
                    .find(|kept| kept.id.eq_ignore_ascii_case(&course_id))
                    .cloned()
                else {
                    dropped_slots += 1;
                    continue;
                };
                let Some(day) = de_optional(slot.day.as_deref()) else {
                    dropped_slots += 1;
                    continue;
                };
                let Some(day_index) = weekday_index(&day) else {
                    dropped_slots += 1;
                    continue;
                };
                let (Some(start), Some(end)) = (
                    slot.start_time.as_deref().and_then(parse_hm),
                    slot.end_time.as_deref().and_then(parse_hm),
                ) else {
                    dropped_slots += 1;
                    continue;
                };
                if end <= start {
                    dropped_slots += 1;
                    continue;
                }
                slots.push(ScheduleSlot {
                    id: de_optional(slot.id.as_deref())
                        .unwrap_or_else(|| format!("slot-{}", slots.len() + 1)),
                    day,
                    day_index,
                    course_id: course.id,
                    course_name: de_optional(slot.course_name.as_deref()).unwrap_or(course.name),
                    slot_type: de_optional(slot.slot_type.as_deref())
                        .unwrap_or_else(|| "Lecture".to_string()),
                    group: de_optional(slot.group.as_deref()),
                    room: de_optional(slot.room.as_deref()),
                    start_time: start,
                    end_time: end,
                    display_time: de_optional(slot.display_time.as_deref()).unwrap_or_else(|| {
                        format!("{}–{}", start.format("%H:%M"), end.format("%H:%M"))
                    }),
                    has_quiz: false,
                    quiz_title: None,
                });
            }
            Err(_) => dropped_slots += 1,
        }
    }

    Ok(ExtractedTimetable {
        schedule: ScheduleData {
            semester: de_optional(raw.semester.as_deref()),
            courses,
            slots,
        },
        dropped_courses,
        dropped_slots,
    })
}

fn valid_hex_color(raw: Option<&str>) -> Option<String> {
    let hex = de_optional(raw)?;
    let lowered = hex.to_ascii_lowercase();
    let ok = lowered.starts_with('#')
        && lowered.len() == 7
        && lowered[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    ok.then_some(lowered)
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawTimetable {
    semester: Option<String>,
    courses: Vec<Value>,
    slots: Vec<Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawCourse {
    id: Option<String>,
    name: Option<String>,
    color: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawSlot {
    id: Option<String>,
    course_id: Option<String>,
    course_name: Option<String>,
    day: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    display_time: Option<String>,
    room: Option<String>,
    #[serde(rename = "type")]
    slot_type: Option<String>,
    group: Option<String>,
}

// ---------------------------------------------------------------------------
// Task c — study-plan optimize (flash)
// ---------------------------------------------------------------------------

const OPTIMIZE_INSTRUCTION: &str = r#"You are an elite University Academic Advisor & Cognitive Study Strategist.
Given the student's upcoming assessments (quizzes, midterms, labs, assignments) and their weekly schedule, create an optimal, high-retention Daily Study Plan.

RULES:
1. Prioritize tasks based on:
   - Days remaining (urgent deadlines within 2 days take immediate precedence).
   - Exam weight and cognitive difficulty (Midterms/Finals > Quizzes > Assignments).
   - Balanced daily load (recommend realistic study blocks of 0.5 to 2.5 hours per topic).
2. For each assessment, provide a readiness card whose "recommended_focus" is the single most vital topic to master first — it MUST be one of that assessment's own topics.
3. For each study task:
   - "assessment_id": MUST be one of the provided assessment ids — never invent one.
   - "topic": MUST be one of that assessment's own topics as listed — never invent topics.
   - "day_offset": 0 for Today, 1 for Tomorrow, 2 for Day +2, etc. (never later than the assessment's own date).
   - "priority_rank": 1 (highest urgency) to 100.
   - "estimated_hours": 0.5 to 2.5 hours.
   - "ai_reasoning": a short, actionable coaching tip explaining WHY this topic is scheduled now.

Return ONLY a single raw JSON object conforming strictly to this JSON schema:
{
  "readiness_cards": [
    { "assessment_id": "...", "recommended_focus": "..." }
  ],
  "tasks": [
    { "assessment_id": "...", "topic": "...", "day_offset": 0, "priority_rank": 95, "estimated_hours": 1.5, "ai_reasoning": "..." }
  ]
}"#;

/// The "Optimize with AI" button (`01` §4.4, `05` §4): returns an
/// AI-labeled payload where readiness %, completion counts, urgency,
/// priority and every derived date are recomputed from the user's REAL
/// assessment + completion state — the model's numbers are never trusted.
/// Proposed tasks referencing unknown assessments or topics are dropped;
/// if nothing the model proposed survives validation, the error tells the
/// caller to fall back to the deterministic planner.
pub async fn optimize_plan(
    provider: &dyn AiProvider,
    assessments: &[Assessment],
    schedule: &ScheduleData,
    completed_topics: &CompletedTopics,
    reference_date: NaiveDate,
) -> Result<StudyTasksPayload, AiUnavailable> {
    let prompt = StructuredPrompt::new(AiModel::Flash, 0.2, OPTIMIZE_INSTRUCTION)
        .with_context(format!(
            "Assessments:\n{}",
            serde_json::to_string(assessments).unwrap_or_default()
        ))
        .with_context(format!(
            "Weekly Schedule:\n{}",
            serde_json::to_string(schedule).unwrap_or_default()
        ));
    let value = provider.chat_json(prompt).await?.into_value();
    let raw: RawPlan = serde_json::from_value(unwrap_array(value)).map_err(|error| {
        AiError::BadResponse(format!("plan JSON did not match the schema: {error}"))
    })?;

    // Horizon: dated upcoming within 14 days — the same window the
    // deterministic planner plans for.
    let horizon: Vec<(&Assessment, i64)> = assessments
        .iter()
        .filter_map(|assessment| {
            let days = (assessment.date? - reference_date).num_days();
            (0..=HORIZON_DAYS)
                .contains(&days)
                .then_some((assessment, days))
        })
        .collect();

    // Readiness cards: ALWAYS the user's real state (`05` §4: "validated
    // against real completion state"). The model's readiness/focus numbers
    // are ignored except where its focus names a real unchecked topic.
    let mut readiness_cards = Vec::new();
    for (assessment, days_i64) in &horizon {
        let topic_list = real_topic_list(assessment);
        let total_count = topic_list.len();
        let mut completed_count = 0usize;
        let mut unchecked: Vec<String> = Vec::new();
        for topic in &topic_list {
            if completed_topics
                .get(&topic_key_for_text(&assessment.id, topic))
                .copied()
                .unwrap_or(false)
            {
                completed_count += 1;
            } else {
                unchecked.push(topic.clone());
            }
        }
        let recommended_focus = raw
            .readiness_cards
            .iter()
            .filter_map(|card| serde_json::from_value::<RawReadinessCard>(card.clone()).ok())
            .find(|card| {
                de_optional(card.assessment_id.as_deref()).as_deref()
                    == Some(assessment.id.as_str())
            })
            .and_then(|card| de_optional(card.recommended_focus.as_deref()))
            .filter(|focus| {
                unchecked
                    .iter()
                    .any(|topic| topic.eq_ignore_ascii_case(focus))
            })
            .or_else(|| unchecked.first().cloned())
            .unwrap_or_else(|| "All topics mastered! Complete mock revision.".to_string());

        readiness_cards.push(ExamReadinessCard {
            assessment_id: assessment.id.clone(),
            course_id: assessment.course_id.clone(),
            course_name: assessment.course_name.clone(),
            title: assessment.title.clone(),
            assessment_type: assessment.assessment_type,
            date: assessment.date.unwrap_or_default(),
            display_date: assessment.display_time.clone(),
            days_until: i32::try_from(*days_i64).unwrap_or(0),
            readiness_percent: readiness_percent(completed_count, total_count),
            completed_count,
            total_count,
            priority_score: compute_priority_score(
                Some(*days_i64),
                assessment.assessment_type,
                assessment.topics.len(),
            ),
            color: assessment.color.clone(),
            recommended_focus,
        });
    }

    // Tasks: validated against real ids/topics/dates only.
    let mut tasks: Vec<DailyStudyTask> = Vec::new();
    let mut seen: HashSet<(String, usize, i32)> = HashSet::new();
    let proposed_task_count = raw.tasks.len();
    for item in raw.tasks {
        let Ok(task) = serde_json::from_value::<RawPlanTask>(item) else {
            continue;
        };
        let Some(assessment_id) = de_optional(task.assessment_id.as_deref()) else {
            continue;
        };
        let Some((assessment, days_i64)) = horizon
            .iter()
            .find(|(candidate, _)| candidate.id == assessment_id)
        else {
            continue;
        };
        let days = i32::try_from(*days_i64).unwrap_or(0);
        let Some(topic) = de_optional(task.topic.as_deref()) else {
            continue;
        };
        let topic_list = real_topic_list(assessment);
        let Some((topic_index, real_topic)) = topic_list
            .iter()
            .enumerate()
            .find(|(_, candidate)| candidate.eq_ignore_ascii_case(&topic))
        else {
            continue;
        };
        let Some(day_offset) = task
            .day_offset
            .and_then(|offset| i32::try_from(offset).ok())
            .filter(|offset| (0..=days).contains(offset))
        else {
            continue;
        };
        if !seen.insert((assessment.id.clone(), topic_index, day_offset)) {
            continue;
        }
        let key = topic_key_for_text(&assessment.id, &real_topic);
        let completed = completed_topics.get(&key).copied().unwrap_or(false);
        let priority_rank = task
            .priority_rank
            .map(|rank| rank.clamp(0, 100) as u8)
            .unwrap_or_else(|| {
                compute_priority_score(
                    Some(*days_i64),
                    assessment.assessment_type,
                    assessment.topics.len(),
                )
            });
        let target_date = reference_date + Duration::days(i64::from(day_offset));
        tasks.push(DailyStudyTask {
            id: format!("ai-task-{}-{topic_index}-{day_offset}", assessment.id),
            key,
            assessment_id: assessment.id.clone(),
            course_id: assessment.course_id.clone(),
            course_name: assessment.course_name.clone(),
            assessment_title: assessment.title.clone(),
            assessment_type: assessment.assessment_type,
            topic: real_topic.clone(),
            day_offset,
            target_date,
            display_day: study_day_display(day_offset, target_date),
            priority_rank,
            urgency: urgency_for(Some(*days_i64)),
            estimated_hours: task.estimated_hours.map(|hours| hours.clamp(0.5, 2.5)),
            ai_reasoning: de_optional(task.ai_reasoning.as_deref())
                .unwrap_or_else(|| reasoning_for_days(days)),
            completed,
            color: assessment.color.clone(),
            days_until_assessment: days,
            assessment_date: assessment.date.unwrap_or_default(),
        });
    }

    if proposed_task_count > 0 && tasks.is_empty() {
        return Err(AiError::BadResponse(
            "every proposed study task referenced unknown assessments, invented topics or impossible days — nothing usable survived validation".to_string(),
        )
        .into());
    }

    // Day groups: today and tomorrow always exist (mirror the deterministic
    // planner so the AI plan renders in the same roadmap).
    let mut grouped: HashMap<i32, Vec<DailyStudyTask>> = HashMap::new();
    for task in tasks {
        grouped.entry(task.day_offset).or_default().push(task);
    }
    let mut offsets: Vec<i32> = grouped.keys().copied().collect();
    for fixed_offset in [0, 1] {
        if !offsets.contains(&fixed_offset) {
            offsets.push(fixed_offset);
        }
    }
    offsets.sort_unstable();

    let mut days: Vec<DailyStudyDayGroup> = Vec::new();
    for offset in &offsets {
        let mut day_tasks = grouped.remove(offset).unwrap_or_default();
        day_tasks.sort_by(|left, right| {
            left.completed
                .cmp(&right.completed)
                .then_with(|| right.priority_rank.cmp(&left.priority_rank))
        });
        let total_estimated_hours = if day_tasks.iter().all(|task| task.estimated_hours.is_some()) {
            Some(
                ((day_tasks
                    .iter()
                    .map(|task| task.estimated_hours.unwrap_or_default())
                    .sum::<f32>())
                    * 10.0)
                    .round()
                    / 10.0,
            )
        } else {
            None
        };
        days.push(DailyStudyDayGroup {
            day_offset: *offset,
            date: reference_date + Duration::days(i64::from(*offset)),
            display_day: study_day_display(
                *offset,
                reference_date + Duration::days(i64::from(*offset)),
            ),
            is_today: *offset == 0,
            total_estimated_hours,
            tasks: day_tasks,
        });
    }

    let total_tasks: usize = days.iter().map(|group| group.tasks.len()).sum();
    let completed_tasks = days
        .iter()
        .flat_map(|group| group.tasks.iter())
        .filter(|task| task.completed)
        .count();
    let every_task_estimated = days
        .iter()
        .flat_map(|group| group.tasks.iter())
        .all(|task| task.estimated_hours.is_some());
    let total_hours = if every_task_estimated {
        Some(
            ((days
                .iter()
                .flat_map(|group| group.tasks.iter())
                .map(|task| task.estimated_hours.unwrap_or_default())
                .sum::<f32>())
                * 10.0)
                .round()
                / 10.0,
        )
    } else {
        None
    };

    Ok(StudyTasksPayload {
        days,
        readiness_cards,
        total_tasks,
        pending_tasks: total_tasks - completed_tasks,
        completed_tasks,
        total_hours,
        ai_generated: true,
    })
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawPlan {
    readiness_cards: Vec<Value>,
    tasks: Vec<Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawReadinessCard {
    assessment_id: Option<String>,
    recommended_focus: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawPlanTask {
    assessment_id: Option<String>,
    topic: Option<String>,
    day_offset: Option<i64>,
    priority_rank: Option<i64>,
    estimated_hours: Option<f32>,
    ai_reasoning: Option<String>,
}

// ---------------------------------------------------------------------------
// Task d — practice quiz generation (flash-lite)
// ---------------------------------------------------------------------------

/// Generates a 5-MCQ practice quiz for one assessment (FlashLite,
/// temperature 0.2, v4's prompt). Validation drops any question with an
/// empty option, a missing question or an out-of-range `correct_index`;
/// empty survivors mean the caller falls back to
/// [`crate::ai::practice_fallback`].
pub async fn generate_practice(
    provider: &dyn AiProvider,
    assessment: &Assessment,
) -> Result<PracticeQuizPayload, AiUnavailable> {
    let topics_text = if assessment.topics.is_empty() {
        assessment.title.clone()
    } else {
        assessment.topics.join(", ")
    };
    let course_name = assessment.course_name.as_deref().unwrap_or("this course");
    let course_code = assessment.course_id.as_deref().unwrap_or("the course");

    let instruction = format!(
        r#"You are an expert university professor for the course "{course_name}" ({course_code}).
Create 5 rigorous, practical multiple-choice quiz questions based on the following topics:
Topics: {topics_text}
Assessment Title: {title}

HONESTY RULES (strict): write questions only about the topics above as the student's own course materials describe them — never invent citations, statistics, or professor quotes.

Return ONLY a JSON array of 5 objects matching this exact structure:
[
  {{
    "question": "What is ...?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 0,
    "explanation": "Clear explanation of why Option A is correct and why other choices are invalid."
  }}
]"#,
        title = assessment.title
    );

    let prompt = StructuredPrompt::new(AiModel::FlashLite, 0.2, instruction);
    let response = provider.chat_json(prompt).await?;
    // The model that actually served the request — a fallback inside the
    // tier is named honestly instead of the tier's first id.
    let served_by = response.model().to_string();
    let value = response.into_value();

    let raw_questions: Vec<Value> = match &value {
        Value::Array(items) => items.clone(),
        Value::Object(_) => value
            .get("questions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let mut questions: Vec<PracticeQuestion> = Vec::new();
    let mut dropped = 0usize;
    for item in raw_questions {
        let Ok(raw) = serde_json::from_value::<RawPracticeQuestion>(item) else {
            dropped += 1;
            continue;
        };
        let Some(question) = de_optional(raw.question.as_deref()) else {
            dropped += 1;
            continue;
        };
        let options: Vec<String> = raw
            .options
            .iter()
            .map(|option| option.trim().to_string())
            .collect();
        if options.len() < 2 || options.len() > 8 || options.iter().any(|option| option.is_empty())
        {
            dropped += 1;
            continue;
        }
        let Some(correct_index) = raw
            .correct_index
            .and_then(|index| usize::try_from(index).ok())
            .filter(|index| *index < options.len())
        else {
            dropped += 1;
            continue;
        };
        questions.push(PracticeQuestion {
            id: format!("q{}", questions.len() + 1),
            question,
            options,
            correct_index,
            explanation: de_optional(raw.explanation.as_deref()).unwrap_or_default(),
        });
    }

    if questions.is_empty() {
        return Err(AiError::BadResponse(format!(
            "no valid question survived validation ({dropped} dropped) — every question needs a non-empty question text, non-empty options and an in-range correct_index"
        ))
        .into());
    }

    Ok(PracticeQuizPayload {
        assessment_id: assessment.id.clone(),
        course_id: assessment.course_id.clone(),
        assessment_title: assessment.title.clone(),
        questions,
        generated_by_ai: true,
        authored_locally: false,
        credit: AiCreditNote::provider_model(&served_by),
    })
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct RawPracticeQuestion {
    question: Option<String>,
    options: Vec<String>,
    correct_index: Option<i64>,
    explanation: Option<String>,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::ai::gemini::GeminiProvider;
    use crate::ai::provider::fixed_clock;
    use crate::plan::fixtures::{assessment_on, ref_date};
    use crate::types::UrgencyLevel;
    use chrono::TimeZone;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn fixture_provider(base_url: &str) -> GeminiProvider {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap();
        GeminiProvider::new(
            client,
            Some("k-test".to_string()),
            base_url,
            fixed_clock(
                chrono::Utc
                    .with_ymd_and_hms(2026, 10, 24, 20, 0, 0)
                    .unwrap(),
            ),
            None,
        )
    }

    fn gemini_body(text: &str) -> serde_json::Value {
        serde_json::json!({
            "candidates": [{
                "content": { "parts": [{ "text": text }] },
                "finishReason": "STOP"
            }]
        })
    }

    async fn mount_model(server: &MockServer, model_path: &str, model_text: &str) {
        Mock::given(method("POST"))
            .and(path(model_path.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(gemini_body(model_text)))
            .mount(server)
            .await;
    }

    fn email() -> CachedEmail {
        CachedEmail {
            id: "gmail-1".to_string(),
            subject: "CSE241 Quiz 2 announcement".to_string(),
            from: "Dr. Ada <ada@univ.edu>".to_string(),
            date: "Sat, 24 Oct 2026 09:00:00 +0000".to_string(),
            snippet: None,
            body: "Quiz 2 next Wednesday during the lecture.".to_string(),
            body_truncated: false,
        }
    }

    #[tokio::test]
    async fn extract_assessment_parses_fields_and_preserves_nulls() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash-lite:generateContent",
            r#"{
  "is_assessment": true,
  "course_id": "CSE241",
  "course_name": "Object-Oriented Programming",
  "title": "Quiz 2: Inheritance",
  "assessment_type": "Midterm Exam",
  "date_iso": "2026-10-28",
  "start_time": "10:00",
  "end_time": "11:30",
  "room": null,
  "group": "  ",
  "instructor": "Dr. Ada Lovelace",
  "topics": ["Inheritance", "   ", "Polymorphism"],
  "warnings": ["Bring calculator"],
  "ai_inference_note": "Date explicit in the announcement.",
  "ai_study_plan": "Revise inheritance trees first.",
  "estimated_study_hours": 3.5
}"#,
        )
        .await;

        let draft = extract_assessment(
            &fixture_provider(&server.uri()),
            &email(),
            &ScheduleData::default(),
        )
        .await
        .unwrap();

        assert!(draft.is_assessment);
        assert_eq!(draft.course_id.as_deref(), Some("CSE241"));
        assert_eq!(draft.title.as_deref(), Some("Quiz 2: Inheritance"));
        assert_eq!(draft.assessment_type, Some(AssessmentType::MidtermExam));
        assert_eq!(draft.date, NaiveDate::from_ymd_opt(2026, 10, 28));
        assert_eq!(draft.start_time, NaiveTime::from_hms_opt(10, 0, 0));
        assert_eq!(draft.end_time, NaiveTime::from_hms_opt(11, 30, 0));
        assert_eq!(draft.room, None, "an explicit null stays unknown");
        assert_eq!(draft.group, None, "whitespace-only is unknown, not data");
        assert_eq!(
            draft.topics,
            vec!["Inheritance".to_string(), "Polymorphism".to_string()]
        );
        assert_eq!(draft.warnings, vec!["Bring calculator".to_string()]);
        assert_eq!(draft.estimated_study_hours, Some(3.5));
    }

    #[tokio::test]
    async fn extract_assessment_junk_values_become_none_not_fabrications() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash-lite:generateContent",
            r#"{
  "is_assessment": true,
  "date_iso": "2026-13-45",
  "start_time": "25:99",
  "end_time": "ten o'clock",
  "estimated_study_hours": -2.5,
  "assessment_type": "galaxy brain",
  "course_id": "   "
}"#,
        )
        .await;

        let draft = extract_assessment(
            &fixture_provider(&server.uri()),
            &email(),
            &ScheduleData::default(),
        )
        .await
        .unwrap();

        assert_eq!(draft.date, None, "a malformed date is discarded");
        assert_eq!(draft.start_time, None);
        assert_eq!(draft.end_time, None);
        assert_eq!(draft.estimated_study_hours, None);
        assert_eq!(
            draft.assessment_type, None,
            "unrecognized type labels are dropped, not coerced"
        );
        assert_eq!(draft.course_id, None);
    }

    #[tokio::test]
    async fn extract_assessment_reports_non_assessment_emails_honestly() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash-lite:generateContent",
            r#"{ "is_assessment": false }"#,
        )
        .await;

        let draft = extract_assessment(
            &fixture_provider(&server.uri()),
            &email(),
            &ScheduleData::default(),
        )
        .await
        .unwrap();
        assert!(!draft.is_assessment);
        assert_eq!(draft.title, None);
    }

    #[test]
    fn merge_extraction_ai_fields_win_and_derived_fields_recompute() {
        let heuristic = {
            let mut item = assessment_on(
                "gmail-1",
                Some("CSE241"),
                "Quiz 1",
                Some(ref_date() + Duration::days(5)),
                vec!["Old Topic"],
            );
            item.course_name = Some("Object-Oriented Programming".to_string());
            item
        };
        let draft = ExtractedAssessment {
            is_assessment: true,
            course_id: Some("CSE342".to_string()),
            course_name: None,
            title: Some("Quiz 1: Redone".to_string()),
            assessment_type: Some(AssessmentType::ClassQuiz),
            date: Some(ref_date() + Duration::days(2)),
            start_time: Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()),
            end_time: None,
            room: Some("Lab 2".to_string()),
            group: None,
            instructor: None,
            topics: vec!["New Topic".to_string()],
            warnings: vec!["Bring ID".to_string()],
            ai_inference_note: Some("AI note".to_string()),
            ai_study_plan: Some("AI plan".to_string()),
            estimated_study_hours: Some(2.0),
        };

        let merged = merge_extraction(heuristic.clone(), &draft, ref_date());

        assert_eq!(merged.course_id.as_deref(), Some("CSE342"));
        assert_eq!(
            merged.course_name, None,
            "a changed course code orphans the old course name"
        );
        assert_eq!(merged.title, "Quiz 1: Redone");
        assert_eq!(merged.date, Some(ref_date() + Duration::days(2)));
        assert_eq!(
            merged.start_time,
            Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap())
        );
        assert_eq!(merged.room.as_deref(), Some("Lab 2"));
        assert_eq!(merged.topics, vec!["New Topic".to_string()]);
        assert_eq!(merged.ai_inference_note.as_deref(), Some("AI note"));
        // Derived fields recomputed from the AI date at the caller's today.
        assert_eq!(merged.days_until, Some(2));
        assert!(merged.is_upcoming);
        assert_eq!(merged.urgency_level, UrgencyLevel::Critical);
        assert_eq!(
            merged.day_name.as_deref(),
            Some("Sunday"),
            "ref Friday + 2 days"
        );
        assert!(merged.display_time.is_some());
        let expected_priority = compute_priority_score(Some(2), AssessmentType::ClassQuiz, 1);
        assert_eq!(merged.priority_score, expected_priority);
    }

    #[test]
    fn merge_extraction_leaves_non_assessments_untouched() {
        let heuristic = assessment_on("gmail-1", None, "Quiz 1", None, vec![]);
        let draft = ExtractedAssessment {
            is_assessment: false,
            course_id: Some("HACK".to_string()),
            course_name: None,
            title: Some("should not apply".to_string()),
            assessment_type: None,
            date: None,
            start_time: None,
            end_time: None,
            room: None,
            group: None,
            instructor: None,
            topics: vec!["should not apply".to_string()],
            warnings: vec![],
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
        };
        let merged = merge_extraction(heuristic.clone(), &draft, ref_date());
        assert_eq!(
            merged, heuristic,
            "is_assessment=false is a drop, not a merge"
        );
    }

    #[tokio::test]
    async fn extract_timetable_drops_invalid_rows_and_keeps_honest_fields() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash:generateContent",
            r##"{
  "semester": "Fall 2026",
  "courses": [
    { "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" },
    { "id": "", "name": "Broken row" },
    { "id": "MATH101", "name": "Calculus I", "color": "not-a-color" }
  ],
  "slots": [
    { "id": "slot-1", "course_id": "CS101", "day": "Sunday", "start_time": "09:00", "end_time": "10:30", "room": "Hall B-204", "type": "Lecture", "group": "Sec 1" },
    { "course_id": "CS101", "day": "Funday", "start_time": "11:00", "end_time": "12:00" },
    { "course_id": "UNKNOWN999", "day": "Monday", "start_time": "09:00", "end_time": "10:00" },
    { "course_id": "MATH101", "day": "Tuesday", "start_time": "14:00", "end_time": "13:00" },
    { "course_id": "MATH101", "day": "Wednesday", "start_time": "8:00", "end_time": "9:30" }
  ]
}"##,
        )
        .await;

        let extracted = extract_timetable(&fixture_provider(&server.uri()), "QUJD", "image/png")
            .await
            .unwrap();

        assert_eq!(
            extracted.dropped_courses, 1,
            "the empty-id course row is dropped"
        );
        assert_eq!(
            extracted.dropped_slots, 3,
            "bad day, unknown course and negative duration are dropped"
        );
        assert_eq!(extracted.schedule.semester.as_deref(), Some("Fall 2026"));

        let courses = &extracted.schedule.courses;
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].id, "CS101");
        assert_eq!(courses[0].color, "#1a73e8");
        assert_eq!(courses[0].bg.as_deref(), Some("#1a73e818"));
        assert_eq!(courses[0].border.as_deref(), Some("#1a73e855"));
        assert!(
            courses[1].color.starts_with('#'),
            "an invalid color falls back to a preset, deterministic"
        );

        let slots = &extracted.schedule.slots;
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].id, "slot-1");
        assert_eq!(slots[0].day_index, 0);
        assert_eq!(
            slots[0].course_name, "Intro to CS",
            "slot names come from the matched course"
        );
        assert_eq!(slots[0].display_time, "09:00–10:30");
        assert_eq!(slots[0].room.as_deref(), Some("Hall B-204"));
        assert_eq!(slots[0].group.as_deref(), Some("Sec 1"));
        assert_eq!(
            slots[1].id, "slot-2",
            "missing slot ids are assigned deterministically"
        );
        assert_eq!(slots[1].day_index, 3, "Wednesday");
        assert_eq!(slots[1].display_time, "08:00–09:30");
        assert_eq!(
            slots[1].room, None,
            "a room the image never showed stays unknown"
        );
        assert_eq!(slots[1].group, None);
    }

    #[tokio::test]
    async fn extract_timetable_empty_semester_is_none_not_a_default() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash:generateContent",
            r#"{ "semester": "", "courses": [], "slots": [] }"#,
        )
        .await;

        let extracted = extract_timetable(&fixture_provider(&server.uri()), "QUJD", "image/png")
            .await
            .unwrap();
        assert_eq!(
            extracted.schedule.semester, None,
            "v4's 'Extracted Semester Schedule' default is deleted"
        );
        assert!(extracted.schedule.courses.is_empty());
    }

    #[tokio::test]
    async fn optimize_plan_validates_against_real_state() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash:generateContent",
            r#"{
  "readiness_cards": [
    { "assessment_id": "gmail-1", "recommended_focus": "Quantum Entanglement", "readiness_percent": 95 }
  ],
  "tasks": [
    { "assessment_id": "gmail-1", "topic": "recursion", "day_offset": 1, "priority_rank": 90, "estimated_hours": 9.0, "ai_reasoning": "Prerequisite for the loops material." },
    { "assessment_id": "gmail-1", "topic": "Quantum Entanglement", "day_offset": 0 },
    { "assessment_id": "nope-9", "topic": "Recursion", "day_offset": 0 },
    { "assessment_id": "gmail-1", "topic": "Loops", "day_offset": 99 }
  ]
}"#,
        )
        .await;

        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(ref_date() + Duration::days(3)),
            vec!["Recursion", "Loops"],
        );
        let mut completed = CompletedTopics::new();
        completed.insert(topic_key_for_text("gmail-1", "Loops"), true); // Loops done

        let payload = optimize_plan(
            &fixture_provider(&server.uri()),
            &[assessment],
            &ScheduleData::default(),
            &completed,
            ref_date(),
        )
        .await
        .unwrap();

        assert!(payload.ai_generated);

        // Readiness is the user's real state — the model's 95% is ignored.
        assert_eq!(payload.readiness_cards.len(), 1);
        let card = &payload.readiness_cards[0];
        assert_eq!(card.readiness_percent, 50, "1 of 2 real topics completed");
        assert_eq!(card.completed_count, 1);
        assert_eq!(card.total_count, 2);
        assert_eq!(
            card.recommended_focus, "Recursion",
            "an invented focus falls back to the first real unchecked topic"
        );
        assert_eq!(card.days_until, 3);

        // Exactly the one valid task survives; the others referenced an
        // invented topic, an unknown id and an impossible day.
        assert_eq!(payload.total_tasks, 1);
        let task = &payload
            .days
            .iter()
            .find(|day| day.day_offset == 1)
            .unwrap()
            .tasks[0];
        assert_eq!(task.topic, "Recursion");
        assert_eq!(
            task.estimated_hours,
            Some(2.5),
            "hours clamp to the 0.5–2.5 band"
        );
        assert_eq!(task.urgency, UrgencyLevel::High);
        assert_eq!(task.priority_rank, 90);
        assert!(
            !task.completed,
            "completion is the real state of that topic key"
        );
        assert!(task.ai_reasoning.contains("Prerequisite"));
        // Today always exists even when nothing lands on it.
        assert!(payload
            .days
            .iter()
            .any(|day| day.day_offset == 0 && day.tasks.is_empty()));
    }

    #[tokio::test]
    async fn optimize_plan_with_only_invented_tasks_is_unavailable() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash:generateContent",
            r#"{
  "readiness_cards": [],
  "tasks": [
    { "assessment_id": "ghost-1", "topic": "Phlogiston", "day_offset": 0 },
    { "assessment_id": "gmail-1", "topic": "Phlogiston", "day_offset": 0 }
  ]
}"#,
        )
        .await;

        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(ref_date() + Duration::days(3)),
            vec!["Recursion"],
        );
        let error = optimize_plan(
            &fixture_provider(&server.uri()),
            &[assessment],
            &ScheduleData::default(),
            &CompletedTopics::new(),
            ref_date(),
        )
        .await
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("nothing usable survived validation"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn generate_practice_drops_invalid_questions() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash-lite:generateContent",
            r#"[
  { "question": "What does SOLID stand for in design?", "options": ["A set of design principles", "A physics constant", "A database engine", "A sorting algorithm"], "correct_index": 0, "explanation": "SOLID is the five OOP design principles." },
  { "question": "Empty option row?", "options": ["ok", "  ", "also ok"], "correct_index": 0, "explanation": "" },
  { "question": "Out of range?", "options": ["a", "b"], "correct_index": 5, "explanation": "" },
  { "question": "Only one option?", "options": ["a"], "correct_index": 0, "explanation": "" }
]"#,
        )
        .await;

        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(ref_date() + Duration::days(3)),
            vec!["SOLID"],
        );
        let payload = generate_practice(&fixture_provider(&server.uri()), &assessment)
            .await
            .unwrap();

        assert_eq!(
            payload.questions.len(),
            1,
            "the empty-option, out-of-range and single-option rows are dropped"
        );
        assert_eq!(
            payload.questions[0].id, "q1",
            "ids are reassigned, never trusted from the model"
        );
        assert_eq!(payload.questions[0].correct_index, 0);
        assert!(payload.generated_by_ai);
        assert!(!payload.authored_locally);
        assert_eq!(
            payload.credit,
            AiCreditNote::provider(AiModel::FlashLite),
            "the credit note names the exact model"
        );
        assert_eq!(payload.assessment_id, "gmail-1");
    }

    #[tokio::test]
    async fn the_practice_credit_note_names_the_model_that_actually_served() {
        let server = MockServer::start().await;
        let ids = AiModel::FlashLite.model_ids();
        let (first, second) = (ids[0], ids[1]);

        // The first id is retired for this key's project.
        Mock::given(method("POST"))
            .and(path(format!("/models/{first}:generateContent")))
            .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
                "error": { "code": 404, "message": "no longer available to new users" }
            })))
            .mount(&server)
            .await;
        // The next id serves the request.
        mount_model(
            &server,
            &format!("/models/{second}:generateContent"),
            r#"[{ "question": "What is SOLID?", "options": ["A principle set", "A protocol"], "correct_index": 0, "explanation": "SOLID is five design principles." }]"#,
        )
        .await;

        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(ref_date() + Duration::days(3)),
            vec!["SOLID"],
        );
        let payload = generate_practice(&fixture_provider(&server.uri()), &assessment)
            .await
            .unwrap();

        assert_eq!(
            payload.credit,
            AiCreditNote::provider_model(second),
            "the provenance chip names the model that really ran, not the tier's first id"
        );
    }

    #[tokio::test]
    async fn generate_practice_with_no_surviving_questions_is_unavailable() {
        let server = MockServer::start().await;
        mount_model(
            &server,
            "/models/gemini-3.5-flash-lite:generateContent",
            r#"[{ "question": "x", "options": [""], "correct_index": 0 }]"#,
        )
        .await;

        let assessment = assessment_on("gmail-1", None, "Quiz 1", None, vec![]);
        let error = generate_practice(&fixture_provider(&server.uri()), &assessment)
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("no valid question survived validation"),
            "{error}"
        );
    }
}
