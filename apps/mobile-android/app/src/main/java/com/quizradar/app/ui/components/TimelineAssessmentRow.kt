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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.theme.CoursePalette

@Composable
fun TimelineAssessmentRow(
    assessment: AssessmentModel,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = CoursePalette.get(assessment.courseId)

    val urgencyColor =
        when (assessment.daysUntil) {
            0 -> Color(0xFFDC2626) // TODAY
            1 -> Color(0xFFD97706) // TOMORROW
            else ->
                if ((assessment.daysUntil ?: 0) < 0) {
                    Color(0xFF64748B)
                } else {
                    MaterialTheme.colorScheme.primary
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
                .border(1.dp, palette.border.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
                .clickable { onClick() }
                .padding(14.dp),
    ) {
        // Row 1: Course + Type + Urgency Pill
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
                    text = assessment.courseId ?: "GENERAL",
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                    color = palette.color,
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = assessment.assessmentType,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }

            if (urgencyText != null) {
                Text(
                    text = urgencyText,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = urgencyColor,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(urgencyColor.copy(alpha = 0.12f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
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
        // Date / Time / Room ("—" when null)
        val timeDisplay = assessment.displayTime ?: "Undated"
        val roomDisplay = assessment.room ?: "—"
        Text(
            text = "$timeDisplay • Room: $roomDisplay",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )

        // Chips: Source / Score / Warnings
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Source chip
            Text(
                text = assessment.source,
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
            )

            // Score chip (if graded)
            if (assessment.achievedScore != null && assessment.maxScore != null) {
                val scorePct = ((assessment.achievedScore / assessment.maxScore) * 100).toInt()
                val scoreColor =
                    if (scorePct >= 80) {
                        Color(0xFF059669)
                    } else if (scorePct >= 50) {
                        Color(0xFFD97706)
                    } else {
                        Color(0xFFDC2626)
                    }

                Text(
                    text = "${assessment.achievedScore}/${assessment.maxScore} ($scorePct%)",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = scoreColor,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(scoreColor.copy(alpha = 0.12f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }

            // Up to 2 warning chips
            assessment.warnings.take(2).forEach { warning ->
                Text(
                    text = warning,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFFD97706),
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFFF59E0B).copy(alpha = 0.12f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
    }
}
