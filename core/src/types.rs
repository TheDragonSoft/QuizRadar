//! Domain types shared by parsers, planner, store and every UI shell.
//!
//! Single serde truth for API payloads; field names and semantics mirror the
//! v4 data model (`docs/rebuild/02-current-architecture.md` §3) so the v4
//! backup importer stays byte-compatible. Display strings are produced here,
//! never formatted by the UI (`04` §4.1 rules).

use serde::{Deserialize, Serialize};

/// Enrolled course (`02` §3.1). The `id` is the unique key (course code, e.g.
/// `"CSE241"`) — renaming a course must keep its id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Course {
    /// Unique course code, e.g. `CSE241`.
    pub id: String,
    /// Human-readable course title.
    pub name: String,
    /// Accent hex color (`#rrggbb`), chosen from the 8-preset palette.
    pub color: String,
    /// Pre-computed translucent background (`#rrggbbaa`/`rgba(...)`); `None`
    /// ⇒ derived from `color` at render time, never a default hall string.
    pub bg: Option<String>,
    /// Pre-computed translucent border color.
    pub border: Option<String>,
}

/// Weekly recurring class slot (`02` §3.1 `"day": "Sun", "day_index": 0`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScheduleSlot {
    /// Stable slot id (`slot-1`…).
    pub id: String,
    /// Day name as stored by v4 (`"Sun"`, `"Mon"`, …).
    pub day: String,
    /// 0–6, Sunday-first (v4 week layout).
    pub day_index: u8,
    pub course_id: String,
    pub course_name: String,
    /// `Lecture` / `Tutorial` / `Lab` (serialized as v4's `type` field).
    #[serde(rename = "type")]
    pub slot_type: String,
    /// Section/group, e.g. `"Sec 1"`.
    pub group: Option<String>,
    /// Room if known; `None` renders "—" (honesty doctrine: never a default
    /// room string).
    #[serde(default)]
    pub room: Option<String>,
    /// Start time `HH:MM`.
    pub start_time: String,
    /// End time `HH:MM`.
    pub end_time: String,
    /// Pre-formatted display string (`08:00–10:30`, en dash) produced by core.
    pub display_time: String,
    #[serde(default)]
    pub has_quiz: bool,
    #[serde(default)]
    pub quiz_title: Option<String>,
}

/// Assessment type ladder (`01` §3). Default classification: [`AssessmentType::ClassQuiz`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssessmentType {
    #[serde(rename = "Class Quiz")]
    ClassQuiz,
    #[serde(rename = "Online Quiz")]
    OnlineQuiz,
    #[serde(rename = "Midterm Exam")]
    MidtermExam,
    #[serde(rename = "Final Exam")]
    FinalExam,
    #[serde(rename = "Lab Assessment")]
    LabAssessment,
    #[serde(rename = "Assignment")]
    Assignment,
}

impl AssessmentType {
    /// The exact label the UI must display (core owns display strings).
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ClassQuiz => "Class Quiz",
            Self::OnlineQuiz => "Online Quiz",
            Self::MidtermExam => "Midterm Exam",
            Self::FinalExam => "Final Exam",
            Self::LabAssessment => "Lab Assessment",
            Self::Assignment => "Assignment",
        }
    }
}

/// Urgency ladder (`01` §3): critical ≤2d, high ≤5d, medium ≤14d, upcoming,
/// past. Serialized lower-case to match v4 (`"critical"`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UrgencyLevel {
    #[serde(rename = "critical")]
    Critical,
    #[serde(rename = "high")]
    High,
    #[serde(rename = "medium")]
    Medium,
    #[serde(rename = "upcoming")]
    Upcoming,
    #[serde(rename = "past")]
    Past,
}

/// The radar item (`02` §3.3): a quiz/exam/assignment resolved from a source
/// announcement plus the student's own timetable. Any field the sources did
/// not establish stays `None` — the UI renders "—", estimates stay labeled
/// through `ai_inference_note`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assessment {
    /// Stable id; source-prefixed (`teams-…`, `moodle-…`, `classroom-…`,
    /// `feed-…`, `custom-…`) — source gating keys off these prefixes.
    pub id: String,
    pub course_id: String,
    pub course_name: String,
    pub title: String,
    pub assessment_type: AssessmentType,
    /// Explicit date `YYYY-MM-DD` (never silently invented).
    pub date_iso: String,
    /// Localized day name for `date_iso`, produced by core.
    pub day_name: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    /// Pre-formatted time range/display string.
    pub display_time: Option<String>,
    /// Room if known; `None` renders "—".
    pub room: Option<String>,
    pub group: Option<String>,
    pub instructor: Option<String>,
    pub is_upcoming: bool,
    /// Negative when past; used by badges (TODAY/TOMORROW/IN N DAYS).
    pub days_until: Option<i32>,
    pub urgency_level: UrgencyLevel,
    /// 0..=100 composite (capped), drives "What Should I Study?" ordering.
    pub priority_score: u8,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    /// Honesty note: which heuristic/AI call produced inferred fields.
    pub ai_inference_note: Option<String>,
    pub ai_study_plan: Option<String>,
    pub estimated_study_hours: Option<f32>,
    /// e-learning portal link extracted from the source, if any.
    pub elearning_url: Option<String>,
    /// Google Calendar template URL (or pushed event link) if set.
    pub google_cal_url: Option<String>,
    #[serde(default)]
    pub gcal_synced: bool,
    #[serde(default)]
    pub gcal_event_id: Option<String>,
    pub color: Option<String>,
    pub bg: Option<String>,
    pub border: Option<String>,
    pub semester: Option<String>,
    pub email_subject: Option<String>,
    /// Source email date `YYYY-MM-DD`.
    pub email_sent_date: Option<String>,
    /// `Gmail` / `Moodle` / `Microsoft Teams` / `Microsoft Outlook` /
    /// `Google Classroom` / `Custom` / user-facing feed label.
    pub source: String,
    pub source_icon: Option<String>,
    pub weightage_percent: Option<f64>,
    pub achieved_score: Option<f64>,
    pub max_score: Option<f64>,
    /// Conflict-chain description when a neighboring assessment lands within
    /// 48h — `None` when clean (set by the planner, phase 03).
    pub conflict_warning: Option<String>,
}

/// User-created calendar entry (`02` §3.2 `custom_events[]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomEvent {
    pub id: String,
    pub title: String,
    pub course_id: Option<String>,
    pub event_type: Option<String>,
    /// `YYYY-MM-DD`.
    pub date_iso: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub room: Option<String>,
    pub notes: Option<String>,
    /// Custom event pink `#db2777` by default (`01` §6).
    pub color: Option<String>,
}

/// User-subscribed .ics feed (`01` §4.2). Https-only and ≤10 enforced by the
/// sources module, not by this type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IcsFeed {
    /// `feed-<unix_ms>`; feed items bypass source toggles once synced.
    pub id: String,
    pub name: String,
    /// Https URL (token-bearing allowed by design).
    pub url: String,
    pub enabled: bool,
}
