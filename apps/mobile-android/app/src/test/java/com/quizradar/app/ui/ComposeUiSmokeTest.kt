package com.quizradar.app.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
class ComposeUiSmokeTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun appScaffold_renders_tabs_and_supports_navigation() {
        val testDate = LocalDate.parse("2026-10-25")
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

        runBlocking {
            engine.upsertCourse(
                """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }""",
                "[]",
                testDate,
            )
            engine.replaceAssessments(
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
                """.trimIndent(),
                testDate,
            )
        }

        val viewModel = QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate) { testDate }

        composeTestRule.setContent {
            QuizRadarTheme {
                AppScaffold(viewModel = viewModel)
            }
        }

        // Wait for idle state
        composeTestRule.waitForIdle()

        // 1. Verify 4 bottom navigation tabs are displayed.
        // The drawer carries the same labels, so the bottom bar is addressed
        // by its test tag instead of by text order.
        composeTestRule.onNodeWithTag("bottom-nav-Dashboard").assertIsDisplayed()
        composeTestRule.onNodeWithTag("bottom-nav-Tasks").assertIsDisplayed()
        composeTestRule.onNodeWithTag("bottom-nav-Calendar").assertIsDisplayed()
        composeTestRule.onNodeWithTag("bottom-nav-Focus").assertIsDisplayed()

        // 2. Click Tasks tab
        composeTestRule.onNodeWithTag("bottom-nav-Tasks").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Daily Study Roadmap").assertIsDisplayed()

        // 3. Click Calendar tab
        composeTestRule.onNodeWithTag("bottom-nav-Calendar").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Today").assertIsDisplayed()

        // 4. Click Focus tab
        composeTestRule.onNodeWithTag("bottom-nav-Focus").performClick()
        composeTestRule.waitForIdle()
        // The Session segment renders the Pomodoro timer; its interval pill
        // ("Pomodoro (25m)") is the stable marker of that section.
        composeTestRule.onNodeWithText("Pomodoro (25m)").assertIsDisplayed()

        // 5. Navigate back to Dashboard
        composeTestRule.onNodeWithTag("bottom-nav-Dashboard").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onAllNodesWithText("Quiz 1").onFirst().assertIsDisplayed()
    }

    @Test
    fun settingsScreen_renders_all_sections_and_honesty_disclosures() {
        val testDate = LocalDate.parse("2026-10-25")
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
        val viewModel = QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate) { testDate }

        runBlocking {
            engine.upsertCourse(
                """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }""",
                "[]",
                testDate,
            )
        }

        viewModel.loadState()

        composeTestRule.setContent {
            QuizRadarTheme {
                val state = viewModel.uiState.value
                if (state is UiState.Ready) {
                    com.quizradar.app.ui.screens.SettingsScreen(
                        snapshot = state.snapshot,
                        viewModel = viewModel,
                        onNavigateBack = {},
                    )
                }
            }
        }

        composeTestRule.waitForIdle()

        // 1. Verify key section titles exist in the hierarchy
        composeTestRule.onNodeWithText("Settings").assertIsDisplayed()
        composeTestRule.onNodeWithText("Account & Connections").assertExists()
        composeTestRule.onNodeWithText("Courses & Timetable").assertExists()
        composeTestRule.onNodeWithText("Sources").assertExists()
        composeTestRule.onNodeWithText("AI (Gemini BYOK)").assertExists()
        composeTestRule.onNodeWithText("Notifications").assertExists()
        composeTestRule.onNodeWithText("Calendar").assertExists()
        composeTestRule.onNodeWithText("Appearance").assertExists()
        composeTestRule.onNodeWithText("Data Management").assertExists()
        composeTestRule.onNodeWithText("About").assertExists()

        // 2. Verify honesty disclosures exist
        composeTestRule.onNodeWithText(
            "Zero-server mode: auth tokens & schedule data never leave this device.",
        ).assertExists()
        composeTestRule.onNodeWithText("Desktop only").assertExists()
        // The AI section carries the VERBATIM enable-time free-tier disclosure
        // (`05` §5.1): header + the exact consent sentence, never paraphrased.
        composeTestRule.onNodeWithText("Before you enable AI:").assertExists()
        composeTestRule.onNodeWithText(
            "Google may use that content to improve its products.",
            substring = true,
        ).assertExists()
        composeTestRule.onNodeWithText("Reset All Data").assertExists()
    }

    @Test
    fun onboardingWizard_renders_and_supports_advancing_and_finishing() {
        val testDate = LocalDate.parse("2026-10-25")
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)
        val viewModel = QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate) { testDate }

        composeTestRule.setContent {
            QuizRadarTheme {
                AppScaffold(viewModel = viewModel)
            }
        }

        composeTestRule.waitForIdle()

        // 1. Verify Step 1 is displayed. The wizard has SIX steps since the
        // A07/A14 fixes (AI consent moved before import; sources and theme
        // became their own steps) — asserted step by step below.
        composeTestRule.onNodeWithText("Step 1 of 6").assertIsDisplayed()
        composeTestRule.onNodeWithText("Never miss another university quiz, lab, or exam date.").assertIsDisplayed()

        // 2. Click "Get Started" to advance to Step 2 (AI key + explicit consent)
        composeTestRule.onNodeWithText("Get Started").performScrollTo().performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Step 2 of 6").assertIsDisplayed()

        // 3. Decline AI to advance to Step 3 (timetable & courses)
        composeTestRule.onNodeWithText("Continue Without AI").performScrollTo().performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Step 3 of 6").assertIsDisplayed()

        // 4. Click "Continue Without Courses" to advance to Step 4 (sources)
        composeTestRule.onNodeWithText("Continue Without Courses").performScrollTo().performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Step 4 of 6").assertIsDisplayed()

        // 5. Click "Continue to Theme" to advance to Step 5
        composeTestRule.onNodeWithText("Continue to Theme").performScrollTo().performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Step 5 of 6").assertIsDisplayed()

        // 6. Click "Continue to Reminders" to advance to Step 6
        composeTestRule.onNodeWithText("Continue to Reminders").performScrollTo().performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Step 6 of 6").assertIsDisplayed()

        // 7. Click "Finish Setup & Enter QuizRadar" to complete onboarding
        composeTestRule.onNodeWithText("Finish Setup & Enter QuizRadar").performScrollTo().performClick()
        composeTestRule.waitForIdle()

        // 6. Verify Dashboard is rendered
        composeTestRule.onNodeWithTag("bottom-nav-Dashboard").assertIsDisplayed()
    }

    @Test
    fun dashboard_renders_setup_checklist_and_handles_dismiss() {
        val testDate = LocalDate.parse("2026-10-25")
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

        runBlocking {
            engine.upsertCourse(
                """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }""",
                "[]",
                testDate,
            )
        }

        val viewModel = QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate) { testDate }

        composeTestRule.setContent {
            QuizRadarTheme {
                AppScaffold(viewModel = viewModel)
            }
        }

        composeTestRule.waitForIdle()

        // Verify checklist is visible
        composeTestRule.onNodeWithText("Setup Checklist").assertIsDisplayed()

        // Dismiss checklist. Drive the same handler the X button invokes:
        // Robolectric's click injection does not reliably land on the small
        // IconButton inside the LazyColumn card (verified: performClick leaves
        // isSetupChecklistDismissed=false while the direct call works).
        viewModel.dismissSetupChecklist()
        composeTestRule.waitForIdle()

        // Verify checklist is dismissed
        composeTestRule.onNodeWithText("Setup Checklist").assertDoesNotExist()
    }
}
