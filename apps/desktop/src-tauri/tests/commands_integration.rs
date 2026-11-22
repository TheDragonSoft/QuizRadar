//! Integration tests for desktop IPC commands (`AGENTS.md` §7, prompt 07 §4).
//!
//! Tests command logic against in-memory store, verifying:
//! - `get_state` honest against empty DB
//! - grade partial-update with explicit-null-clears semantics
//! - topic toggle round-trip
//! - sync orchestrator command with fixture transport
//! - keyring round-trip (feature-guarded for headless CI)

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;
use std::sync::Mutex;

use quizradar_core::plan::dashboard::topic_key_for_text;
use quizradar_core::sources::SourceProgress;
use quizradar_core::store::repo::{FieldUpdate, GradeChange};
use quizradar_core::store::Store;
use quizradar_core::types::{
    Assessment, AssessmentSource, AssessmentType, Course, ScheduleData, ScheduleSlot, UrgencyLevel,
};
use quizradar_desktop_lib::commands::ai::{
    ai_quota_usage_inner, extract_announcement_media_with_base_url, extract_syllabi_with_base_url,
    parse_shared_announcement_inner, practice_generate_inner, SyllabusDocumentInput,
};
use quizradar_desktop_lib::commands::state::{apply_course_bundle_inner, build_full_state};
use quizradar_desktop_lib::commands::sync::{
    export_course_pack_inner, import_course_pack_inner, run_sync_inner, SCAN_CANCELED_MESSAGE,
};
use quizradar_desktop_lib::keyring::KeyringStore;
use quizradar_desktop_lib::state::AppState;
use wiremock::matchers::{header, header_exists, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Creates a test AppState with an in-memory SQLite store and unique test keyring service.
async fn test_app_state(test_name: &str) -> AppState {
    let store = Store::open_in_memory()
        .await
        .expect("in-memory store must open cleanly");
    let keyring = KeyringStore::with_service(&format!("com.quizradar.test.{test_name}"));
    AppState::new(store, keyring)
}

fn sample_test_assessment(
    id: &str,
    title: &str,
    course_id: Option<&str>,
    assessment_type: AssessmentType,
    date: Option<chrono::NaiveDate>,
    topics: Vec<String>,
) -> Assessment {
    Assessment {
        id: id.to_string(),
        course_id: course_id.map(|s| s.to_string()),
        course_name: None,
        title: title.to_string(),
        assessment_type,
        date,
        day_name: None,
        start_time: None,
        end_time: None,
        display_time: None,
        room: None,
        group: None,
        instructor: None,
        is_upcoming: true,
        days_until: Some(10),
        urgency_level: UrgencyLevel::Upcoming,
        priority_score: 20,
        topics,
        warnings: Vec::new(),
        ai_inference_note: None,
        ai_study_plan: None,
        estimated_study_hours: None,
        elearning_url: None,
        google_cal_url: None,
        gcal_synced: false,
        gcal_event_id: None,
        color: None,
        bg: None,
        border: None,
        semester: None,
        email_subject: None,
        email_sent_date: None,
        source: AssessmentSource::Custom,
        source_icon: None,
        weightage_percent: None,
        achieved_score: None,
        max_score: None,
        conflict_warning: None,
        last_seen_source_run: None,
        retired_source_run: None,
    }
}

#[tokio::test]
async fn test_get_state_honest_against_empty_db() {
    let state = test_app_state("empty_db").await;
    let payload = build_full_state(&state)
        .await
        .expect("get_state on empty store must succeed");

    // Honesty assertions
    assert!(
        !payload.auth.authenticated,
        "empty store must not claim authentication"
    );
    assert!(!payload.auth.has_gmail_scope);
    assert!(!payload.auth.has_calendar_scope);
    assert!(!payload.auth.has_teams_auth);

    // v5 honesty: auto_sync_gcal is default false
    assert!(!payload.config.auto_sync_gcal);
    assert!(payload.schedule.courses.is_empty());
    assert!(payload.schedule.slots.is_empty());
    assert!(payload.assessments.is_empty());

    // Dashboard: empty assessments = 100% readiness (v4/v5 spec), 0 upcoming
    assert_eq!(payload.dashboard.readiness_percent, 100);
    assert!(payload.dashboard.all_upcoming.is_empty());
    assert_eq!(payload.study_tasks_payload.total_tasks, 0);
    assert!(payload
        .study_tasks_payload
        .days
        .iter()
        .all(|d| d.tasks.is_empty()));
}

#[tokio::test]
async fn test_grade_partial_update_semantics() {
    let state = test_app_state("grade_update").await;
    let today = state.today();
    let now = state.now_iso();

    // 1. Insert assessment into store
    let assessment = sample_test_assessment(
        "assess-grade-1",
        "Midterm Exam",
        Some("CS101"),
        AssessmentType::MidtermExam,
        Some(today + chrono::Duration::days(5)),
        vec!["Algorithms".to_string()],
    );
    state
        .store
        .replace_assessments(vec![assessment], now.clone(), today)
        .await
        .expect("insert assessment");

    // 2. Set achieved = 85.0, max = 100.0, weightage = 15.0
    let change = GradeChange {
        achieved_score: FieldUpdate::Set(85.0),
        max_score: FieldUpdate::Set(100.0),
        weightage_percent: FieldUpdate::Set(15.0),
    };
    state
        .store
        .update_grade("assess-grade-1".to_string(), change, now.clone(), today)
        .await
        .expect("update grade with values");

    let snapshot = state.store.load_state(today).await.unwrap();
    let grade = snapshot
        .grades
        .get("assess-grade-1")
        .expect("grade record exists");
    assert_eq!(grade.achieved_score, Some(85.0));
    assert_eq!(grade.max_score, Some(100.0));
    assert_eq!(grade.weightage_percent, Some(15.0));

    // 3. Clear achieved_score explicitly (explicit null / Clear), Keep max & weightage
    let clear_change = GradeChange {
        achieved_score: FieldUpdate::Clear,
        max_score: FieldUpdate::Keep,
        weightage_percent: FieldUpdate::Keep,
    };
    state
        .store
        .update_grade("assess-grade-1".to_string(), clear_change, now, today)
        .await
        .expect("clear achieved grade");

    let snapshot_after = state.store.load_state(today).await.unwrap();
    let grade_after = snapshot_after
        .grades
        .get("assess-grade-1")
        .expect("grade record exists");
    assert_eq!(
        grade_after.achieved_score, None,
        "cleared score must be None, never coerced to 0"
    );
    assert_eq!(grade_after.max_score, Some(100.0), "max_score was Kept");
    assert_eq!(
        grade_after.weightage_percent,
        Some(15.0),
        "weightage was Kept"
    );
}

#[tokio::test]
async fn test_topic_toggle_round_trip() {
    let state = test_app_state("topic_toggle").await;
    let today = state.today();
    let now = state.now_iso();

    let assessment = sample_test_assessment(
        "assess-topic-1",
        "Calculus Quiz",
        Some("MATH101"),
        AssessmentType::ClassQuiz,
        Some(today + chrono::Duration::days(3)),
        vec!["Limits".to_string(), "Derivatives".to_string()],
    );
    state
        .store
        .replace_assessments(vec![assessment], now.clone(), today)
        .await
        .expect("insert assessment");

    // Topic 0 of the assessment is "Limits" - the completion key is
    // content-addressed from the topic TEXT, never a positional index
    // (`01` §3), so a rescan that reorders topics cannot move the checkmark.
    let key = topic_key_for_text("assess-topic-1", "Limits");

    // Initial state: not completed
    let snapshot0 = state.store.load_state(today).await.unwrap();
    assert_eq!(snapshot0.completed_topics.get(&key).copied(), None);

    // 1. Toggle done -> true
    state
        .store
        .set_topic_done(key.clone(), true, now.clone(), today)
        .await
        .expect("set topic done");

    let snapshot1 = state.store.load_state(today).await.unwrap();
    assert_eq!(snapshot1.completed_topics.get(&key).copied(), Some(true));

    // 2. Toggle done -> false: removes the row (true rows only)
    state
        .store
        .set_topic_done(key.clone(), false, now, today)
        .await
        .expect("set topic undone");

    let snapshot2 = state.store.load_state(today).await.unwrap();
    assert_eq!(
        snapshot2.completed_topics.get(&key).copied(),
        None,
        "unchecking a topic removes the row — honesty doctrine keeps true rows only"
    );
}

#[tokio::test]
async fn test_sync_orchestrator_command_with_fixture_transport() {
    let state = test_app_state("sync_orchestrator").await;
    let today = state.today();
    let now = state.now_iso();

    // 1. First test: empty sources run honestly skips with zero fabricated theatre
    let received_progress = Arc::new(Mutex::new(Vec::<SourceProgress>::new()));
    let progress_sink = Arc::clone(&received_progress);
    let emit_fn: Arc<dyn Fn(SourceProgress) + Send + Sync> = Arc::new(move |p| {
        progress_sink.lock().unwrap().push(p);
    });

    let empty_result = run_sync_inner(Some(Arc::clone(&emit_fn)), &state)
        .await
        .expect("run_sync on empty sources must succeed");
    assert!(empty_result.success);
    assert_eq!(empty_result.total_new, 0);
    assert!(
        empty_result
            .notes
            .iter()
            .any(|n| n.contains("No sources are configured")),
        "honestly states no sources configured"
    );
    assert!(
        received_progress.lock().unwrap().is_empty(),
        "zero-enabled sources must not invent simulated progress"
    );

    // 2. Second test: configured feed streams real pulses
    use quizradar_core::types::FeedConfig;
    let feed = FeedConfig {
        id: "feed-test-1".to_string(),
        name: "Registrar".to_string(),
        url: "https://example.com/calendar.ics".to_string(),
        enabled: true,
    };
    state
        .store
        .save_feed(feed, now, today)
        .await
        .expect("save feed");

    let feed_result = run_sync_inner(Some(emit_fn), &state)
        .await
        .expect("run_sync with configured feed");

    assert!(feed_result.success);
    let pulses = received_progress.lock().unwrap();
    assert!(
        !pulses.is_empty(),
        "sync with active feed must stream real SourceProgress pulses"
    );
    assert!(
        pulses.iter().any(|p| p.name == "Calendar feeds"),
        "pulse must be from Calendar feeds"
    );
}

/// An ICS fixture dated relative to today, so the test never drifts out of
/// the parser's recency window.
fn ics_fixture(today: chrono::NaiveDate) -> String {
    let start = (today + chrono::Duration::days(7))
        .format("%Y%m%dT100000Z")
        .to_string();
    format!(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:CSE241 Quiz 3\nDTSTART:{start}\nUID:q3@registrar\nEND:VEVENT\nEND:VCALENDAR\n"
    )
}

/// Points the Moodle iCal channel at a local fixture server.
async fn configure_local_moodle_feed(
    state: &AppState,
    server: &MockServer,
    today: chrono::NaiveDate,
) {
    state
        .store
        .set_config_string(
            "moodle_ical_url".to_string(),
            Some(format!("{}/moodle.ics", server.uri())),
        )
        .await
        .expect("save the Moodle iCal url");
    state
        .store
        .set_config_bool("moodle_enabled".to_string(), true)
        .await
        .expect("enable Moodle");
    let _ = today;
}

#[tokio::test]
async fn test_scan_that_fetched_something_stamps_last_synced() {
    let state = test_app_state("sync_stamp").await;
    let today = state.today();
    let now = state.now_iso();

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_string(ics_fixture(today)))
        .mount(&server)
        .await;
    configure_local_moodle_feed(&state, &server, today).await;

    let result = run_sync_inner(None, &state).await.expect("scan runs");
    assert!(result.success);
    assert!(
        result.total_new >= 1,
        "the fixture feed contributes at least one assessment"
    );

    // "Last synced" reflects the real fetch.
    let payload = build_full_state(&state).await.expect("state");
    let stamp = payload
        .config
        .last_gmail_sync
        .expect("a real fetch must stamp 'Last synced'");
    assert_eq!(stamp.len(), 16, "unexpected stamp format: {stamp}");
    assert!(
        stamp.chars().nth(4) == Some('-') && stamp.chars().nth(10) == Some(' '),
        "unexpected stamp format: {stamp}"
    );
    let _ = now;
}

/// A calendar export that lists nothing: the source RAN and reported no
/// events.
fn empty_ics_fixture() -> String {
    "BEGIN:VCALENDAR\nEND:VCALENDAR\n".to_string()
}

/// An announcement the calendar stops listing is RETIRED, not deleted: it
/// stays in the store with the reason, but it leaves the radar and asks for
/// no study time any more.
#[tokio::test]
async fn test_an_announcement_the_calendar_stops_reporting_is_retired() {
    let state = test_app_state("sync_retire").await;
    let today = state.today();
    let now = state.now_iso();

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/moodle.ics"))
        .respond_with(ResponseTemplate::new(200).set_body_string(ics_fixture(today)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/moodle-empty.ics"))
        .respond_with(ResponseTemplate::new(200).set_body_string(empty_ics_fixture()))
        .mount(&server)
        .await;
    configure_local_moodle_feed(&state, &server, today).await;

    // 1. The first scan reports the announcement.
    let first = run_sync_inner(None, &state).await.expect("first scan runs");
    assert!(first.success);
    assert!(first.total_new >= 1);
    let snapshot = state.store.load_state(today).await.unwrap();
    let live = snapshot
        .assessments
        .iter()
        .find(|assessment| assessment.title.contains("Quiz 3"))
        .expect("the fixture announcement is on the radar");
    assert!(live.is_upcoming);
    assert!(
        live.last_seen_source_run.is_some(),
        "the scan must record which run reported the announcement"
    );
    let first_run = live.last_seen_source_run.clone();

    // 2. The calendar no longer lists it.
    state
        .store
        .set_config_string(
            "moodle_ical_url".to_string(),
            Some(format!("{}/moodle-empty.ics", server.uri())),
        )
        .await
        .expect("point the feed at the empty calendar");
    let second = run_sync_inner(None, &state)
        .await
        .expect("second scan runs");
    assert!(second.success);
    assert!(
        second.notes.iter().any(|note| note.contains("retired")),
        "the scan must say what it retired: {:?}",
        second.notes
    );

    // 3. The announcement is kept - with the reason - but it is off the radar.
    let snapshot = state.store.load_state(today).await.unwrap();
    let retired = snapshot
        .assessments
        .iter()
        .find(|assessment| assessment.title.contains("Quiz 3"))
        .expect("the retired announcement is still in the store");
    assert!(!retired.is_upcoming);
    assert!(retired.retired_source_run.is_some());
    assert_ne!(retired.retired_source_run, first_run);
    assert!(
        retired
            .warnings
            .iter()
            .any(|warning| warning.contains("did not report this announcement again")),
        "the retirement must carry its reason: {:?}",
        retired.warnings
    );
    let _ = now;
}

#[tokio::test]
async fn test_scan_that_fetched_nothing_never_claims_a_sync() {
    let state = test_app_state("sync_no_sources").await;

    let result = run_sync_inner(None, &state).await.expect("scan runs");
    assert!(result.success);
    assert!(result
        .notes
        .iter()
        .any(|n| n.contains("No sources are configured")));

    // Nothing was fetched, so the UI must still say "Never synced".
    let payload = build_full_state(&state).await.expect("state");
    assert!(
        payload.config.last_gmail_sync.is_none(),
        "a scan that fetched nothing must not stamp 'Last synced'"
    );
}

#[tokio::test]
async fn test_cancel_aborts_the_scan_and_leaves_the_data_untouched() {
    let state = test_app_state("sync_cancel").await;
    let today = state.today();

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_secs(5))
                .set_body_string(ics_fixture(today)),
        )
        .mount(&server)
        .await;
    configure_local_moodle_feed(&state, &server, today).await;

    let scan_state = state.clone();
    let scan = tokio::task::spawn(async move { run_sync_inner(None, &scan_state).await });

    // Let the scan reach the (slow) fetch, then abort it.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    state.request_cancel();

    let outcome = scan
        .await
        .expect("the scan task joins")
        .expect_err("an aborted scan reports the cancellation");
    assert_eq!(outcome, SCAN_CANCELED_MESSAGE);

    // The abort happens during the fetch phase: nothing was written.
    let snapshot = state.store.load_state(today).await.unwrap();
    assert!(
        snapshot.assessments.is_empty(),
        "an aborted scan must not write assessments"
    );
    assert!(
        state.store.get_last_gmail_sync().await.unwrap().is_none(),
        "an aborted scan must not stamp 'Last synced'"
    );
}

/// `01` §4.1 auto-push: opted in, but no Google account connected. The scan
/// must say the push did not happen — never silently skip it.
#[tokio::test]
async fn test_auto_gcal_push_without_a_connection_is_reported_not_silent() {
    let state = test_app_state("sync_auto_push_offline").await;
    let today = state.today();

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_string(ics_fixture(today)))
        .mount(&server)
        .await;
    configure_local_moodle_feed(&state, &server, today).await;
    state
        .store
        .set_config_bool("auto_sync_gcal".to_string(), true)
        .await
        .expect("the user opted into the calendar auto-push");

    let result = run_sync_inner(None, &state).await.expect("scan runs");
    assert!(result.success);
    assert!(
        result
            .notes
            .iter()
            .any(|n| n.contains("Auto-push to Google Calendar is on, but no Google account")),
        "the skipped auto-push must be stated in the scan notes, got: {:?}",
        result.notes
    );
}

/// `05` §5.1 consent boundary: with the AI toggle off, a practice-quiz request
/// must not leave the device even when a key is available — the honest
/// on-device fallback answers instead, labeled `authored_locally`.
#[tokio::test]
async fn test_ai_consent_off_keeps_practice_quiz_on_device() {
    let state = test_app_state("ai_consent_off").await;
    let today = state.today();
    let now = state.now_iso();

    let assessment = sample_test_assessment(
        "assess-quiz-1",
        "Class Quiz",
        Some("CS101"),
        AssessmentType::ClassQuiz,
        Some(today + chrono::Duration::days(3)),
        vec!["Sorting".to_string(), "Big-O".to_string()],
    );
    state
        .store
        .replace_assessments(vec![assessment], now, today)
        .await
        .expect("insert assessment");
    state
        .store
        .set_config_bool("gemini_enabled".to_string(), false)
        .await
        .expect("the user turned AI off");

    let payload = practice_generate_inner(&state, "assess-quiz-1")
        .await
        .expect("the local fallback answers regardless of the toggle");
    assert!(
        payload.authored_locally,
        "with consent off the quiz must be the on-device fallback, never a Gemini call"
    );
    assert!(!payload.questions.is_empty());
}

#[test]
fn test_keyring_round_trip_feature_guarded() {
    let store = KeyringStore::with_service("com.quizradar.test.roundtrip");
    let test_key = "dpapi_integration_key";
    let test_val = "secure_refresh_token_payload_42";

    match store.set_secret(test_key, test_val) {
        Ok(()) => {
            let got = store
                .get_secret(test_key)
                .expect("get secret must succeed if set succeeded");
            assert_eq!(got.as_deref(), Some(test_val));
            store
                .delete_secret(test_key)
                .expect("delete secret must succeed");
            let after = store.get_secret(test_key).expect("get secret after delete");
            assert_eq!(after, None);
        }
        Err(err) => {
            eprintln!("Keyring DPAPI test skipped on this environment ({err})");
        }
    }
}

#[tokio::test]
async fn test_extract_syllabi_consent_gate_and_mock_batch() {
    let state = test_app_state("extract_syllabi").await;
    state
        .store
        .set_config_bool("gemini_enabled".to_string(), false)
        .await
        .unwrap();

    let docs = vec![SyllabusDocumentInput {
        name: "ece210.pdf".to_string(),
        data_url: "data:application/pdf;base64,JVBERi0xLjQ=".to_string(),
        mime: Some("application/pdf".to_string()),
    }];

    let err = extract_syllabi_with_base_url(
        &state,
        docs.clone(),
        None,
        Some("test-key".to_string()),
        None,
    )
    .await
    .unwrap_err();
    assert!(err.contains("turned off in Settings"), "{err}");

    state
        .store
        .set_config_bool("gemini_enabled".to_string(), true)
        .await
        .unwrap();

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/models/gemini-3.8-flash:generateContent"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": r##"{
  "semester": "Fall 2026",
  "courses": [
    { "id": "ECE210", "name": "Digital Systems", "credits": 4.0, "aliases": ["ECE 210"], "color": "#1a73e8" }
  ],
  "slots": [
    { "id": "slot-1", "course_id": "ECE210", "day": "Monday", "start_time": "10:00", "end_time": "11:30" }
  ],
  "assessments": [
    {
      "course_id": "ECE210",
      "title": "Midterm Exam",
      "assessment_type": "Midterm Exam",
      "date_iso": "2026-11-05",
      "weightage_percent": 30,
      "topics": ["Boolean Algebra"]
    }
  ]
}"##
                    }]
                },
                "finishReason": "STOP"
            }]
        })))
        .mount(&server)
        .await;

    let mut batch = docs;
    batch.push(SyllabusDocumentInput {
        name: "empty.pdf".to_string(),
        data_url: "   ".to_string(),
        mime: Some("application/pdf".to_string()),
    });

    let extracted = extract_syllabi_with_base_url(
        &state,
        batch,
        Some(&server.uri()),
        Some("test-key".to_string()),
        None,
    )
    .await
    .expect("valid syllabus file should succeed even with an empty sibling file");

    assert_eq!(extracted.schedule.courses.len(), 1);
    assert_eq!(extracted.assessments.len(), 1);
    assert_eq!(extracted.file_errors.len(), 1);
    assert!(extracted.file_errors[0].contains("empty.pdf"));

    let applied = apply_course_bundle_inner(&state, extracted.schedule, extracted.assessments)
        .await
        .expect("apply_course_bundle must succeed");
    assert_eq!(applied.report.courses_added, 1);
    assert_eq!(applied.report.slots_added, 1);
    assert_eq!(applied.report.assessments_added, 1);
}

#[tokio::test]
async fn test_export_and_import_course_pack_round_trip() {
    let source_state = test_app_state("course_pack_src").await;
    let today = source_state.today();
    let now = source_state.now_iso();

    let course = Course {
        id: "ECE210".to_string(),
        name: "Digital Systems".to_string(),
        color: "#1a73e8".to_string(),
        bg: None,
        border: None,
        credits: Some(4.0),
        max_absences: None,
        aliases: vec!["ECE 210".to_string()],
    };
    let slot = ScheduleSlot {
        id: "slot-1".to_string(),
        day: "Mon".to_string(),
        day_index: 1,
        course_id: "ECE210".to_string(),
        course_name: "Digital Systems".to_string(),
        slot_type: "Lecture".to_string(),
        group: None,
        room: Some("Eng 204".to_string()),
        start_time: chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
        end_time: chrono::NaiveTime::from_hms_opt(11, 30, 0).unwrap(),
        display_time: "10:00–11:30".to_string(),
        has_quiz: false,
        quiz_title: None,
        week_parity: None,
    };
    source_state
        .store
        .save_schedule(
            ScheduleData {
                semester: Some("Fall 2026".to_string()),
                academic_week_start: None,
                courses: vec![course],
                slots: vec![slot],
            },
            now.clone(),
            today,
        )
        .await
        .unwrap();

    let mut exam = sample_test_assessment(
        "ece-mid",
        "Midterm Exam",
        Some("ECE210"),
        AssessmentType::MidtermExam,
        Some(today + chrono::Duration::days(10)),
        vec!["K-Maps".to_string()],
    );
    exam.weightage_percent = Some(30.0);
    exam.achieved_score = Some(88.0);
    exam.max_score = Some(100.0);
    source_state
        .store
        .upsert_assessment(exam, now, today)
        .await
        .unwrap();

    let exported = export_course_pack_inner(&source_state, "ECE210", None)
        .await
        .expect("export_course_pack must succeed");
    assert!(exported.links.web_url.contains("#course="));
    assert!(exported.qr.is_some());

    let peer_state = test_app_state("course_pack_dst").await;
    let imported = import_course_pack_inner(&peer_state, &exported.links.web_url)
        .await
        .expect("import_course_pack must succeed");

    assert_eq!(imported.course_id, "ECE210");
    assert_eq!(imported.report.courses_added, 1);
    assert_eq!(imported.report.slots_added, 1);
    assert_eq!(imported.report.assessments_added, 1);
    assert_eq!(imported.state.assessments.len(), 1);
    assert_eq!(imported.state.assessments[0].achieved_score, None);
    assert_eq!(imported.state.assessments[0].weightage_percent, Some(30.0));
}

#[tokio::test]
async fn test_zero_key_trial_syllabus_extraction_consent_and_429() {
    let state = test_app_state("trial_relay").await;
    let docs = vec![SyllabusDocumentInput {
        name: "bio105.pdf".to_string(),
        data_url: "data:application/pdf;base64,JVBERi0xLjQ=".to_string(),
        mime: Some("application/pdf".to_string()),
    }];

    // 1. Consent off refuses even when ai_trial_enabled is true.
    state
        .store
        .set_config_bool("gemini_enabled".to_string(), false)
        .await
        .unwrap();
    state
        .store
        .set_config_bool("ai_trial_enabled".to_string(), true)
        .await
        .unwrap();
    let denied = extract_syllabi_with_base_url(&state, docs.clone(), None, None, None)
        .await
        .unwrap_err();
    assert!(denied.contains("turned off in Settings"));

    let off_usage = ai_quota_usage_inner(&state).await.unwrap();
    assert_eq!(off_usage.mode, "off");

    // 2. Consent on + ai_trial_enabled routes to relay with custom headers (no BYOK key).
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1beta/models/gemini-3.8-flash:generateContent"))
        .and(header_exists("x-quizradar-install-id"))
        .and(header("x-quizradar-client", "desktop"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("X-QuizRadar-Trial-Limit", "10")
                .insert_header("X-QuizRadar-Trial-Remaining", "9")
                .insert_header("X-QuizRadar-Trial-Reset", "2026-11-22T00:00:00.000Z")
                .set_body_json(serde_json::json!({
                    "candidates": [{
                        "content": {
                            "parts": [{
                                "text": r##"{
  "semester": "Fall 2026",
  "courses": [{ "id": "BIO105", "name": "Cell Biology", "credits": 3.0, "aliases": [], "color": "#0f9d58" }],
  "slots": [],
  "assessments": [{ "course_id": "BIO105", "title": "Quiz 1", "assessment_type": "Class Quiz", "date_iso": "2026-11-18" }]
}"##
                            }]
                        },
                        "finishReason": "STOP"
                    }]
                })),
        )
        .expect(1)
        .mount(&server)
        .await;

    state
        .store
        .set_config_bool("gemini_enabled".to_string(), true)
        .await
        .unwrap();
    state
        .store
        .set_config_string("ai_trial_relay_url".to_string(), Some(server.uri()))
        .await
        .unwrap();

    let extracted =
        extract_syllabi_with_base_url(&state, docs.clone(), Some(&server.uri()), None, None)
            .await
            .expect("zero-key starter trial extraction must succeed");
    assert_eq!(extracted.schedule.courses[0].id, "BIO105");
    server.verify().await;

    let usage = ai_quota_usage_inner(&state).await.unwrap();
    assert_eq!(usage.mode, "trial");
    assert_eq!(usage.trial_limit, Some(10));
    assert_eq!(usage.trial_remaining, Some(9));

    // 3. HTTP 429 from relay surfaces starter limit copy and persists remaining = 0.
    let exhausted_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1beta/models/gemini-3.8-flash:generateContent"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("X-QuizRadar-Trial-Limit", "10")
                .insert_header("X-QuizRadar-Trial-Remaining", "0")
                .insert_header("X-QuizRadar-Trial-Reset", "2026-11-22T00:00:00.000Z")
                .set_body_json(serde_json::json!({
                    "error": {
                        "code": 429,
                        "status": "TRIAL_EXHAUSTED",
                        "trial": { "limit": 10, "remaining": 0, "resetIso": "2026-11-22T00:00:00.000Z" }
                    }
                })),
        )
        .mount(&exhausted_server)
        .await;

    let err =
        extract_syllabi_with_base_url(&state, docs, Some(&exhausted_server.uri()), None, None)
            .await
            .unwrap_err();
    assert!(err.contains("Free starter AI limit reached"));

    let updated = ai_quota_usage_inner(&state).await.unwrap();
    assert_eq!(updated.trial_remaining, Some(0));
}

#[tokio::test]
async fn test_quick_capture_text_offline_and_screenshot_consent_gate() {
    let state = test_app_state("quick_capture").await;

    // Seed a course + tutorial slot so relative text anchors deterministically.
    let sched = ScheduleData {
        semester: Some("Fall 2026".to_string()),
        academic_week_start: None,
        courses: vec![Course {
            id: "ECE210".to_string(),
            name: "Digital Systems".to_string(),
            color: "#1a73e8".to_string(),
            bg: None,
            border: None,
            credits: Some(3.0),
            max_absences: None,
            aliases: vec!["ECE 210".to_string()],
        }],
        slots: vec![ScheduleSlot {
            id: "slot-tut".to_string(),
            day: "Tuesday".to_string(),
            day_index: 2,
            course_id: "ECE210".to_string(),
            course_name: "Digital Systems".to_string(),
            slot_type: "Tutorial".to_string(),
            group: None,
            room: Some("Eng 305".to_string()),
            start_time: NaiveTime::from_hms_opt(14, 0, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(15, 30, 0).unwrap(),
            display_time: "14:00–15:30".to_string(),
            has_quiz: false,
            quiz_title: None,
            week_parity: None,
        }],
    };
    state
        .store
        .save_schedule(sched, "2026-11-01T00:00:00Z".to_string(), state.today())
        .await
        .unwrap();

    // 1. Offline text capture works even with AI consent off.
    state
        .store
        .set_config_bool("gemini_enabled".to_string(), false)
        .await
        .unwrap();
    let parsed =
        parse_shared_announcement_inner(&state, None, "ECE 210 Quiz 2 next week during tutorial")
            .await
            .unwrap();
    assert_eq!(parsed.course_id.as_deref(), Some("ECE210"));
    assert_eq!(parsed.room.as_deref(), Some("Eng 305"));
    assert!(parsed.id.starts_with("share-"));

    // 2. Screenshot capture refuses when gemini_enabled is false.
    let doc = SyllabusDocumentInput {
        name: "wa-shot.png".to_string(),
        data_url: "data:image/png;base64,iVBORw0KGgo=".to_string(),
        mime: Some("image/png".to_string()),
    };
    let denied = extract_announcement_media_with_base_url(&state, doc, None, None)
        .await
        .unwrap_err();
    assert!(denied.contains("turned off in Settings"));
}
