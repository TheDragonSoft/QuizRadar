package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.ExamReadinessCardModel
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation

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
    // The status colour rides the meter and the icon; the number itself stays
    // in ink, so the value is legible in every theme.
    val readinessColor =
        when {
            !hasTopics -> MaterialTheme.colorScheme.onSurfaceVariant
            pct >= 80 -> StatusColors.success(isDark)
            pct >= 50 -> StatusColors.warningBadge
            else -> MaterialTheme.colorScheme.error
        }

    Card(
        onClick = { onClick() },
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
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
                                .clip(MaterialTheme.shapes.small)
                                .background(palette.color),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = card.courseName ?: card.courseId ?: "General",
                        style = MaterialTheme.typography.labelMedium,
                        color = courseTextColor,
                    )
                }

                Text(
                    text = "${card.daysUntil}d away",
                    style =
                        MaterialTheme.typography.labelMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = card.title,
                style = MaterialTheme.typography.titleMedium,
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
                        MaterialTheme.typography.bodySmall.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = if (hasTopics) "$pct%" else "—",
                    style =
                        MaterialTheme.typography.titleMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            if (hasTopics) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { (pct / 100f).coerceIn(0f, 1f) },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(CircleShape),
                    color = readinessColor,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }

            if (card.recommendedFocus.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    // "Next: …" only makes sense when there IS a next topic; with
                    // no tracked topic the focus line is a note, not a pointer.
                    text = if (hasTopics) "Next: ${card.recommendedFocus}" else card.recommendedFocus,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
