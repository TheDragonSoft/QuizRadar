package com.quizradar.app.feedback

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.time.Instant
import java.util.zip.ZipFile

@RunWith(RobolectricTestRunner::class)
class BetaFeedbackPackageBuilderTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private val buildInfo =
        FeedbackBuildInfo(
            appVersion = "test-version",
            buildType = "staging",
            androidSdk = 35,
            device = "Test Device",
        )
    private val builder = BetaFeedbackPackageBuilder(buildInfo)

    @Test
    fun `package contains only the reviewed report and attachments`() {
        val draftDirectory = temporaryFolder.newFolder("draft")
        val screenshot = File(draftDirectory, "screenshot.png").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        val voiceNote = File(draftDirectory, "voice-note.m4a").apply { writeBytes(byteArrayOf(4, 5, 6)) }
        val draft = draft(draftDirectory).copy(screenshot = screenshot, voiceNote = voiceNote)

        val output = builder.build(draft, "  Calendar moved after I rotated the phone.  ", temporaryFolder.newFolder("packages"))

        assertTrue(output.isFile)
        assertTrue(output.name.startsWith("quizradar-feedback-20261119-101112-"))
        ZipFile(output).use { zip ->
            assertEquals(
                setOf("agent-brief.md", "screenshot.png", "voice-note.m4a"),
                zip.entries().asSequence().map { it.name }.toSet(),
            )
            val brief = zip.getInputStream(zip.getEntry("agent-brief.md")).bufferedReader().use { it.readText() }
            assertTrue(brief.contains("Calendar moved after I rotated the phone."))
            assertTrue(brief.contains("App version: test-version"))
            assertTrue(brief.contains("Current screen: Calendar"))
            assertTrue(brief.contains("Suggested ZCode workflow"))
            assertTrue(brief.contains("cannot confirm delivery"))
            assertTrue(zip.getInputStream(zip.getEntry("screenshot.png")).use { it.readBytes() }.contentEquals(byteArrayOf(1, 2, 3)))
            assertTrue(zip.getInputStream(zip.getEntry("voice-note.m4a")).use { it.readBytes() }.contentEquals(byteArrayOf(4, 5, 6)))
        }
    }

    @Test
    fun `removed attachments are not silently reintroduced`() {
        val draft = draft(temporaryFolder.newFolder("draft"))
        val output = builder.build(draft, "Written report only", temporaryFolder.newFolder("packages"))

        ZipFile(output).use { zip ->
            assertEquals(setOf("agent-brief.md"), zip.entries().asSequence().map { it.name }.toSet())
            val brief = zip.getInputStream(zip.getEntry("agent-brief.md")).bufferedReader().use { it.readText() }
            assertTrue(brief.contains("Screenshot attached: no"))
            assertTrue(brief.contains("Voice note attached: no"))
            assertFalse(brief.contains("google_client_secret"))
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `an empty report cannot be packaged`() {
        builder.build(
            draft(temporaryFolder.newFolder("draft")),
            "   ",
            temporaryFolder.newFolder("packages"),
        )
    }

    @Test
    fun `batch manifest keeps every note and attachment with its own issue`() {
        val firstDirectory = temporaryFolder.newFolder("first")
        val firstScreenshot = File(firstDirectory, "screenshot.png").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        val secondDirectory = temporaryFolder.newFolder("second")
        val secondVoice = File(secondDirectory, "voice-note.m4a").apply { writeBytes(byteArrayOf(4, 5, 6)) }
        val first =
            BetaFeedbackInboxItem(
                id = "12345678-test-feedback",
                directory = firstDirectory,
                screenName = "Dashboard",
                createdAt = Instant.parse("2026-11-19T10:11:12Z"),
                note = "First \"issue\"\nwith a second line",
                screenshot = firstScreenshot,
                voiceNote = null,
            )
        val second =
            BetaFeedbackInboxItem(
                id = "abcdef12-second-feedback",
                directory = secondDirectory,
                screenName = "Calendar",
                createdAt = Instant.parse("2026-11-19T10:12:12Z"),
                note = "",
                screenshot = null,
                voiceNote = secondVoice,
            )
        val batchBuilder = BetaFeedbackPackageBuilder(buildInfo) { Instant.parse("2026-11-19T12:00:00Z") }

        val output = batchBuilder.buildBatch(listOf(second, first), temporaryFolder.newFolder("packages"))

        assertTrue(output.name.startsWith("quizradar-feedback-batch-20261119-120000-"))
        ZipFile(output).use { zip ->
            val firstDirectoryName = "issues/issue-001-12345678"
            val secondDirectoryName = "issues/issue-002-abcdef12"
            assertEquals(
                setOf(
                    "batch-index.md",
                    "batch-manifest.json",
                    "$firstDirectoryName/agent-brief.md",
                    "$firstDirectoryName/screenshot.png",
                    "$secondDirectoryName/agent-brief.md",
                    "$secondDirectoryName/voice-note.m4a",
                ),
                zip.entries().asSequence().map { it.name }.toSet(),
            )
            val manifestText = zip.getInputStream(zip.getEntry("batch-manifest.json")).bufferedReader().use { it.readText() }
            val manifest = JSONObject(manifestText)
            assertEquals(2, manifest.getInt("issue_count"))
            val issues = manifest.getJSONArray("issues")
            val firstJson = issues.getJSONObject(0)
            val secondJson = issues.getJSONObject(1)
            assertEquals("12345678-test-feedback", firstJson.getString("id"))
            assertEquals(firstDirectoryName, firstJson.getString("directory"))
            assertEquals("First \"issue\"\nwith a second line", firstJson.getString("note"))
            assertEquals("$firstDirectoryName/screenshot.png", firstJson.getString("screenshot"))
            assertTrue(firstJson.isNull("voice_note"))
            assertEquals("abcdef12-second-feedback", secondJson.getString("id"))
            assertEquals("$secondDirectoryName/voice-note.m4a", secondJson.getString("voice_note"))
            assertTrue(secondJson.isNull("screenshot"))
            assertNull(zip.getEntry("$firstDirectoryName/feedback.json"))
            val index = zip.getInputStream(zip.getEntry("batch-index.md")).bufferedReader().use { it.readText() }
            assertTrue(index.contains("Issue 1: Dashboard"))
            assertTrue(index.contains("Issue 2: Calendar"))
        }
    }

    @Test
    fun `batch export preserves per-issue build info when saved on an earlier version`() {
        val dir = temporaryFolder.newFolder("older-issue")
        val olderInfo =
            FeedbackBuildInfo(
                appVersion = "5.17.0",
                buildType = "release",
                androidSdk = 34,
                device = "Pixel 8",
            )
        val item =
            BetaFeedbackInboxItem(
                id = "12345678-older-issue",
                directory = dir,
                screenName = "Tasks",
                createdAt = Instant.parse("2026-11-18T10:11:12Z"),
                note = "Captured before upgrading",
                screenshot = null,
                voiceNote = null,
                buildInfo = olderInfo,
            )

        val output = builder.buildBatch(listOf(item), temporaryFolder.newFolder("packages"))
        ZipFile(output).use { zip ->
            val brief =
                zip.getInputStream(zip.getEntry("issues/issue-001-12345678/agent-brief.md")).bufferedReader().use {
                    it.readText()
                }
            assertTrue(brief.contains("App version: 5.17.0"))
            assertTrue(brief.contains("Build type: release"))
            assertTrue(brief.contains("Device: Pixel 8"))
        }
    }

    private fun draft(directory: File): BetaFeedbackDraft =
        BetaFeedbackDraft(
            id = "12345678-test-feedback",
            directory = directory,
            screenName = "Calendar",
            createdAt = Instant.parse("2026-11-19T10:11:12Z"),
            screenshot = null,
            voiceNote = null,
        )
}
