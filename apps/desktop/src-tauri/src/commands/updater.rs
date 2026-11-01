//! Updater commands (`02` §5.9, `04` §4.8, `prompts/p15-release-ci.md`).
//!
//! Provides update checking via `tauri-plugin-updater`.
//! Follows the honesty doctrine (anti v4 `03` §D7):
//! - Hits `releases/latest` endpoint configured in `tauri.conf.json`.
//! - When repo is unreachable or returns 404/network error, returns explicit error
//!   "Update check unavailable — github link down".
//! - When unconfigured, returns "Release channel not configured (<reason>)".

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
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

/// Formats raw updater errors honestly according to spec.
pub fn format_updater_error(err_str: &str) -> String {
    let lower = err_str.to_lowercase();
    if lower.contains("network")
        || lower.contains("dns")
        || lower.contains("connect")
        || lower.contains("connection")
        || lower.contains("404")
        || lower.contains("status code")
        || lower.contains("request")
        || lower.contains("timeout")
        || lower.contains("unreachable")
        || lower.contains("hyper")
        || lower.contains("reqwest")
    {
        "Update check unavailable — github link down".to_string()
    } else if lower.contains("pubkey")
        || lower.contains("endpoint")
        || lower.contains("empty")
        || lower.contains("not configured")
    {
        format!("Release channel not configured ({err_str})")
    } else {
        format!("Update check unavailable — {err_str}")
    }
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
                error: Some(format_updater_error(&e.to_string())),
            }),
        },
        Err(e) => Ok(UpdateCheckResult {
            available: false,
            current_version,
            latest_version: None,
            body: None,
            error: Some(format_updater_error(&e.to_string())),
        }),
    }
}

/// Downloads and installs the pending update (`01` §4.8 "download-with-
/// honest-progress → installer handoff → recovery message").
///
/// The progress events carry the bytes received so far and the total when
/// the server announced one; when the total is unknown the UI says so
/// instead of inventing a percentage.
#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format_updater_error(&e.to_string()))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format_updater_error(&e.to_string()))?
        .ok_or_else(|| "No update is available to install.".to_string())?;
    let chunk_app = app.clone();
    let finish_app = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = chunk_app.emit("update-progress", (chunk_length, content_length));
            },
            move || {
                let _ = finish_app.emit("update-downloaded", ());
            },
        )
        .await
        .map_err(|e| format_updater_error(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_updater_error_network() {
        assert_eq!(
            format_updater_error("error sending request for url (https://...): dns error"),
            "Update check unavailable — github link down"
        );
        assert_eq!(
            format_updater_error("HTTP status client error (404 Not Found)"),
            "Update check unavailable — github link down"
        );
        assert_eq!(
            format_updater_error("connection reset by peer"),
            "Update check unavailable — github link down"
        );
    }

    #[test]
    fn test_format_updater_error_unconfigured() {
        assert_eq!(
            format_updater_error("updater endpoint list is empty"),
            "Release channel not configured (updater endpoint list is empty)"
        );
        assert_eq!(
            format_updater_error("pubkey is not configured"),
            "Release channel not configured (pubkey is not configured)"
        );
    }

    #[test]
    fn test_format_updater_error_generic() {
        assert_eq!(
            format_updater_error("unexpected json shape"),
            "Update check unavailable — unexpected json shape"
        );
    }
}
