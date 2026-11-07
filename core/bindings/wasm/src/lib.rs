//! WASM bindings for QuizRadar core engine (`QuizRadarWasm`).
//! Exposes parsers, derivations, conflict detection, study blocks, ICS export,
//! practice MCQ generator, and merge logic to web browsers via wasm-bindgen.

use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use quizradar_core::cal::ics::{export_ics_all, export_ics_single};
use quizradar_core::parse::email::parse_email_announcement;
use quizradar_core::parse::ics::{parse_ics_assessments, IcsOrigin};
use quizradar_core::plan::conflicts::detect_conflicts;
use quizradar_core::plan::dashboard::{build_dashboard_summary, radar_order};
use quizradar_core::plan::study_blocks::{block_date_for, block_id_for, study_block_candidates};
use quizradar_core::sources::{merge_preserving_user_fields, retire_unseen_items, source_run_id};
use quizradar_core::types::{
    AcademicTrack, Assessment, AssessmentSource, CachedEmail, CompletedTopics, CustomCalendarEvent,
    ScheduleData,
};
use wasm_bindgen::prelude::*;

/// One source run the browser reported: the source's name and the id of the
/// run that fetched it.
#[derive(Debug, serde::Deserialize)]
struct BrowserSourceRun {
    name: String,
    run_id: String,
}

#[wasm_bindgen]
pub struct QuizRadarWasm;

#[wasm_bindgen]
impl QuizRadarWasm {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    #[must_use]
    pub fn version(&self) -> String {
        quizradar_core::CORE_VERSION.to_string()
    }

    pub fn parse_email(
        &self,
        email_json: &str,
        schedule_json: &str,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let email: CachedEmail = serde_json::from_str(email_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid email JSON: {e}")))?;
        let schedule: ScheduleData = serde_json::from_str(schedule_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid schedule JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let result = parse_email_announcement(&email, &schedule, date);
        serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn parse_ics(
        &self,
        content: &str,
        schedule_json: &str,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let schedule: ScheduleData = serde_json::from_str(schedule_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid schedule JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let origin = IcsOrigin::Moodle { portal_url: None };
        let offset =
            FixedOffset::east_opt(0).ok_or_else(|| JsValue::from_str("Invalid UTC offset"))?;
        let (assessments, _stats) =
            parse_ics_assessments(content, &schedule, &origin, date, offset);
        serde_json::to_string(&assessments)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    /// Parses a subscribed `.ics` calendar feed the way the desktop does.
    ///
    /// The items carry the FEED's own label as their source (never "Moodle"),
    /// so a browser scan and a desktop scan agree on what an item is - and on
    /// which feed it came from.
    ///
    /// The feed URL is deliberately NOT passed on: it can embed a personal
    /// token, and the browser tier never copies such a URL into a stored
    /// item. The event's own link is used when the feed provides one.
    pub fn parse_ics_feed(
        &self,
        content: &str,
        schedule_json: &str,
        ref_date_iso: &str,
        feed_name: &str,
    ) -> Result<String, JsValue> {
        let schedule: ScheduleData = serde_json::from_str(schedule_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid schedule JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let origin = IcsOrigin::Feed {
            name: feed_name.to_string(),
            feed_url: None,
        };
        let offset =
            FixedOffset::east_opt(0).ok_or_else(|| JsValue::from_str("Invalid UTC offset"))?;
        let (assessments, _stats) =
            parse_ics_assessments(content, &schedule, &origin, date, offset);
        serde_json::to_string(&assessments)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    /// The id of one source run: `"<source-slug>-<utc timestamp>"`.
    ///
    /// The browser passes the moment of the run in (`at_iso`) - the id
    /// FORMAT lives here, so every tier stamps provenance the same way.
    pub fn source_run_id(&self, name: &str, at_iso: &str) -> Result<String, JsValue> {
        let at = DateTime::parse_from_rfc3339(at_iso)
            .map_err(|e| JsValue::from_str(&format!("Invalid run timestamp: {e}")))?
            .with_timezone(&Utc);
        Ok(source_run_id(name, at))
    }

    /// Merges one browser scan into the radar and retires what the scan no
    /// longer reports.
    ///
    /// `source_runs_json` is the list of the sources that RAN in this scan:
    /// `[{"name": "Registrar", "run_id": "registrar-2026-11-01T09:12:00Z"}]`.
    /// Every item such a source reported carries its run id, so a later scan
    /// can tell what the source stopped reporting - and retire it honestly.
    ///
    /// A source that is NOT in the list (it failed, or it was skipped) may
    /// retire nothing: it never saw what the radar holds.
    pub fn merge_scan(
        &self,
        existing_json: &str,
        incoming_json: &str,
        source_runs_json: &str,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let existing: Vec<Assessment> = serde_json::from_str(existing_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid existing assessments JSON: {e}")))?;
        let mut incoming: Vec<Assessment> = serde_json::from_str(incoming_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid incoming assessments JSON: {e}")))?;
        let runs: Vec<BrowserSourceRun> = serde_json::from_str(source_runs_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid source runs JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;

        // The browser tier scans calendar feeds, and every feed is its own
        // source: one feed failing must never retire another feed's items.
        let authoritative: Vec<(String, String)> = runs
            .iter()
            .map(|run| {
                (
                    AssessmentSource::Feed(run.name.clone()).provenance_key(),
                    run.run_id.clone(),
                )
            })
            .collect();

        // Provenance: the run that reported an item is what last saw it.
        for item in &mut incoming {
            let item_key = item.source.provenance_key();
            if let Some((_, run_id)) = authoritative.iter().find(|(key, _)| *key == item_key) {
                item.last_seen_source_run = Some(run_id.clone());
            }
        }

        let (mut merged, counts) = merge_preserving_user_fields(&existing, incoming);
        let retired = retire_unseen_items(&mut merged, &authoritative, date);
        let result = serde_json::json!({
            "merged": merged,
            "counts": {
                "added": counts.added,
                "updated": counts.updated,
                "unchanged": counts.unchanged
            },
            "retired": retired
        });
        serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn radar_order(
        &self,
        assessments_json: &str,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let ordered = radar_order(&assessments, date);
        serde_json::to_string(&ordered)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn derive_dashboard(
        &self,
        assessments_json: &str,
        topics_json: &str,
        events_json: &str,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let topics: CompletedTopics = serde_json::from_str(topics_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid topics JSON: {e}")))?;
        let events: Vec<CustomCalendarEvent> = serde_json::from_str(events_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid events JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let dashboard = build_dashboard_summary(&assessments, &topics, &events, date);
        serde_json::to_string(&dashboard)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn derive_tasks(
        &self,
        assessments_json: &str,
        schedule_json: &str,
        topics_json: &str,
        ref_date_iso: &str,
        academic_track: &str,
    ) -> Result<String, JsValue> {
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let topics: CompletedTopics = serde_json::from_str(topics_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid topics JSON: {e}")))?;
        let track = AcademicTrack::from_config(Some(academic_track));
        let schedule: Option<ScheduleData> = serde_json::from_str(schedule_json).ok();
        let empty_slots = Vec::new();
        let slots = schedule.as_ref().map(|s| &s.slots).unwrap_or(&empty_slots);
        let tasks = quizradar_core::plan::tasks::build_study_tasks_with_schedule(
            &assessments,
            &topics,
            date,
            track,
            slots,
            &[],
        );
        serde_json::to_string(&tasks)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn get_week_parity(&self, date_iso: &str) -> String {
        let date = NaiveDate::parse_from_str(date_iso, "%Y-%m-%d").unwrap_or_default();
        quizradar_core::plan::parity::date_week_parity(date).to_string()
    }

    pub fn calculate_study_cushion(
        &self,
        schedule_json: &str,
        events_json: &str,
        assessments_json: &str,
        tasks_json: &str,
        ref_date_iso: &str,
        waking_hours: Option<f32>,
    ) -> Result<String, JsValue> {
        let schedule: ScheduleData = serde_json::from_str(schedule_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid schedule JSON: {e}")))?;
        let events: Vec<CustomCalendarEvent> = serde_json::from_str(events_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid events JSON: {e}")))?;
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let tasks: Vec<quizradar_core::plan::tasks::DailyStudyTask> =
            serde_json::from_str(tasks_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid tasks JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let cushion = quizradar_core::plan::cushion::calculate_daily_cushion(
            date,
            &schedule.slots,
            &events,
            &assessments,
            &tasks,
            waking_hours,
        );
        serde_json::to_string(&cushion)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn calculate_gpa(
        &self,
        courses_json: &str,
        assessments_json: &str,
        grades_json: &str,
        scale: &str,
    ) -> Result<String, JsValue> {
        let courses: Vec<quizradar_core::types::Course> = serde_json::from_str(courses_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid courses JSON: {e}")))?;
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let grades: std::collections::HashMap<String, quizradar_core::types::GradeRecord> =
            serde_json::from_str(grades_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid grades JSON: {e}")))?;
        let summary =
            quizradar_core::plan::gpa::calculate_gpa(&courses, &assessments, &grades, scale);
        serde_json::to_string(&summary)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn calculate_study_analytics(
        &self,
        sessions_json: &str,
        courses_json: &str,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let sessions: Vec<quizradar_core::types::StudySessionRecord> =
            serde_json::from_str(sessions_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid sessions JSON: {e}")))?;
        let courses: Vec<quizradar_core::types::Course> = serde_json::from_str(courses_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid courses JSON: {e}")))?;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;

        let mut total_focus_minutes = 0u32;
        let mut daily_totals: std::collections::HashMap<NaiveDate, u32> =
            std::collections::HashMap::new();
        let mut course_totals: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();

        for s in &sessions {
            total_focus_minutes += s.duration_minutes;
            *daily_totals.entry(s.date_iso).or_insert(0) += s.duration_minutes;
            if let Some(ref cid) = s.course_id {
                *course_totals.entry(cid.clone()).or_insert(0) += s.duration_minutes;
            }
        }

        let is_active = |d: NaiveDate| daily_totals.get(&d).copied().unwrap_or(0) >= 1;
        let current_streak_days = if is_active(date) {
            let mut streak = 1u32;
            let mut d = date - chrono::Duration::days(1);
            while is_active(d) {
                streak += 1;
                d -= chrono::Duration::days(1);
            }
            streak
        } else if is_active(date - chrono::Duration::days(1)) {
            let mut streak = 1u32;
            let mut d = date - chrono::Duration::days(2);
            while is_active(d) {
                streak += 1;
                d -= chrono::Duration::days(1);
            }
            streak
        } else {
            0u32
        };

        let mut active_dates: Vec<NaiveDate> = daily_totals
            .keys()
            .copied()
            .filter(|d| is_active(*d))
            .collect();
        active_dates.sort_unstable();
        let mut best_streak_days = 0u32;
        let mut current_consecutive = 0u32;
        let mut prev_date: Option<NaiveDate> = None;

        for d in active_dates {
            match prev_date {
                Some(prev) if d == prev + chrono::Duration::days(1) => {
                    current_consecutive += 1;
                }
                _ => {
                    current_consecutive = 1;
                }
            }
            prev_date = Some(d);
            best_streak_days = best_streak_days.max(current_consecutive);
        }
        best_streak_days = best_streak_days.max(current_streak_days);

        let mut weekly_chart = Vec::with_capacity(7);
        for i in (0..=6).rev() {
            let d = date - chrono::Duration::days(i);
            let mins = daily_totals.get(&d).copied().unwrap_or(0);
            let day_label = d.format("%a").to_string();
            weekly_chart.push(quizradar_core::types::DailyFocusStat {
                date_iso: d,
                day_label,
                minutes: mins,
            });
        }

        let mut course_breakdown = Vec::new();
        for (cid, mins) in course_totals {
            let course = courses.iter().find(|c| c.id.eq_ignore_ascii_case(&cid));
            let course_name = course
                .map(|c| c.name.clone())
                .unwrap_or_else(|| cid.clone());
            let color = course.map(|c| c.color.clone());
            course_breakdown.push(quizradar_core::types::CourseFocusStat {
                course_id: cid,
                course_name,
                minutes: mins,
                color,
            });
        }
        course_breakdown.sort_by_key(|a| std::cmp::Reverse(a.minutes));

        let analytics = quizradar_core::types::StudyAnalytics {
            current_streak_days,
            best_streak_days,
            total_focus_minutes,
            weekly_chart,
            course_breakdown,
        };
        serde_json::to_string(&analytics)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn review_flashcard(
        &self,
        card_json: &str,
        correct: bool,
        ref_date_iso: &str,
    ) -> Result<String, JsValue> {
        let mut card: quizradar_core::types::Flashcard = serde_json::from_str(card_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid flashcard JSON: {e}")))?;
        let today = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        if correct {
            card.box_level = (card.box_level + 1).min(5);
        } else {
            card.box_level = 1;
        }
        let interval_days = match card.box_level {
            1 => 1,
            2 => 3,
            3 => 7,
            4 => 14,
            _ => 30,
        };
        card.last_reviewed_iso = Some(today.format("%Y-%m-%d").to_string());
        card.next_review_iso = Some(
            (today + chrono::Duration::days(interval_days))
                .format("%Y-%m-%d")
                .to_string(),
        );
        serde_json::to_string(&card)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn calculate_course_attendance_summary(
        &self,
        course_id: &str,
        entries_json: &str,
        max_absences: Option<u32>,
    ) -> Result<String, JsValue> {
        let entries: Vec<quizradar_core::types::AttendanceEntry> =
            serde_json::from_str(entries_json)
                .map_err(|e| JsValue::from_str(&format!("Invalid entries JSON: {e}")))?;
        let total_classes = entries.len() as u32;
        let mut attended = 0u32;
        let mut absent = 0u32;
        let mut excused = 0u32;
        for e in &entries {
            match e.status {
                quizradar_core::types::AttendanceStatus::Attended => attended += 1,
                quizradar_core::types::AttendanceStatus::Absent => absent += 1,
                quizradar_core::types::AttendanceStatus::Excused => excused += 1,
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
        let summary = quizradar_core::types::CourseAttendanceSummary {
            course_id: course_id.to_string(),
            total_classes,
            attended,
            absent,
            excused,
            max_absences,
            warning_chip,
            is_critical,
        };
        serde_json::to_string(&summary)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    /// The content-addressed topic-completion key for one topic — the same
    /// `"{assessment_id}::h{hash}"` shape the store and desktop shell use.
    /// The FORMAT lives here (once, in core) so the browser tier never
    /// re-implements the hash.
    #[must_use]
    pub fn topic_key(&self, assessment_id: &str, topic_text: &str) -> String {
        quizradar_core::plan::dashboard::topic_key_for_text(assessment_id, topic_text)
    }

    /// One-shot browser migration for the content-addressed topic keys:
    /// rewrites legacy positional `"{id}::{index}"` entries through each
    /// assessment's CURRENT topic list. `entries_json` is
    /// `[{"key":…, "done":…, "updated_at":…}]`; the result carries the
    /// rewritten entries (provenance timestamps preserved) plus honest
    /// `remapped`/`dropped` counts — entries whose assessment or index no
    /// longer resolves are dropped, because the positional scheme had
    /// already lost them.
    pub fn migrate_topic_keys(
        &self,
        entries_json: &str,
        assessments_json: &str,
    ) -> Result<String, JsValue> {
        #[derive(serde::Deserialize)]
        struct Entry {
            key: String,
            #[serde(default)]
            done: bool,
            #[serde(default)]
            updated_at: Option<String>,
        }
        let entries: Vec<Entry> = serde_json::from_str(entries_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid topic entries JSON: {e}")))?;
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;

        let mut out: Vec<serde_json::Value> = Vec::with_capacity(entries.len());
        let mut remapped = 0usize;
        let mut dropped = 0usize;
        for entry in entries {
            let rewritten = quizradar_core::plan::dashboard::parse_legacy_topic_key(&entry.key)
                .and_then(|(assessment_id, index)| {
                    assessments
                        .iter()
                        .find(|assessment| assessment.id == assessment_id)
                        .and_then(|assessment| assessment.topics.get(index))
                        .map(|topic_text| {
                            quizradar_core::plan::dashboard::topic_key_for_text(
                                &assessment_id,
                                topic_text,
                            )
                        })
                });
            match rewritten {
                Some(new_key) => {
                    remapped += 1;
                    out.push(serde_json::json!({
                        "key": new_key,
                        "done": entry.done,
                        "updated_at": entry.updated_at,
                    }));
                }
                None if quizradar_core::plan::dashboard::parse_legacy_topic_key(&entry.key)
                    .is_some() =>
                {
                    dropped += 1;
                }
                None => out.push(serde_json::json!({
                    "key": entry.key,
                    "done": entry.done,
                    "updated_at": entry.updated_at,
                })),
            }
        }
        let result =
            serde_json::json!({ "entries": out, "remapped": remapped, "dropped": dropped });
        serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn detect_conflicts(
        &self,
        assessments_json: &str,
        events_json: &str,
    ) -> Result<String, JsValue> {
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let events: Vec<CustomCalendarEvent> = serde_json::from_str(events_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid events JSON: {e}")))?;
        let conflicts = detect_conflicts(&assessments, &events);
        serde_json::to_string(&conflicts)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn generate_study_blocks(
        &self,
        assessment_json: &str,
        schedule_json: &str,
        events_json: &str,
        today_iso: &str,
    ) -> Result<String, JsValue> {
        // Still parsed so a malformed reference date fails loudly; study
        // blocks anchor on the assessment's own date, so today is otherwise
        // unused (undated assessments return no candidates at all).
        let _today = NaiveDate::parse_from_str(today_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid today_iso: {e}")))?;
        let assessment: Assessment = serde_json::from_str(assessment_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessment JSON: {e}")))?;
        let schedule: ScheduleData = serde_json::from_str(schedule_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid schedule JSON: {e}")))?;
        let events: Vec<CustomCalendarEvent> = serde_json::from_str(events_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid events JSON: {e}")))?;

        let block_id = block_id_for(&assessment.id);
        if events.iter().any(|e| e.id == block_id) {
            return serde_json::to_string(&Vec::<CustomCalendarEvent>::new())
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")));
        }

        // Undated assessments are unschedulable — never fabricate "tomorrow".
        let Some(exam_date) = assessment.date else {
            return serde_json::to_string(&Vec::<CustomCalendarEvent>::new())
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")));
        };
        let block_date = block_date_for(exam_date);
        let candidates = study_block_candidates(&schedule, &events, block_date);

        let mut generated = Vec::new();
        if let Some(candidate) = candidates.first() {
            let event = CustomCalendarEvent {
                id: block_id,
                title: format!("Study: {}", assessment.title),
                course_id: assessment.course_id.clone(),
                event_type: Some("Study Session".to_string()),
                date: Some(candidate.date),
                start_time: Some(candidate.start),
                end_time: Some(candidate.end),
                room: None,
                notes: Some(format!("Smart study block for {}", assessment.title)),
                color: Some("#10b981".to_string()),
            };
            generated.push(event);
        }

        serde_json::to_string(&generated)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn export_ics(
        &self,
        assessments_json: &str,
        assessment_id: Option<String>,
    ) -> Result<String, JsValue> {
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        match assessment_id {
            Some(id) => {
                let target = assessments
                    .iter()
                    .find(|a| a.id == id)
                    .ok_or_else(|| JsValue::from_str(&format!("Assessment {id} not found")))?;
                export_ics_single(target)
                    .map_err(|e| JsValue::from_str(&format!("ICS export failed: {e}")))
            }
            None => Ok(export_ics_all(&assessments)),
        }
    }

    pub fn generate_practice_quiz(&self, assessment_json: &str) -> Result<String, JsValue> {
        let assessment: Assessment = serde_json::from_str(assessment_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessment JSON: {e}")))?;
        let quiz = quizradar_core::ai::practice_fallback::generate_practice_locally(&assessment);
        serde_json::to_string(&quiz)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }

    pub fn merge_sync(&self, existing_json: &str, incoming_json: &str) -> Result<String, JsValue> {
        let existing: Vec<Assessment> = serde_json::from_str(existing_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid existing assessments JSON: {e}")))?;
        let incoming: Vec<Assessment> = serde_json::from_str(incoming_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid incoming assessments JSON: {e}")))?;
        let (merged, counts) = merge_preserving_user_fields(&existing, incoming);
        let result = serde_json::json!({
            "merged": merged,
            "counts": {
                "added": counts.added,
                "updated": counts.updated,
                "unchanged": counts.unchanged
            }
        });
        serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
    }
}

impl Default for QuizRadarWasm {
    fn default() -> Self {
        Self::new()
    }
}
