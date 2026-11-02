package com.quizradar.app.ui.detail

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.share.SharedEventDraft
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateEventSheet(
    draft: SharedEventDraft?,
    onSave: (CustomEventModel) -> Unit,
    onDismiss: () -> Unit,
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
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "New Study or Custom Event",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "Saved locally on this device",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(44.dp)) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Close")
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("Event Title") },
                placeholder = { Text("e.g. Problem Set Review") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = courseId,
                onValueChange = { courseId = it },
                label = { Text("Course Code (optional)") },
                placeholder = { Text("e.g. CSE 341") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = dateText,
                onValueChange = {
                    dateText = it
                    dateError = false
                },
                label = { Text("Date (YYYY-MM-DD)") },
                isError = dateError,
                supportingText = {
                    if (dateError) {
                        Text("Use the YYYY-MM-DD format — the event was not saved.")
                    }
                },
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
                    label = { Text("Start Time") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = endTime,
                    onValueChange = { endTime = it },
                    label = { Text("End Time") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text("Notes / Shared Text") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 6,
            )

            Spacer(modifier = Modifier.height(20.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = 46.dp),
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                ) {
                    Text("Cancel", fontWeight = FontWeight.SemiBold)
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
                        val event =
                            CustomEventModel(
                                id = "custom-${System.currentTimeMillis()}",
                                title = title.trim().ifEmpty { "Custom Event" },
                                courseId = courseId.trim().ifEmpty { null },
                                eventType = "Custom",
                                dateIso = parsedDate,
                                startTime = startTime.trim().ifEmpty { null },
                                endTime = endTime.trim().ifEmpty { null },
                                room = null,
                                notes = notes.trim().ifEmpty { null },
                                color = "#db2777",
                            )
                        onSave(event)
                    },
                    modifier = Modifier.weight(1f).defaultMinSize(minHeight = 46.dp),
                    shape = RoundedCornerShape(10.dp),
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                ) {
                    Text("Save Event", fontWeight = FontWeight.Bold)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
