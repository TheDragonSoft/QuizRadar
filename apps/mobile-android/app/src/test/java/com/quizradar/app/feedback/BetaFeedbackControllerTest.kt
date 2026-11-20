package com.quizradar.app.feedback

import androidx.activity.ComponentActivity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.nio.file.Files
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

    @Test
    fun `inbox exports multiple associated issues without clearing them`() =
        runBlocking {
            val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
            val store = BetaFeedbackInboxStore(Files.createTempDirectory("feedback-controller-inbox").toFile())
            var sharedPackage: File? = null
            var captureNumber = 0
            val messages = mutableListOf<String>()
            val controller =
                BetaFeedbackController(
                    activity = activity,
                    scope = this@runBlocking,
                    currentScreenName = { "Dashboard" },
                    captureScreenshot = { destination ->
                        captureNumber += 1
                        destination.parentFile?.mkdirs()
                        destination.writeBytes(byteArrayOf(captureNumber.toByte()))
                        destination
                    },
                    sharePackage = { sharedPackage = it },
                    packageBuilder = BetaFeedbackPackageBuilder(testBuildInfo),
                    exportDispatcher = kotlinx.coroutines.Dispatchers.Unconfined,
                    inboxStore = store,
                    showMessage = { messages += it },
                )

            controller.openFeedback("Dashboard")
            controller.saveFeedback("First saved issue")
            kotlinx.coroutines.yield()
            controller.openFeedback("Calendar")
            controller.saveFeedback("Second saved issue")
            kotlinx.coroutines.yield()

            assertEquals(2, controller.inboxItems.value.size)
            assertTrue(messages.any { it.contains("2 pending") })
            controller.openInbox()
            controller.shareInbox()
            kotlinx.coroutines.yield()

            val packageFile = sharedPackage
            assertNotNull(controller.uiState.value.inboxErrorMessage, packageFile)
            ZipFile(packageFile!!).use { zip ->
                val manifest = zip.getInputStream(zip.getEntry("batch-manifest.json")).bufferedReader().use { it.readText() }
                assertTrue(manifest.contains("\"issue_count\": 2"))
                val items = controller.inboxItems.value
                items.forEachIndexed { index, item ->
                    val screenshotPath = "issues/issue-${(index + 1).toString().padStart(3, '0')}-${item.id.take(8)}/screenshot.png"
                    val bytes = zip.getInputStream(zip.getEntry(screenshotPath)).use { it.readBytes() }
                    assertEquals((index + 1).toByte(), bytes.single())
                }
            }
            assertEquals("export must not delete saved issues", 2, controller.inboxItems.value.size)
            assertFalse(controller.uiState.value.isInboxOpen)
            assertTrue(messages.last().contains("Delivery is not confirmed"))
            controller.onDestroy()
        }

    @Test
    fun `detaching and reattaching activity preserves active draft across rotation`() {
        val firstActivity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val secondActivity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val controller =
            BetaFeedbackController(
                activity = firstActivity,
                scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined),
                currentScreenName = { "Settings" },
                captureScreenshot = { destination ->
                    destination.parentFile?.mkdirs()
                    destination.writeBytes(byteArrayOf(7, 8, 9))
                    destination
                },
                sharePackage = { error("not expected") },
                packageBuilder = BetaFeedbackPackageBuilder(testBuildInfo),
            )

        controller.openFeedback("Settings")
        val draftId = controller.uiState.value.draft?.id
        assertNotNull(draftId)

        controller.detachActivity(firstActivity)
        controller.attachActivity(secondActivity, currentScreenName = { "Settings" }, showMessage = {})

        assertEquals(draftId, controller.uiState.value.draft?.id)
        assertTrue(controller.uiState.value.draft?.screenshot?.isFile == true)
        controller.onDestroy()
        assertFalse(controller.uiState.value.draft?.directory?.exists() == true)
    }

    @Test
    fun `stale cache pruning removes orphaned drafts and expired packages while keeping recent ones`() {
        val cacheDir = Files.createTempDirectory("feedback-cache-prune").toFile()
        val activeDraftDir = File(cacheDir, "beta-feedback/drafts/active-id").apply { mkdirs() }
        val orphanedDraftDir = File(cacheDir, "beta-feedback/drafts/orphaned-id").apply { mkdirs() }
        val packagesDir = File(cacheDir, "beta-feedback/packages").apply { mkdirs() }
        val nowMs = 10_000_000_000L
        val oldZip =
            File(packagesDir, "old.zip").apply {
                writeBytes(byteArrayOf(1))
                setLastModified(nowMs - 48L * 60L * 60L * 1_000L)
            }
        val recentZips =
            (1..3).map { index ->
                File(packagesDir, "recent-$index.zip").apply {
                    writeBytes(byteArrayOf(index.toByte()))
                    setLastModified(nowMs - index * 60_000L)
                }
            }

        BetaFeedbackController.pruneStaleCache(cacheDir, activeDraftId = "active-id", nowMs = nowMs)

        assertTrue(activeDraftDir.exists())
        assertFalse(orphanedDraftDir.exists())
        assertFalse(oldZip.exists())
        recentZips.forEach { assertTrue(it.exists()) }
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
