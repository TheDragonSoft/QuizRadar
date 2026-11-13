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
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp
import com.quizradar.app.glance.QuizRadarWidgetReceiver
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.ui.QuizRadarViewModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.tonalPill

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
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
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
                        color = MaterialTheme.colorScheme.onSurface,
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
                        imageVector = Icons.Outlined.Close,
                        contentDescription = "Dismiss checklist",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { totalDone / 3f },
                modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Item 1: Add Courses
            ChecklistItemRow(
                title = "Add courses & timetable",
                desc = "Enables schedule-based exam resolution",
                icon = Icons.Outlined.School,
                isDone = coursesDone,
                actionLabel = "Add course",
                onAction = onAddCourse,
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                modifier = Modifier.padding(vertical = 8.dp),
            )

            // Item 2: Connect Sources. Google sign-in ships with a usable
            // client id, so the step always offers Connect; Microsoft needs
            // the user's Azure app id and says so on its own sign-in button.
            ChecklistItemRow(
                title = "Connect Gmail or Teams",
                desc =
                    if (sourcesDone) {
                        "Signed in — scans course announcements on this device"
                    } else {
                        "Add your OAuth client ID in Settings → Sources"
                    },
                icon = Icons.Outlined.Email,
                isDone = sourcesDone,
                actionLabel = "Connect source",
                onAction = onConnectSources,
            )

            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                modifier = Modifier.padding(vertical = 8.dp),
            )

            // Item 3: Reminders
            ChecklistItemRow(
                title = "Turn on exam reminders",
                desc = "T-24h and same-day notifications",
                icon = Icons.Outlined.Notifications,
                isDone = remindersDone,
                actionLabel = "Enable reminders",
                onAction = onRequestNotificationPermission,
            )

            // Optional: Widget Pin
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val appWidgetManager = context.getSystemService(AppWidgetManager::class.java)
                if (appWidgetManager != null && appWidgetManager.isRequestPinAppWidgetSupported) {
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                    ChecklistItemRow(
                        title = "Home-Screen Widget",
                        desc = "2x1 countdown glance",
                        icon = Icons.Outlined.Widgets,
                        isDone = false,
                        actionLabel = "Pin widget",
                        onAction = {
                            val provider = ComponentName(context, QuizRadarWidgetReceiver::class.java)
                            appWidgetManager.requestPinAppWidget(provider, null, null)
                        },
                    )
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
            modifier = Modifier.weight(1f).padding(end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(24.dp)
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
                    modifier = Modifier.size(16.dp),
                )
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    color =
                        if (isDone) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
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
            FilledTonalButton(
                onClick = onAction,
                colors = ButtonDefaults.tonalPill(),
                contentPadding = PillButtonContentPadding,
                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
            ) {
                Text(
                    text = actionLabel,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}
