package com.quizradar.app.ui.components

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.glance.QuizRadarWidgetReceiver
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.StatusColors

@Composable
fun SetupChecklistCard(
    snapshot: AppSnapshotModel,
    viewModel: QuizRadarViewModel,
    hasNotificationPermission: Boolean,
    onAddCourse: () -> Unit,
    onConnectSources: () -> Unit,
    onOpenSettings: () -> Unit = {},
    onRequestNotificationPermission: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val notifyExam24h by viewModel.notifyExam24h.collectAsState()

    val coursesDone = snapshot.schedule.courses.isNotEmpty()
    val sourcesDone = viewModel.isGoogleConnected() || viewModel.isMicrosoftConnected()
    val remindersDone = hasNotificationPermission && notifyExam24h
    val totalDone = listOf(coursesDone, sourcesDone, remindersDone).count { it }

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Setup Checklist",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "$totalDone of 3 recommended steps complete",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // 48dp minimum touch target (Material a11y guideline).
                IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Dismiss checklist",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { totalDone / 3f },
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )

            Spacer(modifier = Modifier.height(14.dp))

            // Item 1: Add Courses
            ChecklistItemRow(
                title = "Add courses & timetable",
                desc = "Enables schedule-based exam resolution",
                icon = Icons.Outlined.School,
                isDone = coursesDone,
                actionLabel = "Add",
                onAction = onAddCourse,
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                modifier = Modifier.padding(vertical = 8.dp),
            )

            // Item 2: Connect Sources. Honest about the OAuth requirement: the
            // scan itself runs ON this device, but sign-in needs the user's
            // own OAuth client id first - without one, no scan can run and
            // this step must say so (and lead to Settings -> Sources) instead
            // of pretending a Connect tap will start one.
            val oauthConfigured = viewModel.oauthClientConfigured
            ChecklistItemRow(
                title = "Connect Gmail or Teams",
                desc =
                    if (sourcesDone) {
                        "Signed in - scans course announcements on this device"
                    } else if (oauthConfigured) {
                        "Sign in and QuizRadar scans course announcements for quizzes on this device"
                    } else {
                        "Add an OAuth client ID in Settings -> Sources, then sign in - " +
                            "scans run on this device once connected"
                    },
                icon = Icons.Outlined.Email,
                isDone = sourcesDone,
                actionLabel = if (oauthConfigured) "Connect" else "Open Settings",
                onAction =
                    if (oauthConfigured) {
                        onConnectSources
                    } else {
                        onOpenSettings
                    },
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                modifier = Modifier.padding(vertical = 8.dp),
            )

            // Item 3: Reminders
            ChecklistItemRow(
                title = "Turn on exam reminders",
                desc = "T-24h and same-day notifications",
                icon = Icons.Outlined.Notifications,
                isDone = remindersDone,
                actionLabel = "Enable",
                onAction = onRequestNotificationPermission,
            )

            // Optional: Widget Pin
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val appWidgetManager = context.getSystemService(AppWidgetManager::class.java)
                if (appWidgetManager != null && appWidgetManager.isRequestPinAppWidgetSupported) {
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Widgets,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Column {
                                Text("Home-Screen Widget", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                Text(
                                    "2x1 countdown glance",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        OutlinedButton(
                            onClick = {
                                val provider = ComponentName(context, QuizRadarWidgetReceiver::class.java)
                                appWidgetManager.requestPinAppWidget(provider, null, null)
                            },
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Text("Pin", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChecklistItemRow(
    title: String,
    desc: String,
    icon: ImageVector,
    isDone: Boolean,
    actionLabel: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // The mint "done" circle needs a theme-aware pair: the light green
    // measured 3.0:1 on the mint chip, and the chip itself was a light-mode
    // circle punched into the dark screen.
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(
                            if (isDone) {
                                StatusColors.successContainer(isDark)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = if (isDone) Icons.Outlined.Check else icon,
                    contentDescription = null,
                    tint =
                        if (isDone) {
                            StatusColors.onSuccessContainer(isDark)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    modifier = Modifier.size(15.dp),
                )
            }
            Spacer(modifier = Modifier.width(10.dp))
            Column {
                Text(
                    text = title,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = if (isDone) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = desc,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        if (isDone) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = "Completed",
                tint = StatusColors.success(isDark),
                modifier = Modifier.size(20.dp),
            )
        } else {
            OutlinedButton(
                onClick = onAction,
                shape = RoundedCornerShape(8.dp),
            ) {
                Text(actionLabel, fontSize = 12.sp)
            }
        }
    }
}
