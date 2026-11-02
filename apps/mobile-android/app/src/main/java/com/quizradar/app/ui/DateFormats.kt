/**
 * Date helpers for the Android shell.
 *
 * The core hands the UI an ISO date (`2026-11-01`) and a pre-formatted
 * `display_time` ("Sunday, 01 November 2026 (9:30 AM - 10:30 AM)"). A raw
 * storage date is never user-facing, and the `display_time` string repeats
 * the date the Date field already shows - so the date part is split off
 * here instead of being printed twice.
 */
package com.quizradar.app.ui

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/** `"Sun, Nov 1, 2026"` — the date in the same shape the web tier prints. */
fun formatIsoDateForDisplay(isoDate: String?): String? {
    if (isoDate.isNullOrBlank()) return null
    return try {
        val date = LocalDate.parse(isoDate.trim())
        "${date.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)}, " +
            "${date.format(DateTimeFormatter.ofPattern("MMM d"))}, ${date.year}"
    } catch (_: DateTimeParseException) {
        null
    }
}

/**
 * The time part of the core's `display_time`:
 * `"Sunday, 01 November 2026 (9:30 AM - 10:30 AM)"` → `"9:30 AM - 10:30 AM"`.
 * A `display_time` without a time (a dated assessment with no hours) has no
 * time part and returns `null` — the caller then shows the honest dash.
 */
fun extractTimePart(displayTime: String?): String? {
    if (displayTime.isNullOrBlank()) return null
    val open = displayTime.indexOf('(')
    val close = displayTime.lastIndexOf(')')
    if (open < 0 || close <= open) return null
    val inside = displayTime.substring(open + 1, close).trim()
    return inside.ifEmpty { null }
}

/**
 * The clock part of an assessment's `display_time`, for the surfaces that
 * print the date separately (the home-screen widget).
 *
 * The core's `display_time` is `"Sunday, 01 November 2026 (9:30 AM - 10:30 AM)"`
 * - the clock is in the parentheses - but a resolved assessment can also carry
 * a bare clock ("10:00 AM"). Both are a time; a date-only display string has
 * no clock in it and gets no time at all.
 */
fun extractClockPart(displayTime: String?): String? {
    if (displayTime.isNullOrBlank()) return null
    extractTimePart(displayTime)?.let { return it }
    val bare = displayTime.trim()
    return if (CLOCK_PATTERN.matches(bare)) bare else null
}

/** "9:30", "9:30 AM", "14:00", "9:30 AM - 10:30 AM" - and nothing else. */
private val CLOCK_PATTERN =
    Regex("""^\d{1,2}:\d{2}(\s?[APap]\.?[Mm]\.?)?(\s*[-–]\s*\d{1,2}:\d{2}(\s?[APap]\.?[Mm]\.?)?)?$""")
