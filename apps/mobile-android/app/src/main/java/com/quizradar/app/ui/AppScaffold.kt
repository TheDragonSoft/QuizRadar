package com.quizradar.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.SpaceDashboard
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.quizradar.app.ui.detail.AssessmentDetailSheet
import com.quizradar.app.ui.screens.CalendarScreen
import com.quizradar.app.ui.screens.DashboardScreen
import com.quizradar.app.ui.screens.FocusScreen
import com.quizradar.app.ui.screens.TasksScreen

private data class Tab(val label: String, val icon: ImageVector)

private val TABS =
    listOf(
        Tab("Dashboard", Icons.Outlined.SpaceDashboard),
        Tab("Tasks", Icons.Outlined.Checklist),
        Tab("Calendar", Icons.Outlined.CalendarMonth),
        Tab("Focus", Icons.Outlined.Timer),
    )

@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("standard:function-naming")
fun AppScaffold(viewModel: QuizRadarViewModel) {
    var selectedTab by rememberSaveable { mutableStateOf(TABS.first().label) }
    val uiState by viewModel.uiState.collectAsState()
    val activeDetailId by viewModel.activeDetailAssessmentId.collectAsState()

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Predictive back handler: dismiss sheet if open before navigating or exiting
    BackHandler(enabled = activeDetailId != null) {
        viewModel.closeAssessmentDetail()
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab.label,
                        onClick = { selectedTab = tab.label },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        Box(
            modifier =
                Modifier
                    .padding(innerPadding)
                    .fillMaxSize(),
        ) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }

                is UiState.Error -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            text = "Error: ${state.message}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }

                is UiState.Ready -> {
                    when (selectedTab) {
                        "Dashboard" ->
                            DashboardScreen(
                                snapshot = state.snapshot,
                                viewModel = viewModel,
                                onViewCalendar = { selectedTab = "Calendar" },
                            )

                        "Tasks" ->
                            TasksScreen(
                                snapshot = state.snapshot,
                                viewModel = viewModel,
                            )

                        "Calendar" ->
                            CalendarScreen(
                                snapshot = state.snapshot,
                                viewModel = viewModel,
                            )

                        "Focus" ->
                            FocusScreen(
                                snapshot = state.snapshot,
                                viewModel = viewModel,
                            )
                    }

                    // Active Assessment Detail Sheet
                    val selectedAssessment =
                        activeDetailId?.let { id ->
                            state.snapshot.assessments.find { it.id == id }
                        }

                    if (selectedAssessment != null) {
                        AssessmentDetailSheet(
                            assessment = selectedAssessment,
                            allAssessments = state.snapshot.assessments,
                            completedTopicsMap = state.snapshot.completedTopics,
                            sheetState = sheetState,
                            onDismiss = { viewModel.closeAssessmentDetail() },
                            onToggleTopic = { key, done -> viewModel.toggleTopic(key, done) },
                            onSaveGrade = { achieved, max, weight ->
                                viewModel.saveGrade(selectedAssessment.id, achieved, max, weight)
                            },
                            onExportIcs = {
                                viewModel.exportIcs(selectedAssessment.id)
                            },
                            onOpenPractice = {
                                viewModel.closeAssessmentDetail()
                                viewModel.openPracticeQuiz(selectedAssessment.id)
                                selectedTab = "Focus"
                            },
                            onOpenPomodoro = { topicTitle ->
                                viewModel.closeAssessmentDetail()
                                viewModel.openPomodoro(selectedAssessment.id, topicTitle)
                                selectedTab = "Focus"
                            },
                        )
                    }
                }
            }
        }
    }
}
