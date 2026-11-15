//! Labeled 54-email evaluation benchmark across 8 categories (promos, clubs/
//! workshops/recruiting, attendance/surveys, grades/slides/cancellations/
//! solutions, word-boundary traps, messy topics/HTML/forwarding, classification/
//! title edge cases, and rescued positives).
//!
//! Uses only crate-public APIs and serde construction so the exact same suite
//! can benchmark historical revisions (`v5.15.1` -> `v5.15.2` -> HEAD).
//! Run with `-- --nocapture` to inspect per-category metrics and JSON output.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout
)]

use chrono::NaiveDate;
use quizradar_core::ai::gemini::GeminiProvider;
use quizradar_core::ai::tasks::{extract_assessment, merge_extraction};
use quizradar_core::parse::email::parse_emails;
use quizradar_core::types::{Assessment, AssessmentType, CachedEmail, ScheduleData};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone, Copy)]
struct Case {
    id: &'static str,
    category: &'static str,
    subject: &'static str,
    from: &'static str,
    date: &'static str,
    body: &'static str,
    expect_detected: bool,
    expect_type: Option<AssessmentType>,
    expect_date: Option<&'static str>,
    expect_title_contains: Option<&'static str>,
    forbid_title_contains: Option<&'static str>,
    expect_topics_include: &'static [&'static str],
    forbid_topics_contain: &'static [&'static str],
}

impl Case {
    const fn neg(
        id: &'static str,
        category: &'static str,
        subject: &'static str,
        from: &'static str,
        date: &'static str,
        body: &'static str,
    ) -> Self {
        Self {
            id,
            category,
            subject,
            from,
            date,
            body,
            expect_detected: false,
            expect_type: None,
            expect_date: None,
            expect_title_contains: None,
            forbid_title_contains: None,
            expect_topics_include: &[],
            forbid_topics_contain: &[],
        }
    }

    const fn pos(
        id: &'static str,
        category: &'static str,
        subject: &'static str,
        from: &'static str,
        date: &'static str,
        body: &'static str,
    ) -> Self {
        Self {
            id,
            category,
            subject,
            from,
            date,
            body,
            expect_detected: true,
            expect_type: None,
            expect_date: None,
            expect_title_contains: None,
            forbid_title_contains: None,
            expect_topics_include: &[],
            forbid_topics_contain: &[],
        }
    }

    const fn kind(mut self, t: AssessmentType) -> Self {
        self.expect_type = Some(t);
        self
    }

    const fn on_date(mut self, iso: &'static str) -> Self {
        self.expect_date = Some(iso);
        self
    }

    const fn title_has(mut self, s: &'static str) -> Self {
        self.expect_title_contains = Some(s);
        self
    }

    const fn title_forbids(mut self, s: &'static str) -> Self {
        self.forbid_title_contains = Some(s);
        self
    }

    const fn topics_has(mut self, items: &'static [&'static str]) -> Self {
        self.expect_topics_include = items;
        self
    }

    const fn topics_forbids(mut self, items: &'static [&'static str]) -> Self {
        self.forbid_topics_contain = items;
        self
    }
}

fn load_schedule() -> ScheduleData {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("schedule")
        .join("schedule.json");
    let raw = fs::read_to_string(path).expect("schedule.json reads");
    serde_json::from_str(&raw).expect("schedule.json parses")
}

fn ref_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 17).unwrap()
}

fn build_email(case: &Case) -> CachedEmail {
    serde_json::from_value(json!({
        "id": case.id,
        "subject": case.subject,
        "from": case.from,
        "date": case.date,
        "snippet": null,
        "body": case.body,
        "body_truncated": false
    }))
    .expect("CachedEmail constructs cleanly")
}

#[allow(clippy::too_many_lines)]
fn corpus() -> Vec<Case> {
    vec![
        // 1. Commercial promos & student offers (6)
        Case::neg(
            "promo-01",
            "promos",
            "Students: Unlock Gemini AI Plus free for one year",
            "Google AI <noreply@google.com>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Claim your free student offer for Gemini AI Pro. Offer ends next week!",
        ),
        Case::neg(
            "promo-02",
            "promos",
            "Prepare faster with Quizlet Plus Student Discount",
            "Quizlet <team@quizlet.example>",
            "Fri, 16 Oct 2026 11:00:00 +0000",
            "Start your free trial before exam week. Manage email preferences or unsubscribe.",
        ),
        Case::neg(
            "promo-03",
            "promos",
            "Upgrade to ChatGPT Plus before finals",
            "OpenAI <news@openai.example>",
            "Thu, 15 Oct 2026 09:00:00 +0000",
            "Special offer for students — unlimited study help before your quiz! Unsubscribe anytime.",
        ),
        Case::neg(
            "promo-04",
            "promos",
            "Free Perplexity Pro for university students",
            "Perplexity <hello@perplexity.example>",
            "Fri, 16 Oct 2026 13:00:00 +0000",
            "Activate your free access before the limited-time offer closes Monday.",
        ),
        Case::neg(
            "promo-05",
            "promos",
            "Grammarly Student Discount: write better assignments",
            "Grammarly <info@grammarly.example>",
            "Wed, 14 Oct 2026 15:00:00 +0000",
            "Get 40% off our pricing plan before your next assignment deadline.",
        ),
        Case::neg(
            "promo-06",
            "promos",
            "Flash Exam Prep Bundle — 60% Off Today",
            "StudyBoost <noreply@studyboost.example>",
            "Fri, 16 Oct 2026 16:00:00 +0000",
            "Limited time offer on midterm practice tests. Click View in browser to claim discount.",
        ),

        // 2. Workshops, student clubs & recruiting tests (7)
        Case::neg(
            "event-01",
            "workshops_clubs",
            "Reminder: Hands-on RAG Workshop ✨🚀",
            "Digital Content & Activities Dept <activities@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Join our hands-on RAG workshop on Thursday at 2:00 PM in Hall 5. Register now!",
        ),
        Case::neg(
            "event-02",
            "workshops_clubs",
            "Cloud Architecture Bootcamp — Bonus Quiz Challenge",
            "Student Union Tech <union@univ.edu>",
            "Thu, 15 Oct 2026 12:00:00 +0000",
            "Student Union invites you to our bootcamp this Wednesday. Reserve your seat today!",
        ),
        Case::neg(
            "event-03",
            "workshops_clubs",
            "ACM Student Club Quiz Night — Win Prizes!",
            "ACM Club <acm@univ.edu>",
            "Fri, 16 Oct 2026 14:00:00 +0000",
            "Come to Hall 3 tomorrow at 5 PM for our fun trivia quiz competition!",
        ),
        Case::neg(
            "event-04",
            "workshops_clubs",
            "Robotics Open House & Interactive Kahoot",
            "Robotics Society <club@univ.edu>",
            "Fri, 16 Oct 2026 15:00:00 +0000",
            "Interactive Kahoot quiz tomorrow! Limited seats, RSVP here.",
        ),
        Case::neg(
            "event-05",
            "workshops_clubs",
            "AI Safety Webinar: Pre-session Quiz",
            "Student Affairs <affairs@univ.edu>",
            "Thu, 15 Oct 2026 09:00:00 +0000",
            "Register here for Friday's webinar on AI safety.",
        ),
        Case::neg(
            "event-06",
            "workshops_clubs",
            "Online Coding Assessment — Software Engineer Intern",
            "TechCorp Talent <careers@techcorp.example>",
            "Fri, 16 Oct 2026 17:00:00 +0000",
            "Complete your HackerRank technical assessment by Monday for your Software Engineer internship application.",
        ),
        Case::neg(
            "event-07",
            "workshops_clubs",
            "Career Fair Preparation Session & Mock Test",
            "Career Services <careers@univ.edu>",
            "Fri, 16 Oct 2026 11:00:00 +0000",
            "Mock coding test prep session on Sunday at 1:00 PM.",
        ),

        // 3. Attendance warnings & evaluation surveys (6)
        Case::neg(
            "admin-01",
            "attendance_surveys",
            "CSE241: First Attendance Warning",
            "Academic Advising <advising@univ.edu>",
            "Fri, 16 Oct 2026 09:00:00 +0000",
            "Your attendance dropped below 75%. Continued absences mean being barred from the final exam on 20 December 2026.",
        ),
        Case::neg(
            "admin-02",
            "attendance_surveys",
            "CSE346 Absence Alert — Final Notice",
            "Student Affairs <affairs@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "You exceeded the allowed absences and are deprived from the final exam.",
        ),
        Case::neg(
            "admin-03",
            "attendance_surveys",
            "Disciplinary Notice: Lab Attendance",
            "Registrar <registrar@univ.edu>",
            "Thu, 15 Oct 2026 14:00:00 +0000",
            "Second warning: students not allowed to enter the final without advisor clearance.",
        ),
        Case::neg(
            "admin-04",
            "attendance_surveys",
            "Mid-Semester Course Evaluation Survey",
            "Quality Assurance <qa@univ.edu>",
            "Fri, 16 Oct 2026 11:00:00 +0000",
            "Please complete the course evaluation survey for your courses before the final deadline tomorrow.",
        ),
        Case::neg(
            "admin-05",
            "attendance_surveys",
            "CSE346 Instructor Evaluation — Action Required",
            "Feedback Office <eval@univ.edu>",
            "Thu, 15 Oct 2026 16:00:00 +0000",
            "Fill out the instructor evaluation before Monday; answers do not affect your exam grade.",
        ),
        Case::neg(
            "admin-06",
            "attendance_surveys",
            "Student Wellbeing & Campus Dining Survey",
            "Student Services <services@univ.edu>",
            "Fri, 16 Oct 2026 08:00:00 +0000",
            "Quick 2-minute survey — deadline Sunday to win gift cards (not a graded quiz).",
        ),

        // 4. Grades, slides, bare cancellations, solutions & replies (8)
        Case::neg(
            "post-01",
            "grades_slides_cancel",
            "CSE241 Quiz 1 Grades Posted",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 12:00:00 +0000",
            "Quiz 1 marks are now published on the course portal.",
        ),
        Case::neg(
            "post-02",
            "grades_slides_cancel",
            "CSE346 Midterm Exam Results Available",
            "Dr. Joy <joy@univ.edu>",
            "Fri, 16 Oct 2026 14:00:00 +0000",
            "Check your midterm results in the gradebook.",
        ),
        Case::neg(
            "post-03",
            "grades_slides_cancel",
            "CSE241 Lecture 5 Slides Uploaded",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 15:00:00 +0000",
            "Slides for Lecture 5 are posted for quiz preparation.",
        ),
        Case::neg(
            "post-04",
            "grades_slides_cancel",
            "CSE241 Quiz 1 Solutions Uploaded",
            "TA Office <ta@univ.edu>",
            "Fri, 16 Oct 2026 16:00:00 +0000",
            "Model answer and rubric for Quiz 1 are attached.",
        ),
        Case::neg(
            "post-05",
            "grades_slides_cancel",
            "CSE346 Quiz 1 Answer Key",
            "TA Office <ta@univ.edu>",
            "Fri, 16 Oct 2026 17:00:00 +0000",
            "Download the answer key to verify your Sunday submission.",
        ),
        Case::neg(
            "post-06",
            "grades_slides_cancel",
            "CSE241 Quiz 1 Cancelled",
            "Dr. Ada <ada@univ.edu>",
            "Sat, 17 Oct 2026 08:00:00 +0000",
            "Dear students, Quiz 1 scheduled for Sunday at 9:00 AM is cancelled.",
        ),
        Case::neg(
            "post-07",
            "grades_slides_cancel",
            "CSE346 Midterm Exam Canceled",
            "Dr. Joy <joy@univ.edu>",
            "Sat, 17 Oct 2026 09:00:00 +0000",
            "Today's midterm exam is canceled due to weather; wait for further instructions.",
        ),
        Case::neg(
            "post-08",
            "grades_slides_cancel",
            "Re: CSE241 Quiz 2 questions",
            "Student <student@univ.edu>",
            "Fri, 16 Oct 2026 19:00:00 +0000",
            "Thanks doctor, see you at the quiz on Sunday!",
        ),

        // 5. Substring / word-boundary traps (5)
        Case::neg(
            "sub-01",
            "substring_traps",
            "Latest Department Update",
            "CS Dept <cs@univ.edu>",
            "Fri, 16 Oct 2026 09:00:00 +0000",
            "The latest announcement is that office hours run tomorrow at Hall 2.",
        ),
        Case::neg(
            "sub-02",
            "substring_traps",
            "Programming Contest Invitation",
            "ACM Chapter <acm@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Our annual contest starts on Monday in Lab A. Join our coding team on campus!",
        ),
        Case::neg(
            "sub-03",
            "substring_traps",
            "Updated Course Syllabus Document",
            "Coordinator <coord@univ.edu>",
            "Thu, 15 Oct 2026 12:00:00 +0000",
            "The updated CSE241 syllabus is now available for download tomorrow morning.",
        ),
        Case::neg(
            "sub-04",
            "substring_traps",
            "Department Colloquium",
            "Dean Office <dean@univ.edu>",
            "Fri, 16 Oct 2026 11:00:00 +0000",
            "We celebrate our alumni testimonial on Sunday at noon in the auditorium.",
        ),
        Case::neg(
            "sub-05",
            "substring_traps",
            "General Course Feedback",
            "Prof <prof@univ.edu>",
            "Fri, 16 Oct 2026 13:00:00 +0000",
            "Hope yesterday's lecture helped clarify the last tricky quiz question.",
        ),

        // 6. Messy topics, Markdown/emojis, HTML entities, wrapping, noise leakage (7)
        Case::pos(
            "top-01",
            "topic_hygiene",
            "CSE241 Quiz 2 Details",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Reminder for ✨ **Quiz 2** 🚀 on 25 October 2026\nTIME: 9:00 AM - 10:00 AM\nROOM: Lab A\nTopics:\n- **Dynamic Programming** 📝\n- Graphs and Trees\nBest regards,\nDr. Ada",
        )
        .on_date("2026-10-25")
        .topics_has(&["Dynamic Programming", "Graphs and Trees"])
        .topics_forbids(&["TIME:", "ROOM:", "**", "📝", "Best regards"]),
        Case::pos(
            "top-02",
            "topic_hygiene",
            "CSE241 Quiz 2 Rules and Scope",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Quiz 2 is on 25 October 2026.\nTopics covered:\n- Binary Search Trees and\n  Balanced AVL Trees\n- You are allowed one A4 sheet handwritten on both sides\n- Please make sure you attend your registered lecture section\n- Bring your student ID card\nFor more details: https://lms.univ.edu/q2",
        )
        .on_date("2026-10-25")
        .topics_has(&["Binary Search Trees and Balanced AVL Trees"])
        .topics_forbids(&["A4 sheet", "registered lecture", "student ID", "https://"]),
        Case::pos(
            "top-03",
            "topic_hygiene",
            "CSE346 Quiz 1 Coverage",
            "Dr. Joy <joy@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "<p>Topics covered in Quiz 1:</p><ul><li>TCP&rsquo;s Flow Control &amp; Buffering</li><li>Congestion Control &ndash; AIMD</li><li>No calculators allowed</li></ul><p>Held on Monday 26 October 2026.</p>",
        )
        .on_date("2026-10-26")
        .topics_has(&["TCP's Flow Control & Buffering", "Congestion Control - AIMD"])
        .topics_forbids(&["&rsquo;", "&ndash;", "No calculators"]),
        Case::pos(
            "top-04",
            "topic_hygiene",
            "CSE241 Quiz 3 Topics",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 11:00:00 +0000",
            "Quiz 3 on 25 October 2026.\nQuiz 3 covers: Polymorphism, Virtual Tables, and Smart Pointers",
        )
        .on_date("2026-10-25")
        .topics_has(&["Polymorphism", "Virtual Tables", "Smart Pointers"]),
        Case::pos(
            "top-05",
            "topic_hygiene",
            "CSE241 Quiz 1 Colonless List",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 11:00:00 +0000",
            "Quiz 1 is on 25 October 2026.\nTopics covered in Quiz 1\nRecursion Basics\nPointer Arithmetic\n\nPlease arrive 10 minutes early.",
        )
        .on_date("2026-10-25")
        .topics_has(&["Recursion Basics", "Pointer Arithmetic"])
        .topics_forbids(&["arrive 10 minutes", "Please arrive"]),
        Case::pos(
            "top-06",
            "topic_hygiene",
            "CSE346 Quiz 2 Numbered Scope",
            "Dr. Joy <joy@univ.edu>",
            "Fri, 16 Oct 2026 12:00:00 +0000",
            "Quiz 2 will take place on Monday 26 October 2026.\nSyllabus:\n1. DNS Resolution\n2. HTTP/2 Framing\n3. TLS Handshake",
        )
        .on_date("2026-10-26")
        .topics_has(&["DNS Resolution", "HTTP/2 Framing", "TLS Handshake"]),
        Case::pos(
            "top-07",
            "topic_hygiene",
            "CSE241 Midterm Scope",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 13:00:00 +0000",
            "Midterm on Sunday 25 October 2026.\n1. Check your assigned seat in Hall 2.\n2. Please read Chapter 3 carefully.\n- Memory Alignment\n- Move Semantics",
        )
        .on_date("2026-10-25")
        .topics_has(&["Memory Alignment", "Move Semantics"])
        .topics_forbids(&["Check your", "Please read", "assigned seat"]),

        // 7. Type classification & title disambiguation (7)
        Case::pos(
            "cls-01",
            "classification",
            "CSE241 Quiz 2 Schedule",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Quiz 2 on 25 October 2026. Review your homework solutions and syllabus — good practice for the final exam.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-25"),
        Case::pos(
            "cls-02",
            "classification",
            "CSE241 Quiz 3 Prep Notes",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Quiz 3 on Sunday 25 October 2026 covers key midterm preparation concepts.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-25"),
        Case::pos(
            "cls-03",
            "classification",
            "CSE241 Quiz 10 Announcement",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "CSE241 Quiz 10 will be held on 25 October 2026.",
        )
        .kind(AssessmentType::ClassQuiz)
        .title_forbids("Quiz 1:"),
        Case::pos(
            "cls-04",
            "classification",
            "CSE346 Quiz 12 Date",
            "Dr. Joy <joy@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "CSE346 Quiz 12 on 26 October 2026.",
        )
        .kind(AssessmentType::ClassQuiz)
        .title_forbids("Quiz 1:"),
        Case::pos(
            "cls-05",
            "classification",
            "CSE346 Weekly Check-in",
            "Moodle LMS <lms@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "<p>Opens Monday 26 October 2026.</p><p><a href=\"https://lms.univ.edu/mod/quiz/view.php?id=55\">Open Portal</a></p>",
        )
        .kind(AssessmentType::OnlineQuiz)
        .on_date("2026-10-26"),
        Case::pos(
            "cls-06",
            "classification",
            "CSE241 In-Class Assignment 2",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Assignment 2 is due on 25 October 2026.",
        )
        .kind(AssessmentType::Assignment)
        .on_date("2026-10-25"),
        Case::pos(
            "cls-07",
            "classification",
            "CSE241 Midterm Exam",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Midterm Exam will take place on Sunday 25 October 2026.",
        )
        .kind(AssessmentType::MidtermExam)
        .title_has("CSE241 Midterm Exam")
        .on_date("2026-10-25"),

        // 8. Rescued positives & forwarded thread headers (8)
        Case::pos(
            "res-01",
            "rescued_and_forwarded",
            "CSE241 Quiz 3 on 25 October 2026",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Quiz 3 is on Sunday, 25 October 2026. Please also fill out the course evaluation survey afterwards.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-25"),
        Case::pos(
            "res-02",
            "rescued_and_forwarded",
            "CSE241 Quiz 2 grades — Quiz 3 moved to Sunday 25 October 2026",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Quiz 2 marks posted. Quiz 3 moved to 25 October 2026.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-25"),
        Case::pos(
            "res-03",
            "rescued_and_forwarded",
            "CSE346 Quiz 1 Cancelled — Rescheduled to Monday 26 October 2026",
            "Dr. Joy <joy@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Original date cancelled; rescheduled to Monday 26 October 2026.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-26"),
        Case::pos(
            "res-04",
            "rescued_and_forwarded",
            "CSE241 Midterm Appeals & Remake",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 12:00:00 +0000",
            "Approved appeals: a remake will be held on Sunday 25 October 2026.",
        )
        .kind(AssessmentType::MidtermExam)
        .on_date("2026-10-25"),
        Case::pos(
            "res-05",
            "rescued_and_forwarded",
            "CSE241 Quiz 2 Location",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 14:00:00 +0000",
            "Quiz 2 on 25 October 2026 in Lab A. cc: student affairs office.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-25"),
        Case::pos(
            "res-06",
            "rescued_and_forwarded",
            "Fwd: CSE241 Quiz 2 Dates",
            "Class Rep <rep@univ.edu>",
            "Fri, 16 Oct 2026 18:00:00 +0000",
            "See below.\n\n---------- Forwarded message ---------\nFrom: Dr. Ada <ada@univ.edu>\nDate: Tue, 13 October 2026 at 10:15 AM\nSubject: CSE241 Quiz 2\nTo: All <students@univ.edu>\n\nQuiz 2 will be held on Sunday, 25 October 2026.\nTopics covered: Templates, Iterators",
        )
        .on_date("2026-10-25")
        .topics_has(&["Templates", "Iterators"])
        .topics_forbids(&["From:", "Date:"]),
        Case::pos(
            "res-07",
            "rescued_and_forwarded",
            "FW: CSE346 Quiz 1 Update",
            "TA Office <ta@univ.edu>",
            "Fri, 16 Oct 2026 19:00:00 +0000",
            "FYI\nFrom: Dr. Joy <joy@univ.edu>\nSent: 12 October 2026 09:00 AM\nTo: Class\nSubject: Quiz 1\n\nQuiz 1 is on Monday, 26 October 2026.",
        )
        .on_date("2026-10-26"),
        Case::pos(
            "res-08",
            "rescued_and_forwarded",
            "Important Notice",
            "Dr. Ada <ada@univ.edu>",
            "Fri, 16 Oct 2026 10:00:00 +0000",
            "Dear students, please note that CSE241 Quiz 1 will take place on Sunday 25 October 2026 at Lab A.",
        )
        .kind(AssessmentType::ClassQuiz)
        .on_date("2026-10-25"),
    ]
}

#[derive(Default, serde::Serialize)]
struct CategoryStats {
    total: usize,
    true_positives: usize,
    true_negatives: usize,
    false_positives: usize,
    false_negatives: usize,
    type_errors: usize,
    date_errors: usize,
    title_errors: usize,
    topic_defects: usize,
    total_faults: usize,
}

struct EvalOutcome {
    assessment_type: AssessmentType,
    date: Option<NaiveDate>,
    title: String,
    topics: Vec<String>,
}

impl From<&Assessment> for EvalOutcome {
    fn from(a: &Assessment) -> Self {
        Self {
            assessment_type: a.assessment_type,
            date: a.date,
            title: a.title.clone(),
            topics: a.topics.clone(),
        }
    }
}

fn check_case(case: &Case, parsed: Option<&EvalOutcome>, stats: &mut CategoryStats) -> Vec<String> {
    stats.total += 1;
    let mut faults = Vec::new();
    match (case.expect_detected, parsed) {
        (false, None) => stats.true_negatives += 1,
        (false, Some(a)) => {
            stats.false_positives += 1;
            faults.push(format!(
                "FP leaked type={:?} title={:?}",
                a.assessment_type, a.title
            ));
        }
        (true, None) => {
            stats.false_negatives += 1;
            faults.push("FN dropped valid assessment".to_string());
        }
        (true, Some(a)) => {
            stats.true_positives += 1;
            if let Some(exp_type) = case.expect_type {
                if a.assessment_type != exp_type {
                    stats.type_errors += 1;
                    faults.push(format!(
                        "type expected={exp_type:?} actual={:?}",
                        a.assessment_type
                    ));
                }
            }
            if let Some(exp_iso) = case.expect_date {
                let actual_iso = a.date.map(|d| d.format("%Y-%m-%d").to_string());
                if actual_iso.as_deref() != Some(exp_iso) {
                    stats.date_errors += 1;
                    faults.push(format!("date expected={exp_iso} actual={actual_iso:?}"));
                }
            }
            if let Some(substr) = case.expect_title_contains {
                if !a.title.contains(substr) {
                    stats.title_errors += 1;
                    faults.push(format!("title missing {substr:?} actual={:?}", a.title));
                }
            }
            if let Some(bad) = case.forbid_title_contains {
                if a.title.contains(bad) {
                    stats.title_errors += 1;
                    faults.push(format!(
                        "title contains forbidden {bad:?} actual={:?}",
                        a.title
                    ));
                }
            }
            let mut has_topic_defect = false;
            for req in case.expect_topics_include {
                if !a.topics.iter().any(|t| t.contains(req)) {
                    has_topic_defect = true;
                    faults.push(format!("topic missing {req:?} in {:?}", a.topics));
                }
            }
            for bad in case.forbid_topics_contain {
                let bad_lower = bad.to_ascii_lowercase();
                if a.topics
                    .iter()
                    .any(|t| t.to_ascii_lowercase().contains(&bad_lower))
                {
                    has_topic_defect = true;
                    faults.push(format!("topic leaked {bad:?} in {:?}", a.topics));
                }
            }
            if has_topic_defect {
                stats.topic_defects += 1;
            }
        }
    }
    if !faults.is_empty() {
        stats.total_faults += 1;
    }
    faults
}

#[test]
fn labeled_54_email_eval_suite_achieves_zero_defects() {
    let schedule = load_schedule();
    let cases = corpus();
    assert_eq!(cases.len(), 54, "labeled eval corpus has 54 cases");

    let mut per_cat: BTreeMap<&'static str, CategoryStats> = BTreeMap::new();
    let mut totals = CategoryStats::default();
    let mut failure_details: Vec<String> = Vec::new();

    for case in &cases {
        let email = build_email(case);
        let (items, _) = parse_emails(&[email], &schedule, ref_date());
        let outcome = items.first().map(EvalOutcome::from);
        let cat_stats = per_cat.entry(case.category).or_default();
        let faults = check_case(case, outcome.as_ref(), cat_stats);
        let _ = check_case(case, outcome.as_ref(), &mut totals);
        if !faults.is_empty() {
            failure_details.push(format!(
                "[{} / {}] {} => {}",
                case.category,
                case.id,
                case.subject,
                faults.join("; ")
            ));
        }
    }

    let summary = json!({
        "total_cases": totals.total,
        "true_positives": totals.true_positives,
        "true_negatives": totals.true_negatives,
        "false_positives": totals.false_positives,
        "false_negatives": totals.false_negatives,
        "type_errors": totals.type_errors,
        "date_errors": totals.date_errors,
        "title_errors": totals.title_errors,
        "topic_defects": totals.topic_defects,
        "cases_with_any_fault": totals.total_faults,
        "per_category": per_cat,
    });
    println!("EVAL_METRICS_JSON:{summary}");

    assert!(
        failure_details.is_empty(),
        "eval defects ({}/{}):\n{}",
        totals.total_faults,
        totals.total,
        failure_details.join("\n")
    );
}

fn percentile_ms(sorted: &[u128], pct: usize) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() - 1) * pct) / 100;
    sorted[idx]
}

/// Live Gemini + Hybrid Pipeline 54-case evaluation benchmark.
/// Run with:
/// `$env:GEMINI_API_KEY="..."; cargo test -p quizradar-core --test email_eval_benchmark live_gemini_54_email_eval_benchmark -- --ignored --nocapture`
#[tokio::test]
#[ignore = "requires live GEMINI_API_KEY environment variable"]
#[allow(clippy::too_many_lines)]
async fn live_gemini_54_email_eval_benchmark() {
    let key = std::env::var("GEMINI_API_KEY")
        .expect("set GEMINI_API_KEY before running live Gemini eval");
    let provider = GeminiProvider::production(Some(key), Arc::new(chrono::Utc::now), None)
        .expect("GeminiProvider constructs cleanly");
    let schedule = load_schedule();
    let cases = corpus();

    let mut ai_per_cat: BTreeMap<&'static str, CategoryStats> = BTreeMap::new();
    let mut ai_totals = CategoryStats::default();
    let mut ai_failures: Vec<String> = Vec::new();
    let mut ai_api_errors = 0usize;

    let mut hybrid_per_cat: BTreeMap<&'static str, CategoryStats> = BTreeMap::new();
    let mut hybrid_totals = CategoryStats::default();
    let mut hybrid_failures: Vec<String> = Vec::new();
    let mut hybrid_gemini_calls = 0usize;
    let mut hybrid_gemini_vetoes = 0usize;

    let mut latencies_ms: Vec<u128> = Vec::with_capacity(cases.len());
    let mut rate_limit_retries = 0usize;

    for case in &cases {
        let email = build_email(case);
        let (det_items, _) = parse_emails(std::slice::from_ref(&email), &schedule, ref_date());

        let started = Instant::now();
        let mut res = extract_assessment(&provider, &email, &schedule).await;
        if let Err(ref err) = res {
            let msg = format!("{err}").to_ascii_lowercase();
            if msg.contains("limit reached") || msg.contains("429") {
                rate_limit_retries += 1;
                tokio::time::sleep(Duration::from_secs(20)).await;
                res = extract_assessment(&provider, &email, &schedule).await;
            }
        }
        let elapsed_ms = started.elapsed().as_millis();
        latencies_ms.push(elapsed_ms);

        let (ai_outcome, hybrid_outcome, note) = match res {
            Ok(ext) => {
                let ai_out = if ext.is_assessment {
                    Some(EvalOutcome {
                        assessment_type: ext.assessment_type.unwrap_or(AssessmentType::ClassQuiz),
                        date: ext.date,
                        title: ext.title.clone().unwrap_or_default(),
                        topics: ext.topics.clone(),
                    })
                } else {
                    None
                };

                let hyb_out = match det_items.first() {
                    None => None,
                    Some(det_base) => {
                        hybrid_gemini_calls += 1;
                        if !ext.is_assessment {
                            hybrid_gemini_vetoes += 1;
                            None
                        } else {
                            let merged = merge_extraction(det_base.clone(), &ext, ref_date());
                            Some(EvalOutcome::from(&merged))
                        }
                    }
                };
                (
                    ai_out,
                    hyb_out,
                    format!(
                        "is_assessment={} type={:?} date={:?} topics={}",
                        ext.is_assessment,
                        ext.assessment_type,
                        ext.date,
                        ext.topics.len()
                    ),
                )
            }
            Err(err) => {
                ai_api_errors += 1;
                if !det_items.is_empty() {
                    hybrid_gemini_calls += 1;
                }
                let hyb_out = det_items.first().map(EvalOutcome::from);
                (None, hyb_out, format!("ERR: {err}"))
            }
        };

        let ai_cat = ai_per_cat.entry(case.category).or_default();
        let af = check_case(case, ai_outcome.as_ref(), ai_cat);
        let _ = check_case(case, ai_outcome.as_ref(), &mut ai_totals);
        if !af.is_empty() {
            ai_failures.push(format!("[{}/{}] {}", case.category, case.id, af.join("; ")));
        }

        let hyb_cat = hybrid_per_cat.entry(case.category).or_default();
        let hf = check_case(case, hybrid_outcome.as_ref(), hyb_cat);
        let _ = check_case(case, hybrid_outcome.as_ref(), &mut hybrid_totals);
        if !hf.is_empty() {
            hybrid_failures.push(format!("[{}/{}] {}", case.category, case.id, hf.join("; ")));
        }

        println!(
            "LIVE_CASE id={} cat={} expect={} det={} ms={} ai_faults={} hyb_faults={} :: {}",
            case.id,
            case.category,
            case.expect_detected,
            !det_items.is_empty(),
            elapsed_ms,
            af.len(),
            hf.len(),
            note
        );
        let pace_ms = 4200u128.saturating_sub(elapsed_ms);
        if pace_ms > 0 {
            tokio::time::sleep(Duration::from_millis(
                u64::try_from(pace_ms).unwrap_or(4200),
            ))
            .await;
        }
    }

    latencies_ms.sort_unstable();
    let total_ms: u128 = latencies_ms.iter().sum();
    let avg_ms = total_ms / u128::try_from(latencies_ms.len().max(1)).unwrap_or(1);

    let ai_summary = json!({
        "total_cases": ai_totals.total,
        "api_errors": ai_api_errors,
        "rate_limit_retries": rate_limit_retries,
        "true_positives": ai_totals.true_positives,
        "true_negatives": ai_totals.true_negatives,
        "false_positives": ai_totals.false_positives,
        "false_negatives": ai_totals.false_negatives,
        "type_errors": ai_totals.type_errors,
        "date_errors": ai_totals.date_errors,
        "title_errors": ai_totals.title_errors,
        "topic_defects": ai_totals.topic_defects,
        "cases_with_any_fault": ai_totals.total_faults,
        "latency_avg_ms": avg_ms,
        "latency_p50_ms": percentile_ms(&latencies_ms, 50),
        "latency_p95_ms": percentile_ms(&latencies_ms, 95),
        "per_category": ai_per_cat,
    });
    let hyb_summary = json!({
        "total_cases": hybrid_totals.total,
        "gemini_calls_needed": hybrid_gemini_calls,
        "gemini_calls_saved": cases.len() - hybrid_gemini_calls,
        "gemini_vetoes": hybrid_gemini_vetoes,
        "true_positives": hybrid_totals.true_positives,
        "true_negatives": hybrid_totals.true_negatives,
        "false_positives": hybrid_totals.false_positives,
        "false_negatives": hybrid_totals.false_negatives,
        "type_errors": hybrid_totals.type_errors,
        "date_errors": hybrid_totals.date_errors,
        "title_errors": hybrid_totals.title_errors,
        "topic_defects": hybrid_totals.topic_defects,
        "cases_with_any_fault": hybrid_totals.total_faults,
        "per_category": hybrid_per_cat,
    });
    println!("LIVE_GEMINI_STANDALONE_JSON:{ai_summary}");
    println!("LIVE_HYBRID_PIPELINE_JSON:{hyb_summary}");
    for d in &ai_failures {
        println!("AI_FAILURE:{d}");
    }
    for d in &hybrid_failures {
        println!("HYBRID_FAILURE:{d}");
    }
    assert!(
        ai_api_errors < cases.len(),
        "every live Gemini request failed ({ai_api_errors}/{})",
        cases.len()
    );
}
