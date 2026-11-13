@file:OptIn(ExperimentalMaterial3Api::class)

package com.quizradar.app.ui.screens

import android.provider.Settings
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.calendar.CalendarDayContents
import com.quizradar.app.ui.calendar.CalendarDayResolver
import com.quizradar.app.ui.calendar.CalendarGrid
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.share.SharedEventDraft
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.CustomEventPink
import com.quizradar.app.ui.theme.StatusColors
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private const val DAY_STRIP_TAG = "calendar_day_strip"

/** One authored motion token: 200ms, exponential ease-out (brief §6). */
private const val CALENDAR_MOTION_MILLIS = 200
private val CalendarEaseOutExpo = CubicBezierEasing(0.19f, 1f, 0.22f, 1f)

private const val MILLIS_PER_DAY = 86_400_000L

private val DayCellShape = RoundedCornerShape(percent = 50)
private val DayCellLabelFormatter = DateTimeFormatter.ofPattern("EEEE, d MMMM")
private val MonthDayFormatter = DateTimeFormatter.ofPattern("MMM d")
private val DayFormatter = DateTimeFormatter.ofPattern("d")

/** The three chrome modes behind the Day / 3-Day / Week segmented control. */
private enum class CalendarViewMode(val label: String) {
    DAY("Day"),
    THREE_DAY("3-Day"),
    WEEK("Week"),
}

/**
 * Centered window offset for a [dayCount]-day view over a 7-day week: the
 * selected day sits in the middle, clamped to the week edges, so tapping a
 * day header or jumping via the date picker always brings that day INTO the
 * window. The old clamp (`selectedIdx.coerceIn(0, 7 - dayCount)`) pinned the
 * window to the week's right edge and made Sun-Wed unreachable.
 */
private fun windowOffsetFor(
    selectedIdx: Int,
    dayCount: Int,
    weekSize: Int = 7,
): Int = (selectedIdx.coerceAtLeast(0) - (dayCount - 1) / 2).coerceIn(0, weekSize - dayCount)

/**
 * Calendar screen, rebuilt per docs/ANDROID-DESIGN-SYSTEM.md §6 ("Quiet
 * instrument"): ONE title row (range -> DatePickerDialog, muted semester
 * subtitle, Today pill, Day/3-Day/Week segments, week arrows) and ONE day
 * strip that IS the only pager. Grid/agenda content is unchanged behavior,
 * resolved through [CalendarDayResolver] so the grid and the agenda can
 * never disagree about what is on a day (WeekParityHelper parity included).
 */
@Composable
fun CalendarScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val currentWeekStart by viewModel.currentWeekStart.collectAsState()
    val selectedDate by viewModel.selectedCalendarDate.collectAsState()
    // The ViewModel's injected clock (production: the real "today"), so the
    // Today marks match what the core computed against - never a second,
    // un-injected clock reading in the UI layer.
    val today = viewModel.today
    var viewMode by remember { mutableStateOf(CalendarViewMode.THREE_DAY) }
    var showDatePicker by remember { mutableStateOf(false) }

    // Reduced motion (`Settings.Global.ANIMATOR_DURATION_SCALE == 0`) turns
    // every calendar motion into an instant swap — the calendar must never
    // animate for a user whose device says don't.
    val context = LocalContext.current
    val animationsEnabled =
        remember {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) > 0f
        }

    val weekDates =
        remember(currentWeekStart) {
            (0..6).map { currentWeekStart.plusDays(it.toLong()) }
        }

    // ONE resolution pass per week: the day strip dots, the grid and the
    // agenda all read the exact same CalendarDayContents.
    val weekContents =
        remember(weekDates, snapshot) {
            weekDates.map { date ->
                CalendarDayResolver.resolve(
                    date = date,
                    slots = snapshot.schedule.slots,
                    assessments = snapshot.assessments,
                    customEvents = snapshot.customEvents,
                )
            }
        }

    val headerRange =
        remember(weekDates) {
            val first = weekDates.first()
            val last = weekDates.last()
            if (first.month == last.month) {
                "${first.format(MonthDayFormatter)} – ${last.format(DayFormatter)}"
            } else {
                "${first.format(MonthDayFormatter)} – ${last.format(MonthDayFormatter)}"
            }
        }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val isNarrow = maxWidth < 600.dp
        val visibleCellCount = if (isNarrow) 3 else 7
        val cellWidth = (maxWidth - 40.dp) / visibleCellCount

        val selectedIdx = weekDates.indexOf(selectedDate)
        val stripAnchor = windowOffsetFor(selectedIdx, visibleCellCount)

        Column(modifier = Modifier.fillMaxSize()) {
            // ---- Title row (48dp): range -> DatePickerDialog, muted semester
            // subtitle under the range; trailing side: Today pill, the
            // Day/3-Day/Week segments and the week paging arrows.
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (isNarrow) {
                    Row(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CalendarRangeTitle(
                            headerRange = headerRange,
                            semesterLabel = snapshot.schedule.semester ?: "Semester Schedule",
                            onOpenDatePicker = { showDatePicker = true },
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        CalendarTodayButton(onClick = { viewModel.jumpToToday() })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CalendarModeSegments(
                            mode = viewMode,
                            onSelectMode = { viewMode = it },
                        )
                        CalendarWeekArrows(
                            onPreviousWeek = { viewModel.shiftWeek(-1) },
                            onNextWeek = { viewModel.shiftWeek(1) },
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CalendarRangeTitle(
                            headerRange = headerRange,
                            semesterLabel = snapshot.schedule.semester ?: "Semester Schedule",
                            onOpenDatePicker = { showDatePicker = true },
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        CalendarTodayButton(onClick = { viewModel.jumpToToday() })
                        Spacer(modifier = Modifier.width(8.dp))
                        CalendarModeSegments(
                            mode = viewMode,
                            onSelectMode = { viewMode = it },
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        CalendarWeekArrows(
                            onPreviousWeek = { viewModel.shiftWeek(-1) },
                            onNextWeek = { viewModel.shiftWeek(1) },
                        )
                    }
                }
            }

            // ---- Day strip: THE ONLY pager. Horizontally paged windows with
            // snapping; tapping a cell selects it and the grid/agenda follow.
            CalendarDayStrip(
                weekDates = weekDates,
                weekContents = weekContents,
                selectedDate = selectedDate,
                today = today,
                cellWidth = cellWidth,
                anchorIndex = stripAnchor,
                animationsEnabled = animationsEnabled,
                onSelectDate = { viewModel.setSelectedCalendarDate(it) },
                modifier = Modifier.fillMaxWidth(),
            )

            // ---- Grid / agenda content (one motion moment: the mode swap).
            val modeContent: @Composable (CalendarViewMode) -> Unit = { mode ->
                CalendarModeContent(
                    mode = mode,
                    weekDates = weekDates,
                    weekContents = weekContents,
                    selectedDate = selectedDate,
                    snapshot = snapshot,
                    viewModel = viewModel,
                )
            }
            if (animationsEnabled) {
                Crossfade(
                    targetState = viewMode,
                    animationSpec = tween(CALENDAR_MOTION_MILLIS, easing = CalendarEaseOutExpo),
                    label = "calendarMode",
                    modifier = Modifier.fillMaxSize(),
                ) { mode ->
                    modeContent(mode)
                }
            } else {
                modeContent(viewMode)
            }
        }

        if (showDatePicker) {
            val pickerState =
                rememberDatePickerState(
                    initialSelectedDateMillis = selectedDate.toEpochDay() * MILLIS_PER_DAY,
                )
            DatePickerDialog(
                onDismissRequest = { showDatePicker = false },
                confirmButton = {
                    TextButton(
                        onClick = {
                            pickerState.selectedDateMillis?.let { millis ->
                                viewModel.jumpToDate(
                                    Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate(),
                                )
                            }
                            showDatePicker = false
                        },
                    ) { Text("Jump to date") }
                },
                dismissButton = {
                    TextButton(onClick = { showDatePicker = false }) { Text("Cancel") }
                },
            ) {
                DatePicker(state = pickerState)
            }
        }
    }
}

/** The tappable range title (opens the Material3 DatePickerDialog) with the muted semester subtitle. */
@Composable
private fun CalendarRangeTitle(
    headerRange: String,
    semesterLabel: String,
    onOpenDatePicker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Text(
            text = headerRange,
            style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier =
                Modifier.clickable(
                    role = Role.Button,
                    onClickLabel = "Change calendar date",
                    onClick = onOpenDatePicker,
                ),
        )
        Text(
            text = semesterLabel,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** "Today" as a compact tonal pill. */
@Composable
private fun CalendarTodayButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FilledTonalButton(
        onClick = onClick,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
        modifier = modifier,
    ) {
        Text(text = "Today", style = MaterialTheme.typography.labelLarge)
    }
}

/**
 * Day / 3-Day / Week as a Material3 segmented group (text labels, no bare
 * icon - docs/ANDROID-DESIGN-SYSTEM.md §3/§6).
 *
 * This is deliberately NOT Material3's own `SegmentedButton`. With the
 * Material3 1.3.1 + Compose 1.7.6 versions this app builds against, a
 * `SingleChoiceSegmentedButtonRow` of `SegmentedButton`s swallows EVERY
 * tap: the segment's `onClick` never runs, so the Day/3-Day/Week switch was
 * unreachable on the calendar screen. The accessibility action (`OnClick`)
 * still fired, which is why the control looked alive to a11y services while
 * being dead to a finger.
 *
 * The control keeps the same Material3 look - the segmented row, the
 * per-index `SegmentedButtonDefaults.itemShape` and the container/content/
 * border colors - and the same accessibility contract (RadioButton role plus
 * the `selected` state). The segments are label-only, like Material3's own
 * segmented buttons: no leading check icon, so the "3-Day" label is never
 * squeezed into an ellipsis on a 1080px screen; selection is conveyed by the
 * active container/border color and to TalkBack by the `selected` state.
 *
 * The structure below is the one that measurably answers taps (all verified
 * with Robolectric on this screen):
 *  - The segment is a `Box` that carries the `Modifier.selectable`, so the
 *    whole segment is one touch target with the
 *    RadioButton role and the `selected` state.
 *  - The segment's CONTENT carries NO padding modifier. With
 *    `Modifier.padding(...)` on the label (or on the content row) the whole
 *    segment goes dead to touch - every position across it was dead, while
 *    the identical code without the padding answered the tap - and the a11y
 *    action still worked, which is exactly the symptom this control had.
 *    The label is therefore CENTERED in the segment
 *    (`contentAlignment = Alignment.Center`) instead of padded.
 *  - The row is `width(IntrinsicSize.Min)` and each segment sizes to its
 *    content (no `weight(1f)`): the segments take only the width they need,
 *    so the week arrows next to them keep their 48dp touch targets on a
 *    narrow screen and no label is forced to ellipsize.
 */
@Composable
private fun CalendarModeSegments(
    mode: CalendarViewMode,
    onSelectMode: (CalendarViewMode) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = SegmentedButtonDefaults.colors()
    val count = CalendarViewMode.entries.size
    Row(
        modifier = modifier.selectableGroup().width(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CalendarViewMode.entries.forEachIndexed { index, candidate ->
            val isSelected = mode == candidate
            val shape = SegmentedButtonDefaults.itemShape(index = index, count = count)
            val containerColor =
                if (isSelected) {
                    colors.activeContainerColor
                } else {
                    colors.inactiveContainerColor
                }
            val contentColor =
                if (isSelected) {
                    colors.activeContentColor
                } else {
                    colors.inactiveContentColor
                }
            Box(
                modifier =
                    Modifier
                        .defaultMinSize(minWidth = 48.dp, minHeight = 40.dp)
                        .clip(shape)
                        .background(containerColor)
                        .border(
                            SegmentedButtonDefaults.borderStroke(
                                color =
                                    if (isSelected) {
                                        colors.activeBorderColor
                                    } else {
                                        colors.inactiveBorderColor
                                    },
                            ),
                            shape,
                        )
                        .selectable(
                            selected = isSelected,
                            role = Role.RadioButton,
                            onClick = { onSelectMode(candidate) },
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = candidate.label,
                    style = MaterialTheme.typography.labelLarge,
                    color = contentColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Week paging arrows (kept from the old header; they page whole weeks). */
@Composable
private fun CalendarWeekArrows(
    onPreviousWeek: () -> Unit,
    onNextWeek: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        IconButton(
            onClick = onPreviousWeek,
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
            onClick = onNextWeek,
            modifier = Modifier.size(48.dp),
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = "Next Week",
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/**
 * The day strip: 64dp, horizontally paged windows with snapping, one cell
 * per day. The standalone arrow/dots pager row is gone — swipe on the strip
 * or tap cells to navigate. Each cell is selectable with a state description
 * for TalkBack; the strip is one horizontally scrollable collection.
 */
@Composable
private fun CalendarDayStrip(
    weekDates: List<LocalDate>,
    weekContents: List<CalendarDayContents>,
    selectedDate: LocalDate,
    today: LocalDate,
    cellWidth: Dp,
    anchorIndex: Int,
    animationsEnabled: Boolean,
    onSelectDate: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    val snapFlingBehavior = rememberSnapFlingBehavior(lazyListState = listState)

    // Keep the selected day's window on screen when the selection changes
    // from OUTSIDE the strip (date picker, Today, week arrows). Tapping a
    // visible cell is already in place, so this is a no-op there.
    LaunchedEffect(anchorIndex, weekDates.firstOrNull()) {
        if (animationsEnabled) {
            listState.animateScrollToItem(anchorIndex)
        } else {
            listState.scrollToItem(anchorIndex)
        }
    }

    LazyRow(
        state = listState,
        flingBehavior = snapFlingBehavior,
        modifier =
            modifier
                .heightIn(min = 64.dp)
                .padding(horizontal = 20.dp, vertical = 4.dp)
                .testTag(DAY_STRIP_TAG),
    ) {
        itemsIndexed(weekDates, key = { _, date -> date.toString() }) { index, date ->
            CalendarDayCell(
                date = date,
                contents = weekContents[index],
                isSelected = date == selectedDate,
                isToday = date == today,
                cellWidth = cellWidth,
                onSelect = onSelectDate,
            )
        }
    }
}

/**
 * One day cell: weekday label (labelMedium) + date number (15sp/600 tabular).
 * Selected = filled primary pill with onPrimary content; today = 4dp primary
 * dot under the number; days with items = 2dp status dots (one per layer).
 */
@Composable
private fun CalendarDayCell(
    date: LocalDate,
    contents: CalendarDayContents,
    isSelected: Boolean,
    isToday: Boolean,
    cellWidth: Dp,
    onSelect: (LocalDate) -> Unit,
) {
    val cellLabel = remember(date) { date.format(DayCellLabelFormatter) }
    val stateParts =
        buildList {
            if (isSelected) add("Selected")
            if (isToday) add("Today")
            if (contents.totalCount > 0) add("Has items")
        }
    val containerColor by animateColorAsState(
        targetValue =
            if (isSelected) {
                MaterialTheme.colorScheme.primary
            } else {
                Color.Transparent
            },
        animationSpec = tween(CALENDAR_MOTION_MILLIS, easing = CalendarEaseOutExpo),
        label = "dayCellContainer",
    )

    Box(
        modifier =
            Modifier
                .width(cellWidth)
                .padding(horizontal = 2.dp)
                .heightIn(min = 56.dp)
                .clip(DayCellShape)
                .background(containerColor)
                .selectable(
                    selected = isSelected,
                    role = Role.Tab,
                    onClick = { onSelect(date) },
                )
                .semantics {
                    contentDescription = cellLabel
                    if (stateParts.isNotEmpty()) stateDescription = stateParts.joinToString(", ")
                },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = date.dayOfWeek.name.take(3),
                style = MaterialTheme.typography.labelMedium,
                color =
                    if (isSelected) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
            )
            Text(
                text = "${date.dayOfMonth}",
                style =
                    TextStyle(
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFeatureSettings = "tnum",
                    ),
                color =
                    if (isSelected) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
            )
            if (isToday) {
                // 4dp dot under the number; onPrimary on the selected pill so
                // today-ness never disappears behind the selection.
                Box(
                    modifier =
                        Modifier
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(
                                if (isSelected) {
                                    MaterialTheme.colorScheme.onPrimary
                                } else {
                                    MaterialTheme.colorScheme.primary
                                },
                            ),
                )
            }
            if (!isSelected && contents.totalCount > 0) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (contents.slots.isNotEmpty()) {
                        CalendarStatusDot(MaterialTheme.colorScheme.primary)
                    }
                    if (contents.assessments.isNotEmpty()) {
                        CalendarStatusDot(MaterialTheme.colorScheme.error)
                    }
                    if (contents.customEvents.isNotEmpty()) {
                        CalendarStatusDot(CustomEventPink)
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarStatusDot(color: Color) {
    Box(
        modifier =
            Modifier
                .size(2.dp)
                .clip(CircleShape)
                .background(color),
    )
}

/** Grid or agenda content for one [CalendarViewMode], all resolved days shared. */
@Composable
private fun CalendarModeContent(
    mode: CalendarViewMode,
    weekDates: List<LocalDate>,
    weekContents: List<CalendarDayContents>,
    selectedDate: LocalDate,
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
) {
    when (mode) {
        CalendarViewMode.DAY ->
            CalendarAgendaView(
                displayedDates = listOf(selectedDate),
                snapshot = snapshot,
                viewModel = viewModel,
                modifier = Modifier.fillMaxSize().padding(bottom = 88.dp),
            )
        CalendarViewMode.THREE_DAY -> {
            val offset = windowOffsetFor(weekDates.indexOf(selectedDate), 3)
            CalendarGrid(
                dates = weekDates.subList(offset, offset + 3),
                days = weekContents.subList(offset, offset + 3),
                onBlockClick = { block ->
                    block.assessmentId?.let { viewModel.openAssessmentDetail(it) }
                },
                onHourClick = { date, hourSlot -> openStudyBlockDraft(viewModel, date, hourSlot) },
                modifier = Modifier.fillMaxSize().padding(bottom = 88.dp),
            )
        }
        CalendarViewMode.WEEK ->
            CalendarGrid(
                dates = weekDates,
                days = weekContents,
                onBlockClick = { block ->
                    block.assessmentId?.let { viewModel.openAssessmentDetail(it) }
                },
                onHourClick = { date, hourSlot -> openStudyBlockDraft(viewModel, date, hourSlot) },
                modifier = Modifier.fillMaxSize().padding(bottom = 88.dp),
            )
    }
}

/** Tap-to-create study block on an empty grid hour (unchanged draft shape). */
private fun openStudyBlockDraft(
    viewModel: QuizRadarViewModel,
    date: LocalDate,
    hourSlot: Int,
) {
    val startStr = String.format("%02d:00", hourSlot)
    val endStr = String.format("%02d:00", (hourSlot + 1).coerceAtMost(23))
    viewModel.openCreateEventDraft(
        SharedEventDraft(
            title = "Study Session",
            notes = "Scheduled study slot $startStr–$endStr",
            dateIso = date,
            startTime = startStr,
            endTime = endStr,
        ),
    )
}

/**
 * The agenda list: one day card per [displayedDates] entry. Every day is
 * resolved through [CalendarDayResolver] — the SAME helper the week grid
 * uses — so the agenda can never disagree with the grid about what is on a
 * day (the old day-name-only match lost every abbreviated slot day and every
 * alternating-week class; audit A09).
 */
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
        modifier = modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        displayedDates.forEach { date ->
            val isToday = date == viewModel.today
            val headerText = date.format(DateTimeFormatter.ofPattern("EEEE, MMM d"))

            val dayContents =
                CalendarDayResolver.resolve(
                    date = date,
                    slots = snapshot.schedule.slots,
                    assessments = snapshot.assessments,
                    customEvents = snapshot.customEvents,
                )
            val daySlots = dayContents.slots
            val dayAssessments = dayContents.assessments
            val dayEvents = dayContents.customEvents
            val totalCount = dayContents.totalCount

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors =
                    CardDefaults.cardColors(
                        containerColor =
                            if (isToday) {
                                MaterialTheme.colorScheme.surfaceVariant
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
                Column(modifier = Modifier.padding(16.dp)) {
                    // Header
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = headerText,
                                style = MaterialTheme.typography.titleMedium,
                                color =
                                    if (isToday) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurface
                                    },
                            )
                            if (isToday) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Box(
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(MaterialTheme.colorScheme.primary)
                                            .padding(horizontal = 8.dp, vertical = 2.dp),
                                ) {
                                    Text(
                                        text = "TODAY",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onPrimary,
                                    )
                                }
                            }
                        }
                        Text(
                            // Status, not an action: nothing is clickable here.
                            // The bare word "Clear" read like a button, so the
                            // label now says what the day actually is.
                            text = if (totalCount == 0) "Clear day" else "$totalCount items",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    if (totalCount == 0) {
                        Text(
                            text = "No classes, exams, or events scheduled.",
                            style = MaterialTheme.typography.bodySmall,
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
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f))
                                        .border(
                                            1.dp,
                                            MaterialTheme.colorScheme.error.copy(alpha = 0.7f),
                                            RoundedCornerShape(12.dp),
                                        )
                                        .clickable { viewModel.openAssessmentDetail(exam.id) }
                                        .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    modifier =
                                        Modifier
                                            .width(4.dp)
                                            .height(36.dp)
                                            .clip(RoundedCornerShape(2.dp))
                                            .background(MaterialTheme.colorScheme.error),
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier =
                                                Modifier
                                                    .clip(RoundedCornerShape(4.dp))
                                                    .background(MaterialTheme.colorScheme.errorContainer)
                                                    .padding(horizontal = 5.dp, vertical = 2.dp),
                                        ) {
                                            Text(
                                                text = exam.assessmentType.uppercase(),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onErrorContainer,
                                            )
                                        }
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = exam.courseName ?: exam.courseId ?: course?.name ?: "EXAM",
                                            style =
                                                MaterialTheme.typography.labelMedium.copy(
                                                    fontWeight = FontWeight.Bold,
                                                ),
                                            color = accentColor,
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = exam.title,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = "${exam.displayTime ?: "All day"} · ${exam.room ?: "—"}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
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
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(
                                            1.dp,
                                            MaterialTheme.colorScheme.outlineVariant,
                                            RoundedCornerShape(12.dp),
                                        )
                                        .padding(12.dp),
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
                                            style =
                                                MaterialTheme.typography.labelMedium.copy(
                                                    fontWeight = FontWeight.Bold,
                                                ),
                                            color = accentColor,
                                        )
                                        if (absenceCount >= 2) {
                                            Spacer(modifier = Modifier.width(8.dp))
                                            Text(
                                                text = "$absenceCount absences",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = StatusColors.warningBadge,
                                            )
                                        }
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = slot.courseName,
                                        style =
                                            MaterialTheme.typography.bodySmall.copy(
                                                fontWeight = FontWeight.Bold,
                                            ),
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = "${slot.startTime}–${slot.endTime} @ ${slot.room ?: "—"}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }

                                // Interactive Attendance Chip (48dp min touch target)
                                val (attText, attBg, attFg) =
                                    when (attStatus) {
                                        "attended" ->
                                            Triple(
                                                "Attended",
                                                StatusColors.successContainer(isDark),
                                                StatusColors.onSuccessContainer(isDark),
                                            )
                                        "absent" ->
                                            Triple(
                                                "Absent",
                                                MaterialTheme.colorScheme.error.copy(alpha = 0.15f),
                                                MaterialTheme.colorScheme.error,
                                            )
                                        "excused" ->
                                            Triple(
                                                "Excused",
                                                StatusColors.warningBadge.copy(alpha = 0.15f),
                                                StatusColors.warningBadge,
                                            )
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
                                            .clip(DayCellShape)
                                            .background(attBg)
                                            .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                                            .clickable {
                                                viewModel.toggleAttendance(slot.id, slot.courseId, date.toString())
                                            }
                                            .padding(horizontal = 10.dp, vertical = 8.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = attText,
                                        style =
                                            MaterialTheme.typography.labelMedium.copy(
                                                fontWeight = FontWeight.Bold,
                                            ),
                                        color = attFg,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                        }

                        // 3. Custom events
                        dayEvents.forEach { event ->
                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(1.dp, CustomEventPink.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                                        .padding(12.dp),
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
                                        style =
                                            MaterialTheme.typography.bodySmall.copy(
                                                fontWeight = FontWeight.Bold,
                                            ),
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = CalendarDayResolver.formatCustomEventTime(event.startTime, event.endTime),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                    }
                }
            }
        }
    }
}
