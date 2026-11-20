package com.quizradar.app.feedback

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import com.quizradar.app.ui.theme.QuizRadarTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
class BetaFeedbackInboxSheetTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `multiple issues remain distinct and export together`() {
        var exportCount = 0
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackInboxSheet(
                    items = listOf(item("first", "First issue"), item("second", "Second issue")),
                    loadErrors = emptyList(),
                    isExporting = false,
                    errorMessage = null,
                    onDismiss = {},
                    onDeleteItem = {},
                    onClear = {},
                    onExport = { exportCount += 1 },
                )
            }
        }

        composeTestRule.onNodeWithTag("inbox-issue-first").assertExists()
        composeTestRule.onNodeWithTag("inbox-issue-second").performScrollTo().assertExists()
        composeTestRule.onNodeWithText("First issue").assertExists()
        composeTestRule.onNodeWithText("Second issue").assertExists()
        composeTestRule
            .onNodeWithTag("beta-feedback-export-all")
            .performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(1, exportCount)
    }

    @Test
    fun `deleting one issue requires confirmation`() {
        val deleted = mutableListOf<String>()
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackInboxSheet(
                    items = listOf(item("first", "First issue")),
                    loadErrors = emptyList(),
                    isExporting = false,
                    errorMessage = null,
                    onDismiss = {},
                    onDeleteItem = { deleted += it },
                    onClear = {},
                    onExport = {},
                )
            }
        }

        composeTestRule.onNodeWithTag("inbox-delete-first").performSemanticsAction(SemanticsActions.OnClick)
        assertTrue(deleted.isEmpty())
        composeTestRule.onNodeWithText("Delete this saved issue?").assertExists()
        composeTestRule.onNodeWithText("Delete", substring = false).performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf("first"), deleted)
    }

    private fun item(
        id: String,
        note: String,
    ): BetaFeedbackInboxItem =
        BetaFeedbackInboxItem(
            id = id,
            directory = File(System.getProperty("java.io.tmpdir"), "inbox-ui-$id"),
            screenName = if (id == "first") "Dashboard" else "Calendar",
            createdAt = Instant.parse("2026-11-19T10:11:12Z").plusSeconds(if (id == "second") 60 else 0),
            note = note,
            screenshot = null,
            voiceNote = null,
        )
}
