package com.quizradar.app.ui

import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.ui.calendar.WeekParityHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class WeekParityHelperTest {
    @Test
    fun getWeekParity_calculates_iso_parity() {
        // 2026-01-05 is ISO Week 2 (Even -> week_b)
        assertEquals("week_b", WeekParityHelper.getWeekParity(LocalDate.of(2026, 1, 5)))
        // 2026-01-12 is ISO Week 3 (Odd -> week_a)
        assertEquals("week_a", WeekParityHelper.getWeekParity(LocalDate.of(2026, 1, 12)))
    }

    @Test
    fun slotMatchesDate_filters_by_day_and_parity() {
        val slotAll =
            ScheduleSlotModel(
                id = "s1",
                day = "Monday",
                courseId = "CS101",
                courseName = "Computer Science",
                type = "Lecture",
                startTime = "09:00",
                endTime = "10:30",
                weekParity = "all",
            )
        val slotA = slotAll.copy(id = "s2", weekParity = "week_a")
        val slotB = slotAll.copy(id = "s3", weekParity = "week_b")

        val dateWeekB = LocalDate.of(2026, 1, 5) // Monday, Week 2 (week_b)
        val dateWeekA = LocalDate.of(2026, 1, 12) // Monday, Week 3 (week_a)
        val dateTuesday = LocalDate.of(2026, 1, 6) // Tuesday

        // DateWeekB (week_b)
        assertTrue(WeekParityHelper.slotMatchesDate(slotAll, dateWeekB))
        assertFalse(WeekParityHelper.slotMatchesDate(slotA, dateWeekB))
        assertTrue(WeekParityHelper.slotMatchesDate(slotB, dateWeekB))

        // DateWeekA (week_a)
        assertTrue(WeekParityHelper.slotMatchesDate(slotAll, dateWeekA))
        assertTrue(WeekParityHelper.slotMatchesDate(slotA, dateWeekA))
        assertFalse(WeekParityHelper.slotMatchesDate(slotB, dateWeekA))

        // Wrong day (Tuesday vs Monday)
        assertFalse(WeekParityHelper.slotMatchesDate(slotAll, dateTuesday))
    }
}
