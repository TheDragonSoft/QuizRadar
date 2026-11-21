//! Pure-Rust 1-Tap Shareable Course Pack codec (`https://.../#course=...` and
//! `quizradar://course?d=...`).
//!
//! Shares a single course's timetable slots and public assessment schedule
//! (titles, types, dates, weights, topics) without ever encoding personal grades,
//! completed topic checkboxes, study plans, private notes, e-learning links, or
//! OAuth credentials.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};

use crate::parse::util::{
    build_display_time, compute_priority_score, day_name_for, fnv1a64, infer_semester_from_date,
    urgency_for, weekday_index,
};
use crate::sync::qr::MAX_QR_BYTE_CAPACITY;
use crate::types::{
    Assessment, AssessmentSource, AssessmentType, Course, ScheduleData, ScheduleSlot,
};

/// Current Course Pack wire schema version.
pub const COURSE_PACK_SCHEMA_VERSION: u32 = 1;

/// Deep-link URI prefix for native desktop and Android launches.
pub const COURSE_PACK_URI_PREFIX: &str = "quizradar://course?d=";

/// Default public web companion URL (customizable via build config / parameter).
pub const COURSE_PACK_WEB_BASE_URL: &str = "https://thedragonsoft.github.io/QuizRadar/app/";

/// Maximum decompressed Course Pack payload size (2 MB defense against zip bombs).
pub const MAX_COURSE_PACK_DECOMPRESSED_BYTES: usize = 2_000_000;

/// Public-only assessment entry inside a shared Course Pack.
///
/// Personal grades (`achieved_score`, `max_score`), completion state, private
/// notes, e-learning URLs, Google Calendar links, and raw announcement text are
/// structurally excluded at the type level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoursePackAssessment {
    pub title: String,
    pub assessment_type: AssessmentType,
    #[serde(rename = "date_iso", with = "crate::types::iso_date", default)]
    pub date: Option<NaiveDate>,
    #[serde(with = "crate::types::hm_time", default)]
    pub start_time: Option<NaiveTime>,
    #[serde(with = "crate::types::hm_time", default)]
    pub end_time: Option<NaiveTime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weightage_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub topics: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// Self-contained, data-only Course Pack payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoursePackPayload {
    pub v: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub semester: Option<String>,
    pub course: Course,
    #[serde(default)]
    pub slots: Vec<ScheduleSlot>,
    #[serde(default)]
    pub assessments: Vec<CoursePackAssessment>,
}

/// Shareable URLs and QR-fit metadata generated from a [`CoursePackPayload`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoursePackShareLinks {
    pub token: String,
    pub web_url: String,
    pub deep_link: String,
    pub byte_len: usize,
    pub fits_qr: bool,
}

fn is_valid_b64url(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn normalize_web_base_url(web_base_url: Option<&str>) -> Result<String, String> {
    let raw = web_base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(COURSE_PACK_WEB_BASE_URL);

    let lower = raw.to_ascii_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://localhost")
        || lower.starts_with("http://127.0.0.1");
    if !allowed {
        return Err("Course Pack web URL must use https://.".to_string());
    }
    let without_hash = raw.split('#').next().unwrap_or(raw);
    let without_query = without_hash.split('?').next().unwrap_or(without_hash);
    Ok(without_query.to_string())
}

/// Extracts a privacy-scrubbed single-course pack from the student's schedule
/// and radar items.
pub fn build_course_pack(
    course_id: &str,
    schedule: &ScheduleData,
    assessments: &[Assessment],
) -> Result<CoursePackPayload, String> {
    let target = course_id.trim();
    if target.is_empty() {
        return Err("Select a course to share.".to_string());
    }
    let course = schedule
        .find_course(target)
        .cloned()
        .ok_or_else(|| format!("Course '{target}' was not found in your schedule."))?;

    let mut slots: Vec<ScheduleSlot> = schedule
        .slots
        .iter()
        .filter(|slot| course.matches_code(&slot.course_id))
        .cloned()
        .map(|mut slot| {
            slot.course_id = course.id.clone();
            if slot.course_name.trim().is_empty() {
                slot.course_name = course.name.clone();
            }
            // Strip any personal quiz-slot flags before sharing.
            slot.has_quiz = false;
            slot.quiz_title = None;
            slot
        })
        .collect();
    slots.sort_by(|a, b| {
        a.day_index
            .cmp(&b.day_index)
            .then_with(|| a.start_time.cmp(&b.start_time))
            .then_with(|| a.end_time.cmp(&b.end_time))
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut pack_assessments: Vec<CoursePackAssessment> = assessments
        .iter()
        .filter(|a| a.retired_source_run.is_none())
        .filter(|a| {
            a.course_id
                .as_deref()
                .is_some_and(|cid| course.matches_code(cid))
        })
        .map(|a| CoursePackAssessment {
            title: a.title.trim().to_string(),
            assessment_type: a.assessment_type,
            date: a.date,
            start_time: a.start_time,
            end_time: a.end_time,
            room: a
                .room
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            group: a
                .group
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            instructor: a
                .instructor
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            weightage_percent: a
                .weightage_percent
                .filter(|w| w.is_finite() && *w > 0.0 && *w <= 100.0),
            topics: a.topics.clone(),
            warnings: a.warnings.clone(),
        })
        .collect();

    pack_assessments.sort_by(|a, b| {
        a.date
            .is_none()
            .cmp(&b.date.is_none())
            .then_with(|| a.date.cmp(&b.date))
            .then_with(|| a.start_time.cmp(&b.start_time))
            .then_with(|| a.title.cmp(&b.title))
    });

    Ok(CoursePackPayload {
        v: COURSE_PACK_SCHEMA_VERSION,
        semester: schedule
            .semester
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        course,
        slots,
        assessments: pack_assessments,
    })
}

/// Encodes a [`CoursePackPayload`] as raw DEFLATE + unpadded Base64URL.
pub fn encode_course_pack_token(pack: &CoursePackPayload) -> Result<String, String> {
    if pack.course.id.trim().is_empty() || pack.course.name.trim().is_empty() {
        return Err("Course Pack requires a valid course code and name.".to_string());
    }
    let json =
        serde_json::to_string(pack).map_err(|e| format!("Failed to serialize Course Pack: {e}"))?;
    let compressed = miniz_oxide::deflate::compress_to_vec(json.as_bytes(), 9);
    Ok(URL_SAFE_NO_PAD.encode(&compressed))
}

/// Encodes shareable web and deep links from a [`CoursePackPayload`].
pub fn encode_course_pack_links(
    pack: &CoursePackPayload,
    web_base_url: Option<&str>,
) -> Result<CoursePackShareLinks, String> {
    let base = normalize_web_base_url(web_base_url)?;
    let token = encode_course_pack_token(pack)?;
    let web_url = format!("{base}#course={token}");
    let deep_link = format!("{COURSE_PACK_URI_PREFIX}{token}");
    let byte_len = web_url.len();
    Ok(CoursePackShareLinks {
        token,
        web_url,
        deep_link,
        byte_len,
        fits_qr: byte_len <= MAX_QR_BYTE_CAPACITY,
    })
}

fn find_param(segment: &str, keys: &[&str]) -> Option<String> {
    for pair in segment.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if keys.contains(&k.trim()) {
                let candidate = v.trim();
                if is_valid_b64url(candidate) {
                    return Some(candidate.to_string());
                }
            }
        }
    }
    None
}

/// Extracts the compressed base64url token from an HTTPS preview link,
/// `quizradar://course?d=...` deep link, hash fragment, or raw token.
pub fn extract_course_pack_token(raw_input: &str) -> Result<String, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("Paste a shared Course Pack link first.".to_string());
    }

    if let Some((_, fragment)) = trimmed.split_once('#') {
        if let Some(tok) = find_param(fragment, &["course", "d"]) {
            return Ok(tok);
        }
    }

    if let Some((_, after_query)) = trimmed.split_once('?') {
        let query = after_query.split('#').next().unwrap_or(after_query);
        if let Some(tok) = find_param(query, &["d", "course"]) {
            return Ok(tok);
        }
    }

    if is_valid_b64url(trimmed) {
        return Ok(trimmed.to_string());
    }

    Err(
        "Unrecognized Course Pack link. Expected a shared QuizRadar course URL or quizradar://course?d=... link."
            .to_string(),
    )
}

/// Decodes and validates a shared Course Pack link or token.
pub fn decode_course_pack(raw_input: &str) -> Result<CoursePackPayload, String> {
    let token = extract_course_pack_token(raw_input)?;
    let compressed = URL_SAFE_NO_PAD
        .decode(token.as_bytes())
        .map_err(|_| "Corrupted Course Pack link (invalid base64url encoding).".to_string())?;
    let decompressed = miniz_oxide::inflate::decompress_to_vec_with_limit(
        &compressed,
        MAX_COURSE_PACK_DECOMPRESSED_BYTES,
    )
    .map_err(|_| "Corrupted Course Pack link (failed to decompress payload).".to_string())?;
    let json = String::from_utf8(decompressed)
        .map_err(|_| "Corrupted Course Pack link (invalid UTF-8 payload).".to_string())?;

    let mut pack: CoursePackPayload = serde_json::from_str(&json)
        .map_err(|_| "Course Pack payload is not valid JSON.".to_string())?;

    if pack.v == 0 || pack.v > COURSE_PACK_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported Course Pack version {} (this build supports up to v{COURSE_PACK_SCHEMA_VERSION}). Update QuizRadar to import it.",
            pack.v
        ));
    }

    if pack.course.id.trim().is_empty() || pack.course.name.trim().is_empty() {
        return Err("Course Pack is missing a valid course code or name.".to_string());
    }

    for slot in &pack.slots {
        if slot.day.trim().is_empty() || (weekday_index(&slot.day).is_none() && slot.day_index > 6)
        {
            return Err(format!(
                "Course Pack contains an invalid class weekday '{}'.",
                slot.day
            ));
        }
        if slot.end_time <= slot.start_time {
            return Err(
                "Course Pack contains a class slot that ends before it starts.".to_string(),
            );
        }
    }

    for assessment in &mut pack.assessments {
        if assessment.title.trim().is_empty() {
            return Err("Course Pack contains an assessment with an empty title.".to_string());
        }
        if assessment
            .weightage_percent
            .is_some_and(|w| !w.is_finite() || w < 0.0 || w > 100.0)
        {
            return Err(format!(
                "Course Pack assessment '{}' has an invalid grade weight.",
                assessment.title
            ));
        }
        if let (Some(start), Some(end)) = (assessment.start_time, assessment.end_time) {
            if end <= start {
                assessment.end_time = None;
            }
        }
    }

    Ok(pack)
}

/// Materializes a decoded [`CoursePackPayload`] into domain [`ScheduleData`] +
/// [`Assessment`] records ready for `apply_course_bundle` at `reference_date`.
#[must_use]
pub fn course_pack_to_domain(
    pack: &CoursePackPayload,
    reference_date: NaiveDate,
) -> (ScheduleData, Vec<Assessment>) {
    let course = pack.course.clone();
    let slots: Vec<ScheduleSlot> = pack
        .slots
        .iter()
        .cloned()
        .map(|mut slot| {
            slot.course_id = course.id.clone();
            if slot.course_name.trim().is_empty() {
                slot.course_name = course.name.clone();
            }
            if let Some(idx) = weekday_index(&slot.day) {
                slot.day_index = idx;
            }
            if slot.display_time.trim().is_empty() {
                slot.display_time = format!(
                    "{}–{}",
                    slot.start_time.format("%H:%M"),
                    slot.end_time.format("%H:%M")
                );
            }
            slot.has_quiz = false;
            slot.quiz_title = None;
            slot
        })
        .collect();

    let schedule = ScheduleData {
        semester: pack.semester.clone(),
        academic_week_start: None,
        courses: vec![course.clone()],
        slots,
    };

    let source = AssessmentSource::Feed("Course Pack".to_string());
    let source_icon = Some(source.as_icon().to_string());

    let assessments = pack
        .assessments
        .iter()
        .map(|item| {
            let date_part = item
                .date
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| "tba".to_string());
            let identity_key = format!(
                "{}|{}|{}",
                course.id.trim().to_ascii_lowercase(),
                item.title.trim().to_ascii_lowercase(),
                date_part
            );
            let id = format!("shared-{:016x}", fnv1a64(identity_key.as_bytes()));
            let days_i64 = item.date.map(|d| (d - reference_date).num_days());
            let is_upcoming = days_i64.is_none_or(|d| d >= 0);

            Assessment {
                id,
                course_id: Some(course.id.clone()),
                course_name: Some(course.name.clone()),
                title: item.title.clone(),
                assessment_type: item.assessment_type,
                date: item.date,
                day_name: day_name_for(item.date),
                start_time: item.start_time,
                end_time: item.end_time,
                display_time: item
                    .date
                    .map(|d| build_display_time(d, item.start_time, item.end_time)),
                room: item.room.clone(),
                group: item.group.clone(),
                instructor: item.instructor.clone(),
                is_upcoming,
                days_until: days_i64.map(|d| i32::try_from(d).unwrap_or(i32::MAX)),
                urgency_level: urgency_for(days_i64),
                priority_score: compute_priority_score(
                    days_i64,
                    item.assessment_type,
                    item.topics.len(),
                ),
                topics: item.topics.clone(),
                warnings: item.warnings.clone(),
                ai_inference_note: Some("Imported from shared Course Pack".to_string()),
                ai_study_plan: None,
                estimated_study_hours: None,
                elearning_url: None,
                google_cal_url: None,
                gcal_synced: false,
                gcal_event_id: None,
                color: Some(course.color.clone()),
                bg: course.bg.clone(),
                border: course.border.clone(),
                semester: pack
                    .semester
                    .clone()
                    .or_else(|| item.date.map(infer_semester_from_date)),
                email_subject: None,
                email_sent_date: None,
                source: source.clone(),
                source_icon: source_icon.clone(),
                weightage_percent: item.weightage_percent,
                achieved_score: None,
                max_score: None,
                conflict_warning: None,
                last_seen_source_run: None,
                retired_source_run: None,
            }
        })
        .collect();

    (schedule, assessments)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::plan::fixtures::{assessment_on, ref_date};

    fn sample_schedule() -> ScheduleData {
        ScheduleData {
            semester: Some("Fall 2026".to_string()),
            academic_week_start: None,
            courses: vec![
                Course {
                    id: "ECE210".to_string(),
                    name: "Digital Systems".to_string(),
                    color: "#1a73e8".to_string(),
                    bg: Some("#1a73e818".to_string()),
                    border: Some("#1a73e855".to_string()),
                    credits: Some(3.0),
                    max_absences: Some(4),
                    aliases: vec!["ECE 210".to_string()],
                },
                Course {
                    id: "MATH204".to_string(),
                    name: "Linear Algebra".to_string(),
                    color: "#0f9d58".to_string(),
                    bg: None,
                    border: None,
                    credits: Some(3.0),
                    max_absences: None,
                    aliases: Vec::new(),
                },
            ],
            slots: vec![
                ScheduleSlot {
                    id: "slot-1".to_string(),
                    day: "Monday".to_string(),
                    day_index: 1,
                    course_id: "ECE210".to_string(),
                    course_name: "Digital Systems".to_string(),
                    slot_type: "Lecture".to_string(),
                    group: Some("Sec 1".to_string()),
                    room: Some("Eng 204".to_string()),
                    start_time: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
                    end_time: NaiveTime::from_hms_opt(11, 30, 0).unwrap(),
                    display_time: "10:00–11:30".to_string(),
                    has_quiz: true,
                    quiz_title: Some("Private personal reminder".to_string()),
                    week_parity: None,
                },
                ScheduleSlot {
                    id: "slot-2".to_string(),
                    day: "Tuesday".to_string(),
                    day_index: 2,
                    course_id: "MATH204".to_string(),
                    course_name: "Linear Algebra".to_string(),
                    slot_type: "Lecture".to_string(),
                    group: None,
                    room: None,
                    start_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                    end_time: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
                    display_time: "09:00–10:00".to_string(),
                    has_quiz: false,
                    quiz_title: None,
                    week_parity: None,
                },
            ],
        }
    }

    #[test]
    fn course_pack_round_trips_all_uri_formats_and_excludes_private_fields() {
        let schedule = sample_schedule();
        let mut mid = assessment_on(
            "gmail-mid",
            Some("ECE210"),
            "Midterm Exam",
            NaiveDate::from_ymd_opt(2026, 11, 5),
            vec!["Boolean Algebra", "State Machines"],
        );
        mid.weightage_percent = Some(30.0);
        mid.achieved_score = Some(92.5);
        mid.max_score = Some(100.0);
        mid.elearning_url =
            Some("https://moodle.univ.edu/mod/quiz/view.php?token=SECRET_TOKEN".to_string());
        mid.google_cal_url = Some("https://calendar.google.com/event?eid=SECRET_EID".to_string());
        mid.gcal_synced = true;
        mid.gcal_event_id = Some("gcal-evt-secret".to_string());
        mid.ai_study_plan = Some("Private study plan note".to_string());

        let mut retired = assessment_on(
            "gmail-old",
            Some("ECE210"),
            "Cancelled Quiz",
            NaiveDate::from_ymd_opt(2026, 11, 1),
            vec![],
        );
        retired.retired_source_run = Some("gmail-run-1".to_string());

        let other_course = assessment_on(
            "math-q1",
            Some("MATH204"),
            "Quiz 1",
            NaiveDate::from_ymd_opt(2026, 10, 29),
            vec![],
        );

        let pack = build_course_pack("ECE210", &schedule, &[mid, retired, other_course]).unwrap();
        assert_eq!(pack.course.id, "ECE210");
        assert_eq!(pack.slots.len(), 1);
        assert!(!pack.slots[0].has_quiz);
        assert_eq!(pack.slots[0].quiz_title, None);
        assert_eq!(pack.assessments.len(), 1);

        let serialized = serde_json::to_string(&pack).unwrap();
        for secret in [
            "92.5",
            "achieved_score",
            "max_score",
            "SECRET_TOKEN",
            "SECRET_EID",
            "gcal-evt-secret",
            "Private study plan note",
            "Private personal reminder",
            "Cancelled Quiz",
            "MATH204",
        ] {
            assert!(
                !serialized.contains(secret),
                "Course Pack leaked private or unrelated field '{secret}': {serialized}"
            );
        }

        let links = encode_course_pack_links(&pack, None).unwrap();
        assert!(links.web_url.starts_with(COURSE_PACK_WEB_BASE_URL));
        assert!(links.web_url.contains("#course="));
        assert!(links.deep_link.starts_with(COURSE_PACK_URI_PREFIX));

        for input in [
            links.web_url.as_str(),
            &format!("https://quizradar.app/?course={}", links.token),
            links.deep_link.as_str(),
            links.token.as_str(),
        ] {
            let decoded = decode_course_pack(input).unwrap();
            assert_eq!(decoded, pack);
        }

        let (domain_sched, domain_assessments) = course_pack_to_domain(&pack, ref_date());
        assert_eq!(domain_sched.courses.len(), 1);
        assert_eq!(domain_sched.slots.len(), 1);
        assert_eq!(domain_assessments.len(), 1);
        assert_eq!(domain_assessments[0].achieved_score, None);
        assert_eq!(domain_assessments[0].weightage_percent, Some(30.0));
        assert!(domain_assessments[0].id.starts_with("shared-"));
        assert_eq!(
            domain_assessments[0].source,
            AssessmentSource::Feed("Course Pack".to_string())
        );
    }

    #[test]
    fn decode_course_pack_rejects_future_versions_and_junk() {
        let mut pack = build_course_pack("ECE210", &sample_schedule(), &[]).unwrap();
        pack.v = 99;
        let token = encode_course_pack_token(&pack).unwrap();
        let err = decode_course_pack(&token).unwrap_err();
        assert!(err.contains("Unsupported Course Pack version"), "{err}");

        assert!(decode_course_pack("").is_err());
        assert!(decode_course_pack("not-valid-base64!!").is_err());
        assert!(encode_course_pack_links(&pack, Some("http://insecure.example.com/")).is_err());
    }
}
