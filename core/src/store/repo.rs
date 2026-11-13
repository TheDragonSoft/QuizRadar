//! Typed repositories over the [`super::db`] SQLite schema — the operations
//! desktop IPC, Kotlin bindings and the WASM tier all call, drafted from the
//! v4 route-table semantics (`02` §4) with v5 honesty welded in:
//!
//! - **GET-state shape** → [`read_snapshot`]/[`ops::load_state`]: one call
//!   returns every list plus the *derived* dashboard/tasks (`04` §4.4 item 5:
//!   shells never re-derive separately).
//! - **Grade partial-update** (`02` §4, mobile engine `app.js:1616-1680`):
//!   field-untouched vs explicit `null` (`FieldUpdate::Clear`) never coerces
//!   into a fabricated 0 score.
//! - **Feeds** (`02` §4 feeds API): https-only URLs with v4's honest wording
//!   (token-in-link exposure) and the ≤10 cap (`v4 feeds.rs::MAX_FEEDS`).
//! - **Reannouncement preserve list** (`02` §3/`parse::merge` docs):
//!   user-owned grade/`gcal_synced` fields survive scan replacement.
//!
//! Every mutating operation stamps `updated_at` provided by the caller —
//! the core owns no clock (`plan` mod docs); merge machinery in
//! [`super::backup`] compares these stamps.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use chrono::{NaiveDate, NaiveTime};
use rusqlite::{params, Connection, OptionalExtension};

use crate::plan;
use crate::types::{
    AcademicTrack, Assessment, AssessmentType, AttendanceEntry, AttendanceStatus, CachedEmail,
    CompletedTopics, Course, CourseAttendanceSummary, CourseFocusStat, CustomCalendarEvent,
    FeedConfig, Flashcard, GradeRecord, MistakeRecord, QuizAttempt, ScheduleData, ScheduleSlot,
    StudyAnalytics, StudySessionRecord, UrgencyLevel,
};

use super::db::{Db, StoreError};

/// Upper bound on subscribed feeds so one config can never turn a single
/// sync into an unbounded fan-out of HTTP requests (v4 parity).
pub const MAX_FEEDS: usize = 10;

/// The section of the v4 export the store still serves — a full topic-check
/// item exists only when the topic list did; an empty `topics` array has no
/// keys and must behave like 100% readiness at display time.
/// Topic-completion keys are content-addressed (`plan::dashboard`); the
/// desktop shell resolves `(assessment_id, topic index)` → text → key
/// through this so no shell ever re-implements the hash.
pub fn topic_key_for_text(assessment_id: &str, topic_text: &str) -> String {
    plan::dashboard::topic_key_for_text(assessment_id, topic_text)
}

// ---------------------------------------------------------------------------
// Grade field-update semantics
// ---------------------------------------------------------------------------

/// One grade field in a partial update. `Keep` (field absent on the wire)
/// leaves the stored value alone; `Clear` (explicit `null`) wipes it —
/// never a coerced 0 (`03` §C9: "explicit-null-clears semantics"); `Set`
/// validates and replaces.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum FieldUpdate<T> {
    #[default]
    Keep,
    Clear,
    Set(T),
}

impl<T> FieldUpdate<T> {
    /// `Set(x) → Some(x)`, `Clear → None`, `Keep → existing`.
    #[must_use]
    pub fn resolve(self, existing: Option<T>) -> Option<T> {
        match self {
            Self::Keep => existing,
            Self::Clear => None,
            Self::Set(value) => Some(value),
        }
    }
}

/// A partial grade update for one assessment, mirroring the v4 grader
/// payload shape (`{achieved_score, max_score, weightage_percent}`).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct GradeChange {
    pub achieved_score: FieldUpdate<f64>,
    pub max_score: FieldUpdate<f64>,
    pub weightage_percent: FieldUpdate<f64>,
}

// ---------------------------------------------------------------------------
// Snapshot types (the GET-state equivalent, one call)
// ---------------------------------------------------------------------------

/// Everything derived views need in one struct — dashboard and tasks both
/// already computed at the caller's reference date, so no shell ever
/// re-derives separately (`04` §4.4 item 5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSnapshot {
    /// Radar list, refreshed for `reference_date` (day-rollover semantics).
    pub assessments: Vec<Assessment>,
    pub schedule: ScheduleData,
    pub completed_topics: CompletedTopics,
    pub custom_events: Vec<CustomCalendarEvent>,
    pub feeds: Vec<FeedConfig>,
    pub grades: HashMap<String, GradeRecord>,
    pub derived: DerivedState,
}

/// The two always-fresh derived payloads (`04` §6 phases): dashboard radar
/// summary + deterministic study-roadmap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedState {
    pub dashboard: plan::dashboard::DashboardSummary,
    pub tasks: plan::tasks::StudyTasksPayload,
}

/// Reads the whole data realm and derives both payloads at `reference_date`.
/// The connection may be a plain handle or an open transaction (the importer
/// reads inside its write transaction so the caller sees final state).
pub fn read_snapshot(
    conn: &Connection,
    reference_date: NaiveDate,
) -> Result<AppSnapshot, StoreError> {
    let assessments = AssessmentRepo::new(conn).list()?;
    let refreshed: Vec<Assessment> = assessments
        .iter()
        .map(|assessment| plan::dashboard::refresh_assessment(assessment, reference_date))
        .collect();
    let completed_topics = TopicRepo::new(conn).all()?;
    let custom_events = EventRepo::new(conn).list()?;
    let schedule = load_schedule(conn)?;
    let feeds = FeedRepo::new(conn).list()?;
    let grades = GradeRepo::new(conn).all()?;

    let dashboard = plan::dashboard::build_dashboard_summary(
        &refreshed,
        &completed_topics,
        &custom_events,
        reference_date,
    );
    // The declared academic rhythm lives in config_kv; the store reads it
    // here so every shell's snapshot carries the same roadmap shape.
    let track = AcademicTrack::from_config(
        ConfigRepo::new(conn)
            .get_string("academic_track")?
            .as_deref(),
    );
    let tasks =
        plan::tasks::build_study_tasks(&refreshed, &completed_topics, reference_date, track);

    Ok(AppSnapshot {
        assessments: refreshed,
        schedule,
        completed_topics,
        custom_events,
        feeds,
        grades,
        derived: DerivedState { dashboard, tasks },
    })
}

// ---------------------------------------------------------------------------
// Schedule (courses + slots + semester)
// ---------------------------------------------------------------------------

/// Reads the whole timetable. Never fabricates: no courses → empty schedule
/// with `semester: None` (v5 replaced v4's `"My Semester"` template text;
/// shells render the raw value or a "—" affordance).
pub fn load_schedule(conn: &Connection) -> Result<ScheduleData, StoreError> {
    let meta = MetaRepo::new(conn);
    let semester = meta
        .get("schedule_semester")?
        .filter(|s| !s.trim().is_empty());
    let academic_week_start = meta
        .get("schedule_academic_week_start")?
        .filter(|s| !s.trim().is_empty());
    let courses = CourseRepo::new(conn).list()?;
    let slots = CourseRepo::new(conn).all_slots()?;
    Ok(ScheduleData {
        semester,
        academic_week_start,
        courses,
        slots,
    })
}

/// Validates (`02` §3.1 slot invariants) and normalizes one incoming slot:
/// `day_index` derivable from `day`, `display_time` core-formatted
/// `HH:MM–HH:MM`, unknown course name auto-filled from the enrolled course.
/// Failing validation is an honest error — the caller's UI showed pickers,
/// so a bad slot means bad data transformed on the way in, never junk at rest.
pub fn normalize_slot(
    mut slot: ScheduleSlot,
    courses: &[Course],
) -> Result<ScheduleSlot, StoreError> {
    let day = slot.day.trim();
    if day.is_empty() {
        return Err(StoreError::Validation(
            "Slot needs a weekday (day name), e.g. “Sun” or “Monday”.".to_string(),
        ));
    }
    if let Some(index) = crate::parse::util::weekday_index(day) {
        slot.day_index = index;
    } else if slot.day_index > 6 {
        return Err(StoreError::Validation(format!(
            "Slot day “{}” is not a weekday name and day_index {} is out of range (0–6).",
            day, slot.day_index
        )));
    }
    if slot.start_time >= slot.end_time {
        return Err(StoreError::Validation(format!(
            "Slot {} ends before it starts ({}–{}).",
            slot.id,
            slot.start_time.format("%H:%M"),
            slot.end_time.format("%H:%M")
        )));
    }
    if slot.display_time.trim().is_empty() {
        slot.display_time = format!(
            "{}–{}",
            slot.start_time.format("%H:%M"),
            slot.end_time.format("%H:%M")
        );
    }
    if let Some(course) = courses
        .iter()
        .find(|c| c.id.eq_ignore_ascii_case(&slot.course_id))
    {
        if slot.course_name.trim().is_empty() {
            slot.course_name = course.name.clone();
        }
    }
    Ok(slot)
}

fn naivedate_text(date: Option<NaiveDate>) -> Option<String> {
    date.map(|d| d.format("%Y-%m-%d").to_string())
}

fn naivetime_text(time: Option<NaiveTime>) -> Option<String> {
    time.map(|t| t.format("%H:%M").to_string())
}

fn naivetime_req_text(time: NaiveTime) -> String {
    time.format("%H:%M").to_string()
}

fn parse_text_date(text: Option<String>) -> Result<Option<NaiveDate>, StoreError> {
    match text {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|e| {
                StoreError::Validation(format!("stored date “{raw}” is not YYYY-MM-DD: {e}"))
            }),
    }
}

fn parse_text_time(text: Option<String>) -> Result<Option<NaiveTime>, StoreError> {
    match text {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) => NaiveTime::parse_from_str(raw.trim(), "%H:%M")
            .or_else(|_| NaiveTime::parse_from_str(raw.trim(), "%H:%M:%S"))
            .map(Some)
            .map_err(|e| StoreError::Validation(format!("stored time “{raw}” is not HH:MM: {e}"))),
    }
}

// ---------------------------------------------------------------------------
// CourseRepo (courses + the slot schedule rows)
// ---------------------------------------------------------------------------

/// Courses and their weekly slots. `group` is stored as `group_name`
/// (`group` is reserved SQL); times are `%H:%M` strings, dates `%Y-%m-%d`.
pub struct CourseRepo<'a> {
    conn: &'a Connection,
}

impl<'a> CourseRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn list(&self) -> Result<Vec<Course>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, bg, border, credits, max_absences FROM courses ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Course {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                bg: row.get(3)?,
                border: row.get(4)?,
                credits: row.get(5)?,
                max_absences: row
                    .get::<_, Option<i64>>(6)?
                    .map(|v| u32::try_from(v).unwrap_or(0)),
            })
        })?;
        let mut courses = Vec::new();
        for row in rows {
            courses.push(row?);
        }
        Ok(courses)
    }

    pub fn get(&self, code: &str) -> Result<Option<Course>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, bg, border, credits, max_absences FROM courses WHERE id = ?1 COLLATE NOCASE",
        )?;
        let mut rows = stmt.query_map([code.trim()], |row| {
            Ok(Course {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                bg: row.get(3)?,
                border: row.get(4)?,
                credits: row.get(5)?,
                max_absences: row
                    .get::<_, Option<i64>>(6)?
                    .map(|v| u32::try_from(v).unwrap_or(0)),
            })
        })?;
        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    /// Insert-or-replace by id (ASCII-case-insensitive match replaces an
    /// existing differently-cased row first — v4 upsert parity).
    pub fn upsert(&self, course: &Course) -> Result<(), StoreError> {
        if course.id.trim().is_empty() {
            return Err(StoreError::Validation(
                "Course needs a non-empty code (id).".to_string(),
            ));
        }
        if course.name.trim().is_empty() {
            return Err(StoreError::Validation(format!(
                "Course “{}” needs a title.",
                course.id
            )));
        }
        // Case-insensitive replacement of any near-duplicate id/label pair.
        self.delete(&course.id)?;
        self.conn.execute(
            "INSERT INTO courses (id, name, color, bg, border, credits, max_absences) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                course.id,
                course.name,
                course.color,
                course.bg,
                course.border,
                course.credits,
                course.max_absences.map(i64::from),
            ],
        )?;
        Ok(())
    }

    /// Deletes a course and its slots (ASCII-case-insensitive, v4 parity).
    /// Returns whether a course was removed.
    pub fn delete(&self, code: &str) -> Result<bool, StoreError> {
        let target = code.trim();
        if target.is_empty() {
            return Ok(false);
        }
        self.conn.execute(
            "DELETE FROM slots WHERE course_id = ?1 COLLATE NOCASE",
            [target],
        )?;
        self.conn
            .execute("DELETE FROM courses WHERE id = ?1 COLLATE NOCASE", [target])?;
        Ok(self.conn.changes() > 0)
    }

    pub fn set_max_absences(
        &self,
        code: &str,
        max_absences: Option<u32>,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE courses SET max_absences = ?1 WHERE id = ?2 COLLATE NOCASE",
            params![max_absences.map(i64::from), code.trim()],
        )?;
        Ok(())
    }

    pub fn set_credits(&self, code: &str, credits: Option<f64>) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE courses SET credits = ?1 WHERE id = ?2 COLLATE NOCASE",
            params![credits, code.trim()],
        )?;
        Ok(())
    }

    pub fn all_slots(&self) -> Result<Vec<ScheduleSlot>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, day, day_index, course_id, course_name, slot_type, group_name, room, \
             start_time, end_time, display_time, has_quiz, quiz_title, week_parity \
             FROM slots ORDER BY day_index, start_time, id",
        )?;
        let mut slots = Vec::new();
        let rows = stmt.query_map([], row_to_slot)?;
        for row in rows {
            slots.push(row?);
        }
        Ok(slots)
    }

    pub fn slots_for_course(&self, code: &str) -> Result<Vec<ScheduleSlot>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, day, day_index, course_id, course_name, slot_type, group_name, room, \
             start_time, end_time, display_time, has_quiz, quiz_title, week_parity \
             FROM slots WHERE course_id = ?1 COLLATE NOCASE ORDER BY day_index, start_time, id",
        )?;
        let mut slots = Vec::new();
        let rows = stmt.query_map([code.trim()], row_to_slot)?;
        for row in rows {
            slots.push(row?);
        }
        Ok(slots)
    }

    /// Replaces every slot belonging to `course_id` and inserts `slots`
    /// (assigned ids when absent: `slot-N` from the schedule's max counter —
    /// v4 upsert parity without the renumbering collision).
    /// Highest `slot-N` number among the incoming payload's explicit ids, so
    /// a blank-id slot in the same payload cannot collide with (and silently
    /// overwrite via INSERT OR REPLACE) an explicit `slot-1…N` from an
    /// import/AI schedule.
    fn next_slot_number_seed(slots: &[ScheduleSlot]) -> u64 {
        let mut max = 0u64;
        for slot in slots {
            let id = slot.id.trim();
            if let Some(rest) = id.strip_prefix("slot-") {
                if let Ok(n) = rest.parse::<u64>() {
                    max = max.max(n);
                }
            }
        }
        max + 1
    }

    pub fn replace_course_slots(
        &self,
        course_id: &str,
        slots: &[ScheduleSlot],
        updated_at: &str,
    ) -> Result<(), StoreError> {
        let courses = self.list()?;
        let mut next = self
            .next_slot_number()?
            .max(Self::next_slot_number_seed(slots));
        self.conn.execute(
            "DELETE FROM slots WHERE course_id = ?1 COLLATE NOCASE",
            [course_id.trim()],
        )?;
        for mut slot in slots.iter().cloned() {
            if slot.id.trim().is_empty() {
                slot.id = format!("slot-{next}");
                next += 1;
            }
            slot.course_id = course_id.trim().to_string();
            let slot = normalize_slot(slot, &courses)?;
            self.insert_slot(&slot, updated_at)?;
        }
        Ok(())
    }

    /// Full-schedule replace (`02` §4 `/api/schedule/save`): semester stamp +
    /// courses + normalized slots. Caller stamps via [`MetaRepo`].
    pub fn save_all(&self, schedule: &ScheduleData, updated_at: &str) -> Result<(), StoreError> {
        self.conn.execute("DELETE FROM slots", [])?;
        self.conn.execute("DELETE FROM courses", [])?;
        for course in &schedule.courses {
            self.upsert(course)?;
        }
        let mut next = self
            .next_slot_number()?
            .max(Self::next_slot_number_seed(&schedule.slots));
        for mut slot in schedule.slots.iter().cloned() {
            if slot.id.trim().is_empty() {
                slot.id = format!("slot-{next}");
                next += 1;
            }
            let slot = normalize_slot(slot, &schedule.courses)?;
            self.insert_slot(&slot, updated_at)?;
        }
        Ok(())
    }

    fn next_slot_number(&self) -> Result<u64, StoreError> {
        // `slot-N` counter continues after the highest existing numeric id so
        // existing slots keep their ids (v4 renumber-safety, minus collision).
        let max: Option<i64> = self.conn.query_row(
            "SELECT MAX(CAST(SUBSTR(id, 6) AS INTEGER)) \
                 FROM slots \
                 WHERE id LIKE 'slot-%' AND CAST(SUBSTR(id, 6) AS INTEGER) IS NOT NULL",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )?;
        Ok(max.unwrap_or(0).max(0) as u64 + 1)
    }

    fn insert_slot(&self, slot: &ScheduleSlot, updated_at: &str) -> Result<(), StoreError> {
        let _ = updated_at; // slots merge at dataset level via schedule_updated_at
        self.conn.execute(
            "INSERT OR REPLACE INTO slots \
             (id, day, day_index, course_id, course_name, slot_type, group_name, room, \
              start_time, end_time, display_time, has_quiz, quiz_title, week_parity) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                slot.id,
                slot.day,
                i64::from(slot.day_index),
                slot.course_id,
                slot.course_name,
                slot.slot_type,
                slot.group,
                slot.room,
                naivetime_req_text(slot.start_time),
                naivetime_req_text(slot.end_time),
                slot.display_time,
                i64::from(slot.has_quiz),
                slot.quiz_title,
                slot.week_parity,
            ],
        )?;
        Ok(())
    }
}

fn default_slot_type() -> String {
    "Lecture".to_string()
}

fn row_to_slot(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduleSlot> {
    let start_raw: String = row.get(8)?;
    let end_raw: String = row.get(9)?;
    // A stored slot always has its times (NOT NULL columns); a corrupt row maps
    // to midnight rather than crashing a whole semester's read — the caller has
    // not asked for a fabricated word, just a safe default below the ladder.
    let start_time = NaiveTime::parse_from_str(start_raw.trim(), "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(start_raw.trim(), "%H:%M:%S"))
        .unwrap_or(NaiveTime::MIN);
    let end_time = NaiveTime::parse_from_str(end_raw.trim(), "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(end_raw.trim(), "%H:%M:%S"))
        .unwrap_or(NaiveTime::MIN);
    Ok(ScheduleSlot {
        id: row.get(0)?,
        day: row.get(1)?,
        day_index: row
            .get::<_, Option<i64>>(2)?
            .unwrap_or_default()
            .clamp(0, 6) as u8,
        course_id: row.get(3)?,
        course_name: row.get(4)?,
        slot_type: row
            .get::<_, Option<String>>(5)?
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(default_slot_type),
        group: row.get(6)?,
        room: row.get(7)?,
        start_time,
        end_time,
        display_time: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
        has_quiz: row.get::<_, Option<i64>>(11)?.unwrap_or_default() != 0,
        quiz_title: row.get(12)?,
        week_parity: row.get(13)?,
    })
}

// ---------------------------------------------------------------------------
// AssessmentRepo
// ---------------------------------------------------------------------------

/// What an empty incoming set means for a whole-radar replace.
///
/// The store never deletes every assessment row on its own: an empty scan is
/// "0 found", not "the radar is empty now" — only a caller that explicitly
/// declares the latter may clear the radar. (The latent radar wipe — a
/// failed scan emptying the dashboard — was guarded by the desktop shell
/// only; the guard belongs here.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EmptyReplace {
    /// Refuse the empty replace and fail loudly (the safe default for a
    /// scan: a scan that found nothing must not wipe existing assessments).
    #[default]
    Refuse,
    /// Allow the empty replace — the caller explicitly declared that this
    /// really found nothing (a user-requested full reset, a restore of an
    /// empty backup).
    Allow,
}

/// Assessments: rows are stored exactly as the parser/importer produced them
/// (scan-time snapshot); the derived-countdown fields get re-stamped at read
/// time by `plan::refresh_assessment`, matching v4's day-rollover behavior.
pub struct AssessmentRepo<'a> {
    conn: &'a Connection,
}

const ASSESSMENT_COLS: &str =
    "id, course_id, course_name, title, assessment_type, date_iso, day_name, start_time, \
     end_time, display_time, room, group_name, instructor, is_upcoming, days_until, \
     urgency_level, priority_score, topics, warnings, ai_inference_note, ai_study_plan, \
     estimated_study_hours, elearning_url, google_cal_url, gcal_synced, gcal_event_id, \
     color, bg, border, semester, email_subject, email_sent_date, source, source_icon, \
     weightage_percent, achieved_score, max_score, conflict_warning, last_seen_source_run, \
     retired_source_run, updated_at";

const INSERT_ASSESSMENT: &str = "
INSERT OR REPLACE INTO assessments (
    id, course_id, course_name, title, assessment_type, date_iso, day_name, start_time,
    end_time, display_time, room, group_name, instructor, is_upcoming, days_until,
    urgency_level, priority_score, topics, warnings, ai_inference_note, ai_study_plan,
    estimated_study_hours, elearning_url, google_cal_url, gcal_synced, gcal_event_id,
    color, bg, border, semester, email_subject, email_sent_date, source, source_icon,
    weightage_percent, achieved_score, max_score, conflict_warning, last_seen_source_run,
    retired_source_run, updated_at
) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
    ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
    ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34,
    ?35, ?36, ?37, ?38, ?39, ?40, ?41
)";

impl<'a> AssessmentRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn list(&self) -> Result<Vec<Assessment>, StoreError> {
        let sql = format!("SELECT {ASSESSMENT_COLS} FROM assessments ORDER BY date_iso, id");
        let mut stmt = self.conn.prepare(&sql)?;
        let mut assessments = Vec::new();
        let rows = stmt.query_map([], row_to_assessment)?;
        for row in rows {
            assessments.push(row?);
        }
        Ok(assessments)
    }

    /// id → updated_at for every assessment (backup merge inputs).
    pub fn record_stamps(&self) -> Result<HashMap<String, String>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, updated_at FROM assessments WHERE updated_at IS NOT NULL")?;
        let stamps = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(stamps)
    }

    pub fn get(&self, id: &str) -> Result<Option<Assessment>, StoreError> {
        let sql = format!("SELECT {ASSESSMENT_COLS} FROM assessments WHERE id = ?1");
        self.conn
            .query_row(&sql, [id.trim()], row_to_assessment)
            .optional()
            .map_err(StoreError::Sql)
    }

    pub fn exists(&self, id: &str) -> Result<bool, StoreError> {
        let count: i64 = self.conn.query_row(
            "SELECT count(*) FROM assessments WHERE id = ?1",
            [id.trim()],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Writes one assessment row verbatim as a scan snapshot.
    pub fn upsert(&self, assessment: &Assessment, updated_at: &str) -> Result<(), StoreError> {
        write_assessment_row(self.conn, assessment, updated_at)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        self.conn
            .execute("DELETE FROM assessments WHERE id = ?1", [id.trim()])?;
        Ok(())
    }

    /// Scan pipeline entry (`02` §4 run_sync_pipeline → `process_all_emails`):
    /// the incoming scan **replaces the whole radar**, but user-owned fields
    /// survive reannouncement (`parse::merge` doc contract: grading +
    /// `gcal_synced` state + topic keys) — preserved by id, and by
    /// `parse::merge_key` when a reannounced item reappears under a new id
    /// (same source-label/course/title).
    ///
    /// `empty` decides what an empty incoming set means. The default
    /// ([`EmptyReplace::Refuse`]) fails loudly: a scan that found nothing
    /// must never wipe the radar (that was the latent radar wipe — only the
    /// desktop shell guarded against it). A caller that really means "there
    /// is nothing left" (an explicit reset, a restore of an empty backup)
    /// says so with [`EmptyReplace::Allow`].
    pub fn replace_all(
        &self,
        incoming: &[Assessment],
        updated_at: &str,
        empty: EmptyReplace,
    ) -> Result<(), StoreError> {
        let previous = self.list()?;
        let mut by_key: HashMap<String, &Assessment> = HashMap::new();
        for assessment in &previous {
            by_key.insert(crate::parse::merge::merge_key(assessment), assessment);
            by_key.insert(assessment.id.clone(), assessment);
        }

        let mut ids: Vec<String> = Vec::with_capacity(incoming.len());
        for assessment in incoming {
            if assessment.id.trim().is_empty() {
                return Err(StoreError::Validation(
                    "assessment id must not be empty".to_string(),
                ));
            }
            let mut merged = assessment.clone();
            // Preserve user-owned fields from the same item (id match takes
            // priority over the looser merge-key match).
            if let Some(old) = by_key.get(&merged.id) {
                copy_user_fields(old, &mut merged);
            } else if let Some(old) = by_key.get(&crate::parse::merge::merge_key(&merged)) {
                copy_user_fields(old, &mut merged);
            }
            write_assessment_row(self.conn, &merged, updated_at)?;
            ids.push(merged.id.clone());
        }

        // v4 deleted everything not freshly scanned; the same honest rule
        // removes rows for sources the user disabled or feeds they removed.
        // An EMPTY scan does not: it says "0 found", and "0 found" must not
        // read as "delete the radar" — that decision belongs to the caller,
        // which has to opt in explicitly.
        if ids.is_empty() {
            return match empty {
                EmptyReplace::Refuse => Err(StoreError::Validation(
                    "Refusing to clear the whole radar from an empty scan — \
                     a scan that found nothing must not wipe existing assessments. \
                     Pass EmptyReplace::Allow when the caller explicitly means \
                     \"there is nothing left\"."
                        .to_string(),
                )),
                EmptyReplace::Allow => {
                    self.conn.execute("DELETE FROM assessments", [])?;
                    Ok(())
                }
            };
        }
        if ids.len() <= 500 {
            let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let sql = format!("DELETE FROM assessments WHERE id NOT IN ({placeholders})");
            let params_vec: Vec<&dyn rusqlite::ToSql> =
                ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            self.conn.execute(&sql, params_vec.as_slice())?;
        } else {
            self.conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _keep_assessment_ids (id TEXT PRIMARY KEY);
                 DELETE FROM _keep_assessment_ids;",
            )?;
            {
                let mut insert_stmt = self
                    .conn
                    .prepare("INSERT INTO _keep_assessment_ids (id) VALUES (?1)")?;
                for id in ids {
                    insert_stmt.execute([id])?;
                }
            }
            self.conn.execute(
                "DELETE FROM assessments WHERE id NOT IN (SELECT id FROM _keep_assessment_ids)",
                [],
            )?;
            self.conn
                .execute("DROP TABLE IF EXISTS _keep_assessment_ids", [])?;
        }
        Ok(())
    }
}

/// Fields the user (or a previous scan/import) established and no fresh
/// announcement may wipe: recorded grades, calendar-sync state.
fn copy_user_fields(old: &Assessment, merged: &mut Assessment) {
    merged.weightage_percent = merged.weightage_percent.or(old.weightage_percent);
    merged.achieved_score = merged.achieved_score.or(old.achieved_score);
    merged.max_score = merged.max_score.or(old.max_score);
    if old.gcal_synced {
        merged.gcal_synced = true;
        merged.gcal_event_id = old.gcal_event_id.clone();
    }
}

fn row_to_assessment(row: &rusqlite::Row<'_>) -> rusqlite::Result<Assessment> {
    let date_iso: Option<String> = row.get(5)?;
    let date = naivedate_text_parse(date_iso);
    let start_time = naivetime_text_parse(row.get::<_, Option<String>>(7)?);
    let end_time = naivetime_text_parse(row.get::<_, Option<String>>(8)?);
    Ok(Assessment {
        id: row.get(0)?,
        course_id: row.get(1)?,
        course_name: row.get(2)?,
        title: row.get(3)?,
        assessment_type: assessment_type_from_label(&row.get::<_, String>(4)?),
        date,
        day_name: row.get(6)?,
        start_time,
        end_time,
        display_time: row.get(9)?,
        room: row.get(10)?,
        group: row.get(11)?,
        instructor: row.get(12)?,
        is_upcoming: row.get::<_, Option<i64>>(13)?.unwrap_or_default() != 0,
        days_until: row
            .get::<_, Option<i64>>(14)?
            .map(|v| v.clamp(i32::MIN as i64, i32::MAX as i64) as i32),
        urgency_level: urgency_from_label(&row.get::<_, String>(15)?),
        priority_score: row
            .get::<_, Option<i64>>(16)?
            .unwrap_or_default()
            .clamp(0, 100) as u8,
        topics: json_array_from_text(row.get::<_, Option<String>>(17)?),
        warnings: json_array_from_text(row.get::<_, Option<String>>(18)?),
        ai_inference_note: row.get(19)?,
        ai_study_plan: row.get(20)?,
        estimated_study_hours: row.get(21)?,
        elearning_url: row.get(22)?,
        google_cal_url: row.get(23)?,
        gcal_synced: row.get::<_, Option<i64>>(24)?.unwrap_or_default() != 0,
        gcal_event_id: row.get(25)?,
        color: row.get(26)?,
        bg: row.get(27)?,
        border: row.get(28)?,
        semester: row.get(29)?,
        email_subject: row.get(30)?,
        email_sent_date: row.get(31)?,
        source: crate::types::AssessmentSource::from_label(&row.get::<_, String>(32)?),
        source_icon: row.get(33)?,
        weightage_percent: row.get(34)?,
        achieved_score: row.get(35)?,
        max_score: row.get(36)?,
        conflict_warning: row.get(37)?,
        last_seen_source_run: row.get(38)?,
        retired_source_run: row.get(39)?,
    })
}

fn write_assessment_row(
    conn: &Connection,
    a: &Assessment,
    updated_at: &str,
) -> Result<(), StoreError> {
    let topics_json = serde_json::to_string(&a.topics)?;
    let warnings_json = serde_json::to_string(&a.warnings)?;
    conn.execute(
        INSERT_ASSESSMENT,
        params![
            a.id,
            a.course_id,
            a.course_name,
            a.title,
            a.assessment_type.as_str(),
            naivedate_text(a.date),
            a.day_name,
            naivetime_text(a.start_time),
            naivetime_text(a.end_time),
            a.display_time,
            a.room,
            a.group,
            a.instructor,
            i64::from(a.is_upcoming),
            a.days_until.map(i64::from),
            urgency_label(a.urgency_level),
            i64::from(a.priority_score),
            topics_json,
            warnings_json,
            a.ai_inference_note,
            a.ai_study_plan,
            a.estimated_study_hours,
            a.elearning_url,
            a.google_cal_url,
            i64::from(a.gcal_synced),
            a.gcal_event_id,
            a.color,
            a.bg,
            a.border,
            a.semester,
            a.email_subject,
            a.email_sent_date,
            a.source.as_str(),
            a.source_icon,
            a.weightage_percent,
            a.achieved_score,
            a.max_score,
            a.conflict_warning,
            a.last_seen_source_run,
            a.retired_source_run,
            updated_at,
        ],
    )?;
    Ok(())
}

fn urgency_label(urgency: UrgencyLevel) -> String {
    match urgency {
        UrgencyLevel::Critical => "critical".to_string(),
        UrgencyLevel::High => "high".to_string(),
        UrgencyLevel::Medium => "medium".to_string(),
        UrgencyLevel::Upcoming => "upcoming".to_string(),
        UrgencyLevel::Past => "past".to_string(),
    }
}

fn urgency_from_label(label: &str) -> UrgencyLevel {
    // Mirrors the tolerant importer path (unknown stamp → upcoming); the
    // value is recomputed from the stored date on every read anyway.
    serde_json::from_value(serde_json::Value::String(label.to_string()))
        .unwrap_or(UrgencyLevel::Upcoming)
}

fn assessment_type_from_label(label: &str) -> AssessmentType {
    AssessmentType::from_import_label(label).0
}

fn naivedate_text_parse(raw: Option<String>) -> Option<chrono::NaiveDate> {
    parse_text_date(raw).ok().flatten()
}

fn naivetime_text_parse(raw: Option<String>) -> Option<NaiveTime> {
    parse_text_time(raw).ok().flatten()
}

fn json_array_from_text(raw: Option<String>) -> Vec<String> {
    raw.and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// TopicRepo (completed_topics)
// ---------------------------------------------------------------------------

/// Topic-completion state. The store keeps **true rows only**: an unchecked
/// topic equals "absent" (v4's map could hold false entries, but the
/// merge/export contract in `04` §4.6 is topics true-only — a false row would
/// fabricate a "user explicitly unchecked" record for topics that simply do
/// not exist anymore).
pub struct TopicRepo<'a> {
    conn: &'a Connection,
}

impl<'a> TopicRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn all(&self) -> Result<CompletedTopics, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, done FROM topics_done WHERE done != 0")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, true)))?;
        let mut map: CompletedTopics = HashMap::new();
        for row in rows {
            let (key, done) = row?;
            map.insert(key, done);
        }
        Ok(map)
    }

    /// `true` inserts the key; `false` removes it (true-only invariant).
    pub fn set(&self, key: &str, done: bool, updated_at: &str) -> Result<(), StoreError> {
        if key.trim().is_empty() {
            return Err(StoreError::Validation(
                "topic key must be <assessment_id>::h<topic-hash>".to_string(),
            ));
        }
        if done {
            self.conn.execute(
                "INSERT INTO topics_done (key, done, updated_at) VALUES (?1, 1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET done = 1, updated_at = excluded.updated_at",
                params![key.trim(), updated_at],
            )?;
        } else {
            self.conn
                .execute("DELETE FROM topics_done WHERE key = ?1", [key.trim()])?;
        }
        Ok(())
    }

    /// Additive merge (`04` §4.6 “topics true-only”): only `true` entries
    /// merge in — an absent key never un-completes a topic.
    pub fn merge_additive(
        &self,
        incoming: &CompletedTopics,
        updated_at: &str,
    ) -> Result<usize, StoreError> {
        let mut merged = 0usize;
        for (key, done) in incoming {
            if !*done {
                continue;
            }
            let existing: Option<i64> = self
                .conn
                .query_row(
                    "SELECT done FROM topics_done WHERE key = ?1",
                    [key],
                    |row| row.get(0),
                )
                .optional()?;
            if existing != Some(1) {
                self.set(key, true, updated_at)?;
                merged += 1;
            }
        }
        Ok(merged)
    }
}

// ---------------------------------------------------------------------------
// GradeRepo
// ---------------------------------------------------------------------------

/// Recorded grades, kept in two synchronized places: the `grades` map (v4's
/// `AppConfig.grades`) and the per-assessment display columns (v4's radar
/// `weightage_percent/achieved_score/max_score`). Both writers live here so
/// they can never drift.
pub struct GradeRepo<'a> {
    conn: &'a Connection,
}

impl<'a> GradeRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn all(&self) -> Result<HashMap<String, GradeRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT assessment_id, achieved_score, max_score, weightage_percent FROM grades",
        )?;
        let mut map = HashMap::new();
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                GradeRecord {
                    achieved_score: row.get(1)?,
                    max_score: row.get(2)?,
                    weightage_percent: row.get(3)?,
                },
            ))
        })?;
        for row in rows {
            let (id, record) = row?;
            map.insert(id, record);
        }
        Ok(map)
    }

    /// id → updated_at for every grade row (backup merge inputs).
    pub fn record_stamps(&self) -> Result<HashMap<String, String>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT assessment_id, updated_at FROM grades WHERE updated_at IS NOT NULL")?;
        let stamps = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(stamps)
    }

    pub fn get(&self, assessment_id: &str) -> Result<Option<GradeRecord>, StoreError> {
        self.conn
            .query_row(
                "SELECT achieved_score, max_score, weightage_percent \
                 FROM grades WHERE assessment_id = ?1",
                [assessment_id.trim()],
                |row| {
                    Ok(GradeRecord {
                        achieved_score: row.get(0)?,
                        max_score: row.get(1)?,
                        weightage_percent: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::Sql)
    }

    /// Stores a complete record; an empty record deletes itself instead (a
    /// grade row that grades nothing would fabricate a "recorded" state).
    /// Requires the assessment to exist — v4's honest "Assessment not
    /// found." failure.
    pub fn write(
        &self,
        assessment_id: &str,
        record: &GradeRecord,
        updated_at: &str,
    ) -> Result<GradeRecord, StoreError> {
        let id = assessment_id.trim();
        let exists: i64 = self.conn.query_row(
            "SELECT count(*) FROM assessments WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(StoreError::Validation("Assessment not found.".to_string()));
        }
        self.validate(record, id)?;
        if record.is_empty() {
            self.delete(id)?;
        } else {
            self.write_raw(id, record, updated_at)?;
        }
        self.sync_assessment_columns(id, record)?;
        Ok(record.clone())
    }

    /// Partial update with `FieldUpdate` semantics: `Keep` untouched, `Clear`
    /// (explicit null) wipes — never coerced into a fabricated 0 score — and
    /// `Set` validates (achieved ≥ 0, max > 0, weightage ≥ 0; mobile-engine
    /// parity `v4 app.js:1626-1632`).
    pub fn update(
        &self,
        assessment_id: &str,
        change: &GradeChange,
        updated_at: &str,
    ) -> Result<GradeRecord, StoreError> {
        let id = assessment_id.trim();
        let existing = self.get(id)?;
        let record = GradeRecord {
            achieved_score: change
                .achieved_score
                .resolve(existing.as_ref().and_then(|g| g.achieved_score)),
            max_score: change
                .max_score
                .resolve(existing.as_ref().and_then(|g| g.max_score)),
            weightage_percent: change
                .weightage_percent
                .resolve(existing.as_ref().and_then(|g| g.weightage_percent)),
        };
        self.write(id, &record, updated_at)
    }

    /// Backup merge upsert (`04` §4.6 "grades upsert"): each non-null remote
    /// field fills the local record; the other device cannot erase a local
    /// grade its data does not carry — additive, never subtractive. Returns
    /// whether anything changed. The merged record passes the same
    /// existence + `validate()` guards as a local write: a corrupt/hostile
    /// cloud payload must not plant `achieved: -5` or grade rows for
    /// assessments that exist nowhere.
    pub fn merge_upsert(
        &self,
        assessment_id: &str,
        remote: &GradeRecord,
        updated_at: &str,
    ) -> Result<bool, StoreError> {
        if remote.is_empty() {
            return Ok(false);
        }
        let id = assessment_id.trim();
        let exists: i64 = self.conn.query_row(
            "SELECT count(*) FROM assessments WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Ok(false);
        }
        let local = self.get(id)?.unwrap_or_default();
        let merged = GradeRecord {
            achieved_score: remote.achieved_score.or(local.achieved_score),
            max_score: remote.max_score.or(local.max_score),
            weightage_percent: remote.weightage_percent.or(local.weightage_percent),
        };
        if merged == local {
            return Ok(false);
        }
        self.validate(&merged, id)?;
        self.write_raw(id, &merged, updated_at)?;
        self.sync_assessment_columns(id, &merged)?;
        Ok(true)
    }

    fn sync_assessment_columns(&self, id: &str, record: &GradeRecord) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE assessments SET weightage_percent = ?2, achieved_score = ?3, max_score = ?4 \
             WHERE id = ?1",
            params![
                id,
                record.weightage_percent,
                record.achieved_score,
                record.max_score
            ],
        )?;
        Ok(())
    }

    fn validate(&self, record: &GradeRecord, id: &str) -> Result<(), StoreError> {
        if record
            .achieved_score
            .is_some_and(|v| !v.is_finite() || v < 0.0)
        {
            return Err(StoreError::Validation(format!(
                "achieved_score must be a non-negative number (assessment {id})"
            )));
        }
        if record.max_score.is_some_and(|v| !v.is_finite() || v <= 0.0) {
            return Err(StoreError::Validation(format!(
                "max_score must be greater than zero (assessment {id})"
            )));
        }
        if record
            .weightage_percent
            .is_some_and(|v| !v.is_finite() || v < 0.0)
        {
            return Err(StoreError::Validation(format!(
                "weightage_percent must be a non-negative number (assessment {id})"
            )));
        }
        Ok(())
    }

    /// Deletes the record and clears the assessment's display columns
    /// (explicit ungrade — the rendered "Recorded: …" pill must disappear).
    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        self.conn
            .execute("DELETE FROM grades WHERE assessment_id = ?1", [id.trim()])?;
        self.sync_assessment_columns(id, &GradeRecord::default())
    }

    fn write_raw(
        &self,
        id: &str,
        record: &GradeRecord,
        updated_at: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO grades (assessment_id, achieved_score, max_score, weightage_percent, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(assessment_id) DO UPDATE SET \
               achieved_score = excluded.achieved_score, \
               max_score = excluded.max_score, \
               weightage_percent = excluded.weightage_percent, \
               updated_at = excluded.updated_at",
            params![
                id,
                record.achieved_score,
                record.max_score,
                record.weightage_percent,
                updated_at
            ],
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// EventRepo (custom calendar events)
// ---------------------------------------------------------------------------

pub struct EventRepo<'a> {
    conn: &'a Connection,
}

impl<'a> EventRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn list(&self) -> Result<Vec<CustomCalendarEvent>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, course_id, event_type, date_iso, start_time, end_time, \
             room, notes, color FROM events ORDER BY date_iso, start_time, id",
        )?;
        let mut events = Vec::new();
        let rows = stmt.query_map([], |row| {
            let date_raw: Option<String> = row.get(4)?;
            Ok(CustomCalendarEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                course_id: row.get(2)?,
                event_type: row.get(3)?,
                date: naivedate_text_parse(date_raw),
                start_time: naivetime_text_parse(row.get(5)?),
                end_time: naivetime_text_parse(row.get(6)?),
                room: row.get(7)?,
                notes: row.get(8)?,
                color: row.get(9)?,
            })
        })?;
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }

    /// id → updated_at for every custom event (backup merge inputs).
    pub fn record_stamps(&self) -> Result<HashMap<String, String>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, updated_at FROM events WHERE updated_at IS NOT NULL")?;
        let stamps = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(stamps)
    }

    /// Upsert by id. Requires a non-empty id — generating one is the
    /// caller's job (`custom-<unix_millis>` in v4; the core owns no clock).
    pub fn upsert(&self, event: &CustomCalendarEvent, updated_at: &str) -> Result<(), StoreError> {
        if event.id.trim().is_empty() {
            return Err(StoreError::Validation(
                "Custom event needs an id — the shell assigns custom-<unix_millis>.".to_string(),
            ));
        }
        if event.title.trim().is_empty() {
            return Err(StoreError::Validation(format!(
                "Custom event {} needs a title.",
                event.id
            )));
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO events \
             (id, title, course_id, event_type, date_iso, start_time, end_time, room, notes, color, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                event.id.trim(),
                event.title,
                event.course_id,
                event.event_type,
                naivedate_text(event.date),
                naivetime_text(event.start_time),
                naivetime_text(event.end_time),
                event.room,
                event.notes,
                event.color,
                updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<bool, StoreError> {
        self.conn
            .execute("DELETE FROM events WHERE id = ?1", [id.trim()])?;
        Ok(self.conn.changes() > 0)
    }
}

// ---------------------------------------------------------------------------
// FeedRepo
// ---------------------------------------------------------------------------

pub struct FeedRepo<'a> {
    conn: &'a Connection,
}

/// A feed URL usually embeds a personal access token, so it must never be
/// fetched over plaintext HTTP (v4 `feeds.rs::validate_feed_url` ported
/// verbatim including the warning copy).
pub fn validate_feed_url(url: &str) -> Result<(), StoreError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(StoreError::Validation("Feed URL is empty.".to_string()));
    }
    if trimmed.to_lowercase().starts_with("http://") {
        return Err(StoreError::Validation(
            "Feed URL must use HTTPS (http:// would send any access token embedded in the link in the clear). Re-copy the link starting with https://.".to_string(),
        ));
    }
    if !trimmed.to_lowercase().starts_with("https://") {
        return Err(StoreError::Validation(
            "Feed URL must be an https:// link to an .ics calendar file.".to_string(),
        ));
    }
    Ok(())
}

impl<'a> FeedRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn list(&self) -> Result<Vec<FeedConfig>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, url, enabled FROM feeds ORDER BY id")?;
        let mut feeds = Vec::new();
        let rows = stmt.query_map([], |row| {
            Ok(FeedConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                enabled: row.get::<_, Option<i64>>(3)?.unwrap_or_default() != 0,
            })
        })?;
        for row in rows {
            feeds.push(row?);
        }
        Ok(feeds)
    }

    /// id → updated_at for every feed (backup merge inputs).
    pub fn record_stamps(&self) -> Result<HashMap<String, String>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, updated_at FROM feeds WHERE updated_at IS NOT NULL")?;
        let stamps = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(stamps)
    }

    /// Insert-or-update; enforces https-only validation and the ≤10 cap
    /// (`v4 feeds.rs::MAX_FEEDS`).
    pub fn save(&self, feed: &FeedConfig, updated_at: &str) -> Result<(), StoreError> {
        if feed.id.trim().is_empty() {
            return Err(StoreError::Validation(
                "Feed needs an id — the shell assigns feed-<unix_millis>.".to_string(),
            ));
        }
        if feed.name.trim().is_empty() {
            return Err(StoreError::Validation("Feed needs a name.".to_string()));
        }
        validate_feed_url(&feed.url)?;
        let count: i64 = self
            .conn
            .query_row("SELECT count(*) FROM feeds", [], |row| row.get(0))?;
        let updating = self.exists(feed.id.trim())?;
        if !updating && count as usize >= MAX_FEEDS {
            return Err(StoreError::Validation(format!(
                "You can subscribe to at most {MAX_FEEDS} calendar feeds. Remove one first."
            )));
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO feeds (id, name, url, enabled, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                feed.id.trim(),
                feed.name,
                feed.url.trim(),
                i64::from(feed.enabled),
                updated_at
            ],
        )?;
        Ok(())
    }

    fn exists(&self, id: &str) -> Result<bool, StoreError> {
        let count: i64 =
            self.conn
                .query_row("SELECT count(*) FROM feeds WHERE id = ?1", [id], |row| {
                    row.get(0)
                })?;
        Ok(count > 0)
    }

    pub fn delete(&self, id: &str) -> Result<bool, StoreError> {
        self.conn
            .execute("DELETE FROM feeds WHERE id = ?1", [id.trim()])?;
        Ok(self.conn.changes() > 0)
    }
}

// ---------------------------------------------------------------------------
// ConfigRepo (non-secret configuration)
// ---------------------------------------------------------------------------

/// AppConfig-style values, JSON-encoded per key. Secrets have no key here by
/// policy (`AGENTS` §3): AI keys and OAuth tokens belong to platform
/// storage; the store holds only non-secret flags (`gemini_enabled`) and
/// profile *anchors* (display name/email), never credentials.
pub struct ConfigRepo<'a> {
    conn: &'a Connection,
}

impl<'a> ConfigRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get_raw(&self, key: &str) -> Result<Option<serde_json::Value>, StoreError> {
        let text: Option<String> = self
            .conn
            .query_row("SELECT value FROM config_kv WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        match text {
            None => Ok(None),
            Some(raw) if raw.is_empty() => Ok(None),
            Some(raw) => serde_json::from_str(&raw)
                .map(Some)
                .map_err(|e| StoreError::Validation(format!("config key {key} is corrupt: {e}"))),
        }
    }

    pub fn set_raw(&self, key: &str, value: &serde_json::Value) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO config_kv (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, serde_json::to_string(value)?],
        )?;
        Ok(())
    }

    pub fn get_bool(&self, key: &str, default: bool) -> Result<bool, StoreError> {
        Ok(self
            .get_raw(key)?
            .and_then(|v| v.as_bool())
            .unwrap_or(default))
    }

    pub fn set_bool(&self, key: &str, value: bool) -> Result<(), StoreError> {
        self.set_raw(key, &serde_json::Value::Bool(value))
    }

    pub fn get_string(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .get_raw(key)?
            .and_then(|v| v.as_str().map(str::to_string)))
    }

    pub fn set_string(&self, key: &str, value: Option<&str>) -> Result<(), StoreError> {
        match value.filter(|s| !s.trim().is_empty()) {
            Some(text) => self.set_raw(key, &serde_json::Value::String(text.to_string())),
            None => {
                self.conn
                    .execute("DELETE FROM config_kv WHERE key = ?1", [key])?;
                Ok(())
            }
        }
    }

    /// v5 default `false` — v4's pre-auth `auto_sync_gcal: true` default is
    /// explicitly not ported (`03` §C1, AGENTS golden rule 4).
    pub fn auto_sync_gcal(&self) -> Result<bool, StoreError> {
        self.get_bool("auto_sync_gcal", false)
    }

    pub fn onboarding_completed(&self) -> Result<bool, StoreError> {
        self.get_bool("onboarding_completed", false)
    }

    pub fn dismiss_conflict_banner(&self) -> Result<bool, StoreError> {
        self.get_bool("dismiss_conflict_banner", false)
    }

    pub fn synced_gcal_map(&self) -> Result<HashMap<String, String>, StoreError> {
        let raw = self.get_raw("synced_gcal_map")?;
        match raw {
            None => Ok(HashMap::new()),
            Some(value) => serde_json::from_value::<HashMap<String, String>>(value).map_err(|e| {
                StoreError::Validation(format!("config key synced_gcal_map is corrupt: {e}"))
            }),
        }
    }

    pub fn set_synced_gcal_map(&self, map: &HashMap<String, String>) -> Result<(), StoreError> {
        self.set_raw("synced_gcal_map", &serde_json::to_value(map)?)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// MetaRepo (kv_meta + tokens_meta)
// ---------------------------------------------------------------------------

/// Dataset-level metadata: schema stamps, sync stamps, the schedule's
/// `updated_at` for backup replace-if-newer merges — plus account profiles
/// per provider (metadata only; credentials live platform-side).
pub struct MetaRepo<'a> {
    conn: &'a Connection,
}

impl<'a> MetaRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        self.conn
            .query_row("SELECT value FROM kv_meta WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(StoreError::Sql)
    }

    pub fn set(&self, key: &str, value: Option<&str>) -> Result<(), StoreError> {
        match value.filter(|s| !s.trim().is_empty()) {
            Some(text) => {
                self.conn.execute(
                    "INSERT INTO kv_meta (key, value) VALUES (?1, ?2) \
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params![key.trim(), text],
                )?;
            }
            None => {
                self.conn
                    .execute("DELETE FROM kv_meta WHERE key = ?1", [key.trim()])?;
            }
        }
        Ok(())
    }

    // ---- Sync stamps (last_*_sync per the store contract) ----

    pub fn last_gmail_sync(&self) -> Result<Option<String>, StoreError> {
        self.get("last_gmail_sync")
    }

    pub fn set_last_gmail_sync(&self, stamp: &str) -> Result<(), StoreError> {
        self.set("last_gmail_sync", Some(stamp))
    }

    pub fn last_gcal_sync(&self) -> Result<Option<String>, StoreError> {
        self.get("last_gcal_sync")
    }

    pub fn set_last_gcal_sync(&self, stamp: &str) -> Result<(), StoreError> {
        self.set("last_gcal_sync", Some(stamp))
    }

    pub fn last_backup_push(&self) -> Result<Option<String>, StoreError> {
        self.get("last_backup_push")
    }

    pub fn set_last_backup_push(&self, stamp: &str) -> Result<(), StoreError> {
        self.set("last_backup_push", Some(stamp))
    }

    /// When the schedule (courses+slots+semester) was last written; backup
    /// pulls replace the schedule only when the remote dataset is newer
    /// than this (fresh devices with no stamp accept any populated remote).
    pub fn schedule_updated_at(&self) -> Result<Option<String>, StoreError> {
        self.get("schedule_updated_at")
    }

    pub fn set_schedule_updated_at(&self, stamp: &str) -> Result<(), StoreError> {
        self.set("schedule_updated_at", Some(stamp))
    }

    // ---- Account profiles (metadata only, never tokens) ----

    pub fn set_profile(
        &self,
        provider: &str,
        account_name: Option<&str>,
        account_email: Option<&str>,
        account_picture: Option<&str>,
        updated_at: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO tokens_meta (provider, account_name, account_email, account_picture, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(provider) DO UPDATE SET \
               account_name = excluded.account_name, \
               account_email = excluded.account_email, \
               account_picture = excluded.account_picture, \
               updated_at = excluded.updated_at",
            params![provider, account_name, account_email, account_picture, updated_at],
        )?;
        Ok(())
    }

    pub fn clear_profile(&self, provider: &str) -> Result<(), StoreError> {
        self.conn
            .execute("DELETE FROM tokens_meta WHERE provider = ?1", [provider])?;
        Ok(())
    }

    pub fn profile(&self, provider: &str) -> Result<Option<ProfileMeta>, StoreError> {
        self.conn
            .query_row(
                "SELECT provider, account_name, account_email, account_picture \
                 FROM tokens_meta WHERE provider = ?1",
                [provider],
                |row| {
                    Ok(ProfileMeta {
                        provider: row.get(0)?,
                        account_name: row.get(1)?,
                        account_email: row.get(2)?,
                        account_picture: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::Sql)
    }
}

/// Metadata for one platform-held account (`tokens_meta` rows). Deliberately
/// token-free: the credential itself never exists in the core's data realm.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProfileMeta {
    pub provider: String,
    pub account_name: Option<String>,
    pub account_email: Option<String>,
    pub account_picture: Option<String>,
}

// ---------------------------------------------------------------------------
// AttendanceRepo
// ---------------------------------------------------------------------------

pub struct AttendanceRepo<'a> {
    conn: &'a Connection,
}

impl<'a> AttendanceRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn record(&self, entry: &AttendanceEntry) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO attendance (id, slot_id, course_id, date_iso, status, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entry.id,
                entry.slot_id,
                entry.course_id,
                entry.date_iso.format("%Y-%m-%d").to_string(),
                entry.status.as_str(),
                entry.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Removes one attendance mark by its stable id, returning how many rows
    /// went away. The toggle cycle's clear step persists as this deletion so
    /// a cleared mark never reappears on restart.
    pub fn delete(&self, id: &str) -> Result<usize, StoreError> {
        let removed = self
            .conn
            .execute("DELETE FROM attendance WHERE id = ?1", params![id.trim()])?;
        Ok(removed)
    }

    pub fn list_all(&self) -> Result<Vec<AttendanceEntry>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, slot_id, course_id, date_iso, status, updated_at \
             FROM attendance ORDER BY date_iso DESC, id",
        )?;
        let rows = stmt.query_map([], row_to_attendance)?;
        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok(entries)
    }

    pub fn list_for_course(&self, course_id: &str) -> Result<Vec<AttendanceEntry>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, slot_id, course_id, date_iso, status, updated_at \
             FROM attendance WHERE course_id = ?1 COLLATE NOCASE ORDER BY date_iso DESC, id",
        )?;
        let rows = stmt.query_map([course_id.trim()], row_to_attendance)?;
        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok(entries)
    }

    pub fn summary_for_course(
        &self,
        course_id: &str,
        max_absences: Option<u32>,
    ) -> Result<CourseAttendanceSummary, StoreError> {
        let entries = self.list_for_course(course_id)?;
        let total_classes = entries.len() as u32;
        let mut attended = 0u32;
        let mut absent = 0u32;
        let mut excused = 0u32;
        for e in &entries {
            match e.status {
                AttendanceStatus::Attended => attended += 1,
                AttendanceStatus::Absent => absent += 1,
                AttendanceStatus::Excused => excused += 1,
            }
        }

        let (warning_chip, is_critical) = match max_absences {
            Some(limit) if limit > 0 => {
                if absent >= limit {
                    (Some(format!("Limit Reached! ({absent}/{limit})")), true)
                } else if absent == limit - 1 {
                    (Some(format!("1 Absence Left ({absent}/{limit})")), false)
                } else {
                    (Some(format!("{absent}/{limit} Absences")), false)
                }
            }
            _ => (None, false),
        };

        Ok(CourseAttendanceSummary {
            course_id: course_id.to_string(),
            total_classes,
            attended,
            absent,
            excused,
            max_absences,
            warning_chip,
            is_critical,
        })
    }

    pub fn course_summary(&self, course_id: &str) -> Result<CourseAttendanceSummary, StoreError> {
        let max_absences = CourseRepo::new(self.conn)
            .get(course_id)?
            .and_then(|c| c.max_absences);
        self.summary_for_course(course_id, max_absences)
    }

    pub fn all_summaries(&self) -> Result<Vec<CourseAttendanceSummary>, StoreError> {
        let courses = CourseRepo::new(self.conn).list()?;
        let mut summaries = Vec::with_capacity(courses.len());
        for c in courses {
            summaries.push(self.summary_for_course(&c.id, c.max_absences)?);
        }
        Ok(summaries)
    }
}

fn row_to_attendance(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttendanceEntry> {
    let date_str: String = row.get(3)?;
    let date_iso = NaiveDate::parse_from_str(date_str.trim(), "%Y-%m-%d").map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let status_str: String = row.get(4)?;
    let status = match status_str.trim().to_ascii_lowercase().as_str() {
        "absent" => AttendanceStatus::Absent,
        "excused" => AttendanceStatus::Excused,
        "attended" => AttendanceStatus::Attended,
        unknown => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("unknown attendance status '{unknown}'"),
                )),
            ));
        }
    };
    Ok(AttendanceEntry {
        id: row.get(0)?,
        slot_id: row.get(1)?,
        course_id: row.get(2)?,
        date_iso,
        status,
        updated_at: row.get(5)?,
    })
}

// ---------------------------------------------------------------------------
// FlashcardRepo
// ---------------------------------------------------------------------------

pub struct FlashcardRepo<'a> {
    conn: &'a Connection,
}

impl<'a> FlashcardRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn upsert(&self, card: &Flashcard, updated_at: &str) -> Result<(), StoreError> {
        if card.id.trim().is_empty() {
            return Err(StoreError::Validation(
                "Flashcard needs a non-empty id.".to_string(),
            ));
        }
        if card.front.trim().is_empty() {
            return Err(StoreError::Validation(
                "Flashcard front cannot be empty.".to_string(),
            ));
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO flashcards \
             (id, course_id, assessment_id, topic, front, back, box_level, next_review_iso, last_reviewed_iso, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                card.id,
                card.course_id,
                card.assessment_id,
                card.topic,
                card.front,
                card.back,
                i64::from(card.box_level.clamp(1, 5)),
                card.next_review_iso,
                card.last_reviewed_iso,
                updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<Option<Flashcard>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, assessment_id, topic, front, back, box_level, next_review_iso, last_reviewed_iso \
             FROM flashcards WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id.trim()], row_to_flashcard)?;
        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn delete(&self, id: &str) -> Result<bool, StoreError> {
        self.conn
            .execute("DELETE FROM flashcards WHERE id = ?1", [id.trim()])?;
        Ok(self.conn.changes() > 0)
    }

    pub fn list_all(&self) -> Result<Vec<Flashcard>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, assessment_id, topic, front, back, box_level, next_review_iso, last_reviewed_iso \
             FROM flashcards ORDER BY box_level ASC, id ASC",
        )?;
        let rows = stmt.query_map([], row_to_flashcard)?;
        let mut cards = Vec::new();
        for r in rows {
            cards.push(r?);
        }
        Ok(cards)
    }

    pub fn list_for_course(&self, course_id: &str) -> Result<Vec<Flashcard>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, assessment_id, topic, front, back, box_level, next_review_iso, last_reviewed_iso \
             FROM flashcards WHERE course_id = ?1 COLLATE NOCASE ORDER BY box_level ASC, id ASC",
        )?;
        let rows = stmt.query_map([course_id.trim()], row_to_flashcard)?;
        let mut cards = Vec::new();
        for r in rows {
            cards.push(r?);
        }
        Ok(cards)
    }

    pub fn list_for_assessment(&self, assessment_id: &str) -> Result<Vec<Flashcard>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, assessment_id, topic, front, back, box_level, next_review_iso, last_reviewed_iso \
             FROM flashcards WHERE assessment_id = ?1 ORDER BY box_level ASC, id ASC",
        )?;
        let rows = stmt.query_map([assessment_id.trim()], row_to_flashcard)?;
        let mut cards = Vec::new();
        for r in rows {
            cards.push(r?);
        }
        Ok(cards)
    }

    pub fn review(
        &self,
        id: &str,
        correct: bool,
        today: NaiveDate,
        updated_at: &str,
    ) -> Result<Option<Flashcard>, StoreError> {
        let Some(mut card) = self.get(id)? else {
            return Ok(None);
        };
        crate::plan::study::apply_leitner_review(&mut card, correct, today);
        self.upsert(&card, updated_at)?;
        Ok(Some(card))
    }
}

fn row_to_flashcard(row: &rusqlite::Row<'_>) -> rusqlite::Result<Flashcard> {
    let box_level_raw: i64 = row.get::<_, Option<i64>>(6)?.unwrap_or(1);
    Ok(Flashcard {
        id: row.get(0)?,
        course_id: row.get(1)?,
        assessment_id: row.get(2)?,
        topic: row.get(3)?,
        front: row.get(4)?,
        back: row.get(5)?,
        box_level: (box_level_raw.clamp(1, 5)) as u8,
        next_review_iso: row.get(7)?,
        last_reviewed_iso: row.get(8)?,
    })
}

// ---------------------------------------------------------------------------
// QuizAttemptRepo & MistakeRepo
// ---------------------------------------------------------------------------

pub struct QuizAttemptRepo<'a> {
    conn: &'a Connection,
}

impl<'a> QuizAttemptRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn record(&self, attempt: &QuizAttempt) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO quiz_attempts (id, assessment_id, course_id, timestamp, score, total_questions, passed) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                attempt.id,
                attempt.assessment_id,
                attempt.course_id,
                attempt.timestamp,
                i64::from(attempt.score),
                i64::from(attempt.total_questions),
                if attempt.passed { 1i64 } else { 0i64 },
            ],
        )?;
        Ok(())
    }

    pub fn save(&self, attempt: &QuizAttempt) -> Result<(), StoreError> {
        self.record(attempt)
    }

    pub fn list_all(&self) -> Result<Vec<QuizAttempt>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, assessment_id, course_id, timestamp, score, total_questions, passed \
             FROM quiz_attempts ORDER BY timestamp DESC, id",
        )?;
        let rows = stmt.query_map([], row_to_attempt)?;
        let mut attempts = Vec::new();
        for r in rows {
            attempts.push(r?);
        }
        Ok(attempts)
    }

    pub fn list_for_assessment(&self, assessment_id: &str) -> Result<Vec<QuizAttempt>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, assessment_id, course_id, timestamp, score, total_questions, passed \
             FROM quiz_attempts WHERE assessment_id = ?1 ORDER BY timestamp DESC, id",
        )?;
        let rows = stmt.query_map([assessment_id.trim()], row_to_attempt)?;
        let mut attempts = Vec::new();
        for r in rows {
            attempts.push(r?);
        }
        Ok(attempts)
    }
}

fn row_to_attempt(row: &rusqlite::Row<'_>) -> rusqlite::Result<QuizAttempt> {
    Ok(QuizAttempt {
        id: row.get(0)?,
        assessment_id: row.get(1)?,
        course_id: row.get(2)?,
        timestamp: row.get(3)?,
        score: u32::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
        total_questions: u32::try_from(row.get::<_, i64>(5)?).unwrap_or(0),
        passed: row.get::<_, i64>(6)? != 0,
    })
}

pub struct MistakeRepo<'a> {
    conn: &'a Connection,
}

impl<'a> MistakeRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn record(&self, mistake: &MistakeRecord, updated_at: &str) -> Result<(), StoreError> {
        let options_json = serde_json::to_string(&mistake.options)?;
        self.conn.execute(
            "INSERT OR REPLACE INTO mistake_bank \
             (id, attempt_id, assessment_id, course_id, question_id, question_text, options, selected_index, correct_index, explanation, timestamp, resolved, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                mistake.id,
                mistake.attempt_id,
                mistake.assessment_id,
                mistake.course_id,
                mistake.question_id,
                mistake.question_text,
                options_json,
                mistake.selected_index as i64,
                mistake.correct_index as i64,
                mistake.explanation,
                mistake.timestamp,
                if mistake.resolved { 1i64 } else { 0i64 },
                updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn save(&self, mistake: &MistakeRecord, updated_at: &str) -> Result<(), StoreError> {
        self.record(mistake, updated_at)
    }

    pub fn list_all(&self) -> Result<Vec<MistakeRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, attempt_id, assessment_id, course_id, question_id, question_text, options, selected_index, correct_index, explanation, timestamp, resolved \
             FROM mistake_bank ORDER BY resolved ASC, timestamp DESC, id",
        )?;
        let rows = stmt.query_map([], row_to_mistake)?;
        let mut mistakes = Vec::new();
        for r in rows {
            mistakes.push(r?);
        }
        Ok(mistakes)
    }

    pub fn list_unresolved(&self) -> Result<Vec<MistakeRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, attempt_id, assessment_id, course_id, question_id, question_text, options, selected_index, correct_index, explanation, timestamp, resolved \
             FROM mistake_bank WHERE resolved = 0 ORDER BY timestamp DESC, id",
        )?;
        let rows = stmt.query_map([], row_to_mistake)?;
        let mut mistakes = Vec::new();
        for r in rows {
            mistakes.push(r?);
        }
        Ok(mistakes)
    }

    pub fn list_for_assessment(
        &self,
        assessment_id: &str,
    ) -> Result<Vec<MistakeRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, attempt_id, assessment_id, course_id, question_id, question_text, options, selected_index, correct_index, explanation, timestamp, resolved \
             FROM mistake_bank WHERE assessment_id = ?1 ORDER BY resolved ASC, timestamp DESC, id",
        )?;
        let rows = stmt.query_map([assessment_id.trim()], row_to_mistake)?;
        let mut mistakes = Vec::new();
        for r in rows {
            mistakes.push(r?);
        }
        Ok(mistakes)
    }

    pub fn resolve(&self, id: &str, updated_at: &str) -> Result<bool, StoreError> {
        self.conn.execute(
            "UPDATE mistake_bank SET resolved = 1, updated_at = ?1 WHERE id = ?2",
            params![updated_at, id.trim()],
        )?;
        Ok(self.conn.changes() > 0)
    }
}

fn row_to_mistake(row: &rusqlite::Row<'_>) -> rusqlite::Result<MistakeRecord> {
    let options_raw: String = row.get(6)?;
    let options: Vec<String> = serde_json::from_str(&options_raw).unwrap_or_default();
    Ok(MistakeRecord {
        id: row.get(0)?,
        attempt_id: row.get(1)?,
        assessment_id: row.get(2)?,
        course_id: row.get(3)?,
        question_id: row.get(4)?,
        question_text: row.get(5)?,
        options,
        selected_index: row.get::<_, i64>(7)? as usize,
        correct_index: row.get::<_, i64>(8)? as usize,
        explanation: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        timestamp: row.get(10)?,
        resolved: row.get::<_, i64>(11)? != 0,
    })
}

// ---------------------------------------------------------------------------
// StudySessionRepo
// ---------------------------------------------------------------------------

pub struct StudySessionRepo<'a> {
    conn: &'a Connection,
}

impl<'a> StudySessionRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn record(&self, session: &StudySessionRecord) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO study_sessions (id, course_id, assessment_id, topic, duration_minutes, timestamp, date_iso) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session.id,
                session.course_id,
                session.assessment_id,
                session.topic,
                i64::from(session.duration_minutes),
                session.timestamp,
                session.date_iso.format("%Y-%m-%d").to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn log(&self, session: &StudySessionRecord) -> Result<(), StoreError> {
        self.record(session)
    }

    pub fn list_all(&self) -> Result<Vec<StudySessionRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, assessment_id, topic, duration_minutes, timestamp, date_iso \
             FROM study_sessions ORDER BY date_iso DESC, timestamp DESC",
        )?;
        let rows = stmt.query_map([], row_to_session)?;
        let mut sessions = Vec::new();
        for r in rows {
            sessions.push(r?);
        }
        Ok(sessions)
    }

    pub fn list_for_course(&self, course_id: &str) -> Result<Vec<StudySessionRecord>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, course_id, assessment_id, topic, duration_minutes, timestamp, date_iso \
             FROM study_sessions WHERE course_id = ?1 COLLATE NOCASE ORDER BY date_iso DESC, timestamp DESC",
        )?;
        let rows = stmt.query_map([course_id.trim()], row_to_session)?;
        let mut sessions = Vec::new();
        for r in rows {
            sessions.push(r?);
        }
        Ok(sessions)
    }

    /// Calculates study analytics (streaks anchored to ref_date, 7-day chart, and course breakdown).
    pub fn get_analytics(
        &self,
        ref_date: NaiveDate,
        courses: &[Course],
    ) -> Result<StudyAnalytics, StoreError> {
        let sessions = self.list_all()?;

        let mut total_focus_minutes = 0u32;
        let mut daily_totals: HashMap<NaiveDate, u32> = HashMap::new();
        let mut course_totals: HashMap<String, u32> = HashMap::new();

        for s in &sessions {
            total_focus_minutes = total_focus_minutes.saturating_add(s.duration_minutes);
            let day_entry = daily_totals.entry(s.date_iso).or_insert(0);
            *day_entry = day_entry.saturating_add(s.duration_minutes);
            if let Some(ref cid) = s.course_id {
                let course_entry = course_totals.entry(cid.clone()).or_insert(0);
                *course_entry = course_entry.saturating_add(s.duration_minutes);
            }
        }

        // Streak & weekly chart calculations (anchored to ref_date via shared core::plan::study)
        let (current_streak_days, best_streak_days) =
            crate::plan::study::calculate_study_streak(&daily_totals, ref_date);
        let weekly_chart =
            crate::plan::study::calculate_weekly_focus_chart(&daily_totals, ref_date);

        // Course breakdown
        let mut course_breakdown = Vec::new();
        for (cid, mins) in course_totals {
            let course = courses.iter().find(|c| c.id.eq_ignore_ascii_case(&cid));
            let course_name = course
                .map(|c| c.name.clone())
                .unwrap_or_else(|| cid.clone());
            let color = course.map(|c| c.color.clone());
            course_breakdown.push(CourseFocusStat {
                course_id: cid,
                course_name,
                minutes: mins,
                color,
            });
        }
        course_breakdown.sort_by_key(|a| std::cmp::Reverse(a.minutes));

        Ok(StudyAnalytics {
            current_streak_days,
            best_streak_days,
            total_focus_minutes,
            weekly_chart,
            course_breakdown,
        })
    }
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<StudySessionRecord> {
    let date_str: String = row.get(6)?;
    let date_iso = NaiveDate::parse_from_str(date_str.trim(), "%Y-%m-%d").map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(StudySessionRecord {
        id: row.get(0)?,
        course_id: row.get(1)?,
        assessment_id: row.get(2)?,
        topic: row.get(3)?,
        duration_minutes: u32::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
        timestamp: row.get(5)?,
        date_iso,
    })
}

pub struct CachedEmailRepo<'a> {
    conn: &'a Connection,
}

impl<'a> CachedEmailRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn save_all(&self, emails: &[CachedEmail], updated_at: &str) -> Result<(), StoreError> {
        let mut stmt = self.conn.prepare(
            "INSERT INTO cached_emails (id, subject, sender, sent_date, snippet, body, body_truncated, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                subject = excluded.subject,
                sender = excluded.sender,
                sent_date = excluded.sent_date,
                snippet = excluded.snippet,
                body = excluded.body,
                body_truncated = excluded.body_truncated,
                updated_at = excluded.updated_at",
        )?;
        for email in emails {
            stmt.execute(params![
                email.id,
                email.subject,
                email.from,
                email.date,
                email.snippet.as_deref(),
                email.body,
                if email.body_truncated { 1 } else { 0 },
                updated_at,
            ])?;
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<CachedEmail>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, subject, sender, sent_date, snippet, body, body_truncated
             FROM cached_emails
             ORDER BY sent_date DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let truncated: i64 = row.get(6)?;
            Ok(CachedEmail {
                id: row.get(0)?,
                subject: row.get(1)?,
                from: row.get(2)?,
                date: row.get(3)?,
                snippet: row.get(4)?,
                body: row.get(5)?,
                body_truncated: truncated != 0,
                internal_date_ms: None,
                history_id: None,
            })
        })?;
        let mut result = Vec::new();
        for email in rows {
            result.push(email?);
        }
        Ok(result)
    }
}

pub struct EmailAiExtractionRepo<'a> {
    conn: &'a Connection,
}

impl<'a> EmailAiExtractionRepo<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub fn get(
        &self,
        cache_key: &str,
    ) -> Result<Option<crate::ai::tasks::ExtractedAssessment>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT extraction_json FROM email_ai_extractions WHERE cache_key = ?1")?;
        let row = stmt
            .query_row(params![cache_key], |r| r.get::<_, String>(0))
            .optional()?;
        match row {
            Some(json) => {
                let parsed: crate::ai::tasks::ExtractedAssessment = serde_json::from_str(&json)?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }

    pub fn put(
        &self,
        cache_key: &str,
        email_id: &str,
        extraction: &crate::ai::tasks::ExtractedAssessment,
        model_id: &str,
        created_at: &str,
    ) -> Result<(), StoreError> {
        let json = serde_json::to_string(extraction)?;
        self.conn.execute(
            "INSERT INTO email_ai_extractions (cache_key, email_id, extraction_json, model_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(cache_key) DO UPDATE SET
                extraction_json = excluded.extraction_json,
                model_id = excluded.model_id,
                created_at = excluded.created_at",
            params![cache_key, email_id, json, model_id, created_at],
        )?;
        Ok(())
    }

    /// Prunes AI extractions older than the given ISO 8601/RFC 3339 cutoff timestamp.
    /// Returns the number of pruned records.
    pub fn prune_older_than(&self, cutoff_iso: &str) -> Result<usize, StoreError> {
        let count = self.conn.execute(
            "DELETE FROM email_ai_extractions WHERE created_at < ?1",
            params![cutoff_iso],
        )?;
        Ok(count)
    }

    /// Prunes AI extractions whose `created_at` timestamp is older than `max_age_days`
    /// relative to `now_iso`.
    pub fn prune_by_age(&self, now_iso: &str, max_age_days: i64) -> Result<usize, StoreError> {
        let now = chrono::DateTime::parse_from_rfc3339(now_iso)
            .map(|dt| dt.naive_utc())
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(now_iso, "%Y-%m-%dT%H:%M:%SZ"))
            .or_else(|_| {
                chrono::NaiveDate::parse_from_str(now_iso, "%Y-%m-%d")
                    .map(|d| d.and_hms_opt(0, 0, 0).unwrap_or_default())
            })
            .map_err(|e| StoreError::Validation(format!("invalid timestamp '{now_iso}': {e}")))?;

        let cutoff = now - chrono::Duration::days(max_age_days);
        let cutoff_str = cutoff.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        self.prune_older_than(&cutoff_str)
    }

    /// Rotates the AI extractions cache for the given active semester.
    /// Extractions belonging to earlier/other semesters (determined by the sent date
    /// of their cached email, or the extraction creation date) are safely deleted.
    /// Orphaned extractions whose emails no longer exist in `cached_emails` are also pruned.
    pub fn rotate_semester(&self, active_semester: &str) -> Result<usize, StoreError> {
        let mut pruned = self.conn.execute(
            "DELETE FROM email_ai_extractions WHERE email_id NOT IN (SELECT id FROM cached_emails)",
            [],
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT e.cache_key, COALESCE(c.sent_date, e.created_at)
             FROM email_ai_extractions e
             LEFT JOIN cached_emails c ON e.email_id = c.id",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut to_delete = Vec::new();
        for row in rows {
            let (cache_key, date_str) = row?;
            let date_prefix = if date_str.len() >= 10 {
                &date_str[..10]
            } else {
                continue;
            };
            if let Ok(d) = chrono::NaiveDate::parse_from_str(date_prefix, "%Y-%m-%d") {
                let inferred = crate::parse::util::infer_semester_from_date(d);
                if !inferred.eq_ignore_ascii_case(active_semester) {
                    to_delete.push(cache_key);
                }
            }
        }

        for key in to_delete {
            pruned += self.conn.execute(
                "DELETE FROM email_ai_extractions WHERE cache_key = ?1",
                params![key],
            )?;
        }

        Ok(pruned)
    }
}

// ---------------------------------------------------------------------------
// ops — the transactional mutations every shell calls
// ---------------------------------------------------------------------------

/// Compositional, transactional operations with derived-state returns.
/// Each opens one transaction (`04` §4.5 item 5), performs its repository
/// calls, commits, then returns a full [`AppSnapshot`] at the reference
/// date — shells never re-derive dashboard/tasks separately.
pub mod ops {
    use super::*;

    /// GET-state equivalent: read without a transaction.
    pub fn load_state(db: &Db, reference_date: NaiveDate) -> Result<AppSnapshot, StoreError> {
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/schedule/save`: replace the whole timetable (semester included).
    pub fn save_schedule(
        db: &Db,
        schedule: &ScheduleData,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            CourseRepo::new(&tx).save_all(schedule, updated_at)?;
            let meta = MetaRepo::new(&tx);
            meta.set_schedule_updated_at(updated_at)?;
            match schedule
                .semester
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(text) => meta.set("schedule_semester", Some(text))?,
                None => meta.set("schedule_semester", None)?,
            }
            match schedule
                .academic_week_start
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(text) => meta.set("schedule_academic_week_start", Some(text))?,
                None => meta.set("schedule_academic_week_start", None)?,
            }
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/schedule/courses:POST`: course upsert + its slot replacement.
    pub fn upsert_course(
        db: &Db,
        course: &Course,
        slots: &[ScheduleSlot],
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            let repo = CourseRepo::new(&tx);
            repo.upsert(course)?;
            repo.replace_course_slots(&course.id, slots, updated_at)?;
            MetaRepo::new(&tx).set_schedule_updated_at(updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/schedule/courses/:id:DELETE` (ASCII-case-insensitive), which
    /// also drops the course's slots (v4 parity).
    pub fn delete_course(
        db: &Db,
        code: &str,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            CourseRepo::new(&tx).delete(code)?;
            MetaRepo::new(&tx).set_schedule_updated_at(updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// Scan-pipeline entry (phase 05): the fresh radar replaces the old one
    /// while user-owned fields survive reannouncement.
    ///
    /// An empty incoming set is REFUSED (loudly): a scan that found nothing
    /// must not wipe the radar. Callers that really mean "clear the radar"
    /// use [`replace_assessments_allowing_empty`].
    pub fn replace_assessments(
        db: &Db,
        assessments: &[Assessment],
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        replace_assessments_with(
            db,
            assessments,
            EmptyReplace::Refuse,
            updated_at,
            reference_date,
        )
    }

    /// Explicit full replace: the caller declares that an empty result
    /// really means "nothing is left" (a user-requested reset, a restore of
    /// an empty backup) — only then may the radar be cleared.
    pub fn replace_assessments_allowing_empty(
        db: &Db,
        assessments: &[Assessment],
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        replace_assessments_with(
            db,
            assessments,
            EmptyReplace::Allow,
            updated_at,
            reference_date,
        )
    }

    /// Shared body of the two replace entry points.
    fn replace_assessments_with(
        db: &Db,
        assessments: &[Assessment],
        empty: EmptyReplace,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            AssessmentRepo::new(&tx).replace_all(assessments, updated_at, empty)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    pub fn upsert_assessment(
        db: &Db,
        assessment: &Assessment,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            AssessmentRepo::new(&tx).upsert(assessment, updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    pub fn delete_assessment(
        db: &Db,
        id: &str,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        let _ = updated_at;
        {
            let tx = db.transaction()?;
            AssessmentRepo::new(&tx).delete(id)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/events/custom:POST` (upsert semantics, v4 parity).
    pub fn upsert_custom_event(
        db: &Db,
        event: &CustomCalendarEvent,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            EventRepo::new(&tx).upsert(event, updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/events/custom/:id:DELETE`.
    pub fn delete_custom_event(
        db: &Db,
        id: &str,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        let _ = updated_at;
        {
            let tx = db.transaction()?;
            EventRepo::new(&tx).delete(id)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/study/toggle`.
    pub fn set_topic_done(
        db: &Db,
        key: &str,
        done: bool,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            TopicRepo::new(&tx).set(key, done, updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/assessments/:id/grade` (explicit-null-clears semantics).
    pub fn update_grade(
        db: &Db,
        id: &str,
        change: &GradeChange,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            GradeRepo::new(&tx).update(id, change, updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/feeds/save` (https-only + ≤10 cap).
    pub fn save_feed(
        db: &Db,
        feed: &FeedConfig,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            FeedRepo::new(&tx).save(feed, updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// `/api/feeds/delete`.
    pub fn delete_feed(
        db: &Db,
        id: &str,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        let _ = updated_at;
        {
            let tx = db.transaction()?;
            FeedRepo::new(&tx).delete(id)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    pub fn record_attendance(
        db: &Db,
        entry: &AttendanceEntry,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            AttendanceRepo::new(&tx).record(entry)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    /// Deletes the persisted attendance mark for one slot occurrence. The
    /// deterministic id mirrors the one `record_attendance` (and the ffi
    /// export) mint, so the delete hits exactly the row that was written.
    pub fn delete_attendance(
        db: &Db,
        slot_id: &str,
        date_iso: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            AttendanceRepo::new(&tx).delete(&format!("att-{slot_id}-{date_iso}"))?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    pub fn set_course_absence_limit(
        db: &Db,
        course_id: &str,
        max_absences: Option<u32>,
        updated_at: &str,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            CourseRepo::new(&tx).set_max_absences(course_id, max_absences)?;
            MetaRepo::new(&tx).set_schedule_updated_at(updated_at)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    pub fn log_study_session(
        db: &Db,
        session: &StudySessionRecord,
        reference_date: NaiveDate,
    ) -> Result<AppSnapshot, StoreError> {
        {
            let tx = db.transaction()?;
            StudySessionRepo::new(&tx).record(session)?;
            tx.commit()?;
        }
        read_snapshot(db.conn(), reference_date)
    }

    pub fn get_study_analytics(db: &Db, ref_date: NaiveDate) -> Result<StudyAnalytics, StoreError> {
        let courses = CourseRepo::new(db.conn()).list()?;
        StudySessionRepo::new(db.conn()).get_analytics(ref_date, &courses)
    }

    pub fn save_quiz_attempt(
        db: &Db,
        attempt: &QuizAttempt,
        mistakes: &[MistakeRecord],
        updated_at: &str,
    ) -> Result<(), StoreError> {
        let tx = db.transaction()?;
        QuizAttemptRepo::new(&tx).record(attempt)?;
        let mistake_repo = MistakeRepo::new(&tx);
        for m in mistakes {
            mistake_repo.record(m, updated_at)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_mistakes(
        db: &Db,
        assessment_id: Option<&str>,
    ) -> Result<Vec<MistakeRecord>, StoreError> {
        let repo = MistakeRepo::new(db.conn());
        match assessment_id {
            Some(aid) if !aid.trim().is_empty() => repo.list_for_assessment(aid),
            _ => repo.list_all(),
        }
    }

    pub fn resolve_mistake(
        db: &Db,
        mistake_id: &str,
        updated_at: &str,
    ) -> Result<bool, StoreError> {
        let tx = db.transaction()?;
        let res = MistakeRepo::new(&tx).resolve(mistake_id, updated_at)?;
        tx.commit()?;
        Ok(res)
    }

    pub fn upsert_flashcard(
        db: &Db,
        card: &Flashcard,
        updated_at: &str,
    ) -> Result<Flashcard, StoreError> {
        let tx = db.transaction()?;
        FlashcardRepo::new(&tx).upsert(card, updated_at)?;
        tx.commit()?;
        Ok(card.clone())
    }

    pub fn list_flashcards(db: &Db, course_id: Option<&str>) -> Result<Vec<Flashcard>, StoreError> {
        let repo = FlashcardRepo::new(db.conn());
        match course_id {
            Some(cid) if !cid.trim().is_empty() => repo.list_for_course(cid),
            _ => repo.list_all(),
        }
    }

    pub fn delete_flashcard(db: &Db, id: &str) -> Result<bool, StoreError> {
        let tx = db.transaction()?;
        let res = FlashcardRepo::new(&tx).delete(id)?;
        tx.commit()?;
        Ok(res)
    }

    pub fn review_flashcard(
        db: &Db,
        id: &str,
        correct: bool,
        today: NaiveDate,
        updated_at: &str,
    ) -> Result<Option<Flashcard>, StoreError> {
        let tx = db.transaction()?;
        let res = FlashcardRepo::new(&tx).review(id, correct, today, updated_at)?;
        tx.commit()?;
        Ok(res)
    }

    pub fn save_cached_emails(
        db: &Db,
        emails: &[CachedEmail],
        updated_at: &str,
    ) -> Result<(), StoreError> {
        let tx = db.transaction()?;
        CachedEmailRepo::new(&tx).save_all(emails, updated_at)?;
        tx.commit()?;
        Ok(())
    }

    pub fn load_cached_emails(db: &Db) -> Result<Vec<CachedEmail>, StoreError> {
        CachedEmailRepo::new(db.conn()).list()
    }

    pub fn get_email_ai_extraction(
        db: &Db,
        cache_key: &str,
    ) -> Result<Option<crate::ai::tasks::ExtractedAssessment>, StoreError> {
        EmailAiExtractionRepo::new(db.conn()).get(cache_key)
    }

    pub fn save_email_ai_extraction(
        db: &Db,
        cache_key: &str,
        email_id: &str,
        extraction: &crate::ai::tasks::ExtractedAssessment,
        model_id: &str,
        created_at: &str,
    ) -> Result<(), StoreError> {
        let tx = db.transaction()?;
        EmailAiExtractionRepo::new(&tx)
            .put(cache_key, email_id, extraction, model_id, created_at)?;
        tx.commit()?;
        Ok(())
    }

    pub fn prune_email_ai_extractions_by_age(
        db: &Db,
        now_iso: &str,
        max_age_days: i64,
    ) -> Result<usize, StoreError> {
        let tx = db.transaction()?;
        let count = EmailAiExtractionRepo::new(&tx).prune_by_age(now_iso, max_age_days)?;
        tx.commit()?;
        Ok(count)
    }

    pub fn rotate_email_ai_extractions_semester(
        db: &Db,
        active_semester: &str,
    ) -> Result<usize, StoreError> {
        let tx = db.transaction()?;
        let count = EmailAiExtractionRepo::new(&tx).rotate_semester(active_semester)?;
        tx.commit()?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::types::{
        AssessmentSource, AssessmentType, Course, CustomCalendarEvent, FeedConfig, GradeRecord,
        ScheduleData, ScheduleSlot, UrgencyLevel,
    };
    use chrono::{NaiveDate, NaiveTime};

    fn mem_db() -> Db {
        Db::open_in_memory().unwrap()
    }

    fn ref_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 24).unwrap()
    }

    fn on(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    fn course(id: &str, name: &str) -> Course {
        Course {
            id: id.to_string(),
            name: name.to_string(),
            color: "#2563EB".to_string(),
            bg: None,
            border: None,
            credits: None,
            max_absences: None,
        }
    }

    fn slot(
        id: &str,
        day: &str,
        the_course: &Course,
        start: (u32, u32),
        end: (u32, u32),
    ) -> ScheduleSlot {
        ScheduleSlot {
            id: id.to_string(),
            day: day.to_string(),
            day_index: 0,
            course_id: the_course.id.clone(),
            course_name: the_course.name.clone(),
            slot_type: "Lecture".to_string(),
            group: None,
            room: None,
            start_time: NaiveTime::from_hms_opt(start.0, start.1, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(end.0, end.1, 0).unwrap(),
            display_time: String::new(),
            has_quiz: false,
            quiz_title: None,
            week_parity: None,
        }
    }

    /// A schedule slot with a blank id (the store assigns `slot-N`).
    fn raw_slot(
        day: &str,
        course_id: &str,
        course_name: &str,
        start: (u32, u32),
        end: (u32, u32),
    ) -> ScheduleSlot {
        ScheduleSlot {
            id: String::new(),
            day: day.to_string(),
            day_index: 0,
            course_id: course_id.to_string(),
            course_name: course_name.to_string(),
            slot_type: "Lecture".to_string(),
            group: None,
            room: None,
            start_time: NaiveTime::from_hms_opt(start.0, start.1, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(end.0, end.1, 0).unwrap(),
            display_time: String::new(),
            has_quiz: false,
            quiz_title: None,
            week_parity: None,
        }
    }

    fn assessment(id: &str, course_id: Option<&str>, title: &str, when: &str) -> Assessment {
        Assessment {
            id: id.to_string(),
            course_id: course_id.map(str::to_string),
            course_name: None,
            title: title.to_string(),
            assessment_type: AssessmentType::ClassQuiz,
            date: Some(on(when)),
            day_name: None,
            start_time: None,
            end_time: None,
            display_time: None,
            room: None,
            group: None,
            instructor: None,
            is_upcoming: true,
            days_until: Some(3),
            urgency_level: UrgencyLevel::Upcoming,
            priority_score: 10,
            topics: vec!["Logic gates".to_string()],
            warnings: Vec::new(),
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
            elearning_url: None,
            google_cal_url: None,
            gcal_synced: false,
            gcal_event_id: None,
            color: None,
            bg: None,
            border: None,
            semester: None,
            email_subject: None,
            email_sent_date: None,
            source: AssessmentSource::gmail_default(),
            source_icon: None,
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
            last_seen_source_run: None,
            retired_source_run: None,
        }
    }

    fn feed(id: &str, url: &str) -> FeedConfig {
        FeedConfig {
            id: id.to_string(),
            name: "Campus Calendar".to_string(),
            url: url.to_string(),
            enabled: true,
        }
    }

    // --- courses -----------------------------------------------------------

    #[test]
    fn course_upsert_is_case_insensitive() {
        let db = mem_db();
        ops::upsert_course(
            &db,
            &course("CSE241", "Digital Design"),
            &[],
            "2026-10-24T00:00:00Z",
            ref_date(),
        )
        .unwrap();
        let snapshot = ops::upsert_course(
            &db,
            &course("cse241", "Digital Design Lab"),
            &[],
            "2026-10-24T01:00:00Z",
            ref_date(),
        )
        .unwrap();
        let courses = snapshot.schedule.courses;
        assert_eq!(
            courses.len(),
            1,
            "a differently-cased re-upsert replaces, not duplicates"
        );
        assert_eq!(courses[0].id, "cse241");
        assert_eq!(courses[0].name, "Digital Design Lab");
    }

    #[test]
    fn course_upsert_rejects_blanks() {
        let db = mem_db();
        let err =
            ops::upsert_course(&db, &course("", "No Code"), &[], "s1", ref_date()).unwrap_err();
        assert!(err.to_string().contains("non-empty code"));
        let err =
            ops::upsert_course(&db, &course("CSE241", "   "), &[], "s1", ref_date()).unwrap_err();
        assert!(err.to_string().contains("needs a title"));
    }

    #[test]
    fn course_delete_removes_its_slots() {
        let db = mem_db();
        let base = course("MTH115", "Linear Algebra");
        ops::upsert_course(
            &db,
            &base,
            &[slot("slot-1", "Tue", &base, (8, 0), (9, 30))],
            "2026-10-24T00:00:00Z",
            ref_date(),
        )
        .unwrap();

        let snapshot =
            ops::delete_course(&db, "mth115", "2026-10-24T01:00:00Z", ref_date()).unwrap();
        assert!(
            snapshot.schedule.courses.is_empty(),
            "delete is case-insensitive"
        );
        assert!(
            snapshot.schedule.slots.is_empty(),
            "the course's slots go with it"
        );
    }

    // --- slots / schedule --------------------------------------------------

    #[test]
    fn slots_normalize_and_reject_bad_input() {
        let db = mem_db();
        let base = course("CSE241", "Digital Design");

        // Unknown weekday name AND an out-of-range index → honest error.
        let mut bogus = slot("slot-1", "Funday", &base, (9, 0), (10, 30));
        bogus.day_index = 9;
        let err = ops::upsert_course(
            &db,
            &base.clone(),
            &[bogus],
            "2026-10-24T00:00:00Z",
            ref_date(),
        )
        .unwrap_err();
        assert!(err.to_string().contains("weekday"), "{err}");

        // Empty day names are refused outright.
        let err = ops::upsert_course(
            &db,
            &base.clone(),
            &[slot("slot-1", "", &base, (9, 0), (10, 30))],
            "2026-10-24T00:00:00Z",
            ref_date(),
        )
        .unwrap_err();
        assert!(err.to_string().contains("weekday (day name)"), "{err}");

        // Inverted times.
        let err = ops::upsert_course(
            &db,
            &base.clone(),
            &[slot("slot-2", "Sun", &base, (10, 0), (8, 0))],
            "2026-10-24T00:00:00Z",
            ref_date(),
        )
        .unwrap_err();
        assert!(err.to_string().contains("ends before it starts"), "{err}");

        // Good slot: day_index derived, display_time "HH:MM–HH:MM" (en dash).
        let snapshot = ops::upsert_course(
            &db,
            &base.clone(),
            &[slot("slot-3", "Sun", &base, (8, 0), (10, 30))],
            "2026-10-24T00:00:00Z",
            ref_date(),
        )
        .unwrap();
        let stored = &snapshot.schedule.slots[0];
        assert_eq!(stored.day_index, 0);
        assert_eq!(stored.display_time, "08:00–10:30");
    }

    #[test]
    fn save_all_writes_semester_and_assigns_slot_ids() {
        let db = mem_db();
        let schedule = ScheduleData {
            semester: Some("Fall 2026".to_string()),
            academic_week_start: None,
            courses: vec![
                course("CSE241", "Digital Design"),
                course("MTH115", "Linear Algebra"),
            ],
            slots: vec![
                raw_slot("Sun", "CSE241", "Digital Design", (9, 0), (10, 30)),
                raw_slot("Tue", "MTH115", "Linear Algebra", (8, 0), (9, 30)),
            ],
        };
        let snapshot =
            ops::save_schedule(&db, &schedule, "2026-10-24T00:00:00Z", ref_date()).unwrap();
        assert_eq!(snapshot.schedule.semester.as_deref(), Some("Fall 2026"));
        assert_eq!(snapshot.schedule.courses.len(), 2);
        assert_eq!(
            snapshot.schedule.slots.len(),
            2,
            "blank slot ids get assigned"
        );
        assert!(snapshot.schedule.slots.iter().all(|s| !s.id.is_empty()));
        let meta = MetaRepo::new(db.conn());
        assert_eq!(
            meta.schedule_updated_at().unwrap().as_deref(),
            Some("2026-10-24T00:00:00Z")
        );
    }

    // --- assessments -------------------------------------------------------

    #[test]
    fn replace_all_preserves_user_fields_by_id() {
        let db = mem_db();
        let first = assessment(
            "email-1",
            Some("CSE241"),
            "Quiz 1 — Digital Logic",
            "2026-11-05",
        );
        let first = Assessment {
            gcal_synced: true,
            gcal_event_id: Some("evt-7".into()),
            achieved_score: Some(9.5),
            max_score: Some(15.0),
            weightage_percent: Some(10.0),
            ..first
        };
        ops::replace_assessments(&db, &[first], "s1", ref_date()).unwrap();

        // Reannouncement: new snapshot, no grade data in the scan — user
        // fields must survive.
        let second = assessment(
            "email-1",
            Some("CSE241"),
            "Quiz 1 — Digital Logic",
            "2026-11-05",
        );
        ops::replace_assessments(&db, &[second], "s2", ref_date()).unwrap();
        let stored = AssessmentRepo::new(db.conn())
            .get("email-1")
            .unwrap()
            .unwrap();
        assert!(stored.gcal_synced);
        assert_eq!(stored.gcal_event_id.as_deref(), Some("evt-7"));
        assert_eq!(stored.achieved_score, Some(9.5));
        assert_eq!(stored.max_score, Some(15.0));
    }

    #[test]
    fn replace_all_preserves_user_fields_by_merge_key() {
        let db = mem_db();
        let first = assessment(
            "email-1",
            Some("CSE241"),
            "Quiz 1 — Digital Logic",
            "2026-11-05",
        );
        let first = Assessment {
            achieved_score: Some(12.0),
            ..first
        };
        ops::replace_assessments(&db, &[first], "s1", ref_date()).unwrap();

        // Same source + course + title + date scan again, but with a fresh
        // id (reparse under a new announcement id).
        let third = assessment(
            "email-42",
            Some("CSE241"),
            "Quiz 1 — Digital Logic",
            "2026-11-05",
        );
        ops::replace_assessments(&db, &[third], "s2", ref_date()).unwrap();
        let stored = AssessmentRepo::new(db.conn())
            .get("email-42")
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.achieved_score,
            Some(12.0),
            "reannouncement keeps the recording"
        );
    }

    #[test]
    fn replace_all_is_a_honest_whole_radar_replace() {
        let db = mem_db();
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s1",
            ref_date(),
        )
        .unwrap();

        // An empty scan does NOT delete everything: it fails loudly and the
        // radar stays exactly as it was (the latent radar wipe).
        let err = ops::replace_assessments(&db, &[], "s2", ref_date()).unwrap_err();
        assert!(
            err.to_string()
                .contains("Refusing to clear the whole radar"),
            "{err}"
        );
        assert_eq!(
            AssessmentRepo::new(db.conn()).list().unwrap().len(),
            1,
            "the existing assessment survives the refused empty scan"
        );

        // An explicit full replace — the caller says "there really is
        // nothing left" — does clear the radar.
        ops::replace_assessments_allowing_empty(&db, &[], "s3", ref_date()).unwrap();
        assert!(AssessmentRepo::new(db.conn()).list().unwrap().is_empty());

        // A new scan with only "b" removes stale "a"-like rows.
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s4",
            ref_date(),
        )
        .unwrap();
        ops::replace_assessments(
            &db,
            &[assessment("b", None, "B", "2026-11-06")],
            "s5",
            ref_date(),
        )
        .unwrap();
        let list = AssessmentRepo::new(db.conn()).list().unwrap();
        assert_eq!(
            list.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            vec!["b"]
        );
    }

    #[test]
    fn empty_replace_needs_an_explicit_opt_in() {
        let db = mem_db();
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s1",
            ref_date(),
        )
        .unwrap();

        // The default is the safe one: refuse.
        assert_eq!(EmptyReplace::default(), EmptyReplace::Refuse);
        let err = AssessmentRepo::new(db.conn())
            .replace_all(&[], "s2", EmptyReplace::Refuse)
            .unwrap_err();
        assert!(
            err.to_string()
                .contains("Refusing to clear the whole radar"),
            "{err}"
        );
        assert_eq!(
            AssessmentRepo::new(db.conn()).list().unwrap().len(),
            1,
            "nothing was deleted by the refused replace"
        );

        // The explicit opt-in clears the radar.
        AssessmentRepo::new(db.conn())
            .replace_all(&[], "s3", EmptyReplace::Allow)
            .unwrap();
        assert!(AssessmentRepo::new(db.conn()).list().unwrap().is_empty());
    }

    #[test]
    fn replace_all_rejects_blank_ids() {
        let db = mem_db();
        let err = ops::replace_assessments(
            &db,
            &[assessment(" ", None, "No id", "2026-11-05")],
            "s",
            ref_date(),
        )
        .unwrap_err();
        assert!(err.to_string().contains("id must not be empty"));
    }

    // --- topics ------------------------------------------------------------

    #[test]
    fn topics_are_true_only_and_merge_additively() {
        let db = mem_db();
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s1",
            ref_date(),
        )
        .unwrap();

        let key_a = topic_key_for_text("a", "Chapter 1");
        let key_b = topic_key_for_text("a", "Chapter 2");
        ops::set_topic_done(&db, &key_a, true, "t1", ref_date()).unwrap();
        ops::set_topic_done(&db, &key_a, false, "t2", ref_date()).unwrap();
        let topics = TopicRepo::new(db.conn()).all().unwrap();
        assert!(
            !topics.contains_key(&key_a),
            "unchecking removes the row — no false rows in the store"
        );

        ops::set_topic_done(&db, &key_a, true, "t3", ref_date()).unwrap();
        // A remote backup with `false` for the same key never un-completes.
        let mut remote: CompletedTopics = CompletedTopics::new();
        remote.insert(key_a.clone(), false);
        remote.insert(key_b.clone(), true);
        let merged = TopicRepo::new(db.conn())
            .merge_additive(&remote, "t4")
            .unwrap();
        assert_eq!(merged, 1, "only the true entry is added");
        let topics = TopicRepo::new(db.conn()).all().unwrap();
        assert_eq!(topics.get(&key_a), Some(&true));
        assert_eq!(topics.get(&key_b), Some(&true));
    }

    // --- grades ------------------------------------------------------------

    #[test]
    fn grades_keep_clear_and_set_semantics() {
        let db = mem_db();
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s1",
            ref_date(),
        )
        .unwrap();

        ops::update_grade(
            &db,
            "a",
            &GradeChange {
                achieved_score: FieldUpdate::Set(7.0),
                max_score: FieldUpdate::Set(10.0),
                weightage_percent: FieldUpdate::Set(5.0),
            },
            "t1",
            ref_date(),
        )
        .unwrap();
        let grades = GradeRepo::new(db.conn()).all().unwrap();
        assert_eq!(grades.get("a").unwrap().achieved_score, Some(7.0));

        // Keep: an empty change stays as-is.
        let unchanged = ops::update_grade(
            &db,
            "a",
            &GradeChange {
                achieved_score: FieldUpdate::Keep,
                max_score: FieldUpdate::Keep,
                weightage_percent: FieldUpdate::Keep,
            },
            "t2",
            ref_date(),
        )
        .unwrap();
        assert_eq!(unchanged.grades.get("a").unwrap().achieved_score, Some(7.0));

        // Explicit null clears — never coerced into 0.
        ops::update_grade(
            &db,
            "a",
            &GradeChange {
                achieved_score: FieldUpdate::Clear,
                max_score: FieldUpdate::Keep,
                weightage_percent: FieldUpdate::Keep,
            },
            "t3",
            ref_date(),
        )
        .unwrap();
        let grades = GradeRepo::new(db.conn()).all().unwrap();
        assert_eq!(grades.get("a").unwrap().achieved_score, None);
        assert_eq!(grades.get("a").unwrap().max_score, Some(10.0));
    }

    #[test]
    fn grades_validate_and_delete_when_empty() {
        let db = mem_db();
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s1",
            ref_date(),
        )
        .unwrap();

        let err = ops::update_grade(
            &db,
            "a",
            &GradeChange {
                achieved_score: FieldUpdate::Set(-1.0),
                max_score: FieldUpdate::Keep,
                weightage_percent: FieldUpdate::Keep,
            },
            "t1",
            ref_date(),
        )
        .unwrap_err();
        assert!(err.to_string().contains("non-negative"), "{err}");

        ops::update_grade(
            &db,
            "a",
            &GradeChange {
                achieved_score: FieldUpdate::Set(7.0),
                max_score: FieldUpdate::Set(10.0),
                weightage_percent: FieldUpdate::Keep,
            },
            "t2",
            ref_date(),
        )
        .unwrap();
        // Clearing every field deletes the record (a stored empty grade
        // would fabricate a "recorded" state).
        ops::update_grade(
            &db,
            "a",
            &GradeChange {
                achieved_score: FieldUpdate::Clear,
                max_score: FieldUpdate::Clear,
                weightage_percent: FieldUpdate::Keep,
            },
            "t3",
            ref_date(),
        )
        .unwrap();
        assert!(GradeRepo::new(db.conn()).get("a").unwrap().is_none());

        // Grade writes for unknown assessments fail honestly.
        let err =
            ops::update_grade(&db, "ghost", &GradeChange::default(), "t4", ref_date()).unwrap_err();
        assert!(err.to_string().contains("Assessment not found."));
    }

    #[test]
    fn grade_merge_upsert_is_additive() {
        let db = mem_db();
        ops::replace_assessments(
            &db,
            &[assessment("a", None, "A", "2026-11-05")],
            "s1",
            ref_date(),
        )
        .unwrap();
        let grade_repo = GradeRepo::new(db.conn());

        grade_repo
            .write(
                "a",
                &GradeRecord {
                    achieved_score: Some(9.5),
                    max_score: Some(15.0),
                    weightage_percent: Some(10.0),
                },
                "t1",
            )
            .unwrap();

        // Remote carries a newer achieved but no max/weightage: fill, don't erase.
        let changed = grade_repo
            .merge_upsert(
                "a",
                &GradeRecord {
                    achieved_score: Some(11.0),
                    max_score: None,
                    weightage_percent: None,
                },
                "t2",
            )
            .unwrap();
        assert!(changed);
        let merged = grade_repo.get("a").unwrap().unwrap();
        assert_eq!(merged.achieved_score, Some(11.0));
        assert_eq!(
            merged.max_score,
            Some(15.0),
            "remote can't erase a local field it lacks"
        );
        assert_eq!(merged.weightage_percent, Some(10.0));

        // An empty remote record changes nothing.
        let changed = grade_repo
            .merge_upsert("a", &GradeRecord::default(), "t3")
            .unwrap();
        assert!(!changed);
    }

    // --- custom events -----------------------------------------------------

    #[test]
    fn custom_events_need_id_and_title() {
        let db = mem_db();
        let mut event = CustomCalendarEvent {
            id: String::new(),
            title: "Reread flip-flop timing tables".to_string(),
            course_id: None,
            event_type: Some("Study Session".to_string()),
            date: Some(on("2026-11-04")),
            start_time: Some(NaiveTime::from_hms_opt(18, 0, 0).unwrap()),
            end_time: Some(NaiveTime::from_hms_opt(19, 30, 0).unwrap()),
            room: None,
            notes: None,
            color: None,
        };
        let err = ops::upsert_custom_event(&db, &event, "t", ref_date()).unwrap_err();
        assert!(err.to_string().contains("id"), "{err}");

        event.id = "custom-1778000500".to_string();
        event.title = " ".to_string();
        let err = ops::upsert_custom_event(&db, &event, "t", ref_date()).unwrap_err();
        assert!(err.to_string().contains("title"), "{err}");

        event.title = "Reread flip-flop timing tables".to_string();
        let snapshot = ops::upsert_custom_event(&db, &event, "t", ref_date()).unwrap();
        assert_eq!(snapshot.custom_events.len(), 1);
        assert!(
            ops::delete_custom_event(&db, "custom-1778000500", "t", ref_date())
                .unwrap()
                .custom_events
                .is_empty()
        );
    }

    // --- feeds -------------------------------------------------------------

    #[test]
    fn feeds_are_https_only() {
        assert!(validate_feed_url("http://insecure.example.edu/ics").is_err());
        assert!(validate_feed_url("ftp://old.example.edu/ics").is_err());
        assert!(validate_feed_url("https://campus.example.edu/calendar.ics").is_ok());
        assert!(validate_feed_url("").is_err());
    }

    #[test]
    fn feeds_cap_at_ten() {
        let db = mem_db();
        for index in 0..10 {
            let got = feed(
                &format!("feed-{index}"),
                &format!("https://cal{index}.example.edu/ics"),
            );
            ops::save_feed(&db, &got, "t", ref_date()).unwrap();
        }
        let eleventh = feed("feed-10", "https://cal10.example.edu/ics");
        let err = ops::save_feed(&db, &eleventh, "t", ref_date()).unwrap_err();
        assert!(
            err.to_string().contains("at most 10 calendar feeds"),
            "{err}"
        );

        // Updating an existing one stays allowed at the cap.
        assert!(ops::save_feed(
            &db,
            &feed("feed-3", "https://cal3-other.example.edu/ics"),
            "t",
            ref_date()
        )
        .is_ok());
    }

    // --- config + meta -----------------------------------------------------

    #[test]
    fn config_defaults_and_roundtrip() {
        let db = mem_db();
        let config = ConfigRepo::new(db.conn());
        // v5 honesty: automatic push-to-GCal is opt-in, never on by default.
        assert!(!config.auto_sync_gcal().unwrap());
        assert!(!config.onboarding_completed().unwrap());
        config.set_bool("onboarding_completed", true).unwrap();
        assert!(config.onboarding_completed().unwrap());
        assert!(config.get_bool("never_set", true).unwrap());
        assert_eq!(config.get_string("never_set").unwrap(), None);
        config
            .set_string("generic_label", Some("https://moodle.example.edu/feed"))
            .unwrap();
        assert_eq!(
            config.get_string("generic_label").unwrap().as_deref(),
            Some("https://moodle.example.edu/feed")
        );

        let meta = MetaRepo::new(db.conn());
        assert_eq!(meta.schedule_updated_at().unwrap(), None);
        meta.set_schedule_updated_at("2026-10-24T10:00:00Z")
            .unwrap();
        meta.set("schedule_semester", Some("Fall 2026")).unwrap();
        assert_eq!(
            meta.schedule_updated_at().unwrap().as_deref(),
            Some("2026-10-24T10:00:00Z")
        );
        assert_eq!(
            meta.get("schedule_semester").unwrap().as_deref(),
            Some("Fall 2026")
        );
        assert_eq!(meta.last_gmail_sync().unwrap(), None);
    }

    // --- snapshot derivation ------------------------------------------------

    #[test]
    fn snapshot_carries_fresh_derived_dashboard_and_tasks() {
        let db = mem_db();
        // 2026-10-27 is 3 days after the reference date → this week.
        ops::save_schedule(
            &db,
            &ScheduleData {
                semester: Some("Fall 2026".into()),
                academic_week_start: None,
                courses: vec![course("CSE241", "Digital Design")],
                slots: Vec::new(),
            },
            "st",
            ref_date(),
        )
        .unwrap();
        let mut a = assessment("a", Some("CSE241"), "Quiz 1 — Digital Logic", "2026-10-27");
        a.topics = vec!["Logic gates".to_string(), "Karnaugh maps".to_string()];
        ops::replace_assessments(&db, &[a], "s1", ref_date()).unwrap();
        let snapshot = ops::set_topic_done(
            &db,
            &topic_key_for_text("a", "Logic gates"),
            true,
            "t1",
            ref_date(),
        )
        .unwrap();
        let dashboard = snapshot.derived.dashboard;
        assert_eq!(dashboard.reference_date, ref_date());
        assert_eq!(dashboard.next_up.as_ref().map(|x| x.id.as_str()), Some("a"));
        assert!(dashboard.upcoming_this_week.iter().any(|x| x.id == "a"));
        assert_eq!(dashboard.total_topics_count, 2);
        assert_eq!(dashboard.completed_topics_count, 1);
        assert!(
            dashboard.readiness_percent > 0 && dashboard.readiness_percent <= 100,
            "one of two topics checked ⇒ partial but present readiness ({})",
            dashboard.readiness_percent
        );

        let tasks = snapshot.derived.tasks;
        assert!(
            tasks.total_tasks >= 1,
            "deterministic planner produced study tasks"
        );
        assert!(
            !tasks.ai_generated,
            "the fallback is deterministic, never pretend-AI"
        );

        // Derived countdown is stamped at read time, not at scan time.
        assert_eq!(snapshot.assessments[0].days_until, Some(3));
    }

    // --- Milestone 1: Attendance, Flashcards, Quizzes, Mistakes, Sessions, Migration ---

    #[test]
    fn attendance_repo_crud_and_summary_warnings() {
        let db = mem_db();
        ops::save_schedule(
            &db,
            &ScheduleData {
                semester: Some("Fall 2026".into()),
                academic_week_start: None,
                courses: vec![Course {
                    id: "CSE241".into(),
                    name: "Digital Design".into(),
                    color: "#2563EB".into(),
                    bg: None,
                    border: None,
                    credits: Some(3.0),
                    max_absences: Some(4),
                }],
                slots: vec![ScheduleSlot {
                    id: "slot-1".into(),
                    day: "Sun".into(),
                    day_index: 0,
                    course_id: "CSE241".into(),
                    course_name: "Digital Design".into(),
                    slot_type: "Lecture".into(),
                    group: None,
                    room: None,
                    start_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                    end_time: NaiveTime::from_hms_opt(10, 30, 0).unwrap(),
                    display_time: "09:00–10:30".into(),
                    has_quiz: false,
                    quiz_title: None,
                    week_parity: Some("all".into()),
                }],
            },
            "st",
            ref_date(),
        )
        .unwrap();

        let att_repo = AttendanceRepo::new(db.conn());
        let date1 = NaiveDate::from_ymd_opt(2026, 10, 25).unwrap();
        let date2 = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        let date3 = NaiveDate::from_ymd_opt(2026, 11, 8).unwrap();
        let date4 = NaiveDate::from_ymd_opt(2026, 11, 15).unwrap();

        att_repo
            .record(&AttendanceEntry {
                id: "att-1".into(),
                slot_id: "slot-1".into(),
                course_id: "CSE241".into(),
                date_iso: date1,
                status: AttendanceStatus::Attended,
                updated_at: "t1".into(),
            })
            .unwrap();

        att_repo
            .record(&AttendanceEntry {
                id: "att-2".into(),
                slot_id: "slot-1".into(),
                course_id: "CSE241".into(),
                date_iso: date2,
                status: AttendanceStatus::Absent,
                updated_at: "t2".into(),
            })
            .unwrap();

        att_repo
            .record(&AttendanceEntry {
                id: "att-3".into(),
                slot_id: "slot-1".into(),
                course_id: "CSE241".into(),
                date_iso: date3,
                status: AttendanceStatus::Absent,
                updated_at: "t3".into(),
            })
            .unwrap();

        att_repo
            .record(&AttendanceEntry {
                id: "att-4".into(),
                slot_id: "slot-1".into(),
                course_id: "CSE241".into(),
                date_iso: date4,
                status: AttendanceStatus::Absent,
                updated_at: "t4".into(),
            })
            .unwrap();

        let summary = att_repo.course_summary("CSE241").unwrap();
        assert_eq!(summary.total_classes, 4);
        assert_eq!(summary.attended, 1);
        assert_eq!(summary.absent, 3);
        assert_eq!(summary.excused, 0);
        assert_eq!(summary.max_absences, Some(4));
        assert!(!summary.is_critical);
        assert_eq!(
            summary.warning_chip.as_deref(),
            Some("1 Absence Left (3/4)")
        );

        // Record a 4th absence hitting the critical threshold
        let date5 = NaiveDate::from_ymd_opt(2026, 11, 22).unwrap();
        att_repo
            .record(&AttendanceEntry {
                id: "att-5".into(),
                slot_id: "slot-1".into(),
                course_id: "CSE241".into(),
                date_iso: date5,
                status: AttendanceStatus::Absent,
                updated_at: "t5".into(),
            })
            .unwrap();

        let crit_summary = att_repo.course_summary("CSE241").unwrap();
        assert_eq!(crit_summary.absent, 4);
        assert!(crit_summary.is_critical);
        assert_eq!(
            crit_summary.warning_chip.as_deref(),
            Some("Limit Reached! (4/4)")
        );

        // Modifying absence limit via CourseRepo
        let course_repo = CourseRepo::new(db.conn());
        course_repo.set_max_absences("CSE241", Some(6)).unwrap();
        let updated_summary = att_repo.course_summary("CSE241").unwrap();
        assert_eq!(updated_summary.max_absences, Some(6));
        assert!(!updated_summary.is_critical);
    }

    #[test]
    fn flashcard_repo_crud_and_leitner_repetition() {
        let db = mem_db();
        let fc_repo = FlashcardRepo::new(db.conn());

        let fc = Flashcard {
            id: "fc-1".into(),
            course_id: Some("CSE241".into()),
            assessment_id: Some("a1".into()),
            topic: Some("Flip-Flops".into()),
            front: "What is a D flip-flop?".into(),
            back: "A data or delay flip-flop that captures the D input on the clock edge.".into(),
            box_level: 1,
            next_review_iso: Some("2026-10-24".into()),
            last_reviewed_iso: None,
        };

        fc_repo.upsert(&fc, "t1").unwrap();
        let list = fc_repo.list_for_course("CSE241").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].box_level, 1);

        // Correct review advances box from 1 to 2 with +3 days
        let reviewed = fc_repo
            .review(
                "fc-1",
                true,
                NaiveDate::from_ymd_opt(2026, 10, 24).unwrap(),
                "t1",
            )
            .unwrap()
            .unwrap();
        assert_eq!(reviewed.box_level, 2);
        assert_eq!(reviewed.next_review_iso.as_deref(), Some("2026-10-27"));
        assert_eq!(reviewed.last_reviewed_iso.as_deref(), Some("2026-10-24"));

        // Another correct review advances to box 3 (+7 days -> 2026-11-03)
        let reviewed2 = fc_repo
            .review(
                "fc-1",
                true,
                NaiveDate::from_ymd_opt(2026, 10, 27).unwrap(),
                "t2",
            )
            .unwrap()
            .unwrap();
        assert_eq!(reviewed2.box_level, 3);
        assert_eq!(reviewed2.next_review_iso.as_deref(), Some("2026-11-03"));

        // Incorrect review resets to box 1 (+1 day)
        let reviewed3 = fc_repo
            .review(
                "fc-1",
                false,
                NaiveDate::from_ymd_opt(2026, 11, 3).unwrap(),
                "t3",
            )
            .unwrap()
            .unwrap();
        assert_eq!(reviewed3.box_level, 1);
        assert_eq!(reviewed3.next_review_iso.as_deref(), Some("2026-11-04"));

        // Delete flashcard
        fc_repo.delete("fc-1").unwrap();
        let empty = fc_repo.list_all().unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn quiz_attempt_and_mistake_bank_flow() {
        let db = mem_db();
        let qa_repo = QuizAttemptRepo::new(db.conn());
        let mb_repo = MistakeRepo::new(db.conn());

        let attempt = QuizAttempt {
            id: "qa-1".into(),
            assessment_id: "a1".into(),
            course_id: Some("CSE241".into()),
            timestamp: "2026-10-24T12:00:00Z".into(),
            score: 4,
            total_questions: 5,
            passed: true,
        };
        qa_repo.save(&attempt).unwrap();

        let attempts = qa_repo.list_for_assessment("a1").unwrap();
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].score, 4);

        let mistake = MistakeRecord {
            id: "mis-1".into(),
            attempt_id: Some("qa-1".into()),
            assessment_id: "a1".into(),
            course_id: Some("CSE241".into()),
            question_id: "q-3".into(),
            question_text: "What does race condition mean?".into(),
            options: vec!["Hazard".into(), "Clock jitter".into(), "Parity".into()],
            selected_index: 1,
            correct_index: 0,
            explanation: "Timing race causes hazard.".into(),
            timestamp: "2026-10-24T12:00:00Z".into(),
            resolved: false,
        };
        mb_repo.save(&mistake, "t1").unwrap();

        let unresolved = mb_repo.list_unresolved().unwrap();
        assert_eq!(unresolved.len(), 1);
        assert_eq!(unresolved[0].id, "mis-1");

        mb_repo.resolve("mis-1", "t2").unwrap();
        assert!(mb_repo.list_unresolved().unwrap().is_empty());

        let all = mb_repo.list_all().unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].resolved);
    }

    #[test]
    fn study_session_repo_and_streak_analytics() {
        let db = mem_db();
        let courses = vec![
            course("CSE241", "Digital Design"),
            course("MTH102", "Calculus II"),
        ];
        ops::save_schedule(
            &db,
            &ScheduleData {
                semester: Some("Fall 2026".into()),
                academic_week_start: None,
                courses: courses.clone(),
                slots: Vec::new(),
            },
            "st",
            ref_date(),
        )
        .unwrap();

        let session_repo = StudySessionRepo::new(db.conn());
        let d_today = ref_date(); // 2026-10-24
        let d_yesterday = d_today - chrono::Duration::days(1);
        let d_two_days_ago = d_today - chrono::Duration::days(2);

        session_repo
            .log(&StudySessionRecord {
                id: "sess-1".into(),
                course_id: Some("CSE241".into()),
                assessment_id: None,
                topic: Some("K-Maps".into()),
                duration_minutes: 50,
                timestamp: "2026-10-22T10:00:00Z".into(),
                date_iso: d_two_days_ago,
            })
            .unwrap();

        session_repo
            .log(&StudySessionRecord {
                id: "sess-2".into(),
                course_id: Some("CSE241".into()),
                assessment_id: None,
                topic: Some("Flip-Flops".into()),
                duration_minutes: 25,
                timestamp: "2026-10-23T10:00:00Z".into(),
                date_iso: d_yesterday,
            })
            .unwrap();

        session_repo
            .log(&StudySessionRecord {
                id: "sess-3".into(),
                course_id: Some("MTH102".into()),
                assessment_id: None,
                topic: Some("Integrals".into()),
                duration_minutes: 45,
                timestamp: "2026-10-24T10:00:00Z".into(),
                date_iso: d_today,
            })
            .unwrap();

        let analytics = session_repo.get_analytics(d_today, &courses).unwrap();
        assert_eq!(analytics.total_focus_minutes, 120);
        assert_eq!(analytics.current_streak_days, 3);
        assert_eq!(analytics.best_streak_days, 3);
        assert_eq!(analytics.weekly_chart.len(), 7);
        assert_eq!(analytics.course_breakdown.len(), 2);
    }

    #[test]
    fn sqlite_v4_migration_from_v3_database() {
        let conn = Connection::open_in_memory().unwrap();
        // Run migration 1, 2, 3 manually to create a pure v3 database
        conn.execute_batch(super::super::db::MIGRATIONS[0].1)
            .unwrap();
        conn.execute_batch(super::super::db::MIGRATIONS[1].1)
            .unwrap();
        conn.execute_batch(super::super::db::MIGRATIONS[2].1)
            .unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();

        // Verify v3 schema state
        let v: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 3);

        // Insert sample course and slot in v3
        conn.execute(
            "INSERT INTO courses (id, name, color) VALUES (?1, ?2, ?3)",
            params!["CSE101", "Intro CS", "#1a73e8"],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO slots (id, day, day_index, course_id, course_name, slot_type, start_time, end_time, display_time, has_quiz)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params!["slot-1", "Mon", 1, "CSE101", "Intro CS", "Lecture", "09:00", "10:30", "09:00–10:30", 0],
        )
        .unwrap();

        // Now run migration 4
        conn.execute_batch(super::super::db::MIGRATIONS[3].1)
            .unwrap();
        conn.pragma_update(None, "user_version", 4).unwrap();

        let v4: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v4, 4);

        // Verify new columns exist and default to NULL
        let (credits, max_absences): (Option<f64>, Option<u32>) = conn
            .query_row(
                "SELECT credits, max_absences FROM courses WHERE id = 'CSE101'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(credits, None);
        assert_eq!(max_absences, None);

        let week_parity: Option<String> = conn
            .query_row(
                "SELECT week_parity FROM slots WHERE id = 'slot-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(week_parity, None);

        // Verify new v4 tables can be written to
        conn.execute(
            "INSERT INTO attendance (id, slot_id, course_id, date_iso, status, updated_at)
             VALUES ('att-1', 'slot-1', 'CSE101', '2026-10-26', 'attended', 't1')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO flashcards (id, front, back, box_level)
             VALUES ('fc-1', 'Front', 'Back', 1)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO quiz_attempts (id, assessment_id, timestamp, score, total_questions, passed)
             VALUES ('qa-1', 'a1', 't1', 5, 5, 1)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO mistake_bank (id, assessment_id, question_id, question_text, options, selected_index, correct_index, timestamp)
             VALUES ('mis-1', 'a1', 'q-1', 'Q?', '[]', 0, 1, 't1')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO study_sessions (id, duration_minutes, timestamp, date_iso)
             VALUES ('sess-1', 30, 't1', '2026-10-26')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn cached_emails_and_ai_extractions_crud() {
        let db = mem_db();
        let email1 = CachedEmail {
            id: "msg-1".into(),
            subject: "CSE241 Quiz 1 on Monday".into(),
            from: "prof@university.edu".into(),
            date: "2026-10-24T10:00:00Z".into(),
            snippet: Some("Please prepare chapters 1 and 2".into()),
            body: "Quiz 1 will be held in the lecture hall.".into(),
            body_truncated: false,
            internal_date_ms: None,
            history_id: None,
        };
        ops::save_cached_emails(&db, std::slice::from_ref(&email1), "t1").unwrap();

        let loaded = ops::load_cached_emails(&db).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "msg-1");
        assert_eq!(loaded[0].subject, "CSE241 Quiz 1 on Monday");
        assert_eq!(
            loaded[0].snippet.as_deref(),
            Some("Please prepare chapters 1 and 2")
        );

        let extraction = crate::ai::tasks::ExtractedAssessment {
            is_assessment: true,
            course_id: Some("CSE241".into()),
            course_name: Some("Digital Design".into()),
            title: Some("Quiz 1".into()),
            assessment_type: Some(AssessmentType::ClassQuiz),
            date: Some(on("2026-10-26")),
            start_time: Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
            end_time: Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap()),
            room: Some("Hall 101".into()),
            group: None,
            instructor: Some("Prof. Turing".into()),
            topics: vec!["Logic Gates".into()],
            warnings: vec!["Closed Book".into()],
            ai_inference_note: Some("Scheduled during Monday lecture slot".into()),
            ai_study_plan: Some("Review binary logic.".into()),
            estimated_study_hours: Some(2.0),
        };

        let cache_key = "hash-12345";
        ops::save_email_ai_extraction(
            &db,
            cache_key,
            "msg-1",
            &extraction,
            "gemini-2.5-flash-lite",
            "t1",
        )
        .unwrap();

        let loaded_ext = ops::get_email_ai_extraction(&db, cache_key).unwrap();
        assert_eq!(loaded_ext, Some(extraction));

        let miss = ops::get_email_ai_extraction(&db, "nonexistent-hash").unwrap();
        assert_eq!(miss, None);
    }

    #[test]
    fn test_ai_extractions_prune_by_age() {
        let db = mem_db();
        let extraction = crate::ai::tasks::ExtractedAssessment {
            is_assessment: true,
            course_id: Some("CSE101".into()),
            course_name: None,
            title: Some("Quiz".into()),
            assessment_type: Some(AssessmentType::ClassQuiz),
            date: Some(on("2026-10-26")),
            start_time: None,
            end_time: None,
            room: None,
            group: None,
            instructor: None,
            topics: vec![],
            warnings: vec![],
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
        };

        ops::save_email_ai_extraction(
            &db,
            "old-hash",
            "msg-old",
            &extraction,
            "model-1",
            "2026-07-01T12:00:00Z",
        )
        .unwrap();

        ops::save_email_ai_extraction(
            &db,
            "recent-hash",
            "msg-recent",
            &extraction,
            "model-1",
            "2026-10-01T12:00:00Z",
        )
        .unwrap();

        let pruned =
            ops::prune_email_ai_extractions_by_age(&db, "2026-10-10T12:00:00Z", 60).unwrap();
        assert_eq!(pruned, 1);

        assert_eq!(ops::get_email_ai_extraction(&db, "old-hash").unwrap(), None);
        assert!(ops::get_email_ai_extraction(&db, "recent-hash")
            .unwrap()
            .is_some());
    }

    #[test]
    fn test_ai_extractions_rotate_semester() {
        let db = mem_db();
        let extraction = crate::ai::tasks::ExtractedAssessment {
            is_assessment: true,
            course_id: Some("CSE101".into()),
            course_name: None,
            title: Some("Quiz".into()),
            assessment_type: Some(AssessmentType::ClassQuiz),
            date: Some(on("2026-10-26")),
            start_time: None,
            end_time: None,
            room: None,
            group: None,
            instructor: None,
            topics: vec![],
            warnings: vec![],
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
        };

        let email_fall = CachedEmail {
            id: "msg-fall".into(),
            subject: "Fall Announcement".into(),
            from: "prof@edu".into(),
            date: "2026-10-15T10:00:00Z".into(),
            snippet: None,
            body: "Fall quiz details".into(),
            body_truncated: false,
            internal_date_ms: None,
            history_id: None,
        };
        let email_spring = CachedEmail {
            id: "msg-spring".into(),
            subject: "Spring Announcement".into(),
            from: "prof@edu".into(),
            date: "2026-03-15T10:00:00Z".into(),
            snippet: None,
            body: "Spring quiz details".into(),
            body_truncated: false,
            internal_date_ms: None,
            history_id: None,
        };

        ops::save_cached_emails(&db, &[email_fall, email_spring], "t1").unwrap();

        ops::save_email_ai_extraction(
            &db,
            "hash-fall",
            "msg-fall",
            &extraction,
            "m1",
            "2026-10-15T10:00:00Z",
        )
        .unwrap();
        ops::save_email_ai_extraction(
            &db,
            "hash-spring",
            "msg-spring",
            &extraction,
            "m1",
            "2026-03-15T10:00:00Z",
        )
        .unwrap();
        ops::save_email_ai_extraction(
            &db,
            "hash-orphan",
            "msg-gone",
            &extraction,
            "m1",
            "2026-10-15T10:00:00Z",
        )
        .unwrap();

        let pruned = ops::rotate_email_ai_extractions_semester(&db, "Fall 2026").unwrap();
        assert_eq!(pruned, 2);

        assert!(ops::get_email_ai_extraction(&db, "hash-fall")
            .unwrap()
            .is_some());
        assert_eq!(
            ops::get_email_ai_extraction(&db, "hash-spring").unwrap(),
            None
        );
        assert_eq!(
            ops::get_email_ai_extraction(&db, "hash-orphan").unwrap(),
            None
        );
    }
}
