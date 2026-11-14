package com.quizradar.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.ConflictAlertModel
import com.quizradar.app.model.ConflictSeverity
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.tonalPill

@Composable
fun ConflictBanner(
    alerts: List<ConflictAlertModel>,
    customEvents: List<CustomEventModel>,
    isDismissed: Boolean,
    onScheduleStudyBlocks: (assessmentId: String) -> Unit,
    onViewCalendar: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (alerts.isEmpty() || isDismissed) return

    val haptic = LocalHapticFeedback.current
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    var expanded by rememberSaveable { mutableStateOf(false) }
    val studyBlocks =
        customEvents.filter {
            it.id.startsWith("study-block-") || it.id.startsWith("study_block_")
        }
    // The core decides per conflict pair whether a study block already covers
    // it (`is_mitigated`).
    val mitigatedAlerts = alerts.filter { it.isMitigated }
    val unresolvedAlerts = alerts.filter { !it.isMitigated }

    if (unresolvedAlerts.isEmpty()) {
        // Mitigated: compact green confirmation row.
        val container = StatusColors.successContainer(isDark)
        val border = StatusColors.success(isDark)
        val textPrimary = StatusColors.onSuccessContainer(isDark)
        val textSecondary = StatusColors.success(isDark)
        val blockLabel = if (studyBlocks.size == 1) "block" else "blocks"
        val clusterLabel = if (alerts.size == 1) "cluster" else "clusters"

        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(container)
                    .border(1.dp, border, MaterialTheme.shapes.medium)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Icon(
                        imageVector = Icons.Outlined.Shield,
                        contentDescription = "Shield",
                        tint = textSecondary,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Study Time Balanced (${studyBlocks.size} $blockLabel)",
                        style = MaterialTheme.typography.titleMedium,
                        color = textPrimary,
                    )
                }
                IconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onDismiss()
                    },
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = "Dismiss",
                        tint = textSecondary,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            Text(
                text = "Study sessions cover ${alerts.size} detected exam $clusterLabel.",
                style = MaterialTheme.typography.bodySmall,
                color = textSecondary,
            )

            Spacer(modifier = Modifier.height(10.dp))
            FilledTonalButton(
                onClick = onViewCalendar,
                colors = ButtonDefaults.tonalPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Icon(
                    imageVector = Icons.Outlined.CalendarMonth,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "View on Calendar",
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    } else {
        // Unresolved: compact header + summary by default so priority study items
        // stay above the fold; expandable inline to inspect every clash.
        val container = MaterialTheme.colorScheme.errorContainer
        val border = MaterialTheme.colorScheme.error
        val textPrimary = MaterialTheme.colorScheme.onErrorContainer
        val textSecondary = MaterialTheme.colorScheme.onErrorContainer
        val conflictNoun = if (unresolvedAlerts.size == 1) "Conflict" else "Conflicts"

        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(container)
                    .border(1.dp, border.copy(alpha = 0.65f), RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().height(26.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Warning,
                        contentDescription = "Warning",
                        tint = border,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = "${unresolvedAlerts.size} Exam $conflictNoun",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    ConflictSeverityTag(alert = unresolvedAlerts.first())
                    Box(
                        modifier =
                            Modifier
                                .size(26.dp)
                                .offset(x = 4.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        IconButton(
                            onClick = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onDismiss()
                            },
                            modifier = Modifier.requiredSize(48.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Close,
                                contentDescription = "Dismiss",
                                tint = textSecondary.copy(alpha = 0.85f),
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            if (!expanded) {
                val leadAlert = unresolvedAlerts.first()
                Text(
                    text = leadAlert.message,
                    style = MaterialTheme.typography.bodySmall,
                    lineHeight = 17.sp,
                    color = textSecondary.copy(alpha = 0.92f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp, bottom = 2.dp),
                )
                if (unresolvedAlerts.size > 1) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "+ ${unresolvedAlerts.size - 1} more conflict${if (unresolvedAlerts.size - 1 == 1) "" else "s"}",
                        style = MaterialTheme.typography.labelMedium,
                        color = textSecondary,
                    )
                }
            }

            AnimatedVisibility(visible = expanded) {
                Column(modifier = Modifier.padding(top = 4.dp)) {
                    if (mitigatedAlerts.isNotEmpty()) {
                        Text(
                            text =
                                "${mitigatedAlerts.size} other conflict${if (mitigatedAlerts.size > 1) "s" else ""} " +
                                    "${if (mitigatedAlerts.size > 1) "already have" else "already has"} study blocks booked.",
                            style = MaterialTheme.typography.bodySmall,
                            color = textSecondary,
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                    }
                    unresolvedAlerts.forEach { alert ->
                        Row(
                            modifier = Modifier.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            ConflictSeverityTag(alert = alert)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = alert.message,
                                style = MaterialTheme.typography.bodySmall,
                                color = textSecondary,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                val firstAlert = unresolvedAlerts.firstOrNull()
                if (firstAlert != null) {
                    FilledTonalButton(
                        onClick = { onScheduleStudyBlocks(firstAlert.assessmentIdA) },
                        shape = RoundedCornerShape(10.dp),
                        colors =
                            ButtonDefaults.filledTonalButtonColors(
                                containerColor = border.copy(alpha = 0.24f),
                                contentColor = textPrimary,
                            ),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                        modifier =
                            Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 38.dp),
                    ) {
                        Text(
                            text = "Schedule Study Blocks",
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                OutlinedButton(
                    onClick = { expanded = !expanded },
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, border.copy(alpha = 0.45f)),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = textPrimary),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = 38.dp),
                ) {
                    Text(
                        text = if (expanded) "Hide Details" else "Review Conflicts",
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun ConflictSeverityTag(alert: ConflictAlertModel) {
    val isCrit = alert.severity == ConflictSeverity.CRITICAL
    StatusTag(
        text = alert.severity.name,
        containerColor =
            if (isCrit) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.error.copy(alpha = 0.24f)
            },
        contentColor =
            if (isCrit) {
                MaterialTheme.colorScheme.onError
            } else {
                MaterialTheme.colorScheme.onErrorContainer
            },
    )
}
