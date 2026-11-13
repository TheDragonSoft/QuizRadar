package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarCore
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.ScheduleSlotModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

/**
 * A core whose transactional reset always fails - the shell must report
 * "Reset failed" and leave the store untouched, never claim "All data and
 * credentials reset" for a half-done wipe (audit A05).
 */
private class FailingResetCore(
    delegate: QuizRadarCore,
) : QuizRadarCore by delegate {
    override suspend fun resetAllData(): Unit = throw IllegalStateException("store rejected reset")
}

/**
 * ViewModel-level regressions for the persistent student state the Android
 * audit flagged (docs/ANDROID-APP-AUDIT-2026-11-10.md A02/A05/A06/A10): feed
 * deletion is a real store operation that leaves unrelated preferences
 * alone, the reset is the core's transactional wipe, focus analytics start
 * empty and are derived from the persisted session log, attendance is
 * persisted with an explicit slot/course/date association, and course
 * metadata (credits, absence limit, slot week parity) survives an edit.
 *
 * These run against the real in-memory Rust core over UniFFI, so every
 * assertion is about the actual persisted store - no fake, no seeded
 * examples.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PersistentStudentStateRegressionTest {
    private val testDispatcher = StandardTestDispatcher()
    private val testDate = LocalDate.parse("2026-11-10")

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun engine(): QuizRadarEngine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)

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
    fun freshInstall_starts_with_empty_analytics_and_no_attendance() =
        runTest {
            val viewModel = QuizRadarViewModel(engine(), clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            assertEquals(
                "No fabricated example courses (audit A06: the old CS=150/MATH=90/BIO=45 seed)",
                emptyMap<String, Int>(),
                viewModel.studyMinutesByCourse.value,
            )
            assertEquals(
                "No fabricated starter streak (the old hardcoded 4)",
                0,
                viewModel.studyStreakDays.value,
            )
            assertEquals(emptyMap<String, String>(), viewModel.attendanceMap.value)
            assertEquals(0, viewModel.getCourseAbsenceCount("CS101"))
        }

    @Test
    fun focusSession_is_persisted_and_survives_a_new_viewmodel() =
        runTest {
            val engine = engine()
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.logFocusCompleted("CS101", 25)
            advanceUntilIdle()

            assertEquals(
                "The completed session is shown from the persisted log",
                25,
                viewModel.studyMinutesByCourse.value["CS101"],
            )
            assertEquals("A session on the reference day starts the streak", 1, viewModel.studyStreakDays.value)
            assertTrue(
                "The session must exist in the core's session log",
                engine.listStudySessions().contains("\"duration_minutes\":25"),
            )
            assertNull(
                "A courseless session must not invent a GENERAL course id",
                viewModel.studyMinutesByCourse.value.keys.firstOrNull { it == "GENERAL" },
            )

            // "Restart": a fresh ViewModel over the SAME store re-derives
            // everything from the persisted log - the totals are not kept in
            // ViewModel memory only.
            val restarted = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertEquals(
                "Focus minutes must survive a restart (audit A06)",
                25,
                restarted.studyMinutesByCourse.value["CS101"],
            )
            assertEquals(1, restarted.studyStreakDays.value)

            // A second real session accumulates on top of the persisted one.
            restarted.logFocusCompleted("CS101", 15)
            advanceUntilIdle()
            assertEquals(40, restarted.studyMinutesByCourse.value["CS101"])
        }

    @Test
    fun attendance_is_persisted_with_explicit_course_and_survives_restart() =
        runTest {
            val engine = engine()
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            // The slot id CONTAINS a different course-ish substring on
            // purpose: the absence count must match the record's explicit
            // course_id, never search the composite key (audit A10).
            viewModel.toggleAttendance("slot-CS101-mon", "CS101", "2026-11-09")
            advanceUntilIdle()
            viewModel.toggleAttendance("slot-CS101-mon", "CS101", "2026-11-09") // attended -> absent
            advanceUntilIdle()

            assertEquals("absent", viewModel.attendanceMap.value["slot-CS101-mon::2026-11-09"])
            assertEquals(1, viewModel.getCourseAbsenceCount("CS101"))
            assertEquals(
                "A different course with a lookalike id substring counts 0",
                0,
                viewModel.getCourseAbsenceCount("CS"),
            )

            val log = engine.listAttendance()
            assertTrue(
                "The mark must be persisted with the explicit course association",
                log.contains("\"course_id\":\"CS101\"") && log.contains("\"status\":\"absent\""),
            )

            // Restart: the mark reloads from the store instead of evaporating.
            val restarted = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertEquals(
                "Attendance must survive a restart (audit A10)",
                "absent",
                restarted.attendanceMap.value["slot-CS101-mon::2026-11-09"],
            )
            assertEquals(1, restarted.getCourseAbsenceCount("CS101"))
        }

    @Test
    fun removeIcsFeed_deletes_the_feed_and_leaves_preferences_untouched() =
        runTest {
            val engine = engine()
            // Unrelated preferences the delete must never change (audit A02:
            // the old backup-import workaround flipped auto-GCal/Gemini off).
            engine.setConfigBool("ai_enabled", true)
            engine.setConfigString("active_semester", "Fall 2026")
            engine.saveFeed(feedJson, testDate)

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertEquals(1, viewModel.uiState.value.let { (it as? UiState.Ready)?.snapshot?.feeds?.size })

            viewModel.removeIcsFeed("https://example.edu/calendar.ics")
            advanceUntilIdle()

            assertEquals("Feed removed", viewModel.toastMessage.value)
            val snapshot = (viewModel.uiState.value as? UiState.Ready)?.snapshot
            assertEquals("The feed must be gone from the state", 0, snapshot?.feeds?.size)
            assertEquals(
                "Unrelated boolean preference must survive the delete",
                true,
                engine.getConfigBool("ai_enabled", false),
            )
            assertEquals(
                "Unrelated string preference must survive the delete",
                "Fall 2026",
                engine.getConfigString("active_semester"),
            )
        }

    @Test
    fun resetAllData_clears_persisted_student_state() =
        runTest {
            val engine = engine()
            engine.saveSchedule(
                """
                {
                    "semester": "Fall 2026",
                    "courses": [{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }],
                    "slots": []
                }
                """.trimIndent(),
                testDate,
            )
            engine.saveFeed(feedJson, testDate)

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            viewModel.toggleAttendance("slot-1", "CS101", "2026-11-04")
            advanceUntilIdle()
            viewModel.logFocusCompleted("CS101", 30)
            advanceUntilIdle()
            assertTrue(viewModel.attendanceMap.value.isNotEmpty())
            assertEquals(30, viewModel.studyMinutesByCourse.value["CS101"])

            var completed = false
            viewModel.resetAllData { completed = true }
            advanceUntilIdle()

            assertTrue(completed)
            assertEquals("All data and credentials reset", viewModel.toastMessage.value)
            assertEquals("[]", engine.listAttendance())
            assertEquals("[]", engine.listStudySessions())
            assertTrue("Feeds must be wiped", !engine.getState(testDate).contains("\"feed-ics-1\""))
            assertEquals(
                "The in-memory attendance view must be cleared too",
                emptyMap<String, String>(),
                viewModel.attendanceMap.value,
            )
            assertEquals(
                "The in-memory analytics view must be cleared too",
                emptyMap<String, Int>(),
                viewModel.studyMinutesByCourse.value,
            )
        }

    @Test
    fun failedReset_reports_honestly_and_keeps_the_store() =
        runTest {
            val engine = engine()
            engine.saveFeed(feedJson, testDate)
            val viewModel =
                QuizRadarViewModel(FailingResetCore(engine), clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            var completed = false
            viewModel.resetAllData { completed = true }
            advanceUntilIdle()

            assertTrue("onComplete must not fire for a failed reset", !completed)
            assertNotNull(viewModel.toastMessage.value)
            assertTrue(
                "The failure must be reported, never dressed up as success",
                viewModel.toastMessage.value!!.startsWith("Reset failed"),
            )
            assertTrue(
                "A failed reset must leave the store intact",
                engine.getState(testDate).contains("\"feed-ics-1\""),
            )
        }

    @Test
    fun courseEdit_preserves_credits_maxAbsences_and_weekParity() =
        runTest {
            val engine = engine()
            engine.upsertCourse(
                """
                {
                    "id": "CS101",
                    "name": "Intro to CS",
                    "color": "#1a73e8",
                    "credits": 4.0,
                    "max_absences": 4
                }
                """.trimIndent(),
                """
                [
                    {
                        "id": "slot-1",
                        "day": "Sun",
                        "course_id": "CS101",
                        "course_name": "Intro to CS",
                        "type": "Lecture",
                        "start_time": "08:00",
                        "end_time": "09:00",
                        "display_time": "08:00-09:00",
                        "week_parity": "week_a"
                    }
                ]
                """.trimIndent(),
                testDate,
            )

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            // The editor form only carries id/name/color and the slot rows;
            // credits and max_absences are NOT in the form.
            viewModel.upsertCourse(
                CourseModel(id = "CS101", name = "Renamed Intro", color = "#0f9d58"),
                listOf(
                    ScheduleSlotModel(
                        id = "slot-1",
                        day = "Sun",
                        courseId = "CS101",
                        courseName = "Renamed Intro",
                        type = "Lecture",
                        startTime = "08:00",
                        endTime = "09:00",
                        weekParity = "week_a",
                    ),
                ),
            )
            advanceUntilIdle()

            val state = engine.getState(testDate)
            assertTrue("The rename must be applied", state.contains("Renamed Intro"))
            assertTrue(
                "Credits must survive the edit (upsert_course replaces the row)",
                state.contains("\"credits\":4.0"),
            )
            assertTrue(
                "The absence limit must survive the edit",
                state.contains("\"max_absences\":4"),
            )
            assertTrue(
                "Slot week parity must survive the edit (alternating weeks)",
                state.contains("\"week_parity\":\"week_a\""),
            )
        }

    @Test
    fun attendanceClearStep_persists_as_a_deletion_and_survives_restart() =
        runTest {
            val engine = engine()
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            // The full cycle: attended -> absent -> excused -> CLEAR (four
            // toggles from empty). The clear step used to be memory-only, so
            // the cleared mark came back on restart (audit A10).
            viewModel.toggleAttendance("slot-CS101-mon", "CS101", "2026-11-09")
            advanceUntilIdle()
            viewModel.toggleAttendance("slot-CS101-mon", "CS101", "2026-11-09")
            advanceUntilIdle()
            viewModel.toggleAttendance("slot-CS101-mon", "CS101", "2026-11-09")
            advanceUntilIdle()
            viewModel.toggleAttendance("slot-CS101-mon", "CS101", "2026-11-09")
            advanceUntilIdle()

            assertEquals(
                "The clear step removes the mark from the UI",
                emptyMap<String, String>(),
                viewModel.attendanceMap.value,
            )
            assertEquals(
                "The clear step must delete the persisted row, not only the in-memory one",
                "[]",
                engine.listAttendance(),
            )
            assertEquals(0, viewModel.getCourseAbsenceCount("CS101"))

            // Restart: the cleared mark stays cleared.
            val restarted = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertEquals(
                "A cleared mark must never come back on restart",
                emptyMap<String, String>(),
                restarted.attendanceMap.value,
            )
        }

    @Test
    fun pomodoroCompletion_persists_exactly_one_session_breaks_and_resets_never_log() =
        runTest {
            val engine = engine()
            engine.upsertAssessment(
                """
                {
                    "id": "asm-1",
                    "title": "Class Quiz 1",
                    "course_id": "CS101",
                    "assessment_type": "Class Quiz",
                    "date_iso": "2026-11-14"
                }
                """.trimIndent(),
                testDate,
            )
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            viewModel.openPomodoro("asm-1", "Read chapter 1")
            advanceUntilIdle()

            // Run the ACTUAL timer to completion on the virtual clock - the
            // completion path used to exist only in the UI flow and never
            // touched the persisted session log (audit A06).
            viewModel.startPomodoro()
            advanceTimeBy(25 * 60 * 1000L)
            advanceUntilIdle()

            assertEquals(
                "The real completion persists exactly one focus session",
                1,
                engine.listStudySessions().split("\"duration_minutes\"").size - 1,
            )
            assertTrue(
                "The logged duration is the real interval length",
                engine.listStudySessions().contains("\"duration_minutes\":25"),
            )
            assertTrue(
                "The session is attributed to the assessment's own course",
                engine.listStudySessions().contains("\"course_id\":\"CS101\""),
            )
            assertEquals(25, viewModel.studyMinutesByCourse.value["CS101"])

            // Extra idle ticks after the completion never log a duplicate.
            advanceTimeBy(60_000L)
            advanceUntilIdle()
            assertEquals(
                "Completion is logged exactly once",
                1,
                engine.listStudySessions().split("\"duration_minutes\"").size - 1,
            )

            // A break interval reaching 0 never logs a focus session.
            viewModel.selectPomodoroInterval(PomodoroInterval.SHORT_BREAK)
            viewModel.startPomodoro()
            advanceTimeBy(5 * 60 * 1000L)
            advanceUntilIdle()
            assertEquals(
                "Breaks never log",
                1,
                engine.listStudySessions().split("\"duration_minutes\"").size - 1,
            )

            // A timer reset before completion never logs either.
            viewModel.selectPomodoroInterval(PomodoroInterval.POMODORO)
            viewModel.startPomodoro()
            advanceTimeBy(10_000L)
            viewModel.resetPomodoro()
            advanceUntilIdle()
            assertEquals(
                "Reset before completion never logs",
                1,
                engine.listStudySessions().split("\"duration_minutes\"").size - 1,
            )

            // Restart: the completed session survives as the store's history.
            val restarted = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertEquals(
                "The timer-completed session must survive a restart",
                25,
                restarted.studyMinutesByCourse.value["CS101"],
            )
        }
}
