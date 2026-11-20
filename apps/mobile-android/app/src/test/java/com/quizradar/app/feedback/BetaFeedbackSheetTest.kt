package com.quizradar.app.feedback

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.runtime.CompositionLocalProvider
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
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.FileOutputStream
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
    fun `save to inbox returns the current issue note`() {
        var savedNote: String? = null
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackSheet(
                    state = BetaFeedbackUiState(draft = draft()),
                    onDismiss = {},
                    onRemoveScreenshot = {},
                    onRecordClick = {},
                    onDeleteVoiceNote = {},
                    onPlaybackClick = {},
                    onShare = {},
                    onSaveToInbox = { savedNote = it },
                    onClearError = {},
                )
            }
        }

        composeTestRule.onNodeWithTag("beta-feedback-note").performScrollTo().performTextInput("Save this issue for batch export")
        composeTestRule
            .onNodeWithTag("beta-feedback-save-inbox")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        composeTestRule.waitUntil(timeoutMillis = 2_000) { savedNote != null }
        assertEquals("Save this issue for batch export", savedNote)
    }

    @Test
    fun `recording timer formatting is bounded and readable`() {
        assertEquals("0:00", formatRecordingTime(-1))
        assertEquals("1:05", formatRecordingTime(65))
        assertEquals("10:00", formatRecordingTime(600))
    }

    @Test
    fun `saving to inbox shows spinner only on the save button`() {
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackSheet(
                    state =
                        BetaFeedbackUiState(
                            draft = draft(),
                            pendingAction = BetaFeedbackPendingAction.SAVING_TO_INBOX,
                        ),
                    onDismiss = {},
                    onRemoveScreenshot = {},
                    onRecordClick = {},
                    onDeleteVoiceNote = {},
                    onPlaybackClick = {},
                    onShare = {},
                    onSaveToInbox = {},
                    onClearError = {},
                )
            }
        }

        composeTestRule.onNodeWithText("Saving to inbox…").performScrollTo().assertExists()
        composeTestRule.onNodeWithText("Share this issue now").performScrollTo().assertExists()
        composeTestRule.onNodeWithText("Preparing ZIP…").assertDoesNotExist()
    }

    @Test
    fun `dictated text appends cleanly and respects max note length`() {
        assertEquals("Button clipped on small screen", appendDictatedText("", "  Button clipped on small screen  "))
        assertEquals("Line one Line two", appendDictatedText("Line one", "Line two"))
        assertEquals("Line one\nLine two", appendDictatedText("Line one\n", "Line two"))
        val oversized = appendDictatedText("a".repeat(MAX_FEEDBACK_NOTE_LENGTH - 3), "hello world")
        assertEquals(MAX_FEEDBACK_NOTE_LENGTH, oversized.length)
    }

    @Test
    fun `redact button opens the screenshot redaction dialog`() {
        val screenshot = File.createTempFile("redact-sheet-test", ".png")
        try {
            val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.DKGRAY) }
            FileOutputStream(screenshot).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()

            composeTestRule.setContent {
                CompositionLocalProvider(LocalFeedbackImageDecoderDispatcher provides Dispatchers.Unconfined) {
                    QuizRadarTheme {
                        BetaFeedbackSheet(
                            state = BetaFeedbackUiState(draft = draft().copy(screenshot = screenshot)),
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
            }

            composeTestRule
                .onNodeWithTag("beta-feedback-redact")
                .performScrollTo()
                .assertIsEnabled()
                .performSemanticsAction(SemanticsActions.OnClick)
            composeTestRule.onNodeWithText("Redact private info").assertExists()
            composeTestRule.onNodeWithTag("beta-feedback-redact-canvas").assertExists()
        } finally {
            screenshot.delete()
        }
    }

    @Test
    fun `dictate reports an honest fallback message when no speech recognizer is installed`() {
        var reportedError: String? = null
        composeTestRule.setContent {
            QuizRadarTheme {
                BetaFeedbackSheet(
                    state = BetaFeedbackUiState(draft = draft()),
                    onDismiss = {},
                    onRemoveScreenshot = {},
                    onRecordClick = {},
                    onDeleteVoiceNote = {},
                    onPlaybackClick = {},
                    onShare = {},
                    onClearError = {},
                    onReportError = { reportedError = it },
                )
            }
        }

        composeTestRule
            .onNodeWithTag("beta-feedback-dictate")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        assertTrue(reportedError?.contains("Speech-to-text is not available") == true)
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
