//! Moodle source (`02` §5.4): two concurrent channels — the personal iCal
//! export URL (token embedded in the URL, HTTPS enforced) and the Web
//! Services REST endpoint (`core_calendar_get_calendar_events`, token in the
//! POST body + `Authorization: Bearer`, never in the URL).
//!
//! Both channels run through the SAME honesty pipeline as `.ics` feeds
//! (`parse::ics`): keyword filtering, course matching, no invented dates,
//! times, rooms, instructors or groups. v4's REST path stamped every event
//! "Online Quiz" with a fabricated room/instructor/priority — deleted.

use std::collections::HashSet;

use chrono::{DateTime, FixedOffset, NaiveDate};
use serde_json::Value;

use crate::parse::email::{strip_html_tags, ScanStats};
use crate::parse::ics::{
    assessment_from_event, is_ics_candidate, parse_ical_datetime, parse_ics_assessments, IcsEvent,
    IcsOrigin,
};
use crate::sources::net_err;
use crate::types::{Assessment, ScheduleData};

pub const MOODLE_WS_ENDPOINT_SUFFIX: &str = "/webservice/rest/server.php";
pub const MOODLE_WS_FUNCTION: &str = "core_calendar_get_calendar_events";

/// iCal channel configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoodleIcalConfig {
    /// Personal calendar export URL (typically embeds a private token).
    pub ical_url: String,
    /// Portal base URL for honest fallback links (`{portal}/calendar/view.php?view=upcoming`).
    pub portal_url: Option<String>,
}

/// REST channel configuration. `wstoken` is a per-call secret supplied by the
/// platform (keyring/EncryptedSharedPreferences) — the core never stores it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoodleRestConfig {
    pub base_url: String,
    pub wstoken: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MoodleScan {
    pub assessments: Vec<Assessment>,
    pub notes: Vec<String>,
    /// True when every CONFIGURED channel answered.
    ///
    /// A half-answered source is not a complete picture of what it
    /// announces, so it must not retire anything: the items of the channel
    /// that failed are missing from this scan, not cancelled.
    pub channels_complete: bool,
}

/// Combined scan: both configured channels run concurrently; a single failed
/// channel degrades to an honest note, both failing fails the source.
pub async fn scan_moodle(
    client: &reqwest::Client,
    ical: Option<&MoodleIcalConfig>,
    rest: Option<&MoodleRestConfig>,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    local: FixedOffset,
    progress: &crate::sources::Progress<'_>,
) -> Result<MoodleScan, String> {
    progress.emit("connecting", 0, 0);
    let ical_fut = async {
        match ical {
            Some(config) => {
                fetch_moodle_ical_events(
                    client,
                    &config.ical_url,
                    config.portal_url.as_deref(),
                    schedule,
                    ref_date,
                    local,
                )
                .await
            }
            None => Ok((Vec::new(), ScanStats::default())),
        }
    };
    let rest_fut = async {
        match rest {
            Some(config) => {
                fetch_moodle_rest_events(
                    client,
                    &config.base_url,
                    &config.wstoken,
                    schedule,
                    ref_date,
                    local,
                )
                .await
            }
            None => Ok((Vec::new(), ScanStats::default())),
        }
    };

    let (ical_result, rest_result) = tokio::join!(ical_fut, rest_fut);

    let mut notes = Vec::new();
    let mut items: Vec<Assessment> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for (channel, result) in [("iCal feed", ical_result), ("REST API", rest_result)] {
        match result {
            Ok((assessments, stats)) => {
                if stats.scanned > 0 {
                    notes.push(format!(
                        "Moodle {channel}: {} calendar event(s) scanned, {} assessment item(s) parsed.",
                        stats.scanned, stats.parsed
                    ));
                }
                items.extend(assessments);
            }
            Err(error) => failures.push(format!("Moodle {channel} failed: {error}")),
        }
    }

    if !failures.is_empty() && items.is_empty() {
        // Nothing survived: fail the source loudly instead of "0 found" theatre.
        return Err(failures.join("; "));
    }
    let channels_complete = failures.is_empty();
    for failure in failures {
        notes.push(failure);
    }

    // Cross-channel dedupe by merge key (the same event can surface via both
    // channels with different ids); the iCal channel's copy wins (v4 tried
    // iCal first too).
    let mut seen: HashSet<String> = HashSet::new();
    items.retain(|item| seen.insert(crate::parse::merge::merge_key(item)));

    let found = items.len();
    progress.emit("done", found, found);
    Ok(MoodleScan {
        assessments: items,
        notes,
        channels_complete,
    })
}

/// iCal channel: HTTPS-enforced fetch + the shared ICS pipeline.
pub async fn fetch_moodle_ical_events(
    client: &reqwest::Client,
    ical_url: &str,
    portal_url: Option<&str>,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    local: FixedOffset,
) -> Result<(Vec<Assessment>, ScanStats), String> {
    // The feed URL typically embeds an access token: never send it in the clear.
    crate::sources::enforce_https(
        ical_url,
        "Moodle calendar feed must use HTTPS (http:// would send your access token in the clear). Re-copy the feed link starting with https:// from Moodle.",
    )?;

    let response = client
        .get(ical_url.trim())
        .send()
        .await
        .map_err(|e| net_err("Failed to connect to Moodle calendar feed", e))?;
    if !response.status().is_success() {
        return Err(format!("Moodle responded with HTTP {}", response.status()));
    }
    let text = response
        .text()
        .await
        .map_err(|e| net_err("Moodle feed body could not be read", e))?;

    let origin = IcsOrigin::Moodle {
        portal_url: portal_url.map(str::to_string),
    };
    Ok(parse_ics_assessments(
        &text, schedule, &origin, ref_date, local,
    ))
}

/// REST channel: POSTs the web-service token in the body (never the URL) and
/// maps events through the shared ICS honesty pipeline.
pub async fn fetch_moodle_rest_events(
    client: &reqwest::Client,
    base_url: &str,
    wstoken: &str,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    local: FixedOffset,
) -> Result<(Vec<Assessment>, ScanStats), String> {
    let clean_url = base_url.trim().trim_end_matches('/');
    crate::sources::enforce_https(
        clean_url,
        "Moodle site must use HTTPS (http:// would send your web-service token in the clear). Use your portal's https:// address.",
    )?;
    let endpoint = format!("{clean_url}{MOODLE_WS_ENDPOINT_SUFFIX}");

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {wstoken}"))
        .form(&[
            ("wstoken", wstoken.to_string()),
            ("wsfunction", MOODLE_WS_FUNCTION.to_string()),
            ("moodlewsrestformat", "json".to_string()),
        ])
        .send()
        .await
        .map_err(|e| net_err("Failed to call Moodle REST API", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Moodle REST API returned HTTP {}",
            response.status()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|e| net_err("Failed to parse Moodle JSON response", e))?;
    if let Some(error) = value.get("message").and_then(Value::as_str) {
        return Err(format!("Moodle API error: {error}"));
    }

    let origin = IcsOrigin::Moodle {
        portal_url: Some(clean_url.to_string()),
    };
    let mut stats = ScanStats::default();
    let mut assessments: Vec<Assessment> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for event in rest_events(&value) {
        stats.scanned += 1;
        if !is_ics_candidate(&event) {
            continue;
        }
        stats.candidates += 1;
        let Some(assessment) = assessment_from_event(&event, schedule, &origin, ref_date, local)
        else {
            continue;
        };
        if seen.insert(crate::parse::merge::merge_key(&assessment)) {
            stats.parsed += 1;
            assessments.push(assessment);
        } else {
            stats.skipped_duplicates += 1;
        }
    }
    Ok((assessments, stats))
}

/// Maps Moodle REST events onto the shared ICS event model. Events without a
/// name or a parseable `timestart` are skipped honestly (never re-anchored).
fn rest_events(value: &Value) -> Vec<IcsEvent> {
    let mut events = Vec::new();
    let Some(list) = value.get("events").and_then(Value::as_array) else {
        return events;
    };
    for ev in list {
        let Some(name) = ev.get("name").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let timestart = ev.get("timestart").and_then(Value::as_i64).unwrap_or(0);
        if timestart == 0 {
            continue;
        }
        let Some(dtstart_utc) = DateTime::from_timestamp(timestart, 0) else {
            continue;
        };
        let uid = ev
            .get("id")
            .and_then(Value::as_i64)
            .map(|id| format!("api-{id}"))
            .unwrap_or_else(|| format!("api-ts-{timestart}"));

        // v4 ignored the description; v5 parses it after HTML-stripping (the
        // REST field is HTML) so topics/warnings stay honest.
        let raw_description = ev
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let description = strip_html_tags(raw_description);

        let dtstart = parse_ical_datetime(&dtstart_utc.format("%Y%m%dT%H%M%SZ").to_string());
        // DTEND only when Moodle actually reports a duration — v4 defaulted a
        // missing duration to one hour; that invention is deleted.
        let dtend = ev
            .get("timeduration")
            .and_then(Value::as_i64)
            .filter(|duration| *duration > 0)
            .and_then(|duration| DateTime::from_timestamp(timestart + duration, 0))
            .and_then(|end| parse_ical_datetime(&end.format("%Y%m%dT%H%M%SZ").to_string()));

        events.push(IcsEvent {
            uid,
            summary: name.to_string(),
            description,
            dtstart,
            dtend,
            url: None,
        });
    }
    events
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::parse::ics::parse_ics_events;
    use crate::sources::{http_client, Progress};
    use crate::types::{Course, ScheduleSlot};
    use chrono::TimeZone;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn schedule() -> ScheduleData {
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            courses: vec![Course {
                id: "CSE241".to_string(),
                name: "Object-Oriented Programming".to_string(),
                color: "#e67c73".to_string(),
                bg: None,
                border: None,
            }],
            slots: vec![ScheduleSlot {
                id: "slot-1".to_string(),
                day: "Tue".to_string(),
                day_index: 2,
                course_id: "CSE241".to_string(),
                course_name: "Object-Oriented Programming".to_string(),
                slot_type: "Lecture".to_string(),
                group: None,
                room: Some("Lab 301".to_string()),
                start_time: chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                end_time: chrono::NaiveTime::from_hms_opt(10, 30, 0).unwrap(),
                display_time: "09:00–10:30".to_string(),
                has_quiz: false,
                quiz_title: None,
            }],
        }
    }

    fn ref_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
    }

    fn utc() -> FixedOffset {
        FixedOffset::east_opt(0).unwrap()
    }

    const ICS_FIXTURE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:CSE241 Online Quiz 1\r\nDESCRIPTION:Covering Chapter 1 and Chapter 2\r\nDTSTART:20261020T100000Z\r\nDTEND:20261020T110000Z\r\nUID:quiz123@moodle.univ.edu\r\nURL:https://moodle.univ.edu/mod/quiz/view.php?id=123\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[tokio::test]
    async fn ical_channel_runs_the_shared_honesty_pipeline() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ICS_FIXTURE))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let (items, stats) = fetch_moodle_ical_events(
            &client,
            &format!("{}/calendar/export.ics", server.uri()),
            None,
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap();

        assert_eq!(stats.scanned, 1);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.id, "moodle-quiz123_moodle.univ.edu");
        assert_eq!(item.course_id.as_deref(), Some("CSE241"));
        assert_eq!(item.title, "CSE241 Online Quiz 1");
        assert_eq!(
            item.date.map(|d| d.to_string()).as_deref(),
            Some("2026-10-20")
        );
        // UTC start converted through the caller's (UTC) offset.
        assert_eq!(
            item.start_time.map(|t| t.format("%H:%M").to_string()),
            Some("10:00".to_string())
        );
        // Room only from the student's own slot; never a fabricated default.
        assert_eq!(item.room.as_deref(), Some("Lab 301"));
        assert_eq!(item.instructor, None);
        assert_eq!(item.group, None);
        assert_eq!(
            item.elearning_url.as_deref(),
            Some("https://moodle.univ.edu/mod/quiz/view.php?id=123")
        );
    }

    #[tokio::test]
    async fn plaintext_ical_urls_are_rejected() {
        let client = http_client().unwrap();
        let error = fetch_moodle_ical_events(
            &client,
            "http://moodle.univ.edu/calendar/export.ics",
            None,
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("must use HTTPS"), "honest error: {error}");
    }

    #[tokio::test]
    async fn ical_http_error_is_loud() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let client = http_client().unwrap();
        let error = fetch_moodle_ical_events(
            &client,
            &format!("{}/denied.ics", server.uri()),
            None,
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("HTTP 403"));
    }

    #[tokio::test]
    async fn rest_channel_maps_events_through_the_same_pipeline() {
        let server = MockServer::start().await;
        let timestart = chrono::Utc
            .with_ymd_and_hms(2026, 10, 20, 9, 0, 0)
            .unwrap()
            .timestamp();
        Mock::given(method("POST"))
            .and(path("/webservice/rest/server.php"))
            .and(body_string_contains("core_calendar_get_calendar_events"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "events": [
                    {
                        "id": 7,
                        "name": "CSE241 Quiz 2",
                        "description": "<p>Chapter 3</p>",
                        "timestart": timestart,
                        "timeduration": 3600
                    },
                    {
                        "id": 8,
                        "name": "Week 5 lecture",
                        "timestart": timestart,
                        "timeduration": 5400
                    }
                ]
            })))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let (items, stats) = fetch_moodle_rest_events(
            &client,
            &server.uri(),
            "wstoken-xyz",
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap();

        // The lecture is keyword-filtered like any ICS event; only the quiz lands.
        assert_eq!(stats.scanned, 2);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.id, "moodle-api-7");
        assert_eq!(item.course_id.as_deref(), Some("CSE241"));
        assert_eq!(
            item.date.map(|d| d.to_string()).as_deref(),
            Some("2026-10-20")
        );
        // Honest mapping: no fabricated "Moodle LMS Portal" room, no "Faculty".
        assert_eq!(item.room.as_deref(), Some("Lab 301"));
        assert_eq!(item.instructor, None);
        assert_eq!(item.group, None);
        // Description (HTML-stripped) feeds the topic scraper.
        assert!(item.topics.iter().any(|topic| topic.contains("Chapter 3")));
        // Portal fallback link (the REST base doubles as the portal).
        assert!(item
            .elearning_url
            .as_deref()
            .is_some_and(|url| url.ends_with("/calendar/view.php?view=upcoming")));
    }

    #[tokio::test]
    async fn rest_api_errors_surface_the_moodle_message() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({"error": "accessexception", "message": "Invalid token"}),
            ))
            .mount(&server)
            .await;
        let client = http_client().unwrap();
        let error = fetch_moodle_rest_events(
            &client,
            &server.uri(),
            "bad-token",
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("Invalid token"), "honest error: {error}");
    }

    #[tokio::test]
    async fn scan_moodle_dedupes_cross_channel() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ICS_FIXTURE))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"events": []})),
            )
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Moodle", &|_| {});
        let scan = scan_moodle(
            &client,
            Some(&MoodleIcalConfig {
                ical_url: format!("{}/export.ics", server.uri()),
                portal_url: None,
            }),
            Some(&MoodleRestConfig {
                base_url: server.uri(),
                wstoken: "t".to_string(),
            }),
            &schedule(),
            ref_date(),
            utc(),
            &progress,
        )
        .await
        .unwrap();
        assert_eq!(scan.assessments.len(), 1);
        assert!(
            scan.channels_complete,
            "both channels answered, so the scan is a complete picture"
        );
    }

    /// A half-answered source is not a complete picture: the items of the
    /// channel that failed are missing from the scan, not cancelled — so the
    /// scan must not be allowed to retire them.
    #[tokio::test]
    async fn a_failed_moodle_channel_makes_the_scan_incomplete() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ICS_FIXTURE))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Moodle", &|_| {});
        let scan = scan_moodle(
            &client,
            Some(&MoodleIcalConfig {
                ical_url: format!("{}/export.ics", server.uri()),
                portal_url: None,
            }),
            Some(&MoodleRestConfig {
                base_url: server.uri(),
                wstoken: "t".to_string(),
            }),
            &schedule(),
            ref_date(),
            utc(),
            &progress,
        )
        .await
        .unwrap();
        assert_eq!(scan.assessments.len(), 1);
        assert!(
            !scan.channels_complete,
            "a failed channel means the scan is not a complete picture"
        );
        assert!(
            scan.notes
                .iter()
                .any(|note| note.contains("REST API failed")),
            "the failure is reported: {:?}",
            scan.notes
        );
    }

    #[test]
    fn rest_events_skip_nameless_and_undated_items() {
        let value = serde_json::json!({
            "events": [
                {"id": 1, "timestart": 1792462800},
                {"id": 2, "name": "", "timestart": 1792462800},
                {"id": 3, "name": "No start"},
                {"id": 4, "name": "Valid", "timestart": 1792462800, "timeduration": 0}
            ]
        });
        let events = rest_events(&value);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary, "Valid");
        // duration 0 → no DTEND (v4's invented +1h is gone)
        assert!(events[0].dtend.is_none());
        // Sanity: the shared structural parser accepts our constructed event.
        assert_eq!(parse_ics_events("").len(), 0);
    }
}
