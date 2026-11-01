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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
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
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val haptic = LocalHapticFeedback.current
    val palette = CoursePalette.get(recommendation.courseId)
    val courseTextColor = CoursePalette.textOnSurface(recommendation.courseId, isDark)

    val (urgencyColor, urgencyBg) =
        when (recommendation.urgencyBadge) {
            "TODAY" ->
                (if (isDark) Color(0xFFFCA5A5) else Color(0xFFB91C1C)) to
                    Color(0xFFDC2626).copy(alpha = if (isDark) 0.22f else 0.12f)
            "TOMORROW" ->
                (if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)) to
                    Color(0xFFD97706).copy(alpha = if (isDark) 0.22f else 0.14f)
            "PAST" ->
                MaterialTheme.colorScheme.onSurfaceVariant to MaterialTheme.colorScheme.surfaceVariant
            else ->
                MaterialTheme.colorScheme.onSecondaryContainer to
                    MaterialTheme.colorScheme.secondaryContainer
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
                    text = "#$index • ${recommendation.courseName ?: recommendation.courseId ?: "General"}",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = courseTextColor,
                )
            }

            if (recommendation.urgencyBadge != null) {
                Text(
                    text = recommendation.urgencyBadge,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = urgencyColor,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(urgencyBg)
                            .padding(horizontal = 7.dp, vertical = 2.dp),
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
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(modifier = Modifier.height(10.dp))
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
                    TextStyle(
                        fontSize = 11.sp,
                        fontFeatureSettings = "tnum",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
            )
            Text(
                text = if (totalTopics == 0) "—" else "${(progress * 100).toInt()}%",
                style =
                    TextStyle(
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        fontFeatureSettings = "tnum",
                        color = courseTextColor,
                    ),
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
                                .defaultMinSize(minHeight = 40.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onToggleTopic(topicItem.key, !isChecked)
                                }
                                .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
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
                            modifier = Modifier.size(24.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = topicItem.topic,
                            style =
                                MaterialTheme.typography.bodySmall.copy(
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
