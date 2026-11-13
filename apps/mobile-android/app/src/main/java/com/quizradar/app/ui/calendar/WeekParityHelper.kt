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

    /**
     * Day match that accepts every spelling the timetable uses: the full
     * name ("Monday"), the three letter abbreviation ("Mon") and the odd
     * short form ("Th"). The agenda used to compare "Monday" against a "Mon"
     * slot and therefore lost every abbreviated class (audit A09).
     */
    fun dayMatches(
        slotDay: String,
        date: LocalDate,
    ): Boolean {
        val slot = slotDay.trim().lowercase()
        if (slot.isEmpty()) return false
        val target = date.dayOfWeek.name.lowercase()
        if (slot == target) return true
        if (slot.length >= 3 && target.startsWith(slot.take(3))) return true
        return false
    }

    fun slotMatchesDate(
        slot: ScheduleSlotModel,
        date: LocalDate,
    ): Boolean {
        if (!dayMatches(slot.day, date)) return false

        val parity = slot.weekParity?.trim()?.lowercase() ?: "all"
        return when (parity) {
            "week_a" -> getWeekParity(date) == "week_a"
            "week_b" -> getWeekParity(date) == "week_b"
            else -> true
        }
    }
}
