package com.quizradar.app.feedback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant
import java.util.zip.ZipFile

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
