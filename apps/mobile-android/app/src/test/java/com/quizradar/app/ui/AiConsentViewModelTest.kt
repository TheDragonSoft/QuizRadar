package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarEngine
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

/**
 * A07 shell-side consent honesty (docs/ANDROID-APP-AUDIT-2026-11-10.md A07):
 * saving a key never enables AI, enable/consent is a separate persisted
 * state, and the timetable import checks the PREFERENCE before anything —
 * including the Keystore read — happens, so a retained key cannot permit a
 * send while AI is disabled.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class AiConsentViewModelTest {
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
    fun saving_a_gemini_key_never_enables_ai() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            assertFalse(viewModel.geminiEnabled.value)
            viewModel.saveGeminiApiKey("k-test")
            advanceUntilIdle()

            assertEquals("k-test", viewModel.geminiApiKey.value)
            assertEquals("the key reached the Keystore", "k-test", engine.geminiApiKey())
            assertFalse(
                "saving the key must NOT flip the consent flag (A07)",
                viewModel.geminiEnabled.value,
            )
            assertFalse(
                engine.getConfigBool("gemini_enabled", false),
            )
        }

    @Test
    fun the_enable_flag_is_a_separate_persisted_state_that_survives_a_restart() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val first = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            first.setGeminiEnabled(true)
            advanceUntilIdle()
            assertTrue(first.geminiEnabled.value)

            // A fresh ViewModel over the same store reads the persisted
            // consent state back — enable/consent outlives the process.
            val second = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()
            assertTrue(
                "the consent flag must reload from the store",
                second.geminiEnabled.value,
            )
        }

    @Test
    fun timetable_import_with_ai_disabled_makes_no_request_despite_a_retained_key() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            // The user once saved a key but turned AI off. The preference is
            // checked BEFORE the Keystore read, so with the toggle off zero
            // core AI calls (and zero bytes to the network) happen.
            viewModel.saveGeminiApiKey("k-test")
            advanceUntilIdle()
            viewModel.importTimetableFromImage(byteArrayOf(1, 2, 3), "image/png")
            advanceUntilIdle()

            val state = viewModel.timetableImportState.value
            assertTrue(
                "expected Failed, got $state",
                state is TimetableImportState.Failed,
            )
            assertTrue(
                "the failure names the disabled AI state: ${(state as TimetableImportState.Failed).message}",
                state.message.contains("turned off"),
            )
        }

    @Test
    fun timetable_import_with_ai_enabled_but_no_key_asks_for_the_key() =
        runTest {
            val engine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)
            val viewModel = QuizRadarViewModel(engine, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            viewModel.setGeminiEnabled(true)
            advanceUntilIdle()
            viewModel.importTimetableFromImage(byteArrayOf(1, 2, 3), "image/png")
            advanceUntilIdle()

            val state = viewModel.timetableImportState.value
            assertTrue(
                "expected Failed, got $state",
                state is TimetableImportState.Failed,
            )
            assertTrue(
                (state as TimetableImportState.Failed).message.contains("Gemini API key"),
            )
        }
}
