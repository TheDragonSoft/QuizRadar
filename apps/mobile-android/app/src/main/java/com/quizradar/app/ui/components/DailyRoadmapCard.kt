package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.DailyStudyDayGroupModel
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation

@Composable
fun DailyRoadmapCard(
    dayGroup: DailyStudyDayGroupModel,
    completedTopicsMap: Map<String, Boolean>,
    onToggleTopic: (key: String, done: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val haptic = LocalHapticFeedback.current
    val isToday = dayGroup.isToday

    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header: Day name + Today badge + Hours
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = dayGroup.displayDay,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (isToday) {
                        Spacer(modifier = Modifier.width(8.dp))
                        // "Today" is named, not just colour-coded.
                        StatusTag(
                            text = "TODAY",
                            containerColor = MaterialTheme.colorScheme.secondaryContainer,
                            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    }
                }

                if (dayGroup.totalEstimatedHours != null) {
                    Text(
                        text = "Est. ${dayGroup.totalEstimatedHours}h",
                        style =
                            MaterialTheme.typography.labelMedium.copy(
                                fontFeatureSettings = "tnum",
                            ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            dayGroup.tasks.forEach { task ->
                val isChecked = completedTopicsMap[task.key] == true
                val palette = CoursePalette.get(task.courseId)
                val courseTextColor = CoursePalette.textOnSurface(task.courseId, isDark)

                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 56.dp)
                            .clip(MaterialTheme.shapes.extraSmall)
                            .clickable {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onToggleTopic(task.key, !isChecked)
                            }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    // No explicit size: the Material checkbox keeps its own
                    // 48dp touch target around the 24dp box.
                    Checkbox(
                        checked = isChecked,
                        onCheckedChange = { done ->
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onToggleTopic(task.key, done)
                        },
                        colors =
                            CheckboxDefaults.colors(
                                checkedColor = palette.color,
                                uncheckedColor = MaterialTheme.colorScheme.outline,
                            ),
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
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
                                text = "${task.courseName ?: task.courseId ?: "General"} • ${task.assessmentTitle}",
                                style = MaterialTheme.typography.labelMedium,
                                color = courseTextColor,
                            )
                            if (task.estimatedHours != null) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "${task.estimatedHours}h",
                                    style =
                                        MaterialTheme.typography.labelMedium.copy(
                                            fontFeatureSettings = "tnum",
                                        ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = task.topic,
                            style =
                                MaterialTheme.typography.bodyMedium.copy(
                                    fontWeight = FontWeight.Medium,
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
                        if (task.aiReasoning.isNotBlank()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = task.aiReasoning,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}
