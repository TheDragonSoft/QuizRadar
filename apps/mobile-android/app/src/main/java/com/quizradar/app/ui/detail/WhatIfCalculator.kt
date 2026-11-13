package com.quizradar.app.ui.detail

import org.json.JSONObject
import java.util.Locale

/**
 * The weighted grade target for ONE course, exactly as the shared Rust core
 * computes it (`core/src/plan/grade_target.rs`).
 *
 * The Android shell does NO grade math of its own any more: it renders what
 * the core decided, including the cases the core refuses to invent a number
 * for (unknown remaining weight, a target that can no longer be reached).
 */
data class GradeTargetProjection(
    val courseId: String,
    val weightsKnown: Boolean,
    val equalWeightAssumed: Boolean,
    val gradedWeight: Double,
    val remainingWeight: Double?,
    val currentPercentage: Double?,
    val targetLetter: String,
    val targetPercentage: Double,
    val requiredAverageOnRemaining: Double?,
    val achievable: Boolean,
    val note: String,
)

/** How the projection reads - theme roles, never raw colours. */
enum class ScoreColorState {
    SUCCESS,
    WARNING,
    DANGER,
}

object WhatIfCalculator {
    /**
     * Parses the core's `GradeTargetResult` JSON.
     *
     * `null` when there is no result yet, and `null` when the result belongs
     * to a DIFFERENT course than the one on screen - a stale projection from
     * another course must never be presented as this course's.
     */
    fun parseGradeTarget(
        json: String?,
        courseId: String?,
    ): GradeTargetProjection? {
        if (json.isNullOrBlank() || courseId.isNullOrBlank()) return null
        return try {
            val obj = JSONObject(json)
            val resultCourseId = obj.optString("course_id")
            if (!resultCourseId.equals(courseId.trim(), ignoreCase = true)) return null
            GradeTargetProjection(
                courseId = resultCourseId,
                weightsKnown = obj.optBoolean("weights_known", false),
                equalWeightAssumed = obj.optBoolean("equal_weight_assumed", false),
                gradedWeight = obj.optDouble("graded_weight", 0.0),
                remainingWeight = obj.optDoubleOrNull("remaining_weight"),
                currentPercentage = obj.optDoubleOrNull("current_percentage"),
                targetLetter = obj.optString("target_letter"),
                targetPercentage = obj.optDouble("target_percentage", 0.0),
                requiredAverageOnRemaining = obj.optDoubleOrNull("required_average_on_remaining"),
                achievable = obj.optBoolean("achievable", false),
                note = obj.optString("note"),
            )
        } catch (_: Exception) {
            null
        }
    }

    /** "82.0%" - one decimal, the way the core prints it. `null` stays `null`. */
    fun formatPercentage(value: Double?): String? = value?.let { String.format(Locale.US, "%.1f", it) + "%" }

    /**
     * The reading of the projection: on target, close to it, or short of it.
     * "Nothing graded yet" is a WARNING, never a fabricated 0%.
     */
    fun colorState(projection: GradeTargetProjection): ScoreColorState {
        val current = projection.currentPercentage ?: return ScoreColorState.WARNING
        return when {
            current >= projection.targetPercentage -> ScoreColorState.SUCCESS
            current >= projection.targetPercentage - 10.0 -> ScoreColorState.WARNING
            else -> ScoreColorState.DANGER
        }
    }
}

/** `JSONObject` has no "number or null" accessor - this is the honest one. */
private fun JSONObject.optDoubleOrNull(key: String): Double? = if (isNull(key)) null else optDouble(key, Double.NaN).takeIf { !it.isNaN() }
