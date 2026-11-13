package com.quizradar.app.ui

import androidx.compose.ui.graphics.luminance
import com.quizradar.app.model.FeedConfigModel
import com.quizradar.app.ui.calendar.CalendarDayResolver.formatCustomEventTime
import com.quizradar.app.ui.calendar.CalendarDayResolver.shouldMergeExamWithSlot
import com.quizradar.app.ui.screens.formatCourseFilterLabel
import com.quizradar.app.ui.screens.formatReadinessDisplay
import com.quizradar.app.ui.screens.formatSourcesDisplay
import com.quizradar.app.ui.theme.CoursePalette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HonestyFormattingTest {
    @Test
    fun readinessDisplay_reportsEmDashWhenZeroTopicsTracked() {
        val (headline, subtitle) =
            formatReadinessDisplay(
                totalTopicsCount = 0,
                completedTopicsCount = 0,
                readinessPercent = 100,
            )
        assertEquals("—", headline)
        assertEquals("No study topics tracked yet", subtitle)
    }

    @Test
    fun readinessDisplay_reportsPercentageAndCountsWhenTopicsExist() {
        val (headline, subtitle) =
            formatReadinessDisplay(
                totalTopicsCount = 5,
                completedTopicsCount = 3,
                readinessPercent = 60,
            )
        assertEquals("60%", headline)
        assertEquals("3 of 5 topics mastered", subtitle)
    }

    @Test
    fun sourcesDisplay_neverFabricatesActiveSourcesWhenEmpty() {
        val (emptyHeadline, _) = formatSourcesDisplay(emptyList(), emptyMap())
        assertEquals("No sources connected", emptyHeadline)

        // A radar that holds nothing must not read as "1 source active".
        val (zeroHeadline, _) = formatSourcesDisplay(emptyList(), mapOf("Gmail" to 0))
        assertEquals("No sources connected", zeroHeadline)

        val (oneHeadline, _) =
            formatSourcesDisplay(
                listOf(FeedConfigModel(url = "https://uni.edu/a.ics", label = "Moodle")),
                mapOf("Gmail" to 2),
            )
        assertEquals("1 source connected", oneHeadline)

        val (twoHeadline, _) =
            formatSourcesDisplay(
                listOf(
                    FeedConfigModel(url = "https://uni.edu/a.ics", label = "Moodle"),
                    FeedConfigModel(url = "https://uni.edu/b.ics", label = "Campus"),
                ),
                mapOf("Gmail" to 2, "Moodle" to 1),
            )
        assertEquals("2 sources connected", twoHeadline)

        // A disabled feed is not a connected source.
        val (disabledHeadline, _) =
            formatSourcesDisplay(
                listOf(
                    FeedConfigModel(url = "https://uni.edu/a.ics", label = "Moodle", enabled = false),
                ),
                mapOf("Gmail" to 2),
            )
        assertEquals("No sources connected", disabledHeadline)
    }

    @Test
    fun coursePalette_textOnSurfaceAdaptsContrastToLightAndDarkThemes() {
        val sampleIds = listOf("CSE241", "ECE310", "CS305", "MATH202", null, "")
        for (id in sampleIds) {
            val lightText = CoursePalette.textOnSurface(id, darkTheme = false)
            val darkText = CoursePalette.textOnSurface(id, darkTheme = true)
            assertTrue(
                "Light text for $id must be dark enough on white surface",
                lightText.luminance() < 0.35f,
            )
            assertTrue(
                "Dark text for $id must be bright enough on #111827 surface",
                darkText.luminance() > 0.25f,
            )
        }
    }

    @Test
    fun calendarMerge_mergesOnlySameCourseAtTheSameStartTime() {
        // Web parity: course AND start time describe the same block.
        assertTrue(
            "same course, same start time = one block",
            shouldMergeExamWithSlot(
                examCourseId = "CSE241",
                examStartTime = "09:00",
                slotCourseId = "CSE241",
                slotStartTime = "09:00",
            ),
        )
        assertTrue(
            "09:00 and 9:00 are the same clock time",
            shouldMergeExamWithSlot(
                examCourseId = "CSE241",
                examStartTime = "9:00",
                slotCourseId = "CSE241",
                slotStartTime = "09:00",
            ),
        )
    }

    @Test
    fun calendarMerge_keepsNonOverlappingClassSlotsOfTheSameCourse() {
        assertFalse(
            "a 09:00 lecture and a 16:00 exam are two blocks",
            shouldMergeExamWithSlot(
                examCourseId = "CSE241",
                examStartTime = "16:00",
                slotCourseId = "CSE241",
                slotStartTime = "09:00",
            ),
        )
        assertFalse(
            "a different course never merges",
            shouldMergeExamWithSlot(
                examCourseId = "MATH101",
                examStartTime = "09:00",
                slotCourseId = "CSE241",
                slotStartTime = "09:00",
            ),
        )
        assertFalse(
            "an exam without a known time never merges",
            shouldMergeExamWithSlot(
                examCourseId = "CSE241",
                examStartTime = null,
                slotCourseId = "CSE241",
                slotStartTime = "09:00",
            ),
        )
    }

    @Test
    fun customEventTime_neverRendersAnEmptyDashPair() {
        assertEquals("09:00–10:30", formatCustomEventTime("09:00", "10:30"))
        assertEquals("09:00", formatCustomEventTime("09:00", null))
        assertEquals("Until 10:30", formatCustomEventTime(null, "10:30"))
        assertEquals("—", formatCustomEventTime(null, null))
        assertEquals("—", formatCustomEventTime("", " "))
    }

    @Test
    fun courseFilterLabel_showsTheCourseNameAndNeverTheRawIdSlug() {
        assertEquals("Digital Design", formatCourseFilterLabel("Digital Design", "CSE241"))
        assertEquals("CSE241", formatCourseFilterLabel("", "CSE241"))
        assertEquals("CSE241", formatCourseFilterLabel(null, "CSE241"))
        assertEquals("CSE241", formatCourseFilterLabel("   ", "CSE241"))
    }

    @Test
    fun academicTrackLabel_neverInventsAPreset() {
        assertEquals("Not set", academicTrackLabel(null))
        assertEquals("Not set", academicTrackLabel("   "))
        assertEquals("Medicine & Health Sciences", academicTrackLabel("med"))
        assertEquals("Engineering & Sciences", academicTrackLabel("eng"))
        assertEquals("Business & Humanities", academicTrackLabel("biz"))
        // A value from an older build is shown as it is - never silently
        // mapped onto a preset the user did not choose.
        assertEquals(
            "Computer Science (not one of the current presets)",
            academicTrackLabel("Computer Science"),
        )
    }
}
