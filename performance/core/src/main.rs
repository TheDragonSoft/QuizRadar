//! Deterministic, non-shipped core performance sampler. One process emits one
//! sample per scenario; the Node runner alternates revisions and aggregates.

use chrono::{NaiveDate, NaiveTime};
use quizradar_core::cal::ics::export_ics_all_with_ref_date;
use quizradar_core::parse::email::parse_emails;
use quizradar_core::parse::ics::parse_ics_events;
use quizradar_core::plan::dashboard::build_dashboard_summary;
use quizradar_core::plan::tasks::build_study_tasks_with_schedule;
use quizradar_core::store::db::Db;
use quizradar_core::store::{exporter, repo};
use quizradar_core::types::{
    AcademicTrack, Assessment, CachedEmail, CompletedTopics, ScheduleData,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::error::Error;
use std::fs;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::Instant;

const REF_DATE: &str = "2026-10-17";

#[derive(Deserialize)]
struct EmailFixture {
    emails: Vec<CachedEmail>,
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../core/tests/fixtures")
}

fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 17).expect("fixed benchmark reference date")
}

fn schedule() -> Result<ScheduleData, Box<dyn Error>> {
    let raw = fs::read_to_string(fixture_root().join("schedule/schedule.json"))?;
    Ok(serde_json::from_str(&raw)?)
}

fn emails() -> Result<Vec<CachedEmail>, Box<dyn Error>> {
    let mut paths: Vec<PathBuf> = fs::read_dir(fixture_root().join("email"))?
        .map(|entry| entry.map(|item| item.path()))
        .collect::<Result<_, _>>()?;
    paths.sort();
    let mut emails = Vec::new();
    for path in paths {
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let fixture: EmailFixture = serde_json::from_str(&fs::read_to_string(path)?)?;
        emails.extend(fixture.emails);
    }
    if emails.len() < 24 {
        return Err(format!(
            "expected at least 24 email fixtures, found {}",
            emails.len()
        )
        .into());
    }
    Ok(emails)
}

fn assessment(index: usize) -> Result<Assessment, Box<dyn Error>> {
    let date = ref_date() + chrono::Duration::days((index % 14) as i64);
    let mut item: Assessment = serde_json::from_value(json!({
        "id": format!("perf-{index}"),
        "course_id": "CSE241",
        "course_name": "Embedded Systems",
        "title": format!("Quiz {index}: scheduling and parsing"),
        "assessment_type": if index.is_multiple_of(3) { "Midterm Exam" } else { "Class Quiz" },
        "date_iso": date.format("%Y-%m-%d").to_string(),
        "start_time": "09:00",
        "end_time": "10:30",
        "topics": (0..6).map(|topic| format!("Topic {topic}: ownership and calendars")).collect::<Vec<_>>(),
        "warnings": [],
        "source": "Gmail"
    }))?;
    item.start_time = NaiveTime::from_hms_opt(9 + (index % 8) as u32, 0, 0);
    item.end_time = item.start_time.map(|start| {
        start
            .overflowing_add_signed(chrono::Duration::minutes(90))
            .0
    });
    item.is_upcoming = true;
    Ok(item)
}

fn assessments(count: usize) -> Result<Vec<Assessment>, Box<dyn Error>> {
    (0..count).map(assessment).collect()
}

fn measure<F, R>(iterations: u32, mut operation: F) -> f64
where
    F: FnMut() -> R,
{
    let started = Instant::now();
    for _ in 0..iterations {
        black_box(operation());
    }
    started.elapsed().as_secs_f64() * 1000.0 / f64::from(iterations)
}

fn scenario(id: &str, iterations: u32, milliseconds: f64) -> Value {
    json!({
        "id": id,
        "unit": "ms",
        "samples": [milliseconds],
        "metadata": { "iterationsPerSample": iterations }
    })
}

fn run(revision: &str) -> Result<Value, Box<dyn Error>> {
    let schedule = schedule()?;
    let emails = emails()?;
    let assessments = assessments(96)?;
    let ics = fs::read_to_string(fixture_root().join("ics/moodle-export.ics"))?;
    let completed = CompletedTopics::new();

    let mut db = Db::open_in_memory()?;
    repo::ops::save_schedule(&db, &schedule, "2026-10-17T00:00:00Z", ref_date())?;
    repo::ops::replace_assessments(&db, &assessments, "2026-10-17T00:00:00Z", ref_date())?;

    let scenarios = vec![
        scenario(
            "email.parse_batch",
            50,
            measure(50, || {
                parse_emails(
                    black_box(&emails),
                    black_box(&schedule),
                    black_box(ref_date()),
                )
            }),
        ),
        scenario(
            "ics.parse",
            100,
            measure(100, || parse_ics_events(black_box(&ics))),
        ),
        scenario(
            "ics.export",
            50,
            measure(50, || {
                export_ics_all_with_ref_date(black_box(&assessments), black_box(Some(ref_date())))
            }),
        ),
        scenario(
            "planner.dashboard",
            30,
            measure(30, || {
                build_dashboard_summary(
                    black_box(&assessments),
                    black_box(&completed),
                    black_box(&[]),
                    black_box(ref_date()),
                )
            }),
        ),
        scenario(
            "planner.study_tasks",
            30,
            measure(30, || {
                build_study_tasks_with_schedule(
                    black_box(&assessments),
                    black_box(&completed),
                    black_box(ref_date()),
                    black_box(AcademicTrack::Eng),
                    black_box(&schedule.slots),
                    black_box(&[]),
                )
            }),
        ),
        scenario(
            "store.load_state",
            20,
            measure(20, || {
                repo::ops::load_state(black_box(&db), black_box(ref_date()))
            }),
        ),
        scenario(
            "store.save_schedule",
            10,
            measure(10, || {
                repo::ops::save_schedule(
                    black_box(&db),
                    black_box(&schedule),
                    black_box("2026-10-17T00:00:00Z"),
                    black_box(ref_date()),
                )
            }),
        ),
        scenario(
            "store.backup_export",
            20,
            measure(20, || {
                exporter::serialize_v4_backup(
                    black_box(&db),
                    black_box("2026-10-17T00:00:00Z"),
                    black_box(ref_date()),
                )
            }),
        ),
    ];
    black_box(&mut db);
    Ok(json!({
        "schemaVersion": 1,
        "surface": "core",
        "revision": revision,
        "environment": { "referenceDate": REF_DATE, "profile": "release" },
        "scenarios": scenarios
    }))
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut revision = None;
    let mut output = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--revision" => revision = args.next(),
            "--output" => output = args.next(),
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    let revision = revision.ok_or("--revision is required")?;
    let rendered = serde_json::to_string_pretty(&run(&revision)?)? + "\n";
    if let Some(output) = output {
        if let Some(parent) = Path::new(&output).parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(output, rendered)?;
    } else {
        print!("{rendered}");
    }
    Ok(())
}
