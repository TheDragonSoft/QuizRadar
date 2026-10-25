package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class QuizRadarViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private val testDate = LocalDate.parse("2026-10-25")

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun loadState_reaches_ready_state_and_allows_filter_changes() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()
            val viewModel = QuizRadarViewModel(engine) { testDate }

            advanceUntilIdle()

            assertTrue("UI state must be Ready", viewModel.uiState.value is UiState.Ready)

            viewModel.setDashboardSubTab(DashboardSubTab.OVERVIEW)
            assertEquals(DashboardSubTab.OVERVIEW, viewModel.dashboardSubTab.value)

            viewModel.setActiveSourceFilter("MOODLE")
            assertEquals("MOODLE", viewModel.activeSourceFilter.value)

            viewModel.setActiveTypeFilter("Midterm Exam")
            assertEquals("Midterm Exam", viewModel.activeTypeFilter.value)

            viewModel.setTasksCourseFilter("CS101")
            assertEquals("CS101", viewModel.tasksCourseFilter.value)
        }

    @Test
    fun optimistic_topic_toggle_updates_state_immediately_and_persists() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()

            // Seed course and assessment
            val courseJson = """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }"""
            val slotsJson = """[]"""
            engine.upsertCourse(courseJson, slotsJson, testDate)

            val assessmentJson =
                """
                [
                    {
                        "id": "quiz-1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-10-30",
                        "topics": ["Algorithms"],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent()
            engine.replaceAssessments(assessmentJson, testDate)

            val viewModel = QuizRadarViewModel(engine) { testDate }
            advanceUntilIdle()

            val topicKey = "quiz-1::0"
            viewModel.toggleTopic(topicKey, true)

            // Immediately state shows topic checked (optimistic update)
            val readyState = viewModel.uiState.value as UiState.Ready
            assertEquals(true, readyState.snapshot.completedTopics[topicKey])

            // Settle coroutine backend call
            advanceUntilIdle()

            val finalState = viewModel.uiState.value as UiState.Ready
            assertEquals(true, finalState.snapshot.completedTopics[topicKey])
        }

    @Test
    fun grade_editor_supports_explicit_null_clears() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()

            val courseJson = """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }"""
            engine.upsertCourse(courseJson, "[]", testDate)

            val assessmentJson =
                """
                [
                    {
                        "id": "quiz-1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-10-30",
                        "topics": [],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent()
            engine.replaceAssessments(assessmentJson, testDate)

            val viewModel = QuizRadarViewModel(engine) { testDate }
            advanceUntilIdle()

            // 1. Save grade
            viewModel.saveGrade("quiz-1", 19.0, 20.0, 15.0)
            advanceUntilIdle()

            var snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            var savedGrade = snapshot.grades["quiz-1"]
            assertEquals(19.0, savedGrade?.achievedScore)
            assertEquals(20.0, savedGrade?.maxScore)
            assertEquals(15.0, savedGrade?.weightagePercent)

            // 2. Explicit null clears (saving blank/null deletes or clears the grade record)
            viewModel.saveGrade("quiz-1", null, null, null)
            advanceUntilIdle()

            snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            savedGrade = snapshot.grades["quiz-1"]
            assertNull("Clearing all grade fields must delete/clear grade", savedGrade)
        }

    @Test
    fun dismiss_conflicts_updates_flag() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()
            val viewModel = QuizRadarViewModel(engine) { testDate }
            advanceUntilIdle()

            viewModel.dismissConflicts()
            advanceUntilIdle()

            assertEquals(true, viewModel.isConflictDismissed.value)
        }

    @Test
    fun week_navigation_and_jump_to_today() =
        runTest {
            val engine = QuizRadarEngine.createInMemory()
            val viewModel = QuizRadarViewModel(engine) { testDate }
            advanceUntilIdle()

            val initialStart = viewModel.currentWeekStart.value

            viewModel.shiftWeek(1)
            assertEquals(initialStart.plusWeeks(1), viewModel.currentWeekStart.value)

            viewModel.jumpToToday()
            assertEquals(QuizRadarViewModel.getWeekStart(testDate), viewModel.currentWeekStart.value)
            assertEquals(testDate, viewModel.selectedCalendarDate.value)
        }
}
