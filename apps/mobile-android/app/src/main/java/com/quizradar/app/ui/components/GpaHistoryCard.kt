package com.quizradar.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * One per-course row of the shared GPA summary (`core/src/plan/gpa.rs`:
 * `CourseGradeSummary`). Every field is the core's own output - a course
 * without graded work simply carries `null` percentage and letter, and this
 * card renders "—" for it, never an invented grade.
 */
private data class GpaCourseRow(
    val courseId: String,
    val courseName: String,
    val credits: Double?,
    val percentage: Double?,
    val letterGrade: String?,
)

/** The parsed `GpaSummary` payload (`core/src/plan/gpa.rs`). */
private data class GpaSummaryData(
    val scale: String,
    val totalCredits: Double,
    val semesterGpa: Double?,
    val courses: List<GpaCourseRow>,
)

/**
 * Parses the persisted GPA summary JSON. A malformed payload yields `null`
 * instead of a crash or a made-up number - the card then shows its honest
 * empty state.
 */
private fun parseGpaSummary(json: String?): GpaSummaryData? =
    runCatching {
        if (json.isNullOrBlank()) return null
        val obj = JSONObject(json)
        val courses = mutableListOf<GpaCourseRow>()
        val array = obj.optJSONArray("courses") ?: JSONArray()
        (0 until array.length()).forEach { index ->
            val item = array.optJSONObject(index) ?: return@forEach
            courses.add(
                GpaCourseRow(
                    courseId = item.optString("course_id"),
                    courseName =
                        item.optString("course_name").takeIf {
                            it.isNotBlank() && !item.isNull("course_name")
                        } ?: item.optString("course_id"),
                    credits = item.optDoubleOrNull("credits"),
                    percentage = item.optDoubleOrNull("percentage"),
                    letterGrade =
                        item.optString("letter_grade").takeIf {
                            it.isNotBlank() && !item.isNull("letter_grade")
                        },
                ),
            )
        }
        GpaSummaryData(
            scale = obj.optString("scale"),
            totalCredits = obj.optDouble("total_credits", 0.0),
            semesterGpa = obj.optDoubleOrNull("semester_gpa"),
            courses = courses,
        )
    }.getOrDefault(null)

/**
 * Reads a JSON double the honest way: an absent or null field stays `null`,
 * and a non-numeric field never sneaks a `NaN` onto the screen as a number.
 */
private fun JSONObject.optDoubleOrNull(name: String): Double? = if (isNull(name)) null else optDouble(name).takeIf { !it.isNaN() }

/** "3.47" - one decimal, exactly the precision the core computes. */
internal fun formatGpa(value: Double): String = String.format(Locale.US, "%.2f", value)

/** "82.3%" - the core's own percentage, formatted for display. */
internal fun formatPercentage(value: Double): String = String.format(Locale.US, "%.1f%%", value)

/**
 * The shared GPA summary, computed by the SAME Rust calculator the web
 * Grade Center uses (`calculateGpa` in `QuizRadarCore.kt`). Every number on
 * this card is traceable to the store: a course without graded work shows
 * "—" for its percentage and letter, and an empty store shows an honest
 * empty state - never demo grades.
 */
@Composable
fun GpaHistoryCard(
    gpaSummaryJson: String?,
    scaleLabel: String,
    modifier: Modifier = Modifier,
) {
    val summary = remember(gpaSummaryJson) { parseGpaSummary(gpaSummaryJson) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "GPA · $scaleLabel",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(4.dp))
            // Only a real GPA claims the hero slot - honest fallbacks read as body copy.
            val semesterGpa = summary?.semesterGpa
            if (semesterGpa != null) {
                Text(
                    text = formatGpa(semesterGpa),
                    style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.primary,
                )
            } else {
                Text(
                    text = summary?.let { "No graded work yet" } ?: "—",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            if (summary == null || summary.courses.isEmpty()) {
                // Empty state: honest text on the card surface, not a nested box.
                Text(
                    text =
                        "No GPA yet. Add a course and mark a score, and the shared calculator " +
                            "shows the per-course grades here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                HorizontalDivider()
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text =
                        if (summary.totalCredits > 0.0) {
                            "Courses (${summary.courses.size}) · ${String.format(Locale.US, "%.1f", summary.totalCredits)} credits"
                        } else {
                            "Courses (${summary.courses.size})"
                        },
                    style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                summary.courses.forEachIndexed { index, course ->
                    if (index > 0) HorizontalDivider()
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 56.dp)
                                .padding(
                                    top = 12.dp,
                                    // The card's own 16dp padding closes the last row.
                                    bottom = if (index == summary.courses.lastIndex) 0.dp else 12.dp,
                                ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = course.courseName,
                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text =
                                    when {
                                        course.credits != null ->
                                            String.format(Locale.US, "%.1f", course.credits) + " credits"
                                        else -> "No credits recorded"
                                    },
                                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = course.percentage?.let { formatPercentage(it) } ?: "—",
                            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = course.letterGrade ?: "—",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}
