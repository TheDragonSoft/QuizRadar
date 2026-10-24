//! Source fetchers + the honest sync orchestrator (phase 05,
//! `prompts/p05-core-sources-sync.md`): Gmail (5 queries, dedupe, 60-day
//! window), Teams (Graph + honest heuristic fallback that never invents
//! deadlines), Moodle (iCal + REST), .ics feeds (https-only, ≤10), Classroom
//! (due-date-gated). Empty results are reported honestly — a scan says what
//! ran and what was found, never "connection active" theatre.

pub mod classroom;
pub mod feeds;
pub mod gmail;
pub mod moodle;
pub mod sync;
pub mod teams;

#[cfg(test)]
pub mod test_support;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::PoisonError;
use std::time::Duration;

use crate::auth::providers::ProviderCapability;
use crate::types::Assessment;

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
pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("failed to build the shared HTTP client: {e}"))
}

/// Network error string with the request URL stripped: feed URLs embed
/// personal access tokens and must never land in notes, logs or UI copy.
pub(crate) fn net_err(prefix: &str, error: reqwest::Error) -> String {
    format!("{prefix}: {}", error.without_url())
}

/// Scheme gate for token-bearing URLs (Moodle channels, feeds): https only,
/// with one narrow exception — loopback http (`127.0.0.1`/`localhost`), where
/// traffic never leaves the device (recorded-fixture tests and local tooling
/// rely on this; the store's persistence gate stays https-only, unconditionally).
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
pub struct Progress<'a> {
    name: &'a str,
    callback: &'a (dyn Fn(SourceProgress) + Send + Sync),
}

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

/// Recovers a poisoned mutex honestly (same doctrine as the store facade).
pub(crate) fn recover<T>(poisoned: PoisonError<T>) -> T {
    poisoned.into_inner()
}
