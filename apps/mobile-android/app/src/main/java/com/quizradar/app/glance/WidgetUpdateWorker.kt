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
        return try {
            val engine = QuizRadarEngine.create(applicationContext)
            QuizRadarWidget.refreshFromEngine(applicationContext, engine)
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
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
