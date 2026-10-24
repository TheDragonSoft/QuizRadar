//! The honest sync orchestrator (`01` §4.2, `03` §B3): runs every enabled
//! source concurrently (bounded), feeds each result through the shared
//! parsers, merges with user-field preservation, and reports REAL per-source
//! progress and outcomes — "not configured" is said, failures fail loudly,
//! and an empty scan says exactly which sources ran and found nothing.

use std::sync::Arc;

use chrono::{FixedOffset, NaiveDate};

use crate::parse::email::parse_emails_from_source;
use crate::sources::classroom::{scan_classroom, ClassroomScan};
use crate::sources::feeds::{scan_feeds, FeedScan};
use crate::sources::gmail::{scan_gmail, GmailScan};
use crate::sources::moodle::{scan_moodle, MoodleIcalConfig, MoodleRestConfig, MoodleScan};
use crate::sources::teams::{scan_teams, TeamsAiDiscovery, TeamsDiscovery};
use crate::sources::{
    http_client, merge_preserving_user_fields, Progress, SourceRun, SourceStatus, TokenProvider,
};
use crate::types::{Assessment, AssessmentSource, CachedEmail, FeedConfig, ScheduleData};

/// Everything the caller enables for this run. Tokens are per-call bearer
/// suppliers — the core never persists or transports them.
#[derive(Clone, Default)]
pub struct SyncConfig {
    pub gmail_enabled: bool,
    pub teams_enabled: bool,
    pub moodle_enabled: bool,
    pub classroom_enabled: bool,
    pub feeds: Vec<FeedConfig>,
    /// Google bearer (Gmail + Classroom). `None` = not signed in.
    pub google: Option<Arc<dyn TokenProvider>>,
    /// Microsoft bearer (Teams). `None` = not signed in.
    pub microsoft: Option<Arc<dyn TokenProvider>>,
    /// Moodle iCal channel.
    pub moodle_ical_url: Option<String>,
    /// Moodle REST channel (`Some` when both parts exist — enforced here so
    /// a half-configured channel is reported, not half-run).
    pub moodle_rest_url: Option<String>,
    pub moodle_rest_token: Option<String>,
}

impl SyncConfig {
    #[must_use]
    pub fn moodle_ical(&self) -> Option<MoodleIcalConfig> {
        self.moodle_ical_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .map(|url| MoodleIcalConfig {
                ical_url: url.to_string(),
                // The REST base doubles as the portal fallback link.
                portal_url: self.moodle_rest_url.clone(),
            })
    }

    #[must_use]
    pub fn moodle_rest(&self) -> Option<MoodleRestConfig> {
        match (
            self.moodle_rest_url.as_deref().map(str::trim),
            self.moodle_rest_token.as_deref().map(str::trim),
        ) {
            (Some(url), Some(token)) if !url.is_empty() && !token.is_empty() => {
                Some(MoodleRestConfig {
                    base_url: url.to_string(),
                    wstoken: token.to_string(),
                })
            }
            _ => None,
        }
    }

    /// Truthful note about half-configured Moodle channels.
    #[must_use]
    pub fn moodle_configuration_note(&self) -> Option<String> {
        let ical_ready = self.moodle_ical().is_some();
        let rest_ready = self.moodle_rest().is_some();
        let rest_url_present = self
            .moodle_rest_url
            .as_deref()
            .map(str::trim)
            .is_some_and(|url| !url.is_empty());
        let rest_token_present = self
            .moodle_rest_token
            .as_deref()
            .map(str::trim)
            .is_some_and(|token| !token.is_empty());
        if ical_ready || rest_ready {
            if rest_url_present != rest_token_present {
                return Some(
                    "Moodle REST channel ignored: it needs BOTH the site URL and the web-service token."
                        .to_string(),
                );
            }
            return None;
        }
        Some("Moodle: not configured — skipped.".to_string())
    }
}

/// The device's data context for one run (core owns no clock and no storage).
pub struct SyncInput {
    pub schedule: ScheduleData,
    /// The persisted announcement-email cache; Gmail updates it, everything
    /// else leaves it untouched.
    pub emails_cache: Vec<CachedEmail>,
    /// The current radar; the merge counts new/updated against it and
    /// preserves user-owned fields.
    pub existing_assessments: Vec<Assessment>,
    /// The caller's "today" (desktop `Local::now()`, Android `LocalDate.now()`,
    /// PWA the browser's date).
    pub reference_date: NaiveDate,
    /// The caller's local UTC offset (drives honest UTC→local conversion).
    pub local: FixedOffset,
}

/// The full, honest outcome of one sync run.
#[derive(Debug, Clone, Default)]
pub struct SyncReport {
    /// One entry per source that was considered (ran / skipped / failed).
    pub per_source: Vec<SourceRun>,
    pub total_new: usize,
    pub total_updated: usize,
    /// Truthful summary lines (sources ran, what was found, honest caveats).
    pub notes: Vec<String>,
    /// Existing radar merged with everything the sources found.
    pub assessments: Vec<Assessment>,
    /// Updated announcement-email cache (persist platform-side).
    pub emails_cache: Vec<CachedEmail>,
    /// Teams course discovery — adoption into the schedule is ALWAYS the
    /// user's explicit decision (never auto-merged, `03` §A3).
    pub discovered_teams: Option<TeamsDiscovery>,
}

/// Runs one full sync. `ai` is the optional Teams-discovery hook (phase 06
/// wires Gemini); `progress` receives real per-source pulses for the scan
/// overlay — no staged fiction.
pub async fn run_sync(
    config: &SyncConfig,
    input: &SyncInput,
    ai: Option<&dyn TeamsAiDiscovery>,
    progress: &(dyn Fn(crate::sources::SourceProgress) + Send + Sync),
) -> Result<SyncReport, String> {
    let client = http_client()?;

    let gmail_fut = run_gmail_source(config, input, &client, progress);
    let teams_fut = run_teams_source(config, &client, ai, progress);
    let moodle_fut = run_moodle_source(config, input, &client, progress);
    let classroom_fut = run_classroom_source(config, input, &client, progress);
    let feeds_fut = run_feeds_source(config, input, &client, progress);

    let (gmail, teams, moodle, classroom, feeds) =
        tokio::join!(gmail_fut, teams_fut, moodle_fut, classroom_fut, feeds_fut);

    // --- Gmail: updated cache → the whole cache goes through the parser ---
    let mut emails_cache = input.emails_cache.clone();
    let mut per_source: Vec<SourceRun> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut scanned: Vec<Assessment> = Vec::new();

    match gmail {
        (run, Some(gmail_scan)) => {
            let GmailScan {
                cache,
                stats,
                notes: scan_notes,
            } = gmail_scan;
            emails_cache = cache;
            let (assessments, parse_stats) = parse_emails_from_source(
                &emails_cache,
                &input.schedule,
                input.reference_date,
                AssessmentSource::Gmail,
            );
            let gmail_assessment_count = assessments.len();
            scanned.extend(assessments);
            notes.extend(scan_notes);
            notes.push(format!(
                "Gmail: {} quer{} ran, {} unique message(s), {} fetched this run; {} candidate announcement(s) parsed from the cache.",
                stats.queries_run,
                if stats.queries_run == 1 { "y" } else { "ies" },
                stats.unique_ids,
                stats.fetched,
                parse_stats.parsed
            ));
            per_source.push(SourceRun {
                found: gmail_assessment_count,
                ..run
            });
        }
        (run, None) => per_source.push(run),
    }

    // --- Teams: discovery is reported; adoption is always explicit ---
    let mut discovered_teams: Option<TeamsDiscovery> = None;
    match teams {
        (run, Some(discovery)) => {
            let courses_note = if discovery.courses.is_empty() {
                "Microsoft Teams: no teams matched as courses.".to_string()
            } else if discovery.ai_assisted {
                format!(
                    "Microsoft Teams: {} course(s) discovered via AI extraction — review and adopt them explicitly in Settings.",
                    discovery.courses.len()
                )
            } else {
                format!(
                    "Microsoft Teams: {} course(s) discovered from team names (heuristic — assessments are never invented from Teams).",
                    discovery.courses.len()
                )
            };
            notes.push(courses_note);
            scanned.extend(discovery.assessments.clone());
            let found = discovery.assessments.len();
            discovered_teams = Some(discovery);
            per_source.push(SourceRun { found, ..run });
        }
        (run, None) => per_source.push(run),
    }

    for (_source, scan) in [
        ("moodle", moodle),
        ("classroom", classroom),
        ("feeds", feeds),
    ] {
        match scan {
            Ok((run, assessments, scan_notes)) => {
                notes.extend(scan_notes);
                per_source.push(SourceRun {
                    found: assessments.len(),
                    ..run
                });
                scanned.extend(assessments);
            }
            Err(run) => per_source.push(run),
        }
    }

    // --- Merge with the existing radar (user fields preserved, honest counts)
    let (assessments, counts) = merge_preserving_user_fields(&input.existing_assessments, scanned);

    // --- Honest summary (03 §B3: the sources that RAN are named) ---
    let ran: Vec<&SourceRun> = per_source
        .iter()
        .filter(|run| matches!(run.status, SourceStatus::Ran))
        .collect();
    if ran.is_empty() {
        let all_skipped = per_source
            .iter()
            .all(|run| matches!(run.status, SourceStatus::Skipped { .. }));
        if all_skipped {
            notes.push(
                "No sources are configured on this device yet — 0 found. Sign in or add feeds in Settings → Integrations; your manual entries stay untouched.".to_string(),
            );
        } else {
            notes.push(
                "0 found — every configured source failed; see the per-source errors. Nothing was invented to fill the gap.".to_string(),
            );
        }
    } else {
        let ran_names: Vec<String> = ran.iter().map(|run| run.name.clone()).collect();
        notes.push(format!(
            "Sources ran: {}. Found {} new, {} refreshed, {} unchanged.",
            ran_names.join(", "),
            counts.added,
            counts.updated,
            counts.unchanged
        ));
    }

    Ok(SyncReport {
        per_source,
        total_new: counts.added,
        total_updated: counts.updated,
        notes,
        assessments,
        emails_cache,
        discovered_teams,
    })
}

async fn run_gmail_source(
    config: &SyncConfig,
    input: &SyncInput,
    client: &reqwest::Client,
    progress: &(dyn Fn(crate::sources::SourceProgress) + Send + Sync),
) -> (SourceRun, Option<GmailScan>) {
    let progress = Progress::new("Gmail", progress);
    if !config.gmail_enabled {
        return (skipped_run("Gmail", "not enabled on this device"), None);
    }
    let Some(provider) = config.google.as_ref() else {
        return (
            skipped_run(
                "Gmail",
                "Google account not connected — sign in to enable scanning",
            ),
            None,
        );
    };
    match scan_gmail(
        client,
        provider.as_ref(),
        crate::sources::gmail::GMAIL_API_BASE,
        &input.emails_cache,
        &progress,
    )
    .await
    {
        Ok(scan) => (ran_run("Gmail"), Some(scan)),
        Err(error) => (failed_run("Gmail", &error), None),
    }
}

async fn run_teams_source(
    config: &SyncConfig,
    client: &reqwest::Client,
    ai: Option<&dyn TeamsAiDiscovery>,
    progress: &(dyn Fn(crate::sources::SourceProgress) + Send + Sync),
) -> (SourceRun, Option<TeamsDiscovery>) {
    let progress = Progress::new("Microsoft Teams", progress);
    if !config.teams_enabled {
        return (
            skipped_run("Microsoft Teams", "not enabled on this device"),
            None,
        );
    }
    let Some(provider) = config.microsoft.as_ref() else {
        return (
            skipped_run(
                "Microsoft Teams",
                "Microsoft account not connected — sign in to enable scanning",
            ),
            None,
        );
    };
    match scan_teams(
        client,
        provider.as_ref(),
        crate::sources::teams::GRAPH_API_BASE,
        ai,
        &progress,
    )
    .await
    {
        Ok(discovery) => (ran_run("Microsoft Teams"), Some(discovery)),
        Err(error) => (failed_run("Microsoft Teams", &error), None),
    }
}

async fn run_moodle_source(
    config: &SyncConfig,
    input: &SyncInput,
    client: &reqwest::Client,
    progress: &(dyn Fn(crate::sources::SourceProgress) + Send + Sync),
) -> Result<(SourceRun, Vec<Assessment>, Vec<String>), SourceRun> {
    let progress = Progress::new("Moodle", progress);
    if !config.moodle_enabled {
        return Err(skipped_run("Moodle", "not enabled on this device"));
    }
    if let Some(note) = config.moodle_configuration_note() {
        return Err(skipped_run("Moodle", &note));
    }
    match scan_moodle(
        client,
        config.moodle_ical().as_ref(),
        config.moodle_rest().as_ref(),
        &input.schedule,
        input.reference_date,
        input.local,
        &progress,
    )
    .await
    {
        Ok(MoodleScan { assessments, notes }) => Ok((ran_run("Moodle"), assessments, notes)),
        Err(error) => Err(failed_run("Moodle", &error)),
    }
}

async fn run_classroom_source(
    config: &SyncConfig,
    input: &SyncInput,
    client: &reqwest::Client,
    progress: &(dyn Fn(crate::sources::SourceProgress) + Send + Sync),
) -> Result<(SourceRun, Vec<Assessment>, Vec<String>), SourceRun> {
    let progress = Progress::new("Google Classroom", progress);
    if !config.classroom_enabled {
        return Err(skipped_run(
            "Google Classroom",
            "not enabled on this device",
        ));
    }
    let Some(provider) = config.google.as_ref() else {
        return Err(skipped_run(
            "Google Classroom",
            "Google account not connected — sign in to enable scanning",
        ));
    };
    match scan_classroom(
        client,
        provider.as_ref(),
        crate::sources::classroom::CLASSROOM_API_BASE,
        &input.schedule,
        input.reference_date,
        &progress,
    )
    .await
    {
        Ok(ClassroomScan {
            assessments,
            stats,
            notes,
        }) => {
            let mut notes = notes;
            notes.push(format!(
                "Google Classroom: {} active course(s), {} coursework item(s) scanned, {} with due dates (others are honestly skipped).",
                stats.courses, stats.coursework_scanned, stats.with_due_date
            ));
            Ok((ran_run("Google Classroom"), assessments, notes))
        }
        Err(error) => Err(failed_run("Google Classroom", &error)),
    }
}

async fn run_feeds_source(
    config: &SyncConfig,
    input: &SyncInput,
    client: &reqwest::Client,
    progress: &(dyn Fn(crate::sources::SourceProgress) + Send + Sync),
) -> Result<(SourceRun, Vec<Assessment>, Vec<String>), SourceRun> {
    let progress = Progress::new("Calendar feeds", progress);
    if config.feeds.is_empty() {
        return Err(skipped_run("Calendar feeds", "no feeds configured"));
    }
    match scan_feeds(
        client,
        &config.feeds,
        &input.schedule,
        input.reference_date,
        input.local,
        &progress,
    )
    .await
    {
        Ok(FeedScan {
            assessments,
            runs,
            notes: mut_notes,
        }) => {
            let mut notes = mut_notes;
            for run in &runs {
                if let Some(error) = &run.error {
                    notes.push(format!("Feed \"{}\" failed: {error}", run.name));
                }
            }
            let failed = runs
                .iter()
                .filter(|run| run.error.is_some())
                .map(|run| run.name.clone())
                .collect::<Vec<_>>();
            if failed.len() == runs.len() {
                return Err(failed_run(
                    "Calendar feeds",
                    &format!("every feed failed: {}", failed.join(", ")),
                ));
            }
            notes.push(format!(
                "Feeds: {} of {} feed(s) returned items.",
                runs.iter().filter(|run| run.found > 0).count(),
                runs.len()
            ));
            Ok((ran_run("Calendar feeds"), assessments, notes))
        }
        Err(error) => Err(failed_run("Calendar feeds", &error)),
    }
}

fn ran_run(name: &str) -> SourceRun {
    SourceRun {
        name: name.to_string(),
        status: SourceStatus::Ran,
        found: 0,
        notes: Vec::new(),
    }
}

fn skipped_run(name: &str, reason: &str) -> SourceRun {
    SourceRun {
        name: name.to_string(),
        status: SourceStatus::Skipped {
            reason: reason.to_string(),
        },
        found: 0,
        notes: Vec::new(),
    }
}

fn failed_run(name: &str, error: &str) -> SourceRun {
    SourceRun {
        name: name.to_string(),
        status: SourceStatus::Failed {
            error: error.to_string(),
        },
        found: 0,
        notes: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::sources::SourceProgress;
    use crate::types::{AssessmentType, Course};
    use chrono::NaiveTime;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn ref_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 23).unwrap()
    }

    fn utc() -> FixedOffset {
        FixedOffset::east_opt(0).unwrap()
    }

    fn schedule() -> ScheduleData {
        ScheduleData {
            semester: None,
            courses: vec![Course {
                id: "CSE241".to_string(),
                name: "Object-Oriented Programming".to_string(),
                color: "#1a73e8".to_string(),
                bg: None,
                border: None,
            }],
            slots: Vec::new(),
        }
    }

    fn input(schedule: &ScheduleData) -> SyncInput {
        SyncInput {
            schedule: schedule.clone(),
            emails_cache: Vec::new(),
            existing_assessments: Vec::new(),
            reference_date: ref_date(),
            local: utc(),
        }
    }

    const FEED_FIXTURE: &str = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:CSE241 Quiz 3\nDTSTART:20261103T100000Z\nUID:q3@registrar\nEND:VEVENT\nEND:VCALENDAR\n";

    #[tokio::test]
    async fn zero_enabled_sources_is_truthful_not_theatre() {
        // THE acceptance case: nothing configured → "0 found, nothing
        // configured", every source honestly skipped.
        let config = SyncConfig::default();
        let schedule = schedule();
        let report = run_sync(&config, &input(&schedule), None, &|_| {})
            .await
            .unwrap();

        assert_eq!(report.per_source.len(), 5);
        assert!(report
            .per_source
            .iter()
            .all(|run| matches!(run.status, SourceStatus::Skipped { .. })));
        assert_eq!(report.total_new, 0);
        assert_eq!(report.total_updated, 0);
        assert!(report.assessments.is_empty());
        assert!(report.notes.iter().any(|note| {
            note.contains("No sources are configured") && note.contains("0 found")
        }));
    }

    #[tokio::test]
    async fn enabled_without_a_connection_is_skipped_with_a_reason() {
        let config = SyncConfig {
            gmail_enabled: true,
            teams_enabled: true,
            classroom_enabled: true,
            ..SyncConfig::default()
        };
        let schedule = schedule();
        let report = run_sync(&config, &input(&schedule), None, &|_| {})
            .await
            .unwrap();

        for name in ["Gmail", "Microsoft Teams", "Google Classroom"] {
            let run = report
                .per_source
                .iter()
                .find(|run| run.name == name)
                .unwrap_or_else(|| panic!("{name} should be reported"));
            match &run.status {
                SourceStatus::Skipped { reason } => {
                    assert!(reason.contains("not connected") || reason.contains("sign in"));
                }
                other => panic!("{name} should be skipped, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn feeds_only_run_merges_honestly_and_counts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;

        let config = SyncConfig {
            feeds: vec![FeedConfig {
                id: "feed-1".to_string(),
                name: "Registrar".to_string(),
                url: format!("{}/feed.ics", server.uri()),
                enabled: true,
            }],
            ..SyncConfig::default()
        };
        let schedule = schedule();
        let report = run_sync(&config, &input(&schedule), None, &|_| {})
            .await
            .unwrap();

        let feeds_run = report
            .per_source
            .iter()
            .find(|run| run.name == "Calendar feeds")
            .unwrap();
        assert!(matches!(feeds_run.status, SourceStatus::Ran));
        assert_eq!(feeds_run.found, 1);
        assert_eq!(report.total_new, 1);
        assert_eq!(report.total_updated, 0);
        assert_eq!(report.assessments.len(), 1);
        assert_eq!(report.assessments[0].id, "feed-q3_registrar");
        assert!(report
            .notes
            .iter()
            .any(|note| note.starts_with("Sources ran: Calendar feeds")));
        // Sources that were not configured are named, not silently omitted.
        assert!(report
            .per_source
            .iter()
            .any(|run| run.name == "Gmail" && matches!(run.status, SourceStatus::Skipped { .. })));
    }

    #[tokio::test]
    async fn rescan_of_unchanged_items_counts_neither_new_nor_updated() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;

        let schedule = schedule();
        let config = SyncConfig {
            feeds: vec![FeedConfig {
                id: "feed-1".to_string(),
                name: "Registrar".to_string(),
                url: format!("{}/feed.ics", server.uri()),
                enabled: true,
            }],
            ..SyncConfig::default()
        };

        let first = run_sync(&config, &input(&schedule), None, &|_| {})
            .await
            .unwrap();
        assert_eq!(first.total_new, 1);

        let mut second_input = input(&schedule);
        second_input.existing_assessments = first.assessments.clone();
        // A user grade on the existing item must survive the rescan.
        second_input.existing_assessments[0].achieved_score = Some(9.0);
        let second = run_sync(&config, &second_input, None, &|_| {})
            .await
            .unwrap();
        assert_eq!(second.total_new, 0);
        assert_eq!(second.total_updated, 0);
        assert_eq!(second.assessments[0].achieved_score, Some(9.0));
        assert_eq!(second.assessments[0].id, "feed-q3_registrar");
    }

    #[test]
    fn merge_preserves_user_fields_and_counts_honestly() {
        let existing = vec![Assessment {
            id: "gmail-1".to_string(),
            course_id: Some("CSE241".to_string()),
            course_name: None,
            title: "Quiz 1".to_string(),
            assessment_type: AssessmentType::ClassQuiz,
            date: NaiveDate::from_ymd_opt(2026, 10, 30),
            day_name: None,
            start_time: NaiveTime::from_hms_opt(9, 0, 0),
            end_time: None,
            display_time: None,
            room: None,
            group: None,
            instructor: None,
            is_upcoming: true,
            days_until: Some(7),
            urgency_level: crate::types::UrgencyLevel::Upcoming,
            priority_score: 50,
            topics: Vec::new(),
            warnings: Vec::new(),
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
            elearning_url: None,
            google_cal_url: None,
            gcal_synced: true,
            gcal_event_id: Some("evt-1".to_string()),
            color: None,
            bg: None,
            border: None,
            semester: None,
            email_subject: None,
            email_sent_date: None,
            source: AssessmentSource::Gmail,
            source_icon: None,
            weightage_percent: Some(10.0),
            achieved_score: Some(8.0),
            max_score: Some(10.0),
            conflict_warning: None,
        }];

        // Same content (user fields ignored) → unchanged; user fields survive.
        let rescanned = existing[0].clone();
        let (merged, counts) = merge_preserving_user_fields(&existing, vec![rescanned]);
        assert_eq!(counts.added, 0);
        assert_eq!(counts.updated, 0);
        assert_eq!(counts.unchanged, 1);
        assert_eq!(merged[0].achieved_score, Some(8.0));
        assert_eq!(merged[0].gcal_event_id.as_deref(), Some("evt-1"));

        // Different date on the rescan → updated, user fields still preserved.
        let mut changed = existing[0].clone();
        changed.date = NaiveDate::from_ymd_opt(2026, 11, 2);
        changed.achieved_score = None; // incoming has no grade; preservation must win
        changed.gcal_synced = false;
        let (merged, counts) = merge_preserving_user_fields(&existing, vec![changed]);
        assert_eq!(counts.updated, 1);
        assert_eq!(merged[0].achieved_score, Some(8.0));
        assert!(merged[0].gcal_synced);
        assert_eq!(
            merged[0].date,
            NaiveDate::from_ymd_opt(2026, 11, 2),
            "scanned content updates non-user fields"
        );

        // A brand-new id → added.
        let mut fresh = existing[0].clone();
        fresh.id = "gmail-2".to_string();
        let (_merged, counts) = merge_preserving_user_fields(&existing, vec![fresh]);
        assert_eq!(counts.added, 1);
    }

    #[tokio::test]
    async fn progress_pulses_carry_real_stage_and_counts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/feed.ics"))
            .respond_with(ResponseTemplate::new(200).set_body_string(FEED_FIXTURE))
            .mount(&server)
            .await;

        let config = SyncConfig {
            feeds: vec![FeedConfig {
                id: "feed-1".to_string(),
                name: "Registrar".to_string(),
                url: format!("{}/feed.ics", server.uri()),
                enabled: true,
            }],
            ..SyncConfig::default()
        };
        let schedule = schedule();

        let pulses = std::sync::Mutex::new(Vec::new());
        let _report = run_sync(&config, &input(&schedule), None, &|pulse| {
            pulses.lock().unwrap().push(pulse)
        })
        .await
        .unwrap();

        let pulses = pulses.into_inner().unwrap();
        // The feeds source pulses at least fetching → done with real counts.
        assert!(pulses
            .iter()
            .any(|p: &SourceProgress| p.name == "Calendar feeds" && p.stage == "fetching"));
        assert!(pulses
            .iter()
            .any(|p: &SourceProgress| p.name == "Calendar feeds"
                && p.stage == "done"
                && p.found == 1));
        // Gmail emits a real "searching" stage even when skipped-then-reported
        // (skips happen before any fake stage could be claimed).
        assert!(pulses
            .iter()
            .all(|p| p.name != "Gmail" || p.stage != "fetching"));
    }

    #[tokio::test]
    async fn all_configured_sources_failing_is_loud() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let config = SyncConfig {
            feeds: vec![FeedConfig {
                id: "feed-1".to_string(),
                name: "Registrar".to_string(),
                url: format!("{}/feed.ics", server.uri()),
                enabled: true,
            }],
            ..SyncConfig::default()
        };
        let schedule = schedule();
        let report = run_sync(&config, &input(&schedule), None, &|_| {})
            .await
            .unwrap();

        let feeds_run = report
            .per_source
            .iter()
            .find(|run| run.name == "Calendar feeds")
            .unwrap();
        assert!(matches!(feeds_run.status, SourceStatus::Failed { .. }));
        assert!(report
            .notes
            .iter()
            .any(|note| note.contains("every configured source failed")));
        assert_eq!(report.total_new, 0);
    }

    #[tokio::test]
    async fn half_configured_moodle_is_reported_not_half_run() {
        let config = SyncConfig {
            moodle_enabled: true,
            moodle_rest_url: Some("https://moodle.univ.edu".to_string()),
            // No token → the REST channel alone cannot run.
            ..SyncConfig::default()
        };
        let report = run_sync(&config, &input(&schedule()), None, &|_| {})
            .await
            .unwrap();

        let moodle_run = report
            .per_source
            .iter()
            .find(|run| run.name == "Moodle")
            .unwrap();
        match &moodle_run.status {
            SourceStatus::Skipped { reason } => {
                assert!(
                    reason.contains("BOTH") || reason.contains("not configured"),
                    "honest skip reason: {reason}"
                );
            }
            other => panic!("Moodle should be skipped, got {other:?}"),
        }
    }
}
