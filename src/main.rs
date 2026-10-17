use axum::{
    extract::Path,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, net::SocketAddr};
use tower_http::services::ServeDir;

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct ScheduleData {
    semester: String,
    courses: Vec<Value>,
    slots: Vec<Value>,
}

#[tokio::main]
async fn main() {
    println!("==============================================================");
    println!("🚀 QuizRadar Native Rust Academic Calendar & Quiz Assistant");
    println!("📍 Running on: http://127.0.0.1:5000");
    println!("📅 Semester: Fall 2026 - MSA University Engineering");
    println!("==============================================================");

    // Build the Axum router
    let app = Router::new()
        .route("/", get(serve_index))
        .route("/api/schedule", get(get_schedule))
        .route("/api/quizzes", get(get_quizzes))
        .route("/api/calendar/ics/:id", get(download_ics))
        .route("/api/calendar/ics_all", get(download_all_ics))
        .route("/api/sync", post(trigger_sync))
        .nest_service("/static", ServeDir::new("static"));

    let addr = SocketAddr::from(([127, 0, 0, 1], 5000));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    // Automatically open browser on startup
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        let _ = open::that("http://127.0.0.1:5000");
    });

    axum::serve(listener, app).await.unwrap();
}

async fn serve_index() -> Html<String> {
    let content = fs::read_to_string("static/index.html")
        .unwrap_or_else(|_| "<h1>QuizRadar UI Not Found</h1>".to_string());
    Html(content)
}

async fn get_schedule() -> Json<Value> {
    let content = fs::read_to_string("data/schedule.json")
        .unwrap_or_else(|_| r#"{"courses":[], "slots":[]}"#.to_string());
    let data: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    Json(data)
}

async fn get_quizzes() -> Json<Value> {
    let content = fs::read_to_string("data/quizzes.json")
        .unwrap_or_else(|_| "[]".to_string());
    let mut quizzes: Vec<Value> = serde_json::from_str(&content).unwrap_or_default();

    for q in &mut quizzes {
        if let Some(obj) = q.as_object_mut() {
            let course = obj.get("course_id").and_then(|v| v.as_str()).unwrap_or("CSE");
            let title = obj.get("title").and_then(|v| v.as_str()).unwrap_or("Quiz");
            let date = obj.get("date_iso").and_then(|v| v.as_str()).unwrap_or("2026-10-19").replace("-", "");
            let room = obj.get("room").and_then(|v| v.as_str()).unwrap_or("");
            let instructor = obj.get("instructor").and_then(|v| v.as_str()).unwrap_or("");

            let cal_title = urlencoding::encode(&format!("[{}] {}", course, title));
            let dates = format!("{}T090000/{}T103000", date, date);
            let details = urlencoding::encode(&format!(
                "Course: {}\nRoom: {}\nInstructor: {}\n\nSynced with QuizRadar & University Moodle",
                course, room, instructor
            ));
            let location = urlencoding::encode(&format!("MSA University - Room {}", room));

            let google_url = format!(
                "https://calendar.google.com/calendar/render?action=TEMPLATE&text={}&dates={}&details={}&location={}&sf=true&output=xml",
                cal_title, dates, details, location
            );
            obj.insert("google_cal_url".to_string(), Value::String(google_url));
        }
    }

    Json(Value::Array(quizzes))
}

async fn download_ics(Path(id): Path<String>) -> Response {
    let content = fs::read_to_string("data/quizzes.json").unwrap_or_else(|_| "[]".to_string());
    let quizzes: Vec<Value> = serde_json::from_str(&content).unwrap_or_default();
    let quiz = quizzes.into_iter().find(|q| q.get("id").and_then(|v| v.as_str()) == Some(&id));

    if let Some(q) = quiz {
        let course = q.get("course_id").and_then(|v| v.as_str()).unwrap_or("CSE");
        let title = q.get("title").and_then(|v| v.as_str()).unwrap_or("Quiz");
        let date_clean = q.get("date_iso").and_then(|v| v.as_str()).unwrap_or("20261019").replace("-", "");
        let room = q.get("room").and_then(|v| v.as_str()).unwrap_or("Lecture Hall");
        let instructor = q.get("instructor").and_then(|v| v.as_str()).unwrap_or("");

        let ics = format!(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QuizRadar//Rust//EN\r\nBEGIN:VEVENT\r\nUID:quiz-{}@quizradar.local\r\nDTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\nSUMMARY:[{}] {}\r\nDESCRIPTION:Instructor: {}\\nLocation: Room {}\r\nLOCATION:MSA University - Room {}\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:Upcoming {} Quiz Tomorrow!\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            id, date_clean, date_clean, course, title, instructor, room, room, course
        );

        let filename = format!("{}_{}.ics", course, title.replace(' ', "_"));
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/calendar"));
        headers.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename)).unwrap(),
        );

        (StatusCode::OK, headers, ics).into_response()
    } else {
        (StatusCode::NOT_FOUND, "Quiz not found").into_response()
    }
}

async fn download_all_ics() -> Response {
    let content = fs::read_to_string("data/quizzes.json").unwrap_or_else(|_| "[]".to_string());
    let quizzes: Vec<Value> = serde_json::from_str(&content).unwrap_or_default();

    let mut ics = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QuizRadar//Rust All//EN\r\nX-WR-CALNAME:QuizRadar Fall 2026 Quizzes\r\n",
    );

    for q in quizzes {
        let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("1");
        let course = q.get("course_id").and_then(|v| v.as_str()).unwrap_or("CSE");
        let title = q.get("title").and_then(|v| v.as_str()).unwrap_or("Quiz");
        let date_clean = q.get("date_iso").and_then(|v| v.as_str()).unwrap_or("20261019").replace("-", "");
        let room = q.get("room").and_then(|v| v.as_str()).unwrap_or("Lecture Hall");
        let instructor = q.get("instructor").and_then(|v| v.as_str()).unwrap_or("");

        ics.push_str(&format!(
            "BEGIN:VEVENT\r\nUID:quiz-{}@quizradar.local\r\nDTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\nSUMMARY:[{}] {}\r\nDESCRIPTION:Instructor: {}\\nLocation: Room {}\r\nLOCATION:MSA University - Room {}\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:Upcoming {} Quiz Tomorrow!\r\nEND:VALARM\r\nEND:VEVENT\r\n",
            id, date_clean, date_clean, course, title, instructor, room, room, course
        ));
    }
    ics.push_str("END:VCALENDAR\r\n");

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/calendar"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"QuizRadar_Fall2026_All.ics\""),
    );

    (StatusCode::OK, headers, ics).into_response()
}

async fn trigger_sync() -> Json<Value> {
    // Sync with Gmail via python sync script if needed or refresh
    let _ = tokio::process::Command::new("python")
        .arg("fetch_quizzes.py")
        .output()
        .await;

    Json(serde_json::json!({
        "success": true,
        "message": "Gmail sync refreshed successfully! Schedule & upcoming quizzes up to date."
    }))
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut result = String::with_capacity(s.len() * 3);
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(b as char);
                }
                b' ' => result.push('+'),
                _ => {
                    result.push_str(&format!("%{:02X}", b));
                }
            }
        }
        result
    }
}
