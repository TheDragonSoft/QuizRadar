#![windows_subsystem = "windows"]

pub mod auth;
pub mod gcal;
pub mod gemini;
pub mod gmail;
pub mod models;
pub mod parser;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{delete, get, post},
    Json, Router,
};
use models::{AppConfig, Assessment, CustomCalendarEvent, ScheduleData};
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
    if !std::path::Path::new("Cargo.toml").exists() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let _ = std::env::set_current_dir(exe_dir);
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

    let app_url = format!("http://127.0.0.1:{}", port);

    let _webview = WebViewBuilder::new()
        .with_url(&app_url)
        .with_user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .with_new_window_req_handler(|url| {
            let _ = open::that(&url);
            false
        })
        .build(&window)
        .expect("Failed to initialize native WebView");

    event_loop.run(move |event, _, control_flow| {
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
    let ports = [5000, 5050, 3000, 8080, 5150, 5250, 0];
    let mut selected_port = 5000;
    let mut listener = None;

    for port in ports {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
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

    let initial_assessments =
        parser::process_all_emails(&cached_emails, &schedule, &config, false).await;

    let state = SharedAppState {
        port: selected_port,
        config: Arc::new(RwLock::new(config)),
        schedule: Arc::new(RwLock::new(schedule)),
        assessments: Arc::new(RwLock::new(initial_assessments)),
    };

    // Refresh Google authentication profile in the background so startup is 0ms
    let bg_state = state.clone();
    tokio::spawn(async move {
        let profile = auth::fetch_user_profile().await;
        if profile.authenticated {
            let mut cfg = bg_state.config.write().await;
            cfg.user_email = profile.email.clone();
            cfg.user_name = profile.name.clone();
            cfg.user_picture = profile.picture.clone();
            if cfg.last_gmail_sync.is_none() {
                cfg.last_gmail_sync = Some("2026-10-17 19:35".to_string());
            }
            save_app_config(&cfg);
        }
    });

    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/state", get(get_full_state))
        .route("/api/status", get(get_legacy_status))
        .route("/api/schedule", get(get_schedule))
        .route("/api/quizzes", get(get_quizzes))
        .route("/api/auth/google/login", get(google_login_redirect))
        .route("/api/auth/google/url", get(google_login_url))
        .route("/api/auth/callback", get(google_oauth_callback))
        .route("/api/auth/logout", post(google_logout))
        .route("/api/onboarding/complete", post(complete_onboarding))
        .route("/api/onboarding/reset", post(reset_onboarding))
        .route("/api/sync", post(trigger_full_sync))
        .route("/api/gcal/sync", post(trigger_gcal_sync))
        .route("/api/study/toggle", post(toggle_study_topic))
        .route("/api/events/custom", post(add_custom_event))
        .route("/api/events/custom/:id", delete(delete_custom_event))
        .route("/api/calendar/ics/:id", get(download_ics))
        .route("/api/calendar/ics_all", get(download_all_ics))
        .route("/static/app.js", get(serve_app_js))
        .route("/static/icon.svg", get(serve_icon_svg))
        .nest_service("/static", ServeDir::new("static"))
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

async fn get_full_state(State(state): State<SharedAppState>) -> Json<Value> {
    let cfg = state.config.read().await.clone();
    let profile = auth::get_cached_user_profile(&cfg);
    let schedule = state.schedule.read().await.clone();
    let assessments = state.assessments.read().await.clone();
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
    let upcoming_count = assessments.iter().filter(|a| a.is_upcoming).count();

    Json(json!({
        "authenticated": profile.authenticated,
        "email": profile.email.or_else(|| cfg.user_email.clone()).unwrap_or_else(|| "Not signed in".to_string()),
        "total_quizzes": assessments.len(),
        "upcoming_count": upcoming_count,
        "last_sync": cfg.last_gmail_sync.clone().unwrap_or_else(|| "Never".to_string())
    }))
}

async fn get_schedule(State(state): State<SharedAppState>) -> Json<ScheduleData> {
    let schedule = state.schedule.read().await.clone();
    Json(schedule)
}

async fn get_quizzes(State(state): State<SharedAppState>) -> Json<Vec<Assessment>> {
    let assessments = state.assessments.read().await.clone();
    Json(assessments)
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
                    "<h2>Google Sign-In Error</h2><p>{}</p><p><a href=\"/\">Return to QuizRadar</a></p>",
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

async fn run_sync_pipeline(state: &SharedAppState, use_live_gemini: bool) -> Value {
    let emails = match gmail::sync_gmail_messages().await {
        Ok(list) => list,
        Err(_) => gmail::load_cached_emails(),
    };

    let schedule = state.schedule.read().await.clone();
    let mut cfg = state.config.write().await;
    cfg.last_gmail_sync = Some(
        chrono::Local::now()
            .format("%Y-%m-%d %H:%M")
            .to_string(),
    );

    let mut parsed =
        parser::process_all_emails(&emails, &schedule, &cfg, use_live_gemini).await;

    let gcal_report = if cfg.auto_sync_gcal {
        Some(gcal::sync_assessments_to_google_calendar(&mut parsed, &mut cfg).await)
    } else {
        None
    };

    save_app_config(&cfg);
    let dashboard = parser::build_dashboard_summary(&parsed, &cfg);
    let upcoming_count = parsed.iter().filter(|a| a.is_upcoming).count();

    let mut assessments_lock = state.assessments.write().await;
    *assessments_lock = parsed.clone();

    json!({
        "success": true,
        "message": format!(
            "Scanned {} university emails with Gemini Schedule Reasoning! Found {} upcoming exams & quizzes.",
            emails.len(),
            upcoming_count
        ),
        "gcal_report": gcal_report,
        "assessments": parsed,
        "dashboard": dashboard,
        "config": *cfg
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

    Json(json!({
        "success": true,
        "dashboard": dashboard,
        "completed_topics": cfg.completed_topics
    }))
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
        "GSE211" => "#4285f4",
        "CSE263" => "#8e24aa",
        "CSE261" => "#0f9d58",
        "CSE252" => "#f4b400",
        "CSE241" => "#e67c73",
        "CSE262" => "#00acc1",
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
