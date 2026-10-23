//! IPC commands. Phase 01 ships only truthfully-implemented commands (the
//! `version` helper); the full survives-scrutiny command surface is
//! enumerated in `docs/STATUS.md` as a compile-time TODO list for phase 07 —
//! no fake `state() -> NotImplemented` stubs.

use quizradar_core::CORE_VERSION;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    /// App version — single truth: `tooling/version.json`, stamped into
    /// `tauri.conf.json` (read back here from the baked bundle config).
    pub app: String,
    /// Core crate version (same truth, same pipeline).
    pub core: String,
}

#[tauri::command]
pub fn version(app: tauri::AppHandle) -> VersionInfo {
    VersionInfo {
        app: app.package_info().version.to_string(),
        core: CORE_VERSION.to_string(),
    }
}
