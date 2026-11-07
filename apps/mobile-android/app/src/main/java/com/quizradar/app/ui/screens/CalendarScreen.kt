package com.quizradar.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.calendar.CalendarLaneItem
import com.quizradar.app.ui.calendar.CalendarLanes
import com.quizradar.app.ui.calendar.END_HOUR
import com.quizradar.app.ui.calendar.HOUR_HEIGHT_DP
import com.quizradar.app.ui.calendar.START_HOUR
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.CustomEventPink
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private data class CalendarUiBlock(
    override val id: String,
    override val topPx: Int,
    override val heightPx: Int,
    override var laneIndex: Int = 0,
    override var laneCount: Int = 1,
    val kind: BlockKind,
    val title: String,
    val courseId: String?,
    val displayTime: String,
    val room: String?,
    val assessmentId: String?,
) : CalendarLaneItem

private enum class BlockKind {
    MERGED_EXAM,
    CLASS_SLOT,
    STANDALONE_EXAM,
    CUSTOM_EVENT,
}

/**
 * Merge rule for the week grid: a class slot and an exam are the SAME block
 * only when they share the course AND the start time (web parity -
 * `apps/web/src/views/CalendarView.tsx`).
 *
 * Merging on the course alone deleted every class of that course on that
 * day: a 09:00 lecture and a 16:00 exam are two different blocks, and the
 * lecture must still render.
 */
fun shouldMergeExamWithSlot(
    examCourseId: String?,
    examStartTime: String?,
    slotCourseId: String?,
    slotStartTime: String?,
): Boolean {
    val examCourse = examCourseId?.trim().orEmpty()
    val slotCourse = slotCourseId?.trim().orEmpty()
    if (examCourse.isEmpty() || slotCourse.isEmpty()) return false
    if (!examCourse.equals(slotCourse, ignoreCase = true)) return false

    val examStart = examStartTime?.trim().orEmpty()
    val slotStart = slotStartTime?.trim().orEmpty()
    // No known time on either side: there is nothing proving they are the
    // same block, so both stay separate (never guess a merge).
    if (examStart.isEmpty() || slotStart.isEmpty()) return false
    return normalizeClockTime(examStart) == normalizeClockTime(slotStart)
}

/** "09:00" and "9:00" are the same clock time; anything else stays as-is. */
private fun normalizeClockTime(value: String): String {
    val parts = value.split(":")
    val hours = parts.getOrNull(0)?.trim()?.toIntOrNull()
    if (hours == null) return value.trim()
    val minutes = parts.getOrNull(1)?.trim()?.toIntOrNull() ?: 0
    return "%02d:%02d".format(hours, minutes)
}

/**
 * Honest time label for a custom calendar event: the real clock range when
 * the event has one, the em dash when it has none. The old label printed an
 * empty "–" pair for a time-less event, which read like broken data.
 */
fun formatCustomEventTime(
    startTime: String?,
    endTime: String?,
): String {
    val start = startTime?.trim()?.takeIf { it.isNotEmpty() }
    val end = endTime?.trim()?.takeIf { it.isNotEmpty() }
    return when {
        start != null && end != null -> "$start–$end"
        start != null -> start
        end != null -> "Until $end"
        else -> "—"
    }
}

@Composable
fun CalendarScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val currentWeekStart by viewModel.currentWeekStart.collectAsState()
    val selectedDate by viewModel.selectedCalendarDate.collectAsState()
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    var isAgendaMode by remember { mutableStateOf(false) }

    val weekDates =
        remember(currentWeekStart) {
            (0..6).map { currentWeekStart.plusDays(it.toLong()) }
        }

    val headerFormatter = remember { DateTimeFormatter.ofPattern("MMM d") }
    val headerRange =
        "${weekDates.first().format(headerFormatter)} – " +
            "${weekDates.last().format(headerFormatter)}, ${weekDates.last().year}"

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val isNarrow = maxWidth < 600.dp
        val dayCount = if (isNarrow) 3 else 7

        val dayOffset =
            if (isNarrow) {
                val selectedIdx = weekDates.indexOf(selectedDate).coerceAtLeast(0)
                selectedIdx.coerceIn(0, 7 - dayCount)
            } else {
                0
            }

        val displayedDates = weekDates.subList(dayOffset, dayOffset + dayCount)

        var totalDragX by remember { mutableFloatStateOf(0f) }
        val swipeModifier =
            if (isNarrow) {
                Modifier.pointerInput(selectedDate, currentWeekStart) {
                    detectHorizontalDragGestures(
                        onDragStart = { totalDragX = 0f },
                        onDragEnd = {
                            if (totalDragX < -50f) {
                                // Swiped left -> advance forward
                                val nextDate = selectedDate.plusDays(1)
                                viewModel.setSelectedCalendarDate(nextDate)
                                if (nextDate.isAfter(weekDates.last())) {
                                    viewModel.shiftWeek(1)
                                }
                            } else if (totalDragX > 50f) {
                                // Swiped right -> go back
                                val prevDate = selectedDate.minusDays(1)
                                viewModel.setSelectedCalendarDate(prevDate)
                                if (prevDate.isBefore(weekDates.first())) {
                                    viewModel.shiftWeek(-1)
                                }
                            }
                        },
                        onHorizontalDrag = { _, dragAmount ->
                            totalDragX += dragAmount
                        },
                    )
                }
            } else {
                Modifier
            }

        Column(modifier = Modifier.fillMaxSize()) {
            // Header Controls: Week title + Jump Today + Shift Prev/Next
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
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
                                .size(34.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(MaterialTheme.colorScheme.secondaryContainer),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.CalendarMonth,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = headerRange,
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = snapshot.schedule.semester ?: "Semester Schedule",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = { viewModel.jumpToToday() },
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = ButtonDefaults.TextButtonContentPadding,
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.surface,
                                contentColor = MaterialTheme.colorScheme.onSurface,
                            ),
                        modifier =
                            Modifier
                                .defaultMinSize(minHeight = 38.dp)
                                .border(
                                    1.dp,
                                    MaterialTheme.colorScheme.outline,
                                    RoundedCornerShape(8.dp),
                                ),
                    ) {
                        Text(
                            text = "Today",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    Spacer(modifier = Modifier.width(2.dp))
                    IconButton(
                        onClick = { viewModel.shiftWeek(-1) },
                        // 48dp minimum touch target (Material a11y guideline);
                        // the arrow icon inside stays 18dp.
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Previous Week",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    IconButton(
                        onClick = { viewModel.shiftWeek(1) },
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = "Next Week",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    IconButton(
                        onClick = { isAgendaMode = !isAgendaMode },
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            imageVector = if (isAgendaMode) Icons.Outlined.CalendarMonth else Icons.Outlined.Checklist,
                            contentDescription = if (isAgendaMode) "Switch to Grid View" else "Switch to Agenda View",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            if (isAgendaMode) {
                CalendarAgendaView(
                    displayedDates = displayedDates,
                    snapshot = snapshot,
                    viewModel = viewModel,
                    modifier = Modifier.fillMaxSize().padding(bottom = 88.dp).then(swipeModifier),
                )
            } else {
                // Days Header Row
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surface)
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant)
                            .then(swipeModifier),
                ) {
                    Spacer(modifier = Modifier.width(48.dp))

                    displayedDates.forEach { date ->
                        val isSelected = date == selectedDate
                        val isToday = date == LocalDate.now()
                        val dayName = date.dayOfWeek.name.take(3)

                        Column(
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .clickable { viewModel.setSelectedCalendarDate(date) }
                                    .padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = dayName,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color =
                                    if (isSelected) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Box(
                                modifier =
                                    Modifier
                                        .size(28.dp)
                                        .clip(CircleShape)
                                        .background(
                                            if (isSelected) {
                                                MaterialTheme.colorScheme.primary
                                            } else {
                                                Color.Transparent
                                            },
                                        ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "${date.dayOfMonth}",
                                    style =
                                        TextStyle(
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            fontFeatureSettings = "tnum",
                                            color =
                                                if (isSelected) {
                                                    MaterialTheme.colorScheme.onPrimary
                                                } else {
                                                    MaterialTheme.colorScheme.onSurface
                                                },
                                        ),
                                )
                            }
                            if (isToday && !isSelected) {
                                Box(
                                    modifier =
                                        Modifier
                                            .size(4.dp)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.colorScheme.primary),
                                )
                            }
                        }
                    }
                }

                // Week Grid with vertical scroll
                val scrollState = rememberScrollState()
                val totalGridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT_DP

                Row(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .padding(bottom = 88.dp)
                            .verticalScroll(scrollState),
                ) {
                    // Time Gutter (08:00 to 21:00)
                    Column(
                        modifier =
                            Modifier
                                .width(48.dp)
                                .height(totalGridHeight.dp),
                    ) {
                        for (h in START_HOUR..END_HOUR) {
                            Box(
                                modifier =
                                    Modifier
                                        .height(HOUR_HEIGHT_DP.dp)
                                        .padding(start = 6.dp, top = 2.dp),
                            ) {
                                Text(
                                    text = String.format("%02d:00", h),
                                    style =
                                        TextStyle(
                                            fontSize = 11.sp,
                                            fontFeatureSettings = "tnum",
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        ),
                                )
                            }
                        }
                    }

                    // Grid Days Columns
                    Row(
                        modifier =
                            Modifier
                                .weight(1f)
                                .height(totalGridHeight.dp),
                    ) {
                        displayedDates.forEach { date ->
                            val dayName = date.dayOfWeek.name.take(3)

                            val daySlots =
                                snapshot.schedule.slots.filter {
                                    it.day.take(3).equals(dayName, ignoreCase = true)
                                }
                            val dayAssessments =
                                snapshot.assessments.filter {
                                    it.dateIso == date
                                }
                            val dayCustomEvents =
                                snapshot.customEvents.filter {
                                    it.dateIso == date
                                }

                            val rawBlocks = mutableListOf<CalendarUiBlock>()

                            // A slot and an exam are one block only when they
                            // share the course AND the start time; every other
                            // pair stays two blocks (no class is ever dropped).
                            val mergedSlotByExamId = mutableMapOf<String, ScheduleSlotModel>()
                            val mergedSlotIds = mutableSetOf<String>()
                            daySlots.forEach { s ->
                                val matchingExam =
                                    dayAssessments.firstOrNull { a ->
                                        // One exam absorbs one slot: a second slot
                                        // with the same course and start time keeps
                                        // its own block instead of vanishing.
                                        val alreadyMerged = mergedSlotByExamId.containsKey(a.id)
                                        !alreadyMerged && shouldMergeExamWithSlot(a.courseId, a.startTime, s.courseId, s.startTime)
                                    }
                                if (matchingExam != null) {
                                    mergedSlotByExamId[matchingExam.id] = s
                                    mergedSlotIds.add(s.id)
                                }
                            }

                            dayAssessments.forEach { a ->
                                val mergedSlot = mergedSlotByExamId[a.id]
                                // The merged block keeps the SLOT's clock range
                                // (web parity) so the class length is not lost.
                                val pos =
                                    CalendarLanes.computeBlockPosition(
                                        mergedSlot?.startTime ?: a.startTime,
                                        mergedSlot?.endTime ?: a.endTime,
                                    )
                                val kind =
                                    if (mergedSlot != null) {
                                        BlockKind.MERGED_EXAM
                                    } else {
                                        BlockKind.STANDALONE_EXAM
                                    }
                                rawBlocks.add(
                                    CalendarUiBlock(
                                        id = a.id,
                                        topPx = pos.topPx,
                                        heightPx = pos.heightPx,
                                        kind = kind,
                                        title = a.title,
                                        courseId = a.courseId,
                                        displayTime = a.displayTime ?: "All Day",
                                        room = mergedSlot?.room ?: a.room,
                                        assessmentId = a.id,
                                    ),
                                )
                            }

                            daySlots.forEach { s ->
                                if (s.id !in mergedSlotIds) {
                                    val pos = CalendarLanes.computeBlockPosition(s.startTime, s.endTime)
                                    rawBlocks.add(
                                        CalendarUiBlock(
                                            id = s.id,
                                            topPx = pos.topPx,
                                            heightPx = pos.heightPx,
                                            kind = BlockKind.CLASS_SLOT,
                                            title = listOfNotNull(s.courseName ?: s.courseId, s.type.ifBlank { null }).joinToString(" "),
                                            courseId = s.courseId,
                                            displayTime = s.displayTime ?: "${s.startTime}–${s.endTime}",
                                            room = s.room,
                                            assessmentId = null,
                                        ),
                                    )
                                }
                            }

                            dayCustomEvents.forEach { e ->
                                val pos = CalendarLanes.computeBlockPosition(e.startTime, e.endTime)
                                rawBlocks.add(
                                    CalendarUiBlock(
                                        id = e.id,
                                        topPx = pos.topPx,
                                        heightPx = pos.heightPx,
                                        kind = BlockKind.CUSTOM_EVENT,
                                        title = e.title,
                                        courseId = e.courseId,
                                        displayTime = formatCustomEventTime(e.startTime, e.endTime),
                                        room = e.room,
                                        assessmentId = null,
                                    ),
                                )
                            }

                            val laneItems = CalendarLanes.assignOverlapLanes(rawBlocks)

                            Box(
                                modifier =
                                    Modifier
                                        .weight(1f)
                                        .fillMaxHeight()
                                        .border(
                                            1.dp,
                                            MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f),
                                        ),
                            ) {
                                // Hour grid dividers with tap-to-create study block
                                for (h in 0 until (END_HOUR - START_HOUR + 1)) {
                                    val hourSlot = START_HOUR + h
                                    Box(
                                        modifier =
                                            Modifier
                                                .fillMaxWidth()
                                                .offset(y = (h * HOUR_HEIGHT_DP).dp)
                                                .height(HOUR_HEIGHT_DP.dp)
                                                // The grid is the screen: 14 slots per
                                                // day column, and every one of them is a
                                                // tap target. Without a name, a screen
                                                // reader announced a wall of
                                                // "button"s and the user could not
                                                // tell WHICH hour they were on.
                                                .semantics {
                                                    contentDescription =
                                                        "$dayName ${String.format("%02d:00", hourSlot)}, " +
                                                        "double tap to schedule a study block"
                                                }.clickable {
                                                    val startStr = String.format("%02d:00", hourSlot)
                                                    val endStr = String.format("%02d:00", (hourSlot + 1).coerceAtMost(23))
                                                    viewModel.openCreateEventDraft(
                                                        com.quizradar.app.ui.share.SharedEventDraft(
                                                            title = "Study Session",
                                                            notes = "Scheduled study slot $startStr–$endStr",
                                                            dateIso = date,
                                                            startTime = startStr,
                                                            endTime = endStr,
                                                        ),
                                                    )
                                                },
                                    ) {
                                        Box(
                                            modifier =
                                                Modifier
                                                    .fillMaxWidth()
                                                    .height(1.dp)
                                                    .background(MaterialTheme.colorScheme.outlineVariant),
                                        )
                                    }
                                }

                                // Current time "Now" indicator line (if column is today)
                                if (date == LocalDate.now()) {
                                    val now = java.time.LocalTime.now()
                                    val nowDecimal = now.hour + now.minute / 60f
                                    if (nowDecimal >= START_HOUR && nowDecimal <= END_HOUR + 1) {
                                        val nowTopPx = (nowDecimal - START_HOUR) * HOUR_HEIGHT_DP
                                        Box(
                                            modifier =
                                                Modifier
                                                    .fillMaxWidth()
                                                    .offset(y = nowTopPx.dp)
                                                    .height(2.dp)
                                                    .background(Color(0xFFEF4444)),
                                        ) {
                                            Box(
                                                modifier =
                                                    Modifier
                                                        .size(7.dp)
                                                        .offset(x = (-3.5).dp, y = (-2.5).dp)
                                                        .clip(CircleShape)
                                                        .background(Color(0xFFEF4444)),
                                            )
                                        }
                                    }
                                }

                                laneItems.forEach { block ->
                                    val palette = CoursePalette.get(block.courseId)
                                    val accessibleCourseText = CoursePalette.textOnSurface(block.courseId, isDark)
                                    val (bg, border, textClr) =
                                        when (block.kind) {
                                            BlockKind.MERGED_EXAM ->
                                                Triple(
                                                    Color(0xFFDC2626).copy(alpha = if (isDark) 0.22f else 0.14f),
                                                    Color(0xFFDC2626),
                                                    if (isDark) Color(0xFFFCA5A5) else Color(0xFFB91C1C),
                                                )
                                            BlockKind.STANDALONE_EXAM ->
                                                Triple(
                                                    palette.color.copy(alpha = if (isDark) 0.2f else 0.14f),
                                                    palette.color,
                                                    accessibleCourseText,
                                                )
                                            BlockKind.CLASS_SLOT ->
                                                Triple(
                                                    palette.color.copy(alpha = if (isDark) 0.12f else 0.08f),
                                                    palette.border,
                                                    accessibleCourseText,
                                                )
                                            BlockKind.CUSTOM_EVENT ->
                                                Triple(
                                                    CustomEventPink.copy(alpha = if (isDark) 0.2f else 0.12f),
                                                    CustomEventPink,
                                                    if (isDark) Color(0xFFF9A8D4) else Color(0xFF9D174D),
                                                )
                                        }

                                    val isExam =
                                        block.kind == BlockKind.MERGED_EXAM ||
                                            block.kind == BlockKind.STANDALONE_EXAM
                                    val borderWidth = if (isExam) 1.5.dp else 1.dp
                                    val titleMaxLines = if (block.heightPx >= 52) 2 else 1

                                    BoxWithConstraints(
                                        modifier =
                                            Modifier
                                                .fillMaxWidth()
                                                .offset(y = block.topPx.dp)
                                                .height(block.heightPx.dp),
                                    ) {
                                        val laneWidth = maxWidth / block.laneCount.coerceAtLeast(1)
                                        val xOffset = laneWidth * block.laneIndex

                                        Column(
                                            modifier =
                                                Modifier
                                                    .offset(x = xOffset)
                                                    .width(laneWidth)
                                                    .fillMaxHeight()
                                                    .padding(1.5.dp)
                                                    .clip(RoundedCornerShape(6.dp))
                                                    .background(bg)
                                                    .border(
                                                        borderWidth,
                                                        border,
                                                        RoundedCornerShape(6.dp),
                                                    )
                                                    .clickable {
                                                        if (block.assessmentId != null) {
                                                            viewModel.openAssessmentDetail(block.assessmentId)
                                                        }
                                                    }
                                                    .padding(horizontal = 5.dp, vertical = 4.dp),
                                        ) {
                                            Text(
                                                text = block.title,
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = textClr,
                                                maxLines = titleMaxLines,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            if (block.room != null && block.heightPx >= 42) {
                                                Text(
                                                    text = block.room,
                                                    fontSize = 11.sp,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CalendarAgendaView(
    displayedDates: List<LocalDate>,
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val attendanceMap by viewModel.attendanceMap.collectAsState()
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        displayedDates.forEach { date ->
            val isToday = date == LocalDate.now()
            val dayOfWeek = date.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }
            val headerText = date.format(DateTimeFormatter.ofPattern("EEEE, MMM d"))

            val daySlots =
                snapshot.schedule.slots.filter { it.day.equals(dayOfWeek, ignoreCase = true) }
                    .sortedBy { it.startTime }
            val dayAssessments =
                snapshot.assessments.filter { it.dateIso == date }
                    .sortedBy { it.startTime ?: "00:00" }
            val dayEvents = snapshot.customEvents.filter { it.dateIso == date }

            val totalCount = daySlots.size + dayAssessments.size + dayEvents.size

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors =
                    CardDefaults.cardColors(
                        containerColor =
                            if (isToday) {
                                if (isDark) Color(0xFF1E293B) else Color(0xFFF1F5F9)
                            } else {
                                MaterialTheme.colorScheme.surface
                            },
                    ),
                shape = RoundedCornerShape(16.dp),
                border =
                    BorderStroke(
                        1.dp,
                        if (isToday) {
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                    ),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    // Header
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = headerText,
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            )
                            if (isToday) {
                                Spacer(modifier = Modifier.width(6.dp))
                                Box(
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(MaterialTheme.colorScheme.primary)
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                ) {
                                    Text(
                                        text = "TODAY",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onPrimary,
                                    )
                                }
                            }
                        }
                        Text(
                            text = if (totalCount == 0) "Clear" else "$totalCount items",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    if (totalCount == 0) {
                        Text(
                            text = "No classes, exams, or events scheduled.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    } else {
                        // 1. Exams
                        dayAssessments.forEach { exam ->
                            val course = snapshot.schedule.courses.find { it.id == exam.courseId }
                            val courseColorHex = CoursePalette.getHex(exam.courseId)
                            val accentColor =
                                try {
                                    Color(android.graphics.Color.parseColor(courseColorHex))
                                } catch (_: Exception) {
                                    MaterialTheme.colorScheme.primary
                                }

                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(1.5.dp, Color(0xFFEF4444).copy(alpha = 0.7f), RoundedCornerShape(10.dp))
                                        .clickable { viewModel.openAssessmentDetail(exam.id) }
                                        .padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier =
                                        Modifier
                                            .width(4.dp)
                                            .height(36.dp)
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(Color(0xFFEF4444)),
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier =
                                                Modifier
                                                    .clip(RoundedCornerShape(4.dp))
                                                    .background(Color(0xFFEF4444).copy(alpha = 0.15f))
                                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                                        ) {
                                            Text(
                                                text = exam.assessmentType.uppercase(),
                                                fontSize = 9.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = Color(0xFFEF4444),
                                            )
                                        }
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(
                                            text = exam.courseName ?: exam.courseId ?: course?.name ?: "EXAM",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = accentColor,
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = exam.title,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = "${exam.displayTime ?: "All day"} · ${exam.room ?: "—"}",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                        }

                        // 2. Class Slots with Attendance Tracker
                        daySlots.forEach { slot ->
                            val courseColorHex = CoursePalette.getHex(slot.courseId)
                            val accentColor =
                                try {
                                    Color(android.graphics.Color.parseColor(courseColorHex))
                                } catch (_: Exception) {
                                    MaterialTheme.colorScheme.primary
                                }
                            val attKey = "${slot.id}::$date"
                            val attStatus = attendanceMap[attKey]
                            val absenceCount = viewModel.getCourseAbsenceCount(slot.courseId)

                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp))
                                        .padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier =
                                        Modifier
                                            .width(4.dp)
                                            .height(36.dp)
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(accentColor),
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = "${slot.courseId} · ${slot.type}",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = accentColor,
                                        )
                                        if (absenceCount >= 2) {
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                text = "⚠️ $absenceCount absences",
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = Color(0xFFF59E0B),
                                            )
                                        }
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = slot.courseName,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = "${slot.startTime}–${slot.endTime} @ ${slot.room ?: "—"}",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }

                                // Interactive Attendance Chip
                                val (attText, attBg, attFg) =
                                    when (attStatus) {
                                        "attended" -> Triple("✓ Attended", Color(0xFF10B981).copy(alpha = 0.15f), Color(0xFF10B981))
                                        "absent" -> Triple("✗ Absent", Color(0xFFEF4444).copy(alpha = 0.15f), Color(0xFFEF4444))
                                        "excused" -> Triple("~ Excused", Color(0xFFF59E0B).copy(alpha = 0.15f), Color(0xFFF59E0B))
                                        else ->
                                            Triple(
                                                "Mark",
                                                MaterialTheme.colorScheme.surfaceVariant,
                                                MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                    }

                                Box(
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(attBg)
                                            .clickable {
                                                viewModel.toggleAttendance(slot.id, slot.courseId, date.toString())
                                            }
                                            .padding(horizontal = 8.dp, vertical = 6.dp),
                                ) {
                                    Text(
                                        text = attText,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = attFg,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                        }

                        // 3. Custom events
                        dayEvents.forEach { event ->
                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(1.dp, CustomEventPink.copy(alpha = 0.5f), RoundedCornerShape(10.dp))
                                        .padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier =
                                        Modifier
                                            .width(4.dp)
                                            .height(30.dp)
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(CustomEventPink),
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column {
                                    Text(
                                        text = event.title,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = formatCustomEventTime(event.startTime, event.endTime),
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                        }
                    }
                }
            }
        }
    }
}
