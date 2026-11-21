package com.quizradar.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.CourseImportReportModel
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.ExtractedSyllabusAssessmentModel
import com.quizradar.app.model.ExtractedSyllabusModel
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.tonalPill
import java.util.Locale

@Composable
fun SyllabusImportWorkingDialog(fileCount: Int) {
    AlertDialog(
        onDismissRequest = {},
        title = {
            Text(
                text = "Reading $fileCount syllabus file${if (fileCount == 1) "" else "s"}...",
                style = MaterialTheme.typography.titleMedium,
            )
        },
        text = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.5.dp)
                Spacer(modifier = Modifier.width(14.dp))
                Text(
                    text = "Extracting courses, weekly slots, exam dates, weights, and topics with Gemini.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {},
    )
}

@Composable
fun SyllabusImportPreviewDialog(
    extracted: ExtractedSyllabusModel,
    fileErrors: List<String>,
    onApply: (
        semester: String?,
        courses: List<CourseModel>,
        slots: List<ScheduleSlotModel>,
        assessments: List<ExtractedSyllabusAssessmentModel>,
    ) -> Unit,
    onDismiss: () -> Unit,
) {
    var selectedCourses by remember(extracted) {
        mutableStateOf(extracted.schedule.courses.map { it.id.lowercase(Locale.US) }.toSet())
    }
    var selectedAssessmentIndices by remember(extracted) {
        mutableStateOf(extracted.assessments.indices.toSet())
    }

    val chosenCourses =
        extracted.schedule.courses.filter { it.id.lowercase(Locale.US) in selectedCourses }
    val chosenSlots =
        extracted.schedule.slots.filter { it.courseId.lowercase(Locale.US) in selectedCourses }
    val chosenAssessments =
        extracted.assessments.filterIndexed { index, assessment ->
            index in selectedAssessmentIndices &&
                (assessment.courseId.isNullOrBlank() || assessment.courseId.lowercase(Locale.US) in selectedCourses)
        }

    val hasDrops =
        extracted.droppedCourses > 0 ||
            extracted.droppedSlots > 0 ||
            extracted.droppedAssessments > 0

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(
                    text = "Syllabus Extraction Review",
                    style = MaterialTheme.typography.titleMedium,
                )
                if (extracted.model.isNotBlank()) {
                    Text(
                        text = "Model: ${extracted.model}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        text = {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (hasDrops) {
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = MaterialTheme.colorScheme.secondaryContainer,
                    ) {
                        Row(
                            modifier = Modifier.padding(10.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Warning,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text =
                                    "Honest notice: ${extracted.droppedCourses} course row(s), " +
                                        "${extracted.droppedSlots} slot(s), and " +
                                        "${extracted.droppedAssessments} assessment(s) could not be verified and were left out.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                        }
                    }
                }

                if (fileErrors.isNotEmpty()) {
                    Surface(
                        shape = MaterialTheme.shapes.small,
                        color = MaterialTheme.colorScheme.errorContainer,
                    ) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text(
                                text = "Some files could not be read:",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                            fileErrors.forEach { err ->
                                Text(
                                    text = "- $err",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                )
                            }
                        }
                    }
                }

                Text(
                    text = "Courses (${chosenCourses.size}/${extracted.schedule.courses.size}) - ${chosenSlots.size} slots",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )

                extracted.schedule.courses.forEach { course ->
                    val key = course.id.lowercase(Locale.US)
                    val checked = key in selectedCourses
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedCourses =
                                        if (checked) selectedCourses - key else selectedCourses + key
                                },
                    ) {
                        Checkbox(
                            checked = checked,
                            onCheckedChange = { isChecked ->
                                selectedCourses =
                                    if (isChecked) selectedCourses + key else selectedCourses - key
                            },
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${course.id} - ${course.name}",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            val crText = course.credits?.let { "$it cr" } ?: "Credits unspecified"
                            val aliasText =
                                if (course.aliases.isNotEmpty()) {
                                    " · Aliases: ${course.aliases.joinToString(", ")}"
                                } else {
                                    ""
                                }
                            Text(
                                text = crText + aliasText,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                HorizontalDivider()

                Text(
                    text = "Assessments & Weights (${chosenAssessments.size}/${extracted.assessments.size})",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )

                if (extracted.assessments.isEmpty()) {
                    Text(
                        text = "No graded assessments were listed in these documents.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    extracted.assessments.forEachIndexed { index, item ->
                        val courseOk =
                            item.courseId.isNullOrBlank() ||
                                item.courseId.lowercase(Locale.US) in selectedCourses
                        val checked = index in selectedAssessmentIndices && courseOk
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clickable(enabled = courseOk) {
                                        selectedAssessmentIndices =
                                            if (index in selectedAssessmentIndices) {
                                                selectedAssessmentIndices - index
                                            } else {
                                                selectedAssessmentIndices + index
                                            }
                                    },
                        ) {
                            Checkbox(
                                checked = checked,
                                enabled = courseOk,
                                onCheckedChange = { isChecked ->
                                    selectedAssessmentIndices =
                                        if (isChecked) {
                                            selectedAssessmentIndices + index
                                        } else {
                                            selectedAssessmentIndices - index
                                        }
                                },
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text =
                                        listOfNotNull(item.courseId?.takeIf { it.isNotBlank() }, item.title)
                                            .joinToString(" · "),
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                )
                                val dateStr = item.dateIso?.toString() ?: "Date TBA"
                                val weightStr = item.weightagePercent?.let { " · $it%" }.orEmpty()
                                Text(
                                    text = "${item.assessmentType} · $dateStr$weightStr",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onApply(
                        extracted.schedule.semester,
                        chosenCourses,
                        chosenSlots,
                        chosenAssessments,
                    )
                },
                enabled = chosenCourses.isNotEmpty() || chosenAssessments.isNotEmpty(),
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text("Add Selected to Radar")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun SyllabusImportAppliedDialog(
    report: CourseImportReportModel,
    courseIds: List<String>,
    onShareCourse: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Syllabi Added to Your Radar",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text =
                        "+${report.coursesAdded} new course(s) (${report.coursesUpdated} updated) · " +
                            "+${report.slotsAdded} class slot(s) · +${report.assessmentsAdded} assessment(s).",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (courseIds.isNotEmpty()) {
                    Text(
                        text = "Share a 1-tap Course Pack link or QR with your classmates:",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    courseIds.forEach { cid ->
                        FilledTonalButton(
                            onClick = { onShareCourse(cid) },
                            colors = ButtonDefaults.tonalPill(),
                            contentPadding = PillButtonContentPadding,
                            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Share,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Share $cid Course Pack")
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text("Done")
            }
        },
    )
}

@Composable
fun SyllabusImportErrorDialog(
    message: String,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Syllabus Import Failed", style = MaterialTheme.typography.titleMedium) },
        text = { Text(text = message, style = MaterialTheme.typography.bodySmall) },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        },
    )
}
