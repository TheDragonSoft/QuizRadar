package com.quizradar.app.feedback

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.activity.ComponentActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreenshotRedactionTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `drag redaction permanently burns opaque black pixels into png and preserves unredacted corners`() {
        val file = createWhitePng("drag-redact.png")

        ScreenshotRedactor.applyRedactions(
            sourceFile = file,
            strokes =
                listOf(
                    RedactionStroke(
                        points = listOf(NormalizedPoint(0.25f, 0.5f), NormalizedPoint(0.75f, 0.5f)),
                        brushWidthFraction = 0.1f,
                    ),
                ),
        )

        val decoded = BitmapFactory.decodeFile(file.absolutePath)
        assertEquals(Color.BLACK, decoded.getPixel(50, 50))
        assertEquals(Color.WHITE, decoded.getPixel(2, 2))
        assertEquals(Color.WHITE, decoded.getPixel(97, 97))
        decoded.recycle()
    }

    @Test
    fun `single tap redaction burns a black spot at the tapped location`() {
        val file = createWhitePng("tap-redact.png")

        ScreenshotRedactor.applyRedactions(
            sourceFile = file,
            strokes =
                listOf(
                    RedactionStroke(
                        points = listOf(NormalizedPoint(0.5f, 0.5f)),
                        brushWidthFraction = 0.15f,
                    ),
                ),
        )

        val decoded = BitmapFactory.decodeFile(file.absolutePath)
        assertEquals(Color.BLACK, decoded.getPixel(50, 50))
        assertNotEquals(Color.BLACK, decoded.getPixel(5, 5))
        decoded.recycle()
    }

    @Test
    fun `controller applyScreenshotRedactions persists pixels and bumps screenshotRevision`() =
        runBlocking {
            val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
            val controller =
                BetaFeedbackController(
                    activity = activity,
                    scope = this@runBlocking,
                    currentScreenName = { "Dashboard" },
                    captureScreenshot = { destination ->
                        destination.parentFile?.mkdirs()
                        writeWhitePng(destination)
                    },
                    sharePackage = { error("not expected") },
                    packageBuilder =
                        BetaFeedbackPackageBuilder(
                            FeedbackBuildInfo("test", "debug", 35, "Robolectric"),
                        ),
                    exportDispatcher = Dispatchers.Unconfined,
                )

            controller.openFeedback("Dashboard")
            val initialRevision = controller.uiState.value.draft!!.screenshotRevision
            var completed = false
            controller.applyScreenshotRedactions(
                strokes = listOf(RedactionStroke(listOf(NormalizedPoint(0.5f, 0.5f)))),
                onComplete = { completed = true },
            )
            kotlinx.coroutines.yield()

            assertTrue(completed)
            val updatedDraft = controller.uiState.value.draft!!
            assertEquals(initialRevision + 1, updatedDraft.screenshotRevision)
            val decoded = BitmapFactory.decodeFile(updatedDraft.screenshot!!.absolutePath)
            assertEquals(Color.BLACK, decoded.getPixel(50, 50))
            decoded.recycle()
            controller.onDestroy()
        }

    private fun createWhitePng(name: String): File = writeWhitePng(File(temporaryFolder.root, name))

    private fun writeWhitePng(destination: File): File {
        val bitmap = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        FileOutputStream(destination).use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
        bitmap.recycle()
        return destination
    }
}
