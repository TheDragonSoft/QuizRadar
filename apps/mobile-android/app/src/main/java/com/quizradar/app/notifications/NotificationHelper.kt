package com.quizradar.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.quizradar.app.MainActivity
import com.quizradar.app.R
import com.quizradar.app.model.AssessmentModel
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Whether a known exam start instant lies ahead of the reference instant. */
enum class ExamStartStatus {
    /** A real, parseable start exists and has not happened yet. */
    FUTURE,

    /** A real, parseable start exists but has already passed. */
    PAST,

    /** No date or no parsable start time — nothing honest can be computed. */
    UNKNOWN,
}

/**
 * First-party notification helper creating notification channels and builders
 * for exam reminders and daily morning digests.
 */
object NotificationHelper {
    const val CHANNEL_EXAMS = "quizradar_exam_reminders"
    const val CHANNEL_DIGEST = "quizradar_morning_digest"
    const val CHANNEL_FOCUS = "quizradar_focus_timer"

    /** Notification kinds the reminder worker owns per assessment (stable via `notificationIdFor`). */
    val EXAM_NOTIFICATION_KINDS = listOf("exam-24h", "exam-0d", "exam-ongoing")

    const val TEST_NOTIFICATION_ID = 777
    const val TIMER_NOTIFICATION_ID = 7788

    private const val OWNED_PREFS_FILE = "quizradar_owned_notifications"
    private const val OWNED_IDS_KEY = "owned_notification_ids"

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val examsChannel =
                NotificationChannel(
                    CHANNEL_EXAMS,
                    "Exam & Quiz Reminders",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Notifications 24 hours before and morning of upcoming exams"
                    enableVibration(true)
                }

            val digestChannel =
                NotificationChannel(
                    CHANNEL_DIGEST,
                    "Daily Morning Digest",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Daily morning overview of classes and assessments"
                }

            val focusChannel =
                NotificationChannel(
                    CHANNEL_FOCUS,
                    "Focus & Pomodoro Timer",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Chime and notifications when focus work or break intervals complete"
                    enableVibration(true)
                }

            notificationManager.createNotificationChannel(examsChannel)
            notificationManager.createNotificationChannel(digestChannel)
            notificationManager.createNotificationChannel(focusChannel)
        }
    }

    fun buildExamNotification(
        context: Context,
        assessment: AssessmentModel,
        isSameDay: Boolean,
    ): NotificationCompat.Builder {
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("EXTRA_ASSESSMENT_ID", assessment.id)
            }
        val pendingIntent =
            PendingIntent.getActivity(
                context,
                assessment.id.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val prefix = if (isSameDay) "Today" else "Tomorrow"
        val timeStr = assessment.displayTime?.let { " at $it" } ?: ""
        val roomStr = if (assessment.room != null && assessment.room != "—") " · Room ${assessment.room}" else ""
        val title = "$prefix: ${assessment.title}"
        val body = "${assessment.courseName ?: assessment.courseId ?: "Exam"}$timeStr$roomStr"

        return NotificationCompat.Builder(context, CHANNEL_EXAMS)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
    }

    fun buildPersistentExamNotification(
        context: Context,
        assessment: AssessmentModel,
        minutesRemaining: Int,
    ): NotificationCompat.Builder {
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("EXTRA_ASSESSMENT_ID", assessment.id)
            }
        val pendingIntent =
            PendingIntent.getActivity(
                context,
                (assessment.id + "_ongoing").hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val courseStr = assessment.courseName ?: assessment.courseId ?: "Exam"
        val timeStr = assessment.displayTime?.let { " ($it)" } ?: ""
        val roomStr = if (assessment.room != null && assessment.room != "—") " · Room ${assessment.room}" else ""
        val countdownText = formatCountdown(minutesRemaining)
        val title = "🎯 Exam Soon: ${assessment.title} (in $countdownText)"
        val body = "$courseStr$roomStr$timeStr"

        return NotificationCompat.Builder(context, CHANNEL_EXAMS)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            // The worker refreshes this countdown every pass; each refresh
            // must silently update, not re-alert with sound/vibration.
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
    }

    fun buildDigestNotification(
        context: Context,
        classesCount: Int,
        examsCount: Int,
        summary: String,
    ): NotificationCompat.Builder {
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        val pendingIntent =
            PendingIntent.getActivity(
                context,
                "digest".hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val title = "Today's Schedule: $classesCount classes, $examsCount upcoming"
        return NotificationCompat.Builder(context, CHANNEL_DIGEST)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(summary)
            .setStyle(NotificationCompat.BigTextStyle().bigText(summary))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
    }

    fun sendTestNotification(context: Context) {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Android 13+: posting without POST_NOTIFICATIONS throws
        // SecurityException — a "test my notifications" button must never
        // crash the app it is testing.
        if (!canPostNotifications(context)) return
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        val pendingIntent =
            PendingIntent.getActivity(
                context,
                "test_notification".hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val notification =
            NotificationCompat.Builder(context, CHANNEL_EXAMS)
                .setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setContentTitle("QuizRadar Notification Test")
                .setContentText("Notifications and reminder sound channels are operating properly.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()

        try {
            notificationManager.notify(777, notification)
        } catch (_: SecurityException) {
            // Permission was revoked between the check and the post.
        }
    }

    fun sendTimerCompleteNotification(
        context: Context,
        isBreak: Boolean,
    ): Boolean {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Android 13+: posting without POST_NOTIFICATIONS throws
        // SecurityException. The caller swallows it, so the "your timer
        // finished" chime used to disappear with no word to the user.
        if (!canPostNotifications(context)) return false
        val title = if (isBreak) "Break Finished!" else "Focus Session Complete!"
        val body =
            if (isBreak) {
                "Ready to resume your next study sprint? Let's focus."
            } else {
                "Great work! Take a short break, stretch, and rest your eyes."
            }
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        val pendingIntent =
            PendingIntent.getActivity(
                context,
                "focus_timer".hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val notification =
            NotificationCompat.Builder(context, CHANNEL_FOCUS)
                .setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()

        return try {
            notificationManager.notify(7788, notification)
            true
        } catch (_: SecurityException) {
            // The permission was revoked between the check and the post.
            false
        }
    }

    /**
     * Whether the app may post notifications right now.
     *
     * Before Android 13 the permission does not exist, so the answer is
     * always yes.
     */
    fun canPostNotifications(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.POST_NOTIFICATIONS,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    /**
     * Classifies the assessment's real start instant against `now` in `zone`.
     *
     * Core serialises `start_time` as `HH:MM` (see `core/src/types.rs`), so a
     * wall-clock parse is the honest contract; anything unparsable, missing
     * or already past is reported instead of invented around.
     */
    fun examStartStatus(
        now: ZonedDateTime,
        dateIso: LocalDate?,
        startTime: String?,
        zone: ZoneId,
    ): ExamStartStatus {
        val date = dateIso ?: return ExamStartStatus.UNKNOWN
        val time =
            startTime
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
                ?: return ExamStartStatus.UNKNOWN
        val startAt = ZonedDateTime.of(date, time, zone)
        return if (startAt.isAfter(now)) ExamStartStatus.FUTURE else ExamStartStatus.PAST
    }

    /**
     * Whole minutes until the assessment's real start, or `null` when the
     * start is unknown or already past — a countdown is never fabricated.
     */
    fun minutesUntilExamStart(
        now: ZonedDateTime,
        dateIso: LocalDate?,
        startTime: String?,
        zone: ZoneId,
    ): Int? {
        val date = dateIso ?: return null
        val time =
            startTime
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
                ?: return null
        val startAt = ZonedDateTime.of(date, time, zone)
        if (!startAt.isAfter(now)) return null
        val minutes = Duration.between(now, startAt).toMinutes()
        return if (minutes > 0) minutes.toInt() else null
    }

    /** "45 mins" under an hour, otherwise "2h 15m" — never a made-up value. */
    fun formatCountdown(minutes: Int): String = if (minutes <= 60) "$minutes mins" else "${minutes / 60}h ${minutes % 60}m"

    // ------------------------------------------------------------------
    // Owned-notification bookkeeping: every notification the reminder
    // worker posts is remembered so a reset (or a retired/past assessment)
    // can cancel it even after the underlying data is gone.
    // ------------------------------------------------------------------

    private fun ownedPrefs(context: Context): SharedPreferences = context.getSharedPreferences(OWNED_PREFS_FILE, Context.MODE_PRIVATE)

    fun rememberOwnedNotification(
        context: Context,
        notificationId: Int,
    ) {
        val prefs = ownedPrefs(context)
        val ids = prefs.getStringSet(OWNED_IDS_KEY, emptySet()).orEmpty() + notificationId.toString()
        prefs.edit().putStringSet(OWNED_IDS_KEY, ids).apply()
    }

    private fun forgetOwnedNotification(
        context: Context,
        notificationId: Int,
    ) {
        val prefs = ownedPrefs(context)
        val ids = prefs.getStringSet(OWNED_IDS_KEY, emptySet()).orEmpty() - notificationId.toString()
        prefs.edit().putStringSet(OWNED_IDS_KEY, ids).apply()
    }

    /**
     * Cancels the given notifications and clears their owned-registry
     * entries. Returns how many cancel calls were attempted.
     */
    fun cancelByIds(
        context: Context,
        notificationIds: Collection<Int>,
    ): Int {
        val notificationManager = NotificationManagerCompat.from(context)
        var cancelled = 0
        for (id in notificationIds) {
            runCatching { notificationManager.cancel(id) }
                .onSuccess {
                    cancelled++
                    forgetOwnedNotification(context, id)
                }
        }
        return cancelled
    }

    /**
     * Cancels every notification this app's first-party paths own: all IDs
     * remembered by the reminder worker plus the fixed test/timer IDs.
     *
     * Intended for the data-reset integrator (`resetAllData` wipes the store
     * that derived the notifications, so they must not outlive it).
     *
     * @return number of notifications actually cancelled.
     */
    fun cancelAllOwnedNotifications(context: Context): Int {
        val rememberedIds =
            ownedPrefs(context)
                .getStringSet(OWNED_IDS_KEY, emptySet())
                .orEmpty()
                .mapNotNull { it.toIntOrNull() }
        return cancelByIds(context, rememberedIds + TEST_NOTIFICATION_ID + TIMER_NOTIFICATION_ID)
    }
}
