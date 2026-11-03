package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.QuizRadarJsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
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
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
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
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
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

    @Test
    fun parseSyncReport_keepsEveryPerSourceOutcomeVerbatim() {
        val reportJson =
            """
            {
                "success": true,
                "totalNew": 3,
                "totalUpdated": 2,
                "notes": ["Gmail: 3 new within the 60-day window"],
                "discoveredTeams": [
                    { "id": "CS220", "name": "Data Structures", "color": "#1a73e8" }
                ],
                "perSource": [
                    { "name": "Gmail", "status": "ran", "detail": null, "found": 3, "runId": "run-1" },
                    { "name": "Teams", "status": "skipped", "detail": "not signed in", "found": 0, "runId": null },
                    { "name": "Feeds", "status": "failed", "detail": "HTTP 403 at uni.edu/ical", "found": 0, "runId": null }
                ]
            }
            """.trimIndent()

        val report = QuizRadarJsonParser.parseSyncReport(reportJson)

        assertTrue(report.success)
        assertEquals(3, report.totalNew)
        assertEquals(2, report.totalUpdated)
        assertEquals(1, report.notes.size)
        assertEquals("Gmail: 3 new within the 60-day window", report.notes.first())
        assertEquals(1, report.discoveredTeamsCount)
        assertEquals(3, report.perSource.size)

        val gmail = report.perSource[0]
        assertEquals("Gmail", gmail.name)
        assertEquals("ran", gmail.status)
        assertNull(gmail.detail)
        assertEquals(3, gmail.found)
        assertEquals("run-1", gmail.runId)

        val teams = report.perSource[1]
        assertEquals("skipped", teams.status)
        assertEquals("not signed in", teams.detail)

        val feeds = report.perSource[2]
        assertEquals("failed", feeds.status)
        assertEquals("HTTP 403 at uni.edu/ical", feeds.detail)
    }

    @Test
    fun parseSyncReport_toleratesAMinimalOrUnknownShape() {
        val report = QuizRadarJsonParser.parseSyncReport("""{"success": true}""")

        assertTrue(report.success)
        assertEquals(0, report.totalNew)
        assertEquals(0, report.totalUpdated)
        assertTrue(report.notes.isEmpty())
        assertTrue(report.perSource.isEmpty())
        assertEquals(0, report.discoveredTeamsCount)
    }

    @Test
    fun parseGcalPushReport_reportsCountsAndScopeRefusals() {
        val pushed =
            QuizRadarJsonParser.parseGcalPushReport(
                """
                {
                    "success": true, "created": 4, "updated": 1, "totalPushable": 7,
                    "failedIds": [], "skippedUndated": 2, "needsScope": false,
                    "message": null, "syncedMap": {"a1": "evt-1"}
                }
                """.trimIndent(),
            )
        assertTrue(pushed.success)
        assertEquals(4, pushed.created)
        assertEquals(1, pushed.updated)
        assertEquals(7, pushed.totalPushable)
        assertEquals(2, pushed.skippedUndated)
        assertEquals(false, pushed.needsScope)

        val refused =
            QuizRadarJsonParser.parseGcalPushReport(
                """
                { "success": false, "created": 0, "updated": 0, "totalPushable": 7,
                  "failedIds": ["a1", "a2"], "skippedUndated": 0, "needsScope": true,
                  "message": "insufficient permissions" }
                """.trimIndent(),
            )
        assertTrue(refused.needsScope)
        assertEquals(2, refused.failedIds.size)
        assertEquals("insufficient permissions", refused.message)
    }

    @Test
    fun parseDriveBackupResult_distinguishesFoundFromNoBackup() {
        val restored =
            QuizRadarJsonParser.parseDriveBackupResult(
                """
                {
                    "found": true,
                    "mergeReport": {
                        "assessments_replaced": 5, "assessments_kept_newer": 2,
                        "topics_merged": 9, "grades_merged": 3, "events_upserted": 1,
                        "feeds_upserted": 0, "schedule_replaced": true
                    }
                }
                """.trimIndent(),
            )
        assertTrue(restored.found)
        assertEquals(5, restored.mergeReport?.assessmentsReplaced)
        assertEquals(2, restored.mergeReport?.assessmentsKeptNewer)
        assertEquals(9, restored.mergeReport?.topicsMerged)
        assertEquals(3, restored.mergeReport?.gradesMerged)
        assertEquals(1, restored.mergeReport?.eventsUpserted)
        assertTrue(restored.mergeReport?.scheduleReplaced == true)

        val none =
            QuizRadarJsonParser.parseDriveBackupResult(
                """{"found": false, "mergeReport": null}""",
            )
        assertTrue(!none.found)
        assertNull(none.mergeReport)
    }
}
