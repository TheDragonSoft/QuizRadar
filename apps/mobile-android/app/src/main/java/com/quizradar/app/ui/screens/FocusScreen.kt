package com.quizradar.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quizradar.app.core.topicKey
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.PracticeQuizModel
import com.quizradar.app.ui.PomodoroInterval
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.FocusHistoryCard
import com.quizradar.app.ui.components.FocusMistakeBankCard
import com.quizradar.app.ui.components.FocusReviewCard
import com.quizradar.app.ui.components.StatusTag
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
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The three top-level Focus segments (`docs/ANDROID-QUALITY-UI-BRIEF.md` §Focus). */
private enum class FocusSegment {
    SESSION,
    HISTORY,
    REVIEW,
}

/** Quiz answers survive segment switches and recreation as a user draft. */
private val UserAnswersSaver =
    mapSaver(
        save = { answers -> HashMap<String, Any?>(answers) },
        restore = { raw ->
            mutableStateMapOf<String, Int>().apply {
                raw.forEach { (key, value) -> if (value is Int) put(key, value) }
            }
        },
    )

@Composable
fun FocusScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    var segment by rememberSaveable { mutableStateOf(FocusSegment.SESSION) }

    // Pomodoro timer state from ViewModel (persists across tabs and app lifecycle)
    val selectedInterval by viewModel.pomodoroInterval.collectAsState()
    val secondsLeft by viewModel.pomodoroSecondsLeft.collectAsState()
    val isRunning by viewModel.pomodoroIsRunning.collectAsState()

    val activePomodoroAssessmentId by viewModel.activePomodoroAssessmentId.collectAsState()
    val activePomodoroTopic by viewModel.activePomodoroTopic.collectAsState()

    // Practice quiz state
    val activePracticeId by viewModel.activePracticeAssessmentId.collectAsState()
    val practiceQuiz by viewModel.practiceQuiz.collectAsState()
    val practiceQuizError by viewModel.practiceQuizError.collectAsState()
    val isPracticeLoading by viewModel.isPracticeLoading.collectAsState()
    val userAnswers = rememberSaveable(saver = UserAnswersSaver) { mutableStateMapOf<String, Int>() }

    // If AssessmentDetailSheet launched Practice Quiz, switch straight to REVIEW
    LaunchedEffect(activePracticeId) {
        if (activePracticeId != null) {
            segment = FocusSegment.REVIEW
        }
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
    ) {
        Spacer(modifier = Modifier.height(12.dp))

        // Top switcher: Session / History / Review inside a unified segmented pill track.
        val navTrackShape = RoundedCornerShape(14.dp)
        val navPillShape = RoundedCornerShape(10.dp)
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(navTrackShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
                        shape = navTrackShape,
                    ).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FocusSegment.values().forEach { entry ->
                val isSelected = segment == entry
                val tabLabel =
                    when (entry) {
                        FocusSegment.SESSION -> "Session"
                        FocusSegment.HISTORY -> "History"
                        FocusSegment.REVIEW -> "Review"
                    }
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = 40.dp)
                            .clip(navPillShape)
                            .background(
                                if (isSelected) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    Color.Transparent
                                },
                            ).selectable(
                                selected = isSelected,
                                role = Role.Tab,
                                onClick = { segment = entry },
                            ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = tabLabel,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
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

        Spacer(modifier = Modifier.height(16.dp))

        when (segment) {
            FocusSegment.SESSION ->
                FocusSessionSection(
                    selectedInterval = selectedInterval,
                    secondsLeft = secondsLeft,
                    isRunning = isRunning,
                    activePomodoroAssessmentId = activePomodoroAssessmentId,
                    activePomodoroTopic = activePomodoroTopic,
                    onIntervalSelected = { viewModel.selectPomodoroInterval(it) },
                    onPlayPause = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        if (isRunning) {
                            viewModel.pausePomodoro()
                        } else {
                            viewModel.startPomodoro(context.applicationContext)
                        }
                    },
                    onReset = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.resetPomodoro()
                    },
                    onMarkTopicDone = { completionKey -> viewModel.toggleTopic(completionKey, true) },
                )
            FocusSegment.HISTORY -> {
                val streakDays by viewModel.studyStreakDays.collectAsState()
                val courseMinutes by viewModel.studyMinutesByCourse.collectAsState()
                val sessionsJson by viewModel.studySessionsJson.collectAsState()
                Column(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(bottom = 88.dp),
                ) {
                    FocusHistoryCard(
                        streakDays = streakDays,
                        minutesByCourse = courseMinutes,
                        sessionsJson = sessionsJson,
                        // Real course names from the snapshot - never invented
                        // labels for stored course ids.
                        courseNames =
                            (
                                snapshot.schedule.courses.associate { it.id to it.name } +
                                    snapshot.assessments.mapNotNull { a ->
                                        a.courseId?.let { id -> a.courseName?.let { id to it } }
                                    }.toMap()
                            ),
                        courseColorsById = snapshot.schedule.courses.associate { it.id to it.color },
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
            FocusSegment.REVIEW ->
                FocusReviewSegment(
                    snapshot = snapshot,
                    viewModel = viewModel,
                    isDark = isDark,
                    userAnswers = userAnswers,
                    activePracticeId = activePracticeId,
                    practiceQuiz = practiceQuiz,
                    practiceQuizError = practiceQuizError,
                    isPracticeLoading = isPracticeLoading,
                )
        }
    }
}

/**
 * The Session segment: interval chips, the timer circle, its controls and the
 * linked topic. History moved out of this scroll (P3-5) into its own segment.
 */
@Composable
private fun FocusSessionSection(
    selectedInterval: PomodoroInterval,
    secondsLeft: Int,
    isRunning: Boolean,
    activePomodoroAssessmentId: String?,
    activePomodoroTopic: String?,
    onIntervalSelected: (PomodoroInterval) -> Unit,
    onPlayPause: () -> Unit,
    onReset: () -> Unit,
    onMarkTopicDone: (String) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(bottom = 88.dp)
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val totalSeconds = selectedInterval.minutes * 60
        val progress = 1f - (secondsLeft.toFloat() / totalSeconds.toFloat())
        val mins = secondsLeft / 60
        val secs = secondsLeft % 60
        val timeDisplay = String.format("%02d:%02d", mins, secs)
        val statusText =
            if (isRunning) {
                "Focusing"
            } else if (secondsLeft == 0) {
                "Session Complete"
            } else {
                "Ready to Focus"
            }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            elevation = CardDefaults.quietCardElevation(),
            shape = RoundedCornerShape(20.dp),
        ) {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "POMODORO TIMER",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    StatusTag(
                        text = statusText,
                        containerColor =
                            if (isRunning) {
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        contentColor =
                            if (isRunning) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Interval Switcher (25m / 5m / 15m) inside a compact secondary track
                val intervalTrackShape = RoundedCornerShape(11.dp)
                val intervalPillShape = RoundedCornerShape(8.dp)
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(intervalTrackShape)
                            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f))
                            .padding(3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PomodoroInterval.values().forEach { interval ->
                        val isSelected = selectedInterval == interval
                        val chipLabel =
                            when (interval) {
                                PomodoroInterval.POMODORO -> "Focus ${interval.minutes}m"
                                PomodoroInterval.SHORT_BREAK -> "Short ${interval.minutes}m"
                                PomodoroInterval.LONG_BREAK -> "Long ${interval.minutes}m"
                            }
                        Box(
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .defaultMinSize(minHeight = 36.dp)
                                    .clip(intervalPillShape)
                                    .background(
                                        if (isSelected) {
                                            MaterialTheme.colorScheme.surface
                                        } else {
                                            Color.Transparent
                                        },
                                    ).then(
                                        if (isSelected) {
                                            Modifier.border(
                                                1.dp,
                                                MaterialTheme.colorScheme.primary.copy(alpha = 0.45f),
                                                intervalPillShape,
                                            )
                                        } else {
                                            Modifier
                                        },
                                    ).selectable(
                                        selected = isSelected,
                                        role = Role.RadioButton,
                                        onClick = { onIntervalSelected(interval) },
                                    ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = chipLabel,
                                style =
                                    MaterialTheme.typography.labelMedium.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                color =
                                    if (isSelected) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                maxLines = 1,
                                softWrap = false,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Timer Display Circle
                Box(
                    modifier = Modifier.size(212.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    val primaryColor = MaterialTheme.colorScheme.primary
                    Box(
                        modifier =
                            Modifier
                                .size(182.dp)
                                .clip(CircleShape)
                                .background(primaryColor.copy(alpha = 0.04f))
                                .border(1.dp, primaryColor.copy(alpha = 0.10f), CircleShape),
                    )
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
                                color = primaryColor,
                                radius = 3.5.dp.toPx(),
                                center = androidx.compose.ui.geometry.Offset(cx, cy),
                            )
                        }
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = timeDisplay,
                            style =
                                MaterialTheme.typography.displayMedium.copy(
                                    fontFeatureSettings = "tnum",
                                ),
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text =
                                when (selectedInterval) {
                                    PomodoroInterval.POMODORO -> "25 min Focus Block"
                                    PomodoroInterval.SHORT_BREAK -> "5 min Short Break"
                                    PomodoroInterval.LONG_BREAK -> "15 min Long Break"
                                },
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(22.dp))

                // Play / Pause / Reset controls row
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = onPlayPause,
                        shape = CircleShape,
                        contentPadding = PaddingValues(0.dp),
                        colors = ButtonDefaults.filledPill(),
                        modifier = Modifier.size(60.dp),
                    ) {
                        Icon(
                            imageVector = if (isRunning) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                            contentDescription = if (isRunning) "Pause" else "Play",
                            modifier = Modifier.size(28.dp),
                        )
                    }

                    OutlinedIconButton(
                        onClick = onReset,
                        shape = CircleShape,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.size(52.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "Reset",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
        }

        // Session Cadence Strip (fills out the lower layout cleanly)
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.quietCardColors(),
            border = CardDefaults.quietCardBorder(),
            shape = RoundedCornerShape(16.dp),
        ) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                listOf(
                    Triple("25m", "Deep Focus", selectedInterval == PomodoroInterval.POMODORO),
                    Triple("5m", "Short Break", selectedInterval == PomodoroInterval.SHORT_BREAK),
                    Triple("15m", "Long Break", selectedInterval == PomodoroInterval.LONG_BREAK),
                ).forEach { (duration, caption, active) ->
                    Column(
                        modifier =
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (active) {
                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
                                    } else {
                                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
                                    },
                                ).padding(vertical = 10.dp, horizontal = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = duration,
                            style =
                                MaterialTheme.typography.titleMedium.copy(
                                    fontFeatureSettings = "tnum",
                                ),
                            fontWeight = FontWeight.Bold,
                            color =
                                if (active) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                },
                        )
                        Text(
                            text = caption,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        // Linked topic section
        if (activePomodoroTopic != null) {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
                        .border(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.45f),
                            RoundedCornerShape(16.dp),
                        ).padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "Working on topic",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = activePomodoroTopic ?: "",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(12.dp))
                // The completion key is content-addressed from
                // the topic text (`{id}::h{hash}`, `01` §3) —
                // never a positional index, so a rescan that
                // reorders topics cannot move the checkmark.
                // Local copies: the state delegates cannot smart-
                // cast through the null check.
                val completionKey =
                    if (activePomodoroAssessmentId != null && activePomodoroTopic != null) {
                        topicKey(activePomodoroAssessmentId, activePomodoroTopic)
                    } else {
                        null
                    }
                // Tonal, not filled: the play/pause circle is the Session
                // flow's one filled primary action.
                FilledTonalButton(
                    onClick = {
                        if (completionKey != null) {
                            onMarkTopicDone(completionKey)
                        }
                    },
                    enabled = completionKey != null,
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Check,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(text = "Mark Topic Done", style = MaterialTheme.typography.labelMedium)
                }
                if (completionKey == null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "This topic's completion key is unknown - reopen it from the assessment.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

/**
 * The Review segment: the practice quiz (with its honest on-device fallback
 * label; the AI branch is consent-gated in the ViewModel/core) followed by
 * flashcard and mistake-bank review.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FocusReviewSegment(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    isDark: Boolean,
    userAnswers: SnapshotStateMap<String, Int>,
    activePracticeId: String?,
    practiceQuiz: PracticeQuizModel?,
    practiceQuizError: String?,
    isPracticeLoading: Boolean,
) {
    val assessments = snapshot.assessments
    val datedAssessments =
        assessments
            .filter { it.dateIso != null }
            .sortedBy { it.dateIso }
    val chipDateFormatter = DateTimeFormatter.ofPattern("MMM d", Locale.US)

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 88.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text(
                text = "Select an exam to practice",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))
            if (assessments.isEmpty()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors(),
                    elevation = CardDefaults.quietCardElevation(),
                    border = CardDefaults.quietCardBorder(),
                ) {
                    Text(
                        text = "Add or import an assessment first to unlock practice quizzes.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            } else {
                // Every DATED assessment, soonest first; FlowRow lets long names wrap cleanly.
                if (datedAssessments.isEmpty()) {
                    Text(
                        text =
                            "No dated assessments to practice yet - a scan or an event " +
                                "with a confirmed date unlocks practice quizzes.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        datedAssessments.forEach { a ->
                            val isChosenExam = activePracticeId == a.id
                            val label = a.courseName ?: a.courseId ?: a.title.take(10)
                            val dateSuffix = a.dateIso?.let { " · ${it.format(chipDateFormatter)}" } ?: ""
                            FilterChip(
                                selected = isChosenExam,
                                onClick = {
                                    userAnswers.clear()
                                    viewModel.openPracticeQuiz(a.id)
                                },
                                label = {
                                    Text(
                                        text = label + dateSuffix,
                                        style =
                                            MaterialTheme.typography.labelMedium.copy(
                                                fontFeatureSettings = "tnum",
                                            ),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                },
                                leadingIcon = { if (isChosenExam) ChipLeadingCheck() },
                                colors = FilterChipDefaults.quietChipColors(),
                                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                            )
                        }
                    }
                }
            }
        }

        if (isPracticeLoading) {
            item {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Generating practice questions…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else if (practiceQuiz != null) {
            val quiz = practiceQuiz
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = quiz.assessmentTitle,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        val badgeText =
                            when {
                                quiz.generatedByAi -> "Generated by Gemini AI"
                                else -> "Authored locally from your topics"
                            }
                        Text(
                            text = badgeText,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        // A07 honesty: when AI was attempted but did not author
                        // the quiz, the core names exactly why - shown inline.
                        quiz.fallbackReason?.let { reason ->
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "AI not used: $reason",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }

                    Spacer(modifier = Modifier.width(12.dp))
                    val score =
                        quiz.questions.count { q ->
                            userAnswers[q.id] == q.correctIndex
                        }
                    StatusTag(
                        text = "Score: $score / ${quiz.questions.size}",
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        tabular = true,
                    )
                }
            }

            // Question Cards
            itemsIndexed(quiz.questions, key = { qIdx, question -> question.id.ifBlank { qIdx.toString() } }) { qIdx, question ->
                val selected = userAnswers[question.id]
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors(),
                    elevation = CardDefaults.quietCardElevation(),
                    border = CardDefaults.quietCardBorder(),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Q${qIdx + 1}: ${question.question}",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(12.dp))

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
                                        .padding(vertical = 4.dp)
                                        .defaultMinSize(minHeight = 48.dp)
                                        .clip(MaterialTheme.shapes.extraSmall)
                                        .background(optBg)
                                        .border(1.dp, optBorder, MaterialTheme.shapes.extraSmall)
                                        .clickable {
                                            if (selected == null) {
                                                userAnswers[question.id] = optIdx
                                            }
                                        }
                                        .padding(horizontal = 12.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "${('A'.code + optIdx).toChar()}.",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = option,
                                    style = MaterialTheme.typography.bodyMedium,
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
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            item {
                FilledTonalButton(
                    onClick = { userAnswers.clear() },
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Restart Quiz", style = MaterialTheme.typography.labelMedium)
                }
            }
        } else if (practiceQuizError != null) {
            // A failed generation is reported as a FAILURE with a
            // retry - never as the "select an exam" instruction,
            // which would blame the user for a broken generation.
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors(),
                    elevation = CardDefaults.quietCardElevation(),
                    // The error-tinted border is the one deliberate deviation
                    // from the quiet outlineVariant: a failed generation is a
                    // failure and must read as one.
                    border =
                        BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.error.copy(alpha = 0.5f),
                        ),
                ) {
                    val missingAssessment =
                        practiceQuizError?.contains("is no longer on the radar", ignoreCase = true) == true
                    val friendlyErrorText =
                        when {
                            practiceQuizError == null -> "Unable to generate practice questions right now."
                            missingAssessment ->
                                "That assessment is no longer on your radar. Pick a current exam above " +
                                    "or generate an offline quiz for an available exam."
                            else -> practiceQuizError
                        }
                    val fallbackAssessment = datedAssessments.firstOrNull() ?: assessments.firstOrNull()
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = friendlyErrorText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (!missingAssessment && activePracticeId != null) {
                                FilledTonalButton(
                                    onClick = {
                                        userAnswers.clear()
                                        viewModel.openPracticeQuiz(activePracticeId)
                                    },
                                    colors = ButtonDefaults.tonalPill(),
                                    contentPadding = PillButtonContentPadding,
                                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Refresh,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp),
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Retry", style = MaterialTheme.typography.labelLarge)
                                }
                            } else if (fallbackAssessment != null) {
                                FilledTonalButton(
                                    onClick = {
                                        userAnswers.clear()
                                        viewModel.openPracticeQuiz(fallbackAssessment.id)
                                    },
                                    colors = ButtonDefaults.tonalPill(),
                                    contentPadding = PillButtonContentPadding,
                                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                                ) {
                                    Text("Practice locally", style = MaterialTheme.typography.labelLarge)
                                }
                            }
                            TextButton(
                                onClick = {
                                    userAnswers.clear()
                                    viewModel.closePracticeQuiz()
                                },
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text("Choose exam", style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                }
            }
        } else if (activePracticeId == null && assessments.isNotEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors(),
                    elevation = CardDefaults.quietCardElevation(),
                    border = CardDefaults.quietCardBorder(),
                ) {
                    Text(
                        text = "Select an exam above to generate 5 practice questions.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
        }

        item {
            val flashcardsJson by viewModel.flashcardsJson.collectAsState()
            FocusReviewCard(
                flashcardsJson = flashcardsJson,
                onReview = { cardId, correct, onResult ->
                    viewModel.reviewFlashcard(cardId, correct, onResult)
                },
                onCreate = { cardJson, onResult ->
                    viewModel.upsertFlashcard(cardJson, onResult)
                },
            )
        }

        item {
            val mistakesJson by viewModel.mistakesJson.collectAsState()
            FocusMistakeBankCard(
                mistakesJson = mistakesJson,
                onResolve = { mistakeId, onResult ->
                    viewModel.resolveMistake(mistakeId, onResult)
                },
            )
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}
