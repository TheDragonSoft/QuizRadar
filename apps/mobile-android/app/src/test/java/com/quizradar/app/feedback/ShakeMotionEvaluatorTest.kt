package com.quizradar.app.feedback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShakeMotionEvaluatorTest {
    @Test
    fun `three distinct acceleration peaks trigger once`() {
        val evaluator = ShakeMotionEvaluator()
        assertFalse(evaluator.onSample(0f, 0f, 9.81f, 0L))
        assertFalse(evaluator.onSample(30f, 0f, 9.81f, 200L))
        assertFalse(evaluator.onSample(30f, 0f, 9.81f, 400L))
        assertTrue(evaluator.onSample(30f, 0f, 9.81f, 600L))
        assertFalse("the cooldown must suppress repeats", evaluator.onSample(30f, 0f, 9.81f, 800L))
    }

    @Test
    fun `ordinary gravity and small movements never trigger`() {
        val evaluator = ShakeMotionEvaluator()
        evaluator.onSample(0f, 0f, 9.81f, 0L)
        var timestamp = 200L
        repeat(20) {
            assertFalse(evaluator.onSample(0.2f, -0.1f, 9.9f, timestamp))
            timestamp += 200L
        }
    }

    @Test
    fun `peaks outside the shake window do not accumulate`() {
        val evaluator = ShakeMotionEvaluator()
        evaluator.onSample(0f, 0f, 9.81f, 0L)

        fun peak(timestampMs: Long): Boolean {
            // Return toward rest before each distinct physical acceleration peak.
            evaluator.onSample(0f, 0f, 9.81f, timestampMs - 50L)
            return evaluator.onSample(30f, 0f, 9.81f, timestampMs)
        }
        assertFalse(peak(200L))
        assertFalse(peak(1_600L))
        assertFalse(peak(3_000L))
        assertFalse(peak(3_200L))
        assertTrue(peak(3_400L))
    }
}
