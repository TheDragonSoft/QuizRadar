//! Tauri 2 desktop shell — thin glue over `quizradar-core` (`AGENTS.md` §3).
//!
//! Provides the complete IPC command surface, OS keyring credential storage,
//! serverless loopback receiver for OAuth, deep linking, and graceful lifecycle exit.

pub mod auth_loopback;
pub mod commands;
pub mod keyring;
pub mod state;

use std::path::PathBuf;
use tauri::{Emitter, Manager};

use crate::keyring::KeyringStore;
use crate::state::AppState;
use quizradar_core::store::Store;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Focus on existing window when a second instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Deep-link handling: forward any incoming quizradar:// URL
            for arg in args {
                if arg.starts_with("quizradar://") {
                    let _ = app.emit("deep-link", arg);
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let sandbox_data_dir = std::env::var("QUIZRADAR_DATA_DIR")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .map(PathBuf::from);

            // Register the `quizradar://` scheme with the OS unless running inside an
            // isolated test sandbox (`QUIZRADAR_DATA_DIR`).
            if sandbox_data_dir.is_none() {
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("[deep-link] scheme registration failed: {err}");
                }
            }
            let data_dir = sandbox_data_dir.unwrap_or_else(|| {
                app.path()
                    .app_local_data_dir()
                    .or_else(|_| app.path().app_data_dir())
                    .unwrap_or_else(|_| PathBuf::from("."))
            });

            let _ = std::fs::create_dir_all(&data_dir);
            let db_path = data_dir.join("quizradar.db");

            let store = tauri::async_runtime::block_on(async { Store::open(db_path).await })
                .map_err(|e| format!("Failed to open SQLite store: {e}"))?;

            let keyring = KeyringStore::new();
            let app_state = AppState::new(store, keyring);
            app.manage(app_state);

            // Handle deep link passed on initial process launch
            for arg in std::env::args() {
                if arg.starts_with("quizradar://") {
                    let _ = app.emit("deep-link", arg);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::version,
            commands::get_state,
            commands::save_schedule,
            commands::upsert_course,
            commands::delete_course,
            commands::update_config,
            commands::add_custom_event,
            commands::delete_custom_event,
            commands::toggle_topic,
            commands::save_grade,
            commands::dismiss_conflicts,
            commands::schedule_study_blocks,
            commands::run_sync,
            commands::cancel_sync,
            commands::run_gcal_sync,
            commands::push_cloud_backup,
            commands::pull_cloud_backup,
            commands::google_login_start,
            commands::google_logout,
            commands::microsoft_login_start,
            commands::microsoft_scanning_consent_start,
            commands::microsoft_logout,
            commands::logout,
            commands::extract_schedule,
            commands::optimize_tasks,
            commands::practice_generate,
            commands::validate_gemini_key,
            commands::ai_quota_usage,
            commands::check_update,
            commands::download_and_install_update,
            commands::export_backup_file,
            commands::import_backup_file,
            commands::export_ics,
            commands::upsert_feed,
            commands::delete_feed,
            commands::reset_database,
        ])
        .run(tauri::generate_context!())
}
