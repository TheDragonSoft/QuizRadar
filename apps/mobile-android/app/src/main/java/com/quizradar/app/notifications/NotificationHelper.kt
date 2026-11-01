package com.quizradar.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.quizradar.app.MainActivity
import com.quizradar.app.model.AssessmentModel

/**
 * First-party notification helper creating notification channels and builders
 * for exam reminders and daily morning digests.
 */
object NotificationHelper {
    const val CHANNEL_EXAMS = "quizradar_exam_reminders"
    const val CHANNEL_DIGEST = "quizradar_morning_digest"
    const val CHANNEL_FOCUS = "quizradar_focus_timer"

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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
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
        if (
            android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU &&
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.POST_NOTIFICATIONS,
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
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
                .setSmallIcon(android.R.drawable.ic_dialog_info)
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
    ) {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
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
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build()

        notificationManager.notify(7788, notification)
    }
}
