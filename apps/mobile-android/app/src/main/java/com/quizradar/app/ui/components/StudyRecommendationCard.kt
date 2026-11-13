package com.quizradar.app.ui.components

import androidx.compose.foundation.background
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.StudyRecommendationModel
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation

@Composable
fun StudyRecommendationCard(
    index: Int,
    recommendation: StudyRecommendationModel,
    completedTopicsMap: Map<String, Boolean>,
    onToggleTopic: (key: String, done: Boolean) -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val haptic = LocalHapticFeedback.current
    val palette = CoursePalette.get(recommendation.courseId)
    val courseTextColor = CoursePalette.textOnSurface(recommendation.courseId, isDark)

    // The urgency badge is the one tag shape, tinted by the same recipe as the
    // timeline's urgencyTagStyle (TODAY = error container, TOMORROW = amber
    // wash) so a badge reads identically on the Tasks and Calendar surfaces.
    val (urgencyColor, urgencyBg) =
        when (recommendation.urgencyBadge) {
            "TODAY" ->
                MaterialTheme.colorScheme.onErrorContainer to
                    MaterialTheme.colorScheme.errorContainer
            "TOMORROW" ->
                MaterialTheme.colorScheme.onSurface to
                    StatusColors.warningBadge.copy(alpha = 0.18f)
            "PAST" ->
                MaterialTheme.colorScheme.onSurfaceVariant to MaterialTheme.colorScheme.surfaceVariant
            else ->
                MaterialTheme.colorScheme.onSecondaryContainer to
                    MaterialTheme.colorScheme.secondaryContainer
        }

    Card(
        onClick = onClick,
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
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
                        text = "#$index • ${recommendation.courseName ?: recommendation.courseId ?: "General"}",
                        style = MaterialTheme.typography.labelMedium,
                        color = courseTextColor,
                    )
                }

                if (recommendation.urgencyBadge != null) {
                    StatusTag(
                        text = recommendation.urgencyBadge,
                        containerColor = urgencyBg,
                        contentColor = urgencyColor,
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = recommendation.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            if (recommendation.whyStudyNow.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = recommendation.whyStudyNow,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))
            val topics = recommendation.topics
            val totalTopics = topics.size
            val completedCount =
                if (totalTopics == 0) {
                    0
                } else {
                    topics.count { completedTopicsMap[it.key] == true }
                }
            val progress = if (totalTopics == 0) 0f else completedCount.toFloat() / totalTopics.toFloat()

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text =
                        if (totalTopics == 0) {
                            "No syllabus topics tracked"
                        } else {
                            "$completedCount of $totalTopics topics mastered"
                        },
                    style =
                        MaterialTheme.typography.bodySmall.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = if (totalTopics == 0) "—" else "${(progress * 100).toInt()}%",
                    style =
                        MaterialTheme.typography.titleMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            Spacer(modifier = Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(MaterialTheme.shapes.small),
                color = palette.color,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )

            if (topics.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    topics.forEach { topicItem ->
                        val isChecked = completedTopicsMap[topicItem.key] == true
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(MaterialTheme.shapes.extraSmall)
                                    .clickable {
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        onToggleTopic(topicItem.key, !isChecked)
                                    }
                                    .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // No explicit size: the Material checkbox keeps its
                            // own 48dp touch target around the 24dp box.
                            Checkbox(
                                checked = isChecked,
                                onCheckedChange = { done ->
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onToggleTopic(topicItem.key, done)
                                },
                                colors =
                                    CheckboxDefaults.colors(
                                        checkedColor = palette.color,
                                        uncheckedColor = MaterialTheme.colorScheme.outline,
                                    ),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = topicItem.topic,
                                style =
                                    MaterialTheme.typography.bodyMedium.copy(
                                        textDecoration =
                                            if (isChecked) {
                                                TextDecoration.LineThrough
                                            } else {
                                                TextDecoration.None
                                            },
                                        color =
                                            if (isChecked) {
                                                MaterialTheme.colorScheme.onSurfaceVariant
                                            } else {
                                                MaterialTheme.colorScheme.onSurface
                                            },
                                    ),
                            )
                        }
                    }
                }
            }
        }
    }
}
