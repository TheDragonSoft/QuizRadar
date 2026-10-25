//! Google Calendar push (`01` §4.6 "Add to Google Calendar", `02` §5.6):
//! creates/updates events for the student's dated upcoming assessments on
//! their **primary** calendar.
//!
//! Idempotency contract (v4 parity): the caller supplies the persisted
//! `synced_gcal_map` (`assessment_id → gcal_event_id`); a mapped id is a PUT
//! (update), an unmapped id is a POST (create), a 404 on the PUT means the
//! user deleted the remote event so the mapping is stale → re-create, and a
//! 401/403 means the token lacks calendar access → the item is reported
//! `needs_scope` and **never marked synced** (honesty doctrine: a failed
//! push never claims success).
//!
//! Timezone honesty (`03` §C7): the core owns no clock and no timezone —
//! the caller injects a `FixedOffset` factory (desktop: the OS local offset;
//! Android/PWA: the device offset). Event `dateTime` values carry that
//! offset inline, which fully identifies the moment without a fabricated
//! IANA zone id.
//!
//! Event body: v4's shape, but every line is built from the user's own
//! data — missing rooms/instructors/groups/strategy notes are omitted, never
//! defaulted ("University Campus" hall fabrications are deleted). Times the
//! sources never established produce an all-day event instead of invented
//! hours.

use std::collections::HashMap;

use chrono::{FixedOffset, NaiveDate};
use futures::StreamExt;
use serde_json::{json, Value};

use crate::auth::providers::{GoogleCapability, ProviderCapability};
use crate::sources::TokenProvider;
use crate::types::Assessment;

/// Production Google Calendar API root (tests point this at the fixture
/// server).
pub const GCAL_API_BASE: &str = "https://www.googleapis.com/calendar/v3";

/// Bounded concurrency for per-event pushes (v4 parity).
const PUSH_CONCURRENCY: usize = 4;

/// The honest outcome of one push run. `synced` maps assessment ids to the
/// calendar event ids the caller must persist (into `synced_gcal_map` and
/// the rows' `gcal_event_id`/`gcal_synced`); `failed` lists ids that were
/// NOT pushed — the caller must leave them un-synced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GCalSyncReport {
    /// `true` only when every pushable assessment landed (or there was
    /// nothing to push). A scope failure or any per-item failure is not a
    /// success.
    pub success: bool,
    pub created: usize,
    pub updated: usize,
    /// Pushable items = dated upcoming assessments.
    pub total_pushable: usize,
    /// Dated upcoming items that could not be pushed (API/transport errors
    /// other than scope; scope failures land in `needs_scope`).
    pub failed_ids: Vec<String>,
    /// Undated upcoming drafts were not pushed — no date, no event.
    pub skipped_undated: usize,
    /// `true` when the token was refused (401/403): the account needs the
    /// `calendar.events` scope — reconnect Google with calendar access.
    pub needs_scope: bool,
    pub message: String,
    /// `assessment_id → event_id` for every successful push.
    pub synced: Vec<(String, String)>,
}

impl GCalSyncReport {
    /// Everything the caller persists after a run, as a ready map merge.
    #[must_use]
    pub fn synced_map(&self) -> HashMap<String, String> {
        self.synced.iter().cloned().collect()
    }
}

enum Outcome {
    Created(String),
    Updated(String),
    /// 404 on update — the stale mapping was discarded; the caller should
    /// retry the item on a later run (this run does not mark it synced yet).
    Recreated(String),
    /// 401/403 — scope problem; the item stays un-synced.
    NeedsScope,
    /// Any other failure (5xx, transport, unreadable response).
    Failed(String),
}

/// Formats a [`FixedOffset`] as Google's `±HH:MM` dateTime suffix.
fn offset_string(offset: FixedOffset) -> String {
    let secs = offset.local_minus_utc();
    let (sign, abs) = if secs < 0 { ('-', -secs) } else { ('+', secs) };
    format!("{sign}{:02}:{:02}", abs / 3600, (abs % 3600) / 60)
}

/// Builds the calendar event body from the user's data only.
#[must_use]
pub fn build_event_body(assessment: &Assessment, offset: FixedOffset) -> Value {
    let suffix = offset_string(offset);
    let (start, end) = match (assessment.start_time, assessment.end_time) {
        (Some(start), Some(end)) => (
            json!({ "dateTime": format!("{}T{}:00{}", date(assessment), start.format("%H:%M"), suffix) }),
            json!({ "dateTime": format!("{}T{}:00{}", date(assessment), end.format("%H:%M"), suffix) }),
        ),
        (Some(start), None) => {
            // Start known, duration never claimed: zero-length event.
            let stamp = format!(
                "{}T{}:00{}",
                date(assessment),
                start.format("%H:%M"),
                suffix
            );
            (json!({ "dateTime": stamp }), json!({ "dateTime": stamp }))
        }
        (None, _) => {
            // No established time: an honest all-day event on the known date
            // (exclusive end = next day).
            let next = date(assessment)
                .parse::<NaiveDate>()
                .ok()
                .and_then(|d| d.succ_opt())
                .unwrap_or_default();
            (
                json!({ "date": date(assessment) }),
                json!({ "date": next.format("%Y-%m-%d").to_string() }),
            )
        }
    };

    json!({
        "summary": event_summary(assessment),
        "location": event_location(assessment),
        "description": event_description(assessment),
        "start": start,
        "end": end,
        "reminders": {
            "useDefault": false,
            "overrides": [
                { "method": "popup", "minutes": 1440 },
                { "method": "popup", "minutes": 120 }
            ]
        }
    })
}

fn date(assessment: &Assessment) -> String {
    assessment
        .date
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// `⚡ [CODE] Title`, or `⚡ Title` when no course code exists (v4's
/// `[GENERAL]` fabrication is deleted).
fn event_summary(assessment: &Assessment) -> String {
    match &assessment.course_id {
        Some(code) => format!("⚡ [{code}] {}", assessment.title),
        None => format!("⚡ {}", assessment.title),
    }
}

/// Room/group only when established — no default campus string.
fn event_location(assessment: &Assessment) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(room) = assessment
        .room
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        parts.push(format!("Room {room}"));
    }
    if let Some(group) = assessment
        .group
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
    {
        parts.push(format!("({group})"));
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// Description sections only for data the user actually has.
fn event_description(assessment: &Assessment) -> String {
    let mut desc = String::new();
    match (&assessment.course_id, &assessment.course_name) {
        (Some(code), Some(name)) => desc.push_str(&format!("Course: {code} — {name}\n")),
        (Some(code), None) => desc.push_str(&format!("Course: {code}\n")),
        (None, Some(name)) => desc.push_str(&format!("Course: {name}\n")),
        (None, None) => {}
    }
    desc.push_str(&format!(
        "Assessment Type: {}\n",
        assessment.assessment_type.as_str()
    ));
    if let Some(room) = assessment
        .room
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
    {
        desc.push_str(&format!("Room: {room}\n"));
    }
    if let Some(group) = assessment
        .group
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
    {
        desc.push_str(&format!("Group: {group}\n"));
    }
    if let Some(instructor) = assessment
        .instructor
        .as_deref()
        .map(str::trim)
        .filter(|i| !i.is_empty())
    {
        desc.push_str(&format!("Instructor: {instructor}\n"));
    }
    if !assessment.topics.is_empty() {
        desc.push_str("\n📚 What to Study:\n");
        for topic in &assessment.topics {
            desc.push_str(&format!("• {topic}\n"));
        }
    }
    if !assessment.warnings.is_empty() {
        desc.push_str("\n⚠️ Important Warnings:\n");
        for warning in &assessment.warnings {
            desc.push_str(&format!("{warning}\n"));
        }
    }
    if let Some(plan) = assessment
        .ai_study_plan
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        desc.push_str(&format!("\n💡 AI Study Strategy:\n{plan}\n"));
    }
    if let Some(note) = assessment
        .ai_inference_note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
    {
        desc.push_str(&format!("\n🤖 {note}\n"));
    }
    if let Some(url) = assessment
        .elearning_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        desc.push_str(&format!("\n🔗 Course Announcement: {url}\n"));
    }
    desc
}

/// Pushes (creates/updates) events for every **dated upcoming** assessment.
/// `base_url` is [`GCAL_API_BASE`] in production or the fixture server in
/// tests; `offset` is the caller's local-offset factory (`03` §C7).
pub async fn push_assessments_to_google_calendar(
    client: &reqwest::Client,
    base_url: &str,
    provider: &dyn TokenProvider,
    assessments: &[Assessment],
    synced_gcal_map: &HashMap<String, String>,
    offset: &(dyn Fn() -> FixedOffset + Send + Sync),
) -> GCalSyncReport {
    let total_pushable = assessments
        .iter()
        .filter(|item| item.is_upcoming && item.date.is_some())
        .count();
    let skipped_undated = assessments
        .iter()
        .filter(|item| item.is_upcoming && item.date.is_none())
        .count();

    if total_pushable == 0 {
        return GCalSyncReport {
            success: true,
            created: 0,
            updated: 0,
            total_pushable: 0,
            failed_ids: Vec::new(),
            skipped_undated,
            needs_scope: false,
            message: if skipped_undated > 0 {
                format!(
                    "0 assessments pushed — the {skipped_undated} upcoming draft(s) have no confirmed date yet. Confirm dates first; nothing was invented."
                )
            } else {
                "0 assessments pushed — no dated upcoming assessments to push. Your Google Calendar is already up to date.".to_string()
            },
            synced: Vec::new(),
        };
    }

    let capability = ProviderCapability::Google(GoogleCapability::CalendarEvents);
    // Pre-flight token check: a dead/expired account fails the whole run
    // up front with one honest message instead of per-item noise.
    if let Err(error) = provider.bearer(capability).await {
        return GCalSyncReport {
            success: false,
            created: 0,
            updated: 0,
            total_pushable,
            failed_ids: assessments
                .iter()
                .filter(|item| item.is_upcoming && item.date.is_some())
                .map(|item| item.id.clone())
                .collect(),
            skipped_undated,
            needs_scope: false,
            message: format!(
                "Google Calendar push failed: no usable calendar token ({error}). Nothing was marked as synced."
            ),
            synced: Vec::new(),
        };
    }

    let pending: Vec<(usize, Assessment, Option<String>)> = assessments
        .iter()
        .enumerate()
        .filter(|(_, item)| item.is_upcoming && item.date.is_some())
        .map(|(index, item)| (index, item.clone(), synced_gcal_map.get(&item.id).cloned()))
        .collect();

    let results: Vec<(usize, Outcome)> = futures::stream::iter(pending)
        .map(|(index, item, existing)| async move {
            (
                index,
                push_one(
                    client, base_url, provider, capability, &item, existing, offset,
                )
                .await,
            )
        })
        .buffer_unordered(PUSH_CONCURRENCY)
        .collect()
        .await;
    let mut results = results;
    results.sort_by_key(|(index, _)| *index);

    let mut report = GCalSyncReport {
        success: true,
        created: 0,
        updated: 0,
        total_pushable,
        failed_ids: Vec::new(),
        skipped_undated,
        needs_scope: false,
        message: String::new(),
        synced: Vec::new(),
    };

    for (index, outcome) in results {
        let item = &assessments[index];
        match outcome {
            Outcome::Created(event_id) => {
                report.created += 1;
                report.synced.push((item.id.clone(), event_id));
            }
            Outcome::Updated(event_id) => {
                report.updated += 1;
                report.synced.push((item.id.clone(), event_id));
            }
            Outcome::Recreated(event_id) => {
                // The stale mapping was replaced by a fresh remote event.
                report.created += 1;
                report.synced.push((item.id.clone(), event_id));
            }
            Outcome::NeedsScope => {
                report.needs_scope = true;
                report.failed_ids.push(item.id.clone());
            }
            Outcome::Failed(reason) => {
                report.failed_ids.push(item.id.clone());
                report
                    .message
                    .push_str(&format!("\n{}: {reason}", item.title));
            }
        }
    }

    if report.needs_scope {
        report.success = false;
        report.message = format!(
            "Google Calendar push needs calendar access — reconnect your Google account with Calendar permission. {} item(s) were NOT pushed and nothing was marked as synced.",
            report.failed_ids.len()
        );
    } else if !report.failed_ids.is_empty() {
        report.success = false;
        report.message = format!(
            "Pushed {} of {} assessments to your Google Calendar; {} failed (nothing was marked as synced for the failed items).{}",
            report.synced.len(),
            total_pushable,
            report.failed_ids.len(),
            report.message
        );
    } else {
        report.message = format!(
            "Synced {} assessment(s) to your Google Calendar ({} created, {} updated).",
            report.synced.len(),
            report.created,
            report.updated
        );
    }
    report
}

/// One event: PUT when mapped (404 → fresh POST), else POST.
#[allow(clippy::too_many_arguments)]
async fn push_one(
    client: &reqwest::Client,
    base_url: &str,
    provider: &dyn TokenProvider,
    capability: ProviderCapability,
    assessment: &Assessment,
    existing_event_id: Option<String>,
    offset: &(dyn Fn() -> FixedOffset + Send + Sync),
) -> Outcome {
    let body = build_event_body(assessment, offset());
    // Captured before the destructuring below — the create path needs to
    // know whether this was a 404-recreate of a mapped event.
    let was_update = existing_event_id.is_some();

    if let Some(event_id) = existing_event_id {
        let url = format!("{base_url}/calendars/primary/events/{event_id}");
        let token = match provider.bearer(capability).await {
            Ok(token) => token,
            Err(error) => return Outcome::Failed(format!("token unavailable: {error}")),
        };
        let response = client
            .put(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                return Outcome::Updated(event_id);
            }
            Ok(response) if response.status().as_u16() == 404 => {
                // The user deleted the remote event: re-create instead of
                // blocking this assessment from ever syncing again (v4 fix).
            }
            Ok(response) if matches!(response.status().as_u16(), 401 | 403) => {
                return Outcome::NeedsScope;
            }
            Ok(response) => {
                return Outcome::Failed(format!(
                    "Google Calendar update returned HTTP {}",
                    response.status()
                ));
            }
            Err(error) => {
                return Outcome::Failed(format!("network error: {}", error.without_url()));
            }
        }
        // 404 fell through: create a fresh event below.
    }

    let url = format!("{base_url}/calendars/primary/events");
    let token = match provider.bearer(capability).await {
        Ok(token) => token,
        Err(error) => return Outcome::Failed(format!("token unavailable: {error}")),
    };
    match client
        .post(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            let payload: Result<Value, _> = response.json().await;
            match payload {
                Ok(value) => match value.get("id").and_then(Value::as_str) {
                    Some(event_id) => {
                        if was_update {
                            Outcome::Recreated(event_id.to_string())
                        } else {
                            Outcome::Created(event_id.to_string())
                        }
                    }
                    None => Outcome::Failed("Google Calendar response carried no event id".into()),
                },
                Err(error) => {
                    Outcome::Failed(format!("unreadable Google Calendar response: {error}"))
                }
            }
        }
        Ok(response) if matches!(response.status().as_u16(), 401 | 403) => Outcome::NeedsScope,
        Ok(response) => Outcome::Failed(format!(
            "Google Calendar create returned HTTP {}",
            response.status()
        )),
        Err(error) => Outcome::Failed(format!("network error: {}", error.without_url())),
    }
}

/// Google Calendar "Add to Calendar" template URL (`02` §5.6): opens the
/// calendar UI with the event pre-filled — the honest no-scope fallback for
/// one-off pushes. Dates/times come from the user's data; undated
/// assessments produce no link (nothing to render).
#[must_use]
pub fn template_url(assessment: &Assessment) -> Option<String> {
    let date = assessment.date?;
    let compact = date.format("%Y%m%d").to_string();
    let (dates, text) = match (assessment.start_time, assessment.end_time) {
        (Some(start), Some(end)) => (
            format!(
                "{compact}T{}/{}T{}",
                start.format("%H%M%S"),
                compact,
                end.format("%H%M%S")
            ),
            event_summary(assessment),
        ),
        (Some(start), None) => (
            format!(
                "{compact}T{}00/{compact}T{}00",
                start.format("%H%M"),
                start.format("%H%M")
            ),
            event_summary(assessment),
        ),
        (None, _) => (format!("{compact}/{compact}"), event_summary(assessment)),
    };

    let mut params: Vec<(String, String)> = vec![
        ("action".into(), "TEMPLATE".into()),
        ("text".into(), text),
        ("dates".into(), dates),
    ];
    if let Some(location) = event_location(assessment) {
        params.push(("location".into(), location));
    }
    let description = event_description(assessment);
    if !description.is_empty() {
        params.push(("details".into(), description));
    }

    let query: Vec<String> = params
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                crate::auth::providers::percent_encode(key),
                crate::auth::providers::percent_encode(value)
            )
        })
        .collect();
    Some(format!(
        "https://calendar.google.com/calendar/render?{}",
        query.join("&")
    ))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::plan::fixtures::assessment_on;
    use crate::sources::FixedTokenProvider;
    use chrono::NaiveTime;
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn plus_two() -> FixedOffset {
        FixedOffset::east_opt(2 * 3600).unwrap()
    }

    fn dated_upcoming(id: &str) -> Assessment {
        let mut item = assessment_on(
            id,
            Some("CSE241"),
            "Quiz 1",
            NaiveDate::from_ymd_opt(2026, 11, 3),
            vec!["Loops", "Recursion"],
        );
        item.start_time = NaiveTime::from_hms_opt(10, 0, 0);
        item.end_time = NaiveTime::from_hms_opt(11, 30, 0);
        item.room = Some("Hall A-101".to_string());
        item.warnings = vec!["Bring your student ID".to_string()];
        item.ai_study_plan = Some("Revise loops first.".to_string());
        item
    }

    fn event_url(event_id: &str) -> String {
        format!("/calendars/primary/events/{event_id}")
    }

    #[tokio::test]
    async fn two_runs_create_zero_new_events_on_the_second_run() {
        let server = MockServer::start().await;
        // The create endpoint is mounted with expect(1) for the WHOLE test:
        // run 1 consumes it, run 2 must not touch it again.
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "evt-1" })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(event_url("evt-1")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "evt-1" })))
            .mount(&server)
            .await;
        let client = http_client_for_tests();
        let provider = FixedTokenProvider {
            access_token: "tok".into(),
        };
        let items = vec![dated_upcoming("gmail-1")];

        let first = push_assessments_to_google_calendar(
            &client,
            &server.uri(),
            &provider,
            &items,
            &HashMap::new(),
            &plus_two,
        )
        .await;
        assert_eq!(first.created, 1);
        assert_eq!(first.updated, 0);
        assert!(first.success, "{:?}", first.message);
        assert_eq!(
            first.synced,
            vec![("gmail-1".to_string(), "evt-1".to_string())]
        );

        let map = first.synced_map();
        let second = push_assessments_to_google_calendar(
            &client,
            &server.uri(),
            &provider,
            &items,
            &map,
            &plus_two,
        )
        .await;
        assert_eq!(second.created, 0, "second run must create 0 new events");
        assert_eq!(second.updated, 1);
        assert!(second.success, "{:?}", second.message);
        server.verify().await;
    }

    #[tokio::test]
    async fn deleted_remote_event_is_recreated_on_404() {
        let server = MockServer::start().await;
        Mock::given(method("PUT"))
            .and(path(event_url("evt-stale")))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "evt-fresh" })))
            .mount(&server)
            .await;

        let mut map = HashMap::new();
        map.insert("gmail-1".to_string(), "evt-stale".to_string());
        let report = push_assessments_to_google_calendar(
            &http_client_for_tests(),
            &server.uri(),
            &FixedTokenProvider {
                access_token: "tok".into(),
            },
            &[dated_upcoming("gmail-1")],
            &map,
            &plus_two,
        )
        .await;

        assert_eq!(report.created, 1);
        assert_eq!(
            report.synced,
            vec![("gmail-1".to_string(), "evt-fresh".to_string())]
        );
        assert!(report.success, "{:?}", report.message);
    }

    #[tokio::test]
    async fn scope_refusal_reports_needs_scope_and_never_marks_synced() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;

        let report = push_assessments_to_google_calendar(
            &http_client_for_tests(),
            &server.uri(),
            &FixedTokenProvider {
                access_token: "tok".into(),
            },
            &[dated_upcoming("gmail-1")],
            &HashMap::new(),
            &plus_two,
        )
        .await;

        assert!(!report.success);
        assert!(report.needs_scope, "403 must surface as needs_scope");
        assert!(
            report.synced.is_empty(),
            "a refused push is never marked synced"
        );
        assert_eq!(report.failed_ids, vec!["gmail-1"]);
        assert!(report.message.contains("reconnect your Google account"));
    }

    #[tokio::test]
    async fn api_500_is_a_failed_item_not_a_scope_problem() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let report = push_assessments_to_google_calendar(
            &http_client_for_tests(),
            &server.uri(),
            &FixedTokenProvider {
                access_token: "tok".into(),
            },
            &[dated_upcoming("gmail-1")],
            &HashMap::new(),
            &plus_two,
        )
        .await;

        assert!(!report.success);
        assert!(!report.needs_scope);
        assert_eq!(report.failed_ids, vec!["gmail-1"]);
        assert!(report.message.contains("HTTP 500"));
    }

    #[tokio::test]
    async fn undated_drafts_are_skipped_and_said_so() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let undated = assessment_on("gmail-2", None, "Draft", None, vec![]);
        let report = push_assessments_to_google_calendar(
            &http_client_for_tests(),
            &server.uri(),
            &FixedTokenProvider {
                access_token: "tok".into(),
            },
            &[undated],
            &HashMap::new(),
            &plus_two,
        )
        .await;

        assert!(report.success);
        assert_eq!(report.total_pushable, 0);
        assert_eq!(report.skipped_undated, 1);
        assert!(report.message.contains("no confirmed date"));
        server.verify().await;
    }

    #[tokio::test]
    async fn event_body_carries_caller_offset_and_users_data_only() {
        let server = MockServer::start().await;
        // The whole body shape is asserted through matching: a request that
        // does not carry the offset-suffixed datetimes simply never matches.
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .and(body_partial_json(json!({
                "summary": "⚡ [CSE241] Quiz 1",
                "start": { "dateTime": "2026-11-03T10:00:00+02:00" },
                "end": { "dateTime": "2026-11-03T11:30:00+02:00" },
                "location": "Room Hall A-101",
                "reminders": { "useDefault": false }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "evt-9" })))
            .mount(&server)
            .await;

        let report = push_assessments_to_google_calendar(
            &http_client_for_tests(),
            &server.uri(),
            &FixedTokenProvider {
                access_token: "tok".into(),
            },
            &[dated_upcoming("gmail-1")],
            &HashMap::new(),
            &plus_two,
        )
        .await;
        assert!(
            report.success,
            "body must match the v4 shape with the injected offset: {:?}",
            report.message
        );
    }

    #[test]
    fn sparse_items_never_fabricate_venues_or_general_tags() {
        let mut item = assessment_on(
            "gmail-3",
            None,
            "Quiz 2",
            NaiveDate::from_ymd_opt(2026, 11, 3),
            vec![],
        );
        item.start_time = None;
        item.end_time = None;
        let body = build_event_body(&item, plus_two());
        let summary = body["summary"].as_str().unwrap();
        assert_eq!(summary, "⚡ Quiz 2");
        assert!(body["location"].is_null(), "{body}");
        assert_eq!(body["start"]["date"], "2026-11-03");
        assert_eq!(body["end"]["date"], "2026-11-04");
        assert!(body["description"]
            .as_str()
            .unwrap()
            .contains("Assessment Type: Class Quiz"));
        assert!(!body["description"].as_str().unwrap().contains("Room:"));
    }

    #[test]
    fn template_url_encodes_the_event_for_the_render_endpoint() {
        let item = dated_upcoming("gmail-1");
        let url = template_url(&item).unwrap();
        assert!(url.starts_with("https://calendar.google.com/calendar/render?"));
        assert!(url.contains("action=TEMPLATE"));
        assert!(
            url.contains("dates=20261103T100000%2F20261103T113000"),
            "{url}"
        );
        assert!(url.contains("text="), "{url}");
        assert!(url.contains("location=Room"), "{url}");

        let undated = assessment_on("gmail-2", None, "Draft", None, vec![]);
        assert!(
            template_url(&undated).is_none(),
            "undated items get no template link"
        );
    }

    #[tokio::test]
    async fn pushes_travel_as_bearer_requests_on_the_events_path() {
        // Pins the transport shape: POST to …/calendars/primary/events with
        // the Authorization header (never query-parameter tokens).
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/calendars/primary/events"))
            .and(header("authorization", "Bearer tok"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "evt" })))
            .expect(1)
            .mount(&server)
            .await;

        let report = push_assessments_to_google_calendar(
            &http_client_for_tests(),
            &server.uri(),
            &FixedTokenProvider {
                access_token: "tok".into(),
            },
            &[dated_upcoming("gmail-1")],
            &HashMap::new(),
            &plus_two,
        )
        .await;
        assert!(report.success, "{:?}", report.message);
        server.verify().await;
    }

    fn http_client_for_tests() -> reqwest::Client {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap()
    }
}
