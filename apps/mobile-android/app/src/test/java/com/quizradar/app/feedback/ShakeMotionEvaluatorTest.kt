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

    @Test
    fun `an earlier stray bump does not break three rapid shakes`() {
        val evaluator = ShakeMotionEvaluator()
        evaluator.onSample(0f, 0f, 9.81f, 0L)

        fun peak(timestampMs: Long): Boolean {
            evaluator.onSample(0f, 0f, 9.81f, timestampMs - 50L)
            return evaluator.onSample(30f, 0f, 9.81f, timestampMs)
        }
        assertFalse(peak(200L))
        assertFalse(peak(1_200L))
        assertFalse(peak(1_450L))
        assertTrue(peak(1_700L))
    }

    @Test
    fun `high frequency 200hz sensor still triggers on three shakes`() {
        val evaluator = ShakeMotionEvaluator()
        var triggered = false
        var t = 0L
        evaluator.onSample(0f, 0f, 9.81f, t)
        repeat(180) { step ->
            t += 5L
            val x =
                when (step) {
                    in 10..15, in 55..60, in 100..105 -> 28f
                    else -> 0f
                }
            if (evaluator.onSample(x, 0f, 9.81f, t)) triggered = true
        }
        assertTrue("200 Hz accelerometers should trigger consistently", triggered)
    }

    @Test
    fun `linear acceleration mode triggers on three peaks without gravity filtering`() {
        val evaluator = ShakeMotionEvaluator(removeGravity = false)
        assertFalse(evaluator.onSample(0f, 0f, 0f, 0L))
        assertFalse(evaluator.onSample(14f, 0f, 0f, 200L))
        assertFalse(evaluator.onSample(-14f, 0f, 0f, 450L))
        assertTrue(evaluator.onSample(14f, 0f, 0f, 700L))
        assertFalse("cooldown still applies in linear acceleration mode", evaluator.onSample(15f, 0f, 0f, 950L))
    }

    @Test
    fun `linear acceleration mode ignores stationary sensor noise`() {
        val evaluator = ShakeMotionEvaluator(removeGravity = false)
        var t = 0L
        repeat(30) {
            t += 20L
            assertFalse(evaluator.onSample(0.3f, -0.2f, 0.4f, t))
        }
    }
}
