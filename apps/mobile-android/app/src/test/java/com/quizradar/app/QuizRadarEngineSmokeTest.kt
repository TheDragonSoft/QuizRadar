package com.quizradar.app

import com.quizradar.app.core.MemoryTokenStore
import com.quizradar.app.core.QuizRadarEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class QuizRadarEngineSmokeTest {
    @Test
    fun coreVersion_matches_app_version() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
            val version = engine.version()
            assertEquals(BuildConfig.VERSION_NAME, version)
        }

    @Test
    fun tokenProvider_manages_secrets_without_exposure() {
        val tokens = MemoryTokenStore()
        val engine = QuizRadarEngine.createInMemory(tokens)

        engine.tokenProvider.setGoogleRefreshToken("secret_refresh_token")
        assertEquals("secret_refresh_token", engine.tokenProvider.getGoogleRefreshToken())

        engine.tokenProvider.setGoogleAccessToken("ephemeral_access_token")
        assertEquals("ephemeral_access_token", engine.tokenProvider.getGoogleAccessToken())

        engine.tokenProvider.setGeminiApiKey("AIzaSyFakeKey123")
        assertEquals("AIzaSyFakeKey123", engine.tokenProvider.getGeminiApiKey())

        engine.tokenProvider.clearAll()
        assertEquals(null, engine.tokenProvider.getGoogleRefreshToken())
        assertEquals(null, engine.tokenProvider.getGoogleAccessToken())
        assertEquals(null, engine.tokenProvider.getGeminiApiKey())
    }

    @Test
    fun inMemoryStore_roundtrips_state_and_schedule() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
            val refDate = LocalDate.parse("2026-10-25")

            val stateJson = engine.getState(refDate)
            assertTrue("State must contain assessments array", stateJson.contains("\"assessments\":[]"))
            assertTrue("State must contain schedule", stateJson.contains("\"schedule\":{"))

            val scheduleJson =
                """
                {
                    "semester": "Fall 2026",
                    "courses": [
                        { "id": "CS101", "name": "Intro to Computer Science", "color": "#1a73e8" }
                    ],
                    "slots": [
                        {
                            "id": "slot-1",
                            "day": "Mon",
                            "course_id": "CS101",
                            "course_name": "Intro to Computer Science",
                            "type": "Lecture",
                            "start_time": "09:00",
                            "end_time": "10:30",
                            "display_time": "09:00–10:30"
                        }
                    ]
                }
                """.trimIndent()

            val updatedState = engine.saveSchedule(scheduleJson, refDate)
            assertTrue("Updated state must contain CS101", updatedState.contains("CS101"))
        }

    @Test
    fun pureDerivations_run_through_uniffi() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

            val assessmentsJson =
                """
                [
                    {
                        "id": "quiz-1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "course_name": "Intro to CS",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-10-30",
                        "day_name": "Friday",
                        "start_time": "09:00",
                        "end_time": "10:00",
                        "display_time": "09:00 – 10:00",
                        "room": "Hall 1",
                        "is_upcoming": true,
                        "days_until": 5,
                        "urgency_level": "high",
                        "priority_score": 85,
                        "topics": ["Algorithms", "Data Structures"],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent()

            val ics = engine.exportIcs(assessmentsJson, "quiz-1")
            assertTrue("ICS export must have VCALENDAR header", ics.contains("BEGIN:VCALENDAR"))
            assertTrue("ICS export must have summary", ics.contains("SUMMARY:[CS101] Quiz 1"))

            val practice =
                engine.generatePracticeQuiz(
                    """
                    {
                        "id": "quiz-1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "course_name": "Intro to CS",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-10-30",
                        "day_name": "Friday",
                        "start_time": "09:00",
                        "end_time": "10:00",
                        "display_time": "09:00 – 10:00",
                        "room": "Hall 1",
                        "is_upcoming": true,
                        "days_until": 5,
                        "urgency_level": "high",
                        "priority_score": 85,
                        "topics": ["Binary Search", "Sorting"],
                        "warnings": [],
                        "source": "Gmail"
                    }
                    """.trimIndent(),
                )
            assertNotNull(practice)
            assertTrue("Practice quiz must contain questions", practice.contains("questions"))
        }

    @Test
    fun deriveStudyTasks_differentiates_academic_tracks() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

            // Assessment 10 days out from ref date (2026-10-20 -> 2026-10-30), with 8 topics
            val assessmentsJson =
                """
                [
                    {
                        "id": "exam-1",
                        "title": "Comprehensive Midterm",
                        "course_id": "CS101",
                        "course_name": "Computer Science",
                        "assessment_type": "Midterm Exam",
                        "date_iso": "2026-10-30",
                        "day_name": "Friday",
                        "start_time": "09:00",
                        "end_time": "11:00",
                        "display_time": "09:00 – 11:00",
                        "room": "Hall A",
                        "is_upcoming": true,
                        "days_until": 10,
                        "urgency_level": "medium",
                        "priority_score": 90,
                        "topics": [
                            "Topic 1", "Topic 2", "Topic 3", "Topic 4",
                            "Topic 5", "Topic 6", "Topic 7", "Topic 8"
                        ],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent()

            val refDate = LocalDate.parse("2026-10-20")
            val tasksMed = engine.deriveStudyTasks(assessmentsJson, "{}", refDate, "med")
            val tasksEng = engine.deriveStudyTasks(assessmentsJson, "{}", refDate, "eng")
            val tasksBiz = engine.deriveStudyTasks(assessmentsJson, "{}", refDate, "biz")

            // Med (7d prep), Eng (5d prep), and Biz (3d prep) presets must produce distinct task distributions
            assertNotNull(tasksMed)
            assertNotNull(tasksEng)
            assertNotNull(tasksBiz)
            org.junit.Assert.assertNotEquals("Med and Eng plans must differ", tasksMed, tasksEng)
            org.junit.Assert.assertNotEquals("Eng and Biz plans must differ", tasksEng, tasksBiz)
            org.junit.Assert.assertNotEquals("Med and Biz plans must differ", tasksMed, tasksBiz)
        }
}
