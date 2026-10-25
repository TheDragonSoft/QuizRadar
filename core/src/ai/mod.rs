//! BYOK AI provider layer (phase 06, `prompts/p06-core-cal-ai.md` +
//! `docs/rebuild/05-ai-features-plan.md`):
//!
//! - [`provider`] — typed provider seam: `AiProvider` (chat-json + vision),
//!   honest [`provider::AiError`]/[`provider::AiUnavailable`] failures, and
//!   the store-backed [`provider::QuotaLedger`] with Pacific-day resets
//! - [`gemini`] — the Google Gemini implementation: key via the
//!   `x-goog-api-key` header only, model ladder (`flash-lite` for email
//!   extraction + practice, `flash` for vision import + optimize), typed
//!   400/429/5xx errors, **no OAuth-bearer fallback** (`05` §5.2, `03` §E2)
//! - [`tasks`] — the four v5 AI call sites (`05` §4): email assessment
//!   extraction, timetable vision import, study-plan optimize, practice
//!   quizzes — every failure typed into `AiUnavailable` so shells fall back
//!   to their deterministic paths
//! - [`practice_fallback`] — the deterministic on-device question authoring
//!   (labeled `authored_locally`; no demo banks, v4's MATH 101/DATA 201/CS
//!   101 hardcoded banks are deleted)
//!
//! # Consent copy (verbatim — the UI must not paraphrase loosely)
//!
//! The enable-time disclosure from `05` §5.1 is exported as constants; the
//! Settings-AI panel and the onboarding AI card show these exact lines.

/// The one-sentence enable-time disclosure (`05` §5.1). Free-tier reality:
/// content sent to Gemini may be used by Google to improve its products —
/// hiding this would make the "100% local privacy" badge a lie.
pub const AI_DISCLOSURE: &str = "Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products.";

/// The companion opt-out line (`05` §5.1), shown next to the AI toggle.
pub const AI_LOCAL_OFF_COPY: &str = "Turn off to stay fully local.";

#[cfg(not(target_arch = "wasm32"))]
pub mod gemini;
pub mod practice_fallback;
pub mod provider;
pub mod tasks;

#[cfg(test)]
mod source_safety_tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    //! `03` §E2 enforcement: the AI layer must contain no OAuth-bearer
    //! fallback. The banned pattern is checked against the module's own
    //! sources so a future call-site cannot reintroduce it silently.

    #[test]
    fn no_authorization_bearer_pattern_in_the_ai_layer() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/ai");
        // Assembled at runtime so this test's own source never carries the
        // banned literals (it scans every .rs file in the module).
        let banned_patterns = [
            ["Authorization", ": Bearer"].concat(),
            ["bearer", "_auth("].concat(),
        ];
        let mut checked = 0usize;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).unwrap();
            for banned in &banned_patterns {
                assert!(
                    !source.contains(banned.as_str()),
                    "{path:?} contains the banned OAuth-bearer pattern {banned:?} — \
                     AI calls must authenticate with the user's BYOK key header only \
                     (05 §5.2, 03 §E2)"
                );
            }
            checked += 1;
        }
        assert!(
            checked >= 4,
            "expected the ai module sources, found {checked}"
        );
    }

    #[test]
    fn consent_copy_matches_the_plan_verbatim() {
        assert_eq!(
            super::AI_DISCLOSURE,
            "Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products."
        );
        assert_eq!(super::AI_LOCAL_OFF_COPY, "Turn off to stay fully local.");
    }
}
