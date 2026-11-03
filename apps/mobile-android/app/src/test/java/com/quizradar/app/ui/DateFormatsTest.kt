package com.quizradar.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The Android shell must never print a raw storage date, and the Date/Time
 * facts row must not repeat the date in both columns.
 */
class DateFormatsTest {
    @Test
    fun formats_an_iso_date_the_way_the_web_tier_prints_it() {
        assertEquals("Sun, Nov 1, 2026", formatIsoDateForDisplay("2026-11-01"))
        assertEquals("Wed, Feb 4, 2026", formatIsoDateForDisplay("2026-02-04"))
    }

    @Test
    fun rejects_a_malformed_or_missing_date_instead_of_printing_it_raw() {
        assertNull(formatIsoDateForDisplay("not-a-date"))
        assertNull(formatIsoDateForDisplay(""))
        assertNull(formatIsoDateForDisplay(null))
    }

    @Test
    fun splits_the_time_out_of_the_core_display_string() {
        assertEquals(
            "9:30 AM - 10:30 AM",
            extractTimePart("Sunday, 01 November 2026 (9:30 AM - 10:30 AM)"),
        )
        assertEquals("9:30 AM", extractTimePart("Sunday, 01 November 2026 (9:30 AM)"))
    }

    @Test
    fun a_display_string_without_a_time_has_no_time_part() {
        assertNull(extractTimePart("Sunday, 01 November 2026"))
        assertNull(extractTimePart(""))
        assertNull(extractTimePart(null))
    }

    @Test
    fun finds_the_clock_in_both_display_shapes() {
        // The core's shape: the clock is in the parentheses.
        assertEquals("9:30 AM - 10:30 AM", extractClockPart("Sunday, 01 November 2026 (9:30 AM - 10:30 AM)"))
        // A resolved assessment can also carry a bare clock.
        assertEquals("10:00 AM", extractClockPart("10:00 AM"))
        assertEquals("14:00", extractClockPart("14:00"))
    }

    @Test
    fun a_display_string_without_a_clock_has_no_clock_part() {
        assertNull(extractClockPart("Sunday, 01 November 2026"))
        assertNull(extractClockPart(""))
        assertNull(extractClockPart(null))
    }

    @Test
    fun calendar_begin_time_is_local_midnight_of_the_assessment_date() {
        val expected =
            java.time.LocalDate
                .parse("2026-10-30")
                .atStartOfDay(java.time.ZoneId.systemDefault())
                .toInstant()
                .toEpochMilli()
        assertEquals(
            expected,
            calendarEventBeginTimeMillis("2026-10-30", null),
        )
        // A date with no start time and a date with an unparsable time both
        // land on local midnight - never on "today".
        assertEquals(expected, calendarEventBeginTimeMillis("2026-10-30", ""))
        assertEquals(expected, calendarEventBeginTimeMillis("2026-10-30", "not-a-time"))
    }

    @Test
    fun calendar_begin_time_uses_the_assessment_start_time_when_present() {
        val expected =
            java.time.LocalDate
                .parse("2026-10-30")
                .atTime(9, 30)
                .atZone(java.time.ZoneId.systemDefault())
                .toInstant()
                .toEpochMilli()
        assertEquals(expected, calendarEventBeginTimeMillis("2026-10-30", "9:30"))
        assertEquals(expected, calendarEventBeginTimeMillis("2026-10-30", "09:30"))
    }

    @Test
    fun calendar_begin_time_is_omitted_when_no_date_is_known() {
        // No date: the intent carries no begin-time extra at all (the caller
        // checks for null) instead of inventing today's date.
        assertNull(calendarEventBeginTimeMillis(null, "9:30"))
        assertNull(calendarEventBeginTimeMillis("", "9:30"))
        assertNull(calendarEventBeginTimeMillis("not-a-date", "9:30"))
    }
}
