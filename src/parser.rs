use crate::gemini::{analyze_email_with_gemini_prepared, load_gemini_cache, save_gemini_cache};
use crate::models::{
    AppConfig, Assessment, CachedEmail, ConflictAlert, DailyStudyDayGroup, DailyStudyTask,
    DashboardSummary, ExamReadinessCard, GradeOverallSummary, ScheduleData, StudyRecommendation,
    StudyTasksPayload, TopicCheckItem,
};
use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
use futures::stream::{self, StreamExt};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::LazyLock;

const PROCESSED_FILE: &str = "processed_quizzes.json";
const EMAIL_SEPARATOR: &str =
    "---------------------------------------------------------------------";

// Static precompiled regexes to eliminate runtime Regex::new compilation overhead on every email
static RE_COURSE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b([A-Z]{2,4}\s*\d{3}[a-zA-Z]?)\b").unwrap());
static RE_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(https://e-learning\.[a-zA-Z0-9.-]+/[^\s\]]+)").unwrap());
static RE_SENT_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})").unwrap());
static RE_DMY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b",
    )
    .unwrap()
});
static RE_NUM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b").unwrap());

pub fn load_schedule() -> ScheduleData {
    if let Ok(raw) = fs::read_to_string("data/schedule.json") {
        if let Ok(s) = serde_json::from_str::<ScheduleData>(&raw) {
            return s;
        }
    }
    // First run: seed ONLY an empty template. Never bundle a fabricated (or the
    // developer's real) timetable inside the binary.
    let template = include_str!("../data/schedule.template.json");
    let _ = fs::create_dir_all("data");
    if let Ok(s) = serde_json::from_str::<ScheduleData>(template) {
        let _ = fs::write("data/schedule.json", template);
        return s;
    }
    ScheduleData {
        semester: "My Semester".to_string(),
        courses: Vec::new(),
        slots: Vec::new(),
    }
}

pub fn save_schedule(schedule: &ScheduleData) {
    let _ = fs::create_dir_all("data");
    if let Ok(json) = serde_json::to_string_pretty(schedule) {
        let _ = fs::write("data/schedule.json", json);
    }
}

pub fn current_reference_date() -> NaiveDate {
    Local::now().date_naive()
}

struct PreparedEmail<'a> {
    email: &'a CachedEmail,
    subject_lower: String,
    body_lower: String,
    announcement_body: &'a str,
    announcement_lower: String,
    is_candidate: bool,
}

fn extract_announcement_body(body: &str) -> &str {
    if let Some(start) = body.find(EMAIL_SEPARATOR) {
        let after = &body[start + EMAIL_SEPARATOR.len()..];
        if let Some(end) = after.find(EMAIL_SEPARATOR) {
            return &after[..end];
        }
        return after;
    }
    body
}

fn contains_template_notice(subject_lower: &str, body_lower: &str) -> bool {
    subject_lower.contains("quiz template")
        || subject_lower.contains("assignment template")
        || body_lower.contains("quiz template")
        || body_lower.contains("assignment template")
}

pub async fn process_all_emails(
    emails: &[CachedEmail],
    schedule: &ScheduleData,
    config: &AppConfig,
    use_live_gemini: bool,
) -> Vec<Assessment> {
    let mut gemini_cache = load_gemini_cache();
    let mut cache_updated = false;

    let prepared: Vec<PreparedEmail> = emails
        .iter()
        .map(|email| {
            let subject_lower = email.subject.to_lowercase();
            let body_lower = email.body.to_lowercase();
            let announcement_body = extract_announcement_body(&email.body);
            let announcement_lower = announcement_body.to_lowercase();
            let is_candidate = is_candidate_assessment_email(
                &subject_lower,
                &email.from.to_lowercase(),
                &body_lower,
            );
            PreparedEmail {
                email,
                subject_lower,
                body_lower,
                announcement_body,
                announcement_lower,
                is_candidate,
            }
        })
        .collect();

    let has_template_notice = prepared
        .iter()
        .any(|p| contains_template_notice(&p.subject_lower, &p.body_lower));

    let analyses_enabled = use_live_gemini && config.gemini_enabled;
    let schedule_slots_json = if analyses_enabled {
        Some(serde_json::to_string(&schedule.slots).unwrap_or_default())
    } else {
        None
    };

    if let Some(schedule_json) = schedule_slots_json.as_deref() {
        let pending: Vec<usize> = prepared
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                p.is_candidate
                    && is_email_recent(&p.email.date, 60)
                    && !gemini_cache.contains_key(&p.email.id)
            })
            .map(|(index, _)| index)
            .collect();

        let mut analyses: Vec<(usize, crate::gemini::GeminiExtractedAssessment)> =
            stream::iter(pending)
                .map(|index| {
                    let email = prepared[index].email;
                    let api_key = config.gemini_api_key.as_deref();
                    async move {
                        analyze_email_with_gemini_prepared(email, schedule_json, api_key)
                            .await
                            .map(|extracted| (index, extracted))
                    }
                })
                .buffer_unordered(3)
                .filter_map(|result| async move { result })
                .collect()
                .await;
        analyses.sort_by_key(|(index, _)| *index);
        for (index, extracted) in analyses {
            gemini_cache.insert(prepared[index].email.id.clone(), extracted);
            cache_updated = true;
        }
    }

    let mut assessments = Vec::new();
    let mut seen_keys = HashSet::new();

    for p in &prepared {
        if !p.is_candidate {
            continue;
        }

        if let Some(mut assessment) = parse_single_email(
            p.email,
            schedule,
            gemini_cache.get(&p.email.id),
            has_template_notice,
            &p.subject_lower,
            p.announcement_body,
            &p.announcement_lower,
        ) {
            let dedup_key = format!(
                "{}_{}_{}",
                assessment.course_id, assessment.title, assessment.date_iso
            );
            if seen_keys.insert(dedup_key) {
                if let Some(event_id) = config.synced_gcal_map.get(&assessment.id) {
                    assessment.gcal_synced = true;
                    assessment.gcal_event_id = Some(event_id.clone());
                }
                assessments.push(assessment);
            }
        }
    }

    if cache_updated {
        save_gemini_cache(&gemini_cache);
    }

    // Sort: upcoming first (ordered by earliest date/time), then past (ordered by most recent)
    assessments.sort_by(|a, b| match (a.is_upcoming, b.is_upcoming) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => a
            .date_iso
            .cmp(&b.date_iso)
            .then_with(|| a.start_time.cmp(&b.start_time)),
        (false, false) => b.date_iso.cmp(&a.date_iso),
    });

    if let Ok(json) = serde_json::to_string_pretty(&assessments) {
        let unchanged = fs::read_to_string(PROCESSED_FILE)
            .map(|existing| existing == json)
            .unwrap_or(false);
        if !unchanged {
            let _ = fs::write(PROCESSED_FILE, json);
        }
    }

    assessments
}

fn is_candidate_assessment_email(subject_lower: &str, from_lower: &str, body_lower: &str) -> bool {
    // Filter out student's own outgoing replies
    if subject_lower.starts_with("re:") {
        return false;
    }

    // Filter out pure grade/result announcements unless they announce a remake/makeup quiz
    if (subject_lower.contains("result")
        || subject_lower.contains("grades")
        || subject_lower.contains("marks")
        || subject_lower.contains("model answer")
        || subject_lower.contains("cancellation")
        || subject_lower.contains("appeal")
        || subject_lower.contains("upload your course materials")
        || subject_lower.contains("lecture 1 slides"))
        && !body_lower.contains("remake will be held")
    {
        return false;
    }

    // Filter out pure file upload notification emails (they are merged as context instead)
    if body_lower.contains("is new in the course") && !body_lower.contains("will be held") {
        return false;
    }

    // Filter out bare "REMINDER" 1-word replies that duplicate an earlier thread
    if body_lower.contains("----") {
        let parts: Vec<&str> = body_lower.split(EMAIL_SEPARATOR).collect();
        if parts.len() > 1 && parts[1].trim() == "reminder" {
            return false;
        }
    }

    subject_lower.contains("quiz")
        || subject_lower.contains("midterm")
        || subject_lower.contains("exam")
        || subject_lower.contains("assignment")
        || subject_lower.contains("assessment")
        || (body_lower.contains("quiz") && from_lower.contains("e-learning"))
}

fn parse_single_email(
    email: &CachedEmail,
    schedule: &ScheduleData,
    gemini_override: Option<&crate::gemini::GeminiExtractedAssessment>,
    has_template_notice: bool,
    subject_lower: &str,
    announcement_body: &str,
    announcement_lower: &str,
) -> Option<Assessment> {
    let ref_date = current_reference_date();
    let sent_date = parse_email_sent_date(&email.date).unwrap_or(ref_date);

    let subj_and_body = format!("{} {}", email.subject, announcement_body);
    let lower = format!("{} {}", subject_lower, announcement_lower);

    // 1. Course ID & Course Name resolution (with LMS cross-listing intelligence)
    let mut raw_course = RE_COURSE
        .captures(&subj_and_body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace(' ', "").to_uppercase())
        .unwrap_or_else(|| "GENERAL".to_string());

    // 2. Determine Assessment Type
    let assessment_type = if lower.contains("midterm") {
        "Midterm Exam".to_string()
    } else if lower.contains("final exam") {
        "Final Exam".to_string()
    } else if lower.contains("online quiz") || lower.contains("/mod/quiz/") {
        "Online Quiz".to_string()
    } else if lower.contains("in-class assignment") || subject_lower.contains("assignment") {
        "Assignment".to_string()
    } else if lower.contains("lab session") || lower.contains("during the lab") {
        "Lab Assessment".to_string()
    } else {
        "Class Quiz".to_string()
    };

    // 3. Instructor extraction (from the sender only — never hardcoded)
    let instructor = email
        .from
        .split('<')
        .next()
        .unwrap_or("")
        .replace('"', "")
        .replace("(via Home-Su25)", "")
        .trim()
        .to_string();

    // 4. Schedule-Aware Date, Time, Room & Inference Reasoning
    let (
        mut date_iso,
        mut start_time,
        mut end_time,
        mut room,
        mut group,
        mut title,
        mut ai_inference_note,
    ) = infer_schedule_date_and_slot(
        &raw_course,
        &email.subject,
        &lower,
        sent_date,
        schedule,
        &assessment_type,
    );

    // 5. Topics & Warnings extraction
    let mut topics = extract_topics(announcement_lower, &raw_course);
    let mut warnings = extract_warnings(announcement_lower, has_template_notice);
    let (mut ai_study_plan, mut estimated_study_hours) =
        generate_ai_study_plan(&raw_course, &assessment_type, &topics, &warnings);

    // Apply Gemini override if present
    if let Some(g) = gemini_override {
        if !g.is_assessment {
            return None;
        }
        if !g.course_id.is_empty() {
            raw_course = g.course_id.clone();
        }
        if !g.title.is_empty() {
            title = g.title.clone();
        }
        if !g.date_iso.is_empty() {
            date_iso = g.date_iso.clone();
        }
        if !g.start_time.is_empty() {
            start_time = g.start_time.clone();
        }
        if !g.end_time.is_empty() {
            end_time = g.end_time.clone();
        }
        if !g.room.is_empty() {
            room = g.room.clone();
        }
        if !g.group.is_empty() {
            group = g.group.clone();
        }
        if !g.topics.is_empty() {
            topics = g.topics.clone();
        }
        if !g.warnings.is_empty() {
            warnings = g.warnings.clone();
        }
        if !g.ai_inference_note.is_empty() {
            ai_inference_note = g.ai_inference_note.clone();
        }
        if !g.ai_study_plan.is_empty() {
            ai_study_plan = g.ai_study_plan.clone();
        }
        if g.estimated_study_hours > 0.0 {
            estimated_study_hours = g.estimated_study_hours;
        }
    }

    let parsed_date = NaiveDate::parse_from_str(&date_iso, "%Y-%m-%d").unwrap_or(sent_date);
    let day_name = weekday_full_name(parsed_date.weekday()).to_string();
    let days_until = (parsed_date - ref_date).num_days();
    let is_upcoming = days_until >= 0;

    let urgency_level = if !is_upcoming {
        "past".to_string()
    } else if days_until <= 2 {
        "critical".to_string()
    } else if days_until <= 5 {
        "high".to_string()
    } else if days_until <= 14 {
        "medium".to_string()
    } else {
        "upcoming".to_string()
    };

    let priority_score = compute_priority_score(days_until, &assessment_type, topics.len());

    let course_info = schedule.courses.iter().find(|c| c.id == raw_course);
    // Honest passthrough: for unmatched courses show the raw course string from
    // the email instead of inventing a plausible-sounding course title.
    let course_name = course_info
        .map(|c| c.name.clone())
        .unwrap_or_else(|| raw_course.clone());
    let (color, bg, border) = course_info
        .map(|c| (c.color.clone(), c.bg.clone(), c.border.clone()))
        .unwrap_or_else(|| default_course_palette(&raw_course));

    let display_time = format!(
        "{}, {} {} {} ({} – {})",
        day_name,
        parsed_date.day(),
        month_full_name(parsed_date.month()),
        parsed_date.year(),
        format_12h(&start_time),
        format_12h(&end_time)
    );

    let elearning_url = RE_URL
        .captures(&email.body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .unwrap_or_default();

    let semester = if parsed_date.year() == 2026 && parsed_date.month() >= 9 {
        "Fall 2026".to_string()
    } else if parsed_date.year() == 2026 && (parsed_date.month() == 7 || parsed_date.month() == 8) {
        "Summer 2026".to_string()
    } else if parsed_date.year() == 2026 && parsed_date.month() >= 2 {
        "Spring 2026".to_string()
    } else {
        "Fall 2025".to_string()
    };

    let mut assessment = Assessment {
        id: email.id.clone(),
        course_id: raw_course,
        course_name,
        title,
        assessment_type,
        date_iso,
        day_name,
        start_time,
        end_time,
        display_time,
        room,
        group,
        instructor,
        is_upcoming,
        days_until,
        urgency_level,
        priority_score,
        topics,
        warnings,
        ai_inference_note,
        ai_study_plan,
        estimated_study_hours,
        elearning_url,
        google_cal_url: String::new(),
        gcal_synced: false,
        gcal_event_id: None,
        color,
        bg,
        border,
        semester,
        email_subject: email.subject.clone(),
        email_sent_date: sent_date.format("%Y-%m-%d").to_string(),
        source: "Gmail".to_string(),
        source_icon: "mail".to_string(),
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
    };

    assessment.google_cal_url = build_google_calendar_template_url(&assessment);
    Some(assessment)
}

fn infer_schedule_date_and_slot(
    course_id: &str,
    subject: &str,
    lower: &str,
    sent_date: NaiveDate,
    schedule: &ScheduleData,
    assessment_type: &str,
) -> (String, String, String, String, String, String, String) {
    // Match student's enrolled slot for this course (prefer Lecture unless Tutorial/Lab specified)
    let preferred_slot_type = if lower.contains("tutorial") && !lower.contains("tutorial sheets") {
        "Tutorial"
    } else if lower.contains("lab session") || lower.contains("during the lab") {
        "Lab"
    } else {
        "Lecture"
    };

    let matched_slot = schedule
        .slots
        .iter()
        .find(|s| s.course_id == course_id && s.slot_type.eq_ignore_ascii_case(preferred_slot_type))
        .or_else(|| schedule.slots.iter().find(|s| s.course_id == course_id));

    let date_was_relative = extract_explicit_date(lower).is_none();
    let default_start = matched_slot
        .map(|s| s.start_time.clone())
        .unwrap_or_else(|| "09:00".to_string());
    let default_end = matched_slot
        .map(|s| s.end_time.clone())
        .unwrap_or_else(|| "10:30".to_string());
    let default_room = matched_slot
        .map(|s| s.room.clone())
        .unwrap_or_else(|| "Room unspecified".to_string());
    let default_group = matched_slot
        .map(|s| format!("Group {}", s.group))
        .unwrap_or_else(|| "All Groups".to_string());

    // General Date & Slot resolution
    let mut target_date = extract_explicit_date(lower).unwrap_or_else(|| {
        if lower.contains("next week (not this week)") {
            sent_date + Duration::days(8)
        } else if lower.contains("next week") {
            sent_date + Duration::days(5)
        } else if lower.contains("this week") {
            sent_date + Duration::days(3)
        } else {
            sent_date
        }
    });

    // Align target_date to the course's scheduled weekday if matched_slot is available and date was relative
    if let Some(slot) = matched_slot {
        if let Some(target_wd) = parse_weekday(&slot.day) {
            let mut d = target_date;
            for _ in 0..7 {
                if d.weekday() == target_wd {
                    target_date = d;
                    break;
                }
                d += Duration::days(1);
            }
        }
    }

    let clean_title = if lower.contains("quiz 3") {
        format!("Quiz 3: {}", course_id)
    } else if lower.contains("quiz 2") {
        format!("Quiz 2: {}", course_id)
    } else if lower.contains("quiz 1") {
        format!("Quiz 1: {}", course_id)
    } else if assessment_type == "Midterm Exam" {
        format!("{} Midterm Exam", course_id)
    } else {
        subject.to_string()
    };

    let note = if date_was_relative {
        if matched_slot.is_some() {
            format!(
                "Estimated (local heuristic): the announcement had no explicit date — approximate timing inferred from wording (\"this/next week\"). Room/time aligned with your {} {} slot ({} – {}, Room {}). Configure a Gemini API key for precise extraction.",
                course_id,
                preferred_slot_type,
                format_12h(&default_start),
                format_12h(&default_end),
                default_room
            )
        } else {
            "Estimated (local heuristic): the announcement had no explicit date and this course is not in your schedule, so the date/timing is an approximation. Add the course to your weekly schedule or configure a Gemini API key for precise extraction.".to_string()
        }
    } else if matched_slot.is_some() {
        format!(
            "Parsed from announcement: explicit date found and aligned with your {} {} slot ({} – {}, Room {}).",
            course_id, preferred_slot_type, format_12h(&default_start), format_12h(&default_end), default_room
        )
    } else {
        "Parsed from announcement: explicit date found. Time/room are best-effort estimates because this course is not in your weekly schedule.".to_string()
    };

    (
        target_date.format("%Y-%m-%d").to_string(),
        default_start,
        default_end,
        default_room,
        default_group,
        clean_title,
        note,
    )
}

fn extract_topics(lower: &str, course_id: &str) -> Vec<String> {
    let mut items = Vec::new();
    if lower.contains("bjt") {
        items.push("BJT Transistor Analysis & Biasing".to_string());
    }
    if lower.contains("mosfet") {
        items.push("MOSFET Characteristics & Small-Signal Models".to_string());
    }
    if items.is_empty() {
        items.push(format!("{} announced syllabus material", course_id));
    }
    items
}

fn extract_warnings(lower: &str, has_template_notice: bool) -> Vec<String> {
    let mut warnings = Vec::new();

    if lower.contains("quiz template") || (has_template_notice && lower.contains("quiz")) {
        warnings.push("⚠️ Bring your printed Quiz Template to the lecture!".to_string());
    }
    if lower.contains("will not be able to go back")
        || lower.contains("cannot go back")
        || lower.contains("won't be able to go back")
    {
        warnings.push(
            "⚠️ Strict Navigation: Once you move to the next question, you CANNOT go back!"
                .to_string(),
        );
    }
    if lower.contains("closed-book") || lower.contains("mobile phones are strictly prohibited") {
        warnings.push(
            "⚠️ Closed-Book: Mobile phones and outside notes are strictly prohibited.".to_string(),
        );
    }
    if lower.contains("15 minutes") || lower.contains("15 mins") {
        warnings.push("⏱️ Strict Time Limit: 15 minutes duration.".to_string());
    }
    if lower.contains("mcq") {
        warnings.push(
            "📝 Exam Format: Multiple Choice Questions (MCQ) + Explain & Discuss.".to_string(),
        );
    }
    if lower.contains("assigned time slot") || lower.contains("assigned group") {
        warnings.push(
            "📍 Group Enforcement: You must attend ONLY during your registered group slot."
                .to_string(),
        );
    }

    warnings
}

fn generate_ai_study_plan(
    course_id: &str,
    assessment_type: &str,
    topics: &[String],
    warnings: &[String],
) -> (String, f32) {
    match course_id {
        "MATH 101" | "MATH101" => (
            "Practice computing step size and setting up function evaluation tables. Double-check all calculus and linear algebra calculation steps.".to_string(),
            3.0,
        ),
        "DATA 201" | "DATA201" => (
            "Focus on hand-calculating time complexity (Big-O), sorting algorithms, tree traversals, and dynamic programming subproblems.".to_string(),
            4.0,
        ),
        "CS 101" | "CS101" => (
            "Practice fast recognition of algorithmic loops, recursion trees, and fundamental data structures so you can solve each question confidently.".to_string(),
            3.5,
        ),
        "PHYS 101" | "PHYS101" => (
            "Review core mechanics, circuit equations, and measurement lab sheets from recent problem sets.".to_string(),
            3.5,
        ),
        "MGMT 100" | "MGMT100" => (
            "Review organizational strategy, leadership frameworks, and real-world case analysis from lecture notes.".to_string(),
            2.5,
        ),
        "GENERAL" if assessment_type == "Midterm Exam" => (
            "Space out your midterm revision across the next 3 weeks: dedicate 2 days per course starting with high-problem-solving courses and solve past practice papers.".to_string(),
            18.0,
        ),
        _ => {
            let warn_hint = if warnings.iter().any(|w| w.contains("Template")) {
                " Don't forget to print your required template before class."
            } else {
                ""
            };
            (
                format!(
                    "Review {} lecture slides and solve the corresponding tutorial sheet problems ({} core topic areas).{}",
                    course_id,
                    topics.len(),
                    warn_hint
                ),
                2.5,
            )
        }
    }
}

fn compute_priority_score(days_until: i64, assessment_type: &str, topic_count: usize) -> u32 {
    if days_until < 0 {
        return 10;
    }
    let urgency_base: u32 = match days_until {
        0 => 98,
        1 => 95,
        2 => 90,
        3 => 84,
        4 => 80,
        5 => 76,
        6..=7 => 70,
        8..=14 => 60,
        _ => 50,
    };
    let type_bonus: u32 = match assessment_type {
        "Midterm Exam" | "Final Exam" => 12,
        "Class Quiz" | "Online Quiz" => 6,
        _ => 3,
    };
    let topic_bonus = (topic_count as u32).min(6);
    (urgency_base + type_bonus + topic_bonus).min(100)
}

pub fn build_dashboard_summary(assessments: &[Assessment], config: &AppConfig) -> DashboardSummary {
    let ref_date = current_reference_date();
    let upcoming_indices: Vec<usize> = assessments
        .iter()
        .enumerate()
        .filter(|(_, a)| a.is_upcoming)
        .map(|(index, _)| index)
        .collect();

    let next_up = upcoming_indices
        .first()
        .map(|&index| assessments[index].clone());
    let upcoming_this_week: Vec<Assessment> = upcoming_indices
        .iter()
        .filter(|&&index| {
            let a = &assessments[index];
            a.days_until >= 0 && a.days_until <= 7
        })
        .map(|&index| assessments[index].clone())
        .collect();

    let mut exam_type_counts: HashMap<&str, usize> = HashMap::new();
    for &index in &upcoming_indices {
        let a = &assessments[index];
        *exam_type_counts
            .entry(a.assessment_type.as_str())
            .or_insert(0) += 1;
    }
    let exam_type_counts: HashMap<String, usize> = exam_type_counts
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();

    let mut total_topics_count = 0usize;
    let mut completed_topics_count = 0usize;
    let mut study_recommendations = Vec::new();

    for &index in &upcoming_indices {
        let a = &assessments[index];
        let mut topic_items = Vec::new();
        let mut done_for_this = 0usize;

        for (idx, t) in a.topics.iter().enumerate() {
            let key = format!("{}::{}", a.id, idx);
            let completed = *config.completed_topics.get(&key).unwrap_or(&false);
            total_topics_count += 1;
            if completed {
                completed_topics_count += 1;
                done_for_this += 1;
            }
            topic_items.push(TopicCheckItem {
                key,
                topic: t.clone(),
                completed,
            });
        }

        let progress_percent = if a.topics.is_empty() {
            100
        } else {
            ((done_for_this as f32 / a.topics.len() as f32) * 100.0).round() as u32
        };

        let urgency_badge = match a.days_until {
            0 => "TODAY".to_string(),
            1 => "TOMORROW".to_string(),
            d if d <= 5 => format!("IN {} DAYS", d),
            d => format!("IN {} DAYS", d),
        };

        let remaining_topics = a.topics.len().saturating_sub(done_for_this);
        let why_study_now = if a.days_until <= 1 {
            format!(
                "Immediate priority! {} is {} ({}) in Room {} — {} of {} topics still need review.",
                a.title,
                if a.days_until == 0 {
                    "today"
                } else {
                    "tomorrow morning"
                },
                format_12h(&a.start_time),
                a.room,
                remaining_topics,
                a.topics.len()
            )
        } else if a.days_until <= 5 {
            format!(
                "Scheduled this week on {} ({}) in Room {}. Est. {:.1} hrs needed across {} topics.",
                a.day_name,
                format_12h(&a.start_time),
                a.room,
                a.estimated_study_hours,
                a.topics.len()
            )
        } else {
            format!(
                "Major milestone in {} days ({}). Start early revision across {} modules.",
                a.days_until,
                a.date_iso,
                a.topics.len()
            )
        };

        study_recommendations.push(StudyRecommendation {
            assessment_id: a.id.clone(),
            course_id: a.course_id.clone(),
            course_name: a.course_name.clone(),
            title: a.title.clone(),
            assessment_type: a.assessment_type.clone(),
            date_iso: a.date_iso.clone(),
            display_time: a.display_time.clone(),
            days_until: a.days_until,
            urgency_badge,
            priority_score: a.priority_score,
            why_study_now,
            ai_study_plan: a.ai_study_plan.clone(),
            topics: topic_items,
            warnings: a.warnings.clone(),
            color: a.color.clone(),
            progress_percent,
        });
    }

    let readiness_percent = if total_topics_count == 0 {
        100
    } else {
        ((completed_topics_count as f32 / total_topics_count as f32) * 100.0).round() as u32
    };

    // 1. Conflict and Overload Detection (Assessments within 36 hours of each other)
    let study_block_ids: HashSet<&str> = config
        .custom_events
        .iter()
        .filter_map(|event| event.id.strip_prefix("study-block-"))
        .collect();

    let positions: HashMap<usize, usize> = upcoming_indices
        .iter()
        .enumerate()
        .map(|(position, &index)| (index, position))
        .collect();

    let mut dated: Vec<(NaiveDate, usize)> = upcoming_indices
        .iter()
        .filter_map(|&index| {
            NaiveDate::parse_from_str(&assessments[index].date_iso, "%Y-%m-%d")
                .ok()
                .map(|date| (date, index))
        })
        .collect();
    dated.sort_by_key(|(date, _)| *date);

    let mut conflict_pairs = Vec::new();
    for left in 0..dated.len() {
        for right in (left + 1)..dated.len() {
            let diff_days = (dated[right].0 - dated[left].0).num_days();
            if diff_days > 1 {
                break;
            }

            let (index_a, index_b) = (dated[left].1, dated[right].1);
            let (pos_a, pos_b) = (positions[&index_a], positions[&index_b]);
            let (a1, a2, first_pos, second_pos) = if pos_a <= pos_b {
                (&assessments[index_a], &assessments[index_b], pos_a, pos_b)
            } else {
                (&assessments[index_b], &assessments[index_a], pos_b, pos_a)
            };

            let is_same_day = diff_days == 0;
            let gap_hours = if is_same_day { 4 } else { 26 };
            let severity = if is_same_day {
                "critical".to_string()
            } else {
                "warning".to_string()
            };
            let message = format!(
                "Exam schedule cluster: {} ({}) and {} ({}) occur within {} hours! Review early to balance your study load.",
                a1.course_id, a1.title, a2.course_id, a2.title, gap_hours
            );
            let is_mitigated = study_block_ids.contains(a1.id.as_str())
                || study_block_ids.contains(a2.id.as_str());

            conflict_pairs.push((
                first_pos,
                second_pos,
                ConflictAlert {
                    assessment_id_a: a1.id.clone(),
                    assessment_id_b: a2.id.clone(),
                    course_a: a1.course_id.clone(),
                    course_b: a2.course_id.clone(),
                    date_a: a1.date_iso.clone(),
                    date_b: a2.date_iso.clone(),
                    gap_hours,
                    severity,
                    message,
                    is_mitigated,
                },
            ));
        }
    }
    conflict_pairs.sort_by_key(|(first_pos, second_pos, _)| (*first_pos, *second_pos));
    let conflict_alerts: Vec<ConflictAlert> = conflict_pairs
        .into_iter()
        .map(|(_, _, alert)| alert)
        .collect();

    // 2. Multi-Source Ingestion Counts
    let mut sources_count: HashMap<&str, usize> = HashMap::new();
    for a in assessments {
        let src = if a.source.is_empty() {
            "Gmail"
        } else {
            a.source.as_str()
        };
        *sources_count.entry(src).or_insert(0) += 1;
    }
    let sources_count: HashMap<String, usize> = sources_count
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();

    // 3. Overall Grade & Academic Standing
    let mut completed_grades_count = 0usize;
    let mut total_weight = 0.0f32;
    let mut weighted_points = 0.0f32;
    for a in assessments {
        if let Some(g) = config.grades.get(&a.id) {
            if g.max_score > 0.0 && g.weightage_percent > 0.0 {
                completed_grades_count += 1;
                total_weight += g.weightage_percent;
                let pct = (g.achieved_score / g.max_score) * 100.0;
                weighted_points += pct * (g.weightage_percent / 100.0);
            }
        }
    }
    let grade_stats = if total_weight > 0.0 {
        let weighted_avg = (weighted_points / total_weight) * 100.0;
        let letter = match weighted_avg {
            p if p >= 90.0 => "A",
            p if p >= 85.0 => "A-",
            p if p >= 80.0 => "B+",
            p if p >= 75.0 => "B",
            p if p >= 70.0 => "C+",
            p if p >= 60.0 => "C",
            _ => "D",
        };
        Some(GradeOverallSummary {
            completed_assessments_count: completed_grades_count,
            total_weight_percent: total_weight,
            weighted_average_percent: (weighted_avg * 10.0).round() / 10.0,
            letter_standing: letter.to_string(),
        })
    } else {
        None
    };

    DashboardSummary {
        reference_date: ref_date.format("%Y-%m-%d").to_string(),
        next_up,
        upcoming_this_week,
        all_upcoming: upcoming_indices
            .iter()
            .map(|&index| assessments[index].clone())
            .collect(),
        exam_type_counts,
        study_recommendations,
        total_topics_count,
        completed_topics_count,
        readiness_percent,
        conflict_alerts,
        sources_count,
        grade_stats,
    }
}

pub fn build_google_calendar_template_url(a: &Assessment) -> String {
    let date_clean = a.date_iso.replace('-', "");
    let start_clean = a.start_time.replace(':', "") + "00";
    let end_clean = a.end_time.replace(':', "") + "00";
    let dates = format!(
        "{}T{}/{}T{}",
        date_clean, start_clean, date_clean, end_clean
    );

    let title = format!("[{}] {} ({})", a.course_id, a.title, a.assessment_type);
    let mut details = format!(
        "Course: {} — {}\nAssessment Type: {}\nRoom: {} ({})\nInstructor: {}\n\n",
        a.course_id, a.course_name, a.assessment_type, a.room, a.group, a.instructor
    );
    if !a.topics.is_empty() {
        details.push_str("What to Study:\n");
        for t in &a.topics {
            details.push_str(&format!("• {}\n", t));
        }
        details.push('\n');
    }
    if !a.warnings.is_empty() {
        details.push_str("Important Warnings:\n");
        for w in &a.warnings {
            details.push_str(&format!("{}\n", w));
        }
        details.push('\n');
    }
    details.push_str(&format!("AI Study Plan: {}\n", a.ai_study_plan));
    if !a.elearning_url.is_empty() {
        details.push_str(&format!("\nCourse Link: {}", a.elearning_url));
    }

    let location = format!("University Campus - Room {}", a.room);
    format!(
        "https://calendar.google.com/calendar/render?action=TEMPLATE&text={}&dates={}&details={}&location={}&sf=true&output=xml",
        crate::urlencoding::encode(&title),
        dates,
        crate::urlencoding::encode(&details),
        crate::urlencoding::encode(&location)
    )
}

fn parse_email_sent_date(date_header: &str) -> Option<NaiveDate> {
    let caps = RE_SENT_DATE.captures(date_header)?;
    let day: u32 = caps.get(1)?.as_str().parse().ok()?;
    let mon = match &caps.get(2)?.as_str().to_lowercase()[..] {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    };
    let year: i32 = caps.get(3)?.as_str().parse().ok()?;
    NaiveDate::from_ymd_opt(year, mon, day)
}

// True when the email was sent within the last `max_age_days` days (used to gate
// live Gemini analysis so very old announcements are never re-billed).
fn is_email_recent(date_header: &str, max_age_days: i64) -> bool {
    match parse_email_sent_date(date_header) {
        Some(d) => (Local::now().date_naive() - d).num_days() <= max_age_days,
        None => true,
    }
}

fn extract_explicit_date(text: &str) -> Option<NaiveDate> {
    if let Some(caps) = RE_DMY.captures(text) {
        let day: u32 = caps.get(1)?.as_str().parse().ok()?;
        let mon = month_from_name(caps.get(2)?.as_str())?;
        let year: i32 = caps.get(3)?.as_str().parse().ok()?;
        return NaiveDate::from_ymd_opt(year, mon, day);
    }

    if let Some(caps) = RE_NUM.captures(text) {
        let day: u32 = caps.get(1)?.as_str().parse().ok()?;
        let mon: u32 = caps.get(2)?.as_str().parse().ok()?;
        let year: i32 = caps.get(3)?.as_str().parse().ok()?;
        return NaiveDate::from_ymd_opt(year, mon, day);
    }
    None
}

fn month_from_name(s: &str) -> Option<u32> {
    match &s.to_lowercase()[..] {
        "january" => Some(1),
        "february" => Some(2),
        "march" => Some(3),
        "april" => Some(4),
        "may" => Some(5),
        "june" => Some(6),
        "july" => Some(7),
        "august" => Some(8),
        "september" => Some(9),
        "october" => Some(10),
        "november" => Some(11),
        "december" => Some(12),
        _ => None,
    }
}

fn parse_weekday(day_str: &str) -> Option<Weekday> {
    match &day_str.to_lowercase()[..] {
        "sunday" => Some(Weekday::Sun),
        "monday" => Some(Weekday::Mon),
        "tuesday" => Some(Weekday::Tue),
        "wednesday" => Some(Weekday::Wed),
        "thursday" => Some(Weekday::Thu),
        "friday" => Some(Weekday::Fri),
        "saturday" => Some(Weekday::Sat),
        _ => None,
    }
}

fn weekday_full_name(wd: Weekday) -> &'static str {
    match wd {
        Weekday::Sun => "Sunday",
        Weekday::Mon => "Monday",
        Weekday::Tue => "Tuesday",
        Weekday::Wed => "Wednesday",
        Weekday::Thu => "Thursday",
        Weekday::Fri => "Friday",
        Weekday::Sat => "Saturday",
    }
}

fn month_full_name(m: u32) -> &'static str {
    match m {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "October",
    }
}

pub fn format_12h(hhmm: &str) -> String {
    let Some((hour, minute)) = hhmm.split_once(':') else {
        return hhmm.to_string();
    };
    if minute.contains(':') {
        return hhmm.to_string();
    }
    let h: u32 = hour.parse().unwrap_or(9);
    let ampm = if h >= 12 { "PM" } else { "AM" };
    let h12 = match h {
        0 => 12,
        1..=12 => h,
        _ => h - 12,
    };
    format!("{}:{} {}", h12, minute, ampm)
}

fn default_course_palette(course_id: &str) -> (String, String, String) {
    match course_id {
        "CS 101" | "CS101" => (
            "#4285f4".to_string(),
            "#dbeafe".to_string(),
            "#1a73e8".to_string(),
        ),
        "MATH 101" | "MATH101" => (
            "#8e24aa".to_string(),
            "#f3e8ff".to_string(),
            "#7b1fa2".to_string(),
        ),
        "DATA 201" | "DATA201" => (
            "#0f9d58".to_string(),
            "#dcfce7".to_string(),
            "#15803d".to_string(),
        ),
        "PHYS 101" | "PHYS101" => (
            "#f4b400".to_string(),
            "#fef3c7".to_string(),
            "#d97706".to_string(),
        ),
        "MGMT 100" | "MGMT100" => (
            "#e67c73".to_string(),
            "#fee2e2".to_string(),
            "#dc2626".to_string(),
        ),
        _ => (
            "#6366f1".to_string(),
            "#e0e7ff".to_string(),
            "#4338ca".to_string(),
        ),
    }
}

/// Formats a study-plan day label. "Today"/"Tomorrow" carry their real calendar
/// date so students always see the exact reference day being planned.
fn study_day_display(offset: i32, date: NaiveDate) -> String {
    match offset {
        0 => format!("Today · {}", date.format("%a, %b %-d")),
        1 => format!("Tomorrow · {}", date.format("%a, %b %-d")),
        _ => date.format("%a, %b %-d").to_string(),
    }
}

pub fn build_study_tasks(assessments: &[Assessment], config: &AppConfig) -> StudyTasksPayload {
    let ref_date = current_reference_date();
    let mut upcoming_indices: Vec<usize> = assessments
        .iter()
        .enumerate()
        .filter(|(_, a)| (a.is_upcoming || a.days_until >= 0) && a.days_until <= 14)
        .map(|(index, _)| index)
        .collect();

    // Sort upcoming by days_until ascending, then priority_score descending
    upcoming_indices.sort_by(|&left_index, &right_index| {
        let left = &assessments[left_index];
        let right = &assessments[right_index];
        left.days_until
            .cmp(&right.days_until)
            .then_with(|| right.priority_score.cmp(&left.priority_score))
    });

    let fallback_topics = [
        "Core Lecture Concepts & Slides Review",
        "Practice Problem Sets & Exercises",
        "Mock Revision & Key Formula Summary",
    ];

    let mut readiness_cards = Vec::new();
    let mut all_tasks = Vec::new();

    for &assessment_index in &upcoming_indices {
        let a = &assessments[assessment_index];
        let topics_len = if a.topics.is_empty() {
            fallback_topics.len()
        } else {
            a.topics.len()
        };

        let mut completed_count = 0usize;
        let mut first_uncompleted: Option<&str> = None;

        let max_prep_days = (a.days_until.max(1) - 1).min(5) as i32;
        let hours_per_topic = (a.estimated_study_hours / (topics_len as f32).max(1.0))
            .clamp(0.5, 2.5);
        let hours_rounded = (hours_per_topic * 10.0).round() / 10.0;

        let urgency = if a.days_until <= 1 {
            "critical".to_string()
        } else if a.days_until <= 4 {
            "high".to_string()
        } else {
            "normal".to_string()
        };

        let ai_reasoning = if a.days_until <= 1 {
            format!(
                "Immediate exam deadline in {} — high grade impact.",
                if a.days_until == 0 {
                    "a few hours"
                } else {
                    "24 hours"
                }
            )
        } else if a.days_until <= 4 {
            "High-priority preparation. Master foundational problem sets before final review."
                .to_string()
        } else {
            "Structured early revision to build retention and confidence.".to_string()
        };

        for (idx, &fallback) in fallback_topics.iter().enumerate().take(topics_len) {
            let topic = if a.topics.is_empty() {
                fallback
            } else {
                a.topics[idx].as_str()
            };
            let key = format!("{}::{}", a.id, idx);
            let is_completed = *config.completed_topics.get(&key).unwrap_or(&false);
            if is_completed {
                completed_count += 1;
            } else if first_uncompleted.is_none() {
                first_uncompleted = Some(topic);
            }

            // Distribute across days based on days_until and topic index
            let day_offset = if a.days_until <= 0 || max_prep_days <= 0 {
                0
            } else {
                (idx as i32) % (max_prep_days + 1)
            };

            let task_date = ref_date + Duration::days(day_offset as i64);
            let display_day = study_day_display(day_offset, task_date);

            let rank_score = a.priority_score.saturating_sub((day_offset as u32) * 5);

            all_tasks.push(DailyStudyTask {
                id: format!("task-{}-{}-{}", a.id, idx, day_offset),
                key,
                assessment_id: a.id.clone(),
                course_id: a.course_id.clone(),
                course_name: a.course_name.clone(),
                assessment_title: a.title.clone(),
                assessment_type: a.assessment_type.clone(),
                topic: topic.to_string(),
                day_offset,
                target_date_iso: task_date.format("%Y-%m-%d").to_string(),
                display_day,
                priority_rank: rank_score,
                urgency: urgency.clone(),
                estimated_hours: hours_rounded,
                ai_reasoning: ai_reasoning.clone(),
                completed: is_completed,
                color: a.color.clone(),
                days_until_assessment: a.days_until,
                assessment_date: a.date_iso.clone(),
            });
        }

        let readiness_percent = if topics_len == 0 {
            100
        } else {
            ((completed_count as f32 / topics_len as f32) * 100.0).round() as u32
        };

        readiness_cards.push(ExamReadinessCard {
            assessment_id: a.id.clone(),
            course_id: a.course_id.clone(),
            course_name: a.course_name.clone(),
            title: a.title.clone(),
            assessment_type: a.assessment_type.clone(),
            date_iso: a.date_iso.clone(),
            display_date: a.display_time.clone(),
            days_until: a.days_until,
            readiness_percent,
            completed_count,
            total_count: topics_len,
            priority_score: a.priority_score,
            color: a.color.clone(),
            recommended_focus: first_uncompleted
                .map(str::to_string)
                .unwrap_or_else(|| "All topics mastered! Complete mock revision.".to_string()),
        });
    }

    let total_tasks = all_tasks.len();
    let completed_tasks = all_tasks.iter().filter(|t| t.completed).count();
    let pending_tasks = total_tasks.saturating_sub(completed_tasks);
    let total_hours = all_tasks.iter().map(|t| t.estimated_hours).sum::<f32>();

    // Group tasks by day_offset
    let mut day_map: HashMap<i32, Vec<DailyStudyTask>> = HashMap::new();
    for task in all_tasks {
        day_map.entry(task.day_offset).or_default().push(task);
    }

    // Collect sorted day offsets (from 0 up to 6)
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
        let display_day = study_day_display(offset, date);

        let mut day_tasks = day_map.remove(&offset).unwrap_or_default();
        // Sort within day: uncompleted first, then by priority_rank descending
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

    StudyTasksPayload {
        days,
        readiness_cards,
        total_tasks,
        pending_tasks,
        completed_tasks,
        total_hours: (total_hours * 10.0).round() / 10.0,
        ai_generated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_parsing_performance() {
        let email = CachedEmail {
            id: "1a125bc4af1ed819".to_string(),
            subject: "MATH 101 Class Quiz 1 Notice".to_string(),
            from: "Prof. Elena Rostova <elena@university.edu>".to_string(),
            date: "Sat, 10 Oct 2026 09:00:00 +0000".to_string(),
            snippet: "Class Quiz 1 will be held next week...".to_string(),
            body: "Class Quiz 1 on Numerical Integration will be held during your scheduled lectures next week (18 October 2026). See https://e-learning.university.edu/mod/quiz/123".to_string(),
        };
        let schedule = load_schedule();
        let subject_lower = email.subject.to_lowercase();
        let announcement_body = extract_announcement_body(&email.body);
        let announcement_lower = announcement_body.to_lowercase();

        let start = std::time::Instant::now();
        for _ in 0..1_000 {
            let res = parse_single_email(
                &email,
                &schedule,
                None,
                false,
                &subject_lower,
                announcement_body,
                &announcement_lower,
            );
            assert!(res.is_some());
        }
        let elapsed = start.elapsed();
        println!("1,000 email parsing iterations took: {:?}", elapsed);
        assert!(
            elapsed.as_millis() < 500,
            "1,000 email parses should complete in under 500ms"
        );
    }

    #[test]
    fn test_format_12h() {
        // Standard 24-hour time string conversions
        assert_eq!(format_12h("00:00"), "12:00 AM");
        assert_eq!(format_12h("01:15"), "1:15 AM");
        assert_eq!(format_12h("09:05"), "9:05 AM");
        assert_eq!(format_12h("09:30"), "9:30 AM");
        assert_eq!(format_12h("12:00"), "12:00 PM");
        assert_eq!(format_12h("13:30"), "1:30 PM");
        assert_eq!(format_12h("13:45"), "1:45 PM");
        assert_eq!(format_12h("23:59"), "11:59 PM");

        // Invalid structure / non-colon strings return original input
        assert_eq!(format_12h(""), "");
        assert_eq!(format_12h("abc"), "abc");
        assert_eq!(format_12h("1200"), "1200");
        assert_eq!(format_12h("10:20:30"), "10:20:30");

        // Non-numeric or missing hour defaults to 9 AM logic (unwrap_or(9))
        assert_eq!(format_12h("abc:30"), "9:30 AM");
        assert_eq!(format_12h("abc:def"), "9:def AM");
        assert_eq!(format_12h(":15"), "9:15 AM");
        assert_eq!(format_12h(":30"), "9:30 AM");
        assert_eq!(format_12h("-5:00"), "9:00 AM");

        // Out-of-range hours (>23)
        assert_eq!(format_12h("24:00"), "12:00 PM");
        assert_eq!(format_12h("25:30"), "13:30 PM");

        // Edge cases for minutes
        assert_eq!(format_12h("10:"), "10: AM");
        assert_eq!(format_12h("15:"), "3: PM");
        assert_eq!(format_12h("14:abc"), "2:abc PM");
    }

    #[test]
    fn test_build_study_tasks() {
        let mut config = AppConfig::default();
        let assessment = Assessment {
            id: "assess-test-1".to_string(),
            course_id: "CSE420".to_string(),
            course_name: "Computer Architecture".to_string(),
            title: "Midterm Exam".to_string(),
            assessment_type: "Midterm Exam".to_string(),
            date_iso: "2026-10-21".to_string(),
            day_name: "Wednesday".to_string(),
            start_time: "10:00".to_string(),
            end_time: "11:30".to_string(),
            display_time: "10:00 AM – 11:30 AM".to_string(),
            room: "Hall B".to_string(),
            group: "Sec 1".to_string(),
            instructor: "Dr. Smith".to_string(),
            is_upcoming: true,
            days_until: 3,
            urgency_level: "high".to_string(),
            priority_score: 90,
            topics: vec![
                "Instruction Pipelining & Hazards".to_string(),
                "Branch Prediction & Speculative Execution".to_string(),
                "Cache Memory & Coherence".to_string(),
            ],
            warnings: vec![],
            ai_inference_note: "Syllabus chapter 4-6".to_string(),
            ai_study_plan: "Review slides".to_string(),
            estimated_study_hours: 4.5,
            elearning_url: "".to_string(),
            google_cal_url: "".to_string(),
            gcal_synced: false,
            gcal_event_id: None,
            color: "#1a73e8".to_string(),
            bg: "#e8f0fe".to_string(),
            border: "#1a73e8".to_string(),
            semester: "Fall 2026".to_string(),
            email_subject: "Midterm".to_string(),
            email_sent_date: "2026-10-15".to_string(),
            source: "Gmail".to_string(),
            source_icon: "mail".to_string(),
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
        };

        // Mark topic 0 as completed in config
        config
            .completed_topics
            .insert("assess-test-1::0".to_string(), true);

        let payload = build_study_tasks(&[assessment], &config);
        assert_eq!(payload.total_tasks, 3);
        assert_eq!(payload.completed_tasks, 1);
        assert_eq!(payload.pending_tasks, 2);
        assert_eq!(payload.readiness_cards.len(), 1);
        assert_eq!(payload.readiness_cards[0].readiness_percent, 33);
        assert!(payload.days.len() >= 2);
    }

    #[test]
    fn test_build_google_calendar_template_url_full() {
        let assessment = Assessment {
            id: "gcal-test-1".to_string(),
            course_id: "CS 101".to_string(),
            course_name: "Introduction to Computer Science".to_string(),
            title: "Quiz 1".to_string(),
            assessment_type: "Online Quiz".to_string(),
            date_iso: "2026-10-21".to_string(),
            day_name: "Wednesday".to_string(),
            start_time: "14:00".to_string(),
            end_time: "15:30".to_string(),
            display_time: "Wednesday, 21 October 2026 (2:00 PM – 3:30 PM)".to_string(),
            room: "Hall A-110".to_string(),
            group: "Group B".to_string(),
            instructor: "Dr. Marcus Vance".to_string(),
            is_upcoming: true,
            days_until: 5,
            urgency_level: "medium".to_string(),
            priority_score: 75,
            topics: vec!["Recursion".to_string(), "Sorting Algorithms".to_string()],
            warnings: vec!["⚠️ Strict Navigation".to_string()],
            ai_inference_note: "".to_string(),
            ai_study_plan: "Practice coding algorithms.".to_string(),
            estimated_study_hours: 3.0,
            elearning_url: "https://e-learning.univ.edu/course/view.php?id=123".to_string(),
            google_cal_url: "".to_string(),
            gcal_synced: false,
            gcal_event_id: None,
            color: "#4285f4".to_string(),
            bg: "#dbeafe".to_string(),
            border: "#1a73e8".to_string(),
            semester: "Fall 2026".to_string(),
            email_subject: "CS 101 Quiz".to_string(),
            email_sent_date: "2026-10-16".to_string(),
            source: "Gmail".to_string(),
            source_icon: "mail".to_string(),
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
        };

        let url = build_google_calendar_template_url(&assessment);

        assert!(url.starts_with("https://calendar.google.com/calendar/render?action=TEMPLATE"));
        assert!(url.contains("dates=20261021T140000/20261021T153000"));
        assert!(url.contains("sf=true&output=xml"));

        // Text title: "[CS 101] Quiz 1 (Online Quiz)" encoded
        let expected_title_encoded = crate::urlencoding::encode("[CS 101] Quiz 1 (Online Quiz)");
        assert!(url.contains(&format!("text={}", expected_title_encoded)));

        // Location: "University Campus - Room Hall A-110" encoded
        let expected_loc_encoded =
            crate::urlencoding::encode("University Campus - Room Hall A-110");
        assert!(url.contains(&format!("location={}", expected_loc_encoded)));

        // Details should contain topics, warnings, study plan, and e-learning link
        let unencoded_details = format!(
            "Course: CS 101 — Introduction to Computer Science\nAssessment Type: Online Quiz\nRoom: Hall A-110 (Group B)\nInstructor: Dr. Marcus Vance\n\nWhat to Study:\n• Recursion\n• Sorting Algorithms\n\nImportant Warnings:\n⚠️ Strict Navigation\n\nAI Study Plan: Practice coding algorithms.\n\nCourse Link: https://e-learning.univ.edu/course/view.php?id=123"
        );
        let expected_details_encoded = crate::urlencoding::encode(&unencoded_details);
        assert!(url.contains(&format!("details={}", expected_details_encoded)));
    }

    #[test]
    fn test_build_google_calendar_template_url_minimal() {
        let assessment = Assessment {
            id: "gcal-test-2".to_string(),
            course_id: "MATH 101".to_string(),
            course_name: "Calculus".to_string(),
            title: "Midterm".to_string(),
            assessment_type: "Midterm Exam".to_string(),
            date_iso: "2026-11-01".to_string(),
            day_name: "Sunday".to_string(),
            start_time: "09:00".to_string(),
            end_time: "11:00".to_string(),
            display_time: "Sunday, 1 November 2026".to_string(),
            room: "Room 101".to_string(),
            group: "All Groups".to_string(),
            instructor: "Prof. Rostova".to_string(),
            is_upcoming: true,
            days_until: 10,
            urgency_level: "medium".to_string(),
            priority_score: 80,
            topics: vec![],
            warnings: vec![],
            ai_inference_note: "".to_string(),
            ai_study_plan: "Solve past exams.".to_string(),
            estimated_study_hours: 5.0,
            elearning_url: "".to_string(),
            google_cal_url: "".to_string(),
            gcal_synced: false,
            gcal_event_id: None,
            color: "#8e24aa".to_string(),
            bg: "#f3e8ff".to_string(),
            border: "#7b1fa2".to_string(),
            semester: "Fall 2026".to_string(),
            email_subject: "MATH Midterm".to_string(),
            email_sent_date: "2026-10-20".to_string(),
            source: "Gmail".to_string(),
            source_icon: "mail".to_string(),
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
        };

        let url = build_google_calendar_template_url(&assessment);

        assert!(url.contains("dates=20261101T090000/20261101T110000"));

        let unencoded_details = format!(
            "Course: MATH 101 — Calculus\nAssessment Type: Midterm Exam\nRoom: Room 101 (All Groups)\nInstructor: Prof. Rostova\n\nAI Study Plan: Solve past exams.\n"
        );
        let expected_details_encoded = crate::urlencoding::encode(&unencoded_details);
        assert!(url.contains(&format!("details={}", expected_details_encoded)));

        // Ensure optional sections are not present
        assert!(!unencoded_details.contains("What to Study:"));
        assert!(!unencoded_details.contains("Important Warnings:"));
        assert!(!unencoded_details.contains("Course Link:"));
    }

    #[test]
    fn test_build_google_calendar_template_url_special_characters() {
        let assessment = Assessment {
            id: "gcal-test-3".to_string(),
            course_id: "DATA & CS".to_string(),
            course_name: "Data Structures & Algorithms".to_string(),
            title: "Quiz #1: Trees & Graphs".to_string(),
            assessment_type: "Class Quiz".to_string(),
            date_iso: "2026-12-05".to_string(),
            day_name: "Saturday".to_string(),
            start_time: "08:30".to_string(),
            end_time: "10:00".to_string(),
            display_time: "Saturday, 5 December 2026".to_string(),
            room: "Lab B+C".to_string(),
            group: "Sec 1/2".to_string(),
            instructor: "Dr. A&B".to_string(),
            is_upcoming: true,
            days_until: 15,
            urgency_level: "upcoming".to_string(),
            priority_score: 50,
            topics: vec!["Binary Search Trees & AVL".to_string()],
            warnings: vec!["No phones & no smartwatch!".to_string()],
            ai_inference_note: "".to_string(),
            ai_study_plan: "Review slides 100%!".to_string(),
            estimated_study_hours: 2.0,
            elearning_url: "https://e-learning.univ.edu/course/view.php?id=99&section=2"
                .to_string(),
            google_cal_url: "".to_string(),
            gcal_synced: false,
            gcal_event_id: None,
            color: "#0f9d58".to_string(),
            bg: "#dcfce7".to_string(),
            border: "#15803d".to_string(),
            semester: "Fall 2026".to_string(),
            email_subject: "Quiz".to_string(),
            email_sent_date: "2026-11-20".to_string(),
            source: "Gmail".to_string(),
            source_icon: "mail".to_string(),
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
        };

        let url = build_google_calendar_template_url(&assessment);

        // Check that special characters like '&', '#', '+', '%' are percent encoded in text/location/details
        let expected_title_encoded =
            crate::urlencoding::encode("[DATA & CS] Quiz #1: Trees & Graphs (Class Quiz)");
        assert!(url.contains(&format!("text={}", expected_title_encoded)));

        let expected_location_encoded =
            crate::urlencoding::encode("University Campus - Room Lab B+C");
        assert!(url.contains(&format!("location={}", expected_location_encoded)));
    }
}
