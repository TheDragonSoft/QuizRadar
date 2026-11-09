package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.theme.CoursePalette

/** Label of the amber conflict chip (web parity: `copy.dashboard.conflictBadge`). */
const val CONFLICT_CHIP_LABEL = "Conflict"

@Composable
fun TimelineAssessmentRow(
    assessment: AssessmentModel,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val palette = CoursePalette.get(assessment.courseId)
    val courseTextColor = CoursePalette.textOnSurface(assessment.courseId, isDark)

    val (urgencyColor, urgencyBg) =
        when (assessment.daysUntil) {
            0 ->
                (if (isDark) Color(0xFFFCA5A5) else Color(0xFFB91C1C)) to
                    Color(0xFFDC2626).copy(alpha = if (isDark) 0.22f else 0.12f)
            1 ->
                (if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)) to
                    Color(0xFFD97706).copy(alpha = if (isDark) 0.22f else 0.14f)
            else ->
                if ((assessment.daysUntil ?: 0) < 0) {
                    MaterialTheme.colorScheme.onSurfaceVariant to MaterialTheme.colorScheme.surfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSecondaryContainer to
                        MaterialTheme.colorScheme.secondaryContainer
                }
        }

    val urgencyText =
        when (assessment.daysUntil) {
            null -> null
            0 -> "TODAY"
            1 -> "TOMORROW"
            else -> if (assessment.daysUntil < 0) "PAST" else "IN ${assessment.daysUntil} DAYS"
        }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surface)
                .border(1.dp, palette.border, RoundedCornerShape(14.dp))
                .clickable { onClick() }
                .padding(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier =
                        Modifier
                            .size(8.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(palette.color),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = assessment.courseName ?: assessment.courseId ?: "General",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = courseTextColor,
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = assessment.assessmentType,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (urgencyText != null) {
                Text(
                    text = urgencyText,
                    style =
                        TextStyle(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFeatureSettings = "tnum",
                            color = urgencyColor,
                        ),
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(urgencyBg)
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = assessment.title,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )

        Spacer(modifier = Modifier.height(4.dp))
        // Date / Time / Room ("—" when null — Honesty Doctrine)
        val timeDisplay = assessment.displayTime ?: "Undated"
        val roomDisplay = assessment.room ?: "—"
        Text(
            text = "$timeDisplay • Room: $roomDisplay",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = assessment.source,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = 7.dp, vertical = 2.dp),
            )

            if (assessment.achievedScore != null && assessment.maxScore != null) {
                val scorePct = ((assessment.achievedScore / assessment.maxScore) * 100).toInt()
                val scoreColor =
                    when {
                        scorePct >= 80 -> if (isDark) Color(0xFF34D399) else Color(0xFF047857)
                        scorePct >= 50 -> if (isDark) Color(0xFFFBBF24) else Color(0xFFB45309)
                        else -> if (isDark) Color(0xFFF87171) else Color(0xFFB91C1C)
                    }

                Text(
                    text = "${assessment.achievedScore}/${assessment.maxScore} ($scorePct%)",
                    style =
                        TextStyle(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            fontFeatureSettings = "tnum",
                            color = scoreColor,
                        ),
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(scoreColor.copy(alpha = 0.14f))
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }

            if (assessment.conflictWarning != null) {
                // Amber conflict chip (`01` §4.3 timeline rows) - the core
                // computed this clash, the row only shows it.
                val conflictColor = if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)
                Text(
                    text = CONFLICT_CHIP_LABEL,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = conflictColor,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFFF59E0B).copy(alpha = if (isDark) 0.22f else 0.14f))
                            .padding(horizontal = 7.dp, vertical = 2.dp)
                            .semantics { contentDescription = assessment.conflictWarning ?: CONFLICT_CHIP_LABEL },
                )
            }

            assessment.warnings.take(2).forEach { warning ->
                val warnColor = if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)
                Text(
                    text = warning,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = warnColor,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFFF59E0B).copy(alpha = if (isDark) 0.22f else 0.14f))
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
        }
    }
}
