package com.quizradar.app.ui

import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.detail.ScoreColorState
import com.quizradar.app.ui.detail.WhatIfCalculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatIfCalculatorTest {
    @Test
    fun calculate_first_graded_assessment_takes_planned_score() {
        val active =
            AssessmentModel(
                id = "quiz-1",
                title = "Quiz 1",
                courseId = "CS101",
            )
        val projection = WhatIfCalculator.calculate(active, listOf(active), 85.0)

        assertTrue(projection.isFirstGraded)
        assertEquals(0, projection.gradedCount)
        assertEquals(85, projection.projectedAvg)
        assertEquals(ScoreColorState.GREEN, projection.colorState)
    }

    @Test
    fun calculate_averages_other_graded_course_assessments() {
        val existing1 =
            AssessmentModel(
                id = "quiz-1",
                title = "Quiz 1",
                courseId = "CS101",
                achievedScore = 18.0,
                maxScore = 20.0,
            )
        val existing2 =
            AssessmentModel(
                id = "quiz-2",
                title = "Quiz 2",
                courseId = "CS101",
                achievedScore = 7.0,
                maxScore = 10.0,
            )
        val active =
            AssessmentModel(
                id = "midterm",
                title = "Midterm",
                courseId = "CS101",
            )

        // Planned score 80%. Average of 90, 70, 80 = 240 / 3 = 80%
        val projection = WhatIfCalculator.calculate(active, listOf(existing1, existing2, active), 80.0)

        assertFalse(projection.isFirstGraded)
        assertEquals(2, projection.gradedCount)
        assertEquals(80, projection.projectedAvg)
        assertEquals(ScoreColorState.GREEN, projection.colorState)
    }

    @Test
    fun calculate_applies_thresholds_for_amber_and_rose() {
        val active = AssessmentModel(id = "quiz-1", title = "Quiz 1", courseId = "MATH101")

        val projAmber = WhatIfCalculator.calculate(active, listOf(active), 65.0)
        assertEquals(ScoreColorState.AMBER, projAmber.colorState)

        val projRose = WhatIfCalculator.calculate(active, listOf(active), 40.0)
        assertEquals(ScoreColorState.ROSE, projRose.colorState)
    }

    @Test
    fun calculate_matches_courseId_case_insensitively() {
        val existing =
            AssessmentModel(
                id = "quiz-1",
                title = "Quiz 1",
                // lowercase
                courseId = "cs101",
                achievedScore = 10.0,
                maxScore = 10.0,
            )
        val active =
            AssessmentModel(
                id = "midterm",
                title = "Midterm",
                // uppercase
                courseId = "CS101",
            )

        // Planned score 80%. Average of 100% and 80% = 90%
        val projection = WhatIfCalculator.calculate(active, listOf(existing, active), 80.0)
        assertEquals(1, projection.gradedCount)
        assertEquals(90, projection.projectedAvg)
    }
}
