package com.quizradar.app.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.DailyRoadmapCard
import com.quizradar.app.ui.components.ReadinessCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val isRefreshing by viewModel.isRefreshing.collectAsState()
    val courseFilter by viewModel.tasksCourseFilter.collectAsState()

    val tasks = snapshot.tasks
    val completedTopics = snapshot.completedTopics
    val courses = snapshot.schedule.courses

    // Filter readiness cards
    val filteredCards =
        tasks.readinessCards.filter { card ->
            if (courseFilter == "ALL") true else card.courseId == courseFilter
        }

    // Filter roadmap day groups
    val filteredDays =
        tasks.days.map { dayGroup ->
            val dayTasks =
                dayGroup.tasks.filter { task ->
                    if (courseFilter == "ALL") true else task.courseId == courseFilter
                }
            dayGroup.copy(tasks = dayTasks)
        }.filter { it.tasks.isNotEmpty() }

    val pendingCount = tasks.pendingTasks
    val upcomingCount = tasks.readinessCards.size
    val hoursStr = if (tasks.totalHours != null) " • Est. ${tasks.totalHours} hrs" else ""

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

            // Header: Title & Summary line
            item {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Daily Study Roadmap",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "$pendingCount pending topics across $upcomingCount upcoming exams$hoursStr",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
            }

            // Course Filter Chips
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val allSelected = courseFilter == "ALL"
                    Text(
                        text = "All Courses",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (allSelected) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                        modifier =
                            Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (allSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                                .clickable { viewModel.setTasksCourseFilter("ALL") }
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                    )

                    courses.forEach { course ->
                        val isSelected = courseFilter == course.id
                        Text(
                            text = "${course.id} • ${course.name}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                            modifier =
                                Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                                    .clickable { viewModel.setTasksCourseFilter(course.id) }
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
            }

            // Section 1: Exam Readiness Cards
            item {
                Text(
                    text = "EXAM READINESS (${filteredCards.size})",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }

            if (filteredCards.isEmpty()) {
                item {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No exams matching this course filter.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                }
            } else {
                itemsIndexed(filteredCards) { _, card ->
                    ReadinessCard(
                        card = card,
                        onClick = { viewModel.openAssessmentDetail(card.assessmentId) },
                    )
                }
            }

            // Section 2: Daily Study Roadmap Cards
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "DAILY STUDY SCHEDULE",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }

            if (filteredDays.isEmpty()) {
                item {
                    Box(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(16.dp))
                                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(16.dp))
                                .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No study tasks scheduled for the next 14 days.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                }
            } else {
                itemsIndexed(filteredDays) { _, dayGroup ->
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
