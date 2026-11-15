package com.quizradar.app.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Unit tests for [BackgroundScanWorker]: verifies opt-in gating, honesty
 * skips when nothing is configured, Gemini BYOK consent gating, and
 * WorkManager periodic schedule lifecycle against the real in-memory Rust store.
 */
@RunWith(RobolectricTestRunner::class)
class BackgroundScanWorkerTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    private fun newEngine(tokenProvider: MemoryTokenStore = MemoryTokenStore()): QuizRadarEngine =
        QuizRadarEngine.createInMemory(
            tokenProvider = tokenProvider,
            coreDispatcher = Dispatchers.IO,
        )

    private fun buildWorker(): BackgroundScanWorker = TestListenableWorkerBuilder<BackgroundScanWorker>(context).build()

    @Test
    fun executeWithEngine_returns_success_without_scanning_when_toggle_off() =
        runTest {
            val tokens =
                MemoryTokenStore().apply {
                    setGoogleRefreshToken("fake-refresh-token")
                }
            val engine = newEngine(tokens)
            engine.setConfigBool("background_scan_enabled", false)

            val result = buildWorker().executeWithEngine(engine)

            assertEquals(ListenableWorker.Result.success(), result)
            assertNull(
                "disabled worker must never record a sync timestamp",
                engine.getConfigString("last_sync_at"),
            )
        }

    @Test
    fun executeWithEngine_returns_success_without_stamping_when_nothing_configured() =
        runTest {
            val engine = newEngine()
            engine.setConfigBool("background_scan_enabled", true)

            val result = buildWorker().executeWithEngine(engine)

            assertEquals(ListenableWorker.Result.success(), result)
            assertNull(
                "unconfigured worker must skip without stamping a fake sync",
                engine.getConfigString("last_sync_at"),
            )
        }

    @Test
    fun executeWithEngine_skips_half_configured_moodle_channel_without_stamping() =
        runTest {
            val engine = newEngine()
            engine.setConfigBool("background_scan_enabled", true)
            engine.setConfigBool("moodle_enabled", true)
            engine.setConfigString("moodle_ical_url", "   ")

            val result = buildWorker().executeWithEngine(engine)

            assertEquals(ListenableWorker.Result.success(), result)
            assertNull(engine.getConfigString("last_sync_at"))
        }

    @Test
    fun resolveGeminiApiKey_respects_consent_toggle_and_trims_keys() {
        assertNull(
            "saved key must never leave the device when consent is off",
            BackgroundScanWorker.resolveGeminiApiKey(
                geminiEnabled = false,
                rawKey = "AIza-test-key",
            ),
        )
        assertNull(
            BackgroundScanWorker.resolveGeminiApiKey(
                geminiEnabled = true,
                rawKey = null,
            ),
        )
        assertNull(
            BackgroundScanWorker.resolveGeminiApiKey(
                geminiEnabled = true,
                rawKey = "   \t\n ",
            ),
        )
        assertEquals(
            "AIza-test-key",
            BackgroundScanWorker.resolveGeminiApiKey(
                geminiEnabled = true,
                rawKey = "  AIza-test-key  ",
            ),
        )
    }

    @Test
    fun rescheduleFromConfig_enqueues_periodic_work_when_enabled_and_cancels_when_disabled() =
        runTest {
            val engine = newEngine()
            val workManager = WorkManager.getInstance(context)

            engine.setConfigBool("background_scan_enabled", false)
            BackgroundScanWorker.rescheduleFromConfig(context, engine)
            val initialInfos = workManager.getWorkInfosForUniqueWork(BackgroundScanWorker.WORK_NAME).get()
            assertTrue(
                "disabled preference must leave zero queued background scan jobs",
                initialInfos.none { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING },
            )

            engine.setConfigBool("background_scan_enabled", true)
            BackgroundScanWorker.rescheduleFromConfig(context, engine)
            val enabledInfos = workManager.getWorkInfosForUniqueWork(BackgroundScanWorker.WORK_NAME).get()
            assertTrue(
                "enabling background scan must enqueue the unique periodic work",
                enabledInfos.any { it.state == WorkInfo.State.ENQUEUED },
            )

            engine.setConfigBool("background_scan_enabled", false)
            BackgroundScanWorker.rescheduleFromConfig(context, engine)
            val cancelledInfos = workManager.getWorkInfosForUniqueWork(BackgroundScanWorker.WORK_NAME).get()
            assertTrue(
                "disabling background scan must cancel the queued periodic work",
                cancelledInfos.none { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING },
            )
        }
}
