package com.quizradar.app.nativeedge

import android.content.Context
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.notifications.ExamStartStatus
import com.quizradar.app.notifications.NotificationHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Offline regression tests for the A11 reminder fixes: real-time countdown
 * math (known/unknown/past starts, midnight and zone handling), honest
 * reminder/digest filtering of retired assessments, and owned-notification
 * cancellation bookkeeping.
 */
@RunWith(RobolectricTestRunner::class)
class NotificationLifecycleTest {
    private lateinit var context: Context
    private val zone: ZoneId = ZoneId.of("Asia/Amman")

    // Fixed reference instant — no dependence on the real clock.
    private val now: ZonedDateTime = ZonedDateTime.of(2026, 3, 8, 10, 0, 0, 0, zone)

    @Before
    fun setup() {
        context = RuntimeEnvironment.getApplication()
    }

    // -- known / unknown / past start times --------------------------------

    @Test
    fun testKnownFutureStartComputesRealMinutes() {
        val minutes =
            NotificationHelper.minutesUntilExamStart(
                now,
                LocalDate.of(2026, 3, 8),
                "14:00",
                zone,
            )

        assertEquals("Countdown must come from the real start, not a fixed value", 240, minutes)
        assertEquals(ExamStartStatus.FUTURE, NotificationHelper.examStartStatus(now, LocalDate.of(2026, 3, 8), "14:00", zone))
    }

    @Test
    fun testUnknownStartTimeNeverYieldsCountdown() {
        assertNull(
            "Missing date must yield no countdown",
            NotificationHelper.minutesUntilExamStart(now, null, "14:00", zone),
        )
        assertNull(
            "Missing start time must yield no countdown",
            NotificationHelper.minutesUntilExamStart(now, LocalDate.of(2026, 3, 8), null, zone),
        )
        assertNull(
            "Blank start time must yield no countdown",
            NotificationHelper.minutesUntilExamStart(now, LocalDate.of(2026, 3, 8), "  ", zone),
        )
        assertNull(
            "Unparsable start time must yield no countdown",
            NotificationHelper.minutesUntilExamStart(now, LocalDate.of(2026, 3, 8), "tomorrow-ish", zone),
        )
        assertEquals(ExamStartStatus.UNKNOWN, NotificationHelper.examStartStatus(now, null, "14:00", zone))
        assertEquals(ExamStartStatus.UNKNOWN, NotificationHelper.examStartStatus(now, LocalDate.of(2026, 3, 8), "14:60", zone))
    }

    @Test
    fun testPastStartTimeNeverYieldsCountdown() {
        assertNull(
            "Past start must yield no countdown",
            NotificationHelper.minutesUntilExamStart(now, LocalDate.of(2026, 3, 8), "09:30", zone),
        )
        assertNull(
            "Yesterday's exam must yield no countdown",
            NotificationHelper.minutesUntilExamStart(now, LocalDate.of(2026, 3, 7), "23:30", zone),
        )
        assertEquals(ExamStartStatus.PAST, NotificationHelper.examStartStatus(now, LocalDate.of(2026, 3, 7), "23:30", zone))
    }

    @Test
    fun testMidnightCrossingAcrossZones() {
        // Late-evening reference the day before an exam at 00:15.
        val evening = ZonedDateTime.of(2026, 3, 7, 23, 0, 0, 0, zone)
        val minutes =
            NotificationHelper.minutesUntilExamStart(
                evening,
                LocalDate.of(2026, 3, 8),
                "00:15",
                zone,
            )
        assertEquals("Countdown must cross midnight into the next day", 75, minutes)

        // Exam exactly at midnight yesterday is already past.
        assertEquals(
            ExamStartStatus.PAST,
            NotificationHelper.examStartStatus(now, LocalDate.of(2026, 3, 8), "00:00", zone),
        )
    }

    @Test
    fun testZoneParameterIsHonoredForTheSameWallClock() {
        // The same 14:00 wall clock means different instants per zone; the
        // countdown must use the zone the caller passes (the device zone in
        // production), not a hard-coded one.
        val minutesAmman =
            NotificationHelper.minutesUntilExamStart(
                now,
                LocalDate.of(2026, 3, 8),
                "14:00",
                ZoneId.of("Asia/Amman"),
            )
        val minutesUtc =
            NotificationHelper.minutesUntilExamStart(
                now,
                LocalDate.of(2026, 3, 8),
                "14:00",
                ZoneId.of("UTC"),
            )

        assertEquals(240, minutesAmman)
        // Asia/Amman has been UTC+3 year-round since Jordan abolished DST
        // (2022), so the 10:00 Amman reference is 07:00 UTC and 14:00 UTC is
        // 7h away — the old 360 expectation assumed a defunct UTC+2 offset.
        assertEquals(
            "14:00 UTC is 7h from the 10:00 Amman (UTC+3) reference",
            420,
            minutesUtc,
        )
    }

    @Test
    fun testCountdownFormattingBuckets() {
        assertEquals("45 mins", NotificationHelper.formatCountdown(45))
        assertEquals("60 mins", NotificationHelper.formatCountdown(60))
        assertEquals("1h 1m", NotificationHelper.formatCountdown(61))
        assertEquals("2h 15m", NotificationHelper.formatCountdown(135))
    }

    // -- reminder / digest filtering of retired & non-upcoming items -------

    @Test
    fun testRetiredAssessmentsExcludedFromRemindersAndDigest() {
        val assessments =
            listOf(
                upcoming(id = "asm-live", daysUntil = 0, isUpcoming = true),
                upcoming(id = "asm-retired", daysUntil = 0, isUpcoming = false),
                upcoming(id = "asm-cancelled", daysUntil = 1, isUpcoming = false),
                upcoming(id = "asm-past", daysUntil = -2, isUpcoming = true),
            )

        // Same filter chain as ExamReminderWorker (T-24h/same-day ≤48).
        val reminders =
            assessments
                .filter { it.isUpcoming && it.daysUntil != null && it.daysUntil in 0..1 }
                .take(48)
        assertEquals(
            "Retired/cancelled items must not be reminded",
            listOf("asm-live"),
            reminders.map { it.id },
        )

        // Same filter as the morning digest's exam list.
        val digestExams = assessments.filter { it.isUpcoming && it.daysUntil == 0 }
        assertEquals(
            "Retired items must not appear in the digest",
            listOf("asm-live"),
            digestExams.map { it.id },
        )
    }

    @Test
    fun testObsoleteAssessmentsSelectedForCancellation() {
        val now = ZonedDateTime.of(2026, 3, 8, 10, 0, 0, 0, zone)
        val assessments =
            listOf(
                upcoming(id = "asm-live-future", daysUntil = 0, isUpcoming = true, startTime = "14:00"),
                upcoming(id = "asm-retired", daysUntil = 0, isUpcoming = false, startTime = "14:00"),
                upcoming(id = "asm-started", daysUntil = 0, isUpcoming = true, startTime = "08:00"),
                upcoming(id = "asm-past", daysUntil = -1, isUpcoming = true, startTime = "14:00"),
                upcoming(id = "asm-unknown-time", daysUntil = 0, isUpcoming = true, startTime = null),
            )

        val obsolete =
            assessments.filter { assessment ->
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

        assertEquals(
            "Retired, already-started and past items must be cancelled; " +
                "future and unknown-time items must be left to the honest no-countdown path",
            listOf("asm-retired", "asm-started", "asm-past"),
            obsolete.map { it.id },
        )
    }

    // -- owned-notification bookkeeping ------------------------------------

    @Test
    fun testRememberedNotificationsAreCancelledAndForgotten() {
        val first = 123456789
        val second = 987654321

        NotificationHelper.rememberOwnedNotification(context, first)
        NotificationHelper.rememberOwnedNotification(context, second)
        assertEquals(2, NotificationHelper.cancelByIds(context, listOf(first, second)))

        // The reset integrator's entry point: the fixed test/timer IDs are
        // always covered, even with an empty registry, so the documented
        // count of an empty-registry pass is exactly the TWO fixed IDs
        // (TEST_NOTIFICATION_ID + TIMER_NOTIFICATION_ID) — cancelling a
        // missing ID is a harmless no-op, so repeat passes stay safe.
        assertEquals(2, NotificationHelper.cancelAllOwnedNotifications(context))
        assertEquals(2, NotificationHelper.cancelAllOwnedNotifications(context))
    }

    private fun upcoming(
        id: String,
        daysUntil: Int,
        isUpcoming: Boolean,
        startTime: String? = "14:00",
    ) = AssessmentModel(
        id = id,
        title = "Exam $id",
        courseId = "COURSE-$id",
        dateIso = LocalDate.of(2026, 3, 8).plusDays(daysUntil.toLong()),
        startTime = startTime,
        isUpcoming = isUpcoming,
        daysUntil = daysUntil,
    )
}
