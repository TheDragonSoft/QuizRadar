package com.quizradar.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Quiz
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import kotlinx.coroutines.delay

private enum class FocusMode {
    POMODORO,
    PRACTICE_QUIZ,
}

private enum class PomodoroInterval(val minutes: Int, val label: String) {
    POMODORO(25, "Pomodoro"),
    SHORT_BREAK(5, "Short Break"),
    LONG_BREAK(15, "Long Break"),
}

@Composable
fun FocusScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    var mode by remember { mutableStateOf(FocusMode.POMODORO) }

    // Pomodoro timer state
    var selectedInterval by remember { mutableStateOf(PomodoroInterval.POMODORO) }
    var secondsLeft by remember(selectedInterval) { mutableIntStateOf(selectedInterval.minutes * 60) }
    var isRunning by remember { mutableStateOf(false) }

    val activePomodoroAssessmentId by viewModel.activePomodoroAssessmentId.collectAsState()
    val activePomodoroTopic by viewModel.activePomodoroTopic.collectAsState()

    // Practice quiz state
    val practiceQuiz by viewModel.practiceQuiz.collectAsState()
    val isPracticeLoading by viewModel.isPracticeLoading.collectAsState()
    val userAnswers = remember { mutableStateMapOf<String, Int>() }

    // Pomodoro tick loop
    LaunchedEffect(isRunning, secondsLeft) {
        if (isRunning && secondsLeft > 0) {
            delay(1000)
            secondsLeft -= 1
        } else if (isRunning && secondsLeft == 0) {
            isRunning = false
        }
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp),
    ) {
        Spacer(modifier = Modifier.height(12.dp))

        // Top Switcher: Pomodoro vs Practice Quiz
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(12.dp))
                    .padding(4.dp),
        ) {
            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (mode == FocusMode.POMODORO) MaterialTheme.colorScheme.primary else Color.Transparent)
                        .clickable { mode = FocusMode.POMODORO }
                        .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Timer,
                    contentDescription = null,
                    tint = if (mode == FocusMode.POMODORO) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "Pomodoro Timer",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (mode == FocusMode.POMODORO) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }

            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (mode == FocusMode.PRACTICE_QUIZ) MaterialTheme.colorScheme.primary else Color.Transparent)
                        .clickable { mode = FocusMode.PRACTICE_QUIZ }
                        .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.Quiz,
                    contentDescription = null,
                    tint = if (mode == FocusMode.PRACTICE_QUIZ) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "Practice Quiz",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (mode == FocusMode.PRACTICE_QUIZ) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (mode == FocusMode.POMODORO) {
            // Pomodoro Screen Content
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // Interval Switcher Pills (25m / 5m / 15m)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    PomodoroInterval.values().forEach { interval ->
                        val isSelected = selectedInterval == interval
                        Text(
                            text = "${interval.label} (${interval.minutes}m)",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isSelected) Color.White else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                            modifier =
                                Modifier
                                    .padding(horizontal = 4.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                                    .clickable {
                                        selectedInterval = interval
                                        secondsLeft = interval.minutes * 60
                                        isRunning = false
                                    }
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }

                Spacer(modifier = Modifier.height(36.dp))

                // Timer Display Circle
                val totalSeconds = selectedInterval.minutes * 60
                val progress = 1f - (secondsLeft.toFloat() / totalSeconds.toFloat())
                val mins = secondsLeft / 60
                val secs = secondsLeft % 60
                val timeDisplay = String.format("%02d:%02d", mins, secs)

                Box(
                    modifier = Modifier.size(220.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        progress = { progress },
                        modifier = Modifier.fillMaxSize(),
                        strokeWidth = 10.dp,
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                    )
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = timeDisplay,
                            fontSize = 44.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text =
                                if (isRunning) {
                                    "FOCUSING"
                                } else if (secondsLeft == 0) {
                                    "SESSION COMPLETE"
                                } else {
                                    "PAUSED"
                                },
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color =
                                if (isRunning) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurface.copy(
                                        alpha = 0.5f,
                                    )
                                },
                        )
                    }
                }

                Spacer(modifier = Modifier.height(28.dp))

                // Play / Pause / Reset buttons
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = { isRunning = !isRunning },
                        shape = CircleShape,
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = if (isRunning) Color(0xFFDC2626) else MaterialTheme.colorScheme.primary,
                            ),
                        modifier = Modifier.size(60.dp),
                    ) {
                        Icon(
                            imageVector = if (isRunning) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                            contentDescription = if (isRunning) "Pause" else "Play",
                            modifier = Modifier.size(28.dp),
                        )
                    }

                    OutlinedButton(
                        onClick = {
                            isRunning = false
                            secondsLeft = selectedInterval.minutes * 60
                        },
                        shape = CircleShape,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "Reset",
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                // Linked topic section
                if (activePomodoroTopic != null) {
                    Spacer(modifier = Modifier.height(24.dp))
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(12.dp))
                                .padding(14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "WORKING ON TOPIC",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = activePomodoroTopic!!,
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Button(
                            onClick = {
                                if (activePomodoroAssessmentId != null) {
                                    val key = "$activePomodoroAssessmentId::0"
                                    viewModel.toggleTopic(key, true)
                                }
                            },
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Icon(imageVector = Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(text = "Mark Topic Done", fontSize = 12.sp)
                        }
                    }
                }
            }
        } else {
            // Practice Quiz Screen Content
            val assessments = snapshot.assessments

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Assessment Picker Header
                item {
                    Text(
                        text = "SELECT EXAM TO PRACTICE",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        assessments.take(3).forEach { a ->
                            Button(
                                onClick = {
                                    userAnswers.clear()
                                    viewModel.openPracticeQuiz(a.id)
                                },
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(text = a.courseId ?: a.title.take(8), fontSize = 11.sp, maxLines = 1)
                            }
                        }
                    }
                }

                if (isPracticeLoading) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
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
                            Column {
                                Text(
                                    text = quiz.assessmentTitle,
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
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
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }

                            // Score pill
                            val score =
                                quiz.questions.count { q ->
                                    userAnswers[q.id] == q.correctIndex
                                }
                            Text(
                                text = "Score: $score / ${quiz.questions.size}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    // Question Cards
                    itemsIndexed(quiz.questions) { qIdx, question ->
                        val selected = userAnswers[question.id]
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surface)
                                    .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f), RoundedCornerShape(12.dp))
                                    .padding(14.dp),
                        ) {
                            Text(
                                text = "Q${qIdx + 1}: ${question.question}",
                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                            )
                            Spacer(modifier = Modifier.height(10.dp))

                            question.options.forEachIndexed { optIdx, option ->
                                val isChosen = selected == optIdx
                                val isCorrect = question.correctIndex == optIdx

                                val (optBg, optBorder) =
                                    if (selected != null) {
                                        if (isCorrect) {
                                            Color(0xFF059669).copy(alpha = 0.15f) to Color(0xFF059669)
                                        } else if (isChosen) {
                                            Color(0xFFDC2626).copy(alpha = 0.15f) to Color(0xFFDC2626)
                                        } else {
                                            Color.Transparent to MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
                                        }
                                    } else {
                                        Color.Transparent to MaterialTheme.colorScheme.onSurface.copy(alpha = 0.15f)
                                    }

                                Row(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 3.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(optBg)
                                            .border(1.dp, optBorder, RoundedCornerShape(8.dp))
                                            .clickable {
                                                if (selected == null) {
                                                    userAnswers[question.id] = optIdx
                                                }
                                            }
                                            .padding(horizontal = 10.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = "${('A'.code + optIdx).toChar()}.",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp,
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(text = option, fontSize = 12.sp, modifier = Modifier.weight(1f))
                                    if (selected != null) {
                                        if (isCorrect) {
                                            Icon(
                                                imageVector = Icons.Outlined.Check,
                                                contentDescription = "Correct",
                                                tint = Color(0xFF059669),
                                                modifier = Modifier.size(16.dp),
                                            )
                                        } else if (isChosen) {
                                            Icon(
                                                imageVector = Icons.Outlined.Close,
                                                contentDescription = "Incorrect",
                                                tint = Color(0xFFDC2626),
                                                modifier = Modifier.size(16.dp),
                                            )
                                        }
                                    }
                                }
                            }

                            // Explanation reveal if answered
                            if (selected != null && question.explanation != null) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Explanation: ${question.explanation}",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                                )
                            }
                        }
                    }

                    item {
                        OutlinedButton(
                            onClick = { userAnswers.clear() },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("Restart Quiz")
                        }
                    }
                } else {
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
                                text = "Select an exam above to generate 5 practice questions.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                        }
                    }
                }

                item { Spacer(modifier = Modifier.height(16.dp)) }
            }
        }
    }
}
