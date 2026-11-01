package com.quizradar.app.nativeedge

import com.quizradar.app.glance.WidgetState
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.model.CourseModel
import com.quizradar.app.ui.theme.CoursePalette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
class WidgetDataContractTest {
    @Test
    fun testEmptyWidgetStateHonestyContract() {
        val empty = WidgetState.empty()
        assertFalse("empty state must have hasNextUp false", empty.hasNextUp)
        assertEquals("No upcoming quizzes or exams", empty.title)
        assertEquals("You're all caught up!", empty.dateDisplay)
        assertNull("empty state has no urgency badge", empty.badgeText)
        assertEquals("—", empty.room)
    }

    @Test
    fun testFromAssessmentTodayUrgencyBadgeAndRoomHonesty() {
        val assessment =
            AssessmentModel(
                id = "asm-today-1",
                title = "CS Final Exam",
                courseId = "CS 101",
                courseName = "Intro to Computer Science",
                assessmentType = "Final Exam",
                dateIso = LocalDate.parse("2026-10-25"),
                displayTime = "10:00 AM",
                room = null,
                daysUntil = 0,
            )
        val course = CourseModel(id = "CS 101", name = "Intro to Computer Science")

        val state = WidgetState.fromAssessment(assessment, course)
        assertTrue(state.hasNextUp)
        // Course NAME wins over the raw id (honesty doctrine: raw ids are
        // never rendered to the user).
        assertEquals("Intro to Computer Science", state.courseCode)
        assertEquals("CS Final Exam", state.title)
        assertEquals("2026-10-25 · 10:00 AM", state.dateDisplay)
        assertEquals("TODAY", state.badgeText)
        assertEquals("#ef4444", state.badgeColorHex) // Urgent red for TODAY
        assertEquals("—", state.room) // Never "Hall B-204"
        assertEquals(CoursePalette.getHex("CS 101"), state.courseColorHex)
    }

    @Test
    fun testFromAssessmentTomorrowUrgencyBadge() {
        val assessment =
            AssessmentModel(
                id = "asm-tomorrow-2",
                title = "Calculus Quiz 2",
                courseId = "MATH 201",
                assessmentType = "Class Quiz",
                dateIso = LocalDate.parse("2026-10-26"),
                displayTime = "14:00",
                room = "B-105",
                daysUntil = 1,
            )

        val state = WidgetState.fromAssessment(assessment, null)
        assertTrue(state.hasNextUp)
        assertEquals("MATH 201", state.courseCode)
        assertEquals("TOMORROW", state.badgeText)
        assertEquals("#f59e0b", state.badgeColorHex) // Amber for TOMORROW
        assertEquals("B-105", state.room)
    }

    @Test
    fun testFromAssessmentInXDaysBadge() {
        val assessment =
            AssessmentModel(
                id = "asm-future-3",
                title = "Physics Midterm",
                courseId = "PHYS 102",
                dateIso = LocalDate.parse("2026-10-30"),
                daysUntil = 5,
            )

        val state = WidgetState.fromAssessment(assessment, null)
        assertEquals("IN 5 DAYS", state.badgeText)
        assertEquals("#1a73e8", state.badgeColorHex)
    }

    @Test
    fun testWidgetStateJsonRoundTrip() {
        val original =
            WidgetState(
                hasNextUp = true,
                courseCode = "BIO 101",
                courseColorHex = "#0f9d58",
                title = "Biology Lab Practical",
                dateDisplay = "2026-11-02 · 11:30 AM",
                badgeText = "IN 8 DAYS",
                badgeColorHex = "#1a73e8",
                room = "Lab 4",
            )

        val json = original.toJson()
        val restored = WidgetState.fromJson(json)

        assertEquals(original, restored)
    }
}
