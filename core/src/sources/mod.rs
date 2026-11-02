//! Source fetchers + the honest sync orchestrator (phase 05,
//! `prompts/p05-core-sources-sync.md`): Gmail (5 queries, dedupe, 60-day
//! window), Teams (Graph + honest heuristic fallback that never invents
//! deadlines), Moodle (iCal + REST), .ics feeds (https-only, ≤10), Classroom
//! (due-date-gated). Empty results are reported honestly — a scan says what
//! ran and what was found, never "connection active" theatre.

#[cfg(not(target_arch = "wasm32"))]
pub mod classroom;
#[cfg(not(target_arch = "wasm32"))]
pub mod feeds;
#[cfg(not(target_arch = "wasm32"))]
pub mod gmail;
#[cfg(not(target_arch = "wasm32"))]
pub mod moodle;
#[cfg(not(target_arch = "wasm32"))]
pub mod sync;
#[cfg(not(target_arch = "wasm32"))]
pub mod teams;

#[cfg(test)]
pub mod test_support;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::PoisonError;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;

use crate::auth::providers::ProviderCapability;
use crate::types::Assessment;
use chrono::{DateTime, NaiveDate, Utc};

// ---------------------------------------------------------------------------
// Token supply (the platform's half of the auth story)
// ---------------------------------------------------------------------------

/// Bearer supply for one platform. The core never stores or transports
/// refresh tokens — the shell's implementation reads the OS keyring /
/// EncryptedSharedPreferences / memory and may refresh an expired token
/// before returning (`04` §4.3). Sources call this again after a 401 to give
/// the platform exactly one silent-refresh chance (v4 JS engine parity).
pub trait TokenProvider: Send + Sync {
    fn bearer<'a>(
        &'a self,
        capability: ProviderCapability,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;
}

/// Trivial provider for platforms that hold a per-call access token (tests,
/// the memory-only PWA tier, a shell that already refreshed).
pub struct FixedTokenProvider {
    pub access_token: String,
}

impl TokenProvider for FixedTokenProvider {
    fn bearer<'a>(
        &'a self,
        _capability: ProviderCapability,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>> {
        Box::pin(std::future::ready(Ok(self.access_token.clone())))
    }
}

// ---------------------------------------------------------------------------
// Shared HTTP plumbing
// ---------------------------------------------------------------------------

/// `reqwest` client with v4's timeouts (10 s connect / 30 s total). Built per
/// sync run — no `expect()` panics on the fetch path.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("failed to build the shared HTTP client: {e}"))
}

/// Network error string with the request URL stripped: feed URLs embed
/// personal access tokens and must never land in notes, logs or UI copy.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn net_err(prefix: &str, error: reqwest::Error) -> String {
    format!("{prefix}: {}", error.without_url())
}

/// Scheme gate for token-bearing URLs (Moodle channels, feeds): https only,
/// with one narrow exception — loopback http (`127.0.0.1`/`localhost`), where
/// traffic never leaves the device (recorded-fixture tests and local tooling
/// rely on this; the store's persistence gate stays https-only, unconditionally).
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn enforce_https(url: &str, insecure_message: &str) -> Result<(), String> {
    let trimmed = url.trim();
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("https://") {
        return Ok(());
    }
    if lowered.starts_with("http://") {
        let host = trimmed["http://".len()..]
            .split(['/', ':', '?'])
            .next()
            .unwrap_or("");
        if host.eq_ignore_ascii_case("127.0.0.1") || host.eq_ignore_ascii_case("localhost") {
            return Ok(());
        }
    }
    Err(insecure_message.to_string())
}

/// GET with the platform's one silent-refresh chance: a 401 re-asks the
/// [`TokenProvider`]; only a genuinely different token triggers one retry.
/// A still-401 response (or an unchanged token) surfaces honestly to the
/// caller, which reports "reconnect your account" instead of pretending.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) async fn authed_get(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    capability: ProviderCapability,
    url: &str,
) -> Result<reqwest::Response, String> {
    let token = provider.bearer(capability).await?;
    let first = client
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| net_err("network request failed", e))?;
    if first.status().as_u16() != 401 {
        return Ok(first);
    }
    let refreshed = provider.bearer(capability).await?;
    if refreshed == token {
        return Ok(first);
    }
    client
        .get(url)
        .bearer_auth(&refreshed)
        .send()
        .await
        .map_err(|e| net_err("network request failed after token refresh", e))
}

// ---------------------------------------------------------------------------
// Real per-source progress (03 §B3: no staged fiction)
// ---------------------------------------------------------------------------

/// One progress pulse from a running source. `stage` values are plain
/// machine-checkable labels (`"connecting"`, `"searching"`, `"fetching"`,
/// `"parsing"`, `"done"`, `"skipped"`, `"failed"`); `found` counts items
/// discovered so far and `done` counts units of work completed. The scan
/// overlay renders exactly this — never a hardcoded stage script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceProgress {
    pub name: String,
    pub stage: &'static str,
    pub found: usize,
    pub done: usize,
}

/// Bound callback handed to each source runner. Public because the fetcher
/// signatures expose it; shells normally go through [`sync::run_sync`],
/// which wires this automatically.
#[cfg(not(target_arch = "wasm32"))]
pub struct Progress<'a> {
    name: &'a str,
    callback: &'a (dyn Fn(SourceProgress) + Send + Sync),
}

#[cfg(not(target_arch = "wasm32"))]
impl<'a> Progress<'a> {
    #[must_use]
    pub fn new(name: &'a str, callback: &'a (dyn Fn(SourceProgress) + Send + Sync)) -> Self {
        Self { name, callback }
    }

    pub(crate) fn emit(&self, stage: &'static str, found: usize, done: usize) {
        (self.callback)(SourceProgress {
            name: self.name.to_string(),
            stage,
            found,
            done,
        });
    }
}

// ---------------------------------------------------------------------------
// Per-source run bookkeeping (SyncReport building blocks)
// ---------------------------------------------------------------------------

/// What happened to one source: it ran, it was honestly skipped
/// ("not configured"), or it failed loudly (never a fake success).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceStatus {
    Ran,
    Skipped { reason: String },
    Failed { error: String },
}

/// One source's outcome for [`sync::SyncReport::per_source`]. `found` is the
/// number of assessments the source contributed (courses discovered by Teams
/// are reported in its notes, not inflated into this count).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRun {
    pub name: String,
    pub status: SourceStatus,
    pub found: usize,
    pub notes: Vec<String>,
    /// The id of THIS run of this source, e.g. `"gmail-2026-11-01T09:12:00Z"`.
    ///
    /// It is `Some` only when the source actually RAN and therefore knows
    /// what it currently carries. A skipped or failed source has no run id:
    /// it saw nothing, so it cannot claim that an item it did not report has
    /// disappeared.
    pub run_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Discovered-course palette (UI-preset assignment, not data fabrication)
// ---------------------------------------------------------------------------

/// The 8 v4 preset accents (`01` §6, mirrored in `apps/web` `coursePalette.ts`).
const PALETTE_PRESETS: [&str; 8] = [
    "#1a73e8", "#0f9d58", "#ea8600", "#d93025", "#8e24aa", "#00acc1", "#e67c73", "#3949ab",
];

/// Deterministic preset assignment for *discovered* courses (Teams): FNV-1a
/// over the course id — same id ⇒ same preset forever, matching the web
/// derivation. This is decoration for the adoption flow; the honest content
/// (id/name) always comes from the source.
pub(crate) fn preset_course_colors(id: &str) -> (String, Option<String>, Option<String>) {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in id.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    let color = PALETTE_PRESETS[(hash as usize) % PALETTE_PRESETS.len()];
    (
        color.to_string(),
        Some(format!("{color}18")),
        Some(format!("{color}55")),
    )
}

// ---------------------------------------------------------------------------
// Scan merge — the `mergeScannedAssessments` rule (v4 JS engine, ported)
// ---------------------------------------------------------------------------

/// Honest merge counts: `added` = genuinely new ids, `updated` = existing ids
/// whose scanned content differs (beyond the user-owned fields below),
/// `unchanged` = refreshed but identical.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MergeCounts {
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
}

/// Fields the user (or the grade editor / GCal push) owns. A rescan never
/// overwrites them — v4 `mergeScannedAssessments`' preserve list, kept exact:
/// `achieved_score`, `max_score`, `weightage_percent`, `gcal_synced`,
/// `gcal_event_id`.
fn preserve_user_fields(current: &Assessment, incoming: &mut Assessment) {
    incoming.achieved_score = current.achieved_score;
    incoming.max_score = current.max_score;
    incoming.weightage_percent = current.weightage_percent;
    incoming.gcal_synced = current.gcal_synced;
    incoming.gcal_event_id = current.gcal_event_id.clone();
}

/// True when the scanned content differs from what is stored, ignoring the
/// user-owned fields (so an untouched assessment is not counted "updated").
fn scanned_content_differs(current: &Assessment, incoming: &Assessment) -> bool {
    let mut a = current.clone();
    let mut b = incoming.clone();
    for item in [&mut a, &mut b] {
        item.achieved_score = None;
        item.max_score = None;
        item.weightage_percent = None;
        item.gcal_synced = false;
        item.gcal_event_id = None;
        // The provenance stamp changes on EVERY scan by design - it records
        // which run last saw the announcement. It is not a content change,
        // so an announcement nobody touched still counts as unchanged.
        item.last_seen_source_run = None;
    }
    a != b
}

/// Merges freshly scanned assessments into the existing radar by id (v4
/// merge rule): new ids are appended, existing ids keep their user-owned
/// fields and take the scanned content. Ordering is NOT normalized here —
/// the planner owns radar order (phase 03).
#[must_use]
pub fn merge_preserving_user_fields(
    existing: &[Assessment],
    scanned: Vec<Assessment>,
) -> (Vec<Assessment>, MergeCounts) {
    let mut merged: Vec<Assessment> = existing.to_vec();
    let mut index_by_id: HashMap<String, usize> = merged
        .iter()
        .enumerate()
        .map(|(index, item)| (item.id.clone(), index))
        .collect();
    let mut counts = MergeCounts::default();

    for mut incoming in scanned {
        if let Some(&position) = index_by_id.get(&incoming.id) {
            let current = &merged[position];
            let changed = scanned_content_differs(current, &incoming);
            preserve_user_fields(current, &mut incoming);
            merged[position] = incoming;
            if changed {
                counts.updated += 1;
            } else {
                counts.unchanged += 1;
            }
        } else {
            index_by_id.insert(incoming.id.clone(), merged.len());
            merged.push(incoming);
            counts.added += 1;
        }
    }
    (merged, counts)
}

/// A per-process counter for source runs.
///
/// Two runs of the same source in the SAME SECOND must still be told apart:
/// "the same run id" means "the same scan", and two scans are never the same
/// scan - a second run that reports nothing is exactly the evidence a
/// retirement is made of.
static RUN_SEQUENCE: AtomicU32 = AtomicU32::new(0);

/// The id of one source run: a stable slug of the source name, the moment of
/// the run and a sequence number.
///
/// The moment is passed IN (never read from the clock here) so the WASM tier
/// can build the same ids from the browser's clock - one id format, one
/// implementation, every tier.
#[must_use]
pub fn source_run_id(name: &str, at: DateTime<Utc>) -> String {
    let slug: String = name
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let sequence = RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{slug}-{}-{sequence}", at.format("%Y-%m-%dT%H:%M:%SZ"))
}

/// Retires the items an authoritative source no longer carries.
///
/// WHO may retire: only a source whose scan is a complete picture of what it
/// currently announces - a subscribed `.ics` calendar or the student's Moodle
/// calendar. The caller decides that and passes those runs here. An
/// announcement STREAM (Gmail is a sliding window of recent mail, Teams and
/// Classroom are listings that age) is NOT authoritative: an announcement
/// that aged out of the window was never cancelled, so those sources never
/// appear in `ran_sources`.
///
/// WHAT is retired: an item that this source reported in an EARLIER run and
/// that this run does not report. Such an item is RETIRED, not deleted: it
/// keeps its date, its grades and its warnings and gains the reason - but it
/// is no longer upcoming, because there is nothing left to prepare for.
///
/// What is deliberately NOT touched:
/// - items of sources that were skipped or failed (they saw nothing, so they
///   cannot claim that an item vanished);
/// - items that no run has ever reported (imports, or items from before
///   provenance existed) - a scan cannot honestly retire an item it never
///   saw;
/// - items whose date has already passed: the event happened, it was not
///   cancelled - the planner already takes it off the radar.
pub fn retire_unseen_items(
    merged: &mut [Assessment],
    ran_sources: &[(String, String)],
    reference_date: NaiveDate,
) -> usize {
    let mut retired = 0usize;
    for item in merged.iter_mut() {
        if item.retired_source_run.is_some() {
            continue;
        }
        let source_key = item.source.provenance_key();
        let Some((_, run_id)) = ran_sources.iter().find(|(key, _)| *key == source_key) else {
            continue;
        };
        let Some(last_seen) = item.last_seen_source_run.as_deref() else {
            continue;
        };
        if last_seen == run_id {
            // Reported by THIS run - it is still live.
            continue;
        }
        if let Some(date) = item.date {
            if date < reference_date {
                // The event already happened. It was not cancelled, so it is
                // not retired - the planner takes it off the radar instead.
                continue;
            }
        }
        item.retired_source_run = Some(run_id.clone());
        item.is_upcoming = false;
        item.warnings.push(format!(
            "The latest {} scan did not report this announcement again - it was last reported by source run {last_seen}.",
            item.source.as_str()
        ));
        retired += 1;
    }
    retired
}

/// Recovers a poisoned mutex honestly (same doctrine as the store facade).
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn recover<T>(poisoned: PoisonError<T>) -> T {
    poisoned.into_inner()
}

#[cfg(test)]
mod retirement_tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::types::{AssessmentSource, AssessmentType, CompletedTopics, UrgencyLevel};
    use chrono::NaiveDate;

    /// The day the test scan runs on - before the item's date, so the item is
    /// still ahead of the student.
    fn reference_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()
    }

    fn item(id: &str, source: AssessmentSource, last_seen: Option<&str>) -> Assessment {
        Assessment {
            id: id.to_string(),
            course_id: Some("CS101".to_string()),
            course_name: None,
            title: "Quiz 1".to_string(),
            assessment_type: AssessmentType::ClassQuiz,
            date: NaiveDate::from_ymd_opt(2026, 10, 30),
            day_name: None,
            start_time: None,
            end_time: None,
            display_time: None,
            room: None,
            group: None,
            instructor: None,
            is_upcoming: true,
            days_until: None,
            urgency_level: UrgencyLevel::Upcoming,
            priority_score: 0,
            topics: vec!["Algorithms".to_string()],
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
            source,
            source_icon: None,
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
            last_seen_source_run: last_seen.map(str::to_string),
            retired_source_run: None,
        }
    }

    /// One authoritative source that RAN: its provenance key and its run id.
    fn ran(key: &str, run_id: &str) -> (String, String) {
        (key.to_string(), run_id.to_string())
    }

    #[test]
    fn an_item_the_source_no_longer_reports_is_retired_with_the_reason() {
        let mut items = vec![item(
            "feed-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-10-25T09:00:00Z"),
        )];
        let retired = retire_unseen_items(
            &mut items,
            &[ran("feed:registrar", "registrar-2026-11-01T09:00:00Z")],
            reference_date(),
        );
        assert_eq!(retired, 1);
        assert_eq!(
            items[0].retired_source_run.as_deref(),
            Some("registrar-2026-11-01T09:00:00Z")
        );
        assert!(!items[0].is_upcoming);
        assert!(
            items[0]
                .warnings
                .iter()
                .any(|warning| warning.contains("did not report this announcement again")),
            "the reason must be visible: {:?}",
            items[0].warnings
        );
        // The provenance of the LAST run that saw it is kept.
        assert_eq!(
            items[0].last_seen_source_run.as_deref(),
            Some("registrar-2026-10-25T09:00:00Z")
        );
    }

    #[test]
    fn an_item_the_source_still_reports_stays_live() {
        let mut items = vec![item(
            "feed-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-11-01T09:00:00Z"),
        )];
        let retired = retire_unseen_items(
            &mut items,
            &[ran("feed:registrar", "registrar-2026-11-01T09:00:00Z")],
            reference_date(),
        );
        assert_eq!(retired, 0);
        assert!(items[0].retired_source_run.is_none());
        assert!(items[0].is_upcoming);
    }

    #[test]
    fn a_source_that_did_not_run_never_retires_anything() {
        let mut items = vec![item(
            "feed-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-10-25T09:00:00Z"),
        )];
        // Only the Library feed ran: the Registrar feed saw nothing, so its
        // item stays untouched.
        let retired = retire_unseen_items(
            &mut items,
            &[ran("feed:library", "library-2026-11-01T09:00:00Z")],
            reference_date(),
        );
        assert_eq!(retired, 0);
        assert!(items[0].retired_source_run.is_none());
        assert!(items[0].is_upcoming);
    }

    #[test]
    fn one_feed_never_retires_another_feeds_announcements() {
        let mut items = vec![item(
            "feed-registrar-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-10-25T09:00:00Z"),
        )];
        // The Library feed ran fine; the Registrar feed failed. Only the
        // feed that RAN may retire - and only its own items.
        let retired = retire_unseen_items(
            &mut items,
            &[ran("feed:library", "library-2026-11-01T09:00:00Z")],
            reference_date(),
        );
        assert_eq!(retired, 0);
        assert!(items[0].retired_source_run.is_none());
    }

    #[test]
    fn an_item_no_run_ever_reported_is_never_retired() {
        let mut items = vec![item(
            "feed-imported",
            AssessmentSource::Feed("Registrar".to_string()),
            None,
        )];
        let retired = retire_unseen_items(
            &mut items,
            &[ran("feed:registrar", "registrar-2026-11-01T09:00:00Z")],
            reference_date(),
        );
        assert_eq!(retired, 0);
        assert!(items[0].retired_source_run.is_none());
        assert!(items[0].is_upcoming);
    }

    #[test]
    fn an_item_is_retired_only_once() {
        let mut items = vec![item(
            "feed-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-10-25T09:00:00Z"),
        )];
        let sources = [ran("feed:registrar", "registrar-2026-11-01T09:00:00Z")];
        assert_eq!(
            retire_unseen_items(&mut items, &sources, reference_date()),
            1
        );
        let warnings = items[0].warnings.len();
        assert_eq!(
            retire_unseen_items(&mut items, &sources, reference_date()),
            0
        );
        assert_eq!(items[0].warnings.len(), warnings);
    }

    #[test]
    fn an_item_that_already_happened_is_not_retired() {
        let mut items = vec![item(
            "feed-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-10-25T09:00:00Z"),
        )];
        // The quiz was on 2026-10-30; the scan runs on 2026-11-01. The feed
        // no longer lists it because it is over - not because it was
        // cancelled.
        let retired = retire_unseen_items(
            &mut items,
            &[ran("feed:registrar", "registrar-2026-11-01T09:00:00Z")],
            NaiveDate::from_ymd_opt(2026, 11, 1).unwrap(),
        );
        assert_eq!(retired, 0);
        assert!(items[0].retired_source_run.is_none());
    }

    #[test]
    fn a_retired_item_leaves_the_radar_and_asks_for_no_study_time() {
        use crate::plan::dashboard::radar_order;
        use crate::plan::tasks::build_study_tasks;

        let reference_date = reference_date();
        let mut items = vec![item(
            "feed-1",
            AssessmentSource::Feed("Registrar".to_string()),
            Some("registrar-2026-10-25T09:00:00Z"),
        )];
        retire_unseen_items(
            &mut items,
            &[ran("feed:registrar", "registrar-2026-11-01T09:00:00Z")],
            reference_date,
        );

        assert!(
            radar_order(&items, reference_date).is_empty(),
            "a retired announcement must not sit on the radar"
        );
        let tasks = build_study_tasks(&items, &CompletedTopics::new(), reference_date);
        assert!(
            tasks.readiness_cards.is_empty(),
            "a retired announcement must not ask for study time"
        );
    }

    #[test]
    fn the_run_id_is_the_source_slug_plus_the_moment_of_the_run() {
        let at = DateTime::parse_from_rfc3339("2026-11-01T09:12:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let first = source_run_id("Uni Registrar", at);
        let second = source_run_id("Uni Registrar", at);
        assert!(
            first.starts_with("uni-registrar-2026-11-01T09:12:00Z-"),
            "unexpected run id: {first}"
        );
        assert_ne!(
            first, second,
            "two runs in the same second must never share an id"
        );
    }
}
