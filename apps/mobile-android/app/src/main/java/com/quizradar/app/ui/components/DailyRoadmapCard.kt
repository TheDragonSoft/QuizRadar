package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.DailyStudyDayGroupModel
import com.quizradar.app.ui.theme.CoursePalette

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
    val borderColor =
        if (isToday) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.outlineVariant
        }

    val cardBg =
        if (isToday) {
            MaterialTheme.colorScheme.primary.copy(alpha = if (isDark) 0.08f else 0.04f)
        } else {
            MaterialTheme.colorScheme.surface
        }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(cardBg)
                .border(if (isToday) 1.5.dp else 1.dp, borderColor, RoundedCornerShape(16.dp))
                .padding(14.dp),
    ) {
        // Header: Day name + Today badge + Hours
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = dayGroup.displayDay,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (isToday) {
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "TODAY",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier =
                            Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(MaterialTheme.colorScheme.secondaryContainer)
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }

            if (dayGroup.totalEstimatedHours != null) {
                Text(
                    text = "Est. ${dayGroup.totalEstimatedHours}h",
                    style =
                        TextStyle(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFeatureSettings = "tnum",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        dayGroup.tasks.forEach { task ->
            val isChecked = completedTopicsMap[task.key] == true
            val palette = CoursePalette.get(task.courseId)
            val courseTextColor = CoursePalette.textOnSurface(task.courseId, isDark)

            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .clickable {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onToggleTopic(task.key, !isChecked)
                        }
                        .padding(vertical = 6.dp),
                verticalAlignment = Alignment.Top,
            ) {
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
                    modifier = Modifier.size(24.dp),
                )
                Spacer(modifier = Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier =
                                Modifier
                                    .size(7.dp)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(palette.color),
                        )
                        Spacer(modifier = Modifier.width(5.dp))
                        Text(
                            text = "${task.courseName ?: task.courseId ?: "General"} • ${task.assessmentTitle}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = courseTextColor,
                        )
                        if (task.estimatedHours != null) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "${task.estimatedHours}h",
                                style =
                                    TextStyle(
                                        fontSize = 11.sp,
                                        fontFeatureSettings = "tnum",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    ),
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(2.dp))
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
                        Spacer(modifier = Modifier.height(2.dp))
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
