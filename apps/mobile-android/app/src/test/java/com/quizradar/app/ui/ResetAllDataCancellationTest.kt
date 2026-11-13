package com.quizradar.app.ui

import com.quizradar.app.core.QuizRadarCore
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
 * A core that RECORDS the calls the reset makes, in order.
 *
 * The order is the whole point: the native scan cancellation has to be
 * requested BEFORE the transactional wipe, otherwise a scan already inside
 * the blocking native call can persist its results right after the reset and
 * undo it (audit A05).
 */
private class RecordingResetCore(
    private val delegate: QuizRadarCore,
) : QuizRadarCore by delegate {
    val calls = mutableListOf<String>()

    override fun cancelScan() {
        calls += "cancelScan"
    }

    override suspend fun resetAllData() {
        calls += "resetAllData"
        delegate.resetAllData()
    }
}

/**
 * The same recorder, but the store rejects the transactional wipe.
 */
private class RecordingFailingResetCore(
    private val delegate: QuizRadarCore,
) : QuizRadarCore by delegate {
    val calls = mutableListOf<String>()

    override fun cancelScan() {
        calls += "cancelScan"
    }

    override suspend fun resetAllData(): Unit = throw IllegalStateException("store rejected the reset")
}

/**
 * A core WITHOUT native cancellation - exactly what the interface's safe
 * default does (`throw UnsupportedOperationException`). The reset must not
 * break because of it.
 */
private class NoNativeCancelCore(
    private val delegate: QuizRadarCore,
) : QuizRadarCore by delegate {
    override fun cancelScan(): Unit = throw UnsupportedOperationException("cancelScan is not supported by this fake")
}

/**
 * "Reset All Data" must not be undone by the scan that was already running
 * (audit A05, docs/ANDROID-APP-AUDIT-2026-11-10.md).
 *
 * The core owns the real cancellation (`QuizRadarCore.cancelScan()` ->
 * `NativeStore.cancel_native_sync` -> the `scan_cancelled` flag, re-checked
 * before every persist), so the reset has to ask for it BEFORE the wipe. A
 * core that has no native cancellation must not break the reset, and a
 * failed wipe must still fail loudly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ResetAllDataCancellationTest {
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

    private fun engine(): QuizRadarEngine = QuizRadarEngine.createInMemory(coreDispatcher = testDispatcher)

    private val feedJson =
        """
        {
            "id": "feed-ics-1",
            "name": "Course Calendar",
            "url": "https://example.edu/calendar.ics",
            "enabled": true
        }
        """.trimIndent()

    @Test
    fun the_native_scan_is_cancelled_before_the_store_is_wiped() =
        runTest {
            val engine = engine()
            engine.saveFeed(feedJson, testDate)
            val core = RecordingResetCore(engine)
            val viewModel = QuizRadarViewModel(core, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            var completed = false
            viewModel.resetAllData { completed = true }
            advanceUntilIdle()

            assertTrue(
                "the reset must ask the core to abort the native scan: ${core.calls}",
                core.calls.contains("cancelScan"),
            )
            val cancelAt = core.calls.indexOf("cancelScan")
            val resetAt = core.calls.indexOf("resetAllData")
            assertTrue("the reset must reach the transactional wipe: ${core.calls}", resetAt >= 0)
            assertTrue(
                "the native cancellation must be requested BEFORE the wipe: ${core.calls}",
                cancelAt >= 0 && cancelAt < resetAt,
            )
            assertTrue("onComplete must fire for a successful reset", completed)
            assertEquals("All data and credentials reset", viewModel.toastMessage.value)
            assertFalse(
                "the wipe must really have emptied the store",
                engine.getState(testDate).contains("\"feed-ics-1\""),
            )
        }

    @Test
    fun a_failed_wipe_still_fails_loudly_and_never_claims_success() =
        runTest {
            val engine = engine()
            val core = RecordingFailingResetCore(engine)
            val viewModel = QuizRadarViewModel(core, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            var completed = false
            viewModel.resetAllData { completed = true }
            advanceUntilIdle()

            assertTrue("onComplete must not fire for a failed reset", !completed)
            val toast = viewModel.toastMessage.value
            assertTrue("the failure must be reported, got: $toast", toast != null && toast.startsWith("Reset failed"))
            assertFalse(
                "a failed reset must never claim success",
                toast == "All data and credentials reset",
            )
        }

    @Test
    fun a_core_without_native_cancellation_does_not_break_the_reset() =
        runTest {
            val engine = engine()
            engine.saveFeed(feedJson, testDate)
            val core = NoNativeCancelCore(engine)
            val viewModel = QuizRadarViewModel(core, clockDate = { testDate }, coreDispatcher = testDispatcher)
            advanceUntilIdle()

            var completed = false
            viewModel.resetAllData { completed = true }
            advanceUntilIdle()

            assertTrue("the reset must still complete", completed)
            assertEquals("All data and credentials reset", viewModel.toastMessage.value)
            assertFalse(
                "the wipe must really have emptied the store",
                engine.getState(testDate).contains("\"feed-ics-1\""),
            )
        }
}
