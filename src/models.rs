use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Course {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub bg: String,
    #[serde(default)]
    pub border: String,
}

fn default_slot_type() -> String {
    "Lecture".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleSlot {
    #[serde(default)]
    pub id: String,
    pub day: String,
    #[serde(default)]
    pub day_index: u8,
    pub course_id: String,
    #[serde(default)]
    pub course_name: String,
    #[serde(default)]
    pub room: String,
    #[serde(rename = "type", default = "default_slot_type")]
    pub slot_type: String,
    #[serde(default)]
    pub group: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub display_time: String,
    #[serde(default)]
    pub has_quiz: bool,
    #[serde(default)]
    pub quiz_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleData {
    pub semester: String,
    pub courses: Vec<Course>,
    pub slots: Vec<ScheduleSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DiscoveredAcademicData {
    #[serde(default)]
    pub semester: Option<String>,
    #[serde(default)]
    pub university_or_institution: Option<String>,
    #[serde(default)]
    pub student_name: Option<String>,
    #[serde(default)]
    pub student_email: Option<String>,
    #[serde(default)]
    pub courses: Vec<Course>,
    #[serde(default)]
    pub assessments: Vec<Assessment>,
    #[serde(default)]
    pub slots: Vec<ScheduleSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedEmail {
    pub id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    #[serde(default)]
    pub snippet: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assessment {
    pub id: String,
    pub course_id: String,
    pub course_name: String,
    pub title: String,
    pub assessment_type: String, // "Class Quiz", "Online Quiz", "Midterm Exam", "Final Exam", "Lab Assessment", "Assignment"
    pub date_iso: String,        // "YYYY-MM-DD"
    pub day_name: String,        // "Sunday", "Monday", ...
    pub start_time: String,      // "HH:MM"
    pub end_time: String,        // "HH:MM"
    pub display_time: String,
    pub room: String,
    pub group: String,
    pub instructor: String,
    pub is_upcoming: bool,
    pub days_until: i64,
    pub urgency_level: String, // "critical", "high", "medium", "upcoming", "past"
    pub priority_score: u32,   // 0..=100
    pub topics: Vec<String>,
    pub warnings: Vec<String>,
    pub ai_inference_note: String,
    pub ai_study_plan: String,
    pub estimated_study_hours: f32,
    pub elearning_url: String,
    pub google_cal_url: String,
    pub gcal_synced: bool,
    #[serde(default)]
    pub gcal_event_id: Option<String>,
    pub color: String,
    pub bg: String,
    pub border: String,
    pub semester: String,
    pub email_subject: String,
    pub email_sent_date: String,
    #[serde(default = "default_source")]
    pub source: String, // "Gmail", "Moodle", "Microsoft Teams", "Microsoft Outlook", "Google Classroom"
    #[serde(default = "default_source_icon")]
    pub source_icon: String, // "mail", "graduation-cap", "users", "book-open"
    #[serde(default)]
    pub weightage_percent: Option<f32>,
    #[serde(default)]
    pub achieved_score: Option<f32>,
    #[serde(default)]
    pub max_score: Option<f32>,
    #[serde(default)]
    pub conflict_warning: Option<String>,
}

fn default_source() -> String {
    "Gmail".to_string()
}

fn default_source_icon() -> String {
    "mail".to_string()
}

fn contains_ascii_case_insensitive(haystack: &str, needle: &str) -> bool {
    let needle = needle.as_bytes();
    needle.is_empty()
        || haystack
            .as_bytes()
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
}

impl Assessment {
    pub fn is_teams(&self) -> bool {
        self.id.starts_with("teams-")
            || contains_ascii_case_insensitive(&self.source, "teams")
            || contains_ascii_case_insensitive(&self.source, "microsoft")
    }

    pub fn is_moodle(&self) -> bool {
        self.id.starts_with("moodle-") || contains_ascii_case_insensitive(&self.source, "moodle")
    }

    pub fn is_classroom(&self) -> bool {
        self.id.starts_with("classroom-")
            || contains_ascii_case_insensitive(&self.source, "classroom")
    }

    pub fn is_source_enabled(&self, config: &AppConfig) -> bool {
        if self.is_teams() && !config.teams_enabled {
            return false;
        }
        if self.is_moodle() && !config.moodle_enabled {
            return false;
        }
        if self.is_classroom() && !config.classroom_enabled {
            return false;
        }
        true
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomCalendarEvent {
    pub id: String,
    pub title: String,
    pub course_id: String,
    pub event_type: String, // "Study Session", "Custom Quiz", "Midterm Prep", "Assignment"
    pub date_iso: String,
    pub start_time: String,
    pub end_time: String,
    pub room: String,
    pub notes: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssessmentGrade {
    pub achieved_score: f32,
    pub max_score: f32,
    pub weightage_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GradeOverallSummary {
    pub completed_assessments_count: usize,
    pub total_weight_percent: f32,
    pub weighted_average_percent: f32,
    pub letter_standing: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictAlert {
    pub assessment_id_a: String,
    pub assessment_id_b: String,
    pub course_a: String,
    pub course_b: String,
    pub date_a: String,
    pub date_b: String,
    pub gap_hours: i64,
    pub severity: String, // "critical" (< 24h) or "warning" (24..=36h)
    pub message: String,
    #[serde(default)]
    pub is_mitigated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PracticeQuestion {
    pub id: String,
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PracticeQuizPayload {
    pub assessment_id: String,
    pub course_id: String,
    pub assessment_title: String,
    pub questions: Vec<PracticeQuestion>,
    pub generated_by_ai: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub onboarding_completed: bool,
    pub auto_sync_gcal: bool,
    pub sync_weekly_classes_to_gcal: bool,
    pub gemini_enabled: bool,
    #[serde(default)]
    pub gemini_api_key: Option<String>,
    #[serde(default)]
    pub user_email: Option<String>,
    #[serde(default)]
    pub user_name: Option<String>,
    #[serde(default)]
    pub user_picture: Option<String>,
    #[serde(default)]
    pub last_gmail_sync: Option<String>,
    #[serde(default)]
    pub last_gcal_sync: Option<String>,
    #[serde(default)]
    pub completed_topics: HashMap<String, bool>,
    #[serde(default)]
    pub synced_gcal_map: HashMap<String, String>, // quiz_id -> google_calendar_event_id
    #[serde(default)]
    pub custom_events: Vec<CustomCalendarEvent>,

    // Academic Multi-Source Integrations
    #[serde(default)]
    pub moodle_enabled: bool,
    #[serde(default)]
    pub moodle_url: Option<String>,
    #[serde(default)]
    pub moodle_token: Option<String>,
    #[serde(default)]
    pub moodle_ical_url: Option<String>,

    #[serde(default)]
    pub teams_enabled: bool,
    #[serde(default)]
    pub teams_client_id: Option<String>,
    #[serde(default)]
    pub teams_token: Option<String>,
    #[serde(default)]
    pub teams_account_name: Option<String>,
    #[serde(default)]
    pub teams_account_email: Option<String>,

    #[serde(default)]
    pub classroom_enabled: bool,

    // Grade Tracking
    #[serde(default)]
    pub grades: HashMap<String, AssessmentGrade>,
    #[serde(default)]
    pub dismiss_conflict_banner: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            onboarding_completed: false,
            auto_sync_gcal: true,
            sync_weekly_classes_to_gcal: false,
            // Honest default: the optional Gemini AI layer is disabled until the
            // student actually supplies a key; heuristics still work without it.
            gemini_enabled: false,
            gemini_api_key: None,
            user_email: None,
            user_name: None,
            user_picture: None,
            last_gmail_sync: None,
            last_gcal_sync: None,
            completed_topics: HashMap::new(),
            synced_gcal_map: HashMap::new(),
            custom_events: Vec::new(),
            moodle_enabled: false,
            moodle_url: None,
            moodle_token: None,
            moodle_ical_url: None,
            teams_enabled: false,
            teams_client_id: None,
            teams_token: None,
            teams_account_name: None,
            teams_account_email: None,
            classroom_enabled: false,
            grades: HashMap::new(),
            dismiss_conflict_banner: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardSummary {
    pub reference_date: String,
    pub next_up: Option<Assessment>,
    pub upcoming_this_week: Vec<Assessment>,
    pub all_upcoming: Vec<Assessment>,
    pub exam_type_counts: HashMap<String, usize>,
    pub study_recommendations: Vec<StudyRecommendation>,
    pub total_topics_count: usize,
    pub completed_topics_count: usize,
    pub readiness_percent: u32,
    #[serde(default)]
    pub conflict_alerts: Vec<ConflictAlert>,
    #[serde(default)]
    pub sources_count: HashMap<String, usize>,
    #[serde(default)]
    pub grade_stats: Option<GradeOverallSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyRecommendation {
    pub assessment_id: String,
    pub course_id: String,
    pub course_name: String,
    pub title: String,
    pub assessment_type: String,
    pub date_iso: String,
    pub display_time: String,
    pub days_until: i64,
    pub urgency_badge: String,
    pub priority_score: u32,
    pub why_study_now: String,
    pub ai_study_plan: String,
    pub topics: Vec<TopicCheckItem>,
    pub warnings: Vec<String>,
    pub color: String,
    pub progress_percent: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicCheckItem {
    pub key: String,
    pub topic: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStudyTask {
    pub id: String,
    pub key: String,
    pub assessment_id: String,
    pub course_id: String,
    pub course_name: String,
    pub assessment_title: String,
    pub assessment_type: String,
    pub topic: String,
    pub day_offset: i32,
    pub target_date_iso: String,
    pub display_day: String,
    pub priority_rank: u32,
    pub urgency: String,
    pub estimated_hours: f32,
    pub ai_reasoning: String,
    pub completed: bool,
    pub color: String,
    pub days_until_assessment: i64,
    pub assessment_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStudyDayGroup {
    pub day_offset: i32,
    pub date_iso: String,
    pub display_day: String,
    pub is_today: bool,
    pub total_estimated_hours: f32,
    pub tasks: Vec<DailyStudyTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExamReadinessCard {
    pub assessment_id: String,
    pub course_id: String,
    pub course_name: String,
    pub title: String,
    pub assessment_type: String,
    pub date_iso: String,
    pub display_date: String,
    pub days_until: i64,
    pub readiness_percent: u32,
    pub completed_count: usize,
    pub total_count: usize,
    pub priority_score: u32,
    pub color: String,
    pub recommended_focus: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyTasksPayload {
    pub days: Vec<DailyStudyDayGroup>,
    pub readiness_cards: Vec<ExamReadinessCard>,
    pub total_tasks: usize,
    pub pending_tasks: usize,
    pub completed_tasks: usize,
    pub total_hours: f32,
    pub ai_generated: bool,
}
