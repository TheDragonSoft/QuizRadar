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
}
