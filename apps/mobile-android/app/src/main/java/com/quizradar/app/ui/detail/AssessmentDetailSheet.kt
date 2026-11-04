package com.quizradar.app.ui.detail

import android.content.Intent
import android.provider.CalendarContract
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetState
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.core.topicKey
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.GradeSaveResult
import com.quizradar.app.ui.calendarEventBeginTimeMillis
import com.quizradar.app.ui.extractTimePart
import com.quizradar.app.ui.formatIsoDateForDisplay
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.CoursePalette
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssessmentDetailSheet(
    assessment: AssessmentModel,
    allAssessments: List<AssessmentModel>,
    completedTopicsMap: Map<String, Boolean>,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onToggleTopic: (key: String, done: Boolean) -> Unit,
    onSaveGrade: suspend (achieved: Double?, max: Double?, weight: Double?) -> GradeSaveResult,
    /**
     * Serializes the calendar into an `.ics` document.
     *
     * `suspend` because the native call blocks: it used to run straight on
     * the UI thread from this button, which froze the app on a large
     * timetable.
     */
    onExportIcs: suspend () -> String,
    onOpenPractice: () -> Unit,
    onOpenPomodoro: (topicTitle: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val palette = CoursePalette.get(assessment.courseId)
    val courseTextColor = CoursePalette.textOnSurface(assessment.courseId, isDark)

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
    // The outcome of the LAST write attempt. "Grade Saved!" is shown for a
    // confirmed write only - a failed write renders its reason instead.
    var gradeSaveResult by remember(assessment.id) { mutableStateOf<GradeSaveResult?>(null) }
    var isSavingGrade by remember(assessment.id) { mutableStateOf(false) }

    var whatIfScore by remember(assessment.id) {
        val initial =
            if (
                assessment.achievedScore != null &&
                assessment.maxScore != null &&
                assessment.maxScore > 0
            ) {
                ((assessment.achievedScore / assessment.maxScore) * 100.0)
            } else {
                85.0
            }
        mutableDoubleStateOf(initial)
    }

    // The calculator is pure, but it is re-run on every recomposition of
    // this sheet - and the what-if slider changes its input on every drag
    // frame. Remembering it keeps the drag cheap.
    val whatIf =
        remember(assessment, allAssessments, whatIfScore) {
            WhatIfCalculator.calculate(assessment, allAssessments, whatIfScore)
        }

    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = modifier.padding(top = statusBarPadding),
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
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f),
                ) {
                    Box(
                        modifier =
                            Modifier
                                .size(12.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(palette.color),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = assessment.courseId ?: "General",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                        color = courseTextColor,
                    )
                    if (assessment.courseName != null) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "• ${assessment.courseName}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                // 48dp minimum touch target (Material a11y guideline).
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
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
                    color = courseTextColor,
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
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                )
                if (assessment.daysUntil != null) {
                    val urgencyText =
                        when (assessment.daysUntil) {
                            0 -> "TODAY"
                            1 -> "TOMORROW"
                            else -> if (assessment.daysUntil < 0) "PAST" else "IN ${assessment.daysUntil} DAYS"
                        }
                    val (urgencyColor, urgencyBg) =
                        when (assessment.daysUntil) {
                            0 ->
                                (if (isDark) Color(0xFFFCA5A5) else Color(0xFFB91C1C)) to
                                    Color(0xFFDC2626).copy(alpha = if (isDark) 0.22f else 0.12f)
                            1 ->
                                (if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)) to
                                    Color(0xFFD97706).copy(alpha = if (isDark) 0.22f else 0.14f)
                            else ->
                                if (assessment.daysUntil < 0) {
                                    MaterialTheme.colorScheme.onSurfaceVariant to
                                        MaterialTheme.colorScheme.surfaceVariant
                                } else {
                                    MaterialTheme.colorScheme.onSecondaryContainer to
                                        MaterialTheme.colorScheme.secondaryContainer
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
                                .background(urgencyBg)
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
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                        .border(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                            RoundedCornerShape(12.dp),
                        )
                        .padding(12.dp),
            ) {
                Text(
                    text = "FACTS",
                    fontSize = 11.sp,
                    letterSpacing = 0.6.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Date",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text =
                                formatIsoDateForDisplay(assessment.dateIso?.toString())
                                    ?: assessment.dateIso?.toString()
                                    ?: "Undated",
                            style =
                                TextStyle(
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    fontFeatureSettings = "tnum",
                                    color = MaterialTheme.colorScheme.onSurface,
                                ),
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Time",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            // The core's `display_time` repeats the date the
                            // Date field already shows - only the time part
                            // belongs under "Time".
                            text = extractTimePart(assessment.displayTime) ?: "—",
                            style =
                                TextStyle(
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    fontFeatureSettings = "tnum",
                                    color = MaterialTheme.colorScheme.onSurface,
                                ),
                        )
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Room",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = assessment.room ?: "—",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Instructor",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = assessment.instructor ?: "—",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }

            if (assessment.warnings.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    assessment.warnings.forEach { warning ->
                        Text(
                            text = "⚠ $warning",
                            fontSize = 11.sp,
                            color = if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E),
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
                letterSpacing = 0.6.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(6.dp))

            if (assessment.topics.isEmpty()) {
                Text(
                    text = "No topics listed for this assessment.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                assessment.topics.forEachIndexed { index, topic ->
                    // Content-addressed key (`{id}::h{hash}` of the topic
                    // text): a rescan that reorders the list can never move
                    // someone's checkmark onto a different topic.
                    val key = topicKey(assessment.id, topic)
                    val isChecked = completedTopicsMap[key] == true
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 40.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onToggleTopic(key, !isChecked)
                                }
                                .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = isChecked,
                            onCheckedChange = { done ->
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onToggleTopic(key, done)
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
                            text = topic,
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
                            modifier = Modifier.weight(1f),
                        )
                        // Focus timer on THIS topic - the timer carries the
                        // topic's index, so "Mark Topic Done" later marks the
                        // topic shown here, not the first one.
                        IconButton(
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onOpenPomodoro(topic)
                            },
                            // 48dp minimum touch target (Material a11y guideline).
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Timer,
                                contentDescription = "Focus timer for $topic",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            // Grade Editor
            Spacer(modifier = Modifier.height(18.dp))
            Text(
                text = "GRADE RECORD",
                fontSize = 11.sp,
                letterSpacing = 0.6.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = scoreInput,
                    onValueChange = {
                        scoreInput = it
                        gradeSaveResult = null
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
                        gradeSaveResult = null
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
                        gradeSaveResult = null
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
                Text(text = gradeError!!, fontSize = 11.sp, color = MaterialTheme.colorScheme.error)
            }

            // A write that failed says so, in the same error language as the
            // validation messages above - never a silent no-op.
            val failedSave = gradeSaveResult as? GradeSaveResult.Failed
            if (failedSave != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Grade not saved: ${failedSave.message}",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.error,
                )
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
                    gradeSaveResult = null
                    isSavingGrade = true
                    scope.launch {
                        // The ViewModel reports what the write really did:
                        // only a confirmed write may say "Grade Saved!".
                        val result = onSaveGrade(score, max, weight)
                        gradeSaveResult = result
                        isSavingGrade = false
                    }
                },
                enabled = !isSavingGrade,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 46.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Save,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text =
                        when {
                            isSavingGrade -> "Saving…"
                            gradeSaveResult is GradeSaveResult.Saved -> "Grade Saved!"
                            else -> "Save Grade Record"
                        },
                    fontWeight = FontWeight.SemiBold,
                )
            }

            // What-If Projector
            Spacer(modifier = Modifier.height(18.dp))
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f))
                        .border(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                            RoundedCornerShape(12.dp),
                        )
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
                        letterSpacing = 0.6.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    val projColor =
                        when (whatIf.colorState) {
                            ScoreColorState.GREEN -> if (isDark) Color(0xFF34D399) else Color(0xFF047857)
                            ScoreColorState.AMBER -> if (isDark) Color(0xFFFBBF24) else Color(0xFFB45309)
                            ScoreColorState.ROSE -> if (isDark) Color(0xFFF87171) else Color(0xFFB91C1C)
                        }
                    Text(
                        text = "Projected Avg: ${whatIf.projectedAvg}%",
                        style =
                            TextStyle(
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                fontFeatureSettings = "tnum",
                                color = projColor,
                            ),
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "If you score ${whatIfScore.toInt()}% on this assessment:",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Slider(
                    value = whatIfScore.toFloat(),
                    onValueChange = { whatIfScore = it.toDouble() },
                    valueRange = 0f..100f,
                    modifier = Modifier.fillMaxWidth(),
                )

                Text(
                    text = "Note: Assumes equal weight across recorded course assessments.",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Action Buttons: Share .ics / Calendar / Practice Quiz / Focus Timer
            Spacer(modifier = Modifier.height(20.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = {
                        // The export runs off the main thread (the engine
                        // owns the dispatcher), so the share sheet opens
                        // once the document is ready.
                        scope.launch {
                            val icsContent = onExportIcs()
                            val shareIntent =
                                Intent(Intent.ACTION_SEND).apply {
                                    type = "text/calendar"
                                    putExtra(
                                        Intent.EXTRA_SUBJECT,
                                        "${assessment.courseId ?: "Exam"}: ${assessment.title}",
                                    )
                                    putExtra(Intent.EXTRA_TEXT, icsContent)
                                }
                            context.startActivity(
                                Intent.createChooser(shareIntent, "Export Calendar (.ics)"),
                            )
                        }
                    },
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = 44.dp),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Share,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(text = "Export .ics", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }

                OutlinedButton(
                    onClick = {
                        val intent =
                            Intent(Intent.ACTION_INSERT).apply {
                                data = CalendarContract.Events.CONTENT_URI
                                putExtra(
                                    CalendarContract.Events.TITLE,
                                    "[${assessment.courseId ?: "Exam"}] ${assessment.title}",
                                )
                                putExtra(
                                    CalendarContract.Events.DESCRIPTION,
                                    "QuizRadar exam radar item",
                                )
                                // The begin time used to be missing entirely -
                                // the calendar app opened on a blank event.
                                // Local midnight of the assessment date (or its
                                // own start time), and omitted when no date is
                                // known - never a fabricated default.
                                calendarEventBeginTimeMillis(
                                    assessment.dateIso?.toString(),
                                    assessment.startTime,
                                )?.let { beginMillis ->
                                    putExtra(
                                        CalendarContract.EXTRA_EVENT_BEGIN_TIME,
                                        beginMillis,
                                    )
                                }
                                if (assessment.room != null) {
                                    putExtra(CalendarContract.Events.EVENT_LOCATION, assessment.room)
                                }
                            }
                        try {
                            context.startActivity(intent)
                        } catch (_: Exception) {
                        }
                    },
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = 44.dp),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Event,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(text = "Calendar", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onOpenPractice,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = 44.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Quiz,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(text = "Practice Quiz", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }

                Button(
                    onClick = { onOpenPomodoro(assessment.topics.firstOrNull()) },
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = 44.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF4338CA),
                            contentColor = Color.White,
                        ),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Timer,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(text = "Focus Timer", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
