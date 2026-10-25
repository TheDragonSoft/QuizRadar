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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
    val isToday = dayGroup.isToday
    val borderColor =
        if (isToday) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.12f)
        }

    val cardBg =
        if (isToday) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.04f)
        } else {
            MaterialTheme.colorScheme.surface
        }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(cardBg)
                .border(if (isToday) 2.dp else 1.dp, borderColor, RoundedCornerShape(16.dp))
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
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                        modifier =
                            Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }

            if (dayGroup.totalEstimatedHours != null) {
                Text(
                    text = "Est. ${dayGroup.totalEstimatedHours}h",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Tasks in this day group
        dayGroup.tasks.forEach { task ->
            val isChecked = completedTopicsMap[task.key] == true
            val palette = CoursePalette.get(task.courseId)

            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .clickable { onToggleTopic(task.key, !isChecked) },
                verticalAlignment = Alignment.Top,
            ) {
                Checkbox(
                    checked = isChecked,
                    onCheckedChange = { done -> onToggleTopic(task.key, done) },
                    colors =
                        CheckboxDefaults.colors(
                            checkedColor = palette.color,
                            uncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                        ),
                    modifier = Modifier.size(24.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier =
                                Modifier
                                    .size(6.dp)
                                    .clip(RoundedCornerShape(2.dp))
                                    .background(palette.color),
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "${task.courseId ?: "GENERAL"} • ${task.assessmentTitle}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = palette.color,
                        )
                        if (task.estimatedHours != null) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "${task.estimatedHours}h",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                            )
                        }
                    }
                    Text(
                        text = task.topic,
                        style =
                            MaterialTheme.typography.bodyMedium.copy(
                                fontWeight = FontWeight.Medium,
                                textDecoration = if (isChecked) TextDecoration.LineThrough else TextDecoration.None,
                                color =
                                    if (isChecked) {
                                        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                                    } else {
                                        MaterialTheme.colorScheme.onSurface
                                    },
                            ),
                    )
                    if (task.aiReasoning.isNotBlank()) {
                        Text(
                            text = task.aiReasoning,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                }
            }
        }
    }
}
