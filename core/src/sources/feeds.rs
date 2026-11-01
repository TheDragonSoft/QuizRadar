//! Generic .ics subscription feeds (`02` §5.8): https-only URLs, ≤10 feeds,
//! ids `feed-*`, the user's own label as each item's source, dedupe by URL.
//! Reuses the shared ICS pipeline — any RFC 5545 VEVENT feed parses exactly
//! like the Moodle export, matched against the student's courses/slots.

use chrono::{FixedOffset, NaiveDate};
use futures::StreamExt;

use crate::parse::email::ScanStats;
use crate::parse::ics::{parse_ics_assessments, validate_feed_url, IcsOrigin};
use crate::sources::{net_err, Progress};
use crate::types::{Assessment, FeedConfig, ScheduleData};

/// Upper bound on feeds per sync so one config can never fan out unboundedly
/// (the store's FeedRepo already caps persistence at 10 — belt and braces).
pub const MAX_FEEDS: usize = 10;
/// Bounded concurrency across feeds.
pub const FEED_CONCURRENCY: usize = 3;

/// One feed's honest outcome (an error here never masquerades as "0 found").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeedRun {
    pub name: String,
    pub found: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FeedScan {
    pub assessments: Vec<Assessment>,
    pub runs: Vec<FeedRun>,
    pub notes: Vec<String>,
}

/// Downloads + parses one feed. `name` is the user's label and becomes every
/// parsed item's `source` (never mapped or renamed — the label is data).
pub async fn fetch_feed(
    client: &reqwest::Client,
    url: &str,
    name: &str,
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    local: FixedOffset,
) -> Result<(Vec<Assessment>, ScanStats), String> {
    validate_feed_url(url).or_else(|_| {
        // The pure validator is strictly https-only; the fetch layer allows
        // loopback http (traffic never leaves the device) for recorded
        // fixtures and local tooling.
        crate::sources::enforce_https(
            url,
            "Feed URL must use HTTPS (http:// would send any access token embedded in the link in the clear). Re-copy the link starting with https://.",
        )
    })?;

    let response = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| net_err("Failed to connect to calendar feed", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Feed server responded with HTTP {}",
            response.status()
        ));
    }
    let text = response
        .text()
        .await
        .map_err(|e| net_err("Feed body could not be read", e))?;
    if !text.contains("BEGIN:") {
        // A login page or error blob parsing as "0 events" would look like a
        // silently broken subscription; be honest that this isn't iCalendar.
        return Err(
            "The URL did not return an iCalendar (.ics) file. Use the direct calendar export/subscription link."
                .to_string(),
        );
    }

    let origin = IcsOrigin::Feed {
        name: name.to_string(),
        feed_url: Some(url.trim().to_string()),
    };
    Ok(parse_ics_assessments(
        &text, schedule, &origin, ref_date, local,
    ))
}

/// Runs the configured feeds concurrently (bounded), deduped by URL (first
/// occurrence wins) and capped at [`MAX_FEEDS`] with honest notes.
pub async fn scan_feeds(
    client: &reqwest::Client,
    feeds: &[FeedConfig],
    schedule: &ScheduleData,
    ref_date: NaiveDate,
    local: FixedOffset,
    progress: &Progress<'_>,
) -> Result<FeedScan, String> {
    let mut selected: Vec<FeedConfig> = Vec::new();
    let mut seen_urls: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut duplicate_urls = 0usize;
    let mut disabled = 0usize;
    for feed in feeds {
        let url = feed.url.trim().to_ascii_lowercase();
        if !seen_urls.insert(url) {
            duplicate_urls += 1;
            continue;
        }
        // The Settings toggle is an OFF switch, not a label: a disabled feed
        // must not be fetched (its token-bearing URL must not leave the
        // device) and its items must not merge into the radar.
        if !feed.enabled {
            disabled += 1;
            continue;
        }
        if selected.len() < MAX_FEEDS {
            selected.push(feed.clone());
        }
    }
    let overflow = feeds.len() - duplicate_urls - disabled - selected.len();

    let mut notes = Vec::new();
    if disabled > 0 {
        notes.push(format!("Feeds: {disabled} disabled feed(s) skipped."));
    }
    if duplicate_urls > 0 {
        notes.push(format!(
            "Feeds: {duplicate_urls} duplicate URL(s) skipped (first occurrence wins)."
        ));
    }
    if overflow > 0 {
        notes.push(format!(
            "Feeds: only the first {MAX_FEEDS} run; {overflow} configured beyond the cap were skipped."
        ));
    }

    progress.emit("fetching", selected.len(), 0);
    let outcomes: Vec<(Vec<Assessment>, FeedRun)> = futures::stream::iter(selected)
        .map(|feed| async move {
            match fetch_feed(client, &feed.url, &feed.name, schedule, ref_date, local).await {
                Ok((assessments, _stats)) => {
                    let run = FeedRun {
                        name: feed.name.clone(),
                        found: assessments.len(),
                        error: None,
                    };
                    (assessments, run)
                }
                Err(error) => {
                    let run = FeedRun {
                        name: feed.name.clone(),
                        found: 0,
                        error: Some(error),
                    };
                    (Vec::new(), run)
                }
            }
        })
        .buffer_unordered(FEED_CONCURRENCY)
        .collect()
        .await;

    let mut all_assessments: Vec<Assessment> = Vec::new();
    let mut runs: Vec<FeedRun> = Vec::new();
    for (assessments, run) in outcomes {
        all_assessments.extend(assessments);
        runs.push(run);
    }
    runs.sort_by(|a, b| a.name.cmp(&b.name));

    let found_total = runs.iter().map(|run| run.found).sum();
    progress.emit("done", found_total, runs.len());
    Ok(FeedScan {
        assessments: all_assessments,
        runs,
        notes,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::sources::http_client;
    use crate::types::Course;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn schedule() -> ScheduleData {
        ScheduleData {
            semester: None,
            courses: vec![Course {
                id: "MATH201".to_string(),
                name: "Calculus II".to_string(),
                color: "#1a73e8".to_string(),
                bg: None,
                border: None,
            }],
            slots: Vec::new(),
        }
    }

    fn ref_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
    }

    fn utc() -> FixedOffset {
        FixedOffset::east_opt(0).unwrap()
    }

    const FEED_FIXTURE: &str = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:MATH201 Midterm Exam\nDTSTART:20261105T140000Z\nUID:evt-9@registrar\nEND:VEVENT\nEND:VCALENDAR\n";

    #[tokio::test]
    async fn feed_items_carry_feed_ids_and_the_user_label() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/timetable.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let url = format!("{}/timetable.ics", server.uri());
        let (items, stats) = fetch_feed(
            &client,
            &url,
            "Uni Registrar",
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap();

        assert_eq!(stats.parsed, 1);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.id, "feed-evt-9_registrar");
        assert_eq!(item.source.as_str(), "Uni Registrar");
        assert_eq!(item.course_id.as_deref(), Some("MATH201"));
        assert_eq!(
            item.date.map(|d| d.to_string()).as_deref(),
            Some("2026-11-05")
        );
        // Phase-02 honesty decision: a generic feed falls back to NOTHING —
        // only its own URL property can name an event page (v4's feed-URL
        // fallback was dropped, logged in the phase-02 divergence notes).
        assert_eq!(item.elearning_url, None);
    }

    #[tokio::test]
    async fn non_icalendar_response_fails_loudly() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>Login</html>"))
            .mount(&server)
            .await;
        let client = http_client().unwrap();
        let error = fetch_feed(
            &client,
            &format!("{}/login-page", server.uri()),
            "Broken feed",
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap_err();
        assert!(
            error.contains("did not return an iCalendar"),
            "honest error: {error}"
        );
    }

    #[tokio::test]
    async fn plaintext_feed_urls_are_rejected_before_any_request() {
        let client = http_client().unwrap();
        let error = fetch_feed(
            &client,
            "http://uni.edu/timetable.ics?token=secret",
            "Feed",
            &schedule(),
            ref_date(),
            utc(),
        )
        .await
        .unwrap_err();
        assert!(error.contains("must use HTTPS"));
    }

    #[tokio::test]
    async fn scan_feeds_dedupes_by_url_and_reports_per_feed() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/broken.ics"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let url = format!("{}/feed.ics", server.uri());
        let broken = format!("{}/broken.ics", server.uri());
        let feeds = vec![
            FeedConfig {
                id: "feed-1".to_string(),
                name: "Registrar".to_string(),
                url: url.clone(),
                enabled: true,
            },
            // Same URL twice (case/space variants included) → deduped.
            FeedConfig {
                id: "feed-2".to_string(),
                name: "Registrar copy".to_string(),
                url: format!("{url} ",),
                enabled: true,
            },
            // A failing feed is reported, never folded into "0 found".
            FeedConfig {
                id: "feed-3".to_string(),
                name: "Broken".to_string(),
                url: broken,
                enabled: true,
            },
        ];

        let client = http_client().unwrap();
        let progress = Progress::new("Calendar feeds", &|_| {});
        let scan = scan_feeds(&client, &feeds, &schedule(), ref_date(), utc(), &progress)
            .await
            .unwrap();

        assert_eq!(scan.runs.len(), 2, "duplicate URL collapsed");
        assert!(scan.notes.iter().any(|note| note.contains("duplicate URL")));
        let registrar = scan
            .runs
            .iter()
            .find(|run| run.name == "Registrar")
            .unwrap();
        assert_eq!(registrar.found, 1);
        let broken = scan.runs.iter().find(|run| run.name == "Broken").unwrap();
        assert!(broken.error.is_some());
        assert_eq!(scan.assessments.len(), 1);
    }

    #[tokio::test]
    async fn scan_feeds_caps_at_ten_with_an_honest_note() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;
        let feeds: Vec<FeedConfig> = (0..12)
            .map(|i| FeedConfig {
                id: format!("feed-{i}"),
                name: format!("Feed {i}"),
                url: format!("{}/f{i}.ics", server.uri()),
                enabled: true,
            })
            .collect();
        let client = http_client().unwrap();
        let progress = Progress::new("Calendar feeds", &|_| {});
        let scan = scan_feeds(&client, &feeds, &schedule(), ref_date(), utc(), &progress)
            .await
            .unwrap();
        assert_eq!(scan.runs.len(), MAX_FEEDS);
        assert!(scan
            .notes
            .iter()
            .any(|note| note.contains("beyond the cap")));
    }
}
