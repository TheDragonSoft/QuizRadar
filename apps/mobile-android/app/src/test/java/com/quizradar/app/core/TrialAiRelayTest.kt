package com.quizradar.app.core

import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.SyllabusImportState
import com.quizradar.app.ui.TimetableImportState
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class TrialAiRelayTest {
    private val testDispatcher = StandardTestDispatcher()
    private val testDate = LocalDate.parse("2026-11-11")

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun enableStarterTrialAi_persists_flags_and_consent_off_still_blocks() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            assertFalse(viewModel.geminiEnabled.value)
            assertFalse(viewModel.aiTrialEnabled.value)

            viewModel.enableStarterTrialAi()
            advanceUntilIdle()

            assertTrue(viewModel.geminiEnabled.value)
            assertTrue(viewModel.aiTrialEnabled.value)
            assertTrue(engine.getConfigBool("gemini_enabled", false))
            assertTrue(engine.getConfigBool("ai_trial_enabled", false))
            assertEquals("{}", engine.getTrialAiQuotaJson())

            // Reloading ViewModel restores ai_trial_enabled cleanly.
            val reloaded = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertTrue(reloaded.aiTrialEnabled.value)

            // Disabling geminiEnabled hard-blocks AI calls even if aiTrialEnabled stays true.
            reloaded.setGeminiEnabled(false)
            advanceUntilIdle()

            reloaded.importTimetableFromImage(byteArrayOf(1, 2, 3), "image/png")
            advanceUntilIdle()
            val timetableState = reloaded.timetableImportState.value as TimetableImportState.Failed
            assertTrue(timetableState.message.contains("turned off"))

            reloaded.importSyllabiFromDocuments(
                listOf(Triple("syllabus.pdf", byteArrayOf(1, 2, 3), "application/pdf")),
            )
            advanceUntilIdle()
            val syllabusState = reloaded.syllabusImportState.value as SyllabusImportState.Failed
            assertTrue(syllabusState.message.contains("turned off"))
        }
}
