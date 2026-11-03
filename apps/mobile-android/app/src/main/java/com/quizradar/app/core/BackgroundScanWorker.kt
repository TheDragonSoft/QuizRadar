package com.quizradar.app.core

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.quizradar.app.model.QuizRadarJsonParser
import java.util.concurrent.TimeUnit

/**
 * The opt-in periodic scan (default OFF - AGENTS honesty doctrine: the user
 * decides, the app never scans silently).
 *
 * Runs the same Rust orchestration the manual scan uses, every 6 hours,
 * through the process-cached engine (its serialized dispatcher keeps the
 * store single-threaded while the UI is doing other things).
 *
 * Honesty rules:
 * - the toggle is re-checked from the store at run time, so a stale schedule
 *   can never scan after the user turned it off,
 * - when nothing is configured (no tokens, no Moodle channel, no feeds) the
 *   worker no-ops WITHOUT stamping or notifying,
 * - a scan that finds nothing or fails posts NO notification - silence is
 *   the honest outcome for "nothing happened"; the next manual scan shows
 *   the real per-source report and the dashboard shows the stamp.
 */
class BackgroundScanWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        // `QuizRadarEngine.create` returns the process-cached singleton - the
        // store is shared with the UI and MUST NOT be closed here (same rule
        // as the widget and reminder workers).
        val engine =
            try {
                QuizRadarEngine.create(applicationContext)
            } catch (_: Exception) {
                return Result.retry()
            }
        return try {
            if (!engine.getConfigBool("background_scan_enabled", default = false)) {
                return Result.success()
            }

            val googleConnected =
                !engine.tokenProvider.getGoogleRefreshToken().isNullOrBlank() ||
                    !engine.tokenProvider.getGoogleAccessToken().isNullOrBlank()
            val microsoftConnected =
                !engine.tokenProvider.getMicrosoftRefreshToken().isNullOrBlank() ||
                    !engine.tokenProvider.getMicrosoftAccessToken().isNullOrBlank()
            val gmailToggle = engine.getConfigBool("gmail_enabled", default = true)
            val classroomToggle = engine.getConfigBool("classroom_enabled", default = true)
            val teamsToggle = engine.getConfigBool("teams_enabled", default = true)
            val moodleEnabled = engine.getConfigBool("moodle_enabled", default = false)
            val moodleIcalUrl = engine.getConfigString("moodle_ical_url")
            val moodleRestUrl = engine.getConfigString("moodle_rest_url")
            val moodleConfigured = !moodleIcalUrl.isNullOrBlank() || !moodleRestUrl.isNullOrBlank()
            val feedsEnabled =
                QuizRadarJsonParser
                    .parseAppSnapshot(engine.getState(java.time.LocalDate.now()))
                    .feeds
                    .any { it.enabled }

            val anyConfigured =
                (googleConnected && (gmailToggle || classroomToggle)) ||
                    (microsoftConnected && teamsToggle) ||
                    (moodleEnabled && moodleConfigured) ||
                    feedsEnabled
            if (!anyConfigured) {
                // Nothing to scan with - skip without stamping anything. The
                // next manual scan reports the configured sources honestly.
                return Result.success()
            }

            // The core's bearerToken callback is SYNCHRONOUS and runs on the
            // engine's serialized dispatcher - it must never try to read the
            // config store there (that call would queue behind the running
            // scan and deadlock). The client ids are read BEFORE the run and
            // captured as plain strings.
            val googleClientId = engine.getConfigString("google_client_id")
            val teamsClientId = engine.getConfigString("teams_client_id")
            engine.oauthClientIds =
                OAuthClientIds(
                    google = { googleClientId },
                    microsoft = { teamsClientId },
                )

            val syncConfig =
                FfiSyncConfig(
                    gmailEnabled = googleConnected && gmailToggle,
                    teamsEnabled = microsoftConnected && teamsToggle,
                    moodleEnabled = moodleEnabled && moodleConfigured,
                    classroomEnabled = googleConnected && classroomToggle,
                    moodleIcalUrl = moodleIcalUrl?.trim()?.takeIf { it.isNotEmpty() },
                    moodleRestUrl = moodleRestUrl?.trim()?.takeIf { it.isNotEmpty() },
                    // No Moodle token storage on this shell; a half-configured
                    // channel is reported by the core, not half-run.
                    moodleRestToken = null,
                )

            val progress =
                object : FfiSyncProgressListener {
                    override fun onProgress(
                        source: String,
                        stage: String,
                        found: UInt,
                        done: UInt,
                    ) {
                        // No live UI in the background - pulses are dropped.
                    }
                }
            engine.runNativeSync(syncConfig, progress)
            Result.success()
        } catch (_: Exception) {
            // Transient failures (offline, provider 5xx) retry on the system's
            // schedule; the periodic job itself keeps its 6h cadence.
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "quizradar_background_scan_periodic"

        /**
         * Enqueues or cancels the periodic scan. Called from the Settings
         * toggle and once at start-up (after the config was read) - never
         * unconditionally, so a disabled toggle does not leave a worker that
         * would only no-op every 6 hours.
         */
        fun reschedule(
            context: Context,
            enabled: Boolean,
        ) {
            val workManager = WorkManager.getInstance(context)
            if (!enabled) {
                workManager.cancelUniqueWork(WORK_NAME)
                return
            }
            val request =
                PeriodicWorkRequestBuilder<BackgroundScanWorker>(6, TimeUnit.HOURS)
                    // Same reason as the widget worker: the first iteration must
                    // not land in the app's start-up window.
                    .setInitialDelay(15, TimeUnit.MINUTES)
                    .build()
            workManager.enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** Start-up hook: reads the persisted toggle off the main thread, then schedules. */
        suspend fun rescheduleFromConfig(
            context: Context,
            engine: QuizRadarEngine,
        ) {
            reschedule(context, engine.getConfigBool("background_scan_enabled", default = false))
        }
    }
}
