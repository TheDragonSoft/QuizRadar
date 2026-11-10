//! Tauri 2 desktop shell — thin glue over `quizradar-core` (`AGENTS.md` §3).
//!
//! Provides the complete IPC command surface, OS keyring credential storage,
//! serverless loopback receiver for OAuth, deep linking, and graceful lifecycle exit.

pub mod auth_loopback;
pub mod commands;
pub mod keyring;
pub mod state;
pub mod tray;

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
        .plugin(tauri_plugin_notification::init())
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

            let keyring = KeyringStore::new();
            let db_key = match keyring.get_or_create_db_key() {
                Ok(hex) => quizradar_core::store::crypto::DbEncryptionKey::from_hex(&hex).ok(),
                Err(err) => {
                    eprintln!("[desktop] warning: could not access OS keyring for DB key ({err}) - proceeding with unkeyed store");
                    None
                }
            };

            let store = tauri::async_runtime::block_on(async {
                Store::open_with_key(db_path, db_key).await
            })
            .map_err(|e| format!("Failed to open SQLite store: {e}"))?;

            let app_state = AppState::new(store, keyring);
            app.manage(app_state);

            // System tray setup & assessment notification loop
            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let open_item = MenuItem::with_id(app, "open", "Open QuizRadar", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;

                let mut builder = TrayIconBuilder::with_id("main_tray")
                    .tooltip("QuizRadar — No upcoming assessments")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "open" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    builder = builder.icon(icon.clone());
                }

                let _tray = builder.build(app)?;

                let app_handle = app.handle().clone();
                let tracker = std::sync::Arc::new(tokio::sync::Mutex::new(crate::tray::NotificationTracker::new()));
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            let now = chrono::Local::now().naive_local();
                            let today = now.date();
                            if let Ok(snapshot) = state.store.load_state(today).await {
                                let next = crate::tray::find_next_assessment(&snapshot.assessments, now);
                                let tooltip = crate::tray::format_tray_tooltip(next.as_ref());
                                if let Some(tray) = app_handle.tray_by_id("main_tray") {
                                    let _ = tray.set_tooltip(Some(tooltip));
                                }
                                if let Some(info) = next {
                                    let mut trk = tracker.lock().await;
                                    if trk.should_notify(&info) {
                                        use tauri_plugin_notification::NotificationExt;
                                        let (title, body) = crate::tray::build_exam_notification_content(&info);
                                        let _ = app_handle.notification()
                                            .builder()
                                            .title(title)
                                            .body(body)
                                            .show();
                                    }
                                }
                            }
                        }
                    }
                });
            }

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
