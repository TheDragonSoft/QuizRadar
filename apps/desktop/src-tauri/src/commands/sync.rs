//! Sync & scanning commands (`02` §4 table, `04` §4.5, `04` §4.6).
//!
//! Bridges the core sync orchestrator, Google Calendar push, and Google Drive
//! appDataFolder cloud backup to Tauri IPC with live progress streaming.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use quizradar_core::cal::gcal::{
    push_assessments_to_google_calendar, GCalSyncReport, GCAL_API_BASE,
};
use quizradar_core::sources::sync::{run_sync as core_run_sync, SyncConfig, SyncInput};
use quizradar_core::sources::{SourceProgress, SourceStatus, TokenProvider};
use quizradar_core::store::backup::{DriveBackupClient, MergeReport, PushOutcome};
use quizradar_core::types::Course;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, DesktopGoogleTokenProvider, DesktopMicrosoftTokenProvider};

/// The event the scan overlay listens on. This is a cross-tier contract: the
/// web tier subscribes to exactly this name (`apps/web/src/state/ipcEvents.ts`
/// → `SYNC_PROGRESS_EVENT`), and a regression test asserts that both sides
/// agree. Emitting a different name leaves the overlay frozen on a stale
/// stage while the scan runs — the bug this constant exists to prevent.
pub const SYNC_PROGRESS_EVENT: &str = "sync-progress";

/// Honest abort message. The UI shows a cancellation as a cancellation (with
/// "your data was left untouched"), never as a failed scan.
pub const SCAN_CANCELED_MESSAGE: &str = "Scan canceled - your data was left untouched.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSourceProgress {
    pub name: String,
    pub stage: String,
    pub found: usize,
    pub done: usize,
}

impl From<SourceProgress> for DesktopSourceProgress {
    fn from(p: SourceProgress) -> Self {
        Self {
            name: p.name,
            stage: p.stage.to_string(),
            found: p.found,
            done: p.done,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub success: bool,
    pub total_new: usize,
    pub total_updated: usize,
    pub notes: Vec<String>,
    pub discovered_teams: Vec<Course>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopGCalSyncReport {
    pub success: bool,
    pub created: usize,
    pub updated: usize,
    pub total_pushable: usize,
    pub failed_ids: Vec<String>,
    pub skipped_undated: usize,
    pub needs_scope: bool,
    pub message: String,
    /// The assessment id → event id map after this push. The UI can show it;
    /// the store persists it (see `run_gcal_sync_inner`).
    pub synced_map: std::collections::HashMap<String, String>,
}

impl From<GCalSyncReport> for DesktopGCalSyncReport {
    fn from(r: GCalSyncReport) -> Self {
        let synced_map = r.synced_map();
        Self {
            success: r.success,
            created: r.created,
            updated: r.updated,
            total_pushable: r.total_pushable,
            failed_ids: r.failed_ids,
            skipped_undated: r.skipped_undated,
            needs_scope: r.needs_scope,
            message: r.message,
            synced_map,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPushOutcome {
    pub created: bool,
    pub file_id: Option<String>,
}

impl From<PushOutcome> for DesktopPushOutcome {
    fn from(p: PushOutcome) -> Self {
        match p {
            PushOutcome::Created => Self {
                created: true,
                file_id: None,
            },
            PushOutcome::Updated { file_id } => Self {
                created: false,
                file_id: Some(file_id),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPullResult {
    pub found: bool,
    pub merge_report: Option<MergeReport>,
}

// ---------------------------------------------------------------------------
// Inner testable execution
// ---------------------------------------------------------------------------

pub async fn run_sync_inner(
    progress_emit: Option<Arc<dyn Fn(SourceProgress) + Send + Sync>>,
    state: &AppState,
) -> Result<SyncResult, String> {
    if state
        .sync_in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A sync operation is already in progress.".to_string());
    }

    struct FlightGuard(Arc<std::sync::atomic::AtomicBool>);
    impl Drop for FlightGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _guard = FlightGuard(Arc::clone(&state.sync_in_flight));

    let today = state.today();
    let now = state.now_iso();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read store state: {e}"))?;

    let google_provider: Option<Arc<dyn TokenProvider>> = if state
        .keyring
        .get_secret(crate::keyring::KEY_GOOGLE_REFRESH_TOKEN)
        .unwrap_or(None)
        .is_some()
        || state.google_token.read().await.is_some()
    {
        Some(Arc::new(DesktopGoogleTokenProvider {
            state: state.clone(),
        }))
    } else {
        None
    };

    let microsoft_provider: Option<Arc<dyn TokenProvider>> = if state
        .keyring
        .get_secret(crate::keyring::KEY_MICROSOFT_REFRESH_TOKEN)
        .unwrap_or(None)
        .is_some()
        || state.microsoft_token.read().await.is_some()
    {
        Some(Arc::new(DesktopMicrosoftTokenProvider {
            state: state.clone(),
        }))
    } else {
        None
    };

    // The source toggles are the user's controls (spec `01` §4.1): a source
    // the user turned off must not run. A toggle the user never touched falls
    // back to "on when the account is connected" — Classroom and Teams follow
    // their account, Moodle follows an entered URL.
    let teams_toggle = state
        .store
        .get_config_bool("teams_enabled".to_string(), true)
        .await
        .unwrap_or(true);
    let classroom_toggle = match state
        .store
        .get_config_bool_opt("classroom_enabled".to_string())
        .await
        .unwrap_or(None)
    {
        Some(explicit) => explicit,
        None => google_provider.is_some(),
    };
    let moodle_ical_url = state
        .store
        .get_config_string("moodle_ical_url".to_string())
        .await
        .unwrap_or(None)
        .filter(|url| !url.trim().is_empty());
    let moodle_toggle = state
        .store
        .get_config_bool("moodle_enabled".to_string(), false)
        .await
        .unwrap_or(false);

    let config = SyncConfig {
        gmail_enabled: google_provider.is_some(),
        teams_enabled: microsoft_provider.is_some() && teams_toggle,
        classroom_enabled: google_provider.is_some() && classroom_toggle,
        moodle_enabled: moodle_toggle,
        feeds: snapshot.feeds.clone(),
        google: google_provider,
        microsoft: microsoft_provider,
        moodle_ical_url,
        moodle_rest_url: None,
        moodle_rest_token: None,
    };

    let input = SyncInput {
        schedule: snapshot.schedule,
        emails_cache: Vec::new(),
        existing_assessments: snapshot.assessments,
        reference_date: today,
        local: state.local_offset(),
    };

    let progress_cb = move |progress: SourceProgress| {
        if let Some(emit) = &progress_emit {
            emit(progress);
        }
    };

    // The user may abort the scan from the overlay's Cancel button. The abort
    // is honoured during the fetch phase only — the merge into the store
    // happens after it — so a canceled scan really leaves the radar
    // untouched instead of half-updated.
    let mut cancel_rx = state.cancel_token();
    let report = tokio::select! {
        biased;
        _ = cancel_rx.changed() => {
            return Err(SCAN_CANCELED_MESSAGE.to_string());
        }
        result = core_run_sync(&config, &input, None, &progress_cb) => result?,
    };

    // "Last synced" reflects real fetches only: a scan in which every source
    // was skipped or failed fetched nothing, so no stamp is written.
    let fetched_anything = report
        .per_source
        .iter()
        .any(|run| matches!(run.status, SourceStatus::Ran));

    if !report.assessments.is_empty() {
        state
            .store
            .replace_assessments(report.assessments, now, today)
            .await
            .map_err(|e| format!("Failed to save merged assessments: {e}"))?;
    }

    let mut notes = report.notes;
    if fetched_anything {
        if let Err(e) = state
            .store
            .set_last_gmail_sync(state.now_local_stamp())
            .await
        {
            // The scan itself succeeded; say so in the report instead of
            // pretending the whole scan failed.
            notes.push(format!(
                "The scan finished, but the 'Last synced' stamp could not be saved: {e}"
            ));
        }
    }

    let discovered_teams = report
        .discovered_teams
        .map(|d| d.courses)
        .unwrap_or_default();

    Ok(SyncResult {
        success: true,
        total_new: report.total_new,
        total_updated: report.total_updated,
        notes,
        discovered_teams,
    })
}

pub async fn run_gcal_sync_inner(state: &AppState) -> Result<DesktopGCalSyncReport, String> {
    // Reuse the scan's in-flight guard: two overlapping pushes both load the
    // same map and both POST the same assessments as new events.
    if state
        .sync_in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A sync operation is already in progress.".to_string());
    }
    struct FlightGuard(Arc<std::sync::atomic::AtomicBool>);
    impl Drop for FlightGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _guard = FlightGuard(Arc::clone(&state.sync_in_flight));

    let today = state.today();
    let snapshot = state
        .store
        .load_state(today)
        .await
        .map_err(|e| format!("Failed to read store state: {e}"))?;

    let provider = DesktopGoogleTokenProvider {
        state: state.clone(),
    };
    // The core's contract: a mapped id is a PUT (update), an unmapped id a
    // POST (create). Starting every push from an empty map re-created every
    // event in the user's calendar — the map must be loaded and re-persisted.
    let synced_map = state
        .store
        .synced_gcal_map()
        .await
        .map_err(|e| format!("Failed to read the Calendar sync map: {e}"))?;
    let offset = state.local_offset();
    let offset_fn = move || offset;

    let report = push_assessments_to_google_calendar(
        &state.http_client,
        GCAL_API_BASE,
        &provider,
        &snapshot.assessments,
        &synced_map,
        &offset_fn,
    )
    .await;

    // The Calendar stamp is written only after a push that really reached
    // Google Calendar — a "needs scope" or failed push stays unstamped. The
    // map MERGES with what was persisted: `report.synced_map()` holds only
    // this run's pairs, and replacing wholesale (a) dropped assessments that
    // were excluded from this run (a later date-edit would POST a duplicate)
    // and (b) erased the entire map when nothing was pushable.
    if report.success && (!report.synced.is_empty() || !report.failed_ids.is_empty()) {
        let mut merged = synced_map;
        for (assessment_id, event_id) in report.synced.iter() {
            merged.insert(assessment_id.clone(), event_id.clone());
        }
        if let Err(e) = state.store.set_synced_gcal_map(merged).await {
            return Err(format!(
                "The calendar push finished, but the Calendar event map could not be saved: {e}"
            ));
        }
        if let Err(e) = state
            .store
            .set_last_gcal_sync(state.now_local_stamp())
            .await
        {
            return Err(format!(
                "The calendar push finished, but the 'Last synced' stamp could not be saved: {e}"
            ));
        }
    }

    Ok(DesktopGCalSyncReport::from(report))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn run_sync(app: AppHandle, state: State<'_, AppState>) -> Result<SyncResult, String> {
    let state_clone = state.inner().clone();
    let app_handle = app.clone();
    let emit_fn: Arc<dyn Fn(SourceProgress) + Send + Sync> = Arc::new(move |progress| {
        let _ = app_handle.emit(SYNC_PROGRESS_EVENT, DesktopSourceProgress::from(progress));
    });

    tokio::task::spawn(async move { run_sync_inner(Some(emit_fn), &state_clone).await })
        .await
        .map_err(|e| format!("Sync task joined with error: {e}"))?
}

/// Aborts the running source scan (the overlay's Cancel button). The scan
/// drops its in-flight requests and returns without touching the store, so
/// the user's radar keeps exactly what it had.
#[tauri::command]
pub async fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
    state.request_cancel();
    Ok(())
}

#[tauri::command]
pub async fn run_gcal_sync(state: State<'_, AppState>) -> Result<DesktopGCalSyncReport, String> {
    let state_clone = state.inner().clone();
    tokio::task::spawn(async move { run_gcal_sync_inner(&state_clone).await })
        .await
        .map_err(|e| format!("GCal sync task joined with error: {e}"))?
}

#[tauri::command]
pub async fn push_cloud_backup(state: State<'_, AppState>) -> Result<DesktopPushOutcome, String> {
    let access_token = state.get_google_access_token().await?;
    let client = DriveBackupClient::new(access_token)
        .map_err(|e| format!("Failed to initialize Drive client: {e}"))?;

    let now = state.now_iso();
    let payload = state
        .store
        .build_backup_payload("quizradar-desktop".to_string(), now)
        .await
        .map_err(|e| format!("Failed to build backup payload: {e}"))?;

    let outcome = client
        .push(&payload)
        .await
        .map_err(|e| format!("Failed to push backup to Google Drive: {e}"))?;

    if let Err(e) = state
        .store
        .set_last_backup_push(state.now_local_stamp())
        .await
    {
        return Err(format!(
            "The backup reached Google Drive, but the 'Last synced' stamp could not be saved: {e}"
        ));
    }

    Ok(DesktopPushOutcome::from(outcome))
}

#[tauri::command]
pub async fn pull_cloud_backup(state: State<'_, AppState>) -> Result<CloudPullResult, String> {
    let access_token = state.get_google_access_token().await?;
    let client = DriveBackupClient::new(access_token)
        .map_err(|e| format!("Failed to initialize Drive client: {e}"))?;

    let maybe_payload = client
        .pull()
        .await
        .map_err(|e| format!("Failed to pull backup from Google Drive: {e}"))?;

    match maybe_payload {
        Some(payload) => {
            let now = state.now_iso();
            let today = state.today();
            let merge_report = state
                .store
                .merge_backup(payload, now, today)
                .await
                .map_err(|e| format!("Failed to merge cloud backup: {e}"))?;

            Ok(CloudPullResult {
                found: true,
                merge_report: Some(merge_report),
            })
        }
        None => Ok(CloudPullResult {
            found: false,
            merge_report: None,
        }),
    }
}
