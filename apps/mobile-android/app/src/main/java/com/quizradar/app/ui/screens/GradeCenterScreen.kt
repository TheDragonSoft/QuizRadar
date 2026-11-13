package com.quizradar.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.components.GpaHistoryCard
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.quietTextFieldColors
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * One row of the persisted practice-attempt log (`core/src/types.rs`:
 * `QuizAttempt`). The shell reads the stored record as-is - the score is the
 * score the practice flow saved, nothing is recomputed.
 */
private data class AttemptRow(
    val assessmentId: String,
    val courseId: String?,
    val score: Int,
    val totalQuestions: Int,
    val passed: Boolean,
    val timestamp: String,
)

/**
 * Parses the persisted attempt list. A malformed payload yields an EMPTY
 * list instead of a crash or a made-up score - the screen then shows its
 * honest empty state.
 */
private fun parseQuizAttempts(json: String): List<AttemptRow> =
    runCatching {
        val array = JSONArray(json)
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            AttemptRow(
                assessmentId = item.optString("assessment_id"),
                courseId =
                    item.optString("course_id").takeIf {
                        it.isNotBlank() && !item.isNull("course_id")
                    },
                score = item.optInt("score", 0),
                totalQuestions = item.optInt("total_questions", 0),
                passed = item.optBoolean("passed", false),
                timestamp = item.optString("timestamp"),
            )
        }
    }.getOrDefault(emptyList())

/**
 * The parsed weighted grade-target result (`core/src/plan/grade_target.rs`:
 * `GradeTargetResult`). `requiredAverageOnRemaining` is `null` when the core
 * refuses to invent a number (target secured / unreachable / unknown
 * remaining weight) - the `note` carries the honest explanation.
 */
private data class GradeTargetData(
    val courseId: String,
    val weightsKnown: Boolean,
    val equalWeightAssumed: Boolean,
    val gradedWeight: Double,
    val remainingWeight: Double?,
    val currentPercentage: Double?,
    val targetLetter: String,
    val targetPercentage: Double,
    val requiredAverageOnRemaining: Double?,
    val achievable: Boolean,
    val note: String,
)

/**
 * Reads a JSON double the honest way: an absent or null field stays `null`,
 * and a non-numeric field never sneaks a `NaN` onto the screen as a number.
 */
private fun JSONObject.optDoubleOrNull(name: String): Double? = if (isNull(name)) null else optDouble(name).takeIf { !it.isNaN() }

private fun parseGradeTarget(json: String?): GradeTargetData? =
    runCatching {
        if (json.isNullOrBlank()) return null
        val obj = JSONObject(json)
        GradeTargetData(
            courseId = obj.optString("course_id"),
            weightsKnown = obj.optBoolean("weights_known", false),
            equalWeightAssumed = obj.optBoolean("equal_weight_assumed", false),
            gradedWeight = obj.optDouble("graded_weight", 0.0),
            remainingWeight = obj.optDoubleOrNull("remaining_weight"),
            currentPercentage = obj.optDoubleOrNull("current_percentage"),
            targetLetter = obj.optString("target_letter"),
            targetPercentage = obj.optDouble("target_percentage", 0.0),
            requiredAverageOnRemaining = obj.optDoubleOrNull("required_average_on_remaining"),
            achievable = obj.optBoolean("achievable", false),
            note = obj.optString("note"),
        )
    }.getOrDefault(null)

/**
 * The grading scales the shared engine supports (`evaluate_scale` in
 * `core/src/plan/gpa.rs`). The letter lists mirror
 * `minimum_percentage_for_letter` exactly, so a chip can never select a
 * target the core cannot resolve.
 */
private data class ScaleOption(
    val key: String,
    val label: String,
    val letters: List<String>?,
)

private val SCALE_OPTIONS =
    listOf(
        ScaleOption(key = "4.0", label = "US 4.0", letters = listOf("A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D")),
        ScaleOption(key = "ects", label = "ECTS", letters = listOf("A", "B", "C", "D", "E")),
        ScaleOption(key = "uk_honors", label = "UK Honours", letters = listOf("1st", "2:1", "2:2", "3rd")),
        ScaleOption(key = "percentage", label = "Percentage", letters = null),
    )

/** The stored timestamp, shortened to "date · hh:mm" (no invented clock). */
private fun attemptTimestampLabel(timestamp: String): String {
    val date = timestamp.substringBefore('T')
    val time = timestamp.substringAfter('T', "").take(5)
    return if (time.isBlank()) date else "$date · $time"
}

/**
 * Grade Center (audit A15 / brief "Tasks → Grade Center").
 *
 * Everything on this screen comes from the store through the shared Rust
 * engine: the GPA summary via `calculateGpa`, the weighted what-if target
 * via `calculateGradeTarget` (which reuses the GPA engine's weighting rules
 * and labels any equal-weight assumption), and the practice-attempt log via
 * `listQuizAttempts`. A course without graded work shows "—", an unreachable
 * or already-secured target reports the honest note instead of a number.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GradeCenterScreen(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val gpaSummaryJson by viewModel.gpaSummaryJson.collectAsState()
    val gradeTargetJson by viewModel.gradeTargetJson.collectAsState()
    val quizAttemptsJson by viewModel.quizAttemptsJson.collectAsState()

    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val courses = snapshot.schedule.courses

    var scaleKey by rememberSaveable { mutableStateOf("4.0") }
    var selectedCourseId by rememberSaveable { mutableStateOf("") }
    // Reset per scale: each scale has its own letter set (or numeric entry).
    var targetLetter by rememberSaveable(scaleKey) { mutableStateOf("B") }
    var percentTargetDraft by rememberSaveable(scaleKey) { mutableStateOf("") }
    var percentTargetError by rememberSaveable(scaleKey) { mutableStateOf<String?>(null) }

    val scale = SCALE_OPTIONS.first { it.key == scaleKey }
    val selectedCourse = courses.firstOrNull { it.id == selectedCourseId } ?: courses.firstOrNull()
    val courseAssessments =
        remember(snapshot.assessments, selectedCourse?.id) {
            snapshot.assessments.filter { it.courseId == selectedCourse?.id }
        }

    LaunchedEffect(scaleKey) {
        viewModel.refreshGpaSummary(scaleKey)
    }
    LaunchedEffect(selectedCourse?.id, scaleKey, targetLetter, percentTargetDraft) {
        val courseId = selectedCourse?.id ?: return@LaunchedEffect
        if (scale.letters == null) {
            val value = percentTargetDraft.trim().toDoubleOrNull()
            if (value != null && value in 0.0..100.0) {
                viewModel.calculateGradeTarget(courseId, percentTargetDraft.trim(), scaleKey)
            }
        } else {
            viewModel.calculateGradeTarget(courseId, targetLetter, scaleKey)
        }
    }

    val gradeTarget = remember(gradeTargetJson) { parseGradeTarget(gradeTargetJson) }
    val targetIsStale =
        gradeTarget == null ||
            gradeTarget.courseId != selectedCourse?.id ||
            gradeTarget.targetLetter != (scale.letters?.let { targetLetter } ?: percentTargetDraft.trim())

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "Grade Center",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )

        // --- Scale selector: the system chip - the leading check carries selection. ---
        SectionHeader(text = "Grading scale")
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            SCALE_OPTIONS.forEach { option ->
                QuietFilterChip(
                    label = option.label,
                    selected = scaleKey == option.key,
                    onClick = { scaleKey = option.key },
                )
            }
        }

        // --- The shared GPA summary, recomputed per selected scale. ---
        GpaHistoryCard(
            gpaSummaryJson = gpaSummaryJson,
            scaleLabel = scale.label,
        )

        if (courses.isEmpty()) {
            HonestNoteCard(
                text =
                    "No courses yet. Add a course and the Grade Center shows its grades, " +
                        "GPA and practice attempts here.",
            )
            return@Column
        }

        // --- Course picker: one chip per real course, nothing invented. ---
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader(text = "Courses")
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            courses.forEach { course ->
                QuietFilterChip(
                    label = course.name,
                    selected = selectedCourse?.id == course.id,
                    onClick = { selectedCourseId = course.id },
                )
            }
        }

        // --- Per-course grade list: scores the store actually holds. ---
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader(text = "Graded items")
        if (courseAssessments.isEmpty()) {
            HonestNoteCard(
                text = "No assessments recorded for ${selectedCourse?.name ?: "this course"} yet.",
            )
        } else {
            QuietCard {
                // 4dp + each row's own 12dp = the 16dp card edge (§5).
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                    courseAssessments.forEachIndexed { index, assessment ->
                        if (index > 0) HorizontalDivider()
                        val record = snapshot.grades[assessment.id]
                        GradedItemRow(
                            title = assessment.title,
                            type = assessment.assessmentType,
                            achieved = record?.achievedScore ?: assessment.achievedScore,
                            maxScore = record?.maxScore ?: assessment.maxScore,
                            weight = record?.weightagePercent ?: assessment.weightagePercent,
                        )
                    }
                }
            }
        }

        // --- Weighted what-if target (A15): the core's calculation. ---
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader(text = "What-if target")
        if (scale.letters != null) {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                scale.letters.forEach { letter ->
                    QuietFilterChip(
                        label = letter,
                        selected = targetLetter == letter,
                        onClick = { targetLetter = letter },
                    )
                }
            }
        } else {
            OutlinedTextField(
                value = percentTargetDraft,
                onValueChange = { input ->
                    percentTargetDraft = input
                    val value = input.trim().toDoubleOrNull()
                    percentTargetError =
                        when {
                            input.isBlank() -> null
                            value == null -> "Enter a number, for example 75."
                            value < 0.0 || value > 100.0 -> "Enter a percentage between 0 and 100."
                            else -> null
                        }
                },
                label = { Text("Target percentage") },
                isError = percentTargetError != null,
                supportingText = {
                    val error = percentTargetError
                    if (error != null) {
                        Text(error, color = MaterialTheme.colorScheme.error)
                    }
                },
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        when {
            selectedCourse == null -> {}

            targetIsStale -> {
                HonestNoteCard(text = "Calculating the target for the current selection…")
            }

            gradeTarget != null -> {
                GradeTargetResultCard(gradeTarget = gradeTarget, isDark = isDark)
            }

            else -> {}
        }

        // --- Persisted practice-attempt history, as the store holds it. ---
        Spacer(modifier = Modifier.height(8.dp))
        SectionHeader(text = "Practice attempts")
        val attempts = remember(quizAttemptsJson) { parseQuizAttempts(quizAttemptsJson) }
        val courseAttempts =
            attempts.filter { attempt ->
                attempt.courseId == selectedCourse?.id ||
                    snapshot.assessments.firstOrNull { it.id == attempt.assessmentId }?.courseId == selectedCourse?.id
            }
        if (courseAttempts.isEmpty()) {
            HonestNoteCard(
                text =
                    "No practice attempts saved for ${selectedCourse?.name ?: "this course"} yet. " +
                        "Finish a practice quiz in Focus and the recorded score is listed here.",
            )
        } else {
            QuietCard {
                // 4dp + each row's own 12dp = the 16dp card edge (§5).
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                    courseAttempts.forEachIndexed { index, attempt ->
                        if (index > 0) HorizontalDivider()
                        val title =
                            snapshot.assessments.firstOrNull { it.id == attempt.assessmentId }?.title
                                ?: attempt.assessmentId
                        PracticeAttemptRow(attempt = attempt, title = title, isDark = isDark)
                    }
                }
            }
        }
    }
}

/** "80" / "82.5" - the stored score, no rounding beyond what the store keeps. */
internal fun formatScore(value: Double): String =
    if (value == value.toLong().toDouble()) {
        value.toLong().toString()
    } else {
        String.format(Locale.US, "%.1f", value)
    }

/** Section header - titleMedium 16sp/600, the one heading level below the screen title. */
@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

/**
 * The one card treatment on this screen: 16dp radius from the theme, a single
 * 1dp outlineVariant border, no shadow (docs/ANDROID-DESIGN-SYSTEM.md §1).
 */
@Composable
private fun QuietCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(content = content)
    }
}

/**
 * The one chip this screen uses: the system filter chip, a leading check when
 * selected, and a 48dp touch target (FilterChip defaults to 32dp).
 */
@Composable
private fun QuietFilterChip(
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
        modifier =
            Modifier
                .defaultMinSize(minHeight = 48.dp)
                .selectable(
                    selected = selected,
                    role = Role.RadioButton,
                    onClick = onClick,
                ),
    )
}

/** The honest inline note card every empty/unavailable state on this screen uses. */
@Composable
private fun HonestNoteCard(text: String) {
    QuietCard {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(16.dp),
        )
    }
}

/** One graded item: the stored title/type, and its score + weight when marked. */
@Composable
private fun GradedItemRow(
    title: String,
    type: String,
    achieved: Double?,
    maxScore: Double?,
    weight: Double?,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 56.dp)
                .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = type,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text =
                    if (achieved != null && maxScore != null && maxScore > 0.0) {
                        String.format(Locale.US, "%s / %s", formatScore(achieved), formatScore(maxScore))
                    } else {
                        "Not marked yet"
                    },
                style =
                    MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.Bold,
                        fontFeatureSettings = "tnum",
                    ),
                color =
                    if (achieved != null) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = weight?.let { "Weight " + String.format(Locale.US, "%.1f%%", it) } ?: "Weight —",
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** One persisted practice attempt: the stored score and pass state, nothing recomputed. */
@Composable
private fun PracticeAttemptRow(
    attempt: AttemptRow,
    title: String,
    isDark: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 56.dp)
                .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = attemptTimestampLabel(attempt.timestamp),
                style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = "${attempt.score}/${attempt.totalQuestions}",
            style =
                MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontFeatureSettings = "tnum",
                ),
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = if (attempt.passed) "Passed" else "Not passed",
            style = MaterialTheme.typography.labelMedium,
            color =
                if (attempt.passed) {
                    StatusColors.success(isDark)
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
        )
    }
}

/**
 * The weighted target result exactly as the core computed it: the required
 * average when one exists, and the core's own note when it does not (target
 * secured, unreachable, unknown remaining weight) - never a fabricated
 * number. The equal-weight assumption is always surfaced, in words.
 */
@Composable
private fun GradeTargetResultCard(
    gradeTarget: GradeTargetData,
    isDark: Boolean,
) {
    QuietCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Target ${gradeTarget.targetLetter}",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                // "Now" is context; the required average below is the hero.
                Text(
                    text =
                        gradeTarget.currentPercentage?.let {
                            "Now " + String.format(Locale.US, "%.1f%%", it)
                        } ?: "—",
                    style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            when {
                gradeTarget.requiredAverageOnRemaining != null -> {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = String.format(Locale.US, "%.1f%%", gradeTarget.requiredAverageOnRemaining),
                            style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"),
                            color = StatusColors.success(isDark),
                            modifier = Modifier.alignByBaseline(),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text =
                                gradeTarget.remainingWeight?.let {
                                    "average needed on the remaining " +
                                        String.format(Locale.US, "%.1f%%", it) + " of the course"
                                } ?: "average needed on the remaining work",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.alignByBaseline(),
                        )
                    }
                }

                gradeTarget.achievable -> {
                    Text(
                        text = "Cannot be calculated",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> {
                    val targetSecured =
                        gradeTarget.currentPercentage != null &&
                            gradeTarget.currentPercentage >= gradeTarget.targetPercentage
                    Text(
                        text = if (targetSecured) "Target secured" else "Not reachable",
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        color =
                            if (targetSecured) {
                                StatusColors.success(isDark)
                            } else {
                                StatusColors.warningBadge
                            },
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = gradeTarget.note,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (gradeTarget.equalWeightAssumed) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Equal-weight assumption in effect — enter item weights for exact numbers.",
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    color = StatusColors.warningBadge,
                )
            }
        }
    }
}
