package com.quizradar.app.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.ui.theme.CoursePalette
import java.time.LocalDate
import java.time.LocalTime

private val TIME_GUTTER_WIDTH = 38.dp

private data class DynamicGridSchedule(
    val tickMinutes: List<Int>,
    val periodBoundaryMinutes: Set<Int>,
)

private fun parseClockMinutes(raw: String?): Int? {
    if (raw.isNullOrBlank()) return null
    val parts = raw.trim().split(":")
    if (parts.size < 2) return null
    val h = parts[0].toIntOrNull() ?: return null
    val m = parts[1].take(2).toIntOrNull() ?: return null
    if (h !in 0..23 || m !in 0..59) return null
    return h * 60 + m
}

/**
 * Computes period-aware time ticks (in minutes from midnight) for the left time
 * gutter and horizontal grid lines so that `:30` / custom period boundaries
 * (e.g. 09:00–10:30, 11:30–12:30, 14:00–15:30, or 08:00–10:30) snap cleanly
 * to grid lines and keep their `:30` cadence in open intervals.
 */
private fun computeDynamicGridSchedule(days: List<CalendarDayContents>): DynamicGridSchedule {
    val minBound = START_HOUR * 60
    val maxBound = END_HOUR * 60

    val intervals = mutableListOf<Pair<Int, Int>>()
    days.forEach { day ->
        day.slots.forEach { slot ->
            val s = parseClockMinutes(slot.startTime)
            val e = parseClockMinutes(slot.endTime)
            if (s != null && e != null && e > s) {
                intervals.add(s.coerceAtLeast(minBound) to e.coerceAtMost(maxBound + 60))
            }
        }
        day.assessments.forEach { a ->
            val s = parseClockMinutes(a.startTime)
            val e = parseClockMinutes(a.endTime)
            if (s != null && e != null && e > s) {
                intervals.add(s.coerceAtLeast(minBound) to e.coerceAtMost(maxBound + 60))
            }
        }
        day.customEvents.forEach { c ->
            val s = parseClockMinutes(c.startTime)
            val e = parseClockMinutes(c.endTime)
            if (s != null && e != null && e > s) {
                intervals.add(s.coerceAtLeast(minBound) to e.coerceAtMost(maxBound + 60))
            }
        }
    }

    if (intervals.isEmpty()) {
        val defaultTicks = (START_HOUR..END_HOUR).map { it * 60 }
        return DynamicGridSchedule(
            tickMinutes = defaultTicks,
            periodBoundaryMinutes = emptySet(),
        )
    }

    val boundaries = sortedSetOf<Int>()
    intervals.forEach { (startMin, endMin) ->
        if (startMin in minBound..maxBound) boundaries.add(startMin)
        if (endMin in minBound..maxBound) boundaries.add(endMin)
        // For multi-hour periods (e.g. 08:00..10:30), step internal lines backward
        // from endMin by 60m so 08:00..10:30 places lines at 08:30 and 09:30.
        if (endMin - startMin >= 120) {
            var cursor = endMin - 60
            while (cursor >= startMin + 30) {
                if (cursor in minBound..maxBound) boundaries.add(cursor)
                cursor -= 60
            }
        }
    }

    val allTicks = sortedSetOf<Int>()
    allTicks.addAll(boundaries)

    val sortedAnchors = boundaries.toList()
    val firstAnchor = sortedAnchors.first()
    var beforeCursor = firstAnchor - 60
    while (beforeCursor >= minBound) {
        allTicks.add(beforeCursor)
        beforeCursor -= 60
    }
    if (allTicks.first() - minBound >= 30) {
        allTicks.add(minBound)
    }

    for (i in 0 until sortedAnchors.size - 1) {
        val left = sortedAnchors[i]
        val right = sortedAnchors[i + 1]
        val spansInsideSinglePeriod = intervals.any { (s, e) -> s <= left && right <= e }
        if (!spansInsideSinglePeriod && right - left >= 90) {
            var gapCursor = left + 60
            while (gapCursor <= right - 30) {
                allTicks.add(gapCursor)
                gapCursor += 60
            }
        }
    }

    val lastAnchor = sortedAnchors.last()
    var afterCursor = lastAnchor + 60
    while (afterCursor <= maxBound) {
        allTicks.add(afterCursor)
        afterCursor += 60
    }

    return DynamicGridSchedule(
        tickMinutes = allTicks.toList(),
        periodBoundaryMinutes = boundaries,
    )
}

/**
 * Resolves a stored course hex color from [courseColorById] with case-insensitive fallback.
 */
private fun resolveStoredColorHex(
    courseId: String?,
    courseColorById: Map<String, String?>,
): String? {
    if (courseId.isNullOrBlank()) return null
    return courseColorById[courseId]
        ?: courseColorById.entries.firstOrNull { it.key.equals(courseId, ignoreCase = true) }?.value
}

/**
 * The week grid, shared by the 7-day week view and the 3-day window.
 *
 * Both views render the SAME component with a different list of dates, so a
 * block can never look different (or land on a different day) depending on
 * which window is open. The lane maths stays in [CalendarLanes]; the day
 * maths stays in [CalendarDayResolver].
 */
@Composable
fun CalendarGrid(
    dates: List<LocalDate>,
    days: List<CalendarDayContents>,
    onBlockClick: (CalendarBlock) -> Unit,
    onHourClick: (LocalDate, Int) -> Unit,
    modifier: Modifier = Modifier,
    courseColorById: Map<String, String?> = emptyMap(),
    bottomContentPadding: Dp = 88.dp,
    onDayBlockClick: ((LocalDate, CalendarBlock) -> Unit)? = null,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val scrollState = rememberScrollState()
    val totalGridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT_DP
    val isCompactColumns = dates.size >= 6
    val gridSchedule = remember(days) { computeDynamicGridSchedule(days) }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.surface)
                .verticalScroll(scrollState),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(totalGridHeight.dp),
        ) {
            // Dynamic period-aware time gutter
            Box(
                modifier =
                    Modifier
                        .width(TIME_GUTTER_WIDTH)
                        .height(totalGridHeight.dp),
            ) {
                gridSchedule.tickMinutes.forEach { tickMin ->
                    val topOffsetDp = ((tickMin - START_HOUR * 60) / 60f) * HOUR_HEIGHT_DP
                    val labelY = (topOffsetDp - if (tickMin == START_HOUR * 60) 0f else 5f).coerceAtLeast(1f)
                    val isPeriodBoundary = tickMin in gridSchedule.periodBoundaryMinutes
                    val hour = tickMin / 60
                    val minute = tickMin % 60
                    Text(
                        text = String.format("%02d:%02d", hour, minute),
                        style =
                            TextStyle(
                                fontSize = 10.sp,
                                fontWeight = if (isPeriodBoundary) FontWeight.SemiBold else FontWeight.Normal,
                                fontFeatureSettings = "tnum",
                                color =
                                    if (isPeriodBoundary) {
                                        MaterialTheme.colorScheme.onSurface
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.72f)
                                    },
                            ),
                        modifier =
                            Modifier
                                .padding(start = 3.dp)
                                .offset(y = labelY.dp),
                    )
                }
            }

            // Grid day columns
            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .height(totalGridHeight.dp),
            ) {
                dates.forEachIndexed { index, date ->
                    CalendarDayColumn(
                        date = date,
                        contents = days.getOrNull(index),
                        gridSchedule = gridSchedule,
                        columnCount = dates.size,
                        isDark = isDark,
                        isCompactColumns = isCompactColumns,
                        courseColorById = courseColorById,
                        onBlockClick = { block ->
                            onDayBlockClick?.invoke(date, block) ?: onBlockClick(block)
                        },
                        onHourClick = onHourClick,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        if (bottomContentPadding > 0.dp) {
            Spacer(modifier = Modifier.height(bottomContentPadding))
        }
    }
}

@Composable
private fun CalendarDayColumn(
    date: LocalDate,
    contents: CalendarDayContents?,
    gridSchedule: DynamicGridSchedule,
    columnCount: Int,
    isDark: Boolean,
    isCompactColumns: Boolean,
    courseColorById: Map<String, String?>,
    onBlockClick: (CalendarBlock) -> Unit,
    onHourClick: (LocalDate, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val dayName = date.dayOfWeek.name.take(3)
    val blocks = remember(contents) { contents?.let { CalendarDayResolver.buildBlocks(it) } ?: emptyList() }

    Box(
        modifier =
            modifier
                .fillMaxHeight()
                .border(
                    1.dp,
                    MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f),
                ),
    ) {
        // Accessible hourly tap targets (08:00..21:00) for tap-to-schedule
        for (h in 0 until (END_HOUR - START_HOUR + 1)) {
            val hourSlot = START_HOUR + h
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .offset(y = (h * HOUR_HEIGHT_DP).dp)
                        .height(HOUR_HEIGHT_DP.dp)
                        .semantics {
                            contentDescription =
                                "$dayName ${String.format("%02d:00", hourSlot)}, " +
                                "double tap to schedule a study block"
                        }.clickable {
                            onHourClick(date, hourSlot)
                        },
            )
        }

        // Dynamic period-aligned horizontal grid lines
        gridSchedule.tickMinutes.forEach { tickMin ->
            val topOffsetDp = ((tickMin - START_HOUR * 60) / 60f) * HOUR_HEIGHT_DP
            val isPeriodBoundary = tickMin in gridSchedule.periodBoundaryMinutes
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .offset(y = topOffsetDp.dp)
                        .height(1.dp)
                        .background(
                            if (isPeriodBoundary) {
                                MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.9f)
                            } else {
                                MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)
                            },
                        ),
            )
        }

        // Current time "Now" indicator line (if column is today)
        if (date == LocalDate.now()) {
            val now = LocalTime.now()
            val nowDecimal = now.hour + now.minute / 60f
            if (nowDecimal >= START_HOUR && nowDecimal <= END_HOUR + 1) {
                val nowTopPx = (nowDecimal - START_HOUR) * HOUR_HEIGHT_DP
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .offset(y = nowTopPx.dp)
                            .height(2.dp)
                            .background(MaterialTheme.colorScheme.error),
                ) {
                    Box(
                        modifier =
                            Modifier
                                .size(7.dp)
                                .offset(x = (-3.5).dp, y = (-2.5).dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.error),
                    )
                }
            }
        }

        blocks.forEach { block ->
            val storedHex = resolveStoredColorHex(block.courseId, courseColorById)
            val palette = CoursePalette.get(block.courseId, storedHex)
            val baseSurface = MaterialTheme.colorScheme.surfaceContainerHigh
            val isExam =
                block.kind == CalendarBlockKind.MERGED_EXAM ||
                    block.kind == CalendarBlockKind.STANDALONE_EXAM
            val accentColor =
                when (block.kind) {
                    CalendarBlockKind.MERGED_EXAM,
                    CalendarBlockKind.STANDALONE_EXAM,
                    -> if (isDark) Color(0xFFF59E0B) else Color(0xFFD97706)
                    CalendarBlockKind.CLASS_SLOT -> palette.border
                    CalendarBlockKind.CUSTOM_EVENT ->
                        if (isDark) Color(0xFF38BDF8) else Color(0xFF0284C7)
                }
            val bg =
                accentColor
                    .copy(alpha = if (isDark) 0.16f else 0.11f)
                    .compositeOver(baseSurface.copy(alpha = if (isDark) 0.94f else 0.97f))
            val borderColor = accentColor.copy(alpha = if (isDark) 0.36f else 0.28f)
            val textColor =
                if (isExam) {
                    if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)
                } else {
                    MaterialTheme.colorScheme.onSurface
                }
            val subtitleColor =
                if (isExam) {
                    if (isDark) Color(0xFFFCD34D).copy(alpha = 0.85f) else Color(0xFFB45309)
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }

            val borderWidth = 1.dp
            val stripeWidth = if (isCompactColumns) 2.5.dp else 3.5.dp
            val rawStartSegment =
                block.displayTime
                    .substringAfterLast("·")
                    .substringBefore("–")
                    .substringBefore("-")
                    .trim()
            val cleanClockRange = block.displayTime.substringAfterLast("·").trim()
            val compactSubtitle =
                if (rawStartSegment.contains(":")) {
                    rawStartSegment
                } else {
                    block.type?.takeIf { it.isNotBlank() }
                        ?: if (isExam) "Exam" else rawStartSegment
                }
            val primaryLabel =
                if (isCompactColumns) {
                    block.courseId?.takeIf { it.isNotBlank() } ?: block.title
                } else {
                    block.title
                }
            val titleMaxLines =
                when {
                    isCompactColumns -> 1
                    columnCount >= 5 -> 1
                    block.heightPx >= 52 -> 2
                    else -> 1
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
                            .padding(
                                horizontal = if (isCompactColumns) 1.dp else 2.dp,
                                vertical = if (isCompactColumns) 1.dp else 1.5.dp,
                            ).clip(RoundedCornerShape(if (isCompactColumns) 5.dp else 7.dp))
                            .background(bg)
                            .drawWithContent {
                                drawContent()
                                val stripePx = stripeWidth.toPx()
                                drawRect(
                                    color = accentColor,
                                    topLeft = Offset.Zero,
                                    size = Size(stripePx, size.height),
                                )
                            }.border(
                                borderWidth,
                                borderColor,
                                RoundedCornerShape(if (isCompactColumns) 5.dp else 7.dp),
                            ).semantics {
                                contentDescription = block.speechLabel()
                            }.clickable {
                                onBlockClick(block)
                            }.padding(
                                start = if (isCompactColumns) 4.5.dp else 7.5.dp,
                                end = if (isCompactColumns) 2.dp else 5.dp,
                                top = if (isCompactColumns) 2.5.dp else 4.dp,
                                bottom = if (isCompactColumns) 2.dp else 4.dp,
                            ),
                ) {
                    Text(
                        text = primaryLabel,
                        fontSize =
                            when {
                                isCompactColumns -> 8.5.sp
                                columnCount >= 4 -> 10.sp
                                else -> 11.sp
                            },
                        lineHeight =
                            when {
                                isCompactColumns -> 10.sp
                                columnCount >= 4 -> 12.sp
                                else -> 13.5.sp
                            },
                        letterSpacing = if (isCompactColumns) (-0.25).sp else 0.sp,
                        fontWeight = FontWeight.Bold,
                        color = textColor,
                        maxLines = titleMaxLines,
                        softWrap = !isCompactColumns,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (block.heightPx >= 34) {
                        // A block says WHEN it is and WHERE: the clock range,
                        // then the room — the literal em dash when the room is
                        // unknown (never a blank that reads like lost data).
                        Text(
                            text =
                                if (isCompactColumns) {
                                    compactSubtitle
                                } else {
                                    "$cleanClockRange · " +
                                        (block.room?.takeIf { it.isNotBlank() } ?: "—")
                                },
                            fontSize =
                                when {
                                    isCompactColumns -> 8.sp
                                    columnCount >= 4 -> 9.5.sp
                                    else -> 10.5.sp
                                },
                            lineHeight =
                                when {
                                    isCompactColumns -> 9.5.sp
                                    columnCount >= 4 -> 11.5.sp
                                    else -> 13.sp
                                },
                            letterSpacing = if (isCompactColumns) (-0.2).sp else 0.sp,
                            style = TextStyle(fontFeatureSettings = "tnum"),
                            color = subtitleColor,
                            maxLines = 1,
                            softWrap = !isCompactColumns,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

/**
 * What TalkBack reads for a block: what it is, when it is, and where it is.
 * A class slot also names its type and group, the information the agenda
 * row shows.
 */
private fun CalendarBlock.speechLabel(): String {
    val parts = mutableListOf<String>()
    parts += title
    parts += displayTime
    room?.takeIf { it.isNotBlank() }?.let { parts += "in $it" }
    type?.takeIf { it.isNotBlank() }?.let { parts += it }
    group?.takeIf { it.isNotBlank() }?.let { parts += "group $it" }
    return parts.joinToString(", ")
}
