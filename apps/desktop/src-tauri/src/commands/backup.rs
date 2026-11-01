//! OS backup import and export commands (`01` §4 backup modal, `04` §4.4).
//!
//! Provides local filesystem backup file export and import via native OS file dialogs
//! (`tauri-plugin-dialog`), completely serverless.

use std::fs;
use std::path::PathBuf;

use quizradar_core::store::importer::ImportReport;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBackupResult {
    pub saved: bool,
    pub path: Option<String>,
    pub json: Option<String>,
}

#[tauri::command]
pub async fn export_backup_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExportBackupResult, String> {
    let now = state.now_iso();
    let today = state.today();

    let backup_json = state
        .store
        .export_v4_backup_json(now, today)
        .await
        .map_err(|e| format!("Failed to generate backup JSON: {e}"))?;

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

#[tauri::command]
pub async fn import_backup_file(
    app: AppHandle,
    state: State<'_, AppState>,
    json_content: Option<String>,
) -> Result<ImportReport, String> {
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

    let report = state
        .store
        .import_v4_backup(content, now, today)
        .await
        .map_err(|e| format!("Import failed: {e}"))?;

    Ok(report)
}
