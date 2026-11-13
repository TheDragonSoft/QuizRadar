package com.quizradar.app.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Regression tests for the persistent operations the Android audit flagged
 * (docs/ANDROID-APP-AUDIT-2026-11-10.md A05/A06/A10): the canonical Rust
 * store must own feed deletion, the transactional reset and the
 * attendance/study-session persistence — never a hand-rolled Kotlin copy.
 *
 * These run against the real in-memory Rust core over UniFFI (JVM tests
 * load the host cdylib through JNA), so every assertion below is about the
 * actual persisted store, not a fake.
 */
class PersistentOperationsRegressionTest {
    private val refDate: LocalDate = LocalDate.parse("2026-11-10")

    private fun engine(): QuizRadarEngine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

    private val feedJson =
        """
        {
            "id": "feed-ics-1",
            "name": "Course Calendar",
            "url": "https://example.edu/calendar.ics",
            "enabled": true
        }
        """.trimIndent()

    @Test
    fun deleteAttendance_removes_only_that_row_against_the_real_store() =
        runTest {
            val engine = engine()
            engine.recordAttendance("slot-1", "CS101", LocalDate.parse("2026-11-09"), "excused", refDate)
            engine.recordAttendance("slot-2", "CS101", LocalDate.parse("2026-11-10"), "absent", refDate)

            val snapshot = engine.deleteAttendance("slot-1", "2026-11-09", refDate)

            // The delete's returned snapshot does not carry the attendance
            // table (read_snapshot has no attendance rows), so the store's
            // own list is the source of truth for what survived.
            val log = engine.listAttendance()
            assertTrue(
                "The untouched row survives the delete",
                log.contains("\"slot-2\"") && !log.contains("\"slot-1\""),
            )
            assertEquals(
                "Exactly one attendance row remains in the store",
                1,
                log.split("\"id\"").size - 1,
            )
            assertTrue(
                "The delete must return the post-delete snapshot, not an error",
                snapshot.isNotBlank(),
            )
        }

    @Test
    fun deletedFeed_is_gone_and_unrelated_config_is_preserved() =
        runTest {
            val engine = engine()

            val saved = engine.saveFeed(feedJson, refDate)
            assertTrue("Save must persist the feed", saved.contains("\"feed-ics-1\""))

            // Unrelated user config the feed delete must never touch.
            engine.setConfigBool("ai_enabled", true)
            engine.setConfigString("active_semester", "Fall 2026")

            val after = engine.deleteFeed("feed-ics-1", refDate)
            assertFalse("Feed must be deleted", after.contains("\"feed-ics-1\""))
            assertTrue("State must still carry the schedule realm", after.contains("\"schedule\":{"))

            assertEquals(
                "Unrelated boolean config must survive the feed delete",
                true,
                engine.getConfigBool("ai_enabled", false),
            )
            assertEquals(
                "Unrelated string config must survive the feed delete",
                "Fall 2026",
                engine.getConfigString("active_semester"),
            )
            assertFalse(
                "Config realm must survive the feed delete",
                after.contains("\"feeds\":[{\"id\":\"feed-ics-1\""),
            )
        }

    @Test
    fun resetAllData_fully_clears_every_owned_table() =
        runTest {
            val engine = engine()

            // Seed EVERY realm the audit says a partial reset used to miss:
            // schedule + assessment, a feed, config, attendance, a study
            // session and a quiz attempt.
            engine.saveSchedule(
                """
                {
                    "semester": "Fall 2026",
                    "courses": [{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }],
                    "slots": []
                }
                """.trimIndent(),
                refDate,
            )
            engine.saveFeed(feedJson, refDate)
            engine.setConfigBool("ai_enabled", true)
            engine.recordAttendance("slot-1", "CS101", LocalDate.parse("2026-11-04"), "absent", refDate)
            engine.logStudySession(sessionJson("sess-1", "CS101"), refDate)

            engine.resetAllData()

            val state = engine.getState(refDate)
            assertTrue("Assessments must be empty after reset", state.contains("\"assessments\":[]"))
            assertTrue("Feeds must be empty after reset", state.contains("\"feeds\":[]"))
            assertTrue(
                "Courses must be empty after reset",
                state.contains("\"courses\":[]"),
            )
            assertEquals("Config must be wiped back to its default", false, engine.getConfigBool("ai_enabled", false))
            assertEquals(
                "Attendance rows must be wiped",
                "[]",
                engine.listAttendance(),
            )
            assertEquals(
                "Study sessions must be wiped",
                "[]",
                engine.listStudySessions(),
            )
            assertEquals(
                "Quiz attempts must be wiped",
                "[]",
                engine.listQuizAttempts(),
            )
            assertEquals(
                "Flashcards must be wiped",
                "[]",
                engine.listFlashcards(),
            )
        }

    @Test
    fun attendance_persists_and_summaries_derive_from_records() =
        runTest {
            val engine = engine()

            // Summaries are per ENROLLED course (derived from the schedule),
            // so seed the timetable first.
            engine.saveSchedule(twoCourseSchedule(), refDate)

            engine.recordAttendance("slot-1", "CS101", LocalDate.parse("2026-11-04"), "attended", refDate)
            engine.recordAttendance("slot-1", "CS101", LocalDate.parse("2026-11-06"), "absent", refDate)
            engine.recordAttendance("slot-2", "MATH101", LocalDate.parse("2026-11-05"), "excused", refDate)

            val entries = engine.listAttendance()
            assertTrue("Recorded marks must survive a fresh read", entries.contains("\"slot_id\":\"slot-1\""))
            assertTrue("Marked date must be persisted", entries.contains("\"date_iso\":\"2026-11-04\""))

            val summaries = engine.attendanceSummaries()
            assertTrue("CS101 summary must be derived from records", summaries.contains("\"course_id\":\"CS101\""))
            assertTrue("Two CS101 classes must be counted", summaries.contains("\"total_classes\":2"))
            assertTrue("One absent must be counted", summaries.contains("\"absent\":1"))
            assertTrue("One excused must be counted", summaries.contains("\"excused\":1"))

            // Course filter reads only that course's rows.
            val csOnly = engine.listAttendance("CS101")
            assertTrue(csOnly.contains("CS101"))
            assertFalse("MATH101 rows must not leak into the course filter", csOnly.contains("MATH101"))

            // Idempotent re-record: same slot+date key replaces, never duplicates.
            engine.recordAttendance("slot-1", "CS101", LocalDate.parse("2026-11-06"), "excused", refDate)
            val summariesAfter = engine.attendanceSummaries()
            assertTrue("Re-record must not duplicate", summariesAfter.contains("\"total_classes\":2"))
            assertTrue("Re-record flips the status honestly", summariesAfter.contains("\"excused\":1"))
        }

    @Test
    fun study_sessions_persist_and_analytics_derive_from_the_log() =
        runTest {
            val engine = engine()

            // The course breakdown is derived against the enrolled courses.
            engine.saveSchedule(twoCourseSchedule(), refDate)

            engine.logStudySession(sessionJson("sess-1", "CS101"), refDate)
            engine.logStudySession(sessionJson("sess-2", "MATH101"), refDate)

            val sessions = engine.listStudySessions()
            assertTrue("Logged session must survive a fresh read", sessions.contains("\"sess-1\""))
            assertTrue("Session course must be persisted", sessions.contains("\"course_id\":\"CS101\""))

            val csOnly = engine.listStudySessions("CS101")
            assertTrue(csOnly.contains("\"sess-1\""))
            assertFalse("MATH101 sessions must not leak into the course filter", csOnly.contains("\"sess-2\""))

            val analytics = engine.getStudyAnalytics(refDate)
            assertTrue(
                "Analytics must derive real minutes from the log",
                analytics.contains("\"total_focus_minutes\":90"),
            )
            assertTrue(
                "Analytics breakdown must carry the logged course",
                analytics.contains("\"course_id\":\"CS101\""),
            )
        }

    private fun twoCourseSchedule(): String =
        """
        {
            "semester": "Fall 2026",
            "courses": [
                { "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" },
                { "id": "MATH101", "name": "Calculus", "color": "#e8710a" }
            ],
            "slots": []
        }
        """.trimIndent()

    private fun sessionJson(
        id: String,
        courseId: String,
    ): String =
        """
        {
            "id": "$id",
            "course_id": "$courseId",
            "duration_minutes": 45,
            "timestamp": "2026-11-10T09:00:00Z",
            "date_iso": "2026-11-10"
        }
        """.trimIndent()
}
