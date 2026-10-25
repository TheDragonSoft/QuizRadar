package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Warning
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.ConflictAlertModel
import com.quizradar.app.model.ConflictSeverity
import com.quizradar.app.model.CustomEventModel

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

    val studyBlocks =
        customEvents.filter {
            it.id.startsWith("study-block-") || it.id.startsWith("study_block_")
        }
    val hasStudyBlocks = studyBlocks.isNotEmpty()

    if (hasStudyBlocks) {
        // Mitigated State: Emerald Shield
        val bg = Color(0xFF10B981).copy(alpha = 0.12f)
        val border = Color(0xFF10B981).copy(alpha = 0.4f)
        val textPrimary = Color(0xFF065F46)
        val textSecondary = Color(0xFF047857)

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
                        tint = Color(0xFF10B981),
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Exam Overload Mitigated (${studyBlocks.size} blocks scheduled)",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = textPrimary,
                    )
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
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
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF059669)),
                shape = RoundedCornerShape(8.dp),
                contentPadding = ButtonDefaults.ContentPadding,
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
        val bg = Color(0xFFF59E0B).copy(alpha = 0.12f)
        val border = Color(0xFFF59E0B).copy(alpha = 0.4f)
        val textPrimary = Color(0xFF92400E)
        val textSecondary = Color(0xFFB45309)

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
                        tint = Color(0xFFD97706),
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Exam Overload & Clash Alert (${alerts.size})",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = textPrimary,
                    )
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Dismiss",
                        tint = textSecondary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))
            alerts.forEach { alert ->
                Row(
                    modifier = Modifier.padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val severityBg =
                        if (alert.severity == ConflictSeverity.CRITICAL) {
                            Color(0xFFEF4444).copy(alpha = 0.2f)
                        } else {
                            Color(0xFFF59E0B).copy(alpha = 0.2f)
                        }
                    val severityColor =
                        if (alert.severity == ConflictSeverity.CRITICAL) {
                            Color(0xFFDC2626)
                        } else {
                            Color(0xFFD97706)
                        }

                    Text(
                        text = alert.severity.name,
                        fontSize = 10.sp,
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
            val firstAlert = alerts.firstOrNull()
            if (firstAlert != null) {
                Button(
                    onClick = { onScheduleStudyBlocks(firstAlert.assessmentIdA) },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                    shape = RoundedCornerShape(8.dp),
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
