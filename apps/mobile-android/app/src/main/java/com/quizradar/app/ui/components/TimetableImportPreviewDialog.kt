package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.ExtractedTimetableModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.tonalPill

/**
 * The "working" state of the AI timetable import.
 *
 * The dialog cannot be dismissed while Gemini reads the image: closing it
 * would leave a request running with no way to see its result.
 */
@Composable
fun TimetableImportWorkingDialog() {
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Reading the timetable image", style = MaterialTheme.typography.titleLarge) },
        text = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = "Gemini is reading the image. This can take up to a minute.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        },
        confirmButton = {},
    )
}

/**
 * The honest failure of the AI timetable import: what went wrong, and what
 * the user can do about it. Never a generic "something went wrong".
 */
@Composable
fun TimetableImportErrorDialog(
    message: String,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("AI course import failed", style = MaterialTheme.typography.titleLarge) },
        text = { Text(message, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        },
    )
}

/**
 * The preview of what Gemini actually read (`01` §4.1: "preview modal ->
 * apply or manual fallback").
 *
 * The dropped-row counts are shown on purpose: rows the model could not read
 * are NOT in the list, and pretending the import was complete would be a
 * lie the user would discover later as a missing class.
 */
@Composable
fun TimetableImportPreviewDialog(
    extracted: ExtractedTimetableModel,
    onApply: () -> Unit,
    onDismiss: () -> Unit,
) {
    val schedule = extracted.schedule
    val dropped = extracted.droppedCourses + extracted.droppedSlots
    val courseCount = schedule.courses.size
    val slotCount = schedule.slots.size

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Review the imported timetable", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
            ) {
                schedule.semester?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Text(
                    text =
                        "${countOf(courseCount, "course")}, ${countOf(slotCount, "weekly slot")} read.",
                    style =
                        MaterialTheme.typography.bodySmall.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (dropped > 0) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.errorContainer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Warning,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onErrorContainer,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text =
                                    "$dropped ${if (dropped == 1) "row" else "rows"} could not be read and were left out " +
                                        "(${extracted.droppedCourses} ${if (extracted.droppedCourses == 1) "course" else "courses"}, " +
                                        "${extracted.droppedSlots} ${if (extracted.droppedSlots == 1) "slot" else "slots"}). " +
                                        "Add anything missing by hand after the import.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                schedule.courses.forEach { course ->
                    val courseSlots = schedule.slots.filter { it.courseId.equals(course.id, ignoreCase = true) }
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier =
                                        Modifier
                                            .size(12.dp)
                                            .clip(CircleShape)
                                            .background(courseColor(course.color)),
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "${course.id} - ${course.name}",
                                    style = MaterialTheme.typography.titleMedium,
                                )
                            }
                            if (courseSlots.isEmpty()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "No weekly slots were read for this course.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                courseSlots.forEach { slot ->
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text =
                                            "${slot.day} ${slot.startTime}–${slot.endTime} · " +
                                                (if (!slot.room.isNullOrBlank()) slot.room else "—"),
                                        style =
                                            MaterialTheme.typography.bodySmall.copy(
                                                fontFeatureSettings = "tnum",
                                            ),
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onApply,
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text("Import $courseCount ${if (courseCount == 1) "course" else "courses"}")
            }
        },
        dismissButton = {
            FilledTonalButton(
                onClick = onDismiss,
                colors = ButtonDefaults.tonalPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text("Cancel")
            }
        },
    )
}

/** "3 courses", "1 course" - the count and its noun agree. */
private fun countOf(
    count: Int,
    noun: String,
): String = if (count == 1) "$count $noun" else "$count ${noun}s"

/** The course's own color, or the app's accent when it has none or a broken value. */
@Composable
private fun courseColor(hex: String?): Color {
    val parsed =
        try {
            hex?.let { Color(android.graphics.Color.parseColor(it)) }
        } catch (_: Exception) {
            null
        }
    return parsed ?: MaterialTheme.colorScheme.primary
}
