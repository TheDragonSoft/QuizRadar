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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.quizradar.app.core.topicKey
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.GradeSaveResult
import com.quizradar.app.ui.calendarEventBeginTimeMillis
import com.quizradar.app.ui.components.StatusTag
import com.quizradar.app.ui.components.urgencyTagStyle
import com.quizradar.app.ui.extractTimePart
import com.quizradar.app.ui.formatIsoDateForDisplay
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill
import kotlinx.coroutines.launch

/** One labelled fact (date, time, room, instructor) inside the facts card. */
@Composable
private fun FactCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    tabular: Boolean = false,
) {
    Column(modifier = modifier) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = value,
            style =
                MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                    fontFeatureSettings = if (tabular) "tnum" else null,
                ),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@OptIn(
    ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class,
)
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
    // The device calendar app may not exist on the phone. A failed hand-off
    // says so instead of swallowing the error.
    var calendarError by remember(assessment.id) { mutableStateOf<String?>(null) }

    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val bringIntoViewRequester = remember { BringIntoViewRequester() }
    val coroutineScope = rememberCoroutineScope()

    // Urgency: one tag recipe shared with the timeline row and the search
    // results - urgent = error container, tomorrow = amber wash, later =
    // secondary container, past = muted.
    val urgency = urgencyTagStyle(assessment.daysUntil)

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
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header: the assessment title leads, the course identity sits
            // under it, the close button stays a 48dp target.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = assessment.title,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier =
                                Modifier
                                    .size(8.dp)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(palette.color),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = assessment.courseId ?: "General",
                            style = MaterialTheme.typography.labelMedium,
                            color = courseTextColor,
                        )
                        if (assessment.courseName != null) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "• ${assessment.courseName}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                // 48dp minimum touch target (Material a11y guideline).
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Close")
                }
            }

            // Tags: Type / Source / Urgency
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StatusTag(
                    text = assessment.assessmentType,
                    containerColor = palette.background,
                    contentColor = courseTextColor,
                )
                StatusTag(
                    text = assessment.source,
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (urgency != null) {
                    StatusTag(
                        text = urgency.label,
                        containerColor = urgency.container,
                        contentColor = urgency.content,
                        tabular = true,
                    )
                }
            }

            // Facts: Date, Time, Room, Instructor
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "Facts",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors(),
                elevation = CardDefaults.quietCardElevation(),
                border = CardDefaults.quietCardBorder(),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        FactCell(
                            label = "Date",
                            value =
                                formatIsoDateForDisplay(assessment.dateIso?.toString())
                                    ?: assessment.dateIso?.toString()
                                    ?: "Undated",
                            tabular = true,
                            modifier = Modifier.weight(1f),
                        )
                        FactCell(
                            label = "Time",
                            // The core's `display_time` repeats the date the
                            // Date field already shows - only the time part
                            // belongs under "Time".
                            value = extractTimePart(assessment.displayTime) ?: "—",
                            tabular = true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        FactCell(
                            label = "Room",
                            value = assessment.room ?: "—",
                            modifier = Modifier.weight(1f),
                        )
                        FactCell(
                            label = "Instructor",
                            value = assessment.instructor ?: "—",
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            if (assessment.warnings.isNotEmpty()) {
                Spacer(modifier = Modifier.height(16.dp))
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    assessment.warnings.forEach { warning ->
                        Row(verticalAlignment = Alignment.Top) {
                            Icon(
                                imageVector = Icons.Outlined.Warning,
                                contentDescription = null,
                                tint = StatusColors.warningBadge,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = warning,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }
            }

            // Topics Checklist
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "Topics & readiness",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))

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
                                .defaultMinSize(minHeight = 48.dp)
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
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "Grade record",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .bringIntoViewRequester(bringIntoViewRequester),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = scoreInput,
                    onValueChange = {
                        scoreInput = it
                        gradeSaveResult = null
                    },
                    label = { Text("Score") },
                    placeholder = { Text("e.g. 18") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier =
                        Modifier
                            .weight(1f)
                            .onFocusChanged {
                                if (it.isFocused) {
                                    coroutineScope.launch { bringIntoViewRequester.bringIntoView() }
                                }
                            },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = maxInput,
                    onValueChange = {
                        maxInput = it
                        gradeSaveResult = null
                    },
                    label = { Text("Max") },
                    placeholder = { Text("e.g. 20") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier =
                        Modifier
                            .weight(1f)
                            .onFocusChanged {
                                if (it.isFocused) {
                                    coroutineScope.launch { bringIntoViewRequester.bringIntoView() }
                                }
                            },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = weightInput,
                    onValueChange = {
                        weightInput = it
                        gradeSaveResult = null
                    },
                    label = { Text("Weight %") },
                    placeholder = { Text("e.g. 15") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier =
                        Modifier
                            .weight(1f)
                            .onFocusChanged {
                                if (it.isFocused) {
                                    coroutineScope.launch { bringIntoViewRequester.bringIntoView() }
                                }
                            },
                    singleLine = true,
                )
            }

            gradeError?.let { errText ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = errText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            // A write that failed says so, in the same error language as the
            // validation messages above - never a silent no-op.
            val failedSave = gradeSaveResult as? GradeSaveResult.Failed
            if (failedSave != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Grade not saved: ${failedSave.message}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
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
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Save,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text =
                        when {
                            isSavingGrade -> "Saving…"
                            gradeSaveResult is GradeSaveResult.Saved -> "Grade Saved!"
                            else -> "Save Grade Record"
                        },
                    style = MaterialTheme.typography.labelMedium,
                )
            }

            // The equal-weight what-if projector was removed (audit A15): the
            // honest weighted target / remaining-average workflow now lives in
            // the Grade Center, driven by the shared core's
            // `calculateGradeTarget` — the shell renders no local grade math.

            // Action Buttons: Share .ics / Calendar / Practice Quiz / Focus Timer
            Spacer(modifier = Modifier.height(24.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilledTonalButton(
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
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Share,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Export .ics",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }

                FilledTonalButton(
                    onClick = {
                        calendarError = null
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
                            calendarError =
                                "No calendar app on this device could open the event."
                        }
                    },
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Event,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Calendar",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }

            calendarError?.let { errText ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = errText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilledTonalButton(
                    onClick = onOpenPractice,
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Quiz,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Practice Quiz",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }

                FilledTonalButton(
                    onClick = { onOpenPomodoro(assessment.topics.firstOrNull()) },
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Timer,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Focus Timer",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
