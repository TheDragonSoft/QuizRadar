package com.quizradar.app.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.share.SharedEventDraft
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CreateEventSheet(
    draft: SharedEventDraft?,
    onSave: (CustomEventModel) -> Unit,
    onDismiss: () -> Unit,
    courses: List<CourseModel> = emptyList(),
) {
    if (draft == null) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var title by remember(draft) { mutableStateOf(draft.title) }
    var courseId by remember(draft) { mutableStateOf(draft.courseId ?: "") }
    var dateText by remember(draft) {
        mutableStateOf(draft.dateIso?.toString() ?: LocalDate.now().toString())
    }
    var startTime by remember(draft) { mutableStateOf(draft.startTime ?: "09:00") }
    var endTime by remember(draft) { mutableStateOf(draft.endTime ?: "10:00") }
    var notes by remember(draft) { mutableStateOf(draft.notes) }
    var dateError by remember(draft) { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }
    var activeTimePickerTarget by remember { mutableStateOf<String?>(null) }

    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = Modifier.padding(top = statusBarPadding),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "New Study or Custom Event",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Saved locally on this device",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // 48dp minimum touch target (Material a11y guideline).
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Close")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Event Title") },
                placeholder = { Text("e.g. Problem Set Review") },
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Spacer(modifier = Modifier.height(12.dp))

            if (courses.isNotEmpty()) {
                Text(
                    text = "Course (optional)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(8.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    FilterChip(
                        selected = courseId.isBlank(),
                        onClick = { courseId = "" },
                        label = { Text("General", style = MaterialTheme.typography.labelMedium) },
                        leadingIcon = { if (courseId.isBlank()) ChipLeadingCheck() },
                        colors = FilterChipDefaults.quietChipColors(),
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    )
                    courses.forEach { course ->
                        val isSelected = courseId.equals(course.id, ignoreCase = true)
                        val dotColor = CoursePalette.get(course.id, course.color).color
                        FilterChip(
                            selected = isSelected,
                            onClick = { courseId = course.id },
                            label = { Text(course.name, style = MaterialTheme.typography.labelMedium) },
                            leadingIcon = {
                                if (isSelected) {
                                    ChipLeadingCheck()
                                } else {
                                    Box(
                                        modifier =
                                            Modifier
                                                .size(8.dp)
                                                .clip(CircleShape)
                                                .background(dotColor),
                                    )
                                }
                            },
                            colors = FilterChipDefaults.quietChipColors(),
                            modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        )
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
            } else {
                OutlinedTextField(
                    value = courseId,
                    onValueChange = { courseId = it },
                    label = { Text("Course Code (optional)") },
                    placeholder = { Text("e.g. CSE 341") },
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            OutlinedTextField(
                value = dateText,
                onValueChange = {
                    dateText = it
                    dateError = false
                },
                label = { Text("Date (YYYY-MM-DD)") },
                trailingIcon = {
                    IconButton(
                        onClick = { showDatePicker = true },
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.CalendarToday,
                            contentDescription = "Pick date",
                        )
                    }
                },
                isError = dateError,
                supportingText = {
                    if (dateError) {
                        Text("Use the YYYY-MM-DD format — the event was not saved.")
                    }
                },
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                textStyle =
                    MaterialTheme.typography.bodyMedium.copy(
                        fontFeatureSettings = "tnum",
                    ),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = startTime,
                    onValueChange = { startTime = it },
                    label = { Text("Start Time", maxLines = 1) },
                    trailingIcon = {
                        IconButton(
                            onClick = { activeTimePickerTarget = "start" },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Timer,
                                contentDescription = "Pick start time",
                            )
                        }
                    },
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = endTime,
                    onValueChange = { endTime = it },
                    label = { Text("End Time", maxLines = 1) },
                    trailingIcon = {
                        IconButton(
                            onClick = { activeTimePickerTarget = "end" },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Timer,
                                contentDescription = "Pick end time",
                            )
                        }
                    },
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Notes") },
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 6,
            )

            Spacer(modifier = Modifier.height(24.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                FilledTonalButton(
                    onClick = onDismiss,
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = "Cancel",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }

                Button(
                    onClick = {
                        // A parse failure used to silently save the event as
                        // TODAY — a fabricated date. Show an inline error and
                        // block the save instead.
                        val parsedDate =
                            try {
                                LocalDate.parse(dateText.trim())
                            } catch (_: Exception) {
                                dateError = true
                                null
                            } ?: return@Button
                        val trimmedCourseId = courseId.trim().ifEmpty { null }
                        val matchedCourse =
                            trimmedCourseId?.let { cid ->
                                courses.firstOrNull {
                                    it.id.equals(cid, ignoreCase = true) ||
                                        it.name.equals(cid, ignoreCase = true)
                                }
                            }
                        val resolvedCourseId = matchedCourse?.id ?: trimmedCourseId
                        val resolvedColor =
                            if (resolvedCourseId != null) {
                                CoursePalette.getHex(resolvedCourseId, matchedCourse?.color)
                            } else {
                                "#db2777"
                            }
                        val event =
                            CustomEventModel(
                                id = "custom-${System.currentTimeMillis()}",
                                title = title.trim().ifEmpty { "Custom Event" },
                                courseId = resolvedCourseId,
                                eventType = "Custom",
                                dateIso = parsedDate,
                                startTime = startTime.trim().ifEmpty { null },
                                endTime = endTime.trim().ifEmpty { null },
                                room = null,
                                notes = notes.trim().ifEmpty { null },
                                color = resolvedColor,
                            )
                        onSave(event)
                    },
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = "Save Event",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }

    if (showDatePicker) {
        val initialMillis =
            runCatching {
                LocalDate.parse(dateText.trim()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            }.getOrNull()
        val datePickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        datePickerState.selectedDateMillis?.let { millis ->
                            dateText =
                                Instant
                                    .ofEpochMilli(millis)
                                    .atZone(ZoneOffset.UTC)
                                    .toLocalDate()
                                    .toString()
                            dateError = false
                        }
                        showDatePicker = false
                    },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Set date", style = MaterialTheme.typography.labelLarge)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDatePicker = false },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel", style = MaterialTheme.typography.labelLarge)
                }
            },
        ) {
            DatePicker(state = datePickerState)
        }
    }

    activeTimePickerTarget?.let { target ->
        val rawTime = if (target == "start") startTime else endTime
        val parsed =
            runCatching {
                LocalTime.parse(rawTime.trim(), DateTimeFormatter.ofPattern("HH:mm"))
            }.getOrDefault(LocalTime.of(9, 0))
        val timePickerState =
            rememberTimePickerState(
                initialHour = parsed.hour,
                initialMinute = parsed.minute,
                is24Hour = true,
            )
        AlertDialog(
            onDismissRequest = { activeTimePickerTarget = null },
            title = { Text(if (target == "start") "Start time" else "End time") },
            text = { TimePicker(state = timePickerState) },
            confirmButton = {
                Button(
                    onClick = {
                        val formatted =
                            String.format(Locale.US, "%02d:%02d", timePickerState.hour, timePickerState.minute)
                        if (target == "start") startTime = formatted else endTime = formatted
                        activeTimePickerTarget = null
                    },
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Save", style = MaterialTheme.typography.labelLarge)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { activeTimePickerTarget = null },
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Cancel", style = MaterialTheme.typography.labelLarge)
                }
            },
        )
    }
}
