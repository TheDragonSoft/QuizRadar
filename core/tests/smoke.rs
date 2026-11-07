// Tests are the right place for expect/unwrap — allow it for this file only.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use quizradar_core::types::{Assessment, AssessmentType, Course, ScheduleSlot, UrgencyLevel};

/// A v4-shaped assessment (docs/rebuild/02-current-architecture.md §3.3)
/// deserializes cleanly and keeps the exact type/urgency ladder labels.
#[test]
fn assessment_roundtrips_v4_json() {
    let json = serde_json::json!({
        "id": "teams-1700000000-1",
        "course_id": "CSE241",
        "course_name": "Object-Oriented Programming",
        "title": "Class Quiz 1 next week",
        "assessment_type": "Class Quiz",
        "date_iso": "2026-10-30",
        "day_name": "Friday",
        "start_time": "08:00",
        "end_time": "10:30",
        "display_time": "Friday, 30 October 2026 (08:00 – 10:30)",
        "room": null,
        "group": "Sec 1",
        "instructor": null,
        "is_upcoming": true,
        "days_until": 7,
        "urgency_level": "upcoming",
        "priority_score": 60,
        "topics": [],
        "warnings": [],
        "ai_inference_note": null,
        "ai_study_plan": null,
        "estimated_study_hours": null,
        "elearning_url": null,
        "google_cal_url": null,
        "gcal_synced": false,
        "gcal_event_id": null,
        "color": "#1a73e8",
        "bg": "#1a73e818",
        "border": "#1a73e855",
        "semester": null,
        "email_subject": "CSE241 Quiz announcement",
        "email_sent_date": "2026-10-23",
        "source": "Gmail",
        "source_icon": "mail",
        "weightage_percent": null,
        "achieved_score": null,
        "max_score": null,
        "conflict_warning": null
    });

    let assessment: Assessment =
        serde_json::from_value(json.clone()).expect("v4-shaped JSON parses");
    assert_eq!(assessment.assessment_type, AssessmentType::ClassQuiz);
    assert_eq!(assessment.assessment_type.as_str(), "Class Quiz");
    assert_eq!(assessment.urgency_level, UrgencyLevel::Upcoming);
    assert_eq!(
        assessment.room, None,
        "unknown room stays None (renders \"—\")"
    );

    let re: Assessment =
        serde_json::from_value(serde_json::to_value(&assessment).expect("serializes"))
            .expect("re-parses own serialization");
    assert_eq!(assessment, re);
}

/// The full type ladder serializes with the exact v4 labels.
#[test]
fn assessment_type_labels_match_v4() {
    let types = [
        (AssessmentType::ClassQuiz, "Class Quiz"),
        (AssessmentType::OnlineQuiz, "Online Quiz"),
        (AssessmentType::MidtermExam, "Midterm Exam"),
        (AssessmentType::FinalExam, "Final Exam"),
        (AssessmentType::LabAssessment, "Lab Assessment"),
        (AssessmentType::Assignment, "Assignment"),
    ];
    for (variant, label) in types {
        let json = serde_json::to_value(variant).unwrap();
        assert_eq!(json, serde_json::json!(label));
    }
}

/// Slots keep v4's `type` field name through serde (v4 models.rs renamed the
/// Rust keyword away; the JSON contract stays `"type"`).
#[test]
fn schedule_slot_uses_v4_type_field() {
    let slot: ScheduleSlot = serde_json::from_value(serde_json::json!({
        "id": "slot-1",
        "day": "Sun",
        "day_index": 0,
        "course_id": "CSE241",
        "course_name": "Object-Oriented Programming",
        "type": "Lecture",
        "group": "Sec 1",
        "room": null,
        "start_time": "08:00",
        "end_time": "10:30",
        "display_time": "08:00–10:30",
        "has_quiz": false,
        "quiz_title": null
    }))
    .unwrap();

    assert_eq!(slot.slot_type, "Lecture");
    assert_eq!(slot.room, None);
}

/// Courses round-trip with optional derived colors absent.
#[test]
fn course_roundtrip() {
    let course = Course {
        id: "MTH102".to_string(),
        name: "Calculus II".to_string(),
        color: "#0f9d58".to_string(),
        bg: None,
        border: None,
        credits: None,
        max_absences: None,
    };
    let json = serde_json::to_value(&course).unwrap();
    assert_eq!(json["id"], "MTH102");
    let back: Course = serde_json::from_value(json).unwrap();
    assert_eq!(course, back);
}
