//! OS backup import and export commands (`01` §4 backup modal, `04` §4.4).
//!
//! Provides local filesystem backup file export and import via native OS file dialogs
//! (`tauri-plugin-dialog`), completely serverless.
//!
//! Cross-tier study data: since the `study_*` bridge commands
//! (`commands/study.rs`) landed, the webview's study collections live in the
//! authoritative core SQLite store. The export wrapper still accepts a
//! webview `studyPayload` for two narrower purposes: pre-bridge webviews
//! (whose data lives browser-side in IndexedDB the Rust core can never read)
//! pass their full collections, and post-migration webviews pass ONLY their
//! webview-local focus-minutes ledger (`study_stats`) so the core's own
//! collection sections are never overridden with stale mirrors. On import the
//! command reports the file's study sections back so the web layer can mirror
//! them into its browser stores (the core importer has already restored them
//! into SQLite).

use std::fs;
use std::path::PathBuf;

use quizradar_core::store::importer::ImportReport;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;

/// The study-section keys the webview may override in the core payload, and
/// the import command mirrors back to the webview. Kept in one place so the
/// export override list and the import report list can never diverge.
const STUDY_SECTION_KEYS: &[&str] = &[
    "flashcards",
    "quiz_attempts",
    "mistake_bank",
    "study_sessions",
    "study_stats",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBackupResult {
    pub saved: bool,
    pub path: Option<String>,
    pub json: Option<String>,
}

/// The study sections a backup file carried, mirrored verbatim (the core
/// importer has already restored them into SQLite; the web layer uses this to
/// refresh its own browser-side copies). Sections the file did not carry are
/// absent — the web layer must leave its local collection untouched then,
/// exactly like the core importer does.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedStudySections {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flashcards: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quiz_attempts: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mistake_bank: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub study_sessions: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub study_stats: Option<serde_json::Value>,
}

/// Import command result: the flat core `ImportReport` (camelCase, unchanged
/// wire shape) plus the study metadata the webview layer needs to complete
/// the cross-tier restore in its own stores.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBackupResult {
    #[serde(flatten)]
    pub report: ImportReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub study_stats: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub study_import: Option<ImportedStudySections>,
}

/// Reads the study sections out of a backup file's raw JSON. `None` when the
/// file carries none of them (a v4 export) — the web layer then leaves its
/// collections untouched, mirroring the core importer's `None`-section rule.
fn extract_study_sections(content: &str) -> Option<ImportedStudySections> {
    let raw: serde_json::Value = serde_json::from_str(content).ok()?;
    let get = |key: &str| raw.get(key).cloned().filter(serde_json::Value::is_array);
    let stats = raw.get("study_stats").cloned();
    let has_any = STUDY_SECTION_KEYS.iter().any(|key| raw.get(*key).is_some());
    if !has_any {
        return None;
    }
    Some(ImportedStudySections {
        flashcards: get("flashcards"),
        quiz_attempts: get("quiz_attempts"),
        mistake_bank: get("mistake_bank"),
        study_sessions: get("study_sessions"),
        study_stats: stats.filter(|v| v.is_object()),
    })
}

#[tauri::command]
pub async fn export_backup_file(
    app: AppHandle,
    state: State<'_, AppState>,
    study_payload: Option<serde_json::Value>,
) -> Result<ExportBackupResult, String> {
    let now = state.now_iso();
    let today = state.today();

    let backup_json = state
        .store
        .export_v4_backup_json(now, today)
        .await
        .map_err(|e| format!("Failed to generate backup JSON: {e}"))?;

    // Thin web wrapper: the webview's study collections (browser IndexedDB)
    // override whatever the core could see — on this tier the webview stores
    // are where the user's study data actually lives. A `null`/failed payload
    // leaves the core sections untouched instead of fabricating an empty one.
    let backup_json = merge_study_payload(backup_json, study_payload)?;

    // The destination comes ONLY from the native OS save dialog. The webview
    // never supplies a path: an IPC-supplied path would let a compromised
    // renderer overwrite any user-writable file with attacker-influenced JSON.
    let target_path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name("quizradar-backup.json")
            .add_filter("JSON Backup", &["json"])
            .blocking_save_file()
            .and_then(|p| p.as_path().map(PathBuf::from))
    })
    .await
    .map_err(|e| format!("Save dialog failed: {e}"))?;

    match target_path {
        Some(dest) => {
            fs::write(&dest, &backup_json)
                .map_err(|e| format!("Failed to write backup file to {dest:?}: {e}"))?;
            Ok(ExportBackupResult {
                saved: true,
                path: Some(dest.to_string_lossy().to_string()),
                json: None,
            })
        }
        None => Ok(ExportBackupResult {
            saved: false,
            path: None,
            json: Some(backup_json),
        }),
    }
}

/// Overrides the study sections of the core-generated backup JSON with the
/// webview-supplied payload. The core JSON is a structurally valid backup, so
/// the merge can only add/replace known section keys — never corrupt the rest.
fn merge_study_payload(
    backup_json: String,
    study_payload: Option<serde_json::Value>,
) -> Result<String, String> {
    let Some(payload) = study_payload else {
        return Ok(backup_json);
    };
    let Some(sections) = payload.as_object() else {
        return Err("studyPayload must be a JSON object".to_string());
    };
    let mut backup: serde_json::Value = serde_json::from_str(&backup_json)
        .map_err(|e| format!("Core backup payload was not valid JSON: {e}"))?;
    {
        let obj = backup
            .as_object_mut()
            .ok_or_else(|| "Core backup payload was not a JSON object".to_string())?;
        for key in STUDY_SECTION_KEYS {
            if let Some(value) = sections.get(*key) {
                obj.insert((*key).to_string(), value.clone());
            }
        }
    }
    serde_json::to_string(&backup).map_err(|e| format!("Failed to serialize backup: {e}"))
}

#[tauri::command]
pub async fn import_backup_file(
    app: AppHandle,
    state: State<'_, AppState>,
    json_content: Option<String>,
) -> Result<ImportBackupResult, String> {
    let now = state.now_iso();
    let today = state.today();

    let content = if let Some(text) = json_content {
        text
    } else {
        // Dialog-only file access: an IPC-supplied path would be an
        // arbitrary-file read (and, via a crafted backup, a data wipe).
        let source_path = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter("JSON Backup", &["json"])
                .blocking_pick_file()
                .and_then(|p| p.as_path().map(PathBuf::from))
        })
        .await
        .map_err(|e| format!("Open dialog failed: {e}"))?;

        match source_path {
            Some(p) => fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read backup file at {p:?}: {e}"))?,
            None => return Err("No backup file selected".to_string()),
        }
    };

    // Read the study sections from the SAME bytes the importer will consume —
    // the core importer replaces the SQLite collections with exactly these.
    let study_import = extract_study_sections(&content);

    let report = state
        .store
        .import_v4_backup(content, now, today)
        .await
        .map_err(|e| format!("Import failed: {e}"))?;

    Ok(ImportBackupResult {
        study_stats: study_import.as_ref().and_then(|s| s.study_stats.clone()),
        study_import,
        report,
    })
}
