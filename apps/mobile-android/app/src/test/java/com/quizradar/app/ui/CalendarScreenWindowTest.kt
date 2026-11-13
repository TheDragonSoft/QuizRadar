package com.quizradar.app.ui

import androidx.compose.runtime.collectAsState
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.ui.screens.CalendarScreen
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

/**
 * Regression for the 3-day window navigation trap (fresh-install finding on a
 * narrow screen): the old invisible swipe gesture did not fire and the offset
 * clamp (`selectedIdx.coerceIn(0, 7 - dayCount)`) pinned the window to the
 * week's right edge, so Sunday-Wednesday were unreachable.
 *
 * Rebuilt chrome (docs/ANDROID-DESIGN-SYSTEM.md §6): the day strip
 * (`calendar_day_strip`) IS the only pager — a horizontally snap-paged
 * collection of day cells, every one of them tap-reachable, so the trap is
 * covered by tap assertions instead of swipe gestures. The grid window still
 * re-centers onto the selected day; the week arrows page whole weeks.
 *
 * The week starts on SUNDAY (`QuizRadarViewModel.getWeekStart`), so in the
 * week of Sunday 2026-10-25 Monday is index 1, Wednesday is index 3 and
 * Saturday is index 6. Robolectric's default surface is 320dp wide, i.e. the
 * narrow (< 600dp) layout that shows the 3-day window - the layout the trap
 * was found on.
 *
 * Text queries go through the UNMERGED tree and are case-insensitive,
 * matching the real Text values ("MON" comes from `dayOfWeek.name.take(3)`).
 */
@RunWith(RobolectricTestRunner::class)
class CalendarScreenWindowTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private fun nodesWith(text: String) =
        composeTestRule.onAllNodesWithText(
            text,
            substring = true,
            ignoreCase = true,
            useUnmergedTree = true,
        )

    @Test
    fun threeDayWindow_recentersOnSelectedDate_andPagesThroughDayStrip() {
        val testDate = LocalDate.parse("2026-10-25") // Sunday, week start
        val monday = LocalDate.parse("2026-10-26")
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

        runBlocking {
            engine.upsertCourse(
                """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }""",
                """
                [
                    {
                        "id": "slot-wed",
                        "day": "Wednesday",
                        "course_id": "CS101",
                        "course_name": "Intro to CS",
                        "type": "Lecture",
                        "start_time": "09:00",
                        "end_time": "10:30",
                        "display_time": "09:00-10:30",
                        "room": "B-204"
                    }
                ]
                """.trimIndent(),
                testDate,
            )
        }

        val viewModel = QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate) { testDate }
        viewModel.loadState()
        // The student picks Monday (e.g. via the date picker): the window must
        // re-anchor so Monday is VISIBLE - no gesture required.
        viewModel.setSelectedCalendarDate(monday)

        composeTestRule.setContent {
            QuizRadarTheme {
                // Reactive read: loadState() completes on the (Robolectric)
                // Main looper, so the Ready state can arrive after setContent.
                val state = viewModel.uiState.collectAsState().value
                if (state is UiState.Ready) {
                    CalendarScreen(snapshot = state.snapshot, viewModel = viewModel)
                }
            }
        }
        composeTestRule.waitForIdle()

        // 1. Monday is selectable in the day strip right away (no swipe): the
        //    cell is on screen and carries the Selected state.
        composeTestRule.onNodeWithContentDescription("Monday, 26 October").assertIsDisplayed()
        composeTestRule.onNodeWithContentDescription("Monday, 26 October").assertIsSelected()

        // Sunday is today and has no items: its state description says so.
        val sundayState =
            composeTestRule
                .onNodeWithContentDescription("Sunday, 25 October")
                .fetchSemanticsNode()
                .config[SemanticsProperties.StateDescription]
        check(sundayState == "Today") {
            "Sunday cell state description was '$sundayState', expected 'Today'"
        }

        // 2. The grid window re-anchored onto the selected Monday: Wednesday's
        //    column is NOT in the grid yet. The strip cell may sit at the
        //    scroll edge of the collection, so the GRID hour cells are the
        //    probe ("WED 08:00, double tap to schedule a study block").
        check(
            composeTestRule
                .onAllNodesWithContentDescription("WED 08:00", substring = true)
                .fetchSemanticsNodes()
                .isEmpty(),
        ) {
            "Wednesday must not be in the initial grid window"
        }

        // 3. Tap-navigation through the day strip: scroll the collection to
        //    Wednesday's cell, then a plain CLICK (the old code needed a swipe
        //    gesture that never fired) brings Wednesday into the grid window.
        composeTestRule
            .onNodeWithTag("calendar_day_strip")
            .performScrollToNode(hasContentDescription("Wednesday, 28 October"))
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithContentDescription("Wednesday, 28 October").performClick()
        composeTestRule.waitForIdle()

        // Wednesday's class slot renders inside the window with its time
        // range and room - no swipe, no extra scrolling needed to know it
        // is there.
        nodesWith("Intro to CS Lecture").onFirst().assertExists()
        nodesWith("09:00-10:30").onFirst().assertExists()
        nodesWith("B-204").onFirst().assertExists()
        composeTestRule
            .onAllNodesWithContentDescription("WED 08:00", substring = true)
            .onFirst()
            .assertExists()

        // Wednesday's cell now announces: selected, and it has items.
        val wednesdayState =
            composeTestRule
                .onNodeWithContentDescription("Wednesday, 28 October")
                .fetchSemanticsNode()
                .config[SemanticsProperties.StateDescription]
        check(wednesdayState == "Selected, Has items") {
            "Wednesday cell state description was '$wednesdayState', expected 'Selected, Has items'"
        }

        // 4. The week's LAST day is reachable the same way (the old test
        //    proved the pager could reach the right week edge): Saturday
        //    renders in the grid after a strip tap.
        composeTestRule
            .onNodeWithTag("calendar_day_strip")
            .performScrollToNode(hasContentDescription("Saturday, 31 October"))
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithContentDescription("Saturday, 31 October").performClick()
        composeTestRule.waitForIdle()
        composeTestRule
            .onAllNodesWithContentDescription("SAT 08:00", substring = true)
            .onFirst()
            .assertExists()

        // 5. The week arrows still exist and page whole weeks: after shifting
        //    forward, the strip shows the next week (Sunday, 1 November).
        composeTestRule.onNodeWithContentDescription("Next Week").performClick()
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithContentDescription("Sunday, 1 November").assertIsDisplayed()
    }

    @Test
    fun agendaView_emptyDay_readsClearDay_notAmbiguousClear() {
        val testDate = LocalDate.parse("2026-10-25") // Sunday, week start
        val monday = LocalDate.parse("2026-10-26")
        val engine = QuizRadarEngine.createInMemory(coreDispatcher = Dispatchers.Unconfined)

        runBlocking {
            engine.upsertCourse(
                """{ "id": "CS101", "name": "Intro to CS", "color": "#1a73e8" }""",
                "[]",
                testDate,
            )
        }

        val viewModel = QuizRadarViewModel(engine, coreDispatcher = Dispatchers.Main.immediate) { testDate }
        viewModel.loadState()
        viewModel.setSelectedCalendarDate(monday)

        composeTestRule.setContent {
            QuizRadarTheme {
                val state = viewModel.uiState.collectAsState().value
                if (state is UiState.Ready) {
                    CalendarScreen(snapshot = state.snapshot, viewModel = viewModel)
                }
            }
        }
        composeTestRule.waitForIdle()

        // The view switch is the Day / 3-Day / Week segmented control now
        // (the bare view-switch icon is gone). "Day" is the agenda list for
        // the selected day, and Monday has no items, so the day status must
        // read "Clear day", not a bare "Clear" that looks like a button.
        composeTestRule.onNodeWithText("Day").performClick()
        composeTestRule.waitForIdle()

        // One status label for the selected day's card; the day is empty.
        composeTestRule.onAllNodesWithText("Clear day").onFirst().assertExists()
    }
}
