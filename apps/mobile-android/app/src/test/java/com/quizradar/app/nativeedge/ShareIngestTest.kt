package com.quizradar.app.nativeedge

import com.quizradar.app.core.MemoryTokenStore
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.QuizRadarJsonParser
import com.quizradar.app.ui.share.ShareIngestParser
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
class ShareIngestTest {
    @Test
    fun testGmailSubjectAndTextSplit() {
        val subject = "CS 101 Quiz 3 Announcement"
        val text = "Hello class,\n\nPlease note that Quiz 3 will cover chapters 4-5 on 2026-11-10 in Room 102."

        val draft = ShareIngestParser.parse(subject, text)

        assertEquals("CS 101 Quiz 3 Announcement", draft.title)
        assertEquals(text, draft.notes)
        assertEquals("CS 101", draft.courseId)
        assertEquals(LocalDate.parse("2026-11-10"), draft.dateIso)
    }

    @Test
    fun testSingleTextWithDoubleNewlineSplit() {
        val rawText = "MATH 201 Midterm Exam Details\n\nMidterm scheduled on 2026-11-18 from 10:00 to 12:00."

        val draft = ShareIngestParser.parse(null, rawText)

        assertEquals("MATH 201 Midterm Exam Details", draft.title)
        assertEquals("Midterm scheduled on 2026-11-18 from 10:00 to 12:00.", draft.notes)
        assertEquals("MATH 201", draft.courseId)
        assertEquals(LocalDate.parse("2026-11-18"), draft.dateIso)
    }

    @Test
    fun testStripsSubjectPrefix() {
        val subject = "Subject: Important Announcement: Physics Test"
        val text = "Test covers Newton's laws."

        val draft = ShareIngestParser.parse(subject, text)

        assertEquals("Important Announcement: Physics Test", draft.title)
    }

    @Test
    fun testDraftPersistsCustomEventToNativeStore() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val draft =
                ShareIngestParser.parse(
                    "Bio 102 Lab Practical",
                    "Bring lab coat on 2026-11-22.",
                )

            val eventJson =
                JSONObject().apply {
                    put("id", "custom-share-test-1")
                    put("title", draft.title)
                    put("course_id", draft.courseId)
                    put("event_type", "Custom")
                    put("date", draft.dateIso?.toString() ?: "2026-11-22")
                    put("start_time", "09:00")
                    put("end_time", "10:30")
                    put("notes", draft.notes)
                    put("color", "#db2777")
                }.toString()

            val updatedStateJson = engine.upsertCustomEvent(eventJson, LocalDate.of(2026, 11, 1))
            val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedStateJson)

            val saved = snapshot.customEvents.find { it.id == "custom-share-test-1" }
            assertNotNull("Saved custom event must exist in store", saved)
            assertEquals("Bio 102 Lab Practical", saved?.title)
            assertEquals("Bring lab coat on 2026-11-22.", saved?.notes)
            assertEquals("#db2777", saved?.color)
        }
}
