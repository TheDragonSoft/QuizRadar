package com.quizradar.app.ui.detail

import com.quizradar.app.model.AssessmentModel
import kotlin.math.roundToInt

enum class ScoreColorState {
    GREEN,
    AMBER,
    ROSE,
}

data class WhatIfProjection(
    val projectedAvg: Int,
    val gradedCount: Int,
    val isFirstGraded: Boolean,
    val colorState: ScoreColorState,
)

object WhatIfCalculator {
    fun calculate(
        activeAssessment: AssessmentModel,
        allAssessments: List<AssessmentModel>,
        planScorePct: Double,
    ): WhatIfProjection {
        val planPct = planScorePct.coerceIn(0.0, 100.0)

        val gradedElsewhere =
            allAssessments.filter { x ->
                x.courseId != null &&
                    activeAssessment.courseId != null &&
                    x.courseId.equals(activeAssessment.courseId, ignoreCase = true) &&
                    x.id != activeAssessment.id &&
                    x.achievedScore != null &&
                    x.maxScore != null &&
                    x.maxScore > 0.0
            }

        val otherPcts =
            gradedElsewhere.mapNotNull { x ->
                val achieved = x.achievedScore
                val max = x.maxScore
                if (achieved != null && max != null && max > 0.0) {
                    (achieved / max) * 100.0
                } else {
                    null
                }
            }

        val totalItems = otherPcts.size + 1
        val sumScores = otherPcts.sum() + planPct
        val projected = (sumScores / totalItems).roundToInt()

        val colorState =
            when {
                projected >= 80 -> ScoreColorState.GREEN
                projected >= 50 -> ScoreColorState.AMBER
                else -> ScoreColorState.ROSE
            }

        return WhatIfProjection(
            projectedAvg = projected,
            gradedCount = otherPcts.size,
            isFirstGraded = otherPcts.isEmpty(),
            colorState = colorState,
        )
    }
}
