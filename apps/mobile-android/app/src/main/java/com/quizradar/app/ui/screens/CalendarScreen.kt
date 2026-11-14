@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
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
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.calendar.CalendarBlock
import com.quizradar.app.ui.calendar.CalendarDayContents
import com.quizradar.app.ui.calendar.CalendarDayResolver
import com.quizradar.app.ui.calendar.CalendarGrid
import com.quizradar.app.ui.detail.CourseEditorSheet
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.share.SharedEventDraft
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.CustomEventPink
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

private const val DAY_STRIP_TAG = "calendar_day_strip"
private val GRID_TIME_GUTTER_WIDTH = 38.dp

/** One authored motion token: 200ms, exponential ease-out (brief §6). */
private const val CALENDAR_MOTION_MILLIS = 200
private val CalendarEaseOutExpo = CubicBezierEasing(0.19f, 1f, 0.22f, 1f)

private const val MILLIS_PER_DAY = 86_400_000L

private val DayCellShape = RoundedCornerShape(percent = 50)

private fun buildCourseColorMap(courses: List<CourseModel>): Map<String, String?> =
    buildMap {
        courses.forEach { course ->
            put(course.id, course.color)
        }
    }

private fun resolveStoredCourseColor(
    courseId: String?,
    courseColorById: Map<String, String?>,
): String? {
    if (courseId.isNullOrBlank()) return null
    return courseColorById[courseId]
        ?: courseColorById.entries.firstOrNull { it.key.equals(courseId, ignoreCase = true) }?.value
}

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
): Int {
    val maxOffset = (weekSize - dayCount).coerceAtLeast(0)
    return (selectedIdx.coerceAtLeast(0) - (dayCount - 1) / 2).coerceIn(0, maxOffset)
}

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
    val courseColorById =
        remember(snapshot.schedule.courses) {
            buildCourseColorMap(snapshot.schedule.courses)
        }
    val isCalendarCompletelyEmpty =
        snapshot.schedule.courses.isEmpty() &&
            snapshot.assessments.isEmpty() &&
            snapshot.customEvents.isEmpty()
    var showAddCourseSheet by remember { mutableStateOf(false) }

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

    // Dynamic empty-day removal: keep only days that actually have at least
    // one lecture, tutorial, lab, assessment, study block, or custom event
    // so populated days expand across the full screen width. When the entire
    // week has 0 items, keep all 7 days so empty states remain actionable.
    val (displayDates, displayContents) =
        remember(weekDates, weekContents) {
            val paired = weekDates.zip(weekContents)
            val nonEmpty = paired.filter { (_, contents) -> !contents.isEmpty }
            if (nonEmpty.isNotEmpty()) {
                nonEmpty.map { it.first } to nonEmpty.map { it.second }
            } else {
                weekDates to weekContents
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
        val usesGridGutter = viewMode != CalendarViewMode.DAY
        val activeDayCount = displayDates.size.coerceAtLeast(1)
        val visibleCellCount =
            when (viewMode) {
                CalendarViewMode.WEEK -> activeDayCount
                CalendarViewMode.THREE_DAY -> minOf(3, activeDayCount)
                CalendarViewMode.DAY ->
                    if (maxWidth >= 380.dp) activeDayCount else minOf(3, activeDayCount)
            }
        val cellWidth =
            if (usesGridGutter) {
                (maxWidth - GRID_TIME_GUTTER_WIDTH) / visibleCellCount
            } else {
                (maxWidth - 40.dp) / visibleCellCount
            }

        val effectiveSelectedDate =
            if (selectedDate in displayDates) {
                selectedDate
            } else {
                displayDates.firstOrNull { !it.isBefore(selectedDate) } ?: displayDates.first()
            }
        val selectedIdx = displayDates.indexOf(effectiveSelectedDate).coerceAtLeast(0)
        val stripAnchor =
            when (viewMode) {
                CalendarViewMode.WEEK -> 0
                CalendarViewMode.THREE_DAY ->
                    windowOffsetFor(selectedIdx, visibleCellCount, activeDayCount)
                CalendarViewMode.DAY ->
                    if (visibleCellCount >= activeDayCount) {
                        0
                    } else {
                        windowOffsetFor(selectedIdx, visibleCellCount, activeDayCount)
                    }
            }

        Column(modifier = Modifier.fillMaxSize()) {
            // ---- Title row (48dp): range -> DatePickerDialog, muted semester
            // subtitle under the range; trailing side: Today pill, the
            // Day/3-Day/Week segments and the week paging arrows.
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
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

            // ---- Day strip: aligned directly over grid columns in 3-Day and
            // Week views (including the 38dp left time gutter).
            CalendarDayStrip(
                weekDates = displayDates,
                weekContents = displayContents,
                selectedDate = effectiveSelectedDate,
                today = today,
                cellWidth = cellWidth,
                anchorIndex = stripAnchor,
                alignWithGridGutter = usesGridGutter,
                animationsEnabled = animationsEnabled,
                onSelectDate = { viewModel.setSelectedCalendarDate(it) },
                modifier = Modifier.fillMaxWidth(),
            )

            if (isCalendarCompletelyEmpty) {
                CalendarEmptyCtaCard(
                    onAddCourse = { showAddCourseSheet = true },
                    onAddEvent = {
                        viewModel.openCreateEventDraft(
                            SharedEventDraft(
                                title = "",
                                notes = "",
                                dateIso = selectedDate,
                            ),
                        )
                    },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }

            // ---- Grid / agenda content (one motion moment: the mode swap).
            val modeContent: @Composable (CalendarViewMode) -> Unit = { mode ->
                CalendarModeContent(
                    mode = mode,
                    weekDates = displayDates,
                    weekContents = displayContents,
                    selectedDate =
                        if (mode == CalendarViewMode.DAY) selectedDate else effectiveSelectedDate,
                    snapshot = snapshot,
                    courseColorById = courseColorById,
                    onSwitchToDay = { date ->
                        viewModel.setSelectedCalendarDate(date)
                        viewMode = CalendarViewMode.DAY
                    },
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

        if (showAddCourseSheet) {
            val addCourseSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
            CourseEditorSheet(
                course = null,
                initialSlots = emptyList(),
                sheetState = addCourseSheetState,
                onDismiss = { showAddCourseSheet = false },
                onSave = { newCourse, slots ->
                    viewModel.upsertCourse(newCourse, slots)
                    showAddCourseSheet = false
                },
            )
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

/** Empty-calendar prompt shown when no courses, assessments, or custom events exist yet. */
@Composable
private fun CalendarEmptyCtaCard(
    onAddCourse: () -> Unit,
    onAddEvent: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.quietCardColors(),
        border = CardDefaults.quietCardBorder(),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "Your calendar is clear",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Add a course timetable or schedule a study block to fill your week.",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp, lineHeight = 16.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = onAddCourse,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.filledPill(),
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("+ Add Course", style = MaterialTheme.typography.labelLarge)
                }
                OutlinedButton(
                    onClick = onAddEvent,
                    shape = RoundedCornerShape(10.dp),
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Text("+ Event", style = MaterialTheme.typography.labelLarge)
                }
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
    Column(
        modifier =
            modifier
                .defaultMinSize(minHeight = 48.dp)
                .clip(RoundedCornerShape(8.dp))
                .clickable(
                    role = Role.Button,
                    onClickLabel = "Change calendar date",
                    onClick = onOpenDatePicker,
                )
                .padding(vertical = 2.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = headerRange,
                style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(modifier = Modifier.width(4.dp))
            Icon(
                imageVector = Icons.Outlined.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            text = semesterLabel,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** "Today" as a squarish tonal button matching the Day/3-Day/Week segmented control. */
@Composable
private fun CalendarTodayButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FilledTonalButton(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        colors =
            ButtonDefaults.filledTonalButtonColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                contentColor = MaterialTheme.colorScheme.onSurface,
            ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f)),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        modifier = modifier.defaultMinSize(minWidth = 72.dp, minHeight = 42.dp),
    ) {
        Text(
            text = "Today",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
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
    val trackShape = RoundedCornerShape(12.dp)
    val pillShape = RoundedCornerShape(9.dp)
    Row(
        modifier =
            modifier
                .selectableGroup()
                .width(IntrinsicSize.Min)
                .clip(trackShape)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
                    shape = trackShape,
                ).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CalendarViewMode.entries.forEach { candidate ->
            val isSelected = mode == candidate
            val containerColor =
                if (isSelected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    Color.Transparent
                }
            val contentColor =
                if (isSelected) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            Box(
                modifier =
                    Modifier
                        .defaultMinSize(minWidth = 64.dp, minHeight = 36.dp)
                        .clip(pillShape)
                        .background(containerColor)
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
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
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
    alignWithGridGutter: Boolean,
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

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(
                    start = if (alignWithGridGutter) GRID_TIME_GUTTER_WIDTH else 20.dp,
                    end = if (alignWithGridGutter) 0.dp else 20.dp,
                    top = 4.dp,
                    bottom = 4.dp,
                ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LazyRow(
            state = listState,
            flingBehavior = snapFlingBehavior,
            modifier =
                Modifier
                    .weight(1f)
                    .heightIn(min = 64.dp)
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
}

/**
 * One day cell: weekday label (labelMedium) + date number (15sp/600 tabular).
 * Selected = filled primary pill with onPrimary content; today = 4dp primary
 * dot under the number; days with items = 4dp status dots (one per layer).
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
    val isCompactCell = cellWidth < 68.dp
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
                .padding(horizontal = if (isCompactCell) 1.dp else 2.dp)
                .heightIn(min = 60.dp)
                .clip(DayCellShape)
                .selectable(
                    selected = isSelected,
                    role = Role.Tab,
                    onClick = { onSelect(date) },
                ).semantics {
                    contentDescription = cellLabel
                    if (stateParts.isNotEmpty()) stateDescription = stateParts.joinToString(", ")
                },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier =
                Modifier
                    .widthIn(
                        min = if (isCompactCell) 42.dp else 54.dp,
                        max = 62.dp,
                    ).clip(DayCellShape)
                    .background(containerColor)
                    .padding(
                        horizontal = if (isCompactCell) 4.dp else 10.dp,
                        vertical = 6.dp,
                    ),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = date.dayOfWeek.name.take(3),
                style =
                    if (isCompactCell) {
                        MaterialTheme.typography.labelSmall
                    } else {
                        MaterialTheme.typography.labelMedium
                    },
                maxLines = 1,
                softWrap = false,
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
            if (contents.totalCount > 0) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (contents.slots.isNotEmpty()) {
                        CalendarStatusDot(
                            if (isSelected) {
                                MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f)
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                        )
                    }
                    if (contents.assessments.isNotEmpty()) {
                        CalendarStatusDot(
                            if (isSelected) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.error
                            },
                        )
                    }
                    if (contents.customEvents.isNotEmpty()) {
                        CalendarStatusDot(
                            if (isSelected) {
                                MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f)
                            } else {
                                CustomEventPink
                            },
                        )
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
                .size(4.dp)
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
    courseColorById: Map<String, String?>,
    onSwitchToDay: (LocalDate) -> Unit,
    viewModel: QuizRadarViewModel,
) {
    val handleBlockClick: (LocalDate, CalendarBlock) -> Unit = { blockDate, block ->
        val assessmentId = block.assessmentId
        if (assessmentId != null) {
            viewModel.openAssessmentDetail(assessmentId)
        } else {
            onSwitchToDay(blockDate)
        }
    }

    when (mode) {
        CalendarViewMode.DAY ->
            CalendarAgendaView(
                displayedDates = listOf(selectedDate),
                snapshot = snapshot,
                viewModel = viewModel,
                modifier = Modifier.fillMaxSize(),
            )
        CalendarViewMode.THREE_DAY -> {
            val windowSize = minOf(3, weekDates.size).coerceAtLeast(1)
            val offset = windowOffsetFor(weekDates.indexOf(selectedDate), windowSize, weekDates.size)
            val end = (offset + windowSize).coerceAtMost(weekDates.size)
            CalendarGrid(
                dates = weekDates.subList(offset, end),
                days = weekContents.subList(offset, end),
                courseColorById = courseColorById,
                onBlockClick = { block ->
                    block.assessmentId?.let { viewModel.openAssessmentDetail(it) }
                },
                onDayBlockClick = handleBlockClick,
                onHourClick = { date, hourSlot -> openStudyBlockDraft(viewModel, date, hourSlot) },
                modifier = Modifier.fillMaxSize(),
            )
        }
        CalendarViewMode.WEEK ->
            CalendarGrid(
                dates = weekDates,
                days = weekContents,
                courseColorById = courseColorById,
                onBlockClick = { block ->
                    block.assessmentId?.let { viewModel.openAssessmentDetail(it) }
                },
                onDayBlockClick = handleBlockClick,
                onHourClick = { date, hourSlot -> openStudyBlockDraft(viewModel, date, hourSlot) },
                modifier = Modifier.fillMaxSize(),
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

private data class AttendanceChipStyle(
    val label: String,
    val stateDesc: String,
    val background: Color,
    val foreground: Color,
)

private sealed interface AgendaEntry {
    val sortMinutes: Int
    val kindOrder: Int

    data class Exam(
        val assessment: AssessmentModel,
        override val sortMinutes: Int,
    ) : AgendaEntry {
        override val kindOrder: Int = 0
    }

    data class ClassSlot(
        val slot: ScheduleSlotModel,
        override val sortMinutes: Int,
    ) : AgendaEntry {
        override val kindOrder: Int = 1
    }

    data class CustomEvent(
        val event: CustomEventModel,
        override val sortMinutes: Int,
    ) : AgendaEntry {
        override val kindOrder: Int = 2
    }
}

private fun parseAgendaSortMinutes(rawTime: String?): Int {
    if (rawTime.isNullOrBlank()) return -1
    val match = Regex("""^(\d{1,2})[:.](\d{2})""").find(rawTime.trim()) ?: return -1
    val hour = match.groupValues[1].toIntOrNull() ?: return -1
    val minute = match.groupValues[2].toIntOrNull() ?: return -1
    return if (hour in 0..23 && minute in 0..59) hour * 60 + minute else -1
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
    val courseColorById =
        remember(snapshot.schedule.courses) {
            buildCourseColorMap(snapshot.schedule.courses)
        }

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
            val totalCount = dayContents.totalCount
            val chronologicalEntries =
                remember(dayContents) {
                    buildList {
                        dayContents.assessments.forEach { exam ->
                            add(
                                AgendaEntry.Exam(
                                    assessment = exam,
                                    sortMinutes = parseAgendaSortMinutes(exam.startTime ?: exam.displayTime),
                                ),
                            )
                        }
                        dayContents.slots.forEach { slot ->
                            add(
                                AgendaEntry.ClassSlot(
                                    slot = slot,
                                    sortMinutes = parseAgendaSortMinutes(slot.startTime),
                                ),
                            )
                        }
                        dayContents.customEvents.forEach { event ->
                            add(
                                AgendaEntry.CustomEvent(
                                    event = event,
                                    sortMinutes = parseAgendaSortMinutes(event.startTime),
                                ),
                            )
                        }
                    }.sortedWith(compareBy<AgendaEntry> { it.sortMinutes }.thenBy { it.kindOrder })
                }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors =
                    CardDefaults.cardColors(
                        containerColor =
                            if (isToday) {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (isDark) 0.55f else 0.7f)
                            } else {
                                MaterialTheme.colorScheme.surface
                            },
                    ),
                shape = RoundedCornerShape(16.dp),
                border =
                    BorderStroke(
                        1.dp,
                        if (isToday) {
                            MaterialTheme.colorScheme.primary.copy(alpha = if (isDark) 0.4f else 0.5f)
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

                    if (chronologicalEntries.isEmpty()) {
                        Text(
                            text = "No classes, exams, or events scheduled.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    } else {
                        chronologicalEntries.forEachIndexed { index, entry ->
                            when (entry) {
                                is AgendaEntry.Exam -> {
                                    val exam = entry.assessment
                                    val course =
                                        snapshot.schedule.courses.find {
                                            it.id.equals(exam.courseId, ignoreCase = true)
                                        }
                                    val storedHex = resolveStoredCourseColor(exam.courseId, courseColorById)
                                    val accentTextColor =
                                        CoursePalette.textOnSurface(exam.courseId, isDark, storedHex)

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
                                                    color = accentTextColor,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                            Spacer(modifier = Modifier.height(2.dp))
                                            Text(
                                                text = exam.title,
                                                style = MaterialTheme.typography.titleSmall,
                                                color = MaterialTheme.colorScheme.onSurface,
                                            )
                                            Text(
                                                text = "${exam.displayTime ?: "All day"} · ${exam.room?.takeIf { it.isNotBlank() } ?: "—"}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                                is AgendaEntry.ClassSlot -> {
                                    val slot = entry.slot
                                    val storedHex = resolveStoredCourseColor(slot.courseId, courseColorById)
                                    val palette = CoursePalette.get(slot.courseId, storedHex)
                                    val accentTextColor =
                                        CoursePalette.textOnSurface(slot.courseId, isDark, storedHex)
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
                                                    .background(palette.color),
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
                                                    color = accentTextColor,
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
                                                text =
                                                    "${slot.startTime}–${slot.endTime} · " +
                                                        (slot.room?.takeIf { it.isNotBlank() } ?: "—"),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Spacer(modifier = Modifier.width(8.dp))

                                        // Interactive Attendance Chip (48dp min touch target)
                                        val chipStyle =
                                            when (attStatus) {
                                                "attended" ->
                                                    AttendanceChipStyle(
                                                        label = "Attended",
                                                        stateDesc = "Attended",
                                                        background = StatusColors.successContainer(isDark),
                                                        foreground = StatusColors.onSuccessContainer(isDark),
                                                    )
                                                "absent" ->
                                                    AttendanceChipStyle(
                                                        label = "Absent",
                                                        stateDesc = "Absent",
                                                        background = MaterialTheme.colorScheme.error.copy(alpha = 0.15f),
                                                        foreground = MaterialTheme.colorScheme.error,
                                                    )
                                                "excused" ->
                                                    AttendanceChipStyle(
                                                        label = "Excused",
                                                        stateDesc = "Excused",
                                                        background = StatusColors.warningBadge.copy(alpha = 0.15f),
                                                        foreground = StatusColors.warningBadge,
                                                    )
                                                else ->
                                                    AttendanceChipStyle(
                                                        label = "Mark present",
                                                        stateDesc = "Not marked",
                                                        background = MaterialTheme.colorScheme.surfaceVariant,
                                                        foreground = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    )
                                            }

                                        Box(
                                            modifier =
                                                Modifier
                                                    .clip(DayCellShape)
                                                    .background(chipStyle.background)
                                                    .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                                                    .clickable {
                                                        viewModel.toggleAttendance(
                                                            slot.id,
                                                            slot.courseId,
                                                            date.toString(),
                                                        )
                                                    }
                                                    .semantics {
                                                        contentDescription =
                                                            "Attendance for ${slot.courseName} ${slot.type}"
                                                        stateDescription = chipStyle.stateDesc
                                                    }
                                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Text(
                                                text = chipStyle.label,
                                                style =
                                                    MaterialTheme.typography.labelMedium.copy(
                                                        fontWeight = FontWeight.Bold,
                                                    ),
                                                color = chipStyle.foreground,
                                            )
                                        }
                                    }
                                }
                                is AgendaEntry.CustomEvent -> {
                                    val event = entry.event
                                    val storedHex = resolveStoredCourseColor(event.courseId, courseColorById)
                                    val barColor =
                                        if (!event.courseId.isNullOrBlank()) {
                                            CoursePalette.get(event.courseId, storedHex).color
                                        } else {
                                            CustomEventPink
                                        }
                                    val timeLabel =
                                        CalendarDayResolver.formatCustomEventTime(
                                            event.startTime,
                                            event.endTime,
                                        )
                                    val metaLine =
                                        listOfNotNull(
                                            timeLabel.takeIf { it.isNotBlank() },
                                            event.room?.takeIf { it.isNotBlank() } ?: "—",
                                        ).joinToString(" · ")

                                    Row(
                                        modifier =
                                            Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(12.dp))
                                                .background(MaterialTheme.colorScheme.surface)
                                                .border(
                                                    1.dp,
                                                    barColor.copy(alpha = 0.5f),
                                                    RoundedCornerShape(12.dp),
                                                )
                                                .padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Box(
                                            modifier =
                                                Modifier
                                                    .width(4.dp)
                                                    .height(30.dp)
                                                    .clip(RoundedCornerShape(2.dp))
                                                    .background(barColor),
                                        )
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = event.title,
                                                style =
                                                    MaterialTheme.typography.bodySmall.copy(
                                                        fontWeight = FontWeight.Bold,
                                                    ),
                                                color = MaterialTheme.colorScheme.onSurface,
                                            )
                                            Text(
                                                text = metaLine,
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                            event.notes?.takeIf { it.isNotBlank() }?.let { noteText ->
                                                Spacer(modifier = Modifier.height(2.dp))
                                                Text(
                                                    text = noteText,
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    maxLines = 2,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                            if (index < chronologicalEntries.lastIndex) {
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(88.dp))
    }
}
