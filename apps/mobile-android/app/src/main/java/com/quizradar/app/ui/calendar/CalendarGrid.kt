package com.quizradar.app.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.CustomEventPink
import java.time.LocalDate
import java.time.LocalTime

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
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val scrollState = rememberScrollState()
    val totalGridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT_DP

    Row(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(scrollState),
    ) {
        // Time gutter (08:00 to 21:00)
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
                    isDark = isDark,
                    onBlockClick = onBlockClick,
                    onHourClick = onHourClick,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun CalendarDayColumn(
    date: LocalDate,
    contents: CalendarDayContents?,
    isDark: Boolean,
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
        // Hour grid dividers with tap-to-create a study block
        for (h in 0 until (END_HOUR - START_HOUR + 1)) {
            val hourSlot = START_HOUR + h
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .offset(y = (h * HOUR_HEIGHT_DP).dp)
                        .height(HOUR_HEIGHT_DP.dp)
                        // The grid is the screen: 14 slots per day column, and
                        // every one of them is a tap target. Without a name, a
                        // screen reader announced a wall of "button"s and the
                        // user could not tell WHICH hour they were on.
                        .semantics {
                            contentDescription =
                                "$dayName ${String.format("%02d:00", hourSlot)}, " +
                                "double tap to schedule a study block"
                        }.clickable {
                            onHourClick(date, hourSlot)
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
            val palette = CoursePalette.get(block.courseId)
            val accessibleCourseText = CoursePalette.textOnSurface(block.courseId, isDark)
            val (bg, borderColor, textColor) =
                when (block.kind) {
                    CalendarBlockKind.MERGED_EXAM,
                    CalendarBlockKind.STANDALONE_EXAM,
                    ->
                        Triple(
                            MaterialTheme.colorScheme.errorContainer,
                            MaterialTheme.colorScheme.error,
                            MaterialTheme.colorScheme.onErrorContainer,
                        )
                    CalendarBlockKind.CLASS_SLOT ->
                        Triple(
                            palette.color.copy(alpha = if (isDark) 0.12f else 0.08f),
                            palette.border,
                            accessibleCourseText,
                        )
                    CalendarBlockKind.CUSTOM_EVENT ->
                        Triple(
                            CustomEventPink.copy(alpha = if (isDark) 0.2f else 0.12f),
                            CustomEventPink,
                            MaterialTheme.colorScheme.onSurface,
                        )
                }

            val isExam =
                block.kind == CalendarBlockKind.MERGED_EXAM ||
                    block.kind == CalendarBlockKind.STANDALONE_EXAM
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
                                borderColor,
                                RoundedCornerShape(6.dp),
                            )
                            .semantics {
                                contentDescription = block.speechLabel()
                            }.clickable {
                                onBlockClick(block)
                            }.padding(horizontal = 5.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = block.title,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = textColor,
                        maxLines = titleMaxLines,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (block.heightPx >= 42) {
                        // A block says WHEN it is and WHERE: the clock range,
                        // then the room — the literal em dash when the room is
                        // unknown (never a blank that reads like lost data).
                        Text(
                            text =
                                "${block.displayTime} · " +
                                    (block.room?.takeIf { it.isNotBlank() } ?: "—"),
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
