package com.quizradar.app.glance

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.quizradar.app.core.QuizRadarEngine
import java.util.concurrent.TimeUnit

/**
 * Battery-conscious WorkManager worker to tick widget countdowns every 30 minutes.
 */
class WidgetUpdateWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        // `QuizRadarEngine.create` returns the process-cached singleton — the
        // store is shared with the UI and MUST NOT be closed here (an earlier
        // version closed it per-run when each worker owned its own engine;
        // that now bricks the app's DB access until process restart).
        val engine = QuizRadarEngine.create(applicationContext)
        return try {
            QuizRadarWidget.refreshFromEngine(applicationContext, engine)
            TodayScheduleWidget.refreshFromEngine(applicationContext, engine)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "quizradar_widget_periodic"

        fun schedule(context: Context) {
            val request =
                PeriodicWorkRequestBuilder<WidgetUpdateWorker>(30, TimeUnit.MINUTES)
                    // Without an initial delay the first iteration runs the
                    // moment the app starts, and the system's job service
                    // asks the process for it on the MAIN thread - while the
                    // activity is still starting up. On a slow first run that
                    // collision produced "No response to onStartJob for
                    // #WidgetUpdateWorker" (an ANR). Two minutes is enough
                    // to clear the start-up window, and the widget is
                    // refreshed by the UI itself on every start anyway.
                    .setInitialDelay(2, TimeUnit.MINUTES)
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
