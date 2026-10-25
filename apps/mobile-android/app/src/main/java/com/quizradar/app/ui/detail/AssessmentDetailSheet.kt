package com.quizradar.app.ui.detail

import android.content.Intent
import android.provider.CalendarContract
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Quiz
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetState
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.theme.CoursePalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssessmentDetailSheet(
    assessment: AssessmentModel,
    allAssessments: List<AssessmentModel>,
    completedTopicsMap: Map<String, Boolean>,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onToggleTopic: (key: String, done: Boolean) -> Unit,
    onSaveGrade: (achieved: Double?, max: Double?, weight: Double?) -> Unit,
    onExportIcs: () -> String,
    onOpenPractice: () -> Unit,
    onOpenPomodoro: (topicTitle: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val palette = CoursePalette.get(assessment.courseId)

    // Grade edit inputs
    var scoreInput by remember(assessment.id) {
        mutableStateOf(assessment.achievedScore?.toString() ?: "")
    }
    var maxInput by remember(assessment.id) {
        mutableStateOf(assessment.maxScore?.toString() ?: "")
    }
    var weightInput by remember(assessment.id) {
        mutableStateOf(assessment.weightagePercent?.toString() ?: "")
    }
    var gradeError by remember(assessment.id) { mutableStateOf<String?>(null) }
    var gradeSavedNotice by remember(assessment.id) { mutableStateOf(false) }

    // What-if score slider/input (default 85% or existing score %)
    var whatIfScore by remember(assessment.id) {
        val initial =
            if (assessment.achievedScore != null && assessment.maxScore != null && assessment.maxScore > 0) {
                ((assessment.achievedScore / assessment.maxScore) * 100.0)
            } else {
                85.0
            }
        mutableDoubleStateOf(initial)
    }

    val whatIf = WhatIfCalculator.calculate(assessment, allAssessments, whatIfScore)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = modifier,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header: Course color bar + Course Code + Close
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier =
                            Modifier
                                .size(12.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(palette.color),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = assessment.courseId ?: "GENERAL",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                        color = palette.color,
                    )
                    if (assessment.courseName != null) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "• ${assessment.courseName}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Close")
                }
            }

            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = assessment.title,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
            )

            // Badges row: Type / Source / Urgency
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = assessment.assessmentType,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = palette.color,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(palette.background)
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                )
                Text(
                    text = assessment.source,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                )
                if (assessment.daysUntil != null) {
                    val urgencyText =
                        when (assessment.daysUntil) {
                            0 -> "TODAY"
                            1 -> "TOMORROW"
                            else -> if (assessment.daysUntil < 0) "PAST" else "IN ${assessment.daysUntil} DAYS"
                        }
                    val urgencyColor =
                        when (assessment.daysUntil) {
                            0 -> Color(0xFFDC2626)
                            1 -> Color(0xFFD97706)
                            else ->
                                if (assessment.daysUntil < 0) {
                                    Color(0xFF64748B)
                                } else {
                                    MaterialTheme.colorScheme.primary
                                }
                        }
                    Text(
                        text = urgencyText,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = urgencyColor,
                        modifier =
                            Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(urgencyColor.copy(alpha = 0.12f))
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }

            // Facts Grid: Date, Time, Room, Instructor
            Spacer(modifier = Modifier.height(16.dp))
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f))
                        .padding(12.dp),
            ) {
                Text(
                    text = "FACTS",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                )
                Spacer(modifier = Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = "Date", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        Text(
                            text = assessment.dateIso?.toString() ?: "Undated",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = "Time", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        Text(
                            text = assessment.displayTime ?: "—",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = "Room", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        Text(
                            text = assessment.room ?: "—",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = "Instructor", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                        Text(
                            text = assessment.instructor ?: "—",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            // Warnings
            if (assessment.warnings.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    assessment.warnings.forEach { warning ->
                        Text(
                            text = "⚠ $warning",
                            fontSize = 11.sp,
                            color = Color(0xFFD97706),
                            modifier = Modifier.padding(vertical = 2.dp),
                        )
                    }
                }
            }

            // Topics Checklist
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "TOPICS & READINESS",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
            Spacer(modifier = Modifier.height(6.dp))

            if (assessment.topics.isEmpty()) {
                Text(
                    text = "No topics listed for this assessment.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            } else {
                assessment.topics.forEachIndexed { index, topic ->
                    val key = "${assessment.id}::$index"
                    val isChecked = completedTopicsMap[key] == true
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 2.dp)
                                .clickable { onToggleTopic(key, !isChecked) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = isChecked,
                            onCheckedChange = { done -> onToggleTopic(key, done) },
                            colors =
                                CheckboxDefaults.colors(
                                    checkedColor = palette.color,
                                    uncheckedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                                ),
                            modifier = Modifier.size(24.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = topic,
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

            // Grade Editor (Explicit-null-clears semantics)
            Spacer(modifier = Modifier.height(18.dp))
            Text(
                text = "GRADE RECORD",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
            Spacer(modifier = Modifier.height(8.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = scoreInput,
                    onValueChange = {
                        scoreInput = it
                        gradeSavedNotice = false
                    },
                    label = { Text("Score", fontSize = 11.sp) },
                    placeholder = { Text("e.g. 18", fontSize = 11.sp) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = maxInput,
                    onValueChange = {
                        maxInput = it
                        gradeSavedNotice = false
                    },
                    label = { Text("Max", fontSize = 11.sp) },
                    placeholder = { Text("e.g. 20", fontSize = 11.sp) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = weightInput,
                    onValueChange = {
                        weightInput = it
                        gradeSavedNotice = false
                    },
                    label = { Text("Weight %", fontSize = 11.sp) },
                    placeholder = { Text("e.g. 15", fontSize = 11.sp) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }

            if (gradeError != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = gradeError!!, fontSize = 11.sp, color = Color(0xFFDC2626))
            }

            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = {
                    val score = scoreInput.trim().toDoubleOrNull()
                    val max = maxInput.trim().toDoubleOrNull()
                    val weight = weightInput.trim().toDoubleOrNull()

                    if (scoreInput.isNotBlank() && score == null) {
                        gradeError = "Invalid score"
                        return@Button
                    }
                    if (maxInput.isNotBlank() && max == null) {
                        gradeError = "Invalid max score"
                        return@Button
                    }
                    if (score != null && score < 0.0) {
                        gradeError = "Score cannot be negative"
                        return@Button
                    }
                    if (max != null && max <= 0.0) {
                        gradeError = "Max score must be > 0"
                        return@Button
                    }
                    if (score != null && max != null && score > max) {
                        gradeError = "Achieved score cannot exceed max score"
                        return@Button
                    }

                    gradeError = null
                    onSaveGrade(score, max, weight)
                    gradeSavedNotice = true
                },
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(imageVector = Icons.Outlined.Save, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text(text = if (gradeSavedNotice) "Grade Saved!" else "Save Grade Record")
            }

            // What-If Projector
            Spacer(modifier = Modifier.height(18.dp))
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f))
                        .padding(12.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "WHAT-IF PROJECTOR",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                    val projColor =
                        when (whatIf.colorState) {
                            ScoreColorState.GREEN -> Color(0xFF059669)
                            ScoreColorState.AMBER -> Color(0xFFD97706)
                            ScoreColorState.ROSE -> Color(0xFFDC2626)
                        }
                    Text(
                        text = "Projected Avg: ${whatIf.projectedAvg}%",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = projColor,
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "If you score ${whatIfScore.toInt()}% on this assessment:",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                )

                Slider(
                    value = whatIfScore.toFloat(),
                    onValueChange = { whatIfScore = it.toDouble() },
                    valueRange = 0f..100f,
                    modifier = Modifier.fillMaxWidth(),
                )

                Text(
                    text = "Note: Assumes equal weight across recorded course assessments.",
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                )
            }

            // Action Buttons: Google Calendar / Share .ics / Practice Quiz / Focus Timer
            Spacer(modifier = Modifier.height(20.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        val icsContent = onExportIcs()
                        val shareIntent =
                            Intent(Intent.ACTION_SEND).apply {
                                type = "text/calendar"
                                putExtra(Intent.EXTRA_SUBJECT, "${assessment.courseId}: ${assessment.title}")
                                putExtra(Intent.EXTRA_TEXT, icsContent)
                            }
                        context.startActivity(Intent.createChooser(shareIntent, "Export Calendar (.ics)"))
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary),
                ) {
                    Icon(imageVector = Icons.Outlined.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(text = "Export .ics", fontSize = 11.sp)
                }

                Button(
                    onClick = {
                        val intent =
                            Intent(Intent.ACTION_INSERT).apply {
                                data = CalendarContract.Events.CONTENT_URI
                                putExtra(CalendarContract.Events.TITLE, "[${assessment.courseId}] ${assessment.title}")
                                putExtra(CalendarContract.Events.DESCRIPTION, "QuizRadar exam radar item")
                                if (assessment.room != null) {
                                    putExtra(CalendarContract.Events.EVENT_LOCATION, assessment.room)
                                }
                            }
                        try {
                            context.startActivity(intent)
                        } catch (_: Exception) {
                        }
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Icon(imageVector = Icons.Outlined.Event, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(text = "Calendar", fontSize = 11.sp)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onOpenPractice,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = palette.color),
                ) {
                    Icon(imageVector = Icons.Outlined.Quiz, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(text = "Practice Quiz", fontSize = 11.sp)
                }

                Button(
                    onClick = { onOpenPomodoro(assessment.topics.firstOrNull()) },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF4F46E5)),
                ) {
                    Icon(imageVector = Icons.Outlined.Timer, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(text = "Focus Timer", fontSize = 11.sp)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
