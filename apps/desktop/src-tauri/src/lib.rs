//! Tauri 2 desktop shell — thin glue only (`AGENTS.md` §3: ≤ a few hundred
//! LOC of its own logic). All app logic lives in the `quizradar-core` crate:
//! the full IPC command surface (`list_state`, `run_scan`, …) is wired in
//! phase 07 over the core; today only the honest `version` helper exists
//! (no `NotImplemented` stubs are shipped).

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Focus-on-existing-window handoff is wired with the full IPC
            // surface (phase 07). The plugin already guarantees a single
            // running instance today.
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![commands::version,])
        .run(tauri::generate_context!())
}
