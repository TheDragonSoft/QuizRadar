package com.quizradar.app.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.ui.theme.QuizRadarTheme
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
        val engine = QuizRadarEngine.createInMemory()

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

        val viewModel = QuizRadarViewModel(engine) { testDate }

        composeTestRule.setContent {
            QuizRadarTheme {
                AppScaffold(viewModel = viewModel)
            }
        }

        // Wait for idle state
        composeTestRule.waitForIdle()

        // 1. Verify 4 bottom navigation tabs are displayed
        composeTestRule.onNodeWithText("Dashboard").assertIsDisplayed()
        composeTestRule.onNodeWithText("Tasks").assertIsDisplayed()
        composeTestRule.onNodeWithText("Calendar").assertIsDisplayed()
        composeTestRule.onNodeWithText("Focus").assertIsDisplayed()

        // 2. Click Tasks tab
        composeTestRule.onNodeWithText("Tasks").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Daily Study Roadmap").assertIsDisplayed()

        // 3. Click Calendar tab
        composeTestRule.onNodeWithText("Calendar").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Today").assertIsDisplayed()

        // 4. Click Focus tab
        composeTestRule.onNodeWithText("Focus").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Pomodoro Timer").assertIsDisplayed()

        // 5. Navigate back to Dashboard
        composeTestRule.onNodeWithText("Dashboard").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Study").assertIsDisplayed()
    }
}
