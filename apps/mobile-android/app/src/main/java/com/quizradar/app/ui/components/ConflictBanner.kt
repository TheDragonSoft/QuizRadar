package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
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
    val studyBlocks =
        customEvents.filter {
            it.id.startsWith("study-block-") || it.id.startsWith("study_block_")
        }
    // The core decides per conflict pair whether a study block already covers
    // it (`is_mitigated`). "Any study block exists" used to flip the whole
    // banner to "Mitigated" - a block for one cluster used to hide an
    // uncovered conflict.
    val mitigatedAlerts = alerts.filter { it.isMitigated }
    val unresolvedAlerts = alerts.filter { !it.isMitigated }

    if (unresolvedAlerts.isEmpty()) {
        // Mitigated: the mint "done" pair from the token layer.
        val container = StatusColors.successContainer(isDark)
        val border = StatusColors.success(isDark)
        val textPrimary = StatusColors.onSuccessContainer(isDark)
        val textSecondary = StatusColors.success(isDark)

        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(container)
                    .border(1.dp, border, MaterialTheme.shapes.medium)
                    .padding(16.dp),
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
                        text = "Exam Overload Mitigated (${studyBlocks.size} blocks scheduled)",
                        style = MaterialTheme.typography.titleMedium,
                        color = textPrimary,
                    )
                }
                IconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onDismiss()
                    },
                    // 48dp minimum touch target (Material a11y guideline).
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

            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Smart study sessions are booked around your ${alerts.size} detected exam clusters.",
                style = MaterialTheme.typography.bodySmall,
                color = textSecondary,
            )

            Spacer(modifier = Modifier.height(12.dp))
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
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    } else {
        // Unresolved: the error pair from the theme (an alert that asks for
        // a decision), with the severity of each cluster as a tag.
        val container = MaterialTheme.colorScheme.errorContainer
        val border = MaterialTheme.colorScheme.error
        val textPrimary = MaterialTheme.colorScheme.onErrorContainer
        val textSecondary = MaterialTheme.colorScheme.onErrorContainer

        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(container)
                    .border(1.dp, border, MaterialTheme.shapes.medium)
                    .padding(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Icon(
                        imageVector = Icons.Outlined.Warning,
                        contentDescription = "Warning",
                        tint = border,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Exam Overload & Clash Alert (${unresolvedAlerts.size})",
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

            Spacer(modifier = Modifier.height(8.dp))
            if (mitigatedAlerts.isNotEmpty()) {
                Text(
                    text =
                        "${mitigatedAlerts.size} other conflict${if (mitigatedAlerts.size > 1) "s" else ""} already " +
                            "${if (mitigatedAlerts.size > 1) "have" else "has"} study blocks booked.",
                    style = MaterialTheme.typography.bodySmall,
                    color = textSecondary,
                )
                Spacer(modifier = Modifier.height(4.dp))
            }
            unresolvedAlerts.forEach { alert ->
                Row(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    val isCrit = alert.severity == ConflictSeverity.CRITICAL
                    StatusTag(
                        text = alert.severity.name,
                        containerColor =
                            if (isCrit) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.surface
                            },
                        contentColor =
                            if (isCrit) {
                                MaterialTheme.colorScheme.onError
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = alert.message,
                        style = MaterialTheme.typography.bodySmall,
                        color = textSecondary,
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            val firstAlert = unresolvedAlerts.firstOrNull()
            if (firstAlert != null) {
                FilledTonalButton(
                    onClick = { onScheduleStudyBlocks(firstAlert.assessmentIdA) },
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = "Schedule Smart Study Blocks",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }
}
