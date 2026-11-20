package com.quizradar.app.feedback

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

@RunWith(RobolectricTestRunner::class)
class BetaFeedbackInboxStoreTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `saved issues and attachments survive a fresh store instance`() {
        val root = temporaryFolder.newFolder("inbox")
        val store = BetaFeedbackInboxStore(root)
        store.saveDraft(draft("first", hasVoice = false), "Dashboard issue")
        store.saveDraft(draft("second", hasVoice = true), "Calendar issue")

        val reloaded = BetaFeedbackInboxStore(root)
        assertEquals(2, reloaded.items.value.size)
        val first = reloaded.items.value.first { it.id == "first" }
        val second = reloaded.items.value.first { it.id == "second" }
        assertEquals("Dashboard issue", first.note)
        assertEquals("Calendar issue", second.note)
        assertTrue(first.screenshot?.readBytes()?.contentEquals(byteArrayOf(1)) == true)
        assertNull(first.voiceNote)
        assertTrue(second.screenshot?.readBytes()?.contentEquals(byteArrayOf(2)) == true)
        assertTrue(second.voiceNote?.readBytes()?.contentEquals(byteArrayOf(3)) == true)
        assertFalse(File(root.parentFile, "drafts/first").exists())

        reloaded.deleteItem("first")
        assertEquals(listOf("second"), reloaded.items.value.map { it.id })
        assertEquals(1, BetaFeedbackInboxStore(root).items.value.size)

        reloaded.clear()
        assertTrue(reloaded.items.value.isEmpty())
        assertTrue(BetaFeedbackInboxStore(root).items.value.isEmpty())
    }

    @Test
    fun `voice only issue keeps a blank written note`() {
        val root = temporaryFolder.newFolder("inbox")
        val draft = draft("voice-only", hasVoice = true)
        val store = BetaFeedbackInboxStore(root)

        val saved = store.saveDraft(draft, "   ")
        assertEquals("", saved.note)
        assertTrue(saved.voiceNote?.isFile == true)
        assertEquals("", BetaFeedbackInboxStore(root).items.value.single().note)
    }

    @Test
    fun `damaged metadata is reported without losing other issues`() {
        val root = temporaryFolder.newFolder("inbox")
        val store = BetaFeedbackInboxStore(root)
        store.saveDraft(draft("valid", hasVoice = false), "Readable issue")
        val damaged = File(root, "issues/damaged").apply { mkdirs() }
        File(damaged, "feedback.json").writeText("not-json")

        val reloaded = BetaFeedbackInboxStore(root)
        assertEquals(listOf("valid"), reloaded.items.value.map { it.id })
        assertEquals(1, reloaded.loadErrors.value.size)
        assertTrue(reloaded.loadErrors.value.single().contains("could not be read"))
    }

    private fun draft(
        id: String,
        hasVoice: Boolean,
    ): BetaFeedbackDraft {
        val directory = File(temporaryFolder.root, "drafts/$id").apply { mkdirs() }
        val screenshot = File(directory, "screenshot.png").apply { writeBytes(if (id == "first") byteArrayOf(1) else byteArrayOf(2)) }
        val voice = if (hasVoice) File(directory, "voice-note.m4a").apply { writeBytes(byteArrayOf(3)) } else null
        return BetaFeedbackDraft(
            id = id,
            directory = directory,
            screenName = if (id == "first") "Dashboard" else "Calendar",
            createdAt = Instant.parse("2026-11-19T10:11:12Z").plusSeconds(if (id == "second") 60 else 0),
            screenshot = screenshot,
            voiceNote = voice,
        )
    }
}
