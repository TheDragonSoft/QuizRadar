package com.quizradar.app.feedback

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.quizradar.app.ui.theme.QuizRadarTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.time.Instant

@RunWith(RobolectricTestRunner::class)
class BetaFeedbackSheetTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `written report requires content and returns the reviewed note`() {
        var sharedNote: String? = null
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackSheet(
                    state = BetaFeedbackUiState(draft = draft()),
                    onDismiss = {},
                    onRemoveScreenshot = {},
                    onRecordClick = {},
                    onDeleteVoiceNote = {},
                    onPlaybackClick = {},
                    onShare = { sharedNote = it },
                    onClearError = {},
                )
            }
        }

        composeTestRule.onNodeWithTag("beta-feedback-share").performScrollTo().assertIsNotEnabled()
        composeTestRule.onNodeWithTag("beta-feedback-note").performScrollTo().performTextInput("The quiz title was clipped")
        composeTestRule
            .onNodeWithTag("beta-feedback-share")
            .performScrollTo()
            .assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        composeTestRule.waitUntil(timeoutMillis = 2_000) { sharedNote != null }

        assertEquals("The quiz title was clipped", sharedNote)
        composeTestRule.onNodeWithText("Opens Android's share sheet. QuizRadar cannot confirm delivery or a fix.").assertExists()
    }

    @Test
    fun `a voice note can replace the written description`() {
        val voiceNote = File.createTempFile("voice-note", ".m4a").apply { writeBytes(byteArrayOf(1)) }
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackSheet(
                    state = BetaFeedbackUiState(draft = draft().copy(voiceNote = voiceNote)),
                    onDismiss = {},
                    onRemoveScreenshot = {},
                    onRecordClick = {},
                    onDeleteVoiceNote = {},
                    onPlaybackClick = {},
                    onShare = {},
                    onClearError = {},
                )
            }
        }

        composeTestRule.onNodeWithText("Play voice note").performScrollTo().assertExists()
        composeTestRule.onNodeWithTag("beta-feedback-share").performScrollTo().assertIsEnabled()
        voiceNote.delete()
    }

    @Test
    fun `recording timer formatting is bounded and readable`() {
        assertEquals("0:00", formatRecordingTime(-1))
        assertEquals("1:05", formatRecordingTime(65))
        assertEquals("10:00", formatRecordingTime(600))
    }

    private fun draft(): BetaFeedbackDraft =
        BetaFeedbackDraft(
            id = "sheet-test",
            directory = File(System.getProperty("java.io.tmpdir"), "sheet-test"),
            screenName = "Dashboard",
            createdAt = Instant.parse("2026-11-19T10:11:12Z"),
            screenshot = null,
            voiceNote = null,
        )
}
