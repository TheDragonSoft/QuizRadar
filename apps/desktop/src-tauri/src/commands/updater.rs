//! Updater commands (`02` §5.9, `04` §4.8).
//!
//! Provides update checking via `tauri-plugin-updater`. Until phase 15 establishes
//! signed release artifacts and endpoints, returns honest "release channel not configured".

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub body: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();

    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => Ok(UpdateCheckResult {
                available: true,
                current_version,
                latest_version: Some(update.version),
                body: update.body,
                error: None,
            }),
            Ok(None) => Ok(UpdateCheckResult {
                available: false,
                current_version,
                latest_version: None,
                body: None,
                error: None,
            }),
            Err(e) => Ok(UpdateCheckResult {
                available: false,
                current_version,
                latest_version: None,
                body: None,
                error: Some(format!(
                    "Release channel not configured ({e}) — updater arrives with phase 15."
                )),
            }),
        },
        Err(e) => Ok(UpdateCheckResult {
            available: false,
            current_version,
            latest_version: None,
            body: None,
            error: Some(format!(
                "Release channel not configured ({e}) — updater arrives with phase 15."
            )),
        }),
    }
}
