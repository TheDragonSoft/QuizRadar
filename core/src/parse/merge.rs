//! Merge/dedupe semantics shared by every source pipeline (announcement
//! email scan, ICS feeds, phase-03 planner refresh).
//!
//! One scan dedupes by [`merge_key`] (first wins). Refresh semantics —
//! user-owned fields (`weightage_percent`, `achieved_score`, `max_score`,
//! `gcal_synced`, `gcal_event_id`) survive reannouncement — belong to the
//! planner (phase 03) and reuse this same key.

use crate::types::{Assessment, AssessmentSource};

/// Stable dedupe key: `source-label|course-code|title|date-or-empty`, all
/// ASCII-lowercased and trimmed. v4's key was built from the same parts but
/// unnormalized, so case drift created phantom duplicates.
#[must_use]
pub fn merge_key(assessment: &Assessment) -> String {
    let source = match &assessment.source {
        AssessmentSource::Feed(name) => name.trim().to_ascii_lowercase(),
        other => other.as_str().trim().to_ascii_lowercase(),
    };
    format!(
        "{}|{}|{}|{}",
        source,
        assessment
            .course_id
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_ascii_lowercase(),
        assessment.title.trim().to_ascii_lowercase(),
        assessment
            .date
            .map(|date| date.format("%Y-%m-%d").to_string())
            .unwrap_or_default(),
    )
}
