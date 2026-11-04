//! Domain types shared by parsers, planner, store and every UI shell.
//!
//! Single serde truth for API payloads; field names and semantics mirror the
//! v4 data model (`docs/rebuild/02-current-architecture.md` §3) so the v4
//! backup importer stays compatible. Display strings are produced in the core
//! (`parse::util`), never formatted by the UI (`04` §4.1 rules).
//!
//! Honesty doctrine encoded at the type level: every piece of data nobody
//! actually established stays `None` (date, room, instructor, palette…) and
//! renders as "—" downstream. Nothing defaults itself into existence.

use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Serde adapter: `Option<NaiveDate>` ⇄ `"YYYY-MM-DD"` | `null` (v4 field
/// `date_iso`). An empty/whitespace string deserializes to `None`, never to a
/// fabricated date. Shared by the assessment, planner payloads, schedule and
/// custom events (`plan::` ) so every wire shape stays identical.
pub mod iso_date {
    use super::{Deserialize, Deserializer, NaiveDate, Serializer};

    pub fn serialize<S: Serializer>(
        value: &Option<NaiveDate>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(date) => serializer.serialize_str(&date.format("%Y-%m-%d").to_string()),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<NaiveDate>, D::Error> {
        let raw: Option<String> = Option::deserialize(deserializer)?;
        match raw.map(|s| s.trim().to_string()) {
            None => Ok(None),
            Some(s) if s.is_empty() => Ok(None),
            Some(s) => NaiveDate::parse_from_str(&s, "%Y-%m-%d")
                .map(Some)
                .map_err(serde::de::Error::custom),
        }
    }
}

/// Serde adapter: `Option<NaiveTime>` ⇄ `"HH:MM"` | `null` (v4 keeps `HH:MM`
/// without seconds; seconds inside incoming values are truncated). `pub` so
/// the AI draft types (`ai::tasks`) reuse the exact same wire shape.
pub mod hm_time {
    use super::{Deserialize, Deserializer, NaiveTime, Serializer};

    pub fn serialize<S: Serializer>(
        value: &Option<NaiveTime>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(time) => serializer.serialize_str(&time.format("%H:%M").to_string()),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<NaiveTime>, D::Error> {
        let raw: Option<String> = Deserialize::deserialize(deserializer)?;
        let Some(text) = raw else {
            return Ok(None);
        };
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }
        match NaiveTime::parse_from_str(text, "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(text, "%H:%M:%S"))
        {
            Ok(time) => Ok(Some(time)),
            Err(error) => Err(serde::de::Error::custom(error)),
        }
    }
}

/// Serde adapter: required `NaiveDate` ⇄ `"YYYY-MM-DD"` (planner/derived
/// payloads always carry concrete dates — no `null` exists there).
pub mod iso_date_req {
    use super::{NaiveDate, Serializer};

    pub fn serialize<S: Serializer>(value: &NaiveDate, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.format("%Y-%m-%d").to_string())
    }

    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<NaiveDate, D::Error> {
        let raw: String = serde::Deserialize::deserialize(deserializer)?;
        let text = raw.trim();
        if text.is_empty() {
            return Err(serde::de::Error::custom(
                "empty date string — no fabricated dates",
            ));
        }
        NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(serde::de::Error::custom)
    }
}

/// Serde adapter: required `NaiveTime` ⇄ `"HH:MM"` (timetable slots always
/// carry concrete times; incoming seconds are tolerated and truncated).
mod hm_time_req {
    use super::{Deserialize, Deserializer, NaiveTime, Serializer};

    pub fn serialize<S: Serializer>(value: &NaiveTime, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.format("%H:%M").to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<NaiveTime, D::Error> {
        let raw: String = Deserialize::deserialize(deserializer)?;
        let text = raw.trim();
        match NaiveTime::parse_from_str(text, "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(text, "%H:%M:%S"))
        {
            Ok(time) => Ok(time),
            Err(error) => Err(serde::de::Error::custom(error)),
        }
    }
}

/// A v4-shaped announcement email as cached from a source before parsing
/// (`02` §3.4 `quiz_emails_cache.json`). The parser takes these in and is
/// responsible for the honesty of everything it derives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CachedEmail {
    pub id: String,
    pub subject: String,
    pub from: String,
    /// Raw RFC-ish date header (`"Sat, 10 Oct 2026 09:00:00 +0000"`).
    pub date: String,
    #[serde(default)]
    pub snippet: Option<String>,
    /// Body in plain text or HTML (HTML is sanitized before parsing).
    pub body: String,
    /// Honesty flag (`03` §C3 fix): `true` when the fetcher capped the body
    /// (at [`crate::sources::gmail::MAX_BODY_CHARS`] for Gmail) and content
    /// was dropped — consumers (AI extraction, manual review) must know the
    /// text is incomplete instead of trusting a silently shortened body.
    #[serde(default)]
    pub body_truncated: bool,
}

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
    /// Pre-computed translucent background (`#rrggbbaa`/`rgba(...)`). `None`
    /// ⇒ derived from `color` at render time, never defaulted.
    #[serde(default)]
    pub bg: Option<String>,
    /// Pre-computed translucent border color.
    #[serde(default)]
    pub border: Option<String>,
}

/// Weekly recurring class slot (`02` §3.1 `"day": "Sun", "day_index": 0`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScheduleSlot {
    /// Stable slot id (`slot-1`…).
    pub id: String,
    /// Day name as stored by v4 (`"Sun"`, `"Mon"`, …).
    pub day: String,
    /// 0–6, Sunday-first (v4 week layout). Imports may omit it; the store
    /// normalizes it from `day` when missing.
    #[serde(default)]
    pub day_index: u8,
    pub course_id: String,
    pub course_name: String,
    /// `Lecture` / `Tutorial` / `Lab` (serialized as v4's `type` field).
    /// Imports arrive with v4's default (`"Lecture"`, `02` §3.1).
    #[serde(rename = "type", default = "default_slot_type")]
    pub slot_type: String,
    /// Section/group, e.g. `"Sec 1"`. `None` passes through as "unknown".
    #[serde(default)]
    pub group: Option<String>,
    /// Room if known; `None` renders "—" (never a default hall string).
    #[serde(default)]
    pub room: Option<String>,
    /// Start time `HH:MM`.
    #[serde(with = "hm_time_req")]
    pub start_time: NaiveTime,
    /// End time `HH:MM`.
    #[serde(with = "hm_time_req")]
    pub end_time: NaiveTime,
    /// Pre-formatted display (`08:00–10:30`, en dash) produced by the core.
    pub display_time: String,
    #[serde(default)]
    pub has_quiz: bool,
    #[serde(default)]
    pub quiz_title: Option<String>,
}

/// The semester's timetable (`02` §3.1). `semester` is whatever the user (or
/// an extraction) actually wrote — nothing invents a label here.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ScheduleData {
    #[serde(default)]
    pub semester: Option<String>,
    #[serde(default)]
    pub courses: Vec<Course>,
    #[serde(default)]
    pub slots: Vec<ScheduleSlot>,
}

impl ScheduleData {
    /// First enrolled course whose id equals `code` (ASCII-case-insensitive).
    #[must_use]
    pub fn find_course(&self, code: &str) -> Option<&Course> {
        self.courses
            .iter()
            .find(|c| c.id.eq_ignore_ascii_case(code.trim()))
    }
}

/// Assessment type ladder (`01` §3). Default classification: [`AssessmentType::ClassQuiz`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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

    /// Import-time type normalization (`02` §3.3): the exact v4 ladder labels
    /// map to themselves; fuzzy labels (`"Assessment"`, `"Quiz 3"`, …) map by
    /// keyword into the closest v5 rung. The importer attaches an honest
    /// warning when the match is fuzzy, so the inference is always labeled —
    /// never silently imposed.
    #[must_use]
    pub fn from_import_label(label: &str) -> (Self, bool) {
        let lowered = label.trim().to_ascii_lowercase();
        let exact = match lowered.as_str() {
            "class quiz" => Some(Self::ClassQuiz),
            "online quiz" => Some(Self::OnlineQuiz),
            "midterm exam" => Some(Self::MidtermExam),
            "final exam" => Some(Self::FinalExam),
            "lab assessment" => Some(Self::LabAssessment),
            "assignment" => Some(Self::Assignment),
            _ => None,
        };
        if let Some(exact) = exact {
            return (exact, false);
        }
        // Fuzzy keyword ladder, checked most specific first.
        let fuzzy = if lowered.contains("final") {
            Self::FinalExam
        } else if lowered.contains("midterm") {
            Self::MidtermExam
        } else if lowered.contains("online") {
            Self::OnlineQuiz
        } else if lowered.contains("lab") {
            Self::LabAssessment
        } else if lowered.contains("assignment") {
            Self::Assignment
        } else {
            // The v4 ladder's default rung; importer labels this one.
            Self::ClassQuiz
        };
        (fuzzy, true)
    }
}

impl<'de> Deserialize<'de> for AssessmentType {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self::from_import_label(&String::deserialize(deserializer)?).0)
    }
}

/// Urgency ladder (`01` §3): critical ≤2d, high ≤5d, medium ≤14d, upcoming,
/// past. Serialized lower-case to match v4 (`"critical"`, …) — the store also
/// writes lower-case labels, so the derived PascalCase wire shape was a
/// second, drifting encoding of the same field. Imports carry v4's own
/// stamped values; unknown labels fall back to [`UrgencyLevel::Upcoming`]
/// (urgency is recomputed from the stored date at every render anyway).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UrgencyLevel {
    Critical,
    High,
    Medium,
    #[default]
    Upcoming,
    Past,
}

fn default_true() -> bool {
    true
}

impl<'de> Deserialize<'de> for UrgencyLevel {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match String::deserialize(deserializer)?
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "critical" => Ok(Self::Critical),
            "high" => Ok(Self::High),
            "medium" => Ok(Self::Medium),
            "past" => Ok(Self::Past),
            // "upcoming" and anything the importer cannot vouch for.
            _ => Ok(Self::Upcoming),
        }
    }
}

/// The v4 default slot classification (`02` §3.1 `type` field); old exports
/// may omit it entirely.
fn default_slot_type() -> String {
    "Lecture".to_string()
}

/// The academic-rhythm preset the user picks in onboarding (`01` §4.1
/// "track/rhythm chips"). It is a declared study-cadence preference, not a
/// fact about the data: it parameterizes how many days before each exam the
/// deterministic planner spreads preparation across —
/// [`Med`](AcademicTrack::Med) starts earlier (continuous assessment
/// rhythm), [`Biz`](AcademicTrack::Biz) concentrates near the exam
/// (midterm/milestone rhythm), [`Eng`](AcademicTrack::Eng) is the shipped
/// default. Anything unreadable falls back to Eng so an unconfigured or
/// legacy value can never break derivation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AcademicTrack {
    Med,
    #[default]
    Eng,
    Biz,
}

impl AcademicTrack {
    /// Config-string parser (`academic_track` in `config_kv`: `med`/`eng`/
    /// `biz`). Unknown or empty → Eng.
    #[must_use]
    pub fn from_config(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("med") => Self::Med,
            Some("biz") => Self::Biz,
            _ => Self::Eng,
        }
    }

    /// The wire/config string.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Med => "med",
            Self::Eng => "eng",
            Self::Biz => "biz",
        }
    }

    /// How many days before an exam the roadmap spreads prep over (the
    /// deterministic planner's `MAX_PREP_DAYS` per rhythm). Disclosed in the
    /// onboarding/settings copy so the choice has an honest, visible effect.
    #[must_use]
    pub fn max_prep_days(self) -> i32 {
        match self {
            Self::Med => 7,
            Self::Eng => 5,
            Self::Biz => 3,
        }
    }
}

/// Where an assessment came from (`02` §3.3 `source`). Serialized as the
/// plain user-facing label string — exactly v4's wire shape — so backup files
/// round-trip both ways. Unknown labels (v4 wrote the user's own feed label)
/// deserializes into [`AssessmentSource::Feed`]; nothing fails import there.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AssessmentSource {
    /// v4's default source (`02` §3.3 `default_source`).
    #[default]
    Gmail,
    Moodle,
    MicrosoftTeams,
    MicrosoftOutlook,
    GoogleClassroom,
    Custom,
    /// A subscribed .ics feed; carries the feed's user label as written by
    /// v4 (`a.source = feed.name`). Never mapped/renamed — the label is data.
    Feed(String),
}

impl Serialize for AssessmentSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for AssessmentSource {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let label = String::deserialize(deserializer)?;
        Ok(Self::from_label(&label))
    }
}

impl AssessmentSource {
    /// The v4 default (`02` §3.3 `default_source`) when a label is absent.
    #[must_use]
    pub fn gmail_default() -> Self {
        Self::Gmail
    }

    /// Label → variant: the exact v4 labels; anything else becomes the
    /// user's feed label (`02` §3.3: feed items carry the feed's own name).
    #[must_use]
    pub fn from_label(label: &str) -> Self {
        match label.trim() {
            "Gmail" => Self::Gmail,
            "Moodle" => Self::Moodle,
            "Microsoft Teams" => Self::MicrosoftTeams,
            "Microsoft Outlook" => Self::MicrosoftOutlook,
            "Google Classroom" => Self::GoogleClassroom,
            "Custom" => Self::Custom,
            other => Self::Feed(other.to_string()),
        }
    }

    /// Exact label the UI displays (matches v4 strings for importer checks).
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::Gmail => "Gmail",
            Self::Moodle => "Moodle",
            Self::MicrosoftTeams => "Microsoft Teams",
            Self::MicrosoftOutlook => "Microsoft Outlook",
            Self::GoogleClassroom => "Google Classroom",
            Self::Custom => "Custom",
            Self::Feed(name) => name,
        }
    }

    /// Icon for the source pill (lucide set, vendored).
    #[must_use]
    pub fn as_icon(&self) -> &'static str {
        match self {
            Self::Gmail | Self::MicrosoftOutlook => "mail",
            Self::Moodle => "graduation-cap",
            Self::MicrosoftTeams => "users",
            Self::GoogleClassroom => "school",
            Self::Custom => "calendar-plus",
            Self::Feed(_) => "calendar",
        }
    }

    /// v4 id-prefix convention (`<source>-…`; source gating keys off these).
    #[must_use]
    pub fn id_prefix(&self) -> &str {
        match self {
            Self::Gmail | Self::MicrosoftOutlook => "gmail-",
            Self::Moodle => "moodle-",
            Self::MicrosoftTeams => "teams-",
            Self::GoogleClassroom => "classroom-",
            Self::Custom | Self::Feed(_) => "custom-",
        }
    }

    /// The provenance key of this source: the identity a source run reports
    /// under.
    ///
    /// A generic feed carries the user's own label, so EVERY feed is its own
    /// source: one feed failing (or being deleted) must never retire another
    /// feed's announcements. The key is trimmed and lowercased, so the same
    /// feed is recognised across scans and across tiers.
    #[must_use]
    pub fn provenance_key(&self) -> String {
        match self {
            Self::Feed(label) => format!("feed:{}", label.trim().to_ascii_lowercase()),
            other => other.as_str().trim().to_ascii_lowercase(),
        }
    }
}

/// The radar item (`02` §3.3): a quiz/exam/assignment resolved from a source
/// announcement plus the student's own timetable. Any field the sources did
/// not establish stays `None` — the UI renders "—"; heuristic estimates stay
/// labeled through `ai_inference_note`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assessment {
    /// Stable id; source-prefixed (`teams-…`, `moodle-…`, `feed-…`).
    pub id: String,
    /// Course code when the announcement carried one (`None` renders
    /// "General" only at display time — never a fabricated "GENERAL" id).
    #[serde(default)]
    pub course_id: Option<String>,
    /// Enrolled course title if the course is in the user's schedule.
    #[serde(default)]
    pub course_name: Option<String>,
    pub title: String,
    pub assessment_type: AssessmentType,
    /// Explicit/estimated date `YYYY-MM-DD`. `None` = no verifiable date —
    /// the assessment is a draft "needs manual confirmation", never a
    /// silently invented date.
    #[serde(rename = "date_iso", with = "iso_date", default)]
    pub date: Option<NaiveDate>,
    /// Weekday of `date`, produced by the core.
    #[serde(default)]
    pub day_name: Option<String>,
    #[serde(with = "hm_time", default)]
    pub start_time: Option<NaiveTime>,
    #[serde(with = "hm_time", default)]
    pub end_time: Option<NaiveTime>,
    /// Pre-formatted display (`Sunday, 18 October 2026 (9:00 AM – 10:30 AM)`).
    #[serde(default)]
    pub display_time: Option<String>,
    /// Room if known (`None` renders "—" — never a default hall string).
    #[serde(default)]
    pub room: Option<String>,
    /// Group/section as announced or as on the slot (no "All Groups"
    /// fabrication).
    #[serde(default)]
    pub group: Option<String>,
    /// Sender display name; `None` when the announcement has no usable name.
    #[serde(default)]
    pub instructor: Option<String>,
    /// Dateless items count as upcoming (radar placeholder until a date is
    /// confirmed); past items are false.
    #[serde(default = "default_true")]
    pub is_upcoming: bool,
    /// Days until the (known) date; `None` when undated — no countdown is
    /// invented.
    #[serde(default)]
    pub days_until: Option<i32>,
    #[serde(default)]
    pub urgency_level: UrgencyLevel,
    /// 0..=100 composite (capped), drives "What Should I Study?" ordering.
    #[serde(default)]
    pub priority_score: u8,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    /// Honesty note: what the pipeline inferred (heuristic vs explicit) and
    /// why; `None` only for fully user-created items that need no explanation.
    #[serde(default)]
    pub ai_inference_note: Option<String>,
    #[serde(default)]
    pub ai_study_plan: Option<String>,
    /// Heuristic estimate, labeled as such in `ai_study_plan`.
    #[serde(default)]
    pub estimated_study_hours: Option<f32>,
    /// Course/LMS link extracted from the source, if any.
    #[serde(default)]
    pub elearning_url: Option<String>,
    /// Google Calendar template URL (or pushed event link) if set (phase 06).
    #[serde(default)]
    pub google_cal_url: Option<String>,
    #[serde(default)]
    pub gcal_synced: bool,
    #[serde(default)]
    pub gcal_event_id: Option<String>,
    /// Palette taken from the enrolled course only; `None` (neutral) when the
    /// course is not enrolled — no default demo palettes.
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub bg: Option<String>,
    #[serde(default)]
    pub border: Option<String>,
    /// Semester label inferred from the date itself (`Fall 2026` …).
    #[serde(default)]
    pub semester: Option<String>,
    #[serde(default)]
    pub email_subject: Option<String>,
    /// Source announcement date `YYYY-MM-DD` (`None` for calendar feeds).
    #[serde(default)]
    pub email_sent_date: Option<String>,
    #[serde(default = "default_assessment_source")]
    pub source: AssessmentSource,
    #[serde(default)]
    pub source_icon: Option<String>,
    #[serde(default)]
    pub weightage_percent: Option<f64>,
    #[serde(default)]
    pub achieved_score: Option<f64>,
    #[serde(default)]
    pub max_score: Option<f64>,
    /// Conflict-chain description when a neighboring assessment lands within
    /// 48h — `None` when clean (set by the planner, phase 03).
    #[serde(default)]
    pub conflict_warning: Option<String>,
    /// The source run that last reported this item, e.g.
    /// `"gmail-2026-11-01T09:12:00Z"`.
    ///
    /// This is PROVENANCE: it answers "which scan last saw this
    /// announcement?". `None` means no source run has ever reported the item
    /// (it came from an import, or from before provenance existed) — such an
    /// item is never retired by a scan, because a scan cannot honestly claim
    /// that an item it never saw has vanished.
    #[serde(default)]
    pub last_seen_source_run: Option<String>,
    /// The source run in which the announcing source stopped reporting this
    /// item (the announcement was cancelled or edited upstream).
    ///
    /// A retired item stays in the store WITH this reason — it is not
    /// silently deleted — but it is no longer upcoming: it leaves the radar,
    /// the study plan and the conflict checks, because there is nothing left
    /// to prepare for.
    #[serde(default)]
    pub retired_source_run: Option<String>,
}

/// The v4 default authorship of an assessment with no `source` field
/// (`02` §3.3): everything v4 parsed before the multi-source era was Gmail.
fn default_assessment_source() -> AssessmentSource {
    AssessmentSource::gmail_default()
}

/// One recorded grade (`02` §3.2 `grades` map values). Every member is
/// optional — the store keeps exactly what the user (or importer) provided;
/// nothing grades itself. Explicit `null` clears the field.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct GradeRecord {
    #[serde(default)]
    pub achieved_score: Option<f64>,
    #[serde(default)]
    pub max_score: Option<f64>,
    #[serde(default)]
    pub weightage_percent: Option<f64>,
}

impl GradeRecord {
    /// `true` when nothing has been recorded (an empty record is never
    /// stored — the repo deletes it instead, keeping the map honest).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

/// A subscribed .ics calendar feed subscription (`02` §3.2 `feeds[]`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeedConfig {
    /// Stable id, e.g. `"feed-<unix_millis>"` (assigned by the caller).
    pub id: String,
    /// User label (becomes each parsed item's `source`).
    pub name: String,
    /// https-only URL (`repo::validate_feed_url` enforces before persist).
    pub url: String,
    #[serde(default = "default_feed_enabled")]
    pub enabled: bool,
}

fn default_feed_enabled() -> bool {
    true
}

/// Topic-completion state (`02` §3.2 `completed_topics`): the single source
/// of truth for readiness, keyed `"{assessment_id}::{topic_index}"`.
pub type CompletedTopics = std::collections::HashMap<String, bool>;

/// A user-created calendar item (`02` §3.2 `custom_events[]`): custom
/// deadline, event, or a generated `study-block-{assessment_id}` prep block.
/// Everything except id/title is optional — nothing defaults itself into
/// existence; times are the only local-time domain in the app (`plan` docs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomCalendarEvent {
    /// Stable id. Auto-generated prep blocks use the `study-block-` prefix
    /// followed by the assessment id (conflict mitigation convention).
    pub id: String,
    pub title: String,
    /// Enrolled course the item belongs to (`None` = user-unclassified).
    #[serde(default)]
    pub course_id: Option<String>,
    /// Free label the user chose (`Custom Event`, `Study Session`, …).
    #[serde(default)]
    pub event_type: Option<String>,
    /// The user's picked date; `None` stays unschedulable (it parries no
    /// study-block candidate and never conflicts with assessments).
    #[serde(rename = "date_iso", with = "iso_date", default)]
    pub date: Option<NaiveDate>,
    /// Start `HH:MM` when the user set one; both times `None` = timed-until-
    /// user-fills (blocks all-day windows honestly).
    #[serde(with = "hm_time", default)]
    pub start_time: Option<NaiveTime>,
    #[serde(with = "hm_time", default)]
    pub end_time: Option<NaiveTime>,
    /// `None` renders "—" — never a default room string.
    #[serde(default)]
    pub room: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Palette the user picked (course-derived or chosen); `None` = neutral.
    #[serde(default)]
    pub color: Option<String>,
}
