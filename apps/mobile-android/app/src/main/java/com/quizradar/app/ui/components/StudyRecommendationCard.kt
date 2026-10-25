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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.StudyRecommendationModel
import com.quizradar.app.ui.theme.CoursePalette

@Composable
fun StudyRecommendationCard(
    index: Int,
    recommendation: StudyRecommendationModel,
    completedTopicsMap: Map<String, Boolean>,
    onToggleTopic: (key: String, done: Boolean) -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptic = LocalHapticFeedback.current
    val palette = CoursePalette.get(recommendation.courseId)

    val urgencyColor =
        when (recommendation.urgencyBadge) {
            "TODAY" -> Color(0xFFDC2626)
            "TOMORROW" -> Color(0xFFD97706)
            "PAST" -> Color(0xFF64748B)
            else -> MaterialTheme.colorScheme.primary
        }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surface)
                .border(1.dp, palette.border, RoundedCornerShape(16.dp))
                .clickable { onClick() }
                .padding(16.dp),
    ) {
        // Top row: Course code + Urgency Badge + Priority Rank
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier =
                        Modifier
                            .size(10.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(palette.color),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "#$index • ${recommendation.courseId ?: "GENERAL"}",
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                    color = palette.color,
                )
            }

            if (recommendation.urgencyBadge != null) {
                Text(
                    text = recommendation.urgencyBadge,
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

        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = recommendation.title,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )

        if (recommendation.whyStudyNow.isNotBlank()) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = recommendation.whyStudyNow,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
            )
        }

        // Progress bar
        Spacer(modifier = Modifier.height(10.dp))
        val topics = recommendation.topics
        val totalTopics = topics.size
        val completedCount =
            if (totalTopics == 0) {
                0
            } else {
                topics.count { completedTopicsMap[it.key] == true }
            }
        val progress = if (totalTopics == 0) 1f else completedCount.toFloat() / totalTopics.toFloat()

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "$completedCount of $totalTopics topics mastered",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
            Text(
                text = "${(progress * 100).toInt()}%",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = palette.color,
            )
        }

        Spacer(modifier = Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { progress },
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp)),
            color = palette.color,
            trackColor = palette.background,
        )

        // Topic Checkboxes (Optimistic updates)
        if (topics.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            Column(modifier = Modifier.fillMaxWidth()) {
                topics.forEach { topicItem ->
                    val isChecked = completedTopicsMap[topicItem.key] == true
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 2.dp)
                                .clickable {
                                    onToggleTopic(topicItem.key, !isChecked)
                                },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = isChecked,
                            onCheckedChange = { done ->
                                onToggleTopic(topicItem.key, done)
                            },
                            colors =
                                CheckboxDefaults.colors(
                                    checkedColor = palette.color,
                                    uncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                                ),
                            modifier = Modifier.size(24.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = topicItem.topic,
                            style =
                                MaterialTheme.typography.bodySmall.copy(
                                    textDecoration = if (isChecked) TextDecoration.LineThrough else TextDecoration.None,
                                    color =
                                        if (isChecked) {
                                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
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
