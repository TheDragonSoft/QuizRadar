//! IPC command modules for QuizRadar desktop.
//!
//! Exposes typed commands over `quizradar-core` with camelCase serde payloads.

pub mod ai;
pub mod auth;
pub mod backup;
pub mod state;
pub mod study;
pub mod sync;
pub mod updater;

pub use ai::*;
pub use auth::*;
pub use backup::*;
pub use state::*;
pub use study::*;
pub use sync::*;
pub use updater::*;

use quizradar_core::CORE_VERSION;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    /// App version — single truth: `tooling/version.json`, stamped into
    /// `tauri.conf.json` (read back from the baked bundle config).
    pub app: String,
    /// Core crate version (same truth, same pipeline).
    pub core: String,
}

#[tauri::command]
pub fn version(app: AppHandle) -> VersionInfo {
    VersionInfo {
        app: app.package_info().version.to_string(),
        core: CORE_VERSION.to_string(),
    }
}
