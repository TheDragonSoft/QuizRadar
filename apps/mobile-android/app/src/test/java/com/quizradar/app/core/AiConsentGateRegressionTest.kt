package com.quizradar.app.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

/**
 * Regression tests for the A07 consent gate (docs/ANDROID-APP-AUDIT-2026-11-10.md
 * A07): the Rust store's `gemini_enabled` preference — not the shell — decides
 * whether a saved BYOK key can ever produce an AI request. These run against
 * the real in-memory Rust core over UniFFI, so every assertion is about the
 * actual consent boundary, not a fake.
 */
@RunWith(RobolectricTestRunner::class)
class AiConsentGateRegressionTest {
    private val refDate: LocalDate = LocalDate.parse("2026-11-11")

    // The AI exports run on UniFFI's own async-compat runtime, so the first
    // poll answers "pending" and the Rust side wakes the shell afterwards.
    // UniFFI holds its scheduler lock while it invokes that wake callback,
    // so the shell must resume the continuation OFF the wake thread: an
    // inline-resuming dispatcher (Dispatchers.Unconfined) re-enters the poll
    // and deadlocks on that lock. Dispatchers.IO resumes by dispatching -
    // the same shape the production shell uses.
    private fun engine(): QuizRadarEngine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.IO)

    private val assessmentJson =
        """
        {
            "id": "quiz-1",
            "title": "Quiz 1",
            "source": "Gmail",
            "assessment_type": "Class Quiz",
            "date_iso": "2026-11-18",
            "topics": ["Loops", "Arrays"]
        }
        """.trimIndent()

    @Test
    fun practice_quiz_with_consent_off_makes_no_ai_request_and_labels_the_fallback() =
        runTest {
            val engine = engine()
            // Consent OFF (the default) while the shell still holds a key:
            // the core must build no provider and send nothing.
            val quizJson = engine.generatePracticeQuizAi(assessmentJson, "k-test")
            val quiz = com.quizradar.app.model.QuizRadarJsonParser.parsePracticeQuiz(quizJson)

            assertTrue(
                "the on-device fallback authoring must be labeled",
                quiz.authoredLocally,
            )
            assertFalse(quiz.generatedByAi)
            assertNotNull("the fallback is never silent", quiz.fallbackReason)
            assertTrue(
                "the reason names the disabled AI state: ${quiz.fallbackReason}",
                quiz.fallbackReason!!.contains("turned off"),
            )
            assertTrue("the student still gets a real quiz", quiz.questions.isNotEmpty())
        }

    @Test
    fun practice_quiz_with_consent_on_but_no_key_names_the_missing_key() =
        runTest {
            val engine = engine()
            engine.setConfigBool("gemini_enabled", true)
            val quiz =
                com.quizradar.app.model.QuizRadarJsonParser.parsePracticeQuiz(
                    engine.generatePracticeQuizAi(assessmentJson, null),
                )

            assertTrue(quiz.authoredLocally)
            assertTrue(
                "the reason names the missing key: ${quiz.fallbackReason}",
                quiz.fallbackReason!!.contains("key"),
            )
        }

    @Test
    fun optimize_study_plan_with_consent_off_is_deterministic_and_labeled() =
        runTest {
            val engine = engine()
            val planJson = engine.optimizeStudyPlan(refDate, "k-test")
            val root = org.json.JSONObject(planJson)

            assertEquals(
                "with AI off the deterministic planner ran",
                "deterministic",
                root.optString("source"),
            )
            assertTrue(
                "the note names the disabled state: ${root.optString("note")}",
                root.optString("note").contains("turned off"),
            )
            // Real planner payload, never fabricated content.
            assertTrue(root.getJSONObject("tasks").length() > 0)
        }

    @Test
    fun optimize_study_plan_with_consent_on_but_no_key_names_the_gap() =
        runTest {
            val engine = engine()
            engine.setConfigBool("gemini_enabled", true)
            val root = org.json.JSONObject(engine.optimizeStudyPlan(refDate, null))

            assertEquals("deterministic", root.optString("source"))
            assertTrue(root.optString("note").contains("key"))
        }

    @Test
    fun extract_timetable_with_consent_off_refuses_even_with_a_key() =
        runTest {
            val engine = engine()
            val error =
                try {
                    engine.extractTimetableFromImage("aW1hZ2U=", "image/png", "k-test")
                    null
                } catch (e: Exception) {
                    e.message ?: e.toString()
                }
            assertNotNull("a disabled AI state must refuse the send", error)
            assertTrue(
                "the refusal names the setting: $error",
                error!!.contains("turned off"),
            )
        }

    @Test
    fun cancel_scan_with_nothing_in_flight_is_a_safe_no_op() =
        runTest {
            val engine = engine()
            // No scan is running; the request must not throw or poison the
            // next run (the single-flight owner resets the flag at start).
            engine.cancelScan()
        }

    @Test
    fun the_consent_flag_is_distinct_from_the_saved_key() =
        runTest {
            val engine = engine()
            // Saving a key NEVER enables AI (A07: separate key storage from
            // consent)...
            engine.tokenProvider.setGeminiApiKey("k-test")
            assertFalse(
                engine.getConfigBool("gemini_enabled", false),
            )
            // ...and enabling AI does not touch the key.
            engine.setConfigBool("gemini_enabled", true)
            assertEquals("k-test", engine.tokenProvider.getGeminiApiKey())
            engine.tokenProvider.setGeminiApiKey(null)
            assertTrue(
                "consent survives a removed key (they are separate states)",
                engine.getConfigBool("gemini_enabled", false),
            )
        }
}
