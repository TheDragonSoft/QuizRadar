package com.quizradar.app.ui.detail

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.CoursePalette

private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val SLOT_TYPES = listOf("Lecture", "Tutorial", "Lab")

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
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (isEditMode) "Edit Course & Slots" else "Add New Course",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                IconButton(onClick = onDismiss) {
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
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Course Name (e.g. Data Structures)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = instructor,
                onValueChange = { instructor = it },
                label = { Text("Instructor Name (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(18.dp))

            // Color Presets
            Text(
                text = "Course Color",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                CoursePalette.HEX_PRESETS.forEach { hex ->
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
                                .size(36.dp)
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
                                .clickable { selectedColor = hex },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isSelected) {
                            Icon(
                                imageVector = Icons.Outlined.Check,
                                contentDescription = "Selected",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(modifier = Modifier.height(16.dp))

            // Weekly Timetable Slots Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = "Weekly Recurring Slots",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
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

            Spacer(modifier = Modifier.height(10.dp))

            // Slot list
            if (slots.isEmpty() && !isAddingSlot) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "No recurring slots added yet. Tap + to add weekly lecture or lab times.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(14.dp),
                    )
                }
            } else {
                slots.forEachIndexed { index, slot ->
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                    modifier = Modifier.padding(end = 10.dp),
                                ) {
                                    Text(
                                        text = slot.day,
                                        style = MaterialTheme.typography.labelMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    )
                                }
                                Column {
                                    Text(
                                        text = "${slot.type} · ${slot.startTime}–${slot.endTime}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    val meta = listOfNotNull(slot.room?.takeIf { it != "—" }, slot.group).joinToString(" · ")
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

            // Inline New Slot Card
            if (isAddingSlot) {
                Spacer(modifier = Modifier.height(10.dp))
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text(
                            text = "New Class Slot",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        Spacer(modifier = Modifier.height(8.dp))

                        // Day chips
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            items(DAYS) { day ->
                                FilterChip(
                                    selected = slotDay == day,
                                    onClick = { slotDay = day },
                                    label = { Text(day, fontSize = 11.sp) },
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(6.dp))

                        // Type chips
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            SLOT_TYPES.forEach { type ->
                                FilterChip(
                                    selected = slotType == type,
                                    onClick = { slotType = type },
                                    label = { Text(type, fontSize = 11.sp) },
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Start & End Time
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            OutlinedTextField(
                                value = slotStartTime,
                                onValueChange = { slotStartTime = it },
                                label = { Text("Start (HH:MM)") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = slotEndTime,
                                onValueChange = { slotEndTime = it },
                                label = { Text("End (HH:MM)") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Room & Group
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            OutlinedTextField(
                                value = slotRoom,
                                onValueChange = { slotRoom = it },
                                label = { Text("Room (optional)") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = slotGroup,
                                onValueChange = { slotGroup = it },
                                label = { Text("Section/Group") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            TextButton(onClick = { isAddingSlot = false }) {
                                Text("Cancel")
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Button(
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
                            ) {
                                Text("Add Slot")
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
                    OutlinedButton(
                        onClick = { showDeleteConfirm = true },
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Text("Delete Course")
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
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(if (isEditMode) "Save Changes" else "Create Course")
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
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}
