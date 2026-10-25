//! The honest on-device practice fallback (`01` §4.7, `05` §3.5): a
//! deterministic framework quiz authored from the assessment's OWN topics.
//!
//! v4 shipped hardcoded demo banks (MATH 101 / DATA 201 / CS 101) and
//! invented professor-sounding explanations; both are deleted. What v5 writes
//! instead is a *topical study-approach MCQ* per real topic: the question
//! and options honestly talk about study strategy for that exact topic —
//! they never fabricate domain content, quotes or statistics the app cannot
//! know. The payload is labeled `authored_locally` and its
//! [`crate::ai::provider::AiCreditNote`] names `OnDevice`, so it can never
//! masquerade as AI output.

use crate::ai::provider::AiCreditNote;
use crate::ai::tasks::{PracticeQuestion, PracticeQuizPayload};
use crate::types::Assessment;

/// Maximum questions per quiz (v4: 5).
const MAX_QUESTIONS: usize = 5;

/// Authors the practice quiz locally, deterministically from the
/// assessment's real topics (or three honest framework questions when the
/// sources posted no topic list). No network, no AI, no demo banks.
#[must_use]
pub fn generate_practice_locally(assessment: &Assessment) -> PracticeQuizPayload {
    let course_label = assessment
        .course_id
        .as_deref()
        .unwrap_or("this course")
        .to_string();

    let questions: Vec<PracticeQuestion> = if assessment.topics.is_empty() {
        generic_framework_questions(assessment)
            .into_iter()
            .take(MAX_QUESTIONS)
            .collect()
    } else {
        assessment
            .topics
            .iter()
            .take(MAX_QUESTIONS)
            .enumerate()
            .map(|(index, topic)| topical_question(index, topic, &course_label))
            .collect()
    };

    PracticeQuizPayload {
        assessment_id: assessment.id.clone(),
        course_id: assessment.course_id.clone(),
        assessment_title: assessment.title.clone(),
        questions,
        generated_by_ai: false,
        authored_locally: true,
        credit: AiCreditNote::on_device(),
    }
}

/// One study-approach MCQ for a real topic. The four options are a fixed
/// honest framework (one sound approach, three recognizable traps); the
/// correct answer's position rotates by question index so the quiz is not
/// trivially "always pick A" while staying fully deterministic.
fn topical_question(index: usize, topic: &str, course_label: &str) -> PracticeQuestion {
    let options: Vec<String> = vec![
        format!(
            "Work through the \"{topic}\" lecture materials and practice problems step by step, checking each result as you go."
        ),
        "Memorize final answers without working through the underlying steps yourself.".to_string(),
        format!("Skim the \"{topic}\" materials once, minutes before the assessment starts."),
        "Rely on unverified online summaries instead of the assigned course materials.".to_string(),
    ];
    let shift = index % options.len();
    let (options, correct_index) = rotate_correct(options, shift);

    PracticeQuestion {
        id: format!("q{}", index + 1),
        question: format!("Which study approach best prepares you for \"{topic}\" in {course_label}?"),
        options,
        correct_index,
        explanation: format!(
            "Step-by-step practice with the assigned \"{topic}\" materials — checking every result — is the reliable preparation path for {course_label}. No shortcut substitutes for working through the problems yourself."
        ),
    }
}

/// The three honest framework questions when the assessment carries no
/// topics at all (ported from the v4 JS fallback's spirit, no demo banks).
fn generic_framework_questions(assessment: &Assessment) -> Vec<PracticeQuestion> {
    let frameworks: [(&str, [&str; 4], &str); 3] = [
        (
            "What is the most reliable way to prepare for this assessment?",
            [
                "Review the announced topics and their practice problems step by step.",
                "Memorize answers you cannot reproduce or explain.",
                "Ignore the instructor's posted warnings and instructions.",
                "Leave preparation to the final hour before the assessment.",
            ],
            "Working through the announced topics and their practice problems step by step is the preparation path that holds up under exam conditions.",
        ),
        (
            "How should you treat the warnings posted for this assessment?",
            [
                "Follow each posted instruction exactly — materials, timing and rules.",
                "Treat them as boilerplate that applies to other sections.",
                "Improvise substitutes for the required materials.",
                "Assume the rules will be relaxed on the day.",
            ],
            "Posted warnings are the examiner's instructions — following them exactly is the only strategy that removes avoidable risk.",
        ),
        (
            "What does an honest final-day review look like?",
            [
                "A focused pass over your weakest topic plus a checklist of required materials.",
                "An all-night cram covering every topic equally.",
                "Skipping practice entirely to stay calm.",
                "Hoping the hardest topics simply do not appear.",
            ],
            "A focused final-day pass targets the weakest known topic and confirms the required materials — breadth-equal cramming is how details get lost.",
        ),
    ];

    frameworks
        .iter()
        .enumerate()
        .map(|(index, (question, options, explanation))| {
            let options: Vec<String> = options.iter().map(|option| (*option).to_string()).collect();
            let shift = index % options.len();
            let (options, correct_index) = rotate_correct(options, shift);
            PracticeQuestion {
                id: format!("q{}", index + 1),
                question: format!("{} ({})", question, assessment.title),
                options,
                correct_index,
                explanation: (*explanation).to_string(),
            }
        })
        .collect()
}

/// Rotates the option list so the correct answer (index 0 before rotation)
/// lands on position `shift`; returns the rotated list and the new index.
fn rotate_correct(mut options: Vec<String>, shift: usize) -> (Vec<String>, usize) {
    let shift = if options.is_empty() {
        0
    } else {
        shift % options.len()
    };
    options.rotate_right(shift);
    (options, shift)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::ai::provider::AiSource;
    use crate::plan::fixtures::assessment_on;
    use chrono::Duration;

    #[test]
    fn is_deterministic_same_input_same_output() {
        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            Some(crate::plan::fixtures::ref_date() + Duration::days(3)),
            vec!["Recursion", "Loops"],
        );
        let first = generate_practice_locally(&assessment);
        let second = generate_practice_locally(&assessment);
        assert_eq!(first, second, "no clock, no RNG — byte-identical quizzes");
    }

    #[test]
    fn writes_one_honest_question_per_real_topic() {
        let assessment = assessment_on(
            "gmail-1",
            Some("CSE241"),
            "Quiz 1",
            None,
            vec![
                "Recursion",
                "Loops",
                "Inheritance",
                "Polymorphism",
                "Encapsulation",
                "Extra",
            ],
        );
        let payload = generate_practice_locally(&assessment);
        assert_eq!(
            payload.questions.len(),
            5,
            "capped at 5, never padded with filler"
        );
        for (index, question) in payload.questions.iter().enumerate() {
            let topic = &assessment.topics[index];
            assert!(
                question.question.contains(topic.as_str()),
                "question {index} covers its own topic"
            );
            assert!(question.options.iter().all(|option| !option.is_empty()));
            assert!(question.correct_index < question.options.len());
            assert!(!question.explanation.is_empty());
        }
        // The correct answer's position rotates — not always the same slot.
        let positions: Vec<usize> = payload.questions.iter().map(|q| q.correct_index).collect();
        assert_eq!(positions, vec![0, 1, 2, 3, 0]);
    }

    #[test]
    fn topicless_assessments_get_three_framework_questions() {
        let assessment = assessment_on("gmail-1", None, "Surprise Quiz", None, vec![]);
        let payload = generate_practice_locally(&assessment);
        assert_eq!(payload.questions.len(), 3);
        assert!(payload.questions[0].question.contains("Surprise Quiz"));
        assert!(payload
            .questions
            .iter()
            .all(|q| q.correct_index < q.options.len()));
    }

    #[test]
    fn the_payload_is_labeled_authored_locally_and_never_ai() {
        let assessment =
            assessment_on("gmail-1", Some("CSE241"), "Quiz 1", None, vec!["Recursion"]);
        let payload = generate_practice_locally(&assessment);
        assert!(payload.authored_locally);
        assert!(!payload.generated_by_ai);
        assert_eq!(payload.credit.source, AiSource::OnDevice);
        assert_eq!(payload.assessment_id, "gmail-1");
        assert_eq!(payload.course_id.as_deref(), Some("CSE241"));
    }

    #[test]
    fn no_demo_banks_or_invented_domain_content() {
        let assessment = assessment_on(
            "gmail-1",
            Some("MATH101"),
            "Quiz 1",
            None,
            vec!["Simpson's 1/3 Rule"],
        );
        let payload = generate_practice_locally(&assessment);
        let all_text = payload
            .questions
            .iter()
            .flat_map(|question| {
                std::iter::once(question.question.as_str())
                    .chain(question.options.iter().map(String::as_str))
                    .chain(std::iter::once(question.explanation.as_str()))
            })
            .collect::<Vec<_>>()
            .join("\n");

        // The quiz talks about studying "Simpson's 1/3 Rule" (the real
        // topic) but never fabricates the v4 demo bank's mathematical
        // content about it.
        assert!(all_text.contains("Simpson's 1/3 Rule"));
        assert!(
            !all_text.contains("sub-intervals"),
            "no recycled demo-bank math"
        );
        assert!(
            !all_text.contains("Trapezoidal"),
            "no recycled demo-bank math"
        );
        assert!(
            !all_text.contains("k-Nearest"),
            "no other course's bank leaks in"
        );
        assert!(!all_text.contains("Prof."), "no invented professor quotes");
    }
}
