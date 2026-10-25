package com.quizradar.app.notifications

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.QuizRadarJsonParser
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * First-party WorkManager worker for computing and dispatching T-24h / same-day
 * exam reminders and daily morning digests based on core data.
 */
class ExamReminderWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return try {
            val engine = QuizRadarEngine.create(applicationContext)
            val notifyExams = engine.getConfigBool("notify_exams", default = true)
            val notifyDigest = engine.getConfigBool("notify_digest", default = true)

            if (!notifyExams && !notifyDigest) {
                return Result.success()
            }

            NotificationHelper.createNotificationChannels(applicationContext)
            val notificationManager = NotificationManagerCompat.from(applicationContext)
            if (!notificationManager.areNotificationsEnabled()) {
                return Result.success()
            }

            val today = LocalDate.now()
            val stateJson = engine.getState(today)
            val snapshot = QuizRadarJsonParser.parseAppSnapshot(stateJson)

            if (notifyExams) {
                // Respect ≤48 nearest scheduled policy
                val upcoming =
                    snapshot.assessments
                        .filter { it.daysUntil != null && it.daysUntil in 0..1 }
                        .take(48)

                for (assessment in upcoming) {
                    val isSameDay = assessment.daysUntil == 0
                    val kind = if (isSameDay) "exam-0d" else "exam-24h"
                    val notifId = engine.notificationIdFor(assessment.id, kind)
                    val builder =
                        NotificationHelper.buildExamNotification(
                            applicationContext,
                            assessment,
                            isSameDay,
                        )
                    try {
                        notificationManager.notify(notifId, builder.build())
                    } catch (_: SecurityException) {
                        // POST_NOTIFICATIONS runtime permission not granted
                    }
                }
            }

            if (notifyDigest) {
                val dayOfWeek = today.dayOfWeek.name
                val todayClasses =
                    snapshot.schedule.slots.filter {
                        it.day.equals(dayOfWeek, ignoreCase = true) ||
                            it.day.take(3).equals(dayOfWeek.take(3), ignoreCase = true)
                    }
                val todayExams = snapshot.assessments.filter { it.daysUntil == 0 }

                if (todayClasses.isNotEmpty() || todayExams.isNotEmpty()) {
                    val digestSummary =
                        buildString {
                            if (todayExams.isNotEmpty()) {
                                append("Exams: ").append(todayExams.joinToString { it.title })
                                if (todayClasses.isNotEmpty()) append(" · ")
                            }
                            if (todayClasses.isNotEmpty()) {
                                append("Classes: ").append(todayClasses.joinToString { it.courseId })
                            }
                        }
                    val digestId = engine.notificationIdFor(today.toString(), "digest")
                    val builder =
                        NotificationHelper.buildDigestNotification(
                            applicationContext,
                            todayClasses.size,
                            todayExams.size,
                            digestSummary,
                        )
                    try {
                        notificationManager.notify(digestId, builder.build())
                    } catch (_: SecurityException) {
                    }
                }
            }

            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "quizradar_exam_reminder_periodic"

        fun schedule(context: Context) {
            val request =
                PeriodicWorkRequestBuilder<ExamReminderWorker>(1, TimeUnit.HOURS)
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
