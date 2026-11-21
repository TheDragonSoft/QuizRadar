package com.quizradar.app.core

import com.quizradar.app.model.QuizRadarJsonParser
import com.quizradar.app.ui.CoursePackImportState
import com.quizradar.app.ui.CoursePackShareState
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.SyllabusImportState
import com.quizradar.app.ui.UiState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

private class FakeSyllabusDocumentCore(
    delegate: QuizRadarCore,
    private val apiKey: String?,
) : QuizRadarCore by delegate {
    var extractCallCount = 0

    override fun geminiApiKey(): String? = apiKey

    override suspend fun extractSyllabusFromDocument(
        documentB64: String,
        mime: String,
        apiKey: String,
    ): String {
        extractCallCount += 1
        if (mime == "image/png") {
            throw IllegalStateException("Corrupted PNG header")
        }
        return """
            {
              "schedule": {
                "semester": "Fall 2026",
                "courses": [
                  {
                    "id": "ECE210",
                    "name": "Digital Systems",
                    "color": "#1a73e8",
                    "credits": 3.0,
                    "aliases": ["ECE 210"]
                  }
                ],
                "slots": [
                  {
                    "id": "slot-1",
                    "day": "Mon",
                    "day_index": 1,
                    "course_id": "ECE210",
                    "course_name": "Digital Systems",
                    "type": "Lecture",
                    "start_time": "10:00",
                    "end_time": "11:30",
                    "display_time": "10:00\u201311:30"
                  }
                ]
              },
              "assessments": [
                {
                  "course_id": "ECE210",
                  "title": "Midterm Exam",
                  "assessment_type": "Midterm Exam",
                  "date_iso": "2026-11-05",
                  "weightage_percent": 30.0,
                  "topics": ["Boolean Algebra"],
                  "warnings": []
                },
                {
                  "course_id": "ECE210",
                  "title": "Final Project",
                  "assessment_type": "Assignment",
                  "date_iso": null,
                  "weightage_percent": 25.0,
                  "topics": ["FSM Design"],
                  "warnings": []
                }
              ],
              "dropped_courses": 0,
              "dropped_slots": 1,
              "dropped_assessments": 0,
              "model": "gemini-3-flash-preview"
            }
            """.trimIndent()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class CoursePackAndSyllabusTest {
    private val testDispatcher = StandardTestDispatcher()
    private val testDate = LocalDate.parse("2026-10-25")

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun syllabus_consent_gate_blocks_when_ai_disabled() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val fake = FakeSyllabusDocumentCore(engine, apiKey = "fake-key")
            val vm = QuizRadarViewModel(fake, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            vm.setGeminiEnabled(false)
            advanceUntilIdle()

            vm.importSyllabiFromDocuments(
                listOf(Triple("syllabus.pdf", "JVBERi0xLjQ=".toByteArray(), "application/pdf")),
            )
            advanceUntilIdle()

            assertTrue(vm.syllabusImportState.value is SyllabusImportState.Failed)
            assertEquals(0, fake.extractCallCount)
        }

    @Test
    fun multi_syllabus_import_apply_then_share_and_first_run_recipient_import() =
        runTest {
            val senderEngine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val fake = FakeSyllabusDocumentCore(senderEngine, apiKey = "fake-key")
            val senderVm = QuizRadarViewModel(fake, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            senderVm.setGeminiEnabled(true)
            advanceUntilIdle()

            senderVm.importSyllabiFromDocuments(
                listOf(
                    Triple("ece210.pdf", "JVBERi0xLjQ=".toByteArray(), "application/pdf"),
                    Triple("broken.png", "iVBORw0=".toByteArray(), "image/png"),
                ),
            )
            advanceUntilIdle()

            val preview = senderVm.syllabusImportState.value as? SyllabusImportState.Preview
            assertNotNull("Expected Preview state", preview)
            assertEquals(1, preview!!.fileErrors.size)
            assertTrue(preview.fileErrors[0].contains("broken.png"))
            assertEquals(1, preview.extracted.droppedSlots)
            assertEquals(2, preview.extracted.assessments.size)
            assertNull(preview.extracted.assessments[1].dateIso)

            senderVm.applyImportedSyllabi(
                semester = preview.extracted.schedule.semester,
                courses = preview.extracted.schedule.courses,
                slots = preview.extracted.schedule.slots,
                assessments = preview.extracted.assessments,
            )
            advanceUntilIdle()

            val applied = senderVm.syllabusImportState.value as? SyllabusImportState.Applied
            assertNotNull("Expected Applied state", applied)
            assertEquals(1, applied!!.report.coursesAdded)
            assertEquals(1, applied.report.slotsAdded)
            assertEquals(2, applied.report.assessmentsAdded)

            // Save a personal achieved score to verify Course Pack scrubs it on share.
            val ready = senderVm.uiState.value as UiState.Ready
            val midtermId = ready.snapshot.assessments.first { it.title == "Midterm Exam" }.id
            senderVm.saveGrade(midtermId, achieved = 95.0, max = 100.0, weight = 30.0)
            advanceUntilIdle()

            senderVm.dismissSyllabusImport()
            senderVm.openShareCoursePack("ECE210")
            advanceUntilIdle()

            val shareReady = senderVm.coursePackShareState.value as? CoursePackShareState.Ready
            assertNotNull("Expected Share Ready state", shareReady)
            assertTrue(shareReady!!.export.links.webUrl.contains("#course="))
            assertTrue(shareReady.export.links.deepLink.startsWith("quizradar://course?d="))
            assertTrue(shareReady.export.links.fitsQr)
            assertNotNull(shareReady.export.qr)

            val rawDecodedJson = CoursePackCodec.decode(shareReady.export.links.deepLink)
            assertFalse("Personal grade must never be in Course Pack", rawDecodedJson.contains("95"))

            // First-run recipient device imports via the classmate deep link.
            val recipientEngine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            recipientEngine.setConfigBool("onboarding_completed", false)
            val recipientVm =
                QuizRadarViewModel(recipientEngine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertFalse(recipientVm.onboardingCompleted.value)

            recipientVm.previewCoursePackLink(shareReady.export.links.webUrl)
            advanceUntilIdle()

            val packPreview = recipientVm.coursePackImportState.value as? CoursePackImportState.Preview
            assertNotNull("Expected recipient Preview state", packPreview)
            assertEquals("ECE210", packPreview!!.pack.course.id)
            assertEquals(2, packPreview.pack.assessments.size)

            recipientVm.applyCoursePackImport(shareReady.export.links.webUrl)
            advanceUntilIdle()

            assertTrue(recipientVm.coursePackImportState.value is CoursePackImportState.Idle)
            assertTrue("First-run Course Pack import completes onboarding", recipientVm.onboardingCompleted.value)
            val recipientReady = recipientVm.uiState.value as UiState.Ready
            assertEquals(listOf("ECE210"), recipientReady.snapshot.schedule.courses.map { it.id })
            assertEquals(2, recipientReady.snapshot.assessments.size)

            val parsedRoundTrip = QuizRadarJsonParser.parseCoursePackPayload(rawDecodedJson)
            assertEquals("ECE210", parsedRoundTrip.course.id)
        }
}
