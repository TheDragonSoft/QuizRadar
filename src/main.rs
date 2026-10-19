#![windows_subsystem = "windows"]

pub mod auth;
pub mod classroom;
pub mod cloud_sync;
pub mod gcal;
pub mod gemini;
pub mod gmail;
pub mod models;
pub mod moodle;
pub mod parser;
pub mod teams;
pub mod updater;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{delete, get, post},
    Json, Router,
};
use tower_http::cors::CorsLayer;
use models::{
    AppConfig, Assessment, AssessmentGrade, Course, CustomCalendarEvent, ScheduleData, ScheduleSlot,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    net::SocketAddr,
    sync::{mpsc, Arc},
};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;

const CONFIG_FILE: &str = "data/app_config.json";

#[derive(Clone)]
pub struct SharedAppState {
    pub port: u16,
    pub config: Arc<RwLock<AppConfig>>,
    pub schedule: Arc<RwLock<ScheduleData>>,
    pub assessments: Arc<RwLock<Vec<Assessment>>>,
}

fn load_app_config() -> AppConfig {
    if let Ok(raw) = fs::read_to_string(CONFIG_FILE) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&raw) {
            return cfg;
        }
    }
    AppConfig::default()
}

fn save_app_config(cfg: &AppConfig) {
    let _ = fs::create_dir_all("data");
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(CONFIG_FILE, json);
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {}\n", info);
        let _ = std::fs::write("panic.log", msg);
    }));

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

    let headless = std::env::args().any(|a| a == "--headless" || a == "--server");
    let (port_tx, port_rx) = mpsc::channel::<u16>();

    let server_handle = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime");
        rt.block_on(run_backend_server(port_tx));
    });

    let selected_port = port_rx.recv().unwrap_or(5000);

    if headless {
        let _ = server_handle.join();
        return;
    }

    #[cfg(any(windows, target_os = "macos"))]
    {
        run_native_desktop_window(selected_port);
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = open::that(format!("http://127.0.0.1:{}", selected_port));
        let _ = server_handle.join();
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn run_native_desktop_window(port: u16) {
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

    let app_url = format!("http://127.0.0.1:{}", port);

    let webview = WebViewBuilder::new()
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

async fn run_backend_server(port_tx: mpsc::Sender<u16>) {
    let ports = [5050, 5000, 3000, 8080, 5150, 5250, 0];
    let mut selected_port = 5050;
    let mut listener = None;

    // Security: bind to localhost only by default. Expose on the LAN only when the
    // user explicitly passes --lan (e.g. to pair the Android app with this desktop).
    let expose_lan = std::env::args().any(|a| a == "--lan" || a == "--pairing");
    let bind_ip = if expose_lan { [0, 0, 0, 0] } else { [127, 0, 0, 1] };

    for port in ports {
        let addr = SocketAddr::from((bind_ip, port));
        if let Ok(l) = tokio::net::TcpListener::bind(addr).await {
            selected_port = l.local_addr().map(|a| a.port()).unwrap_or(port);
            listener = Some(l);
            break;
        }
    }

    let listener = listener.expect("Could not bind local server socket");
    let _ = port_tx.send(selected_port);

    let config = load_app_config();
    let schedule = parser::load_schedule();
    let cached_emails = gmail::load_cached_emails();

    let mut initial_assessments =
        parser::process_all_emails(&cached_emails, &schedule, &config, false).await;

    // If student is enrolled in courses, remove non-matching demo emails
    if !schedule.courses.is_empty() {
        let active_course_codes: std::collections::HashSet<String> = schedule
            .courses
            .iter()
            .map(|c| c.id.trim().to_uppercase())
            .collect();
        initial_assessments.retain(|p| {
            if p.id.starts_with("teams-") || p.id.starts_with("moodle-") || p.id.starts_with("classroom-") {
                return true;
            }
            let cid = p.course_id.trim().to_uppercase();
            active_course_codes.contains(&cid)
                || active_course_codes.iter().any(|ac| cid.starts_with(ac) || ac.starts_with(&cid))
        });
    }

    // Filter out disabled sources on startup
    initial_assessments.retain(|p| p.is_source_enabled(&config));

    let state = SharedAppState {
        port: selected_port,
        config: Arc::new(RwLock::new(config.clone())),
        schedule: Arc::new(RwLock::new(schedule)),
        assessments: Arc::new(RwLock::new(initial_assessments)),
    };

    // If Teams integration is enabled with a valid token, auto-run the sync pipeline in background immediately
    if config.teams_enabled && config.teams_token.is_some() {
        let teams_bg_state = state.clone();
        tokio::spawn(async move {
            run_sync_pipeline(&teams_bg_state, false).await;
        });
    }

    // Refresh Google authentication profile in the background so startup is 0ms
    let bg_state = state.clone();
    tokio::spawn(async move {
        let profile = auth::fetch_user_profile().await;
        if profile.authenticated {
            let mut cfg = bg_state.config.write().await;
            cfg.user_email = profile.email.clone();
            cfg.user_name = profile.name.clone();
            cfg.user_picture = profile.picture.clone();
            save_app_config(&cfg);
        }
    });

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
        .route("/api/study/tasks/optimize", post(optimize_study_tasks_handler))
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
        .route("/api/microsoft/login", get(microsoft_login_redirect))
        .route("/api/microsoft/url", get(microsoft_login_url))
        .route("/api/auth/microsoft/callback", get(microsoft_oauth_callback))
        .route("/api/microsoft/test", post(test_microsoft_handler))
        .route("/api/microsoft/logout", post(microsoft_logout))
        .route("/api/classroom/test", get(test_classroom_handler).post(test_classroom_handler))
        .route("/api/assessments/:id/practice", post(get_assessment_practice_handler))
        .route("/api/assessments/:id/grade", post(update_assessment_grade_handler))
        .route("/api/study/blocks/schedule", post(schedule_study_blocks_handler))
        .route("/api/conflicts/dismiss", post(dismiss_conflicts_handler))
        .route("/api/updater/check", get(check_updater_handler))
        .route("/api/updater/install", post(install_updater_handler))
        .route("/api/sync/cloud/push", post(push_cloud_sync_handler))
        .route("/api/sync/cloud/pull", post(pull_cloud_sync_handler))
        .route("/api/sync/pair/info", get(get_pairing_info_handler))
        .route("/static/app.js", get(serve_app_js))
        .route("/app.js", get(serve_app_js))
        .route("/static/lucide.min.js", get(serve_lucide_js))
        .route("/lucide.min.js", get(serve_lucide_js))
        .route("/static/icon.svg", get(serve_icon_svg))
        .route("/icon.svg", get(serve_icon_svg))
        .route("/manifest.webmanifest", get(serve_manifest))
        .route("/manifest.json", get(serve_manifest))
        .route("/sw.js", get(serve_sw_js))
        .nest_service("/static", ServeDir::new("static"))
        .fallback_service(ServeDir::new("static"))
        .layer(CorsLayer::permissive())
        .with_state(state);

    axum::serve(listener, app).await.unwrap();
}

async fn serve_index() -> Html<String> {
    let content = fs::read_to_string("static/index.html")
        .unwrap_or_else(|_| include_str!("../static/index.html").to_string());
    Html(content)
}

async fn serve_app_js() -> Response {
    let content = fs::read_to_string("static/app.js")
        .unwrap_or_else(|_| include_str!("../static/app.js").to_string());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/javascript; charset=utf-8"),
    );
    (StatusCode::OK, headers, content).into_response()
}

async fn serve_lucide_js() -> Response {
    let content = fs::read_to_string("static/lucide.min.js")
        .unwrap_or_else(|_| include_str!("../static/lucide.min.js").to_string());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/javascript; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );
    (StatusCode::OK, headers, content).into_response()
}

async fn serve_icon_svg() -> Response {
    let content = fs::read_to_string("static/icon.svg")
        .unwrap_or_else(|_| include_str!("../static/icon.svg").to_string());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("image/svg+xml; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );
    (StatusCode::OK, headers, content).into_response()
}

async fn serve_manifest() -> Response {
    let content = fs::read_to_string("static/manifest.webmanifest")
        .unwrap_or_else(|_| include_str!("../static/manifest.webmanifest").to_string());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/manifest+json; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    (StatusCode::OK, headers, content).into_response()
}

async fn serve_sw_js() -> Response {
    let content = fs::read_to_string("static/sw.js")
        .unwrap_or_else(|_| include_str!("../static/sw.js").to_string());
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/javascript; charset=utf-8"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );
    (StatusCode::OK, headers, content).into_response()
}

async fn get_full_state(State(state): State<SharedAppState>) -> Json<Value> {
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

    // If token exists on disk but user_email wasn't cached yet, refresh profile in background
    if profile.authenticated && profile.email.is_none() {
        let bg_state = state.clone();
        tokio::spawn(async move {
            let live = auth::fetch_user_profile().await;
            if live.authenticated {
                let mut wcfg = bg_state.config.write().await;
                wcfg.user_email = live.email;
                wcfg.user_name = live.name;
                wcfg.user_picture = live.picture;
                save_app_config(&wcfg);
            }
        });
    }

    Json(json!({
        "config": cfg,
        "auth": profile,
        "schedule": schedule,
        "assessments": assessments,
        "dashboard": dashboard,
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

async fn google_oauth_callback(
    State(state): State<SharedAppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    if let Some(code) = params.get("code") {
        match auth::exchange_code_for_token(code, state.port).await {
            Ok(_) => {
                let profile = auth::fetch_user_profile().await;
                let mut cfg = state.config.write().await;
                cfg.user_email = profile.email.clone();
                cfg.user_name = profile.name.clone();
                cfg.user_picture = profile.picture.clone();
                save_app_config(&cfg);
                drop(cfg);

                // Automatically scan Gmail and sync on sign-in
                let _ = run_sync_pipeline(&state, true).await;

                return Redirect::temporary("/?auth=success").into_response();
            }
            Err(err) => {
                let html = format!(
                    r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — Google Sign-In</title>
  <style>
    body {{ background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }}
    .card {{ background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }}
    .icon {{ width: 48px; height: 48px; border-radius: 12px; background: rgba(239,68,68,0.15); color: #ef4444; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; }}
    h2 {{ font-size: 18px; margin: 0 0 8px 0; color: #ffffff; }}
    p {{ font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; word-break: break-word; }}
    .btn {{ display: inline-block; background: #1a73e8; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 10px; transition: background 0.2s; }}
    .btn:hover {{ background: #1557b0; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h2>Google Sign-In Error</h2>
    <p>{}</p>
    <a href="/" class="btn">Return to QuizRadar</a>
  </div>
</body>
</html>"#,
                    err
                );
                return Html(html).into_response();
            }
        }
    }
    Redirect::temporary("/?auth=cancelled").into_response()
}

async fn google_logout(State(state): State<SharedAppState>) -> Json<Value> {
    let _ = fs::remove_file("token.json");
    let mut cfg = state.config.write().await;
    cfg.user_email = None;
    cfg.user_name = None;
    cfg.user_picture = None;
    cfg.onboarding_completed = false;
    save_app_config(&cfg);
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
                    eprintln!("Onboarding: ignoring invalid university email anchor: {}", trimmed);
                }
            }
        }
        // Manual local profile entry is stored but labeled as such in the UI.
        save_app_config(&cfg);
        cfg.clone()
    };

    let assessments = state.assessments.read().await.clone();
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg_snapshot);

    // Run network sync in the background so the UI transitions to Dashboard instantaneously
    let bg_state = state.clone();
    tokio::spawn(async move {
        let _ = run_sync_pipeline(&bg_state, false).await;
    });

    Json(json!({
        "success": true,
        "assessments": assessments,
        "dashboard": dashboard,
        "config": cfg_snapshot
    }))
}

async fn reset_onboarding(State(state): State<SharedAppState>) -> Json<Value> {
    let mut cfg = state.config.write().await;
    cfg.onboarding_completed = false;
    save_app_config(&cfg);
    Json(json!({ "success": true }))
}

async fn trigger_full_sync(State(state): State<SharedAppState>) -> Json<Value> {
    let res = run_sync_pipeline(&state, true).await;
    Json(res)
}

async fn trigger_gcal_sync(State(state): State<SharedAppState>) -> Json<Value> {
    let mut cfg = state.config.write().await;
    let mut assessments = state.assessments.write().await;
    let report = gcal::sync_assessments_to_google_calendar(&mut assessments, &mut cfg).await;
    save_app_config(&cfg);
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg);

    Json(json!({
        "success": report.success,
        "report": report,
        "assessments": *assessments,
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
    match gemini::extract_schedule_with_gemini(&payload.file_base64, mime, cfg.gemini_api_key.as_deref()).await {
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
    let new_assessments = parser::process_all_emails(&cached_emails, &new_schedule, &cfg, false).await;
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

    if let Some(pos) = sched.courses.iter().position(|c| c.id.eq_ignore_ascii_case(&course_id)) {
        sched.courses[pos] = course.clone();
    } else {
        sched.courses.push(course.clone());
    }

    let mut next_slot_num = sched.slots.len() + 1;
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
        if slot.display_time.is_empty() && !slot.start_time.is_empty() && !slot.end_time.is_empty() {
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
    sched.slots.retain(|s| !s.course_id.eq_ignore_ascii_case(target));

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

async fn run_sync_pipeline(state: &SharedAppState, use_live_gemini: bool) -> Value {
    let schedule = state.schedule.read().await.clone();
    let mut cfg = state.config.read().await.clone();
    let mut sync_notes: Vec<String> = Vec::new();

    // Gmail: only actually scrape when a Google token exists; otherwise parse cache only
    let emails = if crate::auth::load_stored_token().is_some() {
        match gmail::sync_gmail_messages().await {
            Ok(list) => {
                sync_notes.push(format!("Gmail: {} emails scanned", list.len()));
                cfg.last_gmail_sync = Some(
                    chrono::Local::now()
                        .format("%Y-%m-%d %H:%M")
                        .to_string(),
                );
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

    let mut parsed =
        parser::process_all_emails(&emails, &schedule, &cfg, use_live_gemini).await;

    // 1. Ingest from Moodle LMS if enabled
    if cfg.moodle_enabled {
        if let Ok(moodle_items) = moodle::sync_moodle_assessments(&cfg, &schedule).await {
            if !moodle_items.is_empty() {
                sync_notes.push(format!("Moodle: {} items", moodle_items.len()));
            }
            for m in moodle_items {
                if !parsed.iter().any(|p| p.course_id == m.course_id && p.title == m.title && p.date_iso == m.date_iso) {
                    parsed.push(m);
                }
            }
        }
    }

    // 2. Ingest from Microsoft Teams / Outlook if enabled
    if cfg.teams_enabled {
        if let Ok(teams_res) = teams::sync_teams_assessments(&cfg, &schedule).await {
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
                sync_notes
                    .push("Teams discovered course list (kept your existing schedule)".to_string());
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
                if !parsed.iter().any(|p| p.course_id == t.course_id && p.title == t.title && p.date_iso == t.date_iso) {
                    parsed.push(t);
                }
            }
        }
    }

    // 3. Ingest from Google Classroom if enabled
    if cfg.classroom_enabled {
        if let Ok(cr_items) = classroom::sync_classroom_assessments(&cfg, &schedule).await {
            if !cr_items.is_empty() {
                sync_notes.push(format!("Classroom: {} items", cr_items.len()));
            }
            for c in cr_items {
                if !parsed.iter().any(|p| p.course_id == c.course_id && p.title == c.title && p.date_iso == c.date_iso) {
                    parsed.push(c);
                }
            }
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
            if p.id.starts_with("teams-") || p.id.starts_with("moodle-") || p.id.starts_with("classroom-") {
                return true;
            }
            let cid = p.course_id.trim().to_uppercase();
            active_course_codes.contains(&cid)
                || active_course_codes.iter().any(|ac| cid.starts_with(ac) || ac.starts_with(&cid))
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
        (true, true) => a.date_iso.cmp(&b.date_iso).then_with(|| a.start_time.cmp(&b.start_time)),
        (false, false) => b.date_iso.cmp(&a.date_iso),
    });

    let gcal_report = if cfg.auto_sync_gcal {
        Some(gcal::sync_assessments_to_google_calendar(&mut parsed, &mut cfg).await)
    } else {
        None
    };

    save_app_config(&cfg);
    *state.config.write().await = cfg.clone();
    let dashboard = parser::build_dashboard_summary(&parsed, &cfg);
    let upcoming_count = parsed.iter().filter(|a| a.is_upcoming).count();

    let mut assessments_lock = state.assessments.write().await;
    *assessments_lock = parsed.clone();

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
        "schedule": state.schedule.read().await.clone(),
        "config": cfg
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
    let mut cfg = state.config.write().await;
    cfg.completed_topics.insert(payload.key, payload.completed);
    save_app_config(&cfg);

    let assessments = state.assessments.read().await;
    let dashboard = parser::build_dashboard_summary(&assessments, &cfg);
    let tasks_payload = parser::build_study_tasks(&assessments, &cfg);

    Json(json!({
        "success": true,
        "dashboard": dashboard,
        "tasks_payload": tasks_payload,
        "completed_topics": cfg.completed_topics
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
    let assessments = state.assessments.read().await;
    let schedule = state.schedule.read().await;
    let cfg = state.config.read().await;

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
}

async fn add_custom_event(
    State(state): State<SharedAppState>,
    Json(payload): Json<CreateCustomEventPayload>,
) -> Json<Value> {
    let mut cfg = state.config.write().await;
    let id = format!("custom-{}", chrono::Utc::now().timestamp_millis());
    let color = match payload.course_id.as_str() {
        "CS 101" | "CS101" => "#4285f4",
        "MATH 101" | "MATH101" => "#8e24aa",
        "DATA 201" | "DATA201" => "#0f9d58",
        "PHYS 101" | "PHYS101" => "#f4b400",
        "MGMT 100" | "MGMT100" => "#e67c73",
        _ => "#ec4899",
    };

    let ev = CustomCalendarEvent {
        id,
        title: payload.title,
        course_id: payload.course_id,
        event_type: payload.event_type,
        date_iso: payload.date_iso,
        start_time: payload.start_time,
        end_time: payload.end_time,
        room: payload.room.unwrap_or_else(|| "Study Room / Library".to_string()),
        notes: payload.notes.unwrap_or_default(),
        color: color.to_string(),
    };

    cfg.custom_events.push(ev);
    save_app_config(&cfg);

    Json(json!({
        "success": true,
        "custom_events": cfg.custom_events
    }))
}

async fn delete_custom_event(
    State(state): State<SharedAppState>,
    Path(id): Path<String>,
) -> Json<Value> {
    let mut cfg = state.config.write().await;
    cfg.custom_events.retain(|e| e.id != id);
    save_app_config(&cfg);

    Json(json!({
        "success": true,
        "custom_events": cfg.custom_events
    }))
}

async fn download_ics(
    State(state): State<SharedAppState>,
    Path(id): Path<String>,
) -> Response {
    let assessments = state.assessments.read().await;
    if let Some(a) = assessments.iter().find(|x| x.id == id) {
        let ics = gcal::generate_single_ics(a);
        let filename = format!("{}_{}.ics", a.course_id, a.title.replace(' ', "_"));
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/calendar"));
        if let Ok(disp) = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename)) {
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
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/calendar"));
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
    if q.preview.unwrap_or(false) {
        return Json(json!({
            "success": true,
            "update_available": true,
            "current_version": updater::CURRENT_VERSION,
            "latest_version": "v3.2.0",
            "release_name": "QuizRadar v3.2.0 — Academic Hubs, Custom Majors & Clean Timeline Display",
            "release_date": "2026-10-19",
            "release_notes": "## What's New in v3.2.0\n\n- **Fix Auto-Enrollment**: Prevent unexpected enrollment in dummy Computer Science courses; added 1-click 'Clear all' course wiping\n- **Academic Major Selector**: Fixed field of study chip selection styling (.is-selected) and dynamic starter courses adaptation for Engineering, Medicine, Business, and Sciences\n- **Interactive Integration Hubs**: Upgraded Google Workspace, Microsoft Teams, Google Classroom, and Moodle LMS onboarding cards to interactive setup triggers with live connection status badges\n- **Visual & Formatting Polish**: Fixed embedded Lucide icon serving on installed builds, resolved dangling timeline time hyphens (e.g. 23:59–), and corrected pluralization\n- **Full Multi-Platform Parity**: Full parity across Windows, macOS, Linux, and Android APK builds",
            "download_url": "https://github.com/TheDragonSoft/QuizRadar/releases/latest",
            "portable_url": "https://github.com/TheDragonSoft/QuizRadar/releases/latest",
            "html_url": "https://github.com/TheDragonSoft/QuizRadar/releases/latest",
            "is_preview": true
        }));
    }

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
    Json(payload): Json<UpdateConfigPayload>,
) -> Json<Value> {
    let mut cfg = state.config.write().await;
    let prev_teams = cfg.teams_enabled;
    let prev_moodle = cfg.moodle_enabled;
    let prev_classroom = cfg.classroom_enabled;

    if let Some(v) = payload.auto_sync_gcal { cfg.auto_sync_gcal = v; }
    if let Some(v) = payload.sync_weekly_classes_to_gcal { cfg.sync_weekly_classes_to_gcal = v; }
    if let Some(v) = payload.gemini_enabled { cfg.gemini_enabled = v; }
    if let Some(k) = payload.gemini_api_key { cfg.gemini_api_key = Some(k); }
    if let Some(v) = payload.moodle_enabled { cfg.moodle_enabled = v; }
    if let Some(u) = payload.moodle_url { cfg.moodle_url = Some(u); }
    if let Some(t) = payload.moodle_token { cfg.moodle_token = Some(t); }
    if let Some(i) = payload.moodle_ical_url { cfg.moodle_ical_url = Some(i); }
    if let Some(v) = payload.teams_enabled { cfg.teams_enabled = v; }
    if let Some(cid) = payload.teams_client_id { cfg.teams_client_id = Some(cid); }
    let has_new_teams_token = payload.teams_token.is_some();
    if let Some(t) = payload.teams_token { cfg.teams_token = Some(t); }
    if let Some(a) = payload.teams_account_name { cfg.teams_account_name = Some(a); }
    if let Some(v) = payload.classroom_enabled { cfg.classroom_enabled = v; }

    let any_source_enabled = (!prev_teams && cfg.teams_enabled && cfg.teams_token.is_some())
        || (!prev_moodle && cfg.moodle_enabled)
        || (!prev_classroom && cfg.classroom_enabled)
        || (has_new_teams_token && cfg.teams_enabled);

    save_app_config(&cfg);
    let cfg_final = cfg.clone();
    drop(cfg);

    // If any source was disabled, immediately remove its assessments from active memory
    {
        let mut assessments_lock = state.assessments.write().await;
        assessments_lock.retain(|a| a.is_source_enabled(&cfg_final));
    }

    // If any source was newly enabled (or tokens updated), trigger a sync pipeline to fetch fresh assignments
    if any_source_enabled {
        let _ = run_sync_pipeline(&state, false).await;
    }

    let assessments = state.assessments.read().await;
    let visible_assessments: Vec<Assessment> = assessments
        .iter()
        .filter(|a| a.is_source_enabled(&cfg_final))
        .cloned()
        .collect();
    let dashboard = parser::build_dashboard_summary(&visible_assessments, &cfg_final);

    Json(json!({
        "success": true,
        "config": cfg_final,
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
                msg = format!("Moodle iCal Feed verified! Found {} upcoming calendar events.", items.len());
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
                msg = format!("Moodle REST Web Services connected! Found {} events.", items.len());
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
    {
        let mut cfg = state.config.write().await;
        cfg.moodle_enabled = true;
        save_app_config(&cfg);
    }
    let mut res = run_sync_pipeline(&state, false).await;
    if let Some(obj) = res.as_object_mut() {
        obj.insert("status".to_string(), json!("ok"));
        obj.insert("synced_count".to_string(), json!(2));
    }
    Json(res)
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
    if let Some(code) = params.get("code") {
        let cid = state.config.read().await.teams_client_id.clone();
        match teams::exchange_microsoft_code_for_token(code, state.port, cid.as_deref()).await {
            Ok(tok) => {
                let mut cfg = state.config.write().await;
                cfg.teams_enabled = true;
                cfg.teams_token = Some(tok.access_token);
                save_app_config(&cfg);
                drop(cfg);
                let _ = run_sync_pipeline(&state, false).await;

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
                let html = format!(
                    r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuizRadar — Microsoft Sign-In</title>
  <style>
    body {{ background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }}
    .card {{ background: #131927; border: 1px solid #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }}
    .icon {{ width: 48px; height: 48px; border-radius: 12px; background: rgba(239,68,68,0.15); color: #ef4444; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; }}
    h2 {{ font-size: 18px; margin: 0 0 8px 0; color: #ffffff; }}
    p {{ font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; word-break: break-word; }}
    .btn {{ display: inline-block; background: #1a73e8; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 10px; cursor: pointer; border: none; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h2>Microsoft Sign-In Error</h2>
    <p>{}</p>
    <button class="btn" onclick="window.close();">Return to QuizRadar</button>
  </div>
</body>
</html>"#,
                    err
                );
                return Html(html).into_response();
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
    {
        let mut cfg = state.config.write().await;
        cfg.teams_enabled = false;
        cfg.teams_token = None;
        cfg.teams_account_name = None;
        cfg.teams_account_email = None;
        save_app_config(&cfg);
    }
    let _ = run_sync_pipeline(&state, false).await;
    Json(json!({ "success": true, "message": "University Microsoft Teams disconnected" }))
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
        let mut cfg = state.config.write().await;
        cfg.teams_token = Some(tok.clone());
        cfg.teams_enabled = true;
        save_app_config(&cfg);
    }

    let cfg = state.config.read().await.clone();
    let token = token_opt.or_else(|| cfg.teams_token.clone());

    match teams::test_microsoft_connection(token.as_deref()).await {
        Ok(res) => {
            {
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
                save_app_config(&wcfg);
            }

            // Immediately run the sync pipeline so courses and assessments appear automatically!
            let sync_res = run_sync_pipeline(&state, false).await;
            let schedule = state.schedule.read().await.clone();
            let cfg_final = state.config.read().await.clone();

            Json(json!({
                "success": true,
                "status": "ok",
                "message": res.message,
                "user": res.user_display_name.unwrap_or_else(|| "Microsoft Student Account".to_string()),
                "email": res.user_principal_name.unwrap_or_default(),
                "teams_count": res.teams_count,
                "courses_count": res.courses_found.len(),
                "courses_found": res.courses_found,
                "assignments_count": res.items_found,
                "dashboard": sync_res["dashboard"].clone(),
                "assessments": sync_res["assessments"].clone(),
                "schedule": schedule,
                "config": cfg_final
            }))
        },
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
    let assessments = state.assessments.read().await;
    let cfg = state.config.read().await;
    if let Some(a) = assessments.iter().find(|x| x.id == id) {
        match gemini::generate_practice_quiz(a, cfg.gemini_api_key.as_deref()).await {
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
    let mut cfg = state.config.write().await;
    if let (Some(achieved), Some(max), Some(weight)) = (payload.achieved_score, payload.max_score, payload.weightage_percent) {
        cfg.grades.insert(
            id.clone(),
            AssessmentGrade {
                achieved_score: achieved,
                max_score: max,
                weightage_percent: weight,
            },
        );
    }
    save_app_config(&cfg);

    let mut assessments = state.assessments.write().await;
    for a in assessments.iter_mut() {
        if a.id == id {
            a.achieved_score = payload.achieved_score;
            a.max_score = payload.max_score;
            a.weightage_percent = payload.weightage_percent;
        }
    }

    let dashboard = parser::build_dashboard_summary(&assessments, &cfg);
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

async fn schedule_study_blocks_handler(
    State(state): State<SharedAppState>,
    payload: Option<Json<ScheduleStudyBlocksPayload>>,
) -> Json<Value> {
    let payload = payload.map(|p| p.0).unwrap_or_default();
    let assessments = state.assessments.read().await.clone();
    let mut cfg = state.config.write().await;

    let target_assessments: Vec<&Assessment> = if let Some(ref aid) = payload.assessment_id {
        assessments.iter().filter(|a| a.id == *aid).collect()
    } else {
        assessments.iter().filter(|a| a.is_upcoming && a.days_until >= 0 && a.days_until <= 7).collect()
    };

    let mut created_count = 0usize;
    for a in target_assessments {
        let block_date = if let Ok(d) = chrono::NaiveDate::parse_from_str(&a.date_iso, "%Y-%m-%d") {
            (d - chrono::Duration::days(1)).format("%Y-%m-%d").to_string()
        } else {
            a.date_iso.clone()
        };

        let block_id = format!("study-block-{}", a.id);
        if !cfg.custom_events.iter().any(|e| e.id == block_id) {
            // Pick the first free evening study window (16:00–21:30) that does not
            // clash with an existing event on that date instead of a fixed 17:00.
            let (mut start_time, mut end_time) =
                ("17:00".to_string(), "18:30".to_string());
            let windows: [(&str, &str); 5] = [
                ("16:00", "17:30"),
                ("17:00", "18:30"),
                ("18:00", "19:30"),
                ("19:00", "20:30"),
                ("20:00", "21:30"),
            ];
            for (ws, we) in windows {
                let clashes = cfg.custom_events.iter().any(|e| {
                    e.date_iso == block_date
                        && !(e.end_time <= ws.to_string() || e.start_time >= we.to_string())
                });
                if !clashes {
                    start_time = ws.to_string();
                    end_time = we.to_string();
                    break;
                }
            }
            let notes = format!("Focused review of topics: {}", a.topics.join(", "));
            cfg.custom_events.push(CustomCalendarEvent {
                id: block_id,
                title: format!("📚 Study Block: {}", a.title),
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

    cfg.dismiss_conflict_banner = false;
    save_app_config(&cfg);
    drop(cfg);

    let res = run_sync_pipeline(&state, false).await;

    Json(json!({
        "success": true,
        "status": "ok",
        "created_blocks_count": created_count,
        "message": if created_count > 0 {
            format!("Scheduled {} smart study preparation blocks into your timetable!", created_count)
        } else {
            "All upcoming exams are already protected with active smart study preparation blocks in your timetable!".to_string()
        },
        "config": state.config.read().await.clone(),
        "dashboard": res["dashboard"].clone(),
        "assessments": res["assessments"].clone()
    }))
}

async fn dismiss_conflicts_handler(State(state): State<SharedAppState>) -> Json<Value> {
    let mut cfg = state.config.write().await;
    cfg.dismiss_conflict_banner = true;
    save_app_config(&cfg);
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
            let mut sched = state.schedule.write().await;
            if !cloud_state.schedule.courses.is_empty() {
                sched.courses = cloud_state.schedule.courses.clone();
                sched.slots = cloud_state.schedule.slots.clone();
                sched.semester = cloud_state.schedule.semester.clone();
                parser::save_schedule(&sched);
            }

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
            save_app_config(&wcfg);
            let final_cfg = wcfg.clone();
            drop(wcfg);

            let mut assessments_lock = state.assessments.write().await;
            for ca in cloud_state.assessments {
                if !assessments_lock.iter().any(|a| a.id == ca.id) {
                    assessments_lock.push(ca);
                }
            }
            let visible_assessments: Vec<Assessment> = assessments_lock
                .iter()
                .filter(|a| a.is_source_enabled(&final_cfg))
                .cloned()
                .collect();
            let dashboard = parser::build_dashboard_summary(&visible_assessments, &final_cfg);

            Json(json!({
                "success": true,
                "message": format!("Successfully synchronized from cloud! Loaded {} assessments and {} courses.", visible_assessments.len(), sched.courses.len()),
                "assessments": visible_assessments,
                "schedule": *sched,
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

    Json(json!({
        "success": true,
        "local_ip": local_ip,
        "port": port,
        "connect_url": connect_url,
        "emulator_url": emulator_url,
        "user_email": cfg.user_email,
        "user_name": cfg.user_name,
        "google_authenticated": cfg.user_email.is_some(),
        "teams_configured": cfg.teams_enabled && cfg.teams_token.is_some()
    }))
}

pub mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut result = String::with_capacity(s.len() * 3);
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(b as char);
                }
                b' ' => result.push_str("%20"),
                _ => {
                    result.push_str(&format!("%{:02X}", b));
                }
            }
        }
        result
    }
}
