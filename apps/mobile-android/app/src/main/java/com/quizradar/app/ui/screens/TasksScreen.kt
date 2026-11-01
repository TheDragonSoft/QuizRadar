package com.quizradar.app.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.DailyRoadmapCard
import com.quizradar.app.ui.components.ReadinessCard

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
            contentPadding = PaddingValues(bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { Spacer(modifier = Modifier.height(6.dp)) }

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
                        // "study steps", not "topics": when an announcement
                        // named no syllabus topics the planner still schedules
                        // generic review steps, and calling those topics
                        // would contradict the readiness card right below.
                        text = "$pendingCount pending study steps across $upcomingCount upcoming exams$hoursStr",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Course Filter Chips
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val allSelected = courseFilter == "ALL"
                    Box(
                        modifier =
                            Modifier
                                .defaultMinSize(minHeight = 36.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(
                                    if (allSelected) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.surface
                                    },
                                )
                                .border(
                                    1.dp,
                                    if (allSelected) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.outlineVariant
                                    },
                                    RoundedCornerShape(8.dp),
                                )
                                .clickable { viewModel.setTasksCourseFilter("ALL") }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "All Courses",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color =
                                if (allSelected) {
                                    MaterialTheme.colorScheme.onPrimary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                        )
                    }

                    courses.forEach { course ->
                        val isSelected = courseFilter == course.id
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
                                    .clickable { viewModel.setTasksCourseFilter(course.id) }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = formatCourseFilterLabel(course.name, course.id),
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

            // Section 1: Exam Readiness Cards
            item {
                Text(
                    text = "Exam Readiness (${filteredCards.size})",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (filteredCards.isEmpty()) {
                item {
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
                                .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No exams matching this course filter.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
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
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Daily Study Schedule",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (filteredDays.isEmpty()) {
                item {
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
                                .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = "No study tasks scheduled for the next 14 days.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
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
