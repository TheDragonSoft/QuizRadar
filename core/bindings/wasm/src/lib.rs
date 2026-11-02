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
use quizradar_core::plan::tasks::build_study_tasks;
use quizradar_core::sources::{merge_preserving_user_fields, retire_unseen_items, source_run_id};
use quizradar_core::types::{
    Assessment, AssessmentSource, CachedEmail, CompletedTopics, CustomCalendarEvent, ScheduleData,
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
    ) -> Result<String, JsValue> {
        let _ = schedule_json;
        let date = NaiveDate::parse_from_str(ref_date_iso, "%Y-%m-%d")
            .map_err(|e| JsValue::from_str(&format!("Invalid ref_date: {e}")))?;
        let assessments: Vec<Assessment> = serde_json::from_str(assessments_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid assessments JSON: {e}")))?;
        let topics: CompletedTopics = serde_json::from_str(topics_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid topics JSON: {e}")))?;
        let tasks = build_study_tasks(&assessments, &topics, date);
        serde_json::to_string(&tasks)
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
