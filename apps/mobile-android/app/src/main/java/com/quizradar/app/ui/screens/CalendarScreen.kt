package com.quizradar.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.calendar.CalendarLaneItem
import com.quizradar.app.ui.calendar.CalendarLanes
import com.quizradar.app.ui.calendar.END_HOUR
import com.quizradar.app.ui.calendar.HOUR_HEIGHT_DP
import com.quizradar.app.ui.calendar.START_HOUR
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

@Composable
fun CalendarScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val currentWeekStart by viewModel.currentWeekStart.collectAsState()
    val selectedDate by viewModel.selectedCalendarDate.collectAsState()

    // 7 days of the week starting from currentWeekStart
    val weekDates =
        remember(currentWeekStart) {
            (0..6).map { currentWeekStart.plusDays(it.toLong()) }
        }

    val headerFormatter = remember { DateTimeFormatter.ofPattern("MMM d") }
    val headerRange = "${weekDates.first().format(headerFormatter)} – ${weekDates.last().format(headerFormatter)}, ${weekDates.last().year}"

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val isNarrow = maxWidth < 600.dp
        val dayCount = if (isNarrow) 3 else 7

        // Clamped 3-day window on mobile
        val dayOffset =
            if (isNarrow) {
                val selectedIdx = weekDates.indexOf(selectedDate).coerceAtLeast(0)
                selectedIdx.coerceIn(0, 7 - dayCount)
            } else {
                0
            }

        val displayedDates = weekDates.subList(dayOffset, dayOffset + dayCount)

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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier =
                            Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.CalendarMonth,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = headerRange,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = snapshot.schedule.semester ?: "Semester Schedule",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = { viewModel.jumpToToday() },
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = ButtonDefaults.TextButtonContentPadding,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surface),
                        modifier = Modifier.border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.15f), RoundedCornerShape(8.dp)),
                    ) {
                        Text(
                            text = "Today",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    IconButton(onClick = { viewModel.shiftWeek(-1) }, modifier = Modifier.size(32.dp)) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Prev Week",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    IconButton(onClick = { viewModel.shiftWeek(1) }, modifier = Modifier.size(32.dp)) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                            contentDescription = "Next Week",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            // Days Header Row
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)),
            ) {
                // Time Gutter spacer (width 48dp)
                Spacer(modifier = Modifier.width(48.dp))

                // Day columns header
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
                                    MaterialTheme.colorScheme.onSurface.copy(
                                        alpha = 0.6f,
                                    )
                                },
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Box(
                            modifier =
                                Modifier
                                    .size(26.dp)
                                    .clip(CircleShape)
                                    .background(if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "${date.dayOfMonth}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurface,
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
                                    .padding(start = 4.dp, top = 2.dp),
                        ) {
                            Text(
                                text = String.format("%02d:00", h),
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
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

                        // 1. Collect all events on this date
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

                        // Build raw items and pack lanes
                        val rawBlocks = mutableListOf<CalendarUiBlock>()

                        // Add assessments & merged slots
                        dayAssessments.forEach { a ->
                            val pos = CalendarLanes.computeBlockPosition(a.startTime, a.endTime)
                            val mergedSlot = daySlots.find { it.courseId == a.courseId }
                            val kind = if (mergedSlot != null) BlockKind.MERGED_EXAM else BlockKind.STANDALONE_EXAM
                            rawBlocks.add(
                                CalendarUiBlock(
                                    id = a.id,
                                    topPx = pos.topPx,
                                    heightPx = pos.heightPx,
                                    kind = kind,
                                    title = a.title,
                                    courseId = a.courseId,
                                    displayTime = a.displayTime ?: "All Day",
                                    room = a.room,
                                    assessmentId = a.id,
                                ),
                            )
                        }

                        // Add plain class slots (excluding those merged)
                        daySlots.forEach { s ->
                            val isMerged = dayAssessments.any { it.courseId == s.courseId }
                            if (!isMerged) {
                                val pos = CalendarLanes.computeBlockPosition(s.startTime, s.endTime)
                                rawBlocks.add(
                                    CalendarUiBlock(
                                        id = s.id,
                                        topPx = pos.topPx,
                                        heightPx = pos.heightPx,
                                        kind = BlockKind.CLASS_SLOT,
                                        title = "${s.courseId} ${s.type}",
                                        courseId = s.courseId,
                                        displayTime = s.displayTime ?: "${s.startTime}–${s.endTime}",
                                        room = s.room,
                                        assessmentId = null,
                                    ),
                                )
                            }
                        }

                        // Add custom events
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
                                    displayTime = "${e.startTime ?: ""}–${e.endTime ?: ""}",
                                    room = e.room,
                                    assessmentId = null,
                                ),
                            )
                        }

                        // Assign overlap lanes
                        val laneItems = CalendarLanes.assignOverlapLanes(rawBlocks)

                        Box(
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .fillMaxHeight()
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.05f)),
                        ) {
                            // Hour grid horizontal lines
                            for (h in 0 until (END_HOUR - START_HOUR + 1)) {
                                Box(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .offset(y = (h * HOUR_HEIGHT_DP).dp)
                                            .height(1.dp)
                                            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f)),
                                )
                            }

                            // Render blocks inside lane column
                            laneItems.forEach { block ->
                                val palette = CoursePalette.get(block.courseId)
                                val (bg, border, textClr) =
                                    when (block.kind) {
                                        BlockKind.MERGED_EXAM ->
                                            Triple(
                                                Color(0xFFDC2626).copy(alpha = 0.16f),
                                                Color(0xFFDC2626),
                                                Color(0xFFDC2626),
                                            )
                                        BlockKind.STANDALONE_EXAM ->
                                            Triple(
                                                palette.background,
                                                palette.color,
                                                palette.color,
                                            )
                                        BlockKind.CLASS_SLOT ->
                                            Triple(
                                                palette.background.copy(alpha = 0.08f),
                                                palette.border.copy(alpha = 0.4f),
                                                palette.color,
                                            )
                                        BlockKind.CUSTOM_EVENT ->
                                            Triple(
                                                CustomEventPink.copy(alpha = 0.14f),
                                                CustomEventPink,
                                                CustomEventPink,
                                            )
                                    }

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
                                                .padding(1.dp)
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(bg)
                                                .border(1.dp, border, RoundedCornerShape(6.dp))
                                                .clickable {
                                                    if (block.assessmentId != null) {
                                                        viewModel.openAssessmentDetail(block.assessmentId)
                                                    }
                                                }
                                                .padding(4.dp),
                                    ) {
                                        Text(
                                            text = block.title,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = textClr,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        if (block.room != null) {
                                            Text(
                                                text = block.room,
                                                fontSize = 9.sp,
                                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                                maxLines = 1,
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
