package com.quizradar.app.ui.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.destructivePill
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill

private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val SLOT_TYPES = listOf("Lecture", "Tutorial", "Lab")

// TalkBack names for CoursePalette.HEX_PRESETS (same order, CoursePalette.kt
// header) - a colour swatch must not be selectable by colour alone.
private val COLOR_PRESET_NAMES = listOf("Blue", "Emerald", "Amber", "Red", "Purple", "Cyan", "Coral", "Indigo")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourseEditorSheet(
    course: CourseModel?,
    initialSlots: List<ScheduleSlotModel>,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onSave: (CourseModel, List<ScheduleSlotModel>) -> Unit,
    onDelete: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val isEditMode = course != null

    var code by rememberSaveable { mutableStateOf(course?.id ?: "") }
    var name by rememberSaveable { mutableStateOf(course?.name ?: "") }
    var selectedColor by rememberSaveable { mutableStateOf(course?.color ?: CoursePalette.HEX_PRESETS.first()) }
    var instructor by rememberSaveable { mutableStateOf(initialSlots.firstOrNull()?.instructor ?: "") }

    val slots = remember { mutableStateListOf<ScheduleSlotModel>().apply { addAll(initialSlots) } }
    var isAddingSlot by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    // Draft slot state
    var slotDay by rememberSaveable { mutableStateOf("Mon") }
    var slotType by rememberSaveable { mutableStateOf("Lecture") }
    var slotStartTime by rememberSaveable { mutableStateOf("09:00") }
    var slotEndTime by rememberSaveable { mutableStateOf("10:30") }
    var slotRoom by rememberSaveable { mutableStateOf("") }
    var slotGroup by rememberSaveable { mutableStateOf("") }

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
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = if (isEditMode) "Edit Course & Slots" else "Add New Course",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                // 48dp minimum touch target (Material a11y guideline).
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Close course editor",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Course Code & Name
            OutlinedTextField(
                value = code,
                onValueChange = { if (!isEditMode) code = it.uppercase() },
                label = { Text("Course Code (e.g. CSE241)") },
                singleLine = true,
                readOnly = isEditMode,
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Course Name (e.g. Data Structures)") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = instructor,
                onValueChange = { instructor = it },
                label = { Text("Instructor Name (optional)") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Color Presets
            Text(
                text = "Course color",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(12.dp))
            // 48dp swatches with 8dp gaps (Material touch-target rule); eight of
            // them no longer fit side by side on a phone, so the row scrolls.
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CoursePalette.HEX_PRESETS.forEachIndexed { index, hex ->
                    val colorInt =
                        try {
                            android.graphics.Color.parseColor(hex)
                        } catch (_: Exception) {
                            0xFF1A73E8.toInt()
                        }
                    val isSelected = selectedColor.equals(hex, ignoreCase = true)
                    Box(
                        modifier =
                            Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .background(Color(colorInt))
                                .border(
                                    width = if (isSelected) 3.dp else 1.dp,
                                    color =
                                        if (isSelected) {
                                            MaterialTheme.colorScheme.onSurface
                                        } else {
                                            Color.Transparent
                                        },
                                    shape = CircleShape,
                                )
                                .semantics {
                                    contentDescription =
                                        "Course color ${COLOR_PRESET_NAMES.getOrElse(index) { hex }}"
                                }
                                .clickable { selectedColor = hex },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isSelected) {
                            Icon(
                                imageVector = Icons.Outlined.Check,
                                contentDescription = "Selected",
                                tint = Color.White,
                                modifier = Modifier.size(24.dp),
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(modifier = Modifier.height(24.dp))

            // Weekly Timetable Slots Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Weekly Recurring Slots",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Cross-referenced to pin fuzzy announcements to real dates",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!isAddingSlot) {
                    IconButton(onClick = { isAddingSlot = true }) {
                        Icon(
                            imageVector = Icons.Outlined.Add,
                            contentDescription = "Add weekly slot",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Slot list
            if (slots.isEmpty() && !isAddingSlot) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors(),
                    elevation = CardDefaults.quietCardElevation(),
                    border = CardDefaults.quietCardBorder(),
                ) {
                    Text(
                        text = "No recurring slots added yet. Tap + to add weekly lecture or lab times.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    slots.forEachIndexed { index, slot ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                            colors = CardDefaults.quietCardColors(),
                            elevation = CardDefaults.quietCardElevation(),
                            border = CardDefaults.quietCardBorder(),
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(
                                    modifier = Modifier.weight(1f),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = slot.day,
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier =
                                            Modifier
                                                .clip(MaterialTheme.shapes.small)
                                                .background(MaterialTheme.colorScheme.primaryContainer)
                                                .padding(horizontal = 8.dp, vertical = 4.dp),
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column {
                                        Text(
                                            text = "${slot.type} · ${slot.startTime}–${slot.endTime}",
                                            style =
                                                MaterialTheme.typography.bodyMedium.copy(
                                                    fontWeight = FontWeight.SemiBold,
                                                    fontFeatureSettings = "tnum",
                                                ),
                                            color = MaterialTheme.colorScheme.onSurface,
                                        )
                                        val meta =
                                            listOfNotNull(slot.room?.takeIf { it != "—" }, slot.group)
                                                .joinToString(" · ")
                                        if (meta.isNotEmpty()) {
                                            Text(
                                                text = meta,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                                IconButton(onClick = { slots.removeAt(index) }) {
                                    Icon(
                                        imageVector = Icons.Outlined.Delete,
                                        contentDescription = "Delete slot",
                                        tint = MaterialTheme.colorScheme.error,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Inline New Slot Card
            if (isAddingSlot) {
                Spacer(modifier = Modifier.height(12.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors(),
                    elevation = CardDefaults.quietCardElevation(),
                    border = CardDefaults.quietCardBorder(),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "New Class Slot",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(12.dp))

                        // Day chips
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            items(DAYS) { day ->
                                FilterChip(
                                    selected = slotDay == day,
                                    onClick = { slotDay = day },
                                    label = {
                                        Text(
                                            text = day,
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                    },
                                    leadingIcon = { if (slotDay == day) ChipLeadingCheck() },
                                    colors = FilterChipDefaults.quietChipColors(),
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Type chips
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            SLOT_TYPES.forEach { type ->
                                FilterChip(
                                    selected = slotType == type,
                                    onClick = { slotType = type },
                                    label = {
                                        Text(
                                            text = type,
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                    },
                                    leadingIcon = { if (slotType == type) ChipLeadingCheck() },
                                    colors = FilterChipDefaults.quietChipColors(),
                                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Start & End Time
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            OutlinedTextField(
                                value = slotStartTime,
                                onValueChange = { slotStartTime = it },
                                label = { Text("Start (HH:MM)") },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                                textStyle =
                                    MaterialTheme.typography.bodyMedium.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = slotEndTime,
                                onValueChange = { slotEndTime = it },
                                label = { Text("End (HH:MM)") },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                                textStyle =
                                    MaterialTheme.typography.bodyMedium.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        // Room & Group
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            OutlinedTextField(
                                value = slotRoom,
                                onValueChange = { slotRoom = it },
                                label = { Text("Room (optional)") },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = slotGroup,
                                onValueChange = { slotGroup = it },
                                label = { Text("Section/Group") },
                                singleLine = true,
                                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(onClick = { isAddingSlot = false }) {
                                Text(
                                    text = "Cancel",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            FilledTonalButton(
                                onClick = {
                                    val newSlot =
                                        ScheduleSlotModel(
                                            id = "slot-${System.currentTimeMillis()}",
                                            day = slotDay,
                                            courseId = code.trim().uppercase(),
                                            courseName = name.trim(),
                                            type = slotType,
                                            startTime = slotStartTime.trim(),
                                            endTime = slotEndTime.trim(),
                                            displayTime = "${slotStartTime.trim()}–${slotEndTime.trim()}",
                                            room = slotRoom.trim().ifEmpty { null },
                                            instructor = instructor.trim().ifEmpty { null },
                                            group = slotGroup.trim().ifEmpty { null },
                                        )
                                    slots.add(newSlot)
                                    isAddingSlot = false
                                },
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text(
                                    text = "Add Slot",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Action Buttons: Save & (Delete)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (isEditMode && onDelete != null) {
                    Button(
                        onClick = { showDeleteConfirm = true },
                        colors = ButtonDefaults.destructivePill(),
                        contentPadding = PillButtonContentPadding,
                        modifier =
                            Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text(
                            text = "Delete Course",
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }

                Button(
                    onClick = {
                        val updatedCourse =
                            CourseModel(
                                id = code.trim().uppercase(),
                                name = name.trim(),
                                color = selectedColor,
                            )
                        onSave(updatedCourse, slots.toList())
                        onDismiss()
                    },
                    enabled = code.isNotBlank() && name.isNotBlank(),
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = if (isEditMode) "Save Changes" else "Create Course",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            icon = {
                Icon(
                    imageVector = Icons.Outlined.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
            title = { Text("Delete ${course?.id}?") },
            text = {
                Text("This removes the course and all of its weekly recurring class slots. Associated assessments will remain.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteConfirm = false
                        course?.id?.let { onDelete?.invoke(it) }
                        onDismiss()
                    },
                    colors = ButtonDefaults.destructivePill(),
                ) {
                    Text(
                        text = "Delete",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text(
                        text = "Cancel",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            },
        )
    }
}
