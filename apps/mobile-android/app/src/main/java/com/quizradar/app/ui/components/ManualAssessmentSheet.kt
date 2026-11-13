package com.quizradar.app.ui.components

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.CourseModel
import com.quizradar.app.ui.QuizRadarViewModel.AssessmentSaveResult
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.destructivePill
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.quietTextFieldColors
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/** The six rungs of the assessment-type ladder (`01` §3; `core/src/types.rs`). */
private val ASSESSMENT_TYPES = listOf("Class Quiz", "Online Quiz", "Midterm Exam", "Final Exam", "Lab Assessment", "Assignment")

/**
 * Manual assessment entry (audit A08): a teacher said "quiz next week" and
 * no announcement will ever carry it - the student types it in themselves.
 *
 * Honesty rules (AGENTS.md §3.1): the item is created with source "Custom"
 * and NO room, instructor or grade numbers are invented - fields the student
 * leaves blank stay blank. The sheet closes ONLY on a confirmed core save
 * ([AssessmentSaveResult.Saved]); a failed write keeps every field on
 * screen with the real error inline, so the draft is never thrown away.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ManualAssessmentSheet(
    courses: List<CourseModel>,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onSave: (assessmentJson: String, onResult: (AssessmentSaveResult) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()

    // Drafts survive process death / recreation (brief global rules):
    // every field is a saveable String, never a non-saveable data class.
    var title by rememberSaveable { mutableStateOf("") }
    var assessmentType by rememberSaveable { mutableStateOf("Class Quiz") }
    var courseId by rememberSaveable { mutableStateOf("") }
    var dateIso by rememberSaveable { mutableStateOf("") }
    var startTime by rememberSaveable { mutableStateOf("") }
    var endTime by rememberSaveable { mutableStateOf("") }
    var room by rememberSaveable { mutableStateOf("") }
    var instructor by rememberSaveable { mutableStateOf("") }

    var titleError by rememberSaveable { mutableStateOf<String?>(null) }
    var dateError by rememberSaveable { mutableStateOf<String?>(null) }
    var timeError by rememberSaveable { mutableStateOf<String?>(null) }
    var saveError by rememberSaveable { mutableStateOf<String?>(null) }
    var isSaving by rememberSaveable { mutableStateOf(false) }
    var showDiscardConfirm by rememberSaveable { mutableStateOf(false) }

    val hasEdits =
        title.isNotBlank() || courseId.isNotBlank() || dateIso.isNotBlank() ||
            startTime.isNotBlank() || endTime.isNotBlank() || room.isNotBlank() || instructor.isNotBlank() ||
            assessmentType != "Class Quiz"

    fun parseTime(raw: String): LocalTime? =
        if (raw.isBlank()) {
            null
        } else {
            try {
                LocalTime.parse(raw.trim(), DateTimeFormatter.ofPattern("HH:mm"))
            } catch (_: DateTimeParseException) {
                null
            }
        }

    ModalBottomSheet(
        onDismissRequest = {
            // Scrim-tap / back on a touched form asks before discarding -
            // a stray swipe must never wipe the student's typing.
            if (hasEdits) {
                showDiscardConfirm = true
            } else {
                onDismiss()
            }
        },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = modifier.padding(top = statusBarPadding),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .padding(horizontal = 20.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "New assessment",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Add a quiz, exam or assignment yourself. Blank fields stay blank — QuizRadar never invents rooms, times or grades.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(16.dp))

            OutlinedTextField(
                value = title,
                onValueChange = {
                    title = it
                    titleError = null
                },
                label = { Text("Title") },
                placeholder = { Text("e.g. Class Quiz 1") },
                isError = titleError != null,
                supportingText = titleError?.let { { Text(it, color = MaterialTheme.colorScheme.error) } },
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Type",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                ASSESSMENT_TYPES.forEach { type ->
                    // FilterChip + leading check: TalkBack announces
                    // "selected" and selection is never colour alone.
                    FilterChip(
                        selected = assessmentType == type,
                        onClick = { assessmentType = type },
                        label = {
                            Text(
                                text = type,
                                style = MaterialTheme.typography.labelMedium,
                            )
                        },
                        leadingIcon = { if (assessmentType == type) ChipLeadingCheck() },
                        colors = FilterChipDefaults.quietChipColors(),
                        modifier =
                            Modifier
                                .defaultMinSize(minHeight = 48.dp)
                                .selectable(
                                    selected = assessmentType == type,
                                    role = Role.RadioButton,
                                    onClick = { assessmentType = type },
                                ),
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Course",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                FilterChip(
                    selected = courseId.isBlank(),
                    onClick = { courseId = "" },
                    label = {
                        Text(
                            text = "General",
                            style = MaterialTheme.typography.labelMedium,
                        )
                    },
                    leadingIcon = { if (courseId.isBlank()) ChipLeadingCheck() },
                    colors = FilterChipDefaults.quietChipColors(),
                    modifier =
                        Modifier
                            .defaultMinSize(minHeight = 48.dp)
                            .selectable(
                                selected = courseId.isBlank(),
                                role = Role.RadioButton,
                                onClick = { courseId = "" },
                            ),
                )
                courses.forEach { course ->
                    FilterChip(
                        selected = courseId == course.id,
                        onClick = { courseId = course.id },
                        label = {
                            Text(
                                text = course.name,
                                style = MaterialTheme.typography.labelMedium,
                            )
                        },
                        leadingIcon = { if (courseId == course.id) ChipLeadingCheck() },
                        colors = FilterChipDefaults.quietChipColors(),
                        modifier =
                            Modifier
                                .defaultMinSize(minHeight = 48.dp)
                                .selectable(
                                    selected = courseId == course.id,
                                    role = Role.RadioButton,
                                    onClick = { courseId = course.id },
                                ),
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            OutlinedTextField(
                value = dateIso,
                onValueChange = {
                    dateIso = it
                    dateError = null
                },
                label = { Text("Date (YYYY-MM-DD)") },
                placeholder = { Text(LocalDate.now().toString()) },
                isError = dateError != null,
                supportingText = dateError?.let { { Text(it, color = MaterialTheme.colorScheme.error) } },
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                textStyle =
                    MaterialTheme.typography.bodyMedium.copy(
                        fontFeatureSettings = "tnum",
                    ),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = startTime,
                    onValueChange = {
                        startTime = it
                        timeError = null
                    },
                    label = { Text("Start (HH:mm, optional)") },
                    isError = timeError != null,
                    singleLine = true,
                    keyboardOptions =
                        androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = endTime,
                    onValueChange = {
                        endTime = it
                        timeError = null
                    },
                    label = { Text("End (HH:mm, optional)") },
                    isError = timeError != null,
                    singleLine = true,
                    keyboardOptions =
                        androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    textStyle =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    modifier = Modifier.weight(1f),
                )
            }
            if (timeError != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = timeError.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = room,
                onValueChange = { room = it },
                label = { Text("Room (optional)") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = instructor,
                onValueChange = { instructor = it },
                label = { Text("Instructor (optional)") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            if (saveError != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "QuizRadar could not save the assessment: ${saveError.orEmpty()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            // Primary action stays above the keyboard (imePadding on the
            // scroll column) and is disabled while the core write runs.
            Button(
                onClick = {
                    // Inline, specific validation before the core ever sees it.
                    when {
                        title.isBlank() -> {
                            titleError = "Enter a title, e.g. \"Class Quiz 1\"."
                            saveError = null
                        }
                        dateIso.isBlank() -> {
                            dateError = "Enter the date the assessment will happen (YYYY-MM-DD)."
                            saveError = null
                        }
                        dateIso.trim().runCatching { LocalDate.parse(trim()) }.isFailure -> {
                            dateError = "That is not a valid date — use YYYY-MM-DD, e.g. ${LocalDate.now()}."
                            saveError = null
                        }
                        parseTime(startTime) == null && startTime.isNotBlank() -> {
                            timeError = "Use 24-hour HH:mm for the start time, e.g. 09:30."
                            saveError = null
                        }
                        parseTime(endTime) == null && endTime.isNotBlank() -> {
                            timeError = "Use 24-hour HH:mm for the end time, e.g. 10:30."
                            saveError = null
                        }
                        else -> {
                            isSaving = true
                            saveError = null
                            val course = courses.firstOrNull { it.id == courseId }
                            val json =
                                JSONObject().apply {
                                    put("id", "custom-${System.currentTimeMillis()}")
                                    put("title", title.trim())
                                    if (course != null) {
                                        put("course_id", course.id)
                                        put("course_name", course.name)
                                    }
                                    put("assessment_type", assessmentType)
                                    put("date_iso", dateIso.trim())
                                    parseTime(startTime)?.let { put("start_time", it.toString()) }
                                    parseTime(endTime)?.let { put("end_time", it.toString()) }
                                    if (room.isNotBlank()) put("room", room.trim())
                                    if (instructor.isNotBlank()) put("instructor", instructor.trim())
                                    put("is_upcoming", true)
                                    // A user-typed item is honestly "Custom",
                                    // never dressed up as a Gmail/Teams find.
                                    put("source", "Custom")
                                }
                            onSave(json.toString()) { result ->
                                isSaving = false
                                when (result) {
                                    is AssessmentSaveResult.Saved -> onDismiss()
                                    is AssessmentSaveResult.Failed -> saveError = result.message
                                }
                            }
                        }
                    }
                },
                enabled = !isSaving,
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp)
                        .navigationBarsPadding()
                        .padding(bottom = 16.dp)
                        .defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text(
                    text = if (isSaving) "Saving…" else "Save assessment",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }

    if (showDiscardConfirm) {
        AlertDialog(
            onDismissRequest = { showDiscardConfirm = false },
            title = { Text("Discard this assessment?") },
            text = { Text("Your unsaved changes will be lost.") },
            confirmButton = {
                // Discarding typed content is genuinely destructive - the same
                // destructivePill confirm the course editor's delete dialog uses.
                Button(
                    onClick = {
                        showDiscardConfirm = false
                        onDismiss()
                    },
                    colors = ButtonDefaults.destructivePill(),
                ) {
                    Text(
                        text = "Discard",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showDiscardConfirm = false }) {
                    Text(
                        text = "Keep editing",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            },
        )
    }
}
