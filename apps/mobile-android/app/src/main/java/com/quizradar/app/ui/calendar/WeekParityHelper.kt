package com.quizradar.app.ui.calendar

import com.quizradar.app.model.ScheduleSlotModel
import java.time.LocalDate
import java.time.temporal.IsoFields

/**
 * Week parity calculation ("week_a" / "week_b") and timetable slot matching.
 *
 * Parity rule:
 * - Odd ISO 8601 calendar weeks are "week_a".
 * - Even ISO 8601 calendar weeks are "week_b".
 * - A slot with null, empty, or "all" weekParity runs on both weeks.
 */
object WeekParityHelper {
    fun getWeekParity(date: LocalDate): String {
        val isoWeek = date.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR)
        return if (isoWeek % 2 != 0) "week_a" else "week_b"
    }

    fun slotMatchesDate(
        slot: ScheduleSlotModel,
        date: LocalDate,
    ): Boolean {
        val dayName = date.dayOfWeek.name
        val matchesDay = slot.day.take(3).equals(dayName.take(3), ignoreCase = true)
        if (!matchesDay) return false

        val parity = slot.weekParity?.trim()?.lowercase() ?: "all"
        return when (parity) {
            "week_a" -> getWeekParity(date) == "week_a"
            "week_b" -> getWeekParity(date) == "week_b"
            else -> true
        }
    }
}
