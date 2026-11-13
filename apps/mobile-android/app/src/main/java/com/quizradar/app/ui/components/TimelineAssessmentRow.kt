package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.extractTimePart
import com.quizradar.app.ui.formatIsoDateForDisplay
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation

/** Label of the amber conflict chip (web parity: `copy.dashboard.conflictBadge`). */
const val CONFLICT_CHIP_LABEL = "Conflict"

/**
 * How much the student can trust an assessment's DATE.
 *
 * The core explains every derivation in `ai_inference_note`, and that note's
 * own wording is the only signal the Android model carries (the core has no
 * separate date-confidence field). The label is therefore derived from the
 * note - and stays silent when the core said nothing, because nothing was
 * inferred.
 */
enum class DateProvenance {
    CONFIRMED,
    ESTIMATED,
    UNCONFIRMED,
}

data class DateProvenanceLabel(
    val label: String,
    val provenance: DateProvenance,
)

/**
 * The provenance label for an assessment's date, or `null` when the core
 * recorded no inference note (a hand-made item needs no explanation).
 */
fun assessmentDateProvenance(assessment: AssessmentModel): DateProvenanceLabel? {
    val note = assessment.aiInferenceNote?.trim().orEmpty()
    if (note.isEmpty()) return null
    return when {
        note.startsWith("Parsed from announcement", ignoreCase = true) ->
            DateProvenanceLabel("Date from the announcement", DateProvenance.CONFIRMED)
        note.contains("Estimated (local heuristic)", ignoreCase = true) ->
            DateProvenanceLabel("Estimated date", DateProvenance.ESTIMATED)
        note.contains("No date in the announcement", ignoreCase = true) ->
            DateProvenanceLabel("Date not confirmed", DateProvenance.UNCONFIRMED)
        else -> DateProvenanceLabel("Inferred date", DateProvenance.ESTIMATED)
    }
}

/** A read-only status tag - the one badge shape used across the app. */
@Composable
internal fun StatusTag(
    text: String,
    containerColor: Color,
    contentColor: Color,
    modifier: Modifier = Modifier,
    tabular: Boolean = false,
    spokenContent: String? = null,
) {
    // A tag that spells out more than its label (the conflict warning)
    // speaks the longer text instead of the short one.
    val spokenModifier =
        if (spokenContent == null) {
            Modifier
        } else {
            Modifier.semantics { this.contentDescription = spokenContent }
        }
    Text(
        text = text,
        style =
            MaterialTheme.typography.labelMedium.copy(
                fontFeatureSettings = if (tabular) "tnum" else null,
            ),
        color = contentColor,
        modifier =
            modifier
                .clip(MaterialTheme.shapes.small)
                .background(containerColor)
                .padding(horizontal = 8.dp, vertical = 4.dp)
                .then(spokenModifier),
    )
}

/** A tag's label and the two colours it is drawn with. */
internal data class StatusTagStyle(
    val label: String,
    val container: Color,
    val content: Color,
)

/**
 * The one urgency recipe: today is urgent, tomorrow is close, later is
 * ordinary, the past is muted. `null` when the core knows no day distance.
 */
@Composable
internal fun urgencyTagStyle(daysUntil: Int?): StatusTagStyle? {
    val label =
        when (daysUntil) {
            null -> return null
            0 -> "TODAY"
            1 -> "TOMORROW"
            else -> if (daysUntil < 0) "PAST" else "IN $daysUntil DAYS"
        }
    val container =
        when (daysUntil) {
            null -> MaterialTheme.colorScheme.surface
            0 -> MaterialTheme.colorScheme.errorContainer
            1 -> StatusColors.warningBadge.copy(alpha = 0.18f)
            else ->
                if (daysUntil < 0) {
                    MaterialTheme.colorScheme.surfaceVariant
                } else {
                    MaterialTheme.colorScheme.secondaryContainer
                }
        }
    val content =
        when (daysUntil) {
            null -> MaterialTheme.colorScheme.onSurfaceVariant
            0 -> MaterialTheme.colorScheme.onErrorContainer
            1 -> MaterialTheme.colorScheme.onSurface
            else ->
                if (daysUntil < 0) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSecondaryContainer
                }
        }
    return StatusTagStyle(label = label, container = container, content = content)
}

@Composable
fun TimelineAssessmentRow(
    assessment: AssessmentModel,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val palette = CoursePalette.get(assessment.courseId)
    val courseTextColor = CoursePalette.textOnSurface(assessment.courseId, isDark)

    val urgency = urgencyTagStyle(assessment.daysUntil)
    val provenance = assessmentDateProvenance(assessment)

    Card(
        onClick = { onClick() },
        modifier =
            modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 56.dp)
                // The row has always been a button to TalkBack.
                .semantics { role = Role.Button },
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier =
                            Modifier
                                .size(8.dp)
                                .clip(MaterialTheme.shapes.small)
                                .background(palette.color),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = assessment.courseName ?: assessment.courseId ?: "General",
                        style = MaterialTheme.typography.labelMedium,
                        color = courseTextColor,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = assessment.assessmentType,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (urgency != null) {
                    StatusTag(
                        text = urgency.label,
                        containerColor = urgency.container,
                        contentColor = urgency.content,
                        tabular = true,
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = assessment.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(4.dp))
            // Date / Time / Room ("—" when null — Honesty Doctrine)
            val dateText = formatIsoDateForDisplay(assessment.dateIso?.toString()) ?: "Undated"
            val timeText = extractTimePart(assessment.displayTime)
            val roomDisplay = assessment.room ?: "—"
            Text(
                text =
                    buildString {
                        append(dateText)
                        if (timeText != null) {
                            append(" • ")
                            append(timeText)
                        }
                        append(" • Room: ")
                        append(roomDisplay)
                    },
                style =
                    MaterialTheme.typography.bodySmall.copy(
                        fontFeatureSettings = "tnum",
                    ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusTag(
                    text = assessment.source,
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                // The date's provenance travels with the date: an estimated date
                // must never look as settled as an explicit one.
                if (provenance != null) {
                    val (provContainer, provContent) =
                        when (provenance.provenance) {
                            DateProvenance.CONFIRMED ->
                                StatusColors.successContainer(isDark) to
                                    StatusColors.onSuccessContainer(isDark)
                            DateProvenance.ESTIMATED ->
                                StatusColors.warningBadge.copy(alpha = 0.18f) to
                                    MaterialTheme.colorScheme.onSurface
                            DateProvenance.UNCONFIRMED ->
                                MaterialTheme.colorScheme.errorContainer to
                                    MaterialTheme.colorScheme.onErrorContainer
                        }
                    StatusTag(
                        text = provenance.label,
                        containerColor = provContainer,
                        contentColor = provContent,
                    )
                }

                if (assessment.achievedScore != null && assessment.maxScore != null) {
                    val scorePct = ((assessment.achievedScore / assessment.maxScore) * 100).toInt()
                    val (scoreContainer, scoreContent) =
                        when {
                            scorePct >= 80 ->
                                StatusColors.successContainer(isDark) to
                                    StatusColors.onSuccessContainer(isDark)
                            scorePct >= 50 ->
                                StatusColors.warningBadge.copy(alpha = 0.18f) to
                                    MaterialTheme.colorScheme.onSurface
                            else ->
                                MaterialTheme.colorScheme.errorContainer to
                                    MaterialTheme.colorScheme.onErrorContainer
                        }

                    StatusTag(
                        text = "${assessment.achievedScore}/${assessment.maxScore} ($scorePct%)",
                        containerColor = scoreContainer,
                        contentColor = scoreContent,
                        tabular = true,
                    )
                }

                if (assessment.conflictWarning != null) {
                    // Amber conflict chip (`01` §4.3 timeline rows) - the core
                    // computed this clash, the row only shows it.
                    StatusTag(
                        text = CONFLICT_CHIP_LABEL,
                        containerColor = StatusColors.warningBadge.copy(alpha = 0.18f),
                        contentColor = MaterialTheme.colorScheme.onSurface,
                        spokenContent = assessment.conflictWarning ?: CONFLICT_CHIP_LABEL,
                    )
                }

                assessment.warnings.take(2).forEach { warning ->
                    StatusTag(
                        text = warning,
                        containerColor = StatusColors.warningBadge.copy(alpha = 0.18f),
                        contentColor = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}
