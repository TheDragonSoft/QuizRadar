package com.quizradar.app.ui

import com.quizradar.app.ui.detail.ScoreColorState
import com.quizradar.app.ui.detail.WhatIfCalculator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The shell parses the shared core's `GradeTargetResult` — no local grade
 * math (`core/src/plan/grade_target.rs`). These tests pin the parser and the
 * honest color mapping, including the refusals the audit demanded: a stale
 * result from another course and a malformed payload must never be shown.
 *
 * Robolectric: `org.json` is only real under the Android framework — plain
 * JVM unit tests get stubs whose defaults make every parse honestly return
 * `null` (same setup as [QuizRadarJsonParserTest]).
 */
@RunWith(RobolectricTestRunner::class)
class WhatIfCalculatorTest {
    private fun gradeTargetJson(
        courseId: String = "CS101",
        currentPercentage: Double? = 82.0,
        targetPercentage: Double = 80.0,
    ): String =
        "{\"course_id\":\"$courseId\",\"weights_known\":true,\"equal_weight_assumed\":false," +
            "\"graded_weight\":40.0,\"remaining_weight\":60.0," +
            "\"current_percentage\":${currentPercentage ?: "null"},\"target_letter\":\"B+\"," +
            "\"target_percentage\":$targetPercentage,\"required_average_on_remaining\":78.5," +
            "\"achievable\":true,\"note\":\"Weights known\"}"

    @Test
    fun parseGradeTarget_reads_core_fields() {
        val projection = WhatIfCalculator.parseGradeTarget(gradeTargetJson(), "CS101")

        assertTrue(projection != null)
        assertTrue(projection!!.weightsKnown)
        assertFalse(projection.equalWeightAssumed)
        assertEquals(40.0, projection.gradedWeight, 0.0)
        assertEquals(60.0, projection.remainingWeight!!, 0.0)
        assertEquals(82.0, projection.currentPercentage!!, 0.0)
        assertEquals("B+", projection.targetLetter)
        assertEquals(80.0, projection.targetPercentage, 0.0)
        assertEquals(78.5, projection.requiredAverageOnRemaining!!, 0.0)
        assertTrue(projection.achievable)
        assertEquals("Weights known", projection.note)
    }

    @Test
    fun parseGradeTarget_refuses_blank_malformed_or_foreign_results() {
        assertNull(WhatIfCalculator.parseGradeTarget(null, "CS101"))
        assertNull(WhatIfCalculator.parseGradeTarget("", "CS101"))
        assertNull(WhatIfCalculator.parseGradeTarget("   ", "CS101"))
        assertNull(WhatIfCalculator.parseGradeTarget(gradeTargetJson(), null))
        // A result belonging to a DIFFERENT course is stale - never shown.
        assertNull(WhatIfCalculator.parseGradeTarget(gradeTargetJson(courseId = "MATH101"), "CS101"))
        assertNull(WhatIfCalculator.parseGradeTarget("not json", "CS101"))
    }

    @Test
    fun parseGradeTarget_keeps_absent_numbers_null() {
        val json =
            "{\"course_id\":\"CS101\",\"weights_known\":false,\"equal_weight_assumed\":true," +
                "\"graded_weight\":0.0,\"target_letter\":\"B+\",\"target_percentage\":80.0," +
                "\"achievable\":false,\"note\":\"Equal weights assumed\"}"
        val projection = WhatIfCalculator.parseGradeTarget(json, "CS101")

        assertTrue(projection != null)
        assertTrue(projection!!.equalWeightAssumed)
        assertNull(projection.remainingWeight)
        assertNull(projection.currentPercentage)
        assertNull(projection.requiredAverageOnRemaining)
    }

    @Test
    fun colorState_follows_the_core_thresholds() {
        val onTarget = WhatIfCalculator.parseGradeTarget(gradeTargetJson(currentPercentage = 85.0), "CS101")!!
        assertEquals(ScoreColorState.SUCCESS, WhatIfCalculator.colorState(onTarget))

        // Within 10 points of the target reads as close, not on target.
        val close = WhatIfCalculator.parseGradeTarget(gradeTargetJson(currentPercentage = 75.0), "CS101")!!
        assertEquals(ScoreColorState.WARNING, WhatIfCalculator.colorState(close))

        val short = WhatIfCalculator.parseGradeTarget(gradeTargetJson(currentPercentage = 60.0), "CS101")!!
        assertEquals(ScoreColorState.DANGER, WhatIfCalculator.colorState(short))

        // "Nothing graded yet" is a WARNING, never a fabricated 0%.
        val ungraded = WhatIfCalculator.parseGradeTarget(gradeTargetJson(currentPercentage = null), "CS101")!!
        assertEquals(ScoreColorState.WARNING, WhatIfCalculator.colorState(ungraded))
    }

    @Test
    fun formatPercentage_prints_one_decimal() {
        assertEquals("82.0%", WhatIfCalculator.formatPercentage(82.0))
        assertNull(WhatIfCalculator.formatPercentage(null))
    }
}
