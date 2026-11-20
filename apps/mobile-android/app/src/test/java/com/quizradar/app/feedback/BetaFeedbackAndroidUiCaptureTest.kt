package com.quizradar.app.feedback

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.quizradar.app.ui.theme.QuizRadarTheme
import kotlinx.coroutines.Dispatchers
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.io.File
import java.io.FileOutputStream
import java.time.Instant

/** Renders the production feedback sheet for direct PR-review embedding. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w390dp-h844dp-night")
class BetaFeedbackAndroidUiCaptureTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val outputDir =
        File(System.getProperty("user.dir") ?: ".").resolve("../../web/public/android-ui").normalize()

    @Test
    fun capture_beta_feedback_dark() {
        val screenshot = createAttachmentScreenshot()
        val draft =
            BetaFeedbackDraft(
                id = "ui-capture-feedback",
                directory = requireNotNull(screenshot.parentFile),
                screenName = "Dashboard",
                createdAt = Instant.parse("2026-11-19T10:11:12Z"),
                screenshot = screenshot,
                voiceNote = null,
            )
        composeTestRule.setContent {
            CompositionLocalProvider(LocalFeedbackImageDecoderDispatcher provides Dispatchers.Unconfined) {
                QuizRadarTheme {
                    BetaFeedbackSheet(
                        state = BetaFeedbackUiState(draft = draft),
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

        waitForText("Beta feedback")
        composeTestRule
            .onNodeWithTag("beta-feedback-note")
            .performScrollTo()
            .performTextInput("Shake feedback UI capture")
        waitForText("Shake feedback UI capture")
        capturePng("beta-feedback-top-dark")

        composeTestRule.onNodeWithTag("beta-feedback-share").performScrollTo()
        capturePng("beta-feedback-share-dark")

        composeTestRule
            .onNodeWithTag("beta-feedback-redact")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        waitForText("Redact private info")
        capturePng("beta-feedback-redact-dark")
    }

    @Test
    fun capture_beta_feedback_inbox_dark() {
        val screenshot = createAttachmentScreenshot()
        val directory = requireNotNull(screenshot.parentFile)
        val voiceNote = File(directory, "voice-note.m4a").apply { writeBytes(byteArrayOf(1)) }
        val items =
            listOf(
                BetaFeedbackInboxItem(
                    id = "ui-capture-first",
                    directory = directory,
                    screenName = "Dashboard",
                    createdAt = Instant.parse("2026-11-19T10:11:12Z"),
                    note = "Dashboard countdown did not update",
                    screenshot = screenshot,
                    voiceNote = null,
                ),
                BetaFeedbackInboxItem(
                    id = "ui-capture-second",
                    directory = directory,
                    screenName = "Calendar",
                    createdAt = Instant.parse("2026-11-19T10:12:12Z"),
                    note = "Calendar moved after rotation",
                    screenshot = null,
                    voiceNote = voiceNote,
                ),
            )
        composeTestRule.setContent {
            CompositionLocalProvider(LocalFeedbackImageDecoderDispatcher provides Dispatchers.Unconfined) {
                QuizRadarTheme {
                    BetaFeedbackInboxSheet(
                        items = items,
                        loadErrors = emptyList(),
                        isExporting = false,
                        errorMessage = null,
                        onDismiss = {},
                        onDeleteItem = {},
                        onClear = {},
                        onExport = {},
                    )
                }
            }
        }

        waitForText("Feedback inbox")
        capturePng("beta-feedback-inbox-dark")
    }

    private fun waitForText(text: String) {
        composeTestRule.waitUntil(timeoutMillis = 8_000) {
            composeTestRule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun capturePng(name: String) {
        val decor = ShadowDialog.getLatestDialog().window?.decorView ?: error("Feedback dialog window is missing")
        val width = if (decor.width > 0) decor.width else 390
        val height = if (decor.height > 0) decor.height else 844
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        decor.draw(Canvas(bitmap))
        val output = outputDir.resolve("$name.png")
        output.parentFile?.mkdirs()
        FileOutputStream(output).use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
        bitmap.recycle()
        println("AndroidUiCapture: wrote ${output.absolutePath}")
    }

    private fun createAttachmentScreenshot(): File {
        val directory = File(System.getProperty("java.io.tmpdir"), "beta-feedback-ui-capture").apply { mkdirs() }
        val output = File(directory, "screenshot.png")
        val bitmap = Bitmap.createBitmap(390, 844, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.rgb(11, 15, 25))
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textAlign = Paint.Align.CENTER
                textSize = 24f
            }
        canvas.drawText("QuizRadar", 195f, 400f, paint)
        paint.textSize = 16f
        canvas.drawText("Screenshot attachment fixture", 195f, 435f, paint)
        FileOutputStream(output).use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
        bitmap.recycle()
        return output
    }
}
