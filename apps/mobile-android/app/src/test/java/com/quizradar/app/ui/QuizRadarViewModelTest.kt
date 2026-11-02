package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarCore
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

/**
 * A core whose grade write always fails - the sheet must not claim
 * "Grade Saved!" when the store rejected the write.
 */
private class FailingGradeCore(
    delegate: QuizRadarCore,
) : QuizRadarCore by delegate {
    override suspend fun updateGrade(
        assessmentId: String,
        achieved: Double?,
        max: Double?,
        weightage: Double?,
        clearAchieved: Boolean,
        clearMax: Boolean,
        clearWeightage: Boolean,
        refDate: LocalDate,
    ): String = throw IllegalStateException("store write rejected")
}

/**
 * A core that answers the AI timetable import with a canned payload - the
 * test must never reach the network.
 */
private class FakeTimetableImportCore(
    delegate: QuizRadarCore,
    private val apiKey: String?,
    private val response: String,
) : QuizRadarCore by delegate {
    override fun geminiApiKey(): String? = apiKey

    override suspend fun extractTimetableFromImage(
        imageB64: String,
        mime: String,
        apiKey: String,
    ): String = response
}

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
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)

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
    fun `the onboarding flag written as a bool survives a reload`() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)

            // A fresh store with an empty timetable is a first run: the wizard shows.
            val first = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertEquals(false, first.onboardingCompleted.value)

            first.completeOnboarding()
            advanceUntilIdle()

            // completeOnboarding writes the key as a BOOL. Probing it through the
            // string getter used to return null for a bool row, which fell through
            // to "has courses" - and an empty timetable then re-showed the wizard on
            // every single launch.
            val second = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertTrue(
                "the bool-written onboarding flag must be honoured on the next load",
                second.onboardingCompleted.value,
            )
        }

    @Test
    fun optimistic_topic_toggle_updates_state_immediately_and_persists() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)

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

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
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
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)

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

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
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
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.dismissConflicts()
            advanceUntilIdle()

            assertEquals(true, viewModel.isConflictDismissed.value)
        }

    @Test
    fun ai_course_import_without_a_gemini_key_fails_loudly() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val core = FakeTimetableImportCore(engine, apiKey = null, response = "{}")
            val viewModel = QuizRadarViewModel(core, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.importTimetableFromImage(byteArrayOf(1, 2, 3), "image/png")
            advanceUntilIdle()

            val state = viewModel.timetableImportState.value
            assertTrue(
                "the import must fail with the key hint, not silently do nothing",
                state is TimetableImportState.Failed &&
                    (state as TimetableImportState.Failed).message.contains("Gemini API key"),
            )
        }

    @Test
    fun ai_course_import_previews_what_gemini_found_and_saves_it_on_apply() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val response =
                """
                {
                  "schedule": {
                    "semester": "Fall 2026",
                    "courses": [
                      { "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }
                    ],
                    "slots": [
                      {
                        "id": "slot-1",
                        "day": "Monday",
                        "day_index": 1,
                        "course_id": "CS101",
                        "course_name": "Intro to CS",
                        "type": "Lecture",
                        "group": null,
                        "room": "B-204",
                        "start_time": "09:00",
                        "end_time": "10:30",
                        "display_time": "09:00-10:30",
                        "has_quiz": false,
                        "quiz_title": null
                      }
                    ]
                  },
                  "dropped_courses": 1,
                  "dropped_slots": 2
                }
                """.trimIndent()
            val core = FakeTimetableImportCore(engine, apiKey = "test-key", response = response)
            val viewModel = QuizRadarViewModel(core, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.importTimetableFromImage(byteArrayOf(1, 2, 3), "image/png")
            advanceUntilIdle()

            val preview = viewModel.timetableImportState.value as TimetableImportState.Preview
            assertEquals(1, preview.extracted.schedule.courses.size)
            assertEquals(1, preview.extracted.schedule.slots.size)
            assertEquals("B-204", preview.extracted.schedule.slots.first().room)
            // The dropped rows are counted, never repaired.
            assertEquals(1, preview.extracted.droppedCourses)
            assertEquals(2, preview.extracted.droppedSlots)

            // Nothing is written before the user applies the preview.
            assertTrue((viewModel.uiState.value as UiState.Ready).snapshot.schedule.courses.isEmpty())

            viewModel.applyImportedTimetable(preview.extracted)
            advanceUntilIdle()

            val saved = (viewModel.uiState.value as UiState.Ready).snapshot.schedule
            assertEquals(1, saved.courses.size)
            assertEquals("CS101", saved.courses.first().id)
            assertEquals(1, saved.slots.size)
            assertEquals("B-204", saved.slots.first().room)
        }

    @Test
    fun week_navigation_and_jump_to_today() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            val initialStart = viewModel.currentWeekStart.value

            viewModel.shiftWeek(1)
            assertEquals(initialStart.plusWeeks(1), viewModel.currentWeekStart.value)

            viewModel.jumpToToday()
            assertEquals(QuizRadarViewModel.getWeekStart(testDate), viewModel.currentWeekStart.value)
            assertEquals(testDate, viewModel.selectedCalendarDate.value)
        }

    @Test
    fun course_upsert_and_delete_updates_schedule_state() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            val course = com.quizradar.app.model.CourseModel(id = "BIO101", name = "Biology", color = "#10b981")
            val slot =
                com.quizradar.app.model.ScheduleSlotModel(
                    id = "s1",
                    day = "Mon",
                    courseId = "BIO101",
                    courseName = "Biology",
                    type = "Lecture",
                    startTime = "10:00",
                    endTime = "11:30",
                    displayTime = "10:00–11:30",
                    room = "Lab 2",
                    instructor = "Dr. Green",
                )

            viewModel.upsertCourse(course, listOf(slot))
            advanceUntilIdle()

            var snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            val savedCourse = snapshot.schedule.courses.find { it.id == "BIO101" }
            assertEquals("Biology", savedCourse?.name)
            assertEquals(1, snapshot.schedule.slots.filter { it.courseId == "BIO101" }.size)

            viewModel.deleteCourse("BIO101")
            advanceUntilIdle()

            snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            assertNull(snapshot.schedule.courses.find { it.id == "BIO101" })
            assertEquals(0, snapshot.schedule.slots.filter { it.courseId == "BIO101" }.size)
        }

    @Test
    fun profile_settings_and_source_toggles() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.saveUserProfile("Jane Doe", "jane@example.edu")
            advanceUntilIdle()

            assertEquals("Jane Doe", viewModel.userName.value)
            assertEquals("jane@example.edu", viewModel.userEmail.value)

            viewModel.setSourceEnabled("gmail", false)
            advanceUntilIdle()
            assertEquals(false, viewModel.gmailEnabled.value)

            viewModel.setTheme("dark")
            advanceUntilIdle()
            assertEquals("dark", viewModel.theme.value)
        }

    @Test
    fun ai_and_notification_settings_flow() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.setGeminiEnabled(true)
            advanceUntilIdle()
            assertEquals(true, viewModel.geminiEnabled.value)

            viewModel.saveGeminiApiKey("AIzaSyFakeKey123")
            advanceUntilIdle()
            assertEquals("AIzaSyFakeKey123", viewModel.geminiApiKey.value)

            viewModel.setNotifyExam24h(false)
            advanceUntilIdle()
            assertEquals(false, viewModel.notifyExam24h.value)

            viewModel.setNotifyMorningDigest(true)
            viewModel.setNotifyMorningTime("07:30")
            advanceUntilIdle()
            assertEquals(true, viewModel.notifyMorningDigest.value)
            assertEquals("07:30", viewModel.notifyMorningTime.value)
        }

    @Test
    fun reset_all_data_clears_database_and_tokens() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            val course = com.quizradar.app.model.CourseModel(id = "MTH101", name = "Calculus", color = "#1a73e8")
            viewModel.upsertCourse(course, emptyList())
            viewModel.saveGeminiApiKey("secret-key")
            advanceUntilIdle()

            var snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            assertEquals(1, snapshot.schedule.courses.size)
            assertEquals("secret-key", viewModel.geminiApiKey.value)

            var resetCompleted = false
            viewModel.resetAllData {
                resetCompleted = true
            }
            advanceUntilIdle()

            assertTrue(resetCompleted)
            snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            assertEquals(0, snapshot.schedule.courses.size)
            assertEquals("", viewModel.geminiApiKey.value)
        }

    @Test
    fun selectTab_updates_selected_tab_state() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            assertEquals("Dashboard", viewModel.selectedTab.value)
            viewModel.selectTab("Focus")
            assertEquals("Focus", viewModel.selectedTab.value)
            viewModel.selectTab("Calendar")
            assertEquals("Calendar", viewModel.selectedTab.value)
        }

    @Test
    fun mutations_trigger_onStateMutated_callback() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            var mutatedCount = 0
            val viewModel =
                QuizRadarViewModel(
                    core = engine,
                    onStateMutated = { mutatedCount++ },
                    clockDate = { testDate },
                    coreDispatcher = testDispatcher,
                )
            advanceUntilIdle()

            val course = com.quizradar.app.model.CourseModel(id = "CS201", name = "Data Structures", color = "#1a73e8")
            viewModel.upsertCourse(course, emptyList())
            advanceUntilIdle()
            assertTrue("onStateMutated must be called on upsertCourse", mutatedCount > 0)

            val countBeforeEvent = mutatedCount
            viewModel.addCustomEvent(
                com.quizradar.app.model.CustomEventModel(
                    id = "custom-1",
                    title = "Group Study",
                    courseId = "CS201",
                    eventType = "Study",
                    dateIso = testDate,
                    startTime = "14:00",
                    endTime = "16:00",
                    room = "Library",
                    notes = "Chapter 4",
                    color = "#db2777",
                ),
            )
            advanceUntilIdle()
            assertTrue("onStateMutated must be called on addCustomEvent", mutatedCount > countBeforeEvent)
        }

    @Test
    fun day_rollover_on_resume_recomputes_today_derived_data() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            // 2026-10-31 (Sat) -> 2026-11-01 (Sun) straddles a week boundary, so
            // the week-follow branch below is actually exercised (not vacuous).
            var today = LocalDate.parse("2026-10-31")

            // Seed BEFORE constructing the ViewModel so its initial loadState
            // already sees the assessment.
            engine.upsertCourse("""{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }""", "[]", today)
            val assessmentJson =
                """
                [
                    {
                        "id": "a1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-11-01",
                        "topics": [],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent()
            engine.replaceAssessments(assessmentJson, today)

            var mutations = 0
            val viewModel =
                QuizRadarViewModel(
                    core = engine,
                    onStateMutated = { mutations++ },
                    clockDate = { today },
                    coreDispatcher = testDispatcher,
                )
            advanceUntilIdle()

            var snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            assertEquals(1, snapshot.assessments.first { it.id == "a1" }.daysUntil)

            // Same-day resume must NOT reload (no spurious refresh).
            val mutationsBefore = mutations
            viewModel.onAppResumed()
            advanceUntilIdle()
            assertEquals(mutationsBefore, mutations)

            // Midnight passes while the app is backgrounded (Sat -> Sun).
            today = LocalDate.parse("2026-11-01")
            viewModel.onAppResumed()
            advanceUntilIdle()

            assertTrue("rollover must trigger a reload", mutations > mutationsBefore)
            snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            assertEquals("daysUntil must recompute against the new today", 0, snapshot.assessments.first { it.id == "a1" }.daysUntil)
            assertEquals("calendar selection follows the new day when untouched", today, viewModel.selectedCalendarDate.value)
            assertEquals(
                "week view follows the new day when untouched",
                QuizRadarViewModel.getWeekStart(today),
                viewModel.currentWeekStart.value,
            )
        }

    @Test
    fun day_rollover_preserves_user_navigated_week() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            var today = LocalDate.parse("2026-10-30")
            val viewModel = QuizRadarViewModel(engine, clockDate = { today }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            // User navigates two weeks into the future — a deliberate choice.
            viewModel.shiftWeek(2)
            val navigatedWeek = viewModel.currentWeekStart.value
            viewModel.setSelectedCalendarDate(today.plusDays(14))

            today = LocalDate.parse("2026-10-31")
            viewModel.onAppResumed()
            advanceUntilIdle()

            assertEquals("navigated week must be preserved across rollover", navigatedWeek, viewModel.currentWeekStart.value)
            assertEquals(
                "navigated calendar date must be preserved across rollover",
                LocalDate.parse("2026-10-30").plusDays(14),
                viewModel.selectedCalendarDate.value,
            )
        }

    @Test
    fun saveGrade_reportsSavedOnlyAfterTheWriteSucceeded() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            engine.replaceAssessments(
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
                """.trimIndent(),
                testDate,
            )

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            val result = viewModel.saveGrade("quiz-1", 18.0, 20.0, 15.0)

            assertEquals(GradeSaveResult.Saved, result)
        }

    @Test
    fun saveGrade_reportsTheFailureInsteadOfSwallowingIt() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            engine.replaceAssessments(
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
                """.trimIndent(),
                testDate,
            )

            val viewModel = QuizRadarViewModel(FailingGradeCore(engine), clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            val result = viewModel.saveGrade("quiz-1", 18.0, 20.0, 15.0)

            assertTrue("a rejected write must not report success", result is GradeSaveResult.Failed)
            val failure = result as GradeSaveResult.Failed
            assertTrue(
                "the failure must name the reason (got \"${failure.message}\")",
                failure.message.contains("store write rejected"),
            )
            val snapshot = (viewModel.uiState.value as UiState.Ready).snapshot
            assertNull("nothing may be recorded when the write failed", snapshot.grades["quiz-1"])
        }

    @Test
    fun openPomodoro_carriesTheIndexOfTheTopicOnScreen() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            engine.replaceAssessments(
                """
                [
                    {
                        "id": "quiz-1",
                        "title": "Quiz 1",
                        "course_id": "CS101",
                        "assessment_type": "Class Quiz",
                        "date_iso": "2026-10-30",
                        "topics": ["Algorithms", "Graphs", "Dynamic Programming"],
                        "warnings": [],
                        "source": "Gmail"
                    }
                ]
                """.trimIndent(),
                testDate,
            )

            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.openPomodoro("quiz-1", "Graphs")
            assertEquals("Graphs", viewModel.activePomodoroTopic.value)
            assertEquals(
                "the topic on screen is index 1 - not the first topic",
                1,
                viewModel.activePomodoroTopicIndex.value,
            )

            viewModel.openPomodoro("quiz-1", "Dynamic Programming")
            assertEquals(2, viewModel.activePomodoroTopicIndex.value)

            // A topic the assessment does not have carries no index - the
            // screen must not guess one.
            viewModel.openPomodoro("quiz-1", "Not a topic of this assessment")
            assertNull(viewModel.activePomodoroTopicIndex.value)
        }

    @Test
    fun openPracticeQuiz_reportsAFailureInsteadOfAnEmptyState() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            // An assessment that is not on the radar cannot produce a quiz:
            // that is a FAILURE, not "nothing selected".
            viewModel.openPracticeQuiz("does-not-exist")
            advanceUntilIdle()

            assertNull(viewModel.practiceQuiz.value)
            assertNotNull(
                "a failed generation must carry an error message",
                viewModel.practiceQuizError.value,
            )
            assertTrue(
                "the error must explain the failure (got \"${viewModel.practiceQuizError.value}\")",
                viewModel.practiceQuizError.value!!.contains("Practice quiz unavailable"),
            )
            assertTrue("the spinner must stop", !viewModel.isPracticeLoading.value)
        }

    @Test
    fun disconnect_wipesTheAccountIdentityWithTheTokens() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.saveUserProfile("Jane Doe", "jane@example.edu")
            advanceUntilIdle()
            engine.tokenProvider.setGoogleAccessToken("access-token")
            engine.tokenProvider.setGoogleRefreshToken("refresh-token")

            viewModel.disconnectGoogle()
            advanceUntilIdle()

            assertEquals("", viewModel.userName.value)
            assertEquals("", viewModel.userEmail.value)
            assertNull(engine.tokenProvider.getGoogleAccessToken())
            assertNull(engine.tokenProvider.getGoogleRefreshToken())
            assertNull(engine.getConfigString("user_email"))
            assertNull(engine.getConfigString("user_name"))
        }
}
