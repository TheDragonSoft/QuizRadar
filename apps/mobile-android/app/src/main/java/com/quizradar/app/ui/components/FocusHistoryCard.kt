package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import org.json.JSONArray

/**
 * One persisted focus session (`core/src/types.rs`: `StudySessionRecord`).
 *
 * The shell reads the stored record as-is: the minutes are the minutes the
 * core logged, the course and topic are the ones the session was saved with.
 */
private data class FocusSession(
    val courseId: String?,
    val topic: String?,
    val minutes: Int,
    val timestamp: String,
)

/**
 * Parses the persisted session list.
 *
 * A malformed payload yields an EMPTY list instead of a crash or a made-up
 * number - the card then shows its honest empty state.
 */
private fun parseFocusSessions(json: String): List<FocusSession> =
    runCatching {
        val array = JSONArray(json)
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            FocusSession(
                // `optString` renders a JSON null as the literal string
                // "null" - guard with isNull so absent fields stay absent.
                courseId =
                    item.optString("course_id").takeIf {
                        it.isNotBlank() && !item.isNull("course_id")
                    },
                topic =
                    item.optString("topic").takeIf {
                        it.isNotBlank() && !item.isNull("topic")
                    },
                minutes = item.optInt("duration_minutes", 0),
                timestamp = item.optString("timestamp"),
            )
        }
    }.getOrDefault(emptyList())

/** "45m" / "1h 05m" - exactly the minutes the store holds. */
internal fun formatFocusMinutes(minutes: Int): String =
    if (minutes < 60) {
        "${minutes}m"
    } else {
        "${minutes / 60}h ${(minutes % 60).toString().padStart(2, '0')}m"
    }

/** The stored timestamp, shortened to "date · hh:mm" (no invented clock). */
private fun focusTimestampLabel(timestamp: String): String {
    val date = timestamp.substringBefore('T')
    val time = timestamp.substringAfter('T', "").take(5)
    return if (time.isBlank()) date else "$date · $time"
}

/**
 * The persisted focus history (audit A06 / brief "Truthful stats").
 *
 * Every number here comes from the store: the streak and the per-course
 * minutes are the core's own analytics, and the session rows are the
 * persisted session log. With nothing logged the card shows an honest empty
 * state - never demo minutes or a seeded streak.
 */
@Composable
fun FocusHistoryCard(
    streakDays: Int,
    minutesByCourse: Map<String, Int>,
    sessionsJson: String,
    courseNames: Map<String, String>,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val sessions = remember(sessionsJson) { parseFocusSessions(sessionsJson) }
    val trackedCourses = minutesByCourse.entries.sortedByDescending { it.value }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Study history",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                // The streak is a status, so it wears the one badge shape -
                // positive container only when a streak really exists.
                StatusTag(
                    text = if (streakDays > 0) "$streakDays-day streak" else "No streak yet",
                    containerColor =
                        if (streakDays > 0) {
                            StatusColors.successContainer(isDark)
                        } else {
                            MaterialTheme.colorScheme.secondaryContainer
                        },
                    contentColor =
                        if (streakDays > 0) {
                            StatusColors.onSuccessContainer(isDark)
                        } else {
                            MaterialTheme.colorScheme.onSecondaryContainer
                        },
                    tabular = true,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            if (trackedCourses.isEmpty() && sessions.isEmpty()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(MaterialTheme.shapes.extraSmall)
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(16.dp),
                ) {
                    Text(
                        text =
                            "No focus sessions yet. Run a timer session in the Session tab and " +
                                "the completed session is listed here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                if (trackedCourses.isNotEmpty()) {
                    Text(
                        text = "Focus minutes by course",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    val maxMinutes = trackedCourses.maxOf { it.value }.coerceAtLeast(1)
                    trackedCourses.forEach { (courseId, minutes) ->
                        val label = courseNames[courseId] ?: courseId
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Text(
                                    text = formatFocusMinutes(minutes),
                                    style =
                                        MaterialTheme.typography.labelMedium.copy(
                                            fontFeatureSettings = "tnum",
                                        ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            Box(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(MaterialTheme.shapes.small)
                                        .background(MaterialTheme.colorScheme.surfaceVariant),
                            ) {
                                Box(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth(minutes.toFloat() / maxMinutes.toFloat())
                                            .height(6.dp)
                                            .clip(MaterialTheme.shapes.small)
                                            .background(MaterialTheme.colorScheme.primary),
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }

                Text(
                    text = "Saved sessions (${sessions.size})",
                    style =
                        MaterialTheme.typography.labelMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(8.dp))
                sessions.forEach { session ->
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = session.courseId?.let { courseNames[it] ?: it } ?: "No course",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            if (session.topic != null) {
                                Text(
                                    text = session.topic,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(
                                text = focusTimestampLabel(session.timestamp),
                                style =
                                    MaterialTheme.typography.labelMedium.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = formatFocusMinutes(session.minutes),
                            style =
                                MaterialTheme.typography.labelMedium.copy(
                                    fontFeatureSettings = "tnum",
                                ),
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}
