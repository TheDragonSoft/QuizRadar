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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.ExamReadinessCardModel
import com.quizradar.app.ui.theme.CoursePalette

@Composable
fun ReadinessCard(
    card: ExamReadinessCardModel,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val palette = CoursePalette.get(card.courseId)
    val courseTextColor = CoursePalette.textOnSurface(card.courseId, isDark)
    // No tracked topics means there is no readiness number to show. The core's
    // 0/0 = 100 means "nothing is pending", not "100% mastered" — rendering it
    // as a percentage would claim mastery the student never recorded.
    val hasTopics = card.totalCount > 0
    val pct = if (hasTopics) card.readinessPercent.coerceIn(0, 100) else 0
    val readinessColor =
        when {
            !hasTopics -> MaterialTheme.colorScheme.onSurfaceVariant
            pct >= 80 -> if (isDark) Color(0xFF34D399) else Color(0xFF047857)
            pct >= 50 -> if (isDark) Color(0xFFFBBF24) else Color(0xFFB45309)
            else -> if (isDark) Color(0xFFF87171) else Color(0xFFDC2626)
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
                    text = card.courseName ?: card.courseId ?: "General",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = courseTextColor,
                )
            }

            Text(
                text = "${card.daysUntil}d away",
                style =
                    TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFeatureSettings = "tnum",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
            )
        }

        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = card.title,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )

        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text =
                    if (hasTopics) {
                        "${card.completedCount}/${card.totalCount} topics mastered"
                    } else {
                        "No syllabus topics tracked"
                    },
                style =
                    TextStyle(
                        fontSize = 11.sp,
                        fontFeatureSettings = "tnum",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
            )
            Text(
                text = if (hasTopics) "$pct%" else "—",
                style =
                    TextStyle(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        fontFeatureSettings = "tnum",
                        color = readinessColor,
                    ),
            )
        }

        Spacer(modifier = Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { (pct / 100f).coerceIn(0f, 1f) },
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp)),
            color = readinessColor,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
        )

        if (card.recommendedFocus.isNotBlank()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                // "Next: …" only makes sense when there IS a next topic; with
                // no tracked topic the focus line is a note, not a pointer.
                text = if (hasTopics) "Next: ${card.recommendedFocus}" else card.recommendedFocus,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
