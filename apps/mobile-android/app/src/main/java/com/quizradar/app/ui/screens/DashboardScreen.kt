package com.quizradar.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.model.DailyStudyTaskModel
import com.quizradar.app.model.FeedConfigModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.CompactSetupPanel
import com.quizradar.app.ui.components.CompactSetupStep
import com.quizradar.app.ui.components.ConflictBanner
import com.quizradar.app.ui.components.NextUpHeroCard
import com.quizradar.app.ui.components.StatusTag
import com.quizradar.app.ui.components.StudyRecommendationCard
import com.quizradar.app.ui.components.TimelineAssessmentRow
import com.quizradar.app.ui.extractTimePart
import com.quizradar.app.ui.formatIsoDateForDisplay
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.tonalPill

internal fun formatReadinessDisplay(
    totalTopicsCount: Int,
    completedTopicsCount: Int,
    readinessPercent: Int,
): Pair<String, String> {
    if (totalTopicsCount <= 0) {
        return "—" to "No study topics tracked yet"
    }
    val pct = readinessPercent.coerceIn(0, 100)
    val unit = if (totalTopicsCount == 1) "topic" else "topics"
    return "$pct%" to "$completedTopicsCount of $totalTopicsCount $unit mastered"
}

/**
 * The "Connected Sources" KPI counts the sources this device is really
 * connected to: the signed-in accounts (which let the on-device Gmail/
 * Classroom/Teams scans run) plus the enabled .ics feeds. The source labels
 * on the upcoming items say where the DATA came from (a backup import), which
 * is not a live connection; presenting them as "connected sources" claimed
 * accounts the phone does not have.
 *
 * `lastSynced` is the stamp the Rust core writes ONLY after a scan in which a
 * source really ran - shown verbatim, never fabricated for an empty scan.
 */
internal fun formatSourcesDisplay(
    feeds: List<FeedConfigModel>,
    sourcesCount: Map<String, Int>,
    accountsConnected: Int = 0,
    lastSynced: String? = null,
): Pair<String, String> {
    val connected = feeds.count { it.enabled } + accountsConnected
    val headline =
        when (connected) {
            0 -> "No sources connected"
            1 -> "1 source connected"
            else -> "$connected sources connected"
        }
    val base =
        when {
            connected == 0 -> "On-device engine ready — import backup or add events"
            accountsConnected > 0 -> {
                val feedCount = feeds.count { it.enabled }
                buildString {
                    append(
                        if (accountsConnected == 1) "1 account" else "$accountsConnected accounts",
                    )
                    if (feedCount > 0) {
                        append(" + $feedCount .ics feed${if (feedCount > 1) "s" else ""}")
                    }
                    append(" scan on this device")
                }
            }
            else -> "ICS feed${if (connected > 1) "s" else ""} fetched on this device"
        }
    val radarSources = sourcesCount.filter { it.value > 0 }.keys.sorted()
    val withRadar =
        if (radarSources.isEmpty()) {
            base
        } else {
            "$base — your radar holds items from ${radarSources.joinToString(", ")}"
        }
    val subtitle =
        if (lastSynced.isNullOrBlank()) {
            withRadar
        } else {
            "$withRadar · Last synced $lastSynced"
        }
    return headline to subtitle
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    onViewCalendar: () -> Unit,
    onOpenAccount: () -> Unit = {},
    onAddCourse: () -> Unit = {},
    onImportBackup: () -> Unit = {},
    onAddEvent: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f

    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val isScanning by viewModel.isScanning.collectAsState()
    val scanProgress by viewModel.scanProgress.collectAsState()
    val lastScanReport by viewModel.lastScanReport.collectAsState()
    val lastSyncedStamp by viewModel.lastSyncedStamp.collectAsState()
    val isConflictDismissed by viewModel.isConflictDismissed.collectAsState()
    val isSetupChecklistDismissed by viewModel.isSetupChecklistDismissed.collectAsState()
    val notifyExam24h by viewModel.notifyExam24h.collectAsState()
    val sourceFilter by viewModel.activeSourceFilter.collectAsState()
    val typeFilter by viewModel.activeTypeFilter.collectAsState()

    val hasNotificationPermission =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    // The permission answer is kept in local state as well, so the reminders
    // step flips to "done" the moment the student grants it (the launcher
    // result is the only event that tells us the answer changed).
    var notificationPermissionGranted by remember { mutableStateOf(false) }
    val notificationGranted = notificationPermissionGranted || hasNotificationPermission

    val notificationPermissionLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.RequestPermission(),
        ) { isGranted ->
            notificationPermissionGranted = isGranted
            if (isGranted) {
                viewModel.setNotifyExam24h(true)
                viewModel.showToast("Exam reminders enabled")
            }
        }

    val coursesDone = snapshot.schedule.courses.isNotEmpty()
    val accountsConnected =
        (if (viewModel.isGoogleConnected()) 1 else 0) +
            (if (viewModel.isMicrosoftConnected()) 1 else 0)
    val feedsEnabled = snapshot.feeds.count { it.enabled }
    // A source is "done" when this phone can really scan something: a signed
    // in account and/or an enabled .ics feed.
    val sourcesDone = accountsConnected > 0 || feedsEnabled > 0
    val remindersDone = notificationGranted && notifyExam24h

    val dash = snapshot.dashboard
    val assessments = snapshot.assessments
    val completedTopics = snapshot.completedTopics
    val radarIsEmpty = assessments.isEmpty()

    // The timeline starts at the genuinely upcoming items; the type and
    // source chips narrow that list further. The type filter used to be
    // consumed here without any control at all (audit A12).
    val upcomingAssessments = assessments.filter { it.isUpcoming }
    val filteredTimeline =
        upcomingAssessments.filter { a ->
            if (sourceFilter != "ALL") {
                val src = a.source.uppercase()
                if (!src.contains(sourceFilter)) return@filter false
            }
            if (typeFilter == "UPCOMING") {
                if (!a.isUpcoming) return@filter false
            } else if (typeFilter != "ALL") {
                if (a.assessmentType != typeFilter) return@filter false
            }
            true
        }
    val typeChips =
        buildList {
            add("ALL")
            upcomingAssessments
                .map { it.assessmentType }
                .filter { it.isNotBlank() }
                .distinct()
                .sorted()
                .forEach { add(it) }
            if (typeFilter != "ALL" && typeFilter !in this) add(typeFilter)
        }
    val sourceChips =
        buildList {
            add("ALL")
            upcomingAssessments
                .map { it.source }
                .filter { it.isNotBlank() }
                .map { it.uppercase() }
                .distinct()
                .sorted()
                .forEach { add(it) }
            if (sourceFilter != "ALL" && sourceFilter !in this) add(sourceFilter)
        }
    val nextAssessment = upcomingAssessments.firstOrNull()

    val weekCount = dash.upcomingThisWeek.size
    val hasTrackedTopics = dash.totalTopicsCount > 0
    val readinessPct = if (hasTrackedTopics) dash.readinessPercent.coerceIn(0, 100) else 0
    // The status colour rides the shield icon and the meter only; the
    // readiness number itself stays in ink so it is legible in every theme.
    val readinessColor =
        when {
            !hasTrackedTopics -> MaterialTheme.colorScheme.onSurfaceVariant
            readinessPct >= 80 -> StatusColors.success(isDark)
            readinessPct >= 50 -> StatusColors.warningBadge
            else -> MaterialTheme.colorScheme.error
        }
    val (readinessHeadline, readinessSubtitle) =
        formatReadinessDisplay(
            totalTopicsCount = dash.totalTopicsCount,
            completedTopicsCount = dash.completedTopicsCount,
            readinessPercent = dash.readinessPercent,
        )
    val (sourcesHeadline, sourcesSubtitle) =
        formatSourcesDisplay(snapshot.feeds, dash.sourcesCount, accountsConnected, lastSyncedStamp)
    val hasActiveSources = sourcesDone

    // ONE primary action, matching the step that actually blocks the student
    // (audit P3-4): no timetable -> add a course, no source -> connect one,
    // everything in place -> scan.
    val primaryActionLabel: String
    val primaryAction: () -> Unit
    when {
        !coursesDone -> {
            primaryActionLabel = "Add course"
            primaryAction = onAddCourse
        }
        !sourcesDone -> {
            primaryActionLabel = "Connect source"
            primaryAction = onOpenAccount
        }
        else -> {
            primaryActionLabel = "Scan now"
            primaryAction = { viewModel.runScan() }
        }
    }

    // Turning the reminders on needs the notification permission where the
    // platform asks for one; below Android 13 the permission always exists.
    val enableReminders: () -> Unit = {
        if (!notificationGranted) {
            notificationPermissionLauncher.launch(
                Manifest.permission.POST_NOTIFICATIONS,
            )
        } else {
            viewModel.setNotifyExam24h(true)
        }
    }

    val setupSteps =
        listOf(
            CompactSetupStep(
                icon = Icons.Outlined.School,
                label = "Course",
                status =
                    if (coursesDone) {
                        "Your timetable is in QuizRadar"
                    } else {
                        "No timetable yet"
                    },
                done = coursesDone,
            ),
            CompactSetupStep(
                icon = Icons.Outlined.RssFeed,
                label = "Source",
                status =
                    if (sourcesDone) {
                        "Scanning runs on this device"
                    } else {
                        "No account or feed connected — Settings → Sources"
                    },
                done = sourcesDone,
                actionLabel = if (sourcesDone) null else "Settings",
                onAction = if (sourcesDone) null else onOpenSettings,
            ),
            CompactSetupStep(
                icon = Icons.Outlined.Notifications,
                label = "Reminders",
                status =
                    if (remindersDone) {
                        "Exam reminders are on"
                    } else {
                        "Turn on exam reminders"
                    },
                done = remindersDone,
                actionLabel = if (remindersDone) null else "Enable reminders",
                onAction = if (remindersDone) null else enableReminders,
            ),
        )

    val setupPanel: @Composable () -> Unit = {
        CompactSetupPanel(
            steps = setupSteps,
            primaryActionLabel = primaryActionLabel,
            onPrimaryAction = primaryAction,
            onDismiss = { viewModel.dismissSetupChecklist() },
            dismissed = isSetupChecklistDismissed,
            // When the empty-timeline state card below owns the filled action,
            // the panel's button recedes to tonal - one filled pill per flow.
            primaryTonal = !radarIsEmpty && filteredTimeline.isEmpty(),
        )
    }

    PullToRefreshBox(
        isRefreshing = isRefreshing || isScanning,
        onRefresh = { viewModel.runScan() },
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

            // Empty radar: ONE compact setup panel replaces the old hero +
            // checklist + four-KPI stack (audit P3-1). Nothing else can be
            // true yet, so nothing else is shown.
            if (radarIsEmpty) {
                item { setupPanel() }
                if (isScanning || lastScanReport != null) {
                    item {
                        ScanSourcesCard(
                            isScanning = isScanning,
                            progress = scanProgress,
                            report = lastScanReport,
                            onScanNow = { viewModel.runScan() },
                        )
                    }
                }
                item {
                    // Escape hatches that also put real data on the radar.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        TextButton(
                            onClick = onImportBackup,
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text(
                                text = "Restore a backup",
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                        TextButton(
                            onClick = onAddEvent,
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .defaultMinSize(minHeight = 48.dp),
                        ) {
                            Text(
                                text = "Add an event",
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }
                }
                return@LazyColumn
            }

            // Next Up hero — the desktop radar card (gradient + starfield sky).
            // It sits ABOVE the sub-tab bar: the banner is the one thing that
            // is always true, whatever tab is open.
            item {
                val nextUp = dash.nextUp
                NextUpHeroCard(
                    assessment = nextUp,
                    isDark = isDark,
                    onOpen = nextUp?.let { a -> { viewModel.openAssessmentDetail(a.id) } },
                )
            }

            // Conflict Banner
            item {
                ConflictBanner(
                    alerts = dash.conflictAlerts,
                    customEvents = snapshot.customEvents,
                    isDismissed = isConflictDismissed,
                    onScheduleStudyBlocks = { id -> viewModel.scheduleStudyBlocks(id) },
                    onViewCalendar = onViewCalendar,
                    onDismiss = { viewModel.dismissConflicts() },
                )
            }

            // Compact setup nudge — only while a step is still open.
            if (!isSetupChecklistDismissed) {
                item { setupPanel() }
            }

            // Live scan card: the per-source progress the Rust core reports
            // while running, and the honest per-source outcomes of the last
            // completed run afterwards. No Cancel affordance - the core has no
            // mid-scan cancel, and a fake one would be a lie.
            if (isScanning || lastScanReport != null) {
                item {
                    ScanSourcesCard(
                        isScanning = isScanning,
                        progress = scanProgress,
                        report = lastScanReport,
                        onScanNow = { viewModel.runScan() },
                    )
                }
            }

            // WHAT SHOULD I STUDY NOW? — the core's study recommendations,
            // finally mounted (audit A12). A topic tick is optimistic: the
            // ViewModel updates the state first and rolls the change back if
            // the core refuses it.
            if (dash.studyRecommendations.isNotEmpty()) {
                item {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "What should I study now?",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Pick a topic to work on — a tick saves straight away.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                itemsIndexed(
                    dash.studyRecommendations,
                    key = { _, rec -> "${rec.assessmentId}::${rec.title}" },
                ) { index, rec ->
                    StudyRecommendationCard(
                        index = index + 1,
                        recommendation = rec,
                        completedTopicsMap = completedTopics,
                        onToggleTopic = { key, done -> viewModel.toggleTopic(key, done) },
                        onClick = {
                            val topic =
                                rec.topics.firstOrNull { !it.completed }?.topic
                                    ?: rec.topics.firstOrNull()?.topic
                            if (topic != null) {
                                viewModel.openPomodoro(rec.assessmentId, topic)
                                viewModel.selectTab("Focus")
                            } else {
                                viewModel.openAssessmentDetail(rec.assessmentId)
                            }
                        },
                    )
                }
            }

            // TODAY — the study tasks the core planned for today. A task opens
            // Focus with that task already selected.
            val todayGroup = snapshot.tasks.days.firstOrNull { it.isToday }
            if (todayGroup != null && todayGroup.tasks.isNotEmpty()) {
                item {
                    TodayStudyStrip(
                        tasks = todayGroup.tasks,
                        onOpenTask = { task ->
                            viewModel.openPomodoro(task.assessmentId, task.topic)
                            viewModel.selectTab("Focus")
                        },
                    )
                }
            }

            // NEXT ASSESSMENT — the soonest genuinely upcoming item, with a
            // way into its detail sheet. The hero above already leads with
            // the countdown, so this card stays a quiet facts strip in the
            // same anatomy as a timeline row.
            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Next assessment",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    NextAssessmentCard(
                        assessment = nextAssessment,
                        onOpen = { assessment -> viewModel.openAssessmentDetail(assessment.id) },
                    )
                }
            }

            // OVERVIEW: KPI cards 2x2 grid
            item {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = "Overview",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    // Row 1: Upcoming (7 Days) & Exams Ahead
                    Row(
                        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        KpiCard(
                            label = "Upcoming (7 Days)",
                            value =
                                if (weekCount == 1) {
                                    "1 assessment"
                                } else {
                                    "$weekCount assessments"
                                },
                            support =
                                if (weekCount > 0) {
                                    "Scheduled within upcoming 7 days"
                                } else {
                                    "Nothing scheduled in the next 7 days"
                                },
                            icon = Icons.Outlined.CalendarToday,
                            iconTint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        ) {
                            if (dash.examTypeCounts.isNotEmpty()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    dash.examTypeCounts.forEach { (type, count) ->
                                        StatusTag(
                                            text = "$type ($count)",
                                            containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                            tabular = true,
                                        )
                                    }
                                }
                            }
                        }

                        // KPI 1b: Exams Ahead (midterms + finals among upcoming)
                        val examsAhead =
                            dash.allUpcoming.count {
                                it.assessmentType.contains("Midterm", ignoreCase = true) ||
                                    it.assessmentType.contains("Final", ignoreCase = true)
                            }
                        KpiCard(
                            label = "Exams ahead",
                            value =
                                if (examsAhead == 1) {
                                    "1 exam"
                                } else {
                                    "$examsAhead exams"
                                },
                            support =
                                if (examsAhead > 0) {
                                    "Midterm & final exams on the radar"
                                } else {
                                    "No upcoming exams"
                                },
                            icon = Icons.Outlined.School,
                            iconTint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        )
                    }

                    // Row 2: Exam Readiness & Connected Sources
                    Row(
                        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        // KPI 2: Exam Readiness (Honest when totalTopicsCount == 0)
                        KpiCard(
                            label = "Overall Readiness",
                            value = readinessHeadline,
                            support = readinessSubtitle,
                            icon = Icons.Outlined.Shield,
                            iconTint = readinessColor,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        ) {
                            if (hasTrackedTopics) {
                                LinearProgressIndicator(
                                    progress = { (readinessPct / 100f).coerceIn(0f, 1f) },
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .height(6.dp)
                                            .clip(CircleShape),
                                    color = readinessColor,
                                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                                )
                            }
                        }

                        // KPI 3: Sync & Sources (Honest when 0 sources exist)
                        KpiCard(
                            label = "Connected Sources",
                            value = sourcesHeadline,
                            support = sourcesSubtitle,
                            icon =
                                if (hasActiveSources) {
                                    Icons.Outlined.CheckCircle
                                } else {
                                    Icons.Outlined.RadioButtonUnchecked
                                },
                            iconTint =
                                if (hasActiveSources) {
                                    StatusColors.success(isDark)
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        )
                    }
                }
            }

            // Upcoming assessments — starts at the genuinely upcoming items and
            // narrows by type and source. Both filters are visible now; the
            // type filter used to be consumed without any control (audit A12).
            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Upcoming Assessments",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Filter by type",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        typeChips.forEach { type ->
                            DashboardFilterChip(
                                label = if (type == "ALL") "All types" else type,
                                selected = typeFilter == type,
                                onClick = { viewModel.setActiveTypeFilter(type) },
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Filter by source",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        sourceChips.forEach { src ->
                            DashboardFilterChip(
                                label = if (src == "ALL") "All sources" else src,
                                selected = sourceFilter == src,
                                onClick = { viewModel.setActiveSourceFilter(src) },
                            )
                        }
                    }
                }
            }

            if (filteredTimeline.isEmpty()) {
                item {
                    if (snapshot.schedule.courses.isEmpty()) {
                        EmptyDashboardStateCard(
                            title = "Add your timetable",
                            desc =
                                "QuizRadar needs your weekly class schedule to cross-reference " +
                                    "announcements and pin exam dates.",
                            icon = Icons.Outlined.School,
                            primaryButtonLabel = "Add course",
                            onPrimaryClick = onAddCourse,
                            secondaryButtonLabel = "Restore a backup",
                            onSecondaryClick = onImportBackup,
                        )
                    } else if (sourceFilter != "ALL" || typeFilter != "ALL") {
                        EmptyDashboardStateCard(
                            title = "No assessments match these filters",
                            desc =
                                "Nothing upcoming fits the current type and source filters. " +
                                    "Clear them to see the rest of your radar.",
                            icon = Icons.Outlined.Search,
                            primaryButtonLabel = "Clear filters",
                            onPrimaryClick = {
                                viewModel.setActiveSourceFilter("ALL")
                                viewModel.setActiveTypeFilter("ALL")
                            },
                            secondaryButtonLabel = "Add an event",
                            onSecondaryClick = onAddEvent,
                        )
                    } else {
                        EmptyDashboardStateCard(
                            title = "Nothing upcoming right now",
                            desc =
                                "Your radar holds no upcoming assessment. Pull down to scan " +
                                    "again, or add an event manually.",
                            icon = Icons.Outlined.Event,
                            primaryButtonLabel = "Scan now",
                            onPrimaryClick = { viewModel.runScan() },
                            secondaryButtonLabel = "Add an event",
                            onSecondaryClick = onAddEvent,
                        )
                    }
                }
            } else {
                itemsIndexed(filteredTimeline, key = { _, assessment -> assessment.id }) { _, assessment ->
                    TimelineAssessmentRow(
                        assessment = assessment,
                        onClick = { viewModel.openAssessmentDetail(assessment.id) },
                    )
                }
            }

            item { Spacer(modifier = Modifier.height(16.dp)) }
        }
    }
}

/**
 * One KPI instrument: the label and the value in ink, the accent reserved for
 * the icon and (where the value is a progress) the meter underneath.
 */
@Composable
private fun KpiCard(
    label: String,
    value: String,
    support: String,
    icon: ImageVector,
    iconTint: Color,
    modifier: Modifier = Modifier,
    footer: (@Composable () -> Unit)? = null,
) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = iconTint,
                    modifier = Modifier.size(16.dp),
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = value,
                style =
                    MaterialTheme.typography.titleLarge.copy(
                        fontFeatureSettings = "tnum",
                    ),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = support,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            footer?.let {
                Spacer(modifier = Modifier.height(8.dp))
                it()
            }
        }
    }
}

/**
 * A filter chip that tells TalkBack it is selected: the leading check icon
 * carries the state as well, so the choice never rests on colour alone.
 */
@Composable
private fun DashboardFilterChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
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
        modifier = modifier.defaultMinSize(minHeight = 48.dp),
    )
}

@Composable
private fun EmptyDashboardStateCard(
    title: String,
    desc: String,
    icon: ImageVector,
    primaryButtonLabel: String,
    onPrimaryClick: () -> Unit,
    secondaryButtonLabel: String,
    onSecondaryClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier =
                        Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Spacer(modifier = Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = desc,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = onPrimaryClick,
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text(
                    text = primaryButtonLabel,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            FilledTonalButton(
                onClick = onSecondaryClick,
                colors = ButtonDefaults.tonalPill(),
                contentPadding = PillButtonContentPadding,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text(
                    text = secondaryButtonLabel,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

/**
 * The live scan card. While the core runs, it shows the REAL per-source
 * pulses (source, stage, found/done counts). Between runs it shows the last
 * report's per-source outcomes - Ran / Skipped (reason) / Failed (error)
 * verbatim, and the honest new/updated counts. There is deliberately no
 * Cancel button: the core exposes no mid-scan cancel, and faking one would
 * violate the honesty doctrine.
 */
@Composable
private fun ScanSourcesCard(
    isScanning: Boolean,
    progress: List<com.quizradar.app.ui.ScanSourceProgress>,
    report: com.quizradar.app.model.SyncReportModel?,
    onScanNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (isScanning) "Scanning sources…" else "Last scan result",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (isScanning) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Text(
                        text =
                            buildString {
                                if (report != null) {
                                    append("${report.totalNew} new · ${report.totalUpdated} updated")
                                }
                            },
                        style =
                            MaterialTheme.typography.bodySmall.copy(
                                fontFeatureSettings = "tnum",
                            ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            val rows: List<Pair<String, String>> =
                if (isScanning) {
                    progress.map { row ->
                        val counts =
                            if (row.done > 0 || row.found > 0) "${row.done}/${row.found}" else ""
                        row.name to
                            listOf(row.stage, counts)
                                .filter { it.isNotBlank() }
                                .joinToString(" · ")
                    }
                } else {
                    report?.perSource.orEmpty().map { row ->
                        val status =
                            when (row.status) {
                                "ran" -> "ran · found ${row.found}"
                                "failed" -> "failed${row.detail?.let { ": $it" } ?: ""}"
                                else -> "skipped${row.detail?.let { ": $it" } ?: ""}"
                            }
                        row.name to status
                    }
                }

            if (rows.isEmpty()) {
                Text(
                    text =
                        if (isScanning) {
                            "Waiting for the first source to report…"
                        } else {
                            "No scan has run yet on this device."
                        },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    rows.forEach { (name, status) ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = name,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                text = status,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }

            if (!isScanning) {
                Spacer(modifier = Modifier.height(16.dp))
                FilledTonalButton(
                    onClick = onScanNow,
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = "Scan now",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }
}

/**
 * The Today strip: the study tasks the core planned for today, as one row
 * of tappable cards. A card opens Focus with that task preselected; the
 * counts come straight from the payload, never from a guess.
 */
@Composable
private fun TodayStudyStrip(
    tasks: List<DailyStudyTaskModel>,
    onOpenTask: (DailyStudyTaskModel) -> Unit,
    modifier: Modifier = Modifier,
) {
    val pending = tasks.filter { !it.completed }
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Today",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text =
                        if (pending.isEmpty()) {
                            "All planned tasks done"
                        } else {
                            "${pending.size} to study"
                        },
                    style =
                        MaterialTheme.typography.labelMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            if (pending.isEmpty()) {
                Text(
                    text = "Everything the core planned for today is done.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    pending.forEach { task ->
                        Column(
                            modifier =
                                Modifier
                                    .defaultMinSize(minHeight = 48.dp)
                                    .clip(MaterialTheme.shapes.extraSmall)
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable(role = Role.Button) { onOpenTask(task) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                        ) {
                            Text(
                                text = task.topic,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 2,
                            )
                            Text(
                                text = task.courseName ?: task.assessmentTitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The next genuinely upcoming assessment, with a direct way into its detail
 * sheet. Every field comes from the core: a missing room stays "—".
 */
@Composable
private fun NextAssessmentCard(
    assessment: AssessmentModel?,
    onOpen: (AssessmentModel) -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        if (assessment == null) {
            Text(
                text = "Nothing upcoming on your radar right now.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
            )
        } else {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text =
                            listOfNotNull(
                                assessment.courseName ?: assessment.courseId,
                                assessment.assessmentType.takeIf { it.isNotBlank() },
                            ).joinToString(" · "),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(
                        onClick = { onOpen(assessment) },
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    ) {
                        Text(
                            text = "Details",
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
                Text(
                    text = assessment.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text =
                        buildString {
                            append(formatIsoDateForDisplay(assessment.dateIso?.toString()) ?: "Undated")
                            extractTimePart(assessment.displayTime)?.let { time ->
                                append(" • ")
                                append(time)
                            }
                            append(" • Room: ")
                            append(assessment.room ?: "—")
                        },
                    style =
                        MaterialTheme.typography.bodySmall.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
