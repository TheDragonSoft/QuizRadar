package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.ExtractedTimetableModel

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
        title = { Text("Reading the timetable image") },
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
        title = { Text("AI course import failed") },
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

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Review the imported timetable") },
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
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                }

                Text(
                    text =
                        "${schedule.courses.size} course(s), ${schedule.slots.size} weekly slot(s) read.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (dropped > 0) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text =
                                "$dropped row(s) could not be read and were left out " +
                                    "(${extracted.droppedCourses} course, ${extracted.droppedSlots} slot). " +
                                    "Add anything missing by hand after the import.",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(10.dp),
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                schedule.courses.forEach { course ->
                    val courseSlots = schedule.slots.filter { it.courseId.equals(course.id, ignoreCase = true) }
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier =
                                        Modifier
                                            .size(10.dp)
                                            .clip(CircleShape)
                                            .background(courseColor(course.color)),
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = "${course.id} - ${course.name}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Bold,
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
                                            "${slot.day} ${slot.startTime}-${slot.endTime}" +
                                                (if (!slot.room.isNullOrBlank()) " - ${slot.room}" else ""),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onApply) {
                Text("Import ${schedule.courses.size} course(s)", fontSize = 12.sp)
            }
        },
        dismissButton = {
            OutlinedButton(onClick = onDismiss) {
                Text("Cancel", fontSize = 12.sp)
            }
        },
    )
}

/** The course's own color, or the app's default accent when it has none. */
private fun courseColor(hex: String?): Color =
    try {
        Color(android.graphics.Color.parseColor(hex ?: "#1a73e8"))
    } catch (_: Exception) {
        Color(0xFF1A73E8)
    }
