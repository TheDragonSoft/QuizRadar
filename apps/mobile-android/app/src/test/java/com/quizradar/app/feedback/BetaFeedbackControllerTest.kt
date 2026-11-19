package com.quizradar.app.feedback

import androidx.activity.ComponentActivity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.zip.ZipFile

@RunWith(RobolectricTestRunner::class)
class BetaFeedbackControllerTest {
    @Test
    fun `capture failure still allows an honest written report`() =
        runBlocking {
            val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
            var sharedPackage: File? = null
            val controller =
                BetaFeedbackController(
                    activity = activity,
                    scope = this@runBlocking,
                    currentScreenName = { "Dashboard" },
                    captureScreenshot = { null },
                    sharePackage = { sharedPackage = it },
                    packageBuilder = BetaFeedbackPackageBuilder(testBuildInfo),
                    exportDispatcher = kotlinx.coroutines.Dispatchers.Unconfined,
                )

            controller.openFeedback("Dashboard")
            assertNotNull(controller.uiState.value.draft)
            assertNull(controller.uiState.value.draft?.screenshot)
            assertTrue(controller.uiState.value.errorMessage?.contains("could not be captured") == true)

            controller.shareFeedback("The dashboard stayed blank after refresh")
            kotlinx.coroutines.yield()

            assertNull("export failed: ${controller.uiState.value.errorMessage}", controller.uiState.value.errorMessage)
            val packageFile = sharedPackage
            assertNotNull("state=${controller.uiState.value}", packageFile)
            assertTrue(packageFile?.isFile == true)
            ZipFile(packageFile!!).use { zip ->
                val brief = zip.getInputStream(zip.getEntry("agent-brief.md")).bufferedReader().use { it.readText() }
                assertTrue(brief.contains("The dashboard stayed blank after refresh"))
            }
            assertNull("opening a chooser must not be reported as delivery", controller.uiState.value.draft)
            assertNull(controller.uiState.value.errorMessage)
            controller.onDestroy()
        }

    @Test
    fun `discarding a draft deletes its private capture files`() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val controller =
            BetaFeedbackController(
                activity = activity,
                scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
                currentScreenName = { "Calendar" },
                captureScreenshot = { destination ->
                    destination.parentFile?.mkdirs()
                    destination.writeBytes(byteArrayOf(1, 2, 3))
                    destination
                },
                sharePackage = { error("not expected") },
                packageBuilder = BetaFeedbackPackageBuilder(testBuildInfo),
            )

        controller.openFeedback("Calendar")
        val draft = controller.uiState.value.draft
        assertTrue(draft?.screenshot?.isFile == true)

        controller.dismiss()

        assertNull(controller.uiState.value.draft)
        assertFalse(draft?.directory?.exists() == true)
        controller.onDestroy()
    }

    @Test
    fun `shake preference is explicit and persistent`() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val controller =
            BetaFeedbackController(
                activity = activity,
                scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
                currentScreenName = { "Dashboard" },
                captureScreenshot = { null },
                sharePackage = { error("not expected") },
                packageBuilder = BetaFeedbackPackageBuilder(testBuildInfo),
            )

        assertTrue(controller.shakeEnabled.value)
        controller.setShakeEnabled(false)
        assertFalse(controller.shakeEnabled.value)
        assertFalse(
            activity.getSharedPreferences("quizradar_beta_feedback", 0).getBoolean("shake_enabled", true),
        )
        assertTrue("GitHub release builds must include tester feedback", controller.isAvailable)
        controller.onDestroy()
    }

    private companion object {
        val testBuildInfo =
            FeedbackBuildInfo(
                appVersion = "test",
                buildType = "debug",
                androidSdk = 35,
                device = "Robolectric",
            )
    }
}
