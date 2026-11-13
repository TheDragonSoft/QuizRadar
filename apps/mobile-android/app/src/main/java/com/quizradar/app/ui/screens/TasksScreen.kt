package com.quizradar.app.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.DailyRoadmapCard
import com.quizradar.app.ui.components.ReadinessCard
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.tonalPill

/**
 * Label of a course filter chip: the course NAME (web parity - the web tier
 * never prints the raw id slug). The id is only a fallback for a course
 * that has no name at all.
 */
fun formatCourseFilterLabel(
    courseName: String?,
    courseId: String,
): String {
    val name = courseName?.trim()
    return if (!name.isNullOrEmpty()) name else courseId
}

/**
 * The real blocker behind an empty Tasks screen. The copy AND the action
 * must match it (audit P3-4): a student with no courses cannot fix a missing
 * source, and a student without a connected source cannot fix a missing
 * course - offering the wrong one is a dead end, not help.
 */
private enum class TasksBlocker {
    /** No course on the timetable yet - the planner has nothing to plan for. */
    NoCourses,

    /** Courses exist, but no announcement source is connected - nothing can be scanned. */
    NoSource,

    /** Courses and a source exist, but no assessment is on the radar yet. */
    NoAssessments,

    /** Everything is set up; there simply is nothing due. */
    AllCaughtUp,
}

/**
 * One course filter chip - the app's one filter-chip look
 * (docs/ANDROID-DESIGN-SYSTEM.md §4).
 *
 * The selection is carried by real semantics, not by colour alone: the chip
 * is `selectable` under the hood so TalkBack announces "selected", and the
 * leading check icon repeats the state visually.
 */
@Composable
private fun CourseFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
            )
        },
        leadingIcon = { if (selected) ChipLeadingCheck() },
        colors = FilterChipDefaults.quietChipColors(),
        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
    )
}

/**
 * The empty state of one Tasks section.
 *
 * The message names the ACTUAL blocker and the button below it is the one
 * that clears that blocker - never a generic "scan" that contradicts the
 * copy (audit P3-4: "Tasks says add courses but offers scan, including with
 * no source connected").
 */
@Composable
private fun TasksEmptyStateCard(
    message: String,
    blocker: TasksBlocker,
    courseFilterActive: Boolean,
    scanFailure: String?,
    onShowAllCourses: () -> Unit,
    onAddCourse: () -> Unit,
    onConnectSource: () -> Unit,
    onAddAssessment: () -> Unit,
    onScan: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (scanFailure != null) {
                // Inline, specific error (global rule: never toast-only). The
                // source name and the core's own detail string are shown as-is.
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Last scan failed - $scanFailure",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Spacer(modifier = Modifier.height(16.dp))
            if (courseFilterActive) {
                TextButton(
                    onClick = onShowAllCourses,
                    modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                ) {
                    Text("Show all courses", style = MaterialTheme.typography.labelMedium)
                }
                return@Column
            }
            when (blocker) {
                TasksBlocker.NoCourses ->
                    Button(
                        onClick = onAddCourse,
                        colors = ButtonDefaults.filledPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Add course", style = MaterialTheme.typography.labelMedium)
                    }

                TasksBlocker.NoSource -> {
                    Button(
                        onClick = onConnectSource,
                        colors = ButtonDefaults.filledPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Connect source", style = MaterialTheme.typography.labelMedium)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    FilledTonalButton(
                        onClick = onScan,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Scan sources", style = MaterialTheme.typography.labelMedium)
                    }
                }

                TasksBlocker.NoAssessments -> {
                    Button(
                        onClick = onAddAssessment,
                        colors = ButtonDefaults.filledPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Add assessment", style = MaterialTheme.typography.labelMedium)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    FilledTonalButton(
                        onClick = onScan,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Text("Scan sources", style = MaterialTheme.typography.labelMedium)
                    }
                }

                // Nothing is missing and nothing is due - there is no action to
                // offer that would honestly change the outcome.
                TasksBlocker.AllCaughtUp -> Unit
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
    onAddCourse: () -> Unit = { viewModel.selectTab("Dashboard") },
    onConnectSource: () -> Unit = { viewModel.selectTab("Dashboard") },
    onAddAssessment: () -> Unit = { viewModel.selectTab("Calendar") },
    onOpenGradeCenter: () -> Unit = { viewModel.selectTab("Grade Center") },
) {
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val courseFilter by viewModel.tasksCourseFilter.collectAsState()
    val googleConnected by viewModel.googleConnected.collectAsState()
    val microsoftConnected by viewModel.microsoftConnected.collectAsState()
    val gmailEnabled by viewModel.gmailEnabled.collectAsState()
    val classroomEnabled by viewModel.classroomEnabled.collectAsState()
    val teamsEnabled by viewModel.teamsEnabled.collectAsState()
    val lastScanReport by viewModel.lastScanReport.collectAsState()

    val tasks = snapshot.tasks
    val completedTopics = snapshot.completedTopics
    val courses = snapshot.schedule.courses

    val filteredCards =
        tasks.readinessCards.filter { card ->
            if (courseFilter == "ALL") true else card.courseId == courseFilter
        }

    val filteredDays =
        tasks.days
            .map { dayGroup ->
                val dayTasks =
                    dayGroup.tasks.filter { task ->
                        if (courseFilter == "ALL") true else task.courseId == courseFilter
                    }
                dayGroup.copy(tasks = dayTasks)
            }
            .filter { it.tasks.isNotEmpty() }

    // The summary line must describe exactly what the two sections below it
    // render (after the course filter) - the unfiltered payload counts used
    // to contradict the filtered lists.
    val pendingCount = filteredDays.sumOf { day -> day.tasks.count { !it.completed } }
    val upcomingCount = filteredCards.size
    // An estimate is only claimed when every visible task carries one.
    val visibleTasks = filteredDays.flatMap { it.tasks }
    val visibleHours =
        if (visibleTasks.isNotEmpty() && visibleTasks.all { it.estimatedHours != null }) {
            visibleTasks.sumOf { (it.estimatedHours ?: 0f).toDouble() }
        } else {
            null
        }
    val hoursStr = if (visibleHours != null) " • Est. $visibleHours hrs" else ""

    // A source is "connected" when a scan would really have something to do:
    // a signed-in account whose source toggle is on, or an enabled .ics feed.
    // This mirrors `QuizRadarViewModel.hasConfiguredSource`; Moodle is a
    // desktop-only channel on Android, so it is not counted here.
    val hasConnectedSource =
        (googleConnected && (gmailEnabled || classroomEnabled)) ||
            (microsoftConnected && teamsEnabled) ||
            snapshot.feeds.any { it.enabled }

    // The blocker behind the empty sections - resolved BEFORE choosing a CTA.
    val blocker =
        when {
            courses.isEmpty() -> TasksBlocker.NoCourses
            !hasConnectedSource -> TasksBlocker.NoSource
            snapshot.assessments.isEmpty() -> TasksBlocker.NoAssessments
            else -> TasksBlocker.AllCaughtUp
        }
    val courseFilterActive = courseFilter != "ALL"

    // The last scan's own per-source verdict, quoted verbatim. Only a source
    // that really FAILED is shown - a scan that simply found nothing is not
    // an error and must not be dressed up as one.
    val scanFailure =
        lastScanReport
            ?.perSource
            ?.firstOrNull { it.status == "failed" }
            ?.let { failed ->
                val detail = failed.detail?.trim()
                if (detail.isNullOrEmpty()) {
                    "${failed.name} failed during the last scan."
                } else {
                    "${failed.name}: $detail"
                }
            }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = { viewModel.refreshState() },
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 20.dp),
            contentPadding = PaddingValues(bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { Spacer(modifier = Modifier.height(8.dp)) }

            // Header: Title, honest summary line and the Grade Center entry.
            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Daily Study Roadmap",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        // "study steps", not "topics": when an announcement
                        // named no syllabus topics the planner still schedules
                        // generic review steps, and calling those topics
                        // would contradict the readiness card right below.
                        text = "$pendingCount pending study steps across $upcomingCount upcoming exams$hoursStr",
                        style =
                            MaterialTheme.typography.bodySmall.copy(
                                fontFeatureSettings = "tnum",
                            ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    // Grade Center (GPA / grade history) lives on its own
                    // screen; this is the entry point from the Tasks tab.
                    FilledTonalButton(
                        onClick = onOpenGradeCenter,
                        colors = ButtonDefaults.tonalPill(),
                        contentPadding = PillButtonContentPadding,
                        modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.School,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Grade Center", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }

            // Course Filter Chips
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CourseFilterChip(
                        label = "All Courses",
                        selected = courseFilter == "ALL",
                        onClick = { viewModel.setTasksCourseFilter("ALL") },
                    )

                    courses.forEach { course ->
                        CourseFilterChip(
                            label = formatCourseFilterLabel(course.name, course.id),
                            selected = courseFilter == course.id,
                            onClick = { viewModel.setTasksCourseFilter(course.id) },
                        )
                    }
                }
            }

            // Section 1: Exam Readiness Cards
            item {
                Text(
                    text = "Exam Readiness (${filteredCards.size})",
                    style =
                        MaterialTheme.typography.titleMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            if (filteredCards.isEmpty()) {
                item {
                    val message =
                        if (courseFilterActive) {
                            "No exams matching this course filter."
                        } else {
                            when (blocker) {
                                TasksBlocker.NoCourses ->
                                    "Add a course and its weekly class times so QuizRadar can resolve exam dates for it."

                                TasksBlocker.NoSource ->
                                    "Your courses are ready, but no announcement source is " +
                                        "connected yet - connect one, then scan for exam announcements."

                                TasksBlocker.NoAssessments ->
                                    "Courses and a source are ready, but no assessment is on your radar yet."

                                TasksBlocker.AllCaughtUp ->
                                    "No upcoming exams tracked on your radar yet."
                            }
                        }
                    TasksEmptyStateCard(
                        message = message,
                        blocker = blocker,
                        courseFilterActive = courseFilterActive,
                        scanFailure = scanFailure,
                        onShowAllCourses = { viewModel.setTasksCourseFilter("ALL") },
                        onAddCourse = onAddCourse,
                        onConnectSource = onConnectSource,
                        onAddAssessment = onAddAssessment,
                        onScan = { viewModel.runScan() },
                    )
                }
            } else {
                itemsIndexed(filteredCards, key = { _, card -> card.assessmentId }) { _, card ->
                    ReadinessCard(
                        card = card,
                        onClick = { viewModel.openAssessmentDetail(card.assessmentId) },
                    )
                }
            }

            // Section 2: Daily Study Roadmap Cards
            item {
                Text(
                    text = "Daily Study Schedule",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            if (filteredDays.isEmpty()) {
                item {
                    val message =
                        if (courseFilterActive) {
                            "No study tasks scheduled for this course."
                        } else {
                            when (blocker) {
                                TasksBlocker.NoCourses ->
                                    "Add a course and its weekly class times so QuizRadar can build a personalized study roadmap."

                                TasksBlocker.NoSource ->
                                    "Your courses are ready, but no announcement source is " +
                                        "connected yet - connect one, then scan for exam announcements."

                                TasksBlocker.NoAssessments ->
                                    "Courses and a source are ready, but there is no assessment to plan study steps from yet."

                                TasksBlocker.AllCaughtUp ->
                                    "All caught up! No pending study tasks for the next 14 days."
                            }
                        }
                    TasksEmptyStateCard(
                        message = message,
                        blocker = blocker,
                        courseFilterActive = courseFilterActive,
                        scanFailure = scanFailure,
                        onShowAllCourses = { viewModel.setTasksCourseFilter("ALL") },
                        onAddCourse = onAddCourse,
                        onConnectSource = onConnectSource,
                        onAddAssessment = onAddAssessment,
                        onScan = { viewModel.runScan() },
                    )
                }
            } else {
                itemsIndexed(filteredDays, key = { _, dayGroup -> dayGroup.dayOffset }) { _, dayGroup ->
                    DailyRoadmapCard(
                        dayGroup = dayGroup,
                        completedTopicsMap = completedTopics,
                        onToggleTopic = { key, done -> viewModel.toggleTopic(key, done) },
                    )
                }
            }

            item { Spacer(modifier = Modifier.height(16.dp)) }
        }
    }
}
