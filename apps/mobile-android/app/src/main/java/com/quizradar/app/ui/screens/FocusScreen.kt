package com.quizradar.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.core.topicKey
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.PomodoroInterval
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.StatusColors

private enum class FocusMode {
    POMODORO,
    PRACTICE_QUIZ,
}

@Composable
fun FocusScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val isDark = isSystemInDarkTheme()
    var mode by remember { mutableStateOf(FocusMode.POMODORO) }

    // Pomodoro timer state from ViewModel (persists across tabs and app lifecycle)
    val selectedInterval by viewModel.pomodoroInterval.collectAsState()
    val secondsLeft by viewModel.pomodoroSecondsLeft.collectAsState()
    val isRunning by viewModel.pomodoroIsRunning.collectAsState()

    val activePomodoroAssessmentId by viewModel.activePomodoroAssessmentId.collectAsState()
    val activePomodoroTopic by viewModel.activePomodoroTopic.collectAsState()
    val activePomodoroTopicIndex by viewModel.activePomodoroTopicIndex.collectAsState()

    // Practice quiz state
    val activePracticeId by viewModel.activePracticeAssessmentId.collectAsState()
    val practiceQuiz by viewModel.practiceQuiz.collectAsState()
    val practiceQuizError by viewModel.practiceQuizError.collectAsState()
    val isPracticeLoading by viewModel.isPracticeLoading.collectAsState()
    val userAnswers = remember { mutableStateMapOf<String, Int>() }

    // If AssessmentDetailSheet launched Practice Quiz, switch straight to PRACTICE_QUIZ tab
    LaunchedEffect(activePracticeId) {
        if (activePracticeId != null) {
            mode = FocusMode.PRACTICE_QUIZ
        }
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
    ) {
        Spacer(modifier = Modifier.height(10.dp))

        // Top Switcher: Pomodoro vs Practice Quiz
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
            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = 44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(
                            if (mode == FocusMode.POMODORO) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                Color.Transparent
                            },
                        )
                        .clickable { mode = FocusMode.POMODORO }
                        .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Timer,
                    contentDescription = null,
                    tint =
                        if (mode == FocusMode.POMODORO) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "Pomodoro Timer",
                    fontSize = 12.sp,
                    fontWeight = if (mode == FocusMode.POMODORO) FontWeight.Bold else FontWeight.SemiBold,
                    color =
                        if (mode == FocusMode.POMODORO) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                )
            }

            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = 44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(
                            if (mode == FocusMode.PRACTICE_QUIZ) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                Color.Transparent
                            },
                        )
                        .clickable { mode = FocusMode.PRACTICE_QUIZ }
                        .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Quiz,
                    contentDescription = null,
                    tint =
                        if (mode == FocusMode.PRACTICE_QUIZ) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "Practice Quiz",
                    fontSize = 12.sp,
                    fontWeight = if (mode == FocusMode.PRACTICE_QUIZ) FontWeight.Bold else FontWeight.SemiBold,
                    color =
                        if (mode == FocusMode.PRACTICE_QUIZ) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (mode == FocusMode.POMODORO) {
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .padding(bottom = 88.dp)
                        .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(20.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .border(
                                1.dp,
                                MaterialTheme.colorScheme.outlineVariant,
                                RoundedCornerShape(20.dp),
                            )
                            .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // Interval Switcher Pills (25m / 5m / 15m)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        PomodoroInterval.values().forEach { interval ->
                            val isSelected = selectedInterval == interval
                            Box(
                                modifier =
                                    Modifier
                                        .weight(1f)
                                        .defaultMinSize(minHeight = 40.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(
                                            if (isSelected) {
                                                MaterialTheme.colorScheme.primary
                                            } else {
                                                MaterialTheme.colorScheme.surfaceVariant
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
                                        .clickable { viewModel.selectPomodoroInterval(interval) }
                                        .padding(horizontal = 6.dp, vertical = 8.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "${interval.label} (${interval.minutes}m)",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    softWrap = false,
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

                    Spacer(modifier = Modifier.height(28.dp))

                    // Timer Display Circle
                    val totalSeconds = selectedInterval.minutes * 60
                    val progress = 1f - (secondsLeft.toFloat() / totalSeconds.toFloat())
                    val mins = secondsLeft / 60
                    val secs = secondsLeft % 60
                    val timeDisplay = String.format("%02d:%02d", mins, secs)

                    Box(
                        modifier = Modifier.size(216.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        val primaryColor = MaterialTheme.colorScheme.primary
                        CircularProgressIndicator(
                            progress = { progress },
                            modifier = Modifier.fillMaxSize(),
                            strokeWidth = 10.dp,
                            color = primaryColor,
                            trackColor = primaryColor.copy(alpha = 0.12f),
                        )
                        if (progress > 0f) {
                            androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
                                val strokeWidthPx = 10.dp.toPx()
                                val r = (size.width - strokeWidthPx) / 2f
                                val angleDeg = -90.0 + (progress * 360.0)
                                val rad = Math.toRadians(angleDeg)
                                val cx = (size.width / 2f) + (r * Math.cos(rad)).toFloat()
                                val cy = (size.height / 2f) + (r * Math.sin(rad)).toFloat()

                                drawCircle(
                                    color = primaryColor.copy(alpha = 0.45f),
                                    radius = 7.dp.toPx(),
                                    center = androidx.compose.ui.geometry.Offset(cx, cy),
                                )
                                drawCircle(
                                    color = Color(0xFFFEF08A),
                                    radius = 3.5.dp.toPx(),
                                    center = androidx.compose.ui.geometry.Offset(cx, cy),
                                )
                            }
                        }
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = timeDisplay,
                                style =
                                    TextStyle(
                                        fontSize = 44.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        fontFeatureSettings = "tnum",
                                        color = MaterialTheme.colorScheme.onSurface,
                                    ),
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text =
                                    if (isRunning) {
                                        "Focusing"
                                    } else if (secondsLeft == 0) {
                                        "Session Complete"
                                    } else {
                                        "Ready to Focus"
                                    },
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color =
                                    if (isRunning) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Play / Pause / Reset buttons (zero horizontal padding squeeze!)
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Button(
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                if (isRunning) {
                                    viewModel.pausePomodoro()
                                } else {
                                    viewModel.startPomodoro(context.applicationContext)
                                }
                            },
                            shape = CircleShape,
                            contentPadding = PaddingValues(0.dp),
                            colors =
                                ButtonDefaults.buttonColors(
                                    containerColor =
                                        if (isRunning) {
                                            // error/onError are the scheme's own pair:
                                            // #D93025/white in light (4.8:1), #F87171/#450A0A
                                            // in dark (5.9:1) - a fixed hex + white measured
                                            // only 2.8:1 on the dark error red.
                                            MaterialTheme.colorScheme.error
                                        } else {
                                            MaterialTheme.colorScheme.primary
                                        },
                                    contentColor =
                                        if (isRunning) {
                                            MaterialTheme.colorScheme.onError
                                        } else {
                                            MaterialTheme.colorScheme.onPrimary
                                        },
                                ),
                            modifier = Modifier.size(60.dp),
                        ) {
                            Icon(
                                imageVector = if (isRunning) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                                contentDescription = if (isRunning) "Pause" else "Play",
                                modifier = Modifier.size(28.dp),
                            )
                        }

                        OutlinedIconButton(
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                viewModel.resetPomodoro()
                            },
                            shape = CircleShape,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            modifier = Modifier.size(52.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Refresh,
                                contentDescription = "Reset",
                                tint = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                    }

                    // Linked topic section
                    if (activePomodoroTopic != null) {
                        Spacer(modifier = Modifier.height(20.dp))
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(12.dp),
                                    )
                                    .padding(14.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = "WORKING ON TOPIC",
                                fontSize = 11.sp,
                                letterSpacing = 0.6.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = activePomodoroTopic!!,
                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            // The completion key is content-addressed from
                            // the topic text (`{id}::h{hash}`, `01` §3) —
                            // never a positional index, so a rescan that
                            // reorders topics cannot move the checkmark.
                            // Local copies: the state delegates cannot smart-
                            // cast through the null check.
                            val pomodoroAssessmentId = activePomodoroAssessmentId
                            val pomodoroTopic = activePomodoroTopic
                            val completionKey =
                                if (pomodoroAssessmentId != null && pomodoroTopic != null) {
                                    topicKey(pomodoroAssessmentId, pomodoroTopic)
                                } else {
                                    null
                                }
                            Button(
                                onClick = {
                                    if (completionKey != null) {
                                        viewModel.toggleTopic(completionKey, true)
                                    }
                                },
                                enabled = completionKey != null,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.defaultMinSize(minHeight = 42.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Check,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(text = "Mark Topic Done", fontSize = 12.sp)
                            }
                            if (completionKey == null) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "This topic's completion key is unknown - reopen it from the assessment.",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    val streakDays by viewModel.studyStreakDays.collectAsState()
                    val courseMinutes by viewModel.studyMinutesByCourse.collectAsState()

                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = "🔥",
                                        fontSize = 18.sp,
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "$streakDays-Day Study Streak",
                                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                }
                                val totalMins = courseMinutes.values.sum()
                                Text(
                                    text = "${totalMins / 60}h ${totalMins % 60}m logged",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }

                            Spacer(modifier = Modifier.height(12.dp))

                            Text(
                                text = "WEEKLY STUDY TIME BY COURSE",
                                fontSize = 10.sp,
                                letterSpacing = 0.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )

                            Spacer(modifier = Modifier.height(8.dp))

                            courseMinutes.forEach { (cid, mins) ->
                                val courseColor = CoursePalette.getHex(cid)
                                val color =
                                    try {
                                        Color(android.graphics.Color.parseColor(courseColor))
                                    } catch (_: Exception) {
                                        MaterialTheme.colorScheme.primary
                                    }
                                val progress = (mins.toFloat() / 180f).coerceIn(0.05f, 1f)

                                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Text(
                                            text = cid,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = color,
                                        )
                                        Text(
                                            text = "${mins / 60}h ${mins % 60}m",
                                            fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Box(
                                        modifier =
                                            Modifier
                                                .fillMaxWidth()
                                                .height(6.dp)
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(MaterialTheme.colorScheme.surfaceVariant),
                                    ) {
                                        Box(
                                            modifier =
                                                Modifier
                                                    .fillMaxWidth(progress)
                                                    .height(6.dp)
                                                    .clip(RoundedCornerShape(3.dp))
                                                    .background(color),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Practice Quiz Screen Content
            val assessments = snapshot.assessments

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 88.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    Text(
                        text = "SELECT EXAM TO PRACTICE",
                        fontSize = 11.sp,
                        letterSpacing = 0.6.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    if (assessments.isEmpty()) {
                        Box(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(14.dp),
                                    )
                                    .padding(20.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "Add or import an assessment first to unlock practice quizzes.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        // The picker used to show only the FIRST THREE
                        // assessments - everything after that was unreachable.
                        // It is now a horizontally scrollable row of every
                        // DATED assessment, soonest first; an undated item has
                        // no exam day to practice towards and stays out.
                        val datedAssessments =
                            assessments
                                .filter { it.dateIso != null }
                                .sortedBy { it.dateIso }
                        if (datedAssessments.isEmpty()) {
                            Text(
                                text =
                                    "No dated assessments to practice yet - a scan or an event " +
                                        "with a confirmed date unlocks practice quizzes.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            Row(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                datedAssessments.forEach { a ->
                                    val isChosenExam = activePracticeId == a.id
                                    val label = a.courseName ?: a.courseId ?: a.title.take(10)
                                    val dateSuffix = a.dateIso?.let { " · $it" } ?: ""
                                    if (isChosenExam) {
                                        Button(
                                            onClick = {
                                                userAnswers.clear()
                                                viewModel.openPracticeQuiz(a.id)
                                            },
                                            shape = RoundedCornerShape(10.dp),
                                            modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                                            colors =
                                                ButtonDefaults.buttonColors(
                                                    containerColor = MaterialTheme.colorScheme.primary,
                                                    contentColor = MaterialTheme.colorScheme.onPrimary,
                                                ),
                                        ) {
                                            Text(
                                                text = label + dateSuffix,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Bold,
                                                maxLines = 1,
                                            )
                                        }
                                    } else {
                                        OutlinedButton(
                                            onClick = {
                                                userAnswers.clear()
                                                viewModel.openPracticeQuiz(a.id)
                                            },
                                            shape = RoundedCornerShape(10.dp),
                                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                            modifier = Modifier.defaultMinSize(minHeight = 44.dp),
                                            colors =
                                                ButtonDefaults.outlinedButtonColors(
                                                    containerColor = MaterialTheme.colorScheme.surface,
                                                    contentColor = MaterialTheme.colorScheme.onSurface,
                                                ),
                                        ) {
                                            Text(
                                                text = label + dateSuffix,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                maxLines = 1,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (isPracticeLoading) {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(32.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                } else if (practiceQuiz != null) {
                    val quiz = practiceQuiz!!
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = quiz.assessmentTitle,
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                val badgeText =
                                    if (quiz.authoredLocally) {
                                        "Authored locally from your topics"
                                    } else {
                                        "Generated by Gemini AI"
                                    }
                                Text(
                                    text = badgeText,
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                            }

                            val score =
                                quiz.questions.count { q ->
                                    userAnswers[q.id] == q.correctIndex
                                }
                            Box(
                                modifier =
                                    Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(MaterialTheme.colorScheme.secondaryContainer)
                                        .padding(horizontal = 10.dp, vertical = 5.dp),
                            ) {
                                Text(
                                    text = "Score: $score / ${quiz.questions.size}",
                                    style =
                                        TextStyle(
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            fontFeatureSettings = "tnum",
                                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                                        ),
                                )
                            }
                        }
                    }

                    // Question Cards
                    itemsIndexed(quiz.questions, key = { qIdx, question -> question.id.ifBlank { qIdx.toString() } }) { qIdx, question ->
                        val selected = userAnswers[question.id]
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outlineVariant,
                                        RoundedCornerShape(14.dp),
                                    )
                                    .padding(14.dp),
                        ) {
                            Text(
                                text = "Q${qIdx + 1}: ${question.question}",
                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(modifier = Modifier.height(10.dp))

                            question.options.forEachIndexed { optIdx, option ->
                                val isChosen = selected == optIdx
                                val isCorrect = question.correctIndex == optIdx

                                val (optBg, optBorder) =
                                    if (selected != null) {
                                        if (isCorrect) {
                                            StatusColors.success(isDark).copy(alpha = 0.14f) to StatusColors.success(isDark)
                                        } else if (isChosen) {
                                            MaterialTheme.colorScheme.error.copy(alpha = 0.14f) to MaterialTheme.colorScheme.error
                                        } else {
                                            Color.Transparent to MaterialTheme.colorScheme.outlineVariant
                                        }
                                    } else {
                                        Color.Transparent to MaterialTheme.colorScheme.outline
                                    }

                                Row(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 3.dp)
                                            .defaultMinSize(minHeight = 44.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(optBg)
                                            .border(1.dp, optBorder, RoundedCornerShape(8.dp))
                                            .clickable {
                                                if (selected == null) {
                                                    userAnswers[question.id] = optIdx
                                                }
                                            }
                                            .padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = "${('A'.code + optIdx).toChar()}.",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = option,
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        modifier = Modifier.weight(1f),
                                    )
                                    if (selected != null) {
                                        if (isCorrect) {
                                            Icon(
                                                imageVector = Icons.Outlined.Check,
                                                contentDescription = "Correct",
                                                tint = StatusColors.success(isDark),
                                                modifier = Modifier.size(18.dp),
                                            )
                                        } else if (isChosen) {
                                            Icon(
                                                imageVector = Icons.Outlined.Close,
                                                contentDescription = "Incorrect",
                                                tint = MaterialTheme.colorScheme.error,
                                                modifier = Modifier.size(18.dp),
                                            )
                                        }
                                    }
                                }
                            }

                            if (selected != null && question.explanation != null) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Explanation: ${question.explanation}",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    item {
                        OutlinedButton(
                            onClick = { userAnswers.clear() },
                            modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 46.dp),
                            shape = RoundedCornerShape(10.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        ) {
                            Text("Restart Quiz", fontWeight = FontWeight.SemiBold)
                        }
                    }
                } else if (practiceQuizError != null) {
                    // A failed generation is reported as a FAILURE with a
                    // retry - never as the "select an exam" instruction,
                    // which would blame the user for a broken generation.
                    item {
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.error.copy(alpha = 0.5f),
                                        RoundedCornerShape(16.dp),
                                    )
                                    .padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = practiceQuizError!!,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.error,
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            OutlinedButton(
                                onClick = {
                                    userAnswers.clear()
                                    activePracticeId?.let { viewModel.openPracticeQuiz(it) }
                                },
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Retry", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                } else if (activePracticeId == null && assessments.isNotEmpty()) {
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
                                    .padding(28.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "Select an exam above to generate 5 practice questions.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                item { Spacer(modifier = Modifier.height(16.dp)) }
            }
        }
    }
}
