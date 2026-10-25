package com.quizradar.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.DashboardSubTab
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.ConflictBanner
import com.quizradar.app.ui.components.StudyRecommendationCard
import com.quizradar.app.ui.components.TimelineAssessmentRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    onViewCalendar: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var isMigrationDismissed by remember { mutableStateOf(false) }

    val filePickerLauncher =
        rememberLauncherForActivityResult(contract = ActivityResultContracts.GetContent()) { uri ->
            if (uri != null) {
                try {
                    val content = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                    if (!content.isNullOrBlank()) {
                        viewModel.importBackup(content) {
                            isMigrationDismissed = true
                        }
                    }
                } catch (e: Exception) {
                    viewModel.showToast("Failed to read backup file: ${e.message}")
                }
            }
        }

    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val isConflictDismissed by viewModel.isConflictDismissed.collectAsState()
    val subTab by viewModel.dashboardSubTab.collectAsState()
    val sourceFilter by viewModel.activeSourceFilter.collectAsState()
    val typeFilter by viewModel.activeTypeFilter.collectAsState()

    val dash = snapshot.dashboard
    val assessments = snapshot.assessments
    val completedTopics = snapshot.completedTopics

    // Filtered timeline
    val filteredTimeline =
        assessments.filter { a ->
            // Source filter
            if (sourceFilter != "ALL") {
                val src = a.source.uppercase()
                if (!src.contains(sourceFilter)) return@filter false
            }
            // Type filter
            if (typeFilter == "UPCOMING") {
                if (!a.isUpcoming) return@filter false
            } else if (typeFilter != "ALL") {
                if (a.assessmentType != typeFilter) return@filter false
            }
            true
        }

    val weekCount = dash.upcomingThisWeek.size
    val readinessPct = dash.readinessPercent
    val readinessColor =
        when {
            readinessPct >= 80 -> Color(0xFF059669)
            readinessPct >= 50 -> Color(0xFFD97706)
            else -> Color(0xFFDC2626)
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
                    .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { Spacer(modifier = Modifier.height(8.dp)) }

            // Sub-Tab Bar (Overview / Assessments / Study)
            item {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(12.dp))
                            .padding(4.dp),
                ) {
                    val tabs =
                        listOf(
                            DashboardSubTab.STUDY to ("Study" to Icons.Outlined.AutoAwesome),
                            DashboardSubTab.ASSESSMENTS to ("Assessments" to Icons.Outlined.Checklist),
                            DashboardSubTab.OVERVIEW to ("Overview" to Icons.Outlined.Dashboard),
                        )

                    tabs.forEach { (tab, labelIcon) ->
                        val (label, icon) = labelIcon
                        val isSelected = subTab == tab
                        Row(
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (isSelected) {
                                            MaterialTheme.colorScheme.primary
                                        } else {
                                            Color.Transparent
                                        },
                                    )
                                    .clickable { viewModel.setDashboardSubTab(tab) }
                                    .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = icon,
                                contentDescription = null,
                                tint =
                                    if (isSelected) {
                                        Color.White
                                    } else {
                                        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                    },
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = label,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color =
                                    if (isSelected) {
                                        Color.White
                                    } else {
                                        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
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

            // Coming from v4 Migration Card
            if (!isMigrationDismissed && snapshot.assessments.isEmpty()) {
                item {
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.3f), RoundedCornerShape(16.dp))
                                .padding(16.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Top,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Coming from QuizRadar v4?",
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "Import your v4 backup JSON file to restore courses, assessments, grades, and study topics.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                                )
                            }
                            IconButton(
                                onClick = { isMigrationDismissed = true },
                                modifier = Modifier.size(24.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Close,
                                    contentDescription = "Dismiss",
                                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(
                            onClick = { filePickerLauncher.launch("application/json") },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                            colors =
                                ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    contentColor = Color.White,
                                ),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.UploadFile,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Import v4 Backup",
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }
            }

            // If subTab == OVERVIEW: Show KPI cards row
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
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "NEXT 7 DAYS",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                )
                                Box(
                                    modifier =
                                        Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.colorScheme.primary),
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "$weekCount assessments",
                                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = if (weekCount > 0) "Scheduled within upcoming 7 days" else "No assessments this week",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )

                            // Type breakdown pills
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                dash.examTypeCounts.forEach { (type, count) ->
                                    Text(
                                        text = "$type ($count)",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier =
                                            Modifier
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f))
                                                .padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                            }
                        }

                        // KPI 2: Exam Readiness
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "OVERALL READINESS",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
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
                                text = "$readinessPct%",
                                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                                color = readinessColor,
                            )
                            Text(
                                text = "${dash.completedTopicsCount} of ${dash.totalTopicsCount} topics mastered",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            LinearProgressIndicator(
                                progress = { (readinessPct / 100f).coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                                color = readinessColor,
                                trackColor = readinessColor.copy(alpha = 0.15f),
                            )
                        }

                        // KPI 3: Sync & Sources
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                    .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "CONNECTED SOURCES",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                )
                                Icon(
                                    imageVector = Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = Color(0xFF059669),
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            val activeSourcesCount = dash.sourcesCount.size.coerceAtLeast(1)
                            Text(
                                text = "$activeSourcesCount sources active",
                                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = "On-device engine running local-first",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                        }
                    }
                }
            }

            // If subTab == STUDY: Study recommendations cards
            if (subTab == DashboardSubTab.STUDY) {
                item {
                    Text(
                        text = "WHAT SHOULD I STUDY? (${dash.studyRecommendations.size})",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }

                if (dash.studyRecommendations.isEmpty()) {
                    item {
                        Box(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                    .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "All study recommendations completed! Add courses or scan sources to plan more.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                        }
                    }
                } else {
                    itemsIndexed(dash.studyRecommendations) { index, rec ->
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

            // If subTab == ASSESSMENTS: Timeline list with filters
            if (subTab == DashboardSubTab.ASSESSMENTS) {
                // Filter chips: Sources
                item {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "SOURCE FILTER",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            listOf("ALL", "GMAIL", "MOODLE", "TEAMS", "CLASSROOM").forEach { src ->
                                val isSelected = sourceFilter == src
                                Text(
                                    text = src,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(
                                                if (isSelected) {
                                                    MaterialTheme.colorScheme.primary
                                                } else {
                                                    MaterialTheme.colorScheme.surface
                                                },
                                            )
                                            .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                                            .clickable { viewModel.setActiveSourceFilter(src) }
                                            .padding(horizontal = 10.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                }

                if (filteredTimeline.isEmpty()) {
                    item {
                        Box(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                    .padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "No assessments matching this filter.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                        }
                    }
                } else {
                    itemsIndexed(filteredTimeline) { _, assessment ->
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
