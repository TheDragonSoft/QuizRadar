package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.QuizRadarJsonParser
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
class QuizRadarJsonParserTest {
    @Test
    fun parseAppSnapshot_parses_core_snapshot_successfully() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()
            val refDate = LocalDate.parse("2026-10-25")

            val json = engine.getState(refDate)
            val snapshot = QuizRadarJsonParser.parseAppSnapshot(json)

            assertNotNull(snapshot)
            assertNotNull(snapshot.schedule)
            assertNotNull(snapshot.dashboard)
            assertNotNull(snapshot.tasks)
            assertEquals(refDate, snapshot.dashboard.referenceDate)
            assertEquals(100, snapshot.dashboard.readinessPercent)
        }

    @Test
    fun parsePracticeQuiz_parses_generated_mcqs() {
        val engine = QuizRadarEngine.createInMemory()
        val assessmentJson =
            """
            {
                "id": "quiz-1",
                "title": "Quiz 1",
                "course_id": "CS101",
                "course_name": "Intro to CS",
                "assessment_type": "Class Quiz",
                "topics": ["Binary Trees", "Graphs"],
                "warnings": []
            }
            """.trimIndent()

        val quizJson = engine.generatePracticeQuiz(assessmentJson)
        val quiz = QuizRadarJsonParser.parsePracticeQuiz(quizJson)

        assertEquals("quiz-1", quiz.assessmentId)
        assertTrue("Questions must not be empty", quiz.questions.isNotEmpty())
        assertTrue("Must be authored locally", quiz.authoredLocally)
        val firstQ = quiz.questions.first()
        assertTrue("Options must contain at least 2 choices", firstQ.options.size >= 2)
        assertTrue("Correct index must be within options range", firstQ.correctIndex in 0 until firstQ.options.size)
    }

    @Test
    fun parseAppSnapshot_carriesTheCoreConflictChipOntoTheRadarList() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()
            val refDate = LocalDate.parse("2026-10-25")

            // Two dated assessments on the same day: the core detects the
            // clash and stamps the per-assessment conflict chip.
            engine.replaceAssessments(
                """
                [
                    {
                        "id": "a1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-10-30",
                        "topics": [],
                        "warnings": [],
                        "source": "Gmail"
                    },
                    {
                        "id": "a2",
                        "title": "Midterm",
                        "course_id": "MATH101",
                        "assessment_type": "Midterm Exam",
                        "date_iso": "2026-10-30",
                        "topics": [],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent(),
                refDate,
            )

            val snapshot = QuizRadarJsonParser.parseAppSnapshot(engine.getState(refDate))

            assertTrue(
                "the core must detect the same-day clash",
                snapshot.dashboard.conflictAlerts.isNotEmpty(),
            )
            assertEquals(
                "every clashing assessment carries the chip",
                2,
                snapshot.assessments.count { it.conflictWarning != null },
            )
        }
}
