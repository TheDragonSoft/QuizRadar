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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.ConflictAlertModel
import com.quizradar.app.model.ConflictSeverity
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.ui.icons.Icons

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
        // Mitigated State: Emerald Shield
        val bg = if (isDark) Color(0xFF10B981).copy(alpha = 0.14f) else Color(0xFFECFDF5)
        val border = if (isDark) Color(0xFF10B981).copy(alpha = 0.45f) else Color(0xFF6EE7B7)
        val textPrimary = if (isDark) Color(0xFFA7F3D0) else Color(0xFF065F46)
        val textSecondary = if (isDark) Color(0xFF6EE7B7) else Color(0xFF047857)
        val iconTint = if (isDark) Color(0xFF34D399) else Color(0xFF059669)

        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(bg)
                    .border(1.dp, border, RoundedCornerShape(16.dp))
                    .padding(14.dp),
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
                        tint = iconTint,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Exam Overload Mitigated (${studyBlocks.size} blocks scheduled)",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = textPrimary,
                    )
                }
                IconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onDismiss()
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Dismiss",
                        tint = textSecondary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Smart study sessions are booked around your ${alerts.size} detected exam clusters.",
                style = MaterialTheme.typography.bodySmall,
                color = textSecondary,
            )

            Spacer(modifier = Modifier.height(10.dp))
            Button(
                onClick = onViewCalendar,
                colors =
                    ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF047857),
                        contentColor = Color.White,
                    ),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.defaultMinSize(minHeight = 42.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.CalendarMonth,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(text = "View on Calendar", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    } else {
        // Unresolved State: Amber Alert
        val bg = if (isDark) Color(0xFFF59E0B).copy(alpha = 0.14f) else Color(0xFFFFFBEB)
        val border = if (isDark) Color(0xFFF59E0B).copy(alpha = 0.45f) else Color(0xFFFCD34D)
        val textPrimary = if (isDark) Color(0xFFFDE68A) else Color(0xFF78350F)
        val textSecondary = if (isDark) Color(0xFFFCD34D) else Color(0xFF92400E)
        val iconTint = if (isDark) Color(0xFFFBBF24) else Color(0xFFB45309)

        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(bg)
                    .border(1.dp, border, RoundedCornerShape(16.dp))
                    .padding(14.dp),
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
                        tint = iconTint,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Exam Overload & Clash Alert (${unresolvedAlerts.size})",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = textPrimary,
                    )
                }
                IconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onDismiss()
                    },
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Dismiss",
                        tint = textSecondary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))
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
                    modifier = Modifier.padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val isCrit = alert.severity == ConflictSeverity.CRITICAL
                    val severityBg =
                        if (isCrit) {
                            Color(0xFFEF4444).copy(alpha = if (isDark) 0.24f else 0.14f)
                        } else {
                            Color(0xFFF59E0B).copy(alpha = if (isDark) 0.24f else 0.16f)
                        }
                    val severityColor =
                        if (isCrit) {
                            if (isDark) Color(0xFFFCA5A5) else Color(0xFFB91C1C)
                        } else {
                            if (isDark) Color(0xFFFDE68A) else Color(0xFF92400E)
                        }

                    Text(
                        text = alert.severity.name,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = severityColor,
                        modifier =
                            Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(severityBg)
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = alert.message,
                        style = MaterialTheme.typography.bodySmall,
                        color = textSecondary,
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            val firstAlert = unresolvedAlerts.firstOrNull()
            if (firstAlert != null) {
                Button(
                    onClick = { onScheduleStudyBlocks(firstAlert.assessmentIdA) },
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFB45309),
                            contentColor = Color.White,
                        ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.defaultMinSize(minHeight = 42.dp),
                ) {
                    Text(
                        text = "Schedule Smart Study Blocks",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}
