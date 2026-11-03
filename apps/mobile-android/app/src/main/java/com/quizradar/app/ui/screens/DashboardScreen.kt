package com.quizradar.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.FeedConfigModel
import com.quizradar.app.ui.DashboardSubTab
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.ConflictBanner
import com.quizradar.app.ui.components.NextUpHeroCard
import com.quizradar.app.ui.components.SetupChecklistCard
import com.quizradar.app.ui.components.StudyRecommendationCard
import com.quizradar.app.ui.components.TimelineAssessmentRow
import com.quizradar.app.ui.icons.Icons

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
    val subTab by viewModel.dashboardSubTab.collectAsState()
    val sourceFilter by viewModel.activeSourceFilter.collectAsState()
    val typeFilter by viewModel.activeTypeFilter.collectAsState()

    val notificationPermissionLauncher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.RequestPermission(),
        ) { isGranted ->
            if (isGranted) {
                viewModel.showToast("Notifications enabled")
            }
        }

    val hasNotificationPermission =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    val coursesDone = snapshot.schedule.courses.isNotEmpty()
    val sourcesDone = viewModel.isGoogleConnected() || viewModel.isMicrosoftConnected()
    val remindersDone = hasNotificationPermission && notifyExam24h
    val showChecklist = !isSetupChecklistDismissed && (!coursesDone || !sourcesDone || !remindersDone)

    val dash = snapshot.dashboard
    val assessments = snapshot.assessments
    val completedTopics = snapshot.completedTopics

    // Filtered timeline
    val filteredTimeline =
        assessments.filter { a ->
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

    val weekCount = dash.upcomingThisWeek.size
    val hasTrackedTopics = dash.totalTopicsCount > 0
    val readinessPct = if (hasTrackedTopics) dash.readinessPercent.coerceIn(0, 100) else 0
    val readinessColor =
        when {
            !hasTrackedTopics -> MaterialTheme.colorScheme.onSurfaceVariant
            readinessPct >= 80 -> if (isDark) Color(0xFF34D399) else Color(0xFF047857)
            readinessPct >= 50 -> if (isDark) Color(0xFFFBBF24) else Color(0xFFB45309)
            else -> if (isDark) Color(0xFFF87171) else Color(0xFFDC2626)
        }
    val (readinessHeadline, readinessSubtitle) =
        formatReadinessDisplay(
            totalTopicsCount = dash.totalTopicsCount,
            completedTopicsCount = dash.completedTopicsCount,
            readinessPercent = dash.readinessPercent,
        )
    val accountsConnected =
        (if (viewModel.isGoogleConnected()) 1 else 0) +
            (if (viewModel.isMicrosoftConnected()) 1 else 0)
    val (sourcesHeadline, sourcesSubtitle) =
        formatSourcesDisplay(snapshot.feeds, dash.sourcesCount, accountsConnected, lastSyncedStamp)
    val hasActiveSources = snapshot.feeds.any { it.enabled } || accountsConnected > 0

    PullToRefreshBox(
        isRefreshing = isRefreshing || isScanning,
        onRefresh = { viewModel.runScan() },
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
            contentPadding = PaddingValues(bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { Spacer(modifier = Modifier.height(6.dp)) }

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

            // Sub-Tab Bar (Overview / Assessments / Study)
            item {
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
                            .padding(4.dp),
                ) {
                    val tabs =
                        listOf(
                            DashboardSubTab.OVERVIEW to ("Overview" to Icons.Outlined.Dashboard),
                            DashboardSubTab.ASSESSMENTS to ("Assessments" to Icons.Outlined.Checklist),
                            DashboardSubTab.STUDY to ("Study" to Icons.Outlined.AutoAwesome),
                        )

                    tabs.forEach { (tab, labelIcon) ->
                        val (label, icon) = labelIcon
                        val isSelected = subTab == tab
                        Row(
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .defaultMinSize(minHeight = 44.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (isSelected) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            Color.Transparent
                                        },
                                    )
                                    .clickable { viewModel.setDashboardSubTab(tab) }
                                    .padding(vertical = 8.dp, horizontal = 4.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = icon,
                                contentDescription = null,
                                tint =
                                    if (isSelected) {
                                        MaterialTheme.colorScheme.onPrimary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(5.dp))
                            Text(
                                text = label,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                                color =
                                    if (isSelected) {
                                        MaterialTheme.colorScheme.onPrimary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                        }
                    }
                }
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

            // Setup Checklist Card
            if (showChecklist) {
                item {
                    SetupChecklistCard(
                        snapshot = snapshot,
                        viewModel = viewModel,
                        hasNotificationPermission = hasNotificationPermission,
                        onAddCourse = onAddCourse,
                        onConnectSources = onOpenAccount,
                        onOpenSettings = onOpenSettings,
                        onRequestNotificationPermission = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                        },
                        onDismiss = { viewModel.dismissSetupChecklist() },
                    )
                }
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

            // OVERVIEW: KPI cards row
            if (subTab == DashboardSubTab.OVERVIEW) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        // KPI 1: Next 7 Days
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(16.dp),
                                    )
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "Upcoming (7 Days)",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Icon(
                                    imageVector = Icons.Outlined.CalendarToday,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text =
                                    if (weekCount == 1) {
                                        "1 assessment"
                                    } else {
                                        "$weekCount assessments"
                                    },
                                style =
                                    MaterialTheme.typography.headlineMedium.merge(
                                        TextStyle(
                                            fontWeight = FontWeight.ExtraBold,
                                            fontFeatureSettings = "tnum",
                                        ),
                                    ),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text =
                                    if (weekCount > 0) {
                                        "Scheduled within upcoming 7 days"
                                    } else {
                                        "Nothing scheduled in the next 7 days"
                                    },
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )

                            if (dash.examTypeCounts.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(10.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    dash.examTypeCounts.forEach { (type, count) ->
                                        Text(
                                            text = "$type ($count)",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                                            modifier =
                                                Modifier
                                                    .clip(RoundedCornerShape(6.dp))
                                                    .background(MaterialTheme.colorScheme.secondaryContainer)
                                                    .padding(horizontal = 8.dp, vertical = 3.dp),
                                        )
                                    }
                                }
                            }
                        }

                        // KPI 1b: Exams Ahead (midterms + finals among upcoming)
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(16.dp),
                                    )
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "Exams ahead",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Icon(
                                    imageVector = Icons.Outlined.School,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            val examsAhead =
                                dash.allUpcoming.count {
                                    it.assessmentType.contains("Midterm", ignoreCase = true) ||
                                        it.assessmentType.contains("Final", ignoreCase = true)
                                }
                            Text(
                                text =
                                    if (examsAhead == 1) {
                                        "1 exam"
                                    } else {
                                        "$examsAhead exams"
                                    },
                                style =
                                    MaterialTheme.typography.headlineMedium.merge(
                                        TextStyle(
                                            fontWeight = FontWeight.ExtraBold,
                                            fontFeatureSettings = "tnum",
                                        ),
                                    ),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text =
                                    if (examsAhead > 0) {
                                        "Midterm & final exams on the radar"
                                    } else {
                                        "No upcoming exams"
                                    },
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        // KPI 2: Exam Readiness (Honest when totalTopicsCount == 0)
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(16.dp),
                                    )
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "Overall Readiness",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Icon(
                                    imageVector = Icons.Outlined.Shield,
                                    contentDescription = null,
                                    tint = readinessColor,
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = readinessHeadline,
                                style =
                                    MaterialTheme.typography.headlineMedium.merge(
                                        TextStyle(
                                            fontWeight = FontWeight.ExtraBold,
                                            fontFeatureSettings = "tnum",
                                        ),
                                    ),
                                color = readinessColor,
                            )
                            Text(
                                text = readinessSubtitle,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            LinearProgressIndicator(
                                progress = {
                                    if (hasTrackedTopics) {
                                        (readinessPct / 100f).coerceIn(0f, 1f)
                                    } else {
                                        0f
                                    }
                                },
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .height(6.dp)
                                        .clip(RoundedCornerShape(3.dp)),
                                color = readinessColor,
                                trackColor = MaterialTheme.colorScheme.surfaceVariant,
                            )
                        }

                        // KPI 3: Sync & Sources (Honest when 0 sources exist)
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(16.dp),
                                    )
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "Connected Sources",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Icon(
                                    imageVector =
                                        if (hasActiveSources) {
                                            Icons.Outlined.CheckCircle
                                        } else {
                                            Icons.Outlined.RadioButtonUnchecked
                                        },
                                    contentDescription = null,
                                    tint =
                                        if (hasActiveSources) {
                                            if (isDark) Color(0xFF34D399) else Color(0xFF047857)
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = sourcesHeadline,
                                style =
                                    MaterialTheme.typography.headlineSmall.merge(
                                        TextStyle(
                                            fontWeight = FontWeight.ExtraBold,
                                            fontFeatureSettings = "tnum",
                                        ),
                                    ),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = sourcesSubtitle,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            // STUDY: Study recommendations cards
            if (subTab == DashboardSubTab.STUDY) {
                item {
                    Text(
                        text = "Study Recommendations (${dash.studyRecommendations.size})",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (dash.studyRecommendations.isEmpty()) {
                    item {
                        if (snapshot.schedule.courses.isEmpty()) {
                            EmptyDashboardStateCard(
                                title = "Add your timetable",
                                desc =
                                    "QuizRadar needs your weekly class schedule to cross-reference " +
                                        "announcements and pin exam dates.",
                                icon = Icons.Outlined.School,
                                primaryButtonLabel = "Add Course",
                                onPrimaryClick = onAddCourse,
                                secondaryButtonLabel = "Restore Backup",
                                onSecondaryClick = onImportBackup,
                            )
                        } else if (assessments.isEmpty()) {
                            EmptyDashboardStateCard(
                                title = "No assessments discovered yet",
                                desc =
                                    "Your courses are enrolled. Sign in to Gmail or Teams (or add an " +
                                        ".ics feed) and pull down to scan - announcements are read on " +
                                        "this device. You can also add an event manually.",
                                icon = Icons.Outlined.Checklist,
                                primaryButtonLabel = "Scan now",
                                onPrimaryClick = { viewModel.runScan() },
                                secondaryButtonLabel = "Add Event",
                                onSecondaryClick = onAddEvent,
                            )
                        } else {
                            Box(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(
                                            1.dp,
                                            MaterialTheme.colorScheme.outlineVariant,
                                            RoundedCornerShape(16.dp),
                                        )
                                        .padding(28.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "No pending study recommendations right now.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                } else {
                    itemsIndexed(dash.studyRecommendations, key = { _, rec -> rec.assessmentId }) { index, rec ->
                        StudyRecommendationCard(
                            index = index + 1,
                            recommendation = rec,
                            completedTopicsMap = completedTopics,
                            onToggleTopic = { key, done -> viewModel.toggleTopic(key, done) },
                            onClick = { viewModel.openAssessmentDetail(rec.assessmentId) },
                        )
                    }
                }
            }

            // ASSESSMENTS: Timeline list with filters
            if (subTab == DashboardSubTab.ASSESSMENTS) {
                item {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "Filter by Source",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            listOf("ALL", "GMAIL", "MOODLE", "TEAMS", "CLASSROOM").forEach { src ->
                                val isSelected = sourceFilter == src
                                Box(
                                    modifier =
                                        Modifier
                                            .defaultMinSize(minHeight = 36.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(
                                                if (isSelected) {
                                                    MaterialTheme.colorScheme.primary
                                                } else {
                                                    MaterialTheme.colorScheme.surface
                                                },
                                            )
                                            .border(
                                                1.dp,
                                                if (isSelected) {
                                                    MaterialTheme.colorScheme.primary
                                                } else {
                                                    MaterialTheme.colorScheme.outlineVariant
                                                },
                                                RoundedCornerShape(8.dp),
                                            )
                                            .clickable { viewModel.setActiveSourceFilter(src) }
                                            .padding(horizontal = 12.dp, vertical = 8.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = src,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color =
                                            if (isSelected) {
                                                MaterialTheme.colorScheme.onPrimary
                                            } else {
                                                MaterialTheme.colorScheme.onSurfaceVariant
                                            },
                                    )
                                }
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
                                primaryButtonLabel = "Add Course",
                                onPrimaryClick = onAddCourse,
                                secondaryButtonLabel = "Restore Backup",
                                onSecondaryClick = onImportBackup,
                            )
                        } else if (assessments.isEmpty()) {
                            EmptyDashboardStateCard(
                                title = "No assessments discovered yet",
                                desc =
                                    "Your courses are enrolled. Sign in to Gmail or Teams (or add an " +
                                        ".ics feed) and pull down to scan - announcements are read on " +
                                        "this device. You can also add an event manually.",
                                icon = Icons.Outlined.Checklist,
                                primaryButtonLabel = "Scan now",
                                onPrimaryClick = { viewModel.runScan() },
                                secondaryButtonLabel = "Add Event",
                                onSecondaryClick = onAddEvent,
                            )
                        } else {
                            Box(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .border(
                                            1.dp,
                                            MaterialTheme.colorScheme.outlineVariant,
                                            RoundedCornerShape(16.dp),
                                        )
                                        .padding(28.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "No assessments matching this filter.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
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
            }

            item { Spacer(modifier = Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun EmptyDashboardStateCard(
    title: String,
    desc: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    primaryButtonLabel: String,
    onPrimaryClick: () -> Unit,
    secondaryButtonLabel: String,
    onSecondaryClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
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
            Spacer(modifier = Modifier.height(14.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = desc,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(18.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = onSecondaryClick,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(secondaryButtonLabel, fontSize = 12.sp)
                }
                Button(
                    onClick = onPrimaryClick,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text(primaryButtonLabel, fontSize = 12.sp)
                }
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
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(MaterialTheme.colorScheme.surface)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp))
                .padding(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (isScanning) "Scanning sources…" else "Last scan result",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

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
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            rows.forEach { (name, status) ->
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = name,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = status,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        if (!isScanning) {
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = onScanNow,
                modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 44.dp),
                shape = RoundedCornerShape(10.dp),
            ) {
                Text("Scan now", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
