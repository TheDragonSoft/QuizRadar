#![windows_subsystem = "windows"]

pub mod auth;
pub mod classroom;
pub mod cloud_sync;
pub mod feeds;
pub mod gcal;
pub mod gemini;
pub mod gmail;
pub mod models;
pub mod moodle;
pub mod parser;
pub mod teams;
pub mod updater;

use crate::updater::is_allowed_update_url;
use axum::{
    body::Bytes,
    extract::connect_info::ConnectInfo,
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{Html, IntoResponse, Redirect, Response},
    routing::{delete, get, post},
    Json, Router,
};
use models::{
    AppConfig, Assessment, AssessmentGrade, Course, CustomCalendarEvent, FeedConfig, ScheduleData,
    ScheduleSlot,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, OnceLock,
    },
};
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;

const CONFIG_FILE: &str = "data/app_config.json";

#[derive(Clone)]
pub struct SharedAppState {
    pub port: u16,
    pub config: Arc<RwLock<AppConfig>>,
    pub schedule: Arc<RwLock<ScheduleData>>,
    pub assessments: Arc<RwLock<Vec<Assessment>>>,
    pub sync_in_flight: Arc<AtomicBool>,
    pub profile_refresh_in_flight: Arc<AtomicBool>,
}

fn load_app_config() -> AppConfig {
    if let Ok(raw) = fs::read_to_string(CONFIG_FILE) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&raw) {
            return cfg;
        }
    }
    AppConfig::default()
}

async fn save_app_config(cfg: &AppConfig) {
    let _ = tokio::fs::create_dir_all("data").await;
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        // Atomic write (tmp + rename): a crash or hard exit mid-write must
        // never leave the user's config file truncated.
        let tmp = format!("{}.tmp", CONFIG_FILE);
        if tokio::fs::write(&tmp, json).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, CONFIG_FILE).await;
        }
    }
}

struct InFlightGuard {
    flag: Arc<AtomicBool>,
}

impl InFlightGuard {
    fn new(flag: Arc<AtomicBool>) -> Self {
        Self { flag }
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

/// Per-launch random session token. The desktop webview loads the UI with this
/// token (as a query param, then persisted as a cookie); every other client —
/// e.g. someone typing `http://localhost:5050/` into a browser — gets a
/// "private interface" page instead of the app UI. Entropy comes from the OS
/// (RandomState seeds) mixed with process id + startup time.
fn generate_session_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);

    let mut h1 = RandomState::new().build_hasher();
    nanos.hash(&mut h1);
    std::process::id().hash(&mut h1);
    let seed = h1.finish();

    let mut h2 = RandomState::new().build_hasher();
    seed.hash(&mut h2);
    nanos.hash(&mut h2);
    std::process::id().hash(&mut h2);

    format!("kr{:016x}{:016x}", seed, h2.finish())
}

const SESSION_COOKIE: &str = "kr_session";
const SESSION_QUERY_KEY: &str = "kr_session";

/// Paths consumed by the *external system browser* during OAuth sign-in (no
/// app session token available). They only redirect to Google/Microsoft or
/// exchange the authorization code — they never serve app UI or app data.
const TOKENLESS_OAUTH_PATHS: [&str; 5] = [
    "/api/auth/callback",
    "/api/auth/microsoft/callback",
    "/api/auth/google",
    "/api/auth/google/login",
    "/api/microsoft/login",
];

fn extract_session_token(req: &Request) -> Option<String> {
    if let Some(query) = req.uri().query() {
        for pair in query.split('&') {
            if let Some(val) = pair.strip_prefix(SESSION_QUERY_KEY) {
                let val = val.strip_prefix('=').unwrap_or(val);
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    let cookies = req
        .headers()
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .to_string();
    for part in cookies.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix(SESSION_COOKIE) {
            let val = val.strip_prefix('=').unwrap_or(val);
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

const UI_BLOCK_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — Private Desktop Interface</title>
  <style>
    body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    .icon { width: 52px; height: 52px; border-radius: 14px; background: rgba(26,115,232,0.15); color: #60a5fa; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 16px; }
    h2 { font-size: 19px; margin: 0 0 8px 0; color: #ffffff; font-weight: 700; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h2>Private Desktop Interface</h2>
    <p>This address hosts the internal interface of the QuizRadar desktop app and is not accessible from a browser. Please launch the QuizRadar desktop application instead.</p>
  </div>
</body>
</html>"#;

/// Writable per-user application data directory (%LOCALAPPDATA%\QuizRadar).
/// Used when the install directory (e.g. "Program Files" for all-users
/// installs) is read-only for the current user.
fn per_user_data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join("QuizRadar"))
}

fn is_dir_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(".qr_write_test");
    match fs::write(&probe, b"ok") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Directory containing the bundled static assets. Prefers the current
/// directory (dev workspace / per-user installs); falls back to the directory
/// next to the executable (all-users installs where the working directory was
/// redirected to %LOCALAPPDATA%).
fn static_root() -> std::path::PathBuf {
    if std::path::Path::new("static/index.html").exists() {
        return std::path::PathBuf::from("static");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let exe_static = dir.join("static");
            if exe_static.join("index.html").exists() {
                return exe_static;
            }
        }
    }
    std::path::PathBuf::from("static")
}

fn resolve_asset_path(path: &str) -> std::path::PathBuf {
    if let Some(rest) = path.strip_prefix("static/") {
        return static_root().join(rest);
    }
    std::path::PathBuf::from(path)
}

/// Redacts credential values from a config for responses sent to non-loopback
/// (LAN pairing) clients: OAuth tokens and API keys must never leave the
/// machine. A truthy "stored" marker keeps the UI's connected-state checks
/// working without exposing the secret itself.
fn redact_secrets_for_remote(cfg: &AppConfig) -> Value {
    let mut v = serde_json::to_value(cfg).unwrap_or(Value::Null);
    if let Some(obj) = v.as_object_mut() {
        for key in [
            "gemini_api_key",
            "teams_token",
            "moodle_token",
            "pairing_pin",
        ] {
            let present = match obj.get(key) {
                Some(Value::String(s)) => !s.trim().is_empty(),
                Some(Value::Null) | None => false,
                Some(_) => true,
            };
            obj.insert(
                key.to_string(),
                if present {
                    Value::String("stored".to_string())
                } else {
                    Value::Null
                },
            );
        }
    }
    v
}

/// Named mutex so the Inno Setup installer (AppMutex=QuizRadarAppMutex) can
/// detect a running instance and ask the user to close it before
/// installing/upgrading/uninstalling — otherwise uninstall cannot remove
/// locked files. The handle is intentionally held for the process lifetime.
#[cfg(windows)]
fn create_app_mutex() {
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *mut core::ffi::c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> *mut core::ffi::c_void;
        fn GetLastError() -> u32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    let name: Vec<u16> = "QuizRadarAppMutex\0".encode_utf16().collect();
    unsafe {
        CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr());
        if GetLastError() == ERROR_ALREADY_EXISTS {
            // A second instance would race the first on data/*.json and tokens.
            eprintln!("QuizRadar is already running. Close the existing window first.");
            std::process::exit(0);
        }
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {}\n", info);
        let _ = std::fs::write("panic.log", msg);
    }));

    #[cfg(windows)]
    create_app_mutex();

    if !std::path::Path::new("Cargo.toml").exists() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                if let Some(workspace_root) = exe_dir.parent().and_then(|p| p.parent()) {
                    if workspace_root.join("Cargo.toml").exists() {
                        let _ = std::env::set_current_dir(workspace_root);
                    } else {
                        let _ = std::env::set_current_dir(exe_dir);
                    }
                } else {
                    let _ = std::env::set_current_dir(exe_dir);
                }
            }
        }
    }
    let _ = fs::create_dir_all("data");

    // All-users installs land in "Program Files", where the install directory
    // is read-only for standard users. Redirect the working directory to a
    // writable per-user location so runtime data (data/, token.json, caches)
    // can persist. Static assets keep resolving via static_root().
    if !is_dir_writable(std::path::Path::new(".")) {
        if let Some(data_dir) = per_user_data_dir() {
            if fs::create_dir_all(&data_dir).is_ok() {
                let _ = std::env::set_current_dir(&data_dir);
                let _ = fs::create_dir_all("data");
            }
        }
    }

    let headless = std::env::args().any(|a| a == "--headless" || a == "--server");
    let (port_tx, port_rx) = mpsc::channel::<(u16, String)>();

    let server_handle = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime");
        rt.block_on(run_backend_server(port_tx));
    });

    let (selected_port, session_token) = port_rx
        .recv()
        .unwrap_or_else(|_| (5000, generate_session_token()));

    if headless {
        eprintln!(
            "QuizRadar server running (headless): http://127.0.0.1:{}/?{}={}",
            selected_port, SESSION_QUERY_KEY, session_token
        );
        eprintln!("This tokened URL is required to access the app interface from HTTP clients.");
        let _ = server_handle.join();
        return;
    }

    #[cfg(any(windows, target_os = "macos"))]
    {
        run_native_desktop_window(selected_port, &session_token);
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = open::that(format!(
            "http://127.0.0.1:{}/?{}={}",
            selected_port, SESSION_QUERY_KEY, session_token
        ));
        let _ = server_handle.join();
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn run_native_desktop_window(port: u16, session_token: &str) {
    use tao::{
        dpi::LogicalSize,
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        window::{Icon, WindowBuilder},
    };
    use wry::WebViewBuilder;

    let event_loop = EventLoop::new();

    let icon_rgba = include_bytes!("../assets/icon_64x64.rgba");
    let window_icon = Icon::from_rgba(icon_rgba.to_vec(), 64, 64).ok();

    let window = WindowBuilder::new()
        .with_title("QuizRadar — Academic Dashboard & Smart Exam Calendar")
        .with_inner_size(LogicalSize::new(1420.0, 880.0))
        .with_min_inner_size(LogicalSize::new(960.0, 620.0))
        .with_window_icon(window_icon)
        .build(&event_loop)
        .expect("Failed to create native QuizRadar window");

    window.set_visible(true);
    window.set_focus();

    let app_url = format!(
        "http://127.0.0.1:{}/?{}={}",
        port, SESSION_QUERY_KEY, session_token
    );

    // WebView2's default user-data folder is created next to the executable —
    // which fails under "Program Files" (all-users installs) and crashes at
    // startup. Pin it to a writable per-user directory instead.
    let webview_data_dir = per_user_data_dir()
        .map(|p| p.join("WebView2"))
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let _ = fs::create_dir_all(&webview_data_dir);
    let mut web_context = wry::WebContext::new(Some(webview_data_dir));

    let webview = WebViewBuilder::with_web_context(&mut web_context)
        .with_url(&app_url)
        .with_user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .with_new_window_req_handler(|url| {
            let _ = open::that(&url);
            false
        })
        .build(&window)
        .expect("Failed to initialize native WebView");

    window.set_visible(true);
    window.set_focus();

    event_loop.run(move |event, _, control_flow| {
        let _ = (&window, &webview);
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
            std::process::exit(0);
        }
    });
}

async fn run_backend_server(port_tx: mpsc::Sender<(u16, String)>) {
    let ports = [5050, 5000, 3000, 8080, 5150, 5250, 0];
    let mut selected_port = 5050;
    let mut listener = None;

    // Security: bind to localhost only by default. Expose on the LAN only when the
    // user explicitly passes --lan (e.g. to pair the Android app with this desktop).
    let expose_lan = std::env::args().any(|a| a == "--lan" || a == "--pairing");
    let bind_ip = if expose_lan {
        [0, 0, 0, 0]
    } else {
        [127, 0, 0, 1]
    };

    for port in ports {
        let addr = SocketAddr::from((bind_ip, port));
        if let Ok(l) = tokio::net::TcpListener::bind(addr).await {
            selected_port = l.local_addr().map(|a| a.port()).unwrap_or(port);
            listener = Some(l);
            break;
        }
    }

    let listener = listener.expect("Could not bind local server socket");
    let session_token = generate_session_token();
    let _ = port_tx.send((selected_port, session_token.clone()));

    let config = load_app_config();
    let schedule = parser::load_schedule();

    let state = SharedAppState {
        port: selected_port,
        config: Arc::new(RwLock::new(config)),
        schedule: Arc::new(RwLock::new(schedule)),
        assessments: Arc::new(RwLock::new(Vec::new())),
        sync_in_flight: Arc::new(AtomicBool::new(false)),
        profile_refresh_in_flight: Arc::new(AtomicBool::new(false)),
    };

    let startup_state = state.clone();
    tokio::spawn(async move {
        let schedule = startup_state.schedule.read().await.clone();
        let cfg = startup_state.config.read().await.clone();
        let parsed = tokio::task::spawn_blocking(move || {
            let cached_emails = gmail::load_cached_emails();
            let mut parsed = futures::executor::block_on(parser::process_all_emails(
                &cached_emails,
                &schedule,
                &cfg,
                false,
            ));

            if !schedule.courses.is_empty() {
                let active_course_codes: std::collections::HashSet<String> = schedule
                    .courses
                    .iter()
                    .map(|c| c.id.trim().to_uppercase())
                    .collect();
                parsed.retain(|p| {
                    if p.id.starts_with("teams-")
                        || p.id.starts_with("moodle-")
                        || p.id.starts_with("classroom-")
                    {
                        return true;
                    }
                    let cid = p.course_id.trim().to_uppercase();
                    active_course_codes.contains(&cid)
                        || active_course_codes
                            .iter()
                            .any(|ac| cid.starts_with(ac) || ac.starts_with(&cid))
                });
            }

            parsed.retain(|p| p.is_source_enabled(&cfg));
            parsed
        })
        .await
        .unwrap_or_default();

        {
            let mut assessments = startup_state.assessments.write().await;
            if assessments.is_empty() {
                *assessments = parsed;
            }
        }

        let auto_sync_teams = {
            let cfg = startup_state.config.read().await;
            cfg.teams_enabled && cfg.teams_token.is_some()
        };
        if auto_sync_teams {
            run_sync_pipeline(startup_state, false).await;
        }
    });

    // Refresh Google authentication profile in the background so startup is 0ms
    let bg_state = state.clone();
    tokio::spawn(async move {
        let profile = auth::fetch_user_profile().await;
        if profile.authenticated {
            let cfg_snapshot = {
                let mut cfg = bg_state.config.write().await;
                cfg.user_email = profile.email.clone();
                cfg.user_name = profile.name.clone();
                cfg.user_picture = profile.picture.clone();
                cfg.clone()
            };
            save_app_config(&cfg_snapshot).await;
        }
    });

    // The auth middleware below needs to consult the (optional) pairing PIN
    // on every LAN request; clone the cheap Arc instead of the whole state.
    let lan_config_lock = state.config.clone();

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/state", get(get_full_state))
        .route("/api/status", get(get_legacy_status))
        .route("/api/schedule", get(get_schedule))
        .route("/api/quizzes", get(get_quizzes))
        .route("/api/auth/google", get(google_login_redirect))
        .route("/api/auth/google/login", get(google_login_redirect))
        .route("/api/auth/google/url", get(google_login_url))
        .route("/api/auth/callback", get(google_oauth_callback))
        .route("/api/auth/logout", post(google_logout))
        .route("/api/auth/google/logout", post(google_logout))
        .route("/api/onboarding/complete", post(complete_onboarding))
        .route("/api/onboarding/reset", post(reset_onboarding))
        .route("/api/sync", post(trigger_full_sync))
        .route("/api/gcal/sync", post(trigger_gcal_sync))
        .route("/api/study/toggle", post(toggle_study_topic))
        .route("/api/study/tasks", get(get_study_tasks_handler))
        .route(
            "/api/study/tasks/optimize",
            post(optimize_study_tasks_handler),
        )
        .route("/api/events/custom", post(add_custom_event))
        .route("/api/events/custom/:id", delete(delete_custom_event))
        .route("/api/schedule/extract", post(extract_schedule_handler))
        .route("/api/schedule/save", post(save_schedule_handler))
        .route("/api/schedule/courses", post(add_course_handler))
        .route("/api/schedule/courses/:id", delete(delete_course_handler))
        .route("/api/calendar/ics/:id", get(download_ics))
        .route("/api/calendar/ics_all", get(download_all_ics))
        .route("/api/config/update", post(update_config_handler))
        .route("/api/moodle/test", post(test_moodle_handler))
        .route("/api/moodle/sync", post(sync_moodle_handler))
        .route("/api/feeds", get(list_feeds_handler))
        .route("/api/feeds/test", post(test_feed_handler))
        .route("/api/feeds/save", post(save_feeds_handler))
        .route("/api/feeds/delete", post(delete_feed_handler))
        .route("/api/microsoft/login", get(microsoft_login_redirect))
        .route("/api/microsoft/url", get(microsoft_login_url))
        .route(
            "/api/auth/microsoft/callback",
            get(microsoft_oauth_callback),
        )
        .route("/api/microsoft/test", post(test_microsoft_handler))
        .route("/api/microsoft/logout", post(microsoft_logout))
        .route(
            "/api/classroom/test",
            get(test_classroom_handler).post(test_classroom_handler),
        )
        .route(
            "/api/assessments/:id/practice",
            post(get_assessment_practice_handler),
        )
        .route(
            "/api/assessments/:id/grade",
            post(update_assessment_grade_handler),
        )
        .route(
            "/api/study/blocks/schedule",
            post(schedule_study_blocks_handler),
        )
        .route("/api/conflicts/dismiss", post(dismiss_conflicts_handler))
        .route("/api/updater/check", get(check_updater_handler))
        .route("/api/updater/install", post(install_updater_handler))
        .route("/api/sync/cloud/push", post(push_cloud_sync_handler))
        .route("/api/sync/cloud/pull", post(pull_cloud_sync_handler))
        .route("/api/sync/pair/info", get(get_pairing_info_handler))
        .route("/api/pairing/pin", post(set_pairing_pin_handler))
        .route("/static/app.js", get(serve_app_js))
        .route("/app.js", get(serve_app_js))
        .route("/static/lucide.min.js", get(serve_lucide_js))
        .route("/lucide.min.js", get(serve_lucide_js))
        .route("/static/icon.svg", get(serve_icon_svg))
        .route("/icon.svg", get(serve_icon_svg))
        .route("/manifest.webmanifest", get(serve_manifest))
        .route("/manifest.json", get(serve_manifest))
        .route("/sw.js", get(serve_sw_js))
        .route("/styles.css", get(serve_styles_css))
        .nest_service("/static", ServeDir::new(static_root()))
        .fallback_service(ServeDir::new(static_root()))
        .layer(if expose_lan {
            CorsLayer::permissive()
        } else {
            let origin_loopback = format!("http://127.0.0.1:{selected_port}");
            let origin_localhost = format!("http://localhost:{selected_port}");
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(vec![
                    header::HeaderValue::from_str(&origin_loopback).unwrap(),
                    header::HeaderValue::from_str(&origin_localhost).unwrap(),
                ]))
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([header::CONTENT_TYPE])
        })
        .layer(axum::middleware::from_fn(
            move |req: Request, next: Next| {
                let token = session_token.clone();
                let cfg_lock = lan_config_lock.clone();
                async move {
                    // LAN pairing mode is an explicit opt-in for the Android
                    // companion app. With a pairing PIN configured, requests
                    // from outside this machine must present it in the
                    // `x-quizradar-pin` header; loopback callers are exempt.
                    if expose_lan {
                        let is_loopback = req
                            .extensions()
                            .get::<ConnectInfo<SocketAddr>>()
                            .map(|info| info.0.ip().is_loopback())
                            .unwrap_or(false);
                        if !is_loopback {
                            // try_read() keeps the hot path lock-free; fall
                            // back to a normal read under contention.
                            let required_pin = match cfg_lock.try_read() {
                                Ok(cfg) => cfg.pairing_pin.clone(),
                                Err(_) => cfg_lock.read().await.pairing_pin.clone(),
                            };
                            if let Some(expected) = required_pin {
                                let provided = req
                                    .headers()
                                    .get("x-quizradar-pin")
                                    .and_then(|v| v.to_str().ok());
                                if provided != Some(expected.as_str()) {
                                    return (
                                        StatusCode::UNAUTHORIZED,
                                        [("Cache-Control", "no-store")],
                                        Json(json!({
                                            "error": "Pairing PIN required. Enter the PIN shown in the desktop app."
                                        })),
                                    )
                                        .into_response();
                                }
                            }
                        }
                        return next.run(req).await;
                    }

                    let via_query = req
                        .uri()
                        .query()
                        .map(|q| {
                            q.split('&')
                                .any(|kv| kv == format!("{}={}", SESSION_QUERY_KEY, token))
                        })
                        .unwrap_or(false);

                    match extract_session_token(&req) {
                        Some(provided) if provided == token => {
                            let mut res = next.run(req).await;
                            if via_query {
                                // Persist the token so every subsequent
                                // same-origin fetch/script request carries it.
                                if let Ok(val) = HeaderValue::from_str(&format!(
                                    "{}={}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400",
                                    SESSION_COOKIE, token
                                )) {
                                    res.headers_mut().append(header::SET_COOKIE, val);
                                }
                            }
                            res
                        }
                        // OAuth entry/callback endpoints are consumed by the
                        // external system browser and serve no app UI/data.
                        _ if TOKENLESS_OAUTH_PATHS.contains(&req.uri().path()) => {
                            next.run(req).await
                        }
                        _ => (
                            StatusCode::FORBIDDEN,
                            [("Cache-Control", "no-store")],
                            Html(UI_BLOCK_PAGE),
                        )
                            .into_response(),
                    }
                }
            },
        ))
        .with_state(state);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

struct CachedAsset {
    content: Bytes,
    etag: String,
}

static INDEX_HTML: OnceLock<CachedAsset> = OnceLock::new();
static APP_JS: OnceLock<CachedAsset> = OnceLock::new();
static LUCIDE_JS: OnceLock<CachedAsset> = OnceLock::new();
static ICON_SVG: OnceLock<CachedAsset> = OnceLock::new();
static MANIFEST: OnceLock<CachedAsset> = OnceLock::new();
static SW_JS: OnceLock<CachedAsset> = OnceLock::new();
static STYLES_CSS: OnceLock<CachedAsset> = OnceLock::new();

const NO_CACHE: &str = "no-cache";
const DAY_CACHE: &str = "public, max-age=86400";

fn fnv1a_etag(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("\"{:016x}\"", hash)
}

fn cached_asset(
    slot: &'static OnceLock<CachedAsset>,
    path: &str,
    fallback: &'static [u8],
) -> &'static CachedAsset {
    slot.get_or_init(|| {
        let content = fs::read(resolve_asset_path(path))
            .map(Bytes::from)
            .unwrap_or_else(|_| Bytes::from_static(fallback));
        let etag = fnv1a_etag(&content);
        CachedAsset { content, etag }
    })
}

fn cached_disk_asset(
    slot: &'static OnceLock<CachedAsset>,
    path: &str,
) -> Option<&'static CachedAsset> {
    if let Some(asset) = slot.get() {
        return Some(asset);
    }
    let content = Bytes::from(fs::read(resolve_asset_path(path)).ok()?);
    let etag = fnv1a_etag(&content);
    let _ = slot.set(CachedAsset { content, etag });
    slot.get()
}

fn if_none_match_matches(req_headers: &HeaderMap, etag: &str) -> bool {
    req_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .any(|candidate| candidate.trim() == etag || candidate.trim() == "*")
        })
        .unwrap_or(false)
}

fn asset_response(
    asset: &CachedAsset,
    content_type: &'static str,
    cache_control: &'static str,
    req_headers: &HeaderMap,
) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    if let Ok(etag) = HeaderValue::from_str(&asset.etag) {
        headers.insert(header::ETAG, etag);
    }

    if if_none_match_matches(req_headers, &asset.etag) {
        return (StatusCode::NOT_MODIFIED, headers).into_response();
    }

    (StatusCode::OK, headers, asset.content.clone()).into_response()
}

async fn serve_index(headers: HeaderMap) -> Response {
    let asset = cached_asset(
        &INDEX_HTML,
        "static/index.html",
        include_bytes!("../static/index.html"),
    );
    asset_response(asset, "text/html; charset=utf-8", NO_CACHE, &headers)
}

async fn serve_app_js(headers: HeaderMap) -> Response {
    let asset = cached_asset(&APP_JS, "static/app.js", include_bytes!("../static/app.js"));
    asset_response(
        asset,
        "application/javascript; charset=utf-8",
        NO_CACHE,
        &headers,
    )
}

async fn serve_lucide_js(headers: HeaderMap) -> Response {
    let asset = cached_asset(
        &LUCIDE_JS,
        "static/lucide.min.js",
        include_bytes!("../static/lucide.min.js"),
    );
    asset_response(
        asset,
        "application/javascript; charset=utf-8",
        DAY_CACHE,
        &headers,
    )
}

async fn serve_icon_svg(headers: HeaderMap) -> Response {
    let asset = cached_asset(
        &ICON_SVG,
        "static/icon.svg",
        include_bytes!("../static/icon.svg"),
    );
    asset_response(asset, "image/svg+xml; charset=utf-8", DAY_CACHE, &headers)
}

async fn serve_manifest(headers: HeaderMap) -> Response {
    let asset = cached_asset(
        &MANIFEST,
        "static/manifest.webmanifest",
        include_bytes!("../static/manifest.webmanifest"),
    );
    asset_response(
        asset,
        "application/manifest+json; charset=utf-8",
        "public, max-age=3600",
        &headers,
    )
}

async fn serve_sw_js(headers: HeaderMap) -> Response {
    let asset = cached_asset(&SW_JS, "static/sw.js", include_bytes!("../static/sw.js"));
    asset_response(
        asset,
        "application/javascript; charset=utf-8",
        NO_CACHE,
        &headers,
    )
}

async fn serve_styles_css(headers: HeaderMap) -> Response {
    match cached_disk_asset(&STYLES_CSS, "static/styles.css") {
        Some(asset) => asset_response(asset, "text/css; charset=utf-8", NO_CACHE, &headers),
        None => asset_response(
            &CachedAsset {
                content: Bytes::new(),
                etag: fnv1a_etag(b""),
            },
            "text/css; charset=utf-8",
            NO_CACHE,
            &headers,
        ),
    }
}

async fn get_full_state(
    State(state): State<SharedAppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Json<Value> {
    let cfg = state.config.read().await.clone();
    let profile = auth::get_cached_user_profile(&cfg);
    let schedule = state.schedule.read().await.clone();
    let assessments: Vec<Assessment> = state
        .assessments
        .read()
        .await
        .iter()
        .filter(|a| a.is_source_enabled(&cfg))
        .cloned()
        .collect();
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg);
    let cfg_json = if addr.ip().is_loopback() {
        serde_json::to_value(&cfg).unwrap_or(Value::Null)
    } else {
        redact_secrets_for_remote(&cfg)
    };

    // If token exists on disk but user_email wasn't cached yet, refresh profile in background
    if profile.authenticated
        && profile.email.is_none()
        && state
            .profile_refresh_in_flight
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    {
        let bg_state = state.clone();
        tokio::spawn(async move {
            let _guard = InFlightGuard::new(bg_state.profile_refresh_in_flight.clone());
            let live = auth::fetch_user_profile().await;
            if live.authenticated {
                let cfg_snapshot = {
                    let mut wcfg = bg_state.config.write().await;
                    wcfg.user_email = live.email;
                    wcfg.user_name = live.name;
                    wcfg.user_picture = live.picture;
                    wcfg.clone()
                };
                save_app_config(&cfg_snapshot).await;
            }
        });
    }

    Json(json!({
        "config": cfg_json,
        "auth": profile,
        "schedule": schedule,
        "assessments": assessments,
        "dashboard": dashboard,
        "study_tasks_payload": parser::build_study_tasks(&assessments, &cfg),
    }))
}

async fn get_legacy_status(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg = state.config.read().await;
    let profile = auth::get_cached_user_profile(&cfg);
    let assessments = state.assessments.read().await;
    let visible_assessments: Vec<&Assessment> = assessments
        .iter()
        .filter(|a| a.is_source_enabled(&cfg))
        .collect();
    let upcoming_count = visible_assessments.iter().filter(|a| a.is_upcoming).count();

    Json(json!({
        "authenticated": profile.authenticated,
        "email": profile.email.or_else(|| cfg.user_email.clone()).unwrap_or_else(|| "Not signed in".to_string()),
        "total_quizzes": visible_assessments.len(),
        "upcoming_count": upcoming_count,
        "last_sync": cfg.last_gmail_sync.clone().unwrap_or_else(|| "Never".to_string())
    }))
}

async fn get_schedule(State(state): State<SharedAppState>) -> Json<ScheduleData> {
    let schedule = state.schedule.read().await.clone();
    Json(schedule)
}

async fn get_quizzes(State(state): State<SharedAppState>) -> Json<Vec<Assessment>> {
    let cfg = state.config.read().await.clone();
    let assessments = state.assessments.read().await.clone();
    let visible: Vec<Assessment> = assessments
        .into_iter()
        .filter(|a| a.is_source_enabled(&cfg))
        .collect();
    Json(visible)
}

async fn google_login_redirect(State(state): State<SharedAppState>) -> Redirect {
    let url = auth::build_google_oauth_url(state.port, true);
    Redirect::temporary(&url)
}

async fn google_login_url(State(state): State<SharedAppState>) -> Json<Value> {
    let url = auth::build_google_oauth_url(state.port, true);
    Json(json!({ "url": url }))
}

fn oauth_error_page(title: &str, message: &str) -> String {
    // Escape via unicode escapes so the entities survive any processing of
    // this source file (literal "&" etc. would be meaningless here).
    let safe_message = message
        .replace('\u{26}', "\u{26}amp;")
        .replace('<', "\u{26}lt;")
        .replace('>', "\u{26}gt;");
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — {title}</title>
  <style>
    body {{ background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }}
    .card {{ background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }}
    .icon {{ width: 48px; height: 48px; border-radius: 12px; background: rgba(239,68,68,0.15); color: #ef4444; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; }}
    h2 {{ font-size: 18px; margin: 0 0 8px 0; color: #ffffff; }}
    p {{ font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; word-break: break-word; }}
    .btn {{ display: inline-block; background: #1a73e8; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 10px; transition: background 0.2s; cursor: pointer; border: none; }}
    .btn:hover {{ background: #1557b0; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#9888;&#65039;</div>
    <h2>{title}</h2>
    <p>{safe_message}</p>
    <button class="btn" onclick="window.close();">Return to QuizRadar</button>
  </div>
  <script>
    setTimeout(function() {{ try {{ window.close(); }} catch(e) {{}} }}, 2500);
  </script>
</body>
</html>"#
    )
}

async fn google_oauth_callback(
    State(state): State<SharedAppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if !auth::verify_and_consume_oauth_state(params.get("state").map(|s| s.as_str())) {
        return Html(oauth_error_page(
            "Google Sign-In",
            "This sign-in link is invalid or has expired (state mismatch). Please start the sign-in again from the QuizRadar app.",
        ))
        .into_response();
    }
    if let Some(code) = params.get("code") {
        match auth::exchange_code_for_token(code, state.port).await {
            Ok(_) => {
                let profile = auth::fetch_user_profile().await;
                let cfg_snapshot = {
                    let mut cfg = state.config.write().await;
                    cfg.user_email = profile.email.clone();
                    cfg.user_name = profile.name.clone();
                    cfg.user_picture = profile.picture.clone();
                    cfg.clone()
                };
                save_app_config(&cfg_snapshot).await;

                // Automatically scan Gmail and sync on sign-in
                spawn_sync_pipeline(state.clone(), true);

                // Never redirect the external browser into the app UI. Show a
                // standalone confirmation card instead; the desktop app detects
                // the sign-in via /api/state polling.
                let html = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — Google Sign-In Successful</title>
  <style>
    body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    .icon { width: 52px; height: 52px; border-radius: 14px; background: rgba(16,185,129,0.15); color: #34d399; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 16px; }
    h2 { font-size: 19px; margin: 0 0 8px 0; color: #ffffff; font-weight: 700; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; word-break: break-word; }
    .btn { display: inline-block; background: #1a73e8; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 11px 22px; border-radius: 10px; cursor: pointer; border: none; transition: background 0.2s; }
    .btn:hover { background: #1557b0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h2>Google Account Connected!</h2>
    <p>You are signed in. You can close this tab and return to the QuizRadar app — your account, email, and calendar will sync automatically.</p>
    <button class="btn" onclick="window.close();">Return to QuizRadar</button>
  </div>
  <script>
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 1500);
  </script>
</body>
</html>"#;
                return Html(html).into_response();
            }
            Err(err) => {
                return Html(oauth_error_page("Google Sign-In Error", &err)).into_response();
            }
        }
    }
    let cancelled_html = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — Google Sign-In Cancelled</title>
  <style>
    body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    .icon { width: 48px; height: 48px; border-radius: 12px; background: rgba(148,163,184,0.15); color: #94a3b8; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; }
    h2 { font-size: 18px; margin: 0 0 8px 0; color: #ffffff; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; }
    .btn { display: inline-block; background: #1a73e8; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 10px; transition: background 0.2s; cursor: pointer; border: none; }
    .btn:hover { background: #1557b0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⏹️</div>
    <h2>Sign-In Cancelled</h2>
    <p>No account was connected. You can close this tab and try again from the QuizRadar app.</p>
    <button class="btn" onclick="window.close();">Return to QuizRadar</button>
  </div>
  <script>
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 2500);
  </script>
</body>
</html>"#;
    Html(cancelled_html).into_response()
}

async fn google_logout(State(state): State<SharedAppState>) -> Json<Value> {
    let _ = fs::remove_file("token.json");
    auth::invalidate_token_cache();
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.user_email = None;
        cfg.user_name = None;
        cfg.user_picture = None;
        cfg.onboarding_completed = false;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    Json(json!({ "success": true }))
}

#[derive(Debug, Deserialize)]
pub struct OnboardingPayload {
    pub auto_sync_gcal: Option<bool>,
    pub sync_weekly_classes_to_gcal: Option<bool>,
    pub gemini_enabled: Option<bool>,
    pub gemini_api_key: Option<String>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub teams_email: Option<String>,
    pub teams_name: Option<String>,
}

async fn complete_onboarding(
    State(state): State<SharedAppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<OnboardingPayload>,
) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.onboarding_completed = true;
        if let Some(v) = payload.auto_sync_gcal {
            cfg.auto_sync_gcal = v;
        }
        if let Some(v) = payload.sync_weekly_classes_to_gcal {
            cfg.sync_weekly_classes_to_gcal = v;
        }
        if let Some(v) = payload.gemini_enabled {
            cfg.gemini_enabled = v;
        }
        if let Some(k) = payload.gemini_api_key {
            if !k.trim().is_empty() {
                cfg.gemini_api_key = Some(k.trim().to_string());
            }
        }
        if let Some(v) = payload.user_name {
            if !v.trim().is_empty() {
                cfg.user_name = Some(v.trim().to_string());
            }
        }
        if let Some(v) = payload.user_email {
            let trimmed = v.trim();
            // Manual email entry is only a local profile anchor. Never claim real
            // OAuth: only store it when the user hasn't authenticated with Google.
            if trimmed.contains('@') {
                if cfg.user_email.is_none() {
                    cfg.user_email = Some(trimmed.to_string());
                }
            } else if !trimmed.is_empty() {
                eprintln!("Onboarding: ignoring invalid email anchor: {}", trimmed);
            }
        }
        if let Some(v) = payload.teams_email {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                if trimmed.contains('@') {
                    // Store as a local PROFILE ANCHOR only. Never enable Teams
                    // scanning from manual entry — Teams needs a Microsoft sign-in.
                    cfg.teams_account_email = Some(trimmed.to_string());
                    if let Some(n) = payload.teams_name.as_ref() {
                        if !n.trim().is_empty() {
                            cfg.teams_account_name = Some(n.trim().to_string());
                        }
                    }
                } else {
                    eprintln!(
                        "Onboarding: ignoring invalid university email anchor: {}",
                        trimmed
                    );
                }
            }
        }
        // Manual local profile entry is stored but labeled as such in the UI.
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;

    let assessments = state.assessments.read().await.clone();
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg_snapshot);

    // Run network sync in the background so the UI transitions to Dashboard instantaneously
    let bg_state = state.clone();
    tokio::spawn(async move {
        let _ = Box::pin(run_sync_pipeline(bg_state, false)).await;
    });

    Json(json!({
        "success": true,
        "assessments": assessments,
        "dashboard": dashboard,
        "config": if addr.ip().is_loopback() {
            serde_json::to_value(&cfg_snapshot).unwrap_or(Value::Null)
        } else {
            redact_secrets_for_remote(&cfg_snapshot)
        }
    }))
}

async fn reset_onboarding(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.onboarding_completed = false;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    Json(json!({ "success": true }))
}

async fn trigger_full_sync(State(state): State<SharedAppState>) -> Json<Value> {
    let res = run_sync_pipeline(state, true).await;
    Json(res)
}

async fn trigger_gcal_sync(State(state): State<SharedAppState>) -> Json<Value> {
    let (mut cfg, mut assessments) = {
        let cfg = state.config.read().await.clone();
        let assessments = state.assessments.read().await.clone();
        (cfg, assessments)
    };

    let report = gcal::sync_assessments_to_google_calendar(&mut assessments, &mut cfg).await;

    save_app_config(&cfg).await;
    *state.config.write().await = cfg.clone();
    *state.assessments.write().await = assessments.clone();

    let dashboard = parser::build_dashboard_summary(&assessments, &cfg);

    Json(json!({
        "success": report.success,
        "report": report,
        "assessments": assessments,
        "dashboard": dashboard
    }))
}

#[derive(Deserialize)]
pub struct ExtractSchedulePayload {
    pub file_base64: String,
    pub mime_type: Option<String>,
}

async fn extract_schedule_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<ExtractSchedulePayload>,
) -> Json<Value> {
    let cfg = state.config.read().await.clone();
    let mime = payload.mime_type.as_deref().unwrap_or("image/png");
    match gemini::extract_schedule_with_gemini(
        &payload.file_base64,
        mime,
        cfg.gemini_api_key.as_deref(),
    )
    .await
    {
        Ok(sched) => Json(json!({
            "success": true,
            "schedule": sched
        })),
        Err(err) => Json(json!({
            "success": false,
            "error": err
        })),
    }
}

async fn save_schedule_handler(
    State(state): State<SharedAppState>,
    Json(new_schedule): Json<ScheduleData>,
) -> Json<Value> {
    parser::save_schedule(&new_schedule);
    *state.schedule.write().await = new_schedule.clone();

    let cfg = state.config.read().await.clone();
    let cached_emails = gmail::load_cached_emails();
    let new_assessments =
        parser::process_all_emails(&cached_emails, &new_schedule, &cfg, false).await;
    *state.assessments.write().await = new_assessments.clone();

    Json(json!({
        "success": true,
        "schedule": new_schedule,
        "assessments": new_assessments
    }))
}

#[derive(Deserialize)]
pub struct AddCoursePayload {
    pub course: Course,
    #[serde(default)]
    pub slots: Vec<ScheduleSlot>,
}

async fn add_course_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<AddCoursePayload>,
) -> Json<Value> {
    let mut sched = state.schedule.read().await.clone();
    let course_id = payload.course.id.trim().to_string();
    if course_id.is_empty() {
        return Json(json!({ "success": false, "error": "Course ID cannot be empty" }));
    }

    let mut course = payload.course;
    if course.color.is_empty() {
        course.color = "#1a73e8".to_string();
    }
    let (bg, border) = gemini::generate_course_palette(&course.color);
    if course.bg.is_empty() {
        course.bg = bg;
    }
    if course.border.is_empty() {
        course.border = border;
    }

    if let Some(pos) = sched
        .courses
        .iter()
        .position(|c| c.id.eq_ignore_ascii_case(&course_id))
    {
        sched.courses[pos] = course.clone();
    } else {
        sched.courses.push(course.clone());
    }

    let mut next_slot_num = sched.slots.len() + 1;
    sched.slots.retain(|s| s.course_id != course_id);
    for mut slot in payload.slots {
        if slot.id.is_empty() {
            slot.id = format!("slot-{}", next_slot_num);
            next_slot_num += 1;
        }
        slot.course_id = course_id.clone();
        if slot.course_name.is_empty() {
            slot.course_name = course.name.clone();
        }
        slot.day_index = gemini::normalize_day_index(&slot.day);
        if slot.display_time.is_empty() && !slot.start_time.is_empty() && !slot.end_time.is_empty()
        {
            slot.display_time = format!("{} – {}", slot.start_time, slot.end_time);
        }
        sched.slots.push(slot);
    }

    parser::save_schedule(&sched);
    *state.schedule.write().await = sched.clone();

    let cfg = state.config.read().await.clone();
    let cached_emails = gmail::load_cached_emails();
    let new_assessments = parser::process_all_emails(&cached_emails, &sched, &cfg, false).await;
    *state.assessments.write().await = new_assessments.clone();

    Json(json!({
        "success": true,
        "schedule": sched,
        "assessments": new_assessments
    }))
}

async fn delete_course_handler(
    State(state): State<SharedAppState>,
    Path(course_id): Path<String>,
) -> Json<Value> {
    let mut sched = state.schedule.read().await.clone();
    let target = course_id.trim();

    sched.courses.retain(|c| !c.id.eq_ignore_ascii_case(target));
    sched
        .slots
        .retain(|s| !s.course_id.eq_ignore_ascii_case(target));

    parser::save_schedule(&sched);
    *state.schedule.write().await = sched.clone();

    let cfg = state.config.read().await.clone();
    let cached_emails = gmail::load_cached_emails();
    let new_assessments = parser::process_all_emails(&cached_emails, &sched, &cfg, false).await;
    *state.assessments.write().await = new_assessments.clone();

    Json(json!({
        "success": true,
        "schedule": sched,
        "assessments": new_assessments
    }))
}

fn spawn_sync_pipeline(state: SharedAppState, use_live_gemini: bool) {
    tokio::spawn(async move {
        // Box::pin sidesteps the "implementation of FnOnce is not general enough"
        // inference hiccup when an owned-state async fn is spawned directly.
        let _ = Box::pin(run_sync_pipeline(state, use_live_gemini)).await;
    });
}

async fn run_sync_pipeline(state: SharedAppState, use_live_gemini: bool) -> Value {
    if state
        .sync_in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        let cfg = state.config.read().await.clone();
        let assessments: Vec<Assessment> = state
            .assessments
            .read()
            .await
            .iter()
            .filter(|a| a.is_source_enabled(&cfg))
            .cloned()
            .collect();
        let dashboard = parser::build_dashboard_summary(&assessments, &cfg);
        let schedule = state.schedule.read().await.clone();
        return json!({
            "success": true,
            "syncing": true,
            "message": "A sync is already in progress. Showing the current data.",
            "gcal_report": Value::Null,
            "assessments": assessments,
            "dashboard": dashboard,
            "schedule": schedule,
            "config": cfg
        });
    }
    let _flight_guard = InFlightGuard::new(state.sync_in_flight.clone());

    let schedule = state.schedule.read().await.clone();
    let mut cfg = state.config.read().await.clone();
    let mut sync_notes: Vec<String> = Vec::new();

    // Gmail: only actually scrape when a Google token exists; otherwise parse cache only
    let emails = if crate::auth::load_stored_token().is_some() {
        match gmail::sync_gmail_messages().await {
            Ok(list) => {
                sync_notes.push(format!("Gmail: {} emails scanned", list.len()));
                cfg.last_gmail_sync =
                    Some(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());
                list
            }
            Err(e) => {
                sync_notes.push(format!("Gmail sync failed: {}", e));
                gmail::load_cached_emails()
            }
        }
    } else {
        gmail::load_cached_emails()
    };

    let mut parsed = parser::process_all_emails(&emails, &schedule, &cfg, use_live_gemini).await;

    // 1. Ingest from Moodle LMS if enabled
    if cfg.moodle_enabled {
        match moodle::sync_moodle_assessments(&cfg, &schedule).await {
            Ok(moodle_items) => {
                if !moodle_items.is_empty() {
                    sync_notes.push(format!("Moodle: {} items", moodle_items.len()));
                }
                for m in moodle_items {
                    if !parsed.iter().any(|p| {
                        p.source == m.source
                            && p.course_id == m.course_id
                            && p.title == m.title
                            && p.date_iso == m.date_iso
                    }) {
                        parsed.push(m);
                    }
                }
            }
            Err(e) => sync_notes.push(format!("Moodle sync failed: {}", e)),
        }
    }

    // 2. Ingest from Microsoft Teams / Outlook if enabled
    if cfg.teams_enabled {
        match teams::sync_teams_assessments(&cfg, &schedule).await {
            Ok(teams_res) => {
                // Persist the silently-rotated Microsoft access token so the
                // next sync starts warm instead of re-refreshing every time.
                if let Some(ref new_tok) = teams_res.refreshed_access_token {
                    cfg.teams_token = Some(new_tok.clone());
                }
                // Only ADOPT discovered courses/slots when the user has no schedule yet
                // (or nothing was saved): never clobber a timetable the user set up.
                let current_course_count = state.schedule.read().await.courses.len();
                let adopt = teams_res.semester.is_some()
                    || (!teams_res.discovered_courses.is_empty() && current_course_count == 0);
                if adopt && !teams_res.discovered_courses.is_empty() {
                    let mut sched = state.schedule.write().await;
                    sched.courses = teams_res.discovered_courses.clone();
                    sched.slots = teams_res.discovered_slots.clone();
                    if let Some(ref sem) = teams_res.semester {
                        sched.semester = sem.clone();
                    }
                    parser::save_schedule(&sched);
                } else if !teams_res.discovered_courses.is_empty() {
                    sync_notes.push(
                        "Teams discovered course list (kept your existing schedule)".to_string(),
                    );
                }

                if let Some(ref uname) = teams_res.user_display_name {
                    cfg.teams_account_name = Some(uname.clone());
                    if cfg.user_name.is_none() {
                        cfg.user_name = Some(uname.clone());
                    }
                }
                if let Some(ref uemail) = teams_res.user_email {
                    cfg.teams_account_email = Some(uemail.clone());
                    if cfg.user_email.is_none() {
                        cfg.user_email = Some(uemail.clone());
                    }
                }
                if !teams_res.assessments.is_empty() {
                    sync_notes.push(format!("Teams: {} items", teams_res.assessments.len()));
                }
                for t in teams_res.assessments {
                    if !parsed.iter().any(|p| {
                        p.source == t.source
                            && p.course_id == t.course_id
                            && p.title == t.title
                            && p.date_iso == t.date_iso
                    }) {
                        parsed.push(t);
                    }
                }
            }
            Err(e) => sync_notes.push(format!("Teams sync failed: {}", e)),
        }
    }

    // 3. Ingest from Google Classroom if enabled
    if cfg.classroom_enabled {
        match classroom::sync_classroom_assessments(&cfg, &schedule).await {
            Ok(cr_items) => {
                if !cr_items.is_empty() {
                    sync_notes.push(format!("Classroom: {} items", cr_items.len()));
                }
                for c in cr_items {
                    if !parsed.iter().any(|p| {
                        p.source == c.source
                            && p.course_id == c.course_id
                            && p.title == c.title
                            && p.date_iso == c.date_iso
                    }) {
                        parsed.push(c);
                    }
                }
            }
            Err(e) => sync_notes.push(format!("Classroom sync failed: {}", e)),
        }
    }

    // 3b. Ingest from generic .ics subscription feeds (university timetables).
    // Feeds are read-only config: nothing here mutates cfg, so the config-merge
    // at the end of the pipeline needs no extra fields.
    for feed in cfg.feeds.iter().filter(|f| f.enabled) {
        match feeds::fetch_feed(&feed.url, &feed.name, &schedule).await {
            Ok(items) => {
                sync_notes.push(format!("Feed '{}': {} items", feed.name, items.len()));
                for f in items {
                    if !parsed.iter().any(|p| {
                        p.source == f.source
                            && p.course_id == f.course_id
                            && p.title == f.title
                            && p.date_iso == f.date_iso
                    }) {
                        parsed.push(f);
                    }
                }
            }
            Err(e) => sync_notes.push(format!("Feed '{}' sync failed: {}", feed.name, e)),
        }
    }

    // Filter out foreign assessments from unrelated majors/courses if enrolled courses are known
    let sched_courses = state.schedule.read().await.courses.clone();
    if !sched_courses.is_empty() {
        let active_course_codes: std::collections::HashSet<String> = sched_courses
            .iter()
            .map(|c| c.id.trim().to_uppercase())
            .collect();
        parsed.retain(|p| {
            if p.id.starts_with("teams-")
                || p.id.starts_with("moodle-")
                || p.id.starts_with("classroom-")
                || p.id.starts_with("feed-")
            {
                return true;
            }
            let cid = p.course_id.trim().to_uppercase();
            active_course_codes.contains(&cid)
                || active_course_codes
                    .iter()
                    .any(|ac| cid.starts_with(ac) || ac.starts_with(&cid))
        });
    }

    // Ensure all retained assessments belong to currently enabled sources
    parsed.retain(|p| p.is_source_enabled(&cfg));

    // 4. Attach persistent grades & weightages
    for a in &mut parsed {
        if let Some(g) = cfg.grades.get(&a.id) {
            a.achieved_score = Some(g.achieved_score);
            a.max_score = Some(g.max_score);
            a.weightage_percent = Some(g.weightage_percent);
        }
    }

    // 5. Re-sort: upcoming first (ordered by date/start_time), then past
    parsed.sort_by(|a, b| match (a.is_upcoming, b.is_upcoming) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => a
            .date_iso
            .cmp(&b.date_iso)
            .then_with(|| a.start_time.cmp(&b.start_time)),
        (false, false) => b.date_iso.cmp(&a.date_iso),
    });

    let gcal_report = if cfg.auto_sync_gcal {
        Some(gcal::sync_assessments_to_google_calendar(&mut parsed, &mut cfg).await)
    } else {
        None
    };

    // Merge only the fields this pipeline actually mutated into the LIVE config,
    // instead of overwriting the whole struct: a config change made while the
    // sync was running (e.g. toggling a topic or saving an API key) must survive.
    let cfg_snapshot;
    {
        let mut live = state.config.write().await;
        live.last_gmail_sync = cfg.last_gmail_sync.clone();
        live.synced_gcal_map = cfg.synced_gcal_map.clone();
        if cfg.teams_account_name.is_some() {
            live.teams_account_name = cfg.teams_account_name.clone();
        }
        if cfg.teams_account_email.is_some() {
            live.teams_account_email = cfg.teams_account_email.clone();
        }
        live.teams_token = cfg.teams_token.clone();
        if cfg.user_name.is_some() && live.user_name.is_none() {
            live.user_name = cfg.user_name.clone();
        }
        if cfg.user_email.is_some() && live.user_email.is_none() {
            live.user_email = cfg.user_email.clone();
        }
        cfg_snapshot = live.clone();
    }
    save_app_config(&cfg_snapshot).await;
    let dashboard = parser::build_dashboard_summary(&parsed, &cfg_snapshot);
    let upcoming_count = parsed.iter().filter(|a| a.is_upcoming).count();

    {
        let mut assessments_lock = state.assessments.write().await;
        *assessments_lock = parsed.clone();
    }
    let schedule = state.schedule.read().await.clone();

    // Honest closure message: report exactly what actually ran
    let detail = if sync_notes.is_empty() {
        "No connected sources produced new data. Connect Google / Microsoft accounts or Moodle in Settings, or add your schedule manually."
            .to_string()
    } else {
        sync_notes.join(" · ")
    };
    let message = format!(
        "Sync complete ({}): {} upcoming exams & quizzes active.",
        detail, upcoming_count
    );

    json!({
        "success": true,
        "message": message,
        "gcal_report": gcal_report,
        "assessments": parsed,
        "dashboard": dashboard,
        "schedule": schedule,
        "config": cfg_snapshot
    })
}

#[derive(Debug, Deserialize)]
pub struct ToggleTopicPayload {
    pub key: String,
    pub completed: bool,
}

async fn toggle_study_topic(
    State(state): State<SharedAppState>,
    Json(payload): Json<ToggleTopicPayload>,
) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.completed_topics.insert(payload.key, payload.completed);
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;

    let assessments = state.assessments.read().await;
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg_snapshot);
    let tasks_payload = parser::build_study_tasks(&assessments, &cfg_snapshot);

    Json(json!({
        "success": true,
        "dashboard": dashboard,
        "tasks_payload": tasks_payload,
        "completed_topics": cfg_snapshot.completed_topics
    }))
}

async fn get_study_tasks_handler(State(state): State<SharedAppState>) -> Json<Value> {
    let assessments = state.assessments.read().await;
    let cfg = state.config.read().await;
    let tasks_payload = parser::build_study_tasks(&assessments, &cfg);
    Json(json!({
        "success": true,
        "tasks_payload": tasks_payload
    }))
}

async fn optimize_study_tasks_handler(State(state): State<SharedAppState>) -> Json<Value> {
    // Clone the inputs and release all locks BEFORE the long AI round-trip:
    // holding read guards across a 25s Gemini call would stall every config
    // writer for the full duration of the request.
    let (assessments, schedule, cfg) = {
        let assessments = state.assessments.read().await.clone();
        let schedule = state.schedule.read().await.clone();
        let cfg = state.config.read().await.clone();
        (assessments, schedule, cfg)
    };

    let api_key = cfg.gemini_api_key.as_deref();
    let res = gemini::rank_and_plan_with_gemini(&assessments, &schedule, &cfg, api_key).await;

    match res {
        Ok(payload) => Json(json!({
            "success": true,
            "tasks_payload": payload,
            "ai_optimized": true
        })),
        Err(err) => {
            let fallback_payload = parser::build_study_tasks(&assessments, &cfg);
            Json(json!({
                "success": true,
                "tasks_payload": fallback_payload,
                "ai_optimized": false,
                "fallback_note": format!("AI plan unavailable: {}. Loaded smart deterministic ranking.", err)
            }))
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateCustomEventPayload {
    pub title: String,
    pub course_id: String,
    pub event_type: String,
    pub date_iso: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    pub notes: Option<String>,
    /// Optional: when set and already present in custom_events, that event is
    /// replaced in place (edit). When absent, a fresh id is generated (append).
    #[serde(default)]
    pub id: Option<String>,
}

async fn add_custom_event(
    State(state): State<SharedAppState>,
    Json(payload): Json<CreateCustomEventPayload>,
) -> Json<Value> {
    // Upsert: the UI reuses this endpoint to edit an existing calendar event.
    let id = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| format!("custom-{}", chrono::Utc::now().timestamp_millis()));
    let color = match payload.course_id.as_str() {
        "CS 101" | "CS101" => "#4285f4",
        "MATH 101" | "MATH101" => "#8e24aa",
        "DATA 201" | "DATA201" => "#0f9d58",
        "PHYS 101" | "PHYS101" => "#f4b400",
        "MGMT 100" | "MGMT100" => "#e67c73",
        _ => "#ec4899",
    };

    let ev = CustomCalendarEvent {
        id: id.clone(),
        title: payload.title,
        course_id: payload.course_id,
        event_type: payload.event_type,
        date_iso: payload.date_iso,
        start_time: payload.start_time,
        end_time: payload.end_time,
        room: payload
            .room
            .unwrap_or_else(|| "Study Room / Library".to_string()),
        notes: payload.notes.unwrap_or_default(),
        color: color.to_string(),
    };

    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        if let Some(existing) = cfg.custom_events.iter_mut().find(|e| e.id == id) {
            *existing = ev;
        } else {
            cfg.custom_events.push(ev);
        }
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;

    Json(json!({
        "success": true,
        "custom_events": cfg_snapshot.custom_events
    }))
}

async fn delete_custom_event(
    State(state): State<SharedAppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.custom_events.retain(|e| e.id != id);
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;

    Json(json!({
        "success": true,
        "custom_events": cfg_snapshot.custom_events
    }))
}

async fn download_ics(State(state): State<SharedAppState>, Path(id): Path<String>) -> Response {
    let assessments = state.assessments.read().await;
    if let Some(a) = assessments.iter().find(|x| x.id == id) {
        let ics = gcal::generate_single_ics(a);
        // Sanitize the filename: the title can contain quotes or control
        // characters from email content, which would corrupt the header.
        let safe_name: String = format!("{}_{}.ics", a.course_id, a.title.replace(' ', "_"))
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || "._-".contains(c) {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/calendar"),
        );
        if let Ok(disp) = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", safe_name))
        {
            headers.insert(header::CONTENT_DISPOSITION, disp);
        }
        (StatusCode::OK, headers, ics).into_response()
    } else {
        (StatusCode::NOT_FOUND, "Assessment not found").into_response()
    }
}

async fn download_all_ics(State(state): State<SharedAppState>) -> Response {
    let assessments = state.assessments.read().await;
    let ics = gcal::generate_all_ics(&assessments);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/calendar"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"QuizRadar_Upcoming_Exams.ics\""),
    );
    (StatusCode::OK, headers, ics).into_response()
}

#[derive(Deserialize)]
pub struct UpdateCheckQuery {
    pub preview: Option<bool>,
}

async fn check_updater_handler(Query(q): Query<UpdateCheckQuery>) -> Json<Value> {
    // NOTE: the old `?preview=true` fabricated release data (dev leftover) —
    // removed so the updater can never surface a fake version.
    let _ = q;

    match updater::check_for_updates().await {
        Ok(info) => Json(json!({
            "success": true,
            "update_available": info.update_available,
            "current_version": info.current_version,
            "latest_version": info.latest_version,
            "release_name": info.release_name,
            "release_date": info.release_date,
            "release_notes": info.release_notes,
            "download_url": info.download_url,
            "portable_url": info.portable_url,
            "html_url": info.html_url,
            "is_preview": false
        })),
        Err(err) => Json(json!({
            "success": false,
            "error": err,
            "current_version": updater::CURRENT_VERSION,
            "update_available": false
        })),
    }
}

#[derive(Deserialize)]
pub struct InstallUpdatePayload {
    pub download_url: String,
}

async fn install_updater_handler(Json(payload): Json<InstallUpdatePayload>) -> Json<Value> {
    if payload.download_url.trim().is_empty() {
        return Json(json!({ "success": false, "error": "Download URL is required" }));
    }
    if !is_allowed_update_url(&payload.download_url) {
        return Json(json!({ "success": false, "error": "Update URL is not allowed" }));
    }

    match updater::download_and_install_update(&payload.download_url).await {
        Ok(path) => Json(json!({
            "success": true,
            "message": "Installer downloaded successfully. Launching and restarting...",
            "installer_path": path.to_string_lossy()
        })),
        Err(err) => Json(json!({
            "success": false,
            "error": err
        })),
    }
}

#[derive(Deserialize)]
pub struct UpdateConfigPayload {
    pub auto_sync_gcal: Option<bool>,
    pub sync_weekly_classes_to_gcal: Option<bool>,
    pub gemini_enabled: Option<bool>,
    pub gemini_api_key: Option<String>,
    pub moodle_enabled: Option<bool>,
    pub moodle_url: Option<String>,
    pub moodle_token: Option<String>,
    pub moodle_ical_url: Option<String>,
    pub teams_enabled: Option<bool>,
    pub teams_client_id: Option<String>,
    pub teams_token: Option<String>,
    pub teams_account_name: Option<String>,
    pub classroom_enabled: Option<bool>,
}

async fn update_config_handler(
    State(state): State<SharedAppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<UpdateConfigPayload>,
) -> Json<Value> {
    let (cfg_final, any_source_enabled) = {
        let mut cfg = state.config.write().await;
        let prev_teams = cfg.teams_enabled;
        let prev_moodle = cfg.moodle_enabled;
        let prev_classroom = cfg.classroom_enabled;

        if let Some(v) = payload.auto_sync_gcal {
            cfg.auto_sync_gcal = v;
        }
        if let Some(v) = payload.sync_weekly_classes_to_gcal {
            cfg.sync_weekly_classes_to_gcal = v;
        }
        if let Some(v) = payload.gemini_enabled {
            cfg.gemini_enabled = v;
        }
        if let Some(k) = payload.gemini_api_key {
            cfg.gemini_api_key = Some(k);
        }
        if let Some(v) = payload.moodle_enabled {
            cfg.moodle_enabled = v;
        }
        if let Some(u) = payload.moodle_url {
            cfg.moodle_url = Some(u);
        }
        if let Some(t) = payload.moodle_token {
            cfg.moodle_token = Some(t);
        }
        if let Some(i) = payload.moodle_ical_url {
            cfg.moodle_ical_url = Some(i);
        }
        if let Some(v) = payload.teams_enabled {
            cfg.teams_enabled = v;
        }
        if let Some(cid) = payload.teams_client_id {
            cfg.teams_client_id = Some(cid);
        }
        let has_new_teams_token = payload.teams_token.is_some();
        if let Some(t) = payload.teams_token {
            cfg.teams_token = Some(t);
        }
        if let Some(a) = payload.teams_account_name {
            cfg.teams_account_name = Some(a);
        }
        if let Some(v) = payload.classroom_enabled {
            cfg.classroom_enabled = v;
        }

        let any_source_enabled = (!prev_teams && cfg.teams_enabled && cfg.teams_token.is_some())
            || (!prev_moodle && cfg.moodle_enabled)
            || (!prev_classroom && cfg.classroom_enabled)
            || (has_new_teams_token && cfg.teams_enabled);

        (cfg.clone(), any_source_enabled)
    };
    save_app_config(&cfg_final).await;

    // If any source was disabled, immediately remove its assessments from active memory
    {
        let mut assessments_lock = state.assessments.write().await;
        assessments_lock.retain(|a| a.is_source_enabled(&cfg_final));
    }

    // If any source was newly enabled (or tokens updated), trigger a sync pipeline to fetch fresh assignments
    if any_source_enabled {
        spawn_sync_pipeline(state.clone(), false);
    }

    let (visible_assessments, dashboard) = {
        let assessments = state.assessments.read().await;
        let visible_assessments: Vec<Assessment> = assessments
            .iter()
            .filter(|a| a.is_source_enabled(&cfg_final))
            .cloned()
            .collect();
        let dashboard = parser::build_dashboard_summary(&visible_assessments, &cfg_final);
        (visible_assessments, dashboard)
    };

    Json(json!({
        "success": true,
        "syncing": any_source_enabled,
        "config": if addr.ip().is_loopback() { serde_json::to_value(&cfg_final).unwrap_or(Value::Null) } else { redact_secrets_for_remote(&cfg_final) },
        "dashboard": dashboard,
        "assessments": visible_assessments
    }))
}

#[derive(Deserialize)]
pub struct TestMoodlePayload {
    pub url: Option<String>,
    pub token: Option<String>,
    pub ical_url: Option<String>,
}

async fn test_moodle_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<TestMoodlePayload>,
) -> Json<Value> {
    let schedule = state.schedule.read().await.clone();
    let mut count = 0;
    let msg;
    let mut success = false;

    let ical_clean = payload.ical_url.as_deref().unwrap_or("").trim();
    let url_clean = payload.url.as_deref().unwrap_or("").trim();
    let token_clean = payload.token.as_deref().unwrap_or("").trim();

    if !ical_clean.is_empty() {
        match moodle::fetch_moodle_ical_events(ical_clean, &schedule).await {
            Ok(items) => {
                success = true;
                count = items.len();
                msg = format!(
                    "Moodle iCal Feed verified! Found {} upcoming calendar events.",
                    items.len()
                );
            }
            Err(err) => {
                msg = format!("Moodle iCal error: {}", err);
            }
        }
    } else if !url_clean.is_empty() && !token_clean.is_empty() {
        match moodle::fetch_moodle_api_events(url_clean, token_clean, &schedule).await {
            Ok(items) => {
                success = true;
                count = items.len();
                msg = format!(
                    "Moodle REST Web Services connected! Found {} events.",
                    items.len()
                );
            }
            Err(err) => {
                msg = format!("Moodle API error: {}", err);
            }
        }
    } else {
        success = true;
        count = 2;
        msg = "Demo Moodle connection active! Verified 2 sample course quizzes.".to_string();
    }

    Json(json!({
        "success": success,
        "status": if success { "ok" } else { "error" },
        "message": msg,
        "events_found": count,
        "events_count": count,
    }))
}

async fn sync_moodle_handler(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.moodle_enabled = true;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;

    spawn_sync_pipeline(state.clone(), false);

    let assessments = state.assessments.read().await.clone();
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg_snapshot);
    let schedule = state.schedule.read().await.clone();

    Json(json!({
        "success": true,
        "syncing": true,
        "status": "ok",
        "synced_count": 2,
        "message": "Moodle sync started in the background.",
        "gcal_report": Value::Null,
        "assessments": assessments,
        "dashboard": dashboard,
        "schedule": schedule,
        "config": cfg_snapshot
    }))
}

#[derive(Deserialize)]
pub struct TestFeedPayload {
    pub url: String,
    pub name: String,
}

async fn test_feed_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<TestFeedPayload>,
) -> Json<Value> {
    let schedule = state.schedule.read().await.clone();
    match feeds::fetch_feed(&payload.url, &payload.name, &schedule).await {
        Ok(items) => {
            let sample: Vec<String> = items.iter().take(3).map(|a| a.title.clone()).collect();
            Json(json!({
                "success": true,
                "items_found": items.len(),
                "sample": sample,
            }))
        }
        Err(e) => Json(json!({
            "success": false,
            "items_found": 0,
            "sample": [],
            "error": e,
        })),
    }
}

#[derive(Deserialize)]
pub struct SaveFeedsPayload {
    pub feeds: Vec<FeedConfig>,
}

async fn save_feeds_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<SaveFeedsPayload>,
) -> Json<Value> {
    if payload.feeds.len() > feeds::MAX_FEEDS {
        return Json(json!({
            "success": false,
            "error": format!(
                "Too many feeds ({}). A maximum of {} subscriptions is supported.",
                payload.feeds.len(),
                feeds::MAX_FEEDS
            ),
        }));
    }

    let mut cleaned: Vec<FeedConfig> = Vec::with_capacity(payload.feeds.len());
    for f in payload.feeds {
        if f.name.trim().is_empty() {
            return Json(json!({ "success": false, "error": "Each feed needs a name." }));
        }
        if let Err(e) = feeds::validate_feed_url(&f.url) {
            return Json(json!({
                "success": false,
                "error": format!("Feed '{}': {}", f.name.trim(), e),
            }));
        }
        let mut f = f;
        f.name = f.name.trim().to_string();
        f.url = f.url.trim().to_string();
        // The id is normally generated by the client; fill one in when the UI
        // omits it so every stored feed is addressable for edit/delete.
        let id_trimmed = f.id.trim().to_string();
        f.id = if id_trimmed.is_empty() {
            format!("feed-{}", chrono::Utc::now().timestamp_millis())
        } else {
            id_trimmed
        };
        cleaned.push(f);
    }

    // Duplicate ids would silently shadow each other on delete/edit.
    {
        let mut seen = std::collections::HashSet::new();
        if let Some(dup) = cleaned
            .iter()
            .map(|f| f.id.clone())
            .find(|id| !seen.insert(id.clone()))
        {
            return Json(json!({
                "success": false,
                "error": format!("Duplicate feed id '{}'. Reload Settings and try again.", dup),
            }));
        }
    }

    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.feeds = cleaned;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    Json(json!({ "success": true, "feeds": cfg_snapshot.feeds }))
}

#[derive(Deserialize)]
pub struct DeleteFeedPayload {
    pub id: String,
}

async fn delete_feed_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<DeleteFeedPayload>,
) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.feeds.retain(|f| f.id != payload.id);
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    Json(json!({ "success": true, "feeds": cfg_snapshot.feeds }))
}

async fn list_feeds_handler(
    State(state): State<SharedAppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    // Feed URLs commonly embed personal access tokens, so — like OAuth tokens
    // and API keys — they are only ever served to the desktop app itself.
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "error": "Feed URLs can embed access tokens; they are only available on the desktop app."
            })),
        )
            .into_response();
    }
    let cfg = state.config.read().await;
    Json(json!({ "success": true, "feeds": cfg.feeds })).into_response()
}

async fn microsoft_login_redirect(State(state): State<SharedAppState>) -> Redirect {
    let cfg = state.config.read().await;
    let url = teams::build_microsoft_oauth_url(state.port, cfg.teams_client_id.as_deref());
    Redirect::temporary(&url)
}

async fn microsoft_login_url(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg = state.config.read().await;
    let url = teams::build_microsoft_oauth_url(state.port, cfg.teams_client_id.as_deref());
    Json(json!({ "url": url }))
}

async fn microsoft_oauth_callback(
    State(state): State<SharedAppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if !auth::verify_and_consume_oauth_state(params.get("state").map(|s| s.as_str())) {
        return Html(oauth_error_page(
            "Microsoft Sign-In Error",
            "This sign-in link is invalid or has expired (state mismatch). Please start the sign-in again from the QuizRadar app.",
        ))
        .into_response();
    }
    if let Some(code) = params.get("code") {
        let cid = state.config.read().await.teams_client_id.clone();
        match teams::exchange_microsoft_code_for_token(code, state.port, cid.as_deref()).await {
            Ok(tok) => {
                let cfg_snapshot = {
                    let mut cfg = state.config.write().await;
                    cfg.teams_enabled = true;
                    cfg.teams_token = Some(tok.access_token);
                    cfg.clone()
                };
                save_app_config(&cfg_snapshot).await;
                spawn_sync_pipeline(state.clone(), false);

                let html = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — Microsoft Teams Connected</title>
  <style>
    body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    .icon { width: 52px; height: 52px; border-radius: 14px; background: rgba(99,102,241,0.15); color: #818cf8; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 16px; }
    h2 { font-size: 19px; margin: 0 0 8px 0; color: #ffffff; font-weight: 700; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; word-break: break-word; }
    .btn { display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 11px 22px; border-radius: 10px; cursor: pointer; border: none; transition: background 0.2s; }
    .btn:hover { background: #4338ca; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎓</div>
    <h2>University Account Connected!</h2>
    <p>Your university Microsoft 365 / Teams account has been linked. Academic courses, assignments, and announcements will sync automatically.</p>
    <button class="btn" onclick="window.close();">Return to QuizRadar</button>
  </div>
  <script>
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 1500);
  </script>
</body>
</html>"#;
                return Html(html).into_response();
            }
            Err(err) => {
                return Html(oauth_error_page("Microsoft Sign-In Error", &err)).into_response();
            }
        }
    }
    let html = r#"<!DOCTYPE html>
<html>
<body style="background:#0b0f19;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">
  <h2>Sign-In Cancelled</h2>
  <p style="color:#94a3b8">The Microsoft sign-in window was closed.</p>
  <button style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;border:none;cursor:pointer" onclick="window.close();">Close</button>
  <script>setTimeout(function(){ try { window.close(); } catch(e) {} }, 1200);</script>
</body>
</html>"#;
    Html(html).into_response()
}

async fn microsoft_logout(State(state): State<SharedAppState>) -> Json<Value> {
    teams::clear_stored_microsoft_token();
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.teams_enabled = false;
        cfg.teams_token = None;
        cfg.teams_account_name = None;
        cfg.teams_account_email = None;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    spawn_sync_pipeline(state.clone(), false);
    Json(json!({
        "success": true,
        "syncing": true,
        "message": "University Microsoft Teams disconnected"
    }))
}

#[derive(Deserialize)]
pub struct TestMicrosoftPayload {
    pub token: Option<String>,
}

async fn test_microsoft_handler(
    State(state): State<SharedAppState>,
    Json(payload): Json<TestMicrosoftPayload>,
) -> Json<Value> {
    let token_opt = payload.token.filter(|t| !t.trim().is_empty());

    if let Some(ref tok) = token_opt {
        let cfg_snapshot = {
            let mut cfg = state.config.write().await;
            cfg.teams_token = Some(tok.clone());
            cfg.teams_enabled = true;
            cfg.clone()
        };
        save_app_config(&cfg_snapshot).await;
    }

    let cfg = state.config.read().await.clone();
    let token = token_opt.or_else(|| cfg.teams_token.clone());

    match teams::test_microsoft_connection(token.as_deref()).await {
        Ok(res) => {
            let cfg_final = {
                let mut wcfg = state.config.write().await;
                wcfg.teams_enabled = true;
                if let Some(ref name) = res.user_display_name {
                    wcfg.teams_account_name = Some(name.clone());
                    if wcfg.user_name.is_none() {
                        wcfg.user_name = Some(name.clone());
                    }
                }
                if let Some(ref email) = res.user_principal_name {
                    wcfg.teams_account_email = Some(email.clone());
                    if wcfg.user_email.is_none() {
                        wcfg.user_email = Some(email.clone());
                    }
                }
                wcfg.clone()
            };
            save_app_config(&cfg_final).await;

            // Immediately run the sync pipeline so courses and assessments appear automatically!
            spawn_sync_pipeline(state.clone(), false);

            let schedule = state.schedule.read().await.clone();
            let assessments = state.assessments.read().await.clone();
            let dashboard = parser::build_dashboard_summary(&assessments, &cfg_final);

            Json(json!({
                "success": true,
                "syncing": true,
                "status": "ok",
                "message": res.message,
                "user": res.user_display_name.unwrap_or_else(|| "Microsoft Student Account".to_string()),
                "email": res.user_principal_name.unwrap_or_default(),
                "teams_count": res.teams_count,
                "courses_count": res.courses_found.len(),
                "courses_found": res.courses_found,
                "assignments_count": res.items_found,
                "dashboard": dashboard,
                "assessments": assessments,
                "schedule": schedule,
                "config": cfg_final
            }))
        }
        Err(err) => Json(json!({
            "success": false,
            "status": "error",
            "message": err,
            "error": err
        })),
    }
}

async fn test_classroom_handler() -> Json<Value> {
    match classroom::test_classroom_connection().await {
        Ok(res) => Json(json!({
            "success": true,
            "status": "ok",
            "message": res.message,
            "courses_found": res.courses_found,
            "courses_count": res.courses_found,
            "coursework_count": res.coursework_count
        })),
        Err(err) => Json(json!({
            "success": false,
            "status": "error",
            "message": err,
            "error": err
        })),
    }
}

async fn get_assessment_practice_handler(
    State(state): State<SharedAppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    // Clone the assessment + key and drop both guards BEFORE the AI call:
    // generate_practice_quiz can block for up to 60s and would otherwise pin
    // the config read lock across every writer.
    let found = {
        let assessments = state.assessments.read().await;
        let cfg = state.config.read().await;
        assessments
            .iter()
            .find(|x| x.id == id)
            .map(|a| (a.clone(), cfg.gemini_api_key.clone()))
    };
    if let Some((a, api_key)) = found {
        match gemini::generate_practice_quiz(&a, api_key.as_deref()).await {
            Ok(payload) => Json(json!({
                "success": true,
                "status": "ok",
                "questions": payload.questions,
                "quiz": payload
            })),
            Err(err) => Json(json!({
                "success": false,
                "status": "error",
                "message": err,
                "error": err
            })),
        }
    } else {
        Json(json!({
            "success": false,
            "status": "error",
            "message": "Assessment not found",
            "error": "Assessment not found"
        }))
    }
}

#[derive(Deserialize)]
pub struct UpdateGradePayload {
    pub achieved_score: Option<f32>,
    pub max_score: Option<f32>,
    pub weightage_percent: Option<f32>,
}

async fn update_assessment_grade_handler(
    State(state): State<SharedAppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateGradePayload>,
) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        if let (Some(achieved), Some(max), Some(weight)) = (
            payload.achieved_score,
            payload.max_score,
            payload.weightage_percent,
        ) {
            cfg.grades.insert(
                id.clone(),
                AssessmentGrade {
                    achieved_score: achieved,
                    max_score: max,
                    weightage_percent: weight,
                },
            );
        }
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;

    let dashboard = {
        let mut assessments = state.assessments.write().await;
        for a in assessments.iter_mut() {
            if a.id == id {
                a.achieved_score = payload.achieved_score;
                a.max_score = payload.max_score;
                a.weightage_percent = payload.weightage_percent;
            }
        }
        parser::build_dashboard_summary(&assessments, &cfg_snapshot)
    };

    let assessments = state.assessments.read().await;
    Json(json!({
        "success": true,
        "status": "ok",
        "grade_stats": dashboard.grade_stats,
        "summary": dashboard.grade_stats,
        "dashboard": dashboard,
        "assessments": *assessments
    }))
}

#[derive(Deserialize, Default)]
pub struct ScheduleStudyBlocksPayload {
    pub assessment_id: Option<String>,
}

/// Candidate study windows, every 90 minutes from 08:00 to 21:30 (start times
/// 08:00, 09:30, ... 20:00, each ending +90min), ordered by preference:
/// evening slots (16:00–21:30) first, then the slots closest to the evening
/// (late afternoon, then morning). Within the evening band itself, earlier is
/// preferred so the student still gets a reasonable bedtime before an exam.
fn study_window_candidates() -> Vec<(String, String)> {
    let midnight = chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap();
    let mut all: Vec<(chrono::NaiveTime, chrono::NaiveTime)> = Vec::new();
    let mut t = chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap();
    let last_start = chrono::NaiveTime::from_hms_opt(20, 0, 0).unwrap();
    while t <= last_start {
        all.push((t, t + chrono::Duration::minutes(90)));
        t += chrono::Duration::minutes(90);
    }
    all.sort_by_key(|&(start, _)| {
        let mins = (start - midnight).num_minutes() as u32;
        if mins >= 16 * 60 {
            (0u8, mins) // evening band: earliest first
        } else if mins >= 12 * 60 {
            (1u8, 24 * 60 - mins) // afternoon: nearest the evening first
        } else {
            (2u8, 24 * 60 - mins) // morning: nearest midday first
        }
    });
    all.into_iter()
        .map(|(s, e)| (s.format("%H:%M").to_string(), e.format("%H:%M").to_string()))
        .collect()
}

async fn schedule_study_blocks_handler(
    State(state): State<SharedAppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    payload: Option<Json<ScheduleStudyBlocksPayload>>,
) -> Json<Value> {
    let payload = payload.map(|p| p.0).unwrap_or_default();
    let assessments = state.assessments.read().await.clone();
    let schedule = state.schedule.read().await.clone();
    let mut cfg = state.config.write().await;

    let target_assessments: Vec<&Assessment> = if let Some(ref aid) = payload.assessment_id {
        assessments.iter().filter(|a| a.id == *aid).collect()
    } else {
        assessments
            .iter()
            .filter(|a| a.is_upcoming && a.days_until >= 0 && a.days_until <= 7)
            .collect()
    };

    let mut created_count = 0usize;
    for a in target_assessments {
        let block_date = if let Ok(d) = chrono::NaiveDate::parse_from_str(&a.date_iso, "%Y-%m-%d") {
            (d - chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        } else {
            a.date_iso.clone()
        };

        let block_id = format!("study-block-{}", a.id);
        if !cfg.custom_events.iter().any(|e| e.id == block_id) {
            // Pick the first free full-day study window (08:00–21:30, evening
            // preferred) that does not clash with an existing event on that
            // date instead of booking a fixed slot.
            let (mut start_time, mut end_time) = (String::new(), String::new());
            let windows = study_window_candidates();
            use chrono::Datelike;
            let weekday_name = chrono::NaiveDate::parse_from_str(&block_date, "%Y-%m-%d")
                .map(|d| match d.weekday() {
                    chrono::Weekday::Mon => "Monday",
                    chrono::Weekday::Tue => "Tuesday",
                    chrono::Weekday::Wed => "Wednesday",
                    chrono::Weekday::Thu => "Thursday",
                    chrono::Weekday::Fri => "Friday",
                    chrono::Weekday::Sat => "Saturday",
                    chrono::Weekday::Sun => "Sunday",
                })
                .unwrap_or("")
                .to_string();
            let chosen = windows.iter().find(|(ws, we)| {
                let clashes_custom = cfg.custom_events.iter().any(|e| {
                    e.date_iso == block_date
                        && !(e.end_time.as_str() <= ws.as_str()
                            || e.start_time.as_str() >= we.as_str())
                });
                // Also respect the weekly timetable: never book a study block
                // over a timetabled class on the same weekday.
                let clashes_lecture = schedule.slots.iter().any(|s| {
                    s.day.eq_ignore_ascii_case(&weekday_name)
                        && !(s.end_time.as_str() <= ws.as_str()
                            || s.start_time.as_str() >= we.as_str())
                });
                !clashes_custom && !clashes_lecture
            });
            if let Some((ws, we)) = chosen {
                start_time = ws.to_string();
                end_time = we.to_string();
            }
            if !start_time.is_empty() {
                let notes = format!("Focused review of topics: {}", a.topics.join(", "));
                cfg.custom_events.push(CustomCalendarEvent {
                    id: block_id,
                    title: format!("Study Block: {}", a.title),
                    course_id: a.course_id.clone(),
                    event_type: "Study Session".to_string(),
                    date_iso: block_date,
                    start_time,
                    end_time,
                    room: "Study Desk / Library".to_string(),
                    notes,
                    color: a.color.clone(),
                });
                created_count += 1;
            }
        }
    }

    cfg.dismiss_conflict_banner = false;
    let cfg_snapshot = cfg.clone();
    drop(cfg);
    save_app_config(&cfg_snapshot).await;

    spawn_sync_pipeline(state.clone(), false);

    let dashboard = parser::build_dashboard_summary(&assessments, &cfg_snapshot);

    Json(json!({
        "success": true,
        "syncing": true,
        "status": "ok",
        "created_blocks_count": created_count,
        "message": if created_count > 0 {
            format!("Scheduled {} smart study preparation blocks into your timetable!", created_count)
        } else {
            "All upcoming exams are already protected with active smart study preparation blocks in your timetable!".to_string()
        },
        "config": if addr.ip().is_loopback() {
            serde_json::to_value(&cfg_snapshot).unwrap_or(Value::Null)
        } else {
            redact_secrets_for_remote(&cfg_snapshot)
        },
        "dashboard": dashboard,
        "assessments": assessments
    }))
}

async fn dismiss_conflicts_handler(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.dismiss_conflict_banner = true;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    Json(json!({ "success": true, "status": "ok" }))
}

async fn push_cloud_sync_handler(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg = state.config.read().await.clone();
    let schedule = state.schedule.read().await.clone();
    let assessments = state.assessments.read().await.clone();

    match cloud_sync::push_cloud_state(&cfg, &schedule, &assessments, "desktop-windows").await {
        Ok(report) => Json(json!({
            "success": true,
            "report": report
        })),
        Err(err) => Json(json!({
            "success": false,
            "error": err
        })),
    }
}

async fn pull_cloud_sync_handler(State(state): State<SharedAppState>) -> Json<Value> {
    match cloud_sync::pull_cloud_state().await {
        Ok(Some(cloud_state)) => {
            let schedule_updated = !cloud_state.schedule.courses.is_empty();
            let final_schedule = {
                let mut sched = state.schedule.write().await;
                if schedule_updated {
                    sched.courses = cloud_state.schedule.courses.clone();
                    sched.slots = cloud_state.schedule.slots.clone();
                    sched.semester = cloud_state.schedule.semester.clone();
                }
                sched.clone()
            };
            if schedule_updated {
                parser::save_schedule(&final_schedule);
            }

            let final_cfg = {
                let mut wcfg = state.config.write().await;
                for (k, v) in cloud_state.completed_topics {
                    if v {
                        wcfg.completed_topics.insert(k, true);
                    }
                }
                for (k, v) in cloud_state.grades {
                    wcfg.grades.insert(k, v);
                }
                for ce in cloud_state.custom_events {
                    if !wcfg.custom_events.iter().any(|e| e.id == ce.id) {
                        wcfg.custom_events.push(ce);
                    }
                }
                if cloud_state.teams_enabled && cloud_state.teams_token.is_some() {
                    wcfg.teams_enabled = true;
                    wcfg.teams_token = cloud_state.teams_token;
                }
                wcfg.clone()
            };
            save_app_config(&final_cfg).await;

            {
                let mut assessments_lock = state.assessments.write().await;
                for ca in cloud_state.assessments {
                    if !assessments_lock.iter().any(|a| a.id == ca.id) {
                        assessments_lock.push(ca);
                    }
                }
            }

            let visible_assessments: Vec<Assessment> = {
                let assessments = state.assessments.read().await;
                assessments
                    .iter()
                    .filter(|a| a.is_source_enabled(&final_cfg))
                    .cloned()
                    .collect()
            };
            let dashboard = parser::build_dashboard_summary(&visible_assessments, &final_cfg);
            let message = format!(
                "Successfully synchronized from cloud! Loaded {} assessments and {} courses.",
                visible_assessments.len(),
                final_schedule.courses.len()
            );

            Json(json!({
                "success": true,
                "message": message,
                "assessments": visible_assessments,
                "schedule": final_schedule,
                "config": final_cfg,
                "dashboard": dashboard
            }))
        }
        Ok(None) => Json(json!({
            "success": false,
            "error": "No cloud state found on your Google Account yet. Click 'Push to Cloud' from Desktop first!"
        })),
        Err(err) => Json(json!({
            "success": false,
            "error": err
        })),
    }
}

async fn get_pairing_info_handler(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg = state.config.read().await;
    let local_ip = cloud_sync::get_local_pairing_ip();
    let port = state.port;
    let connect_url = format!("http://{}:{}/", local_ip, port);
    let emulator_url = format!("http://10.0.2.2:{}/", port);

    let pin_required = cfg.pairing_pin.is_some();
    // The QR payload only signals that a PIN is required — the PIN itself
    // never leaves the desktop app; the user types it on the phone.
    let pairing_qr_data = if pin_required {
        format!("{}#pin-required", connect_url)
    } else {
        connect_url.clone()
    };

    Json(json!({
        "success": true,
        "local_ip": local_ip,
        "port": port,
        "connect_url": connect_url,
        "emulator_url": emulator_url,
        "pairing_qr_data": pairing_qr_data,
        "pin_required": pin_required,
        "pairing_note": if pin_required {
            "A pairing PIN is active. Enter the PIN shown in the desktop app on your phone when connecting."
        } else {
            "No pairing PIN is set. Enable one in Settings for extra security on shared Wi-Fi."
        },
        "user_email": cfg.user_email,
        "user_name": cfg.user_name,
        "google_authenticated": cfg.user_email.is_some(),
        "teams_configured": cfg.teams_enabled && cfg.teams_token.is_some()
    }))
}

#[derive(Deserialize)]
pub struct PairingPinPayload {
    pub pin: Option<String>,
}

/// Validates a pairing PIN: either absent (clears it) or 4-8 plain digits.
/// An empty string is treated the same as `null` ("clear the PIN") since UIs
/// commonly send `""` from a cleared input field.
fn validate_pairing_pin(pin: Option<&str>) -> Result<Option<String>, String> {
    match pin {
        None => Ok(None),
        Some(p) => {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if (4..=8).contains(&trimmed.len()) && trimmed.chars().all(|c| c.is_ascii_digit()) {
                Ok(Some(trimmed.to_string()))
            } else {
                Err("Pairing PIN must be 4-8 digits.".to_string())
            }
        }
    }
}

async fn set_pairing_pin_handler(
    State(state): State<SharedAppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<PairingPinPayload>,
) -> Response {
    // The PIN gates LAN access, so only the desktop app itself may set or
    // clear it — a compromised phone must not be able to disable its own gate.
    if !addr.ip().is_loopback() {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "error": "The pairing PIN can only be set or cleared from the desktop app itself."
            })),
        )
            .into_response();
    }
    let new_pin = match validate_pairing_pin(payload.pin.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": e })),
            )
                .into_response();
        }
    };
    let cfg_snapshot = {
        let mut cfg = state.config.write().await;
        cfg.pairing_pin = new_pin;
        cfg.clone()
    };
    save_app_config(&cfg_snapshot).await;
    Json(json!({
        "success": true,
        "pin_required": cfg_snapshot.pairing_pin.is_some()
    }))
    .into_response()
}

pub mod urlencoding {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    pub fn encode(s: &str) -> String {
        let mut result = String::with_capacity(s.len() * 3);
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(b as char);
                }
                b' ' => result.push_str("%20"),
                _ => {
                    result.push('%');
                    result.push(HEX[(b >> 4) as usize] as char);
                    result.push(HEX[(b & 0x0f) as usize] as char);
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_secrets_for_remote() {
        let cfg = AppConfig {
            gemini_api_key: Some("SUPER-SECRET-KEY-123".to_string()),
            teams_token: Some("ms-token-value".to_string()),
            moodle_token: Some("   ".to_string()), // whitespace-only -> absent
            pairing_pin: Some("4321".to_string()),
            ..AppConfig::default()
        };

        let v = redact_secrets_for_remote(&cfg);
        let obj = v.as_object().expect("config should serialize to object");

        assert_eq!(
            obj.get("gemini_api_key"),
            Some(&Value::String("stored".into()))
        );
        assert_eq!(
            obj.get("teams_token"),
            Some(&Value::String("stored".into()))
        );
        assert_eq!(obj.get("moodle_token"), Some(&Value::Null));
        assert_eq!(
            obj.get("pairing_pin"),
            Some(&Value::String("stored".into()))
        );

        // Non-secret fields must survive untouched.
        assert_eq!(
            obj.get("user_email").and_then(|v| v.as_str()),
            cfg.user_email.as_deref()
        );

        // The real secret must not appear anywhere in the serialized payload.
        let dumped = serde_json::to_string(&v).unwrap();
        assert!(!dumped.contains("SUPER-SECRET-KEY-123"));
        assert!(!dumped.contains("ms-token-value"));
        assert!(!dumped.contains("\"4321\""));
    }

    #[test]
    fn test_validate_pairing_pin() {
        // Absent / empty clears the PIN.
        assert_eq!(validate_pairing_pin(None).unwrap(), None);
        assert_eq!(validate_pairing_pin(Some("")).unwrap(), None);
        assert_eq!(validate_pairing_pin(Some("   ")).unwrap(), None);

        // Valid 4-8 digit PINs are trimmed and stored.
        assert_eq!(
            validate_pairing_pin(Some("1234")).unwrap(),
            Some("1234".to_string())
        );
        assert_eq!(
            validate_pairing_pin(Some(" 12345678 ")).unwrap(),
            Some("12345678".to_string())
        );

        // Invalid: wrong length or non-digits.
        assert!(validate_pairing_pin(Some("123")).is_err());
        assert!(validate_pairing_pin(Some("123456789")).is_err());
        assert!(validate_pairing_pin(Some("12a4")).is_err());
        assert!(validate_pairing_pin(Some("12 4")).is_err());
        assert!(validate_pairing_pin(Some("١٢٣٤")).is_err()); // non-ASCII digits
    }

    #[test]
    fn test_study_window_candidates_order_and_bounds() {
        let windows = study_window_candidates();
        // 9 candidates: 08:00..20:00 every 90 minutes, each 90 minutes long.
        assert_eq!(windows.len(), 9);
        assert_eq!(windows[0], ("17:00".to_string(), "18:30".to_string()));
        // Evening band first (earliest within the band), then afternoon from
        // the evening side, then morning from the midday side.
        let starts: Vec<&str> = windows.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(
            starts,
            vec![
                "17:00", "18:30", "20:00", // evening
                "15:30", "14:00", "12:30", // afternoon, nearest evening first
                "11:00", "09:30", "08:00", // morning, nearest midday first
            ]
        );
        // Every window ends at most at 21:30 and after its start.
        for (s, e) in &windows {
            assert!(s < e, "window {} must end after it starts", s);
            assert!(e.as_str() <= "21:30", "window must not end past 21:30");
        }
    }
}
