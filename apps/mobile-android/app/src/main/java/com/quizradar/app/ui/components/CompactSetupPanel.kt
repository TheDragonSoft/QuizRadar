package com.quizradar.app.ui.components

import androidx.compose.foundation.background
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.tonalPill

/**
 * One line of the compact setup checklist: the step, what its status is, and
 * (when the step can be fixed from here) the action that fixes it.
 *
 * The copy is written by the caller so the panel stays free of developer
 * jargon: the happy path names the thing to do, never an OAuth client id.
 */
data class CompactSetupStep(
    val icon: ImageVector,
    val label: String,
    val status: String,
    val done: Boolean,
    val actionLabel: String? = null,
    val onAction: (() -> Unit)? = null,
)

/**
 * The dashboard's setup panel: ONE line per setup step, ONE primary button
 * for the step that is actually blocking, and a dismiss button.
 *
 * It replaces the old hero + checklist + four-KPI empty stack (audit P3-1):
 * the panel says what is missing and offers the one action that unblocks it,
 * instead of four big cards that all said "there is no data yet".
 *
 * When another card on the screen already owns the flow's filled action
 * (e.g. the empty-timeline state card), pass [primaryTonal] so the panel's
 * button recedes to tonal - one filled pill per flow, never two competing.
 */
@Composable
fun CompactSetupPanel(
    steps: List<CompactSetupStep>,
    primaryActionLabel: String,
    onPrimaryAction: () -> Unit,
    onDismiss: () -> Unit,
    dismissed: Boolean = false,
    primaryTonal: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val doneCount = steps.count { it.done }

    Card(
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            if (dismissed) {
                Text(
                    text = "Setup dismissed",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Nothing is lost — the next step is still one tap away.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Setup Checklist",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "$doneCount of ${steps.size} steps done",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Close,
                            contentDescription = "Dismiss setup checklist",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                steps.forEach { step ->
                    CompactSetupStepRow(step = step, isDark = isDark)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            if (primaryTonal) {
                FilledTonalButton(
                    onClick = onPrimaryAction,
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = primaryActionLabel,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            } else {
                Button(
                    onClick = onPrimaryAction,
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = primaryActionLabel,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun CompactSetupStepRow(
    step: CompactSetupStep,
    isDark: Boolean,
) {
    val action = step.onAction
    val actionLabel = step.actionLabel

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 48.dp)
                .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(
                        if (step.done) {
                            StatusColors.successContainer(isDark)
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        },
                    ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (step.done) Icons.Outlined.Check else step.icon,
                contentDescription = null,
                tint =
                    if (step.done) {
                        StatusColors.onSuccessContainer(isDark)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                modifier = Modifier.size(16.dp),
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = step.label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = step.status,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (action != null && actionLabel != null) {
            TextButton(
                onClick = action,
                modifier = Modifier.defaultMinSize(minHeight = 48.dp),
            ) {
                Text(
                    text = actionLabel,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}
