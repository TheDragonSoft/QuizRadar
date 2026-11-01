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
    Assessment, AssessmentType, CompletedTopics, Course, CustomCalendarEvent, FeedConfig,
    GradeRecord, ScheduleData, ScheduleSlot, UrgencyLevel,
};

use super::db::{Db, StoreError};

/// Upper bound on subscribed feeds so one config can never turn a single
/// sync into an unbounded fan-out of HTTP requests (v4 parity).
pub const MAX_FEEDS: usize = 10;

/// The section of the v4 export the store still serves — a full topic-check
/// item exists only when the topic list did; an empty `topics` array has no
/// keys and must behave like 100% readiness at display time.
pub fn topic_key(assessment_id: &str, index: usize) -> String {
    plan::dashboard::topic_key(assessment_id, index)
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
    let tasks = plan::tasks::build_study_tasks(&refreshed, &completed_topics, reference_date);

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
    let courses = CourseRepo::new(conn).list()?;
    let slots = CourseRepo::new(conn).all_slots()?;
    Ok(ScheduleData {
        semester,
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
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, color, bg, border FROM courses ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            Ok(Course {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                bg: row.get(3)?,
                border: row.get(4)?,
            })
        })?;
        let mut courses = Vec::new();
        for row in rows {
            courses.push(row?);
        }
        Ok(courses)
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
            "INSERT INTO courses (id, name, color, bg, border) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                course.id,
                course.name,
                course.color,
                course.bg,
                course.border,
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

    pub fn all_slots(&self) -> Result<Vec<ScheduleSlot>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, day, day_index, course_id, course_name, slot_type, group_name, room, \
             start_time, end_time, display_time, has_quiz, quiz_title \
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
             start_time, end_time, display_time, has_quiz, quiz_title \
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
              start_time, end_time, display_time, has_quiz, quiz_title) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
     weightage_percent, achieved_score, max_score, conflict_warning, updated_at";

const INSERT_ASSESSMENT: &str = "
INSERT OR REPLACE INTO assessments (
    id, course_id, course_name, title, assessment_type, date_iso, day_name, start_time,
    end_time, display_time, room, group_name, instructor, is_upcoming, days_until,
    urgency_level, priority_score, topics, warnings, ai_inference_note, ai_study_plan,
    estimated_study_hours, elearning_url, google_cal_url, gcal_synced, gcal_event_id,
    color, bg, border, semester, email_subject, email_sent_date, source, source_icon,
    weightage_percent, achieved_score, max_score, conflict_warning, updated_at
) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
    ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
    ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34,
    ?35, ?36, ?37, ?38, ?39
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
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("DELETE FROM assessments WHERE id NOT IN ({placeholders})");
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        self.conn.execute(&sql, params_vec.as_slice())?;
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
                "topic key must be <assessment_id>::<topic_index>".to_string(),
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

        ops::set_topic_done(&db, &topic_key("a", 0), true, "t1", ref_date()).unwrap();
        ops::set_topic_done(&db, &topic_key("a", 0), false, "t2", ref_date()).unwrap();
        let topics = TopicRepo::new(db.conn()).all().unwrap();
        assert!(
            !topics.contains_key(&topic_key("a", 0)),
            "unchecking removes the row — no false rows in the store"
        );

        ops::set_topic_done(&db, &topic_key("a", 0), true, "t3", ref_date()).unwrap();
        // A remote backup with `false` for the same key never un-completes.
        let mut remote: CompletedTopics = CompletedTopics::new();
        remote.insert(topic_key("a", 0), false);
        remote.insert(topic_key("a", 1), true);
        let merged = TopicRepo::new(db.conn())
            .merge_additive(&remote, "t4")
            .unwrap();
        assert_eq!(merged, 1, "only the true entry is added");
        let topics = TopicRepo::new(db.conn()).all().unwrap();
        assert_eq!(topics.get(&topic_key("a", 0)), Some(&true));
        assert_eq!(topics.get(&topic_key("a", 1)), Some(&true));
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
        let snapshot =
            ops::set_topic_done(&db, &topic_key("a", 0), true, "t1", ref_date()).unwrap();
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
}
