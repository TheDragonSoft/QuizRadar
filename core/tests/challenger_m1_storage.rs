//! Challenger adversarial empirical test suite for Milestone 1:
//! 1. Leitner Flashcard Repetition (Box 1-5 advancement, capping at 5, hard drop to 1)
//! 2. Study Streak Calculation (today vs yesterday vs 2 days ago, no premature reset)
//! 3. Attendance & Absence Limits (normal, amber 1 remaining, red limit reached)
//! 4. SQLite v4 Migration from v3 database on temporary disk file

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::bool_assert_comparison
)]

use chrono::NaiveDate;
use quizradar_core::store::db::Db;
use quizradar_core::store::repo::{AttendanceRepo, CourseRepo};
use quizradar_core::store::Store;
use quizradar_core::types::{
    AttendanceEntry, AttendanceStatus, Course, Flashcard, MistakeRecord, QuizAttempt, ScheduleData,
    StudySessionRecord,
};

fn d(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

// ============================================================================
// 1. Leitner Flashcard Repetition
// ============================================================================

#[tokio::test]
async fn test_leitner_box_advancement_capping_and_hard_drop() {
    let store = Store::open_in_memory().await.unwrap();

    let initial_card = Flashcard {
        id: "fc-leitner-1".into(),
        course_id: Some("CS201".into()),
        assessment_id: Some("midterm-1".into()),
        topic: Some("Algorithms".into()),
        front: "What is the time complexity of binary search?".into(),
        back: "O(log n)".into(),
        box_level: 1,
        next_review_iso: Some("2026-11-01".into()),
        last_reviewed_iso: None,
    };

    store
        .upsert_flashcard(initial_card, "t0".into())
        .await
        .unwrap();

    // Box 1 -> Review Correct -> Box 2 (+3 days)
    let rev1 = store
        .review_flashcard("fc-leitner-1".into(), true, d(2026, 11, 1), "t1".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rev1.box_level, 2, "Box 1 -> correct must advance to Box 2");
    assert_eq!(rev1.last_reviewed_iso.as_deref(), Some("2026-11-01"));
    assert_eq!(
        rev1.next_review_iso.as_deref(),
        Some("2026-11-04"),
        "Box 2 interval must be +3 days"
    );

    // Box 2 -> Review Correct -> Box 3 (+7 days)
    let rev2 = store
        .review_flashcard("fc-leitner-1".into(), true, d(2026, 11, 4), "t2".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rev2.box_level, 3, "Box 2 -> correct must advance to Box 3");
    assert_eq!(rev2.last_reviewed_iso.as_deref(), Some("2026-11-04"));
    assert_eq!(
        rev2.next_review_iso.as_deref(),
        Some("2026-11-11"),
        "Box 3 interval must be +7 days"
    );

    // Box 3 -> Review Correct -> Box 4 (+14 days)
    let rev3 = store
        .review_flashcard("fc-leitner-1".into(), true, d(2026, 11, 11), "t3".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rev3.box_level, 4, "Box 3 -> correct must advance to Box 4");
    assert_eq!(rev3.last_reviewed_iso.as_deref(), Some("2026-11-11"));
    assert_eq!(
        rev3.next_review_iso.as_deref(),
        Some("2026-11-25"),
        "Box 4 interval must be +14 days"
    );

    // Box 4 -> Review Correct -> Box 5 (+30 days)
    let rev4 = store
        .review_flashcard("fc-leitner-1".into(), true, d(2026, 11, 25), "t4".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rev4.box_level, 5, "Box 4 -> correct must advance to Box 5");
    assert_eq!(rev4.last_reviewed_iso.as_deref(), Some("2026-11-25"));
    assert_eq!(
        rev4.next_review_iso.as_deref(),
        Some("2026-12-25"),
        "Box 5 interval must be +30 days"
    );

    // Box 5 -> Review Correct -> CAPPED AT BOX 5 (+30 days)
    let rev5 = store
        .review_flashcard("fc-leitner-1".into(), true, d(2026, 12, 25), "t5".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        rev5.box_level, 5,
        "Box 5 -> correct review MUST stay capped at Box 5"
    );
    assert_eq!(rev5.last_reviewed_iso.as_deref(), Some("2026-12-25"));
    assert_eq!(
        rev5.next_review_iso.as_deref(),
        Some("2027-01-24"),
        "Box 5 interval must stay +30 days"
    );

    // Box 5 -> Review Correct AGAIN -> CAPPED AT BOX 5
    let rev6 = store
        .review_flashcard("fc-leitner-1".into(), true, d(2027, 1, 24), "t6".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        rev6.box_level, 5,
        "Box 5 -> repeated correct review MUST stay capped at Box 5"
    );
    assert_eq!(rev6.next_review_iso.as_deref(), Some("2027-02-23"));

    // Box 5 -> Review Incorrect -> HARD DROP TO BOX 1 (+1 day)
    let rev7 = store
        .review_flashcard("fc-leitner-1".into(), false, d(2027, 2, 23), "t7".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        rev7.box_level, 1,
        "Incorrect answer at Box 5 MUST hard drop to Box 1"
    );
    assert_eq!(rev7.last_reviewed_iso.as_deref(), Some("2027-02-23"));
    assert_eq!(
        rev7.next_review_iso.as_deref(),
        Some("2027-02-24"),
        "Box 1 reset interval must be +1 day"
    );

    // Box 1 -> Review Incorrect AGAIN -> Remains at Box 1 (+1 day)
    let rev8 = store
        .review_flashcard("fc-leitner-1".into(), false, d(2027, 2, 24), "t8".into())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        rev8.box_level, 1,
        "Incorrect answer at Box 1 MUST remain at Box 1"
    );
    assert_eq!(rev8.next_review_iso.as_deref(), Some("2027-02-25"));

    // Edge Cases:
    // Reviewing non-existent flashcard returns Ok(None)
    let non_existent = store
        .review_flashcard("non-existent-id".into(), true, d(2027, 1, 1), "t9".into())
        .await
        .unwrap();
    assert!(non_existent.is_none());

    // Flashcard validation: empty front is rejected
    let empty_front_card = Flashcard {
        id: "fc-bad".into(),
        course_id: None,
        assessment_id: None,
        topic: None,
        front: "   ".into(),
        back: "Something".into(),
        box_level: 1,
        next_review_iso: None,
        last_reviewed_iso: None,
    };
    let err = store
        .upsert_flashcard(empty_front_card, "t10".into())
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("front cannot be empty"),
        "Empty front must return Validation error: {err}"
    );

    // Clamping on out-of-range box_level: box_level = 99 is clamped to 5
    let wild_card = Flashcard {
        id: "fc-wild".into(),
        course_id: Some("CS201".into()),
        assessment_id: None,
        topic: None,
        front: "Question".into(),
        back: "Answer".into(),
        box_level: 99,
        next_review_iso: None,
        last_reviewed_iso: None,
    };
    let _ = store
        .upsert_flashcard(wild_card, "t11".into())
        .await
        .unwrap();
    let cards = store.list_flashcards(Some("CS201".into())).await.unwrap();
    let re_read = cards.iter().find(|c| c.id == "fc-wild").unwrap();
    assert_eq!(
        re_read.box_level, 5,
        "Flashcard stored with box_level > 5 must be clamped to 5 in DB"
    );
}

// ============================================================================
// 2. Study Streak Calculation
// ============================================================================

#[tokio::test]
async fn test_study_streak_reference_dates_and_resilience() {
    let store = Store::open_in_memory().await.unwrap();

    let courses = vec![Course {
        id: "CS101".into(),
        name: "Computer Science I".into(),
        color: "#2563EB".into(),
        bg: None,
        border: None,
        credits: Some(4.0),
        max_absences: Some(3),
    }];

    store
        .save_schedule(
            ScheduleData {
                semester: Some("Fall 2026".into()),
                courses: courses.clone(),
                slots: vec![],
            },
            "t0".into(),
            d(2026, 11, 6),
        )
        .await
        .unwrap();

    let ref_date = d(2026, 11, 6); // Today = Friday Nov 6

    // Scenario 1: Empty sessions -> Streak is 0
    let a0 = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(a0.current_streak_days, 0);
    assert_eq!(a0.best_streak_days, 0);
    assert_eq!(a0.total_focus_minutes, 0);

    // Scenario 2: Session Today only -> Streak is 1
    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-today".into(),
                course_id: Some("CS101".into()),
                assessment_id: None,
                topic: Some("Variables".into()),
                duration_minutes: 30,
                timestamp: "2026-11-06T10:00:00Z".into(),
                date_iso: ref_date,
            },
            ref_date,
        )
        .await
        .unwrap();

    let a1 = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(a1.current_streak_days, 1);
    assert_eq!(a1.best_streak_days, 1);
    assert_eq!(a1.total_focus_minutes, 30);

    // Scenario 3: Add session Yesterday (Nov 5) and 2 days ago (Nov 4) -> Streak is 3
    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-yest".into(),
                course_id: Some("CS101".into()),
                assessment_id: None,
                topic: Some("Loops".into()),
                duration_minutes: 45,
                timestamp: "2026-11-05T14:00:00Z".into(),
                date_iso: d(2026, 11, 5),
            },
            ref_date,
        )
        .await
        .unwrap();

    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-2days".into(),
                course_id: Some("CS101".into()),
                assessment_id: None,
                topic: Some("Conditionals".into()),
                duration_minutes: 25,
                timestamp: "2026-11-04T16:00:00Z".into(),
                date_iso: d(2026, 11, 4),
            },
            ref_date,
        )
        .await
        .unwrap();

    let a3 = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(
        a3.current_streak_days, 3,
        "Consecutive sessions today, yesterday, 2 days ago must yield streak 3"
    );
    assert_eq!(a3.best_streak_days, 3);
    assert_eq!(a3.total_focus_minutes, 100);

    // Scenario 4: Fast forward ref_date to TOMORROW (Nov 7) where NO session has been done yet!
    // Since yesterday (Nov 6) has sessions, the streak MUST NOT reset prematurely!
    let tomorrow = d(2026, 11, 7);
    let a_tomorrow = store.get_study_analytics(tomorrow).await.unwrap();
    assert_eq!(
        a_tomorrow.current_streak_days, 3,
        "Morning check with no session today but consecutive sessions leading to yesterday MUST preserve streak!"
    );

    // Scenario 5: Fast forward ref_date to 2 DAYS LATER (Nov 8) where neither Nov 7 nor Nov 8 has sessions.
    // The streak MUST reset to 0 because yesterday (Nov 7) was missed!
    let day_after_tomorrow = d(2026, 11, 8);
    let a_broken = store.get_study_analytics(day_after_tomorrow).await.unwrap();
    assert_eq!(
        a_broken.current_streak_days, 0,
        "Missed yesterday and today MUST reset current streak to 0"
    );
    assert_eq!(
        a_broken.best_streak_days, 3,
        "Best streak of 3 must be preserved historically"
    );

    // Scenario 6: Best streak calculation across older history:
    // Add a 5-day historical streak in October (Oct 10..=14)
    for day in 10..=14 {
        store
            .log_study_session(
                StudySessionRecord {
                    id: format!("sess-oct-{day}"),
                    course_id: Some("CS101".into()),
                    assessment_id: None,
                    topic: Some("Past study".into()),
                    duration_minutes: 30,
                    timestamp: format!("2026-10-{day}T10:00:00Z"),
                    date_iso: d(2026, 10, day),
                },
                ref_date,
            )
            .await
            .unwrap();
    }

    let a_hist = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(
        a_hist.current_streak_days, 3,
        "Current streak anchored to ref_date (Nov 6) is 3"
    );
    assert_eq!(
        a_hist.best_streak_days, 5,
        "Best historical streak must reflect the 5-day October run"
    );

    // Scenario 7: Multiple sessions on the same day must not artificially inflate streak
    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-today-extra".into(),
                course_id: Some("CS101".into()),
                assessment_id: None,
                topic: Some("Review".into()),
                duration_minutes: 20,
                timestamp: "2026-11-06T19:00:00Z".into(),
                date_iso: ref_date,
            },
            ref_date,
        )
        .await
        .unwrap();

    let a_extra = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(
        a_extra.current_streak_days, 3,
        "Multiple sessions on the same day must count as 1 day for streak"
    );
    assert_eq!(
        a_extra.weekly_chart.len(),
        7,
        "Weekly chart must contain exactly 7 daily entries"
    );
}

// ============================================================================
// 3. Attendance & Absence Limits
// ============================================================================

#[tokio::test]
async fn test_attendance_absence_limits_warning_chips_and_thresholds() {
    // Open a direct connection and run through AttendanceRepo
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let db = Db::open_in_memory().unwrap();
    assert_eq!(db.schema_version().unwrap(), 4);

    let course_repo = CourseRepo::new(&conn);
    // Create tables via migration
    for (_, sql) in quizradar_core::store::db::MIGRATIONS {
        conn.execute_batch(sql).unwrap();
    }

    // Enroll 3 courses with different absence limits:
    // - CS101: limit = 4
    // - MATH201: limit = 1
    // - PHYS301: limit = None (no limit)
    course_repo
        .upsert(&Course {
            id: "CS101".into(),
            name: "CS I".into(),
            color: "#2563EB".into(),
            bg: None,
            border: None,
            credits: Some(3.0),
            max_absences: Some(4),
        })
        .unwrap();

    course_repo
        .upsert(&Course {
            id: "MATH201".into(),
            name: "Linear Algebra".into(),
            color: "#10B981".into(),
            bg: None,
            border: None,
            credits: Some(3.0),
            max_absences: Some(1),
        })
        .unwrap();

    course_repo
        .upsert(&Course {
            id: "PHYS301".into(),
            name: "Physics".into(),
            color: "#F59E0B".into(),
            bg: None,
            border: None,
            credits: Some(4.0),
            max_absences: None,
        })
        .unwrap();

    let att_repo = AttendanceRepo::new(&conn);

    // CS101 (limit = 4):
    // 1. Initial state (0 absences, 1 attended):
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-1".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 11, 2),
            status: AttendanceStatus::Attended,
            updated_at: "t1".into(),
        })
        .unwrap();

    let summary1 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary1.attended, 1);
    assert_eq!(summary1.absent, 0);
    assert_eq!(summary1.max_absences, Some(4));
    assert_eq!(summary1.is_critical, false);
    assert_eq!(summary1.warning_chip.as_deref(), Some("0/4 Absences"));

    // 2. Record 1st absence (1/4 -> normal)
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-2".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 11, 9),
            status: AttendanceStatus::Absent,
            updated_at: "t2".into(),
        })
        .unwrap();

    let summary2 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary2.absent, 1);
    assert_eq!(summary2.is_critical, false);
    assert_eq!(summary2.warning_chip.as_deref(), Some("1/4 Absences"));

    // 3. Record 2nd absence (2/4 -> normal)
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-3".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 11, 16),
            status: AttendanceStatus::Absent,
            updated_at: "t3".into(),
        })
        .unwrap();

    let summary3 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary3.absent, 2);
    assert_eq!(summary3.is_critical, false);
    assert_eq!(summary3.warning_chip.as_deref(), Some("2/4 Absences"));

    // 4. Record 3rd absence: absent == limit - 1 (3/4) -> AMBER WARNING ("1 Absence Left (3/4)")
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-4".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 11, 23),
            status: AttendanceStatus::Absent,
            updated_at: "t4".into(),
        })
        .unwrap();

    let summary4 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary4.absent, 3);
    assert_eq!(
        summary4.is_critical, false,
        "1 absence left must NOT be critical (amber warning)"
    );
    assert_eq!(
        summary4.warning_chip.as_deref(),
        Some("1 Absence Left (3/4)"),
        "1 absence remaining must render amber warning chip"
    );

    // 5. Record 4th absence: absent == limit (4/4) -> CRITICAL RED ("Limit Reached! (4/4)")
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-5".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 11, 30),
            status: AttendanceStatus::Absent,
            updated_at: "t5".into(),
        })
        .unwrap();

    let summary5 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary5.absent, 4);
    assert_eq!(
        summary5.is_critical, true,
        "Limit reached must flag is_critical = true (red chip)"
    );
    assert_eq!(
        summary5.warning_chip.as_deref(),
        Some("Limit Reached! (4/4)")
    );

    // 6. Record 5th absence: absent > limit (5/4) -> CRITICAL RED ("Limit Reached! (5/4)")
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-6".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 12, 7),
            status: AttendanceStatus::Absent,
            updated_at: "t6".into(),
        })
        .unwrap();

    let summary6 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary6.absent, 5);
    assert_eq!(summary6.is_critical, true);
    assert_eq!(
        summary6.warning_chip.as_deref(),
        Some("Limit Reached! (5/4)")
    );

    // 7. Excused status does NOT count against absence limit:
    att_repo
        .record(&AttendanceEntry {
            id: "att-cs-excused".into(),
            slot_id: "slot-cs".into(),
            course_id: "CS101".into(),
            date_iso: d(2026, 12, 14),
            status: AttendanceStatus::Excused,
            updated_at: "t7".into(),
        })
        .unwrap();

    let summary7 = att_repo.course_summary("CS101").unwrap();
    assert_eq!(summary7.excused, 1);
    assert_eq!(
        summary7.absent, 5,
        "Excused class must not increment absent count"
    );

    // 8. MATH201 with max_absences = Some(1) boundary condition:
    // With 0 absences: absent == limit - 1 (0 == 0) -> "1 Absence Left (0/1)"
    let math_sum0 = att_repo.course_summary("MATH201").unwrap();
    assert_eq!(math_sum0.absent, 0);
    assert_eq!(
        math_sum0.warning_chip.as_deref(),
        Some("1 Absence Left (0/1)")
    );
    assert_eq!(math_sum0.is_critical, false);

    // With 1 absence: absent >= limit -> "Limit Reached! (1/1)"
    att_repo
        .record(&AttendanceEntry {
            id: "att-math-1".into(),
            slot_id: "slot-math".into(),
            course_id: "MATH201".into(),
            date_iso: d(2026, 11, 3),
            status: AttendanceStatus::Absent,
            updated_at: "t8".into(),
        })
        .unwrap();

    let math_sum1 = att_repo.course_summary("MATH201").unwrap();
    assert_eq!(math_sum1.absent, 1);
    assert_eq!(math_sum1.is_critical, true);
    assert_eq!(
        math_sum1.warning_chip.as_deref(),
        Some("Limit Reached! (1/1)")
    );

    // 9. PHYS301 with max_absences = None (unlimited):
    let phys_sum = att_repo.course_summary("PHYS301").unwrap();
    assert_eq!(phys_sum.warning_chip, None);
    assert_eq!(phys_sum.is_critical, false);

    // 10. Re-recording attendance on the same slot and date replaces rather than duplicates:
    att_repo
        .record(&AttendanceEntry {
            id: "att-math-1-corrected".into(),
            slot_id: "slot-math".into(),
            course_id: "MATH201".into(),
            date_iso: d(2026, 11, 3),
            status: AttendanceStatus::Attended, // corrected from Absent to Attended
            updated_at: "t9".into(),
        })
        .unwrap();

    let math_corrected = att_repo.course_summary("MATH201").unwrap();
    assert_eq!(
        math_corrected.absent, 0,
        "Corrected attendance must replace previous absence"
    );
    assert_eq!(math_corrected.attended, 1);
    assert_eq!(math_corrected.is_critical, false);
}

// ============================================================================
// 4. SQLite v4 Migration from v3 Database on Disk
// ============================================================================

#[tokio::test]
async fn test_sqlite_v4_migration_on_temporary_file_database() {
    let temp_dir =
        std::env::temp_dir().join(format!("quizradar_challenger_m1_{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let db_path = temp_dir.join("v3_to_v4_migration_test.db");
    let _ = std::fs::remove_file(&db_path);

    // Step 1: Create a real SQLite database at v3 schema
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        // Execute migrations 1, 2, 3
        conn.execute_batch(quizradar_core::store::db::MIGRATIONS[0].1)
            .unwrap();
        conn.execute_batch(quizradar_core::store::db::MIGRATIONS[1].1)
            .unwrap();
        conn.execute_batch(quizradar_core::store::db::MIGRATIONS[2].1)
            .unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();

        // Verify it is strictly at version 3
        let v: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 3, "Database must be initialized at schema version 3");

        // Insert comprehensive v3 data
        conn.execute(
            "INSERT INTO courses (id, name, color, bg, border) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                "BIO101",
                "General Biology",
                "#059669",
                "#05966918",
                "#05966955"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO slots (id, day, day_index, course_id, course_name, slot_type, group_name, room, start_time, end_time, display_time, has_quiz, quiz_title)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                "slot-bio-1",
                "Wed",
                3,
                "BIO101",
                "General Biology",
                "Lab",
                "Sec 2",
                "Lab 301",
                "14:00",
                "17:00",
                "14:00–17:00",
                1,
                "Lab Practical 1"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO assessments (id, course_id, course_name, title, assessment_type, date_iso, urgency_level, topics, warnings, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                "assess-bio-1",
                "BIO101",
                "General Biology",
                "Lab Practical 1",
                "Lab Assessment",
                "2026-11-18",
                "upcoming",
                "[\"Cell Division\",\"Microscopy\"]",
                "[]",
                "Moodle"
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO topics_done (key, done, updated_at) VALUES (?1, 1, ?2)",
            rusqlite::params!["assess-bio-1::h123", "2026-11-01T00:00:00Z"],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO grades (assessment_id, achieved_score, max_score, weightage_percent, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["assess-bio-1", 18.5, 20.0, 15.0, "2026-11-01T00:00:00Z"],
        )
        .unwrap();
    }

    // Step 2: Open the database using Db::open(&db_path)
    // This MUST automatically detect schema 3 < 4 and apply migration 4
    let db = Db::open(&db_path).unwrap();

    // Verify schema version is now 4
    assert_eq!(
        db.schema_version().unwrap(),
        4,
        "Db::open must automatically apply migration 4 and upgrade user_version to 4"
    );

    // Open through Store
    let store = Store::open(db_path.clone()).await.unwrap();

    // Step 3: Verify existing data survived intact and new columns have NULL defaults
    let state = store.load_state(d(2026, 11, 6)).await.unwrap();
    assert_eq!(state.schedule.courses.len(), 1);
    let bio_course = &state.schedule.courses[0];
    assert_eq!(bio_course.id, "BIO101");
    assert_eq!(bio_course.name, "General Biology");
    assert_eq!(
        bio_course.credits, None,
        "Existing course must have NULL credits after migration"
    );
    assert_eq!(
        bio_course.max_absences, None,
        "Existing course must have NULL max_absences after migration"
    );

    assert_eq!(state.schedule.slots.len(), 1);
    let bio_slot = &state.schedule.slots[0];
    assert_eq!(bio_slot.id, "slot-bio-1");
    assert_eq!(
        bio_slot.week_parity, None,
        "Existing slot must have NULL week_parity after migration"
    );
    assert_eq!(bio_slot.room.as_deref(), Some("Lab 301"));

    assert_eq!(state.assessments.len(), 1);
    assert_eq!(state.assessments[0].id, "assess-bio-1");

    assert_eq!(state.grades.len(), 1);
    let grade = state.grades.get("assess-bio-1").unwrap();
    assert_eq!(grade.achieved_score, Some(18.5));
    assert_eq!(grade.max_score, Some(20.0));

    // Step 4: Verify all new v4 tables are fully functional and writable
    // 4a. Update course with credits and max_absences via direct connection
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let c_repo = CourseRepo::new(&conn);
        c_repo.set_credits("BIO101", Some(4.0)).unwrap();
        c_repo.set_max_absences("BIO101", Some(2)).unwrap();
    }

    // 4b. Record attendance in new attendance table
    store
        .record_attendance(
            AttendanceEntry {
                id: "att-bio-lab1".into(),
                slot_id: "slot-bio-1".into(),
                course_id: "BIO101".into(),
                date_iso: d(2026, 11, 4),
                status: AttendanceStatus::Attended,
                updated_at: "t-mig1".into(),
            },
            d(2026, 11, 6),
        )
        .await
        .unwrap();

    // 4c. Flashcards table
    let fc = store
        .upsert_flashcard(
            Flashcard {
                id: "fc-bio-1".into(),
                course_id: Some("BIO101".into()),
                assessment_id: Some("assess-bio-1".into()),
                topic: Some("Cell Division".into()),
                front: "What is mitosis?".into(),
                back: "Process of nuclear division".into(),
                box_level: 1,
                next_review_iso: Some("2026-11-05".into()),
                last_reviewed_iso: None,
            },
            "t-mig2".into(),
        )
        .await
        .unwrap();
    assert_eq!(fc.box_level, 1);

    // 4d. Quiz attempts table
    let attempt = QuizAttempt {
        id: "qa-bio-1".into(),
        assessment_id: "assess-bio-1".into(),
        course_id: Some("BIO101".into()),
        timestamp: "2026-11-05T12:00:00Z".into(),
        score: 9,
        total_questions: 10,
        passed: true,
    };
    let mistake = MistakeRecord {
        id: "mis-bio-1".into(),
        attempt_id: Some("qa-bio-1".into()),
        assessment_id: "assess-bio-1".into(),
        course_id: Some("BIO101".into()),
        question_id: "q-7".into(),
        question_text: "What phase comes after metaphase?".into(),
        options: vec!["Anaphase".into(), "Telophase".into(), "Prophase".into()],
        selected_index: 1,
        correct_index: 0,
        explanation: "Anaphase follows metaphase.".into(),
        timestamp: "2026-11-05T12:00:00Z".into(),
        resolved: false,
    };
    store
        .save_quiz_attempt(attempt, vec![mistake], "t-mig3".into())
        .await
        .unwrap();

    let mistakes = store
        .list_mistakes(Some("assess-bio-1".into()))
        .await
        .unwrap();
    assert_eq!(mistakes.len(), 1);
    assert_eq!(mistakes[0].question_id, "q-7");

    // 4e. Study sessions table
    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-bio-1".into(),
                course_id: Some("BIO101".into()),
                assessment_id: Some("assess-bio-1".into()),
                topic: Some("Cell Biology".into()),
                duration_minutes: 60,
                timestamp: "2026-11-05T18:00:00Z".into(),
                date_iso: d(2026, 11, 5),
            },
            d(2026, 11, 6),
        )
        .await
        .unwrap();

    // Step 5: Close and reopen the database file to ensure migration was idempotent and clean
    drop(store);
    drop(db);

    let store2 = Store::open(db_path.clone()).await.unwrap();
    let db2 = Db::open(&db_path).unwrap();
    assert_eq!(db2.schema_version().unwrap(), 4);

    let state2 = store2.load_state(d(2026, 11, 6)).await.unwrap();
    let bio2 = &state2.schedule.courses[0];
    assert_eq!(bio2.credits, Some(4.0));
    assert_eq!(bio2.max_absences, Some(2));

    let cards2 = store2.list_flashcards(Some("BIO101".into())).await.unwrap();
    assert_eq!(cards2.len(), 1);
    assert_eq!(cards2[0].front, "What is mitosis?");

    let analytics2 = store2.get_study_analytics(d(2026, 11, 6)).await.unwrap();
    assert_eq!(analytics2.total_focus_minutes, 60);
    assert_eq!(analytics2.current_streak_days, 1); // session was yesterday

    // Cleanup temp directory
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_adversarial_edge_cases_and_schema_too_new() {
    let store = Store::open_in_memory().await.unwrap();
    let ref_date = d(2026, 11, 10);

    // 1. Zero-minute session must not keep streak alive
    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-zero".into(),
                course_id: None,
                assessment_id: None,
                topic: Some("Slacking".into()),
                duration_minutes: 0,
                timestamp: "2026-11-09T10:00:00Z".into(),
                date_iso: d(2026, 11, 9),
            },
            ref_date,
        )
        .await
        .unwrap();

    let a_zero = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(
        a_zero.current_streak_days, 0,
        "0-minute session must NOT count towards active study streak"
    );

    // 2. Future session (e.g. tomorrow) must not be counted in current_streak_days
    store
        .log_study_session(
            StudySessionRecord {
                id: "sess-future".into(),
                course_id: None,
                assessment_id: None,
                topic: Some("Future study".into()),
                duration_minutes: 60,
                timestamp: "2026-11-12T10:00:00Z".into(),
                date_iso: d(2026, 11, 12), // 2 days in the future relative to ref_date
            },
            ref_date,
        )
        .await
        .unwrap();

    let a_future = store.get_study_analytics(ref_date).await.unwrap();
    assert_eq!(
        a_future.current_streak_days, 0,
        "Future session must NOT count in current streak anchored to ref_date"
    );

    // 3. Schema too new: opening database with user_version = 999 must return SchemaTooNew error
    let temp_dir =
        std::env::temp_dir().join(format!("quizradar_future_schema_{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let future_db_path = temp_dir.join("future.db");
    {
        let conn = rusqlite::Connection::open(&future_db_path).unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
    }

    let err = Db::open(&future_db_path).unwrap_err();
    match err {
        quizradar_core::store::db::StoreError::SchemaTooNew { found, supported } => {
            assert_eq!(found, 999);
            assert_eq!(supported, 4);
        }
        other => panic!("Expected SchemaTooNew, got: {other:?}"),
    }

    let _ = std::fs::remove_dir_all(&temp_dir);
}
