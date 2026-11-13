package com.quizradar.app.notifications

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.quizradar.app.analytics.AnalyticsManager
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.QuizRadarJsonParser
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * First-party WorkManager worker for computing and dispatching T-24h / same-day
 * exam reminders and daily morning digests based on core data.
 *
 * The Settings keys this worker reads are exactly the ones the ViewModel
 * writes (`notify_exam_24h`, `notify_exam_same_day`, `notify_morning_digest`,
 * `notify_morning_time`) — the two sides once drifted apart and every toggle
 * was silently dead. Each alert carries a per-day "notified" marker: an hourly
 * periodic worker re-posts otherwise, which burned IMPORTANCE_HIGH alerts
 * twice a day per assessment for its whole visibility window.
 */
class ExamReminderWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        // `QuizRadarEngine.create` returns the process-cached singleton — the
        // store is shared with the UI and MUST NOT be closed here (an hourly
        // close would brick the app's DB access until process restart).
        val engine = QuizRadarEngine.create(applicationContext)
        return try {
            val notifyExam24h = engine.getConfigBool("notify_exam_24h", default = true)
            val notifyExamSameDay = engine.getConfigBool("notify_exam_same_day", default = true)
            val notifyDigest = engine.getConfigBool("notify_morning_digest", default = false)

            if (!notifyExam24h && !notifyExamSameDay && !notifyDigest) {
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

            suspend fun alreadyNotified(marker: String): Boolean = engine.getConfigBool(marker, default = false)

            suspend fun markNotified(marker: String) {
                engine.setConfigBool(marker, true)
            }

            if (notifyExam24h || notifyExamSameDay) {
                val now = ZonedDateTime.now()
                val zone = ZoneId.systemDefault()

                // Respect ≤48 nearest scheduled policy. Retired/cancelled
                // assessments (`isUpcoming == false`) and past days are never
                // reminded.
                val upcoming =
                    snapshot.assessments
                        .filter { it.isUpcoming && it.daysUntil != null && it.daysUntil in 0..1 }
                        .take(48)

                for (assessment in upcoming) {
                    val isSameDay = assessment.daysUntil == 0
                    if (isSameDay && !notifyExamSameDay) continue
                    if (!isSameDay && !notifyExam24h) continue

                    val marker =
                        "notified::${assessment.id}::${if (isSameDay) "same-day" else "24h"}::$today"
                    if (alreadyNotified(marker)) continue

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
                        NotificationHelper.rememberOwnedNotification(applicationContext, notifId)
                        markNotified(marker)
                        AnalyticsManager.trackExamReminderNotification(if (isSameDay) "same_day" else "24h")
                    } catch (_: SecurityException) {
                        // POST_NOTIFICATIONS runtime permission not granted
                    }
                }

                // The ongoing same-day countdown tracks reality on every
                // worker pass — it must not be gated by the once-per-day
                // "notified" marker, or it would freeze at its first value
                // and outlive the exam. A countdown exists only for a known,
                // still-future start (date + `HH:MM` in the device zone);
                // unknown or past starts cancel the stale notification
                // instead of inventing a fixed value.
                if (notifyExamSameDay) {
                    for (assessment in snapshot.assessments.filter { it.isUpcoming && it.daysUntil == 0 }) {
                        val persistentId = engine.notificationIdFor(assessment.id, "exam-ongoing")
                        val minutesRemaining =
                            NotificationHelper.minutesUntilExamStart(
                                now,
                                assessment.dateIso,
                                assessment.startTime,
                                zone,
                            )
                        if (minutesRemaining == null) {
                            NotificationHelper.cancelByIds(applicationContext, listOf(persistentId))
                        } else {
                            val persistentBuilder =
                                NotificationHelper.buildPersistentExamNotification(
                                    applicationContext,
                                    assessment,
                                    minutesRemaining,
                                )
                            try {
                                notificationManager.notify(persistentId, persistentBuilder.build())
                                NotificationHelper.rememberOwnedNotification(applicationContext, persistentId)
                            } catch (_: SecurityException) {
                                // POST_NOTIFICATIONS runtime permission not granted
                            }
                        }
                    }
                }

                // Retired/cancelled or already-started assessments keep none
                // of their owned reminder notifications alive (stable IDs via
                // `notificationIdFor`, so a re-post under the same id also
                // replaces instead of duplicating).
                val obsolete =
                    snapshot.assessments.filter { assessment ->
                        !assessment.isUpcoming ||
                            (assessment.daysUntil != null && assessment.daysUntil < 0) ||
                            (
                                assessment.daysUntil == 0 &&
                                    NotificationHelper.examStartStatus(
                                        now,
                                        assessment.dateIso,
                                        assessment.startTime,
                                        zone,
                                    ) == ExamStartStatus.PAST
                            )
                    }
                if (obsolete.isNotEmpty()) {
                    NotificationHelper.cancelByIds(
                        applicationContext,
                        obsolete.flatMap { assessment ->
                            NotificationHelper.EXAM_NOTIFICATION_KINDS.map { kind ->
                                engine.notificationIdFor(assessment.id, kind)
                            }
                        },
                    )
                }
            }

            if (notifyDigest) {
                // A "morning" digest never fires before the user's configured
                // time — the ungated version posted at any hour of the day.
                val morningTime =
                    runCatching {
                        LocalTime.parse(engine.getConfigString("notify_morning_time") ?: "08:00")
                    }.getOrDefault(LocalTime.of(8, 0))
                if (LocalTime.now() >= morningTime) {
                    val digestMarker = "notified::digest::$today"
                    if (!alreadyNotified(digestMarker)) {
                        val dayOfWeek = today.dayOfWeek.name
                        val todayClasses =
                            snapshot.schedule.slots.filter {
                                it.day.equals(dayOfWeek, ignoreCase = true) ||
                                    it.day.take(3).equals(dayOfWeek.take(3), ignoreCase = true)
                            }
                        val todayExams = snapshot.assessments.filter { it.isUpcoming && it.daysUntil == 0 }

                        if (todayClasses.isNotEmpty() || todayExams.isNotEmpty()) {
                            val digestSummary =
                                buildString {
                                    if (todayExams.isNotEmpty()) {
                                        append("Exams: ").append(todayExams.joinToString { it.title })
                                        if (todayClasses.isNotEmpty()) append(" · ")
                                    }
                                    if (todayClasses.isNotEmpty()) {
                                        append("Classes: ").append(
                                            todayClasses.joinToString { it.courseName ?: it.courseId },
                                        )
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
                                NotificationHelper.rememberOwnedNotification(applicationContext, digestId)
                                markNotified(digestMarker)
                            } catch (_: SecurityException) {
                            }
                        }
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
                    // Same reason as the widget worker: the first iteration
                    // used to land on the app's start-up window, where the
                    // system asks the process for it on the main thread.
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
