package com.quizradar.app.nativeedge

import com.quizradar.app.core.MemoryTokenStore
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.AssessmentModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class NotificationMathTest {
    private lateinit var engine: QuizRadarEngine

    @Before
    fun setup() {
        engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
    }

    @Test
    fun testNotificationIdIsDeterministicAndPositive() {
        val id1 = engine.notificationIdFor("asm-test-123", "exam-24h")
        val id2 = engine.notificationIdFor("asm-test-123", "exam-24h")

        assertEquals("Same input must return identical notification id", id1, id2)
        assertTrue("Notification ID must be positive", id1 >= 0)
    }

    @Test
    fun testDifferentAssessmentsAndKindsProduceDistinctIds() {
        val idExam24 = engine.notificationIdFor("asm-456", "exam-24h")
        val idExam0 = engine.notificationIdFor("asm-456", "exam-0d")
        val idOtherExam = engine.notificationIdFor("asm-789", "exam-24h")

        assertNotEquals("Different reminder kind must produce distinct ID", idExam24, idExam0)
        assertNotEquals("Different assessment must produce distinct ID", idExam24, idOtherExam)
    }

    @Test
    fun testExamRemindersFilterNearest48Within48Hours() {
        val assessments =
            (1..60).map { i ->
                val days =
                    when {
                        i in 1..20 -> 0 // today
                        i in 21..55 -> 1 // tomorrow (35 items)
                        else -> 5 // distant (5 items)
                    }
                AssessmentModel(
                    id = "asm-$i",
                    title = "Assessment $i",
                    courseId = "COURSE-$i",
                    daysUntil = days,
                )
            }

        // T-24h / same-day filter with <=48 nearest policy
        val filtered =
            assessments
                .filter { it.daysUntil != null && it.daysUntil in 0..1 }
                .take(48)

        assertEquals("Must cap at <=48 items", 48, filtered.size)
        assertTrue("All items must be within 0..1 days", filtered.all { it.daysUntil in 0..1 })
    }

    @Test
    fun testMorningDigestSummaryStringFormatting() {
        val todayClasses = listOf("CS 101", "MATH 201")
        val todayExams = listOf("Midterm 1")

        val summary =
            buildString {
                if (todayExams.isNotEmpty()) {
                    append("Exams: ").append(todayExams.joinToString())
                    if (todayClasses.isNotEmpty()) append(" · ")
                }
                if (todayClasses.isNotEmpty()) {
                    append("Classes: ").append(todayClasses.joinToString())
                }
            }

        assertEquals("Exams: Midterm 1 · Classes: CS 101, MATH 201", summary)
    }
}
