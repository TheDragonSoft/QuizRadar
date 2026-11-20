package com.quizradar.app.feedback

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.destructivePill
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BetaFeedbackInboxSheet(
    items: List<BetaFeedbackInboxItem>,
    loadErrors: List<String>,
    isExporting: Boolean,
    errorMessage: String?,
    onDismiss: () -> Unit,
    onDeleteItem: (String) -> Unit,
    onClear: () -> Unit,
    onExport: () -> Unit,
    playingItemId: String? = null,
    onToggleVoicePlayback: (BetaFeedbackInboxItem) -> Unit = {},
) {
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var pendingDelete by remember { mutableStateOf<BetaFeedbackInboxItem?>(null) }
    var showClearConfirmation by remember { mutableStateOf(false) }
    var previewScreenshot by remember { mutableStateOf<File?>(null) }
    val issueCountLabel = if (items.size == 1) "1 saved issue" else "${items.size} saved issues"
    val canClearInbox = (items.isNotEmpty() || loadErrors.isNotEmpty()) && !isExporting

    ModalBottomSheet(
        onDismissRequest = { if (!isExporting) onDismiss() },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = Modifier.padding(top = statusBarPadding).testTag("beta-feedback-inbox-sheet"),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            Text("Feedback inbox", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text(
                text = "$issueCountLabel · each screenshot stays with its report",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.primaryContainer) {
                Text(
                    text =
                        "Export creates one ZIP with batch-manifest.json and a numbered directory per issue. " +
                            "Sharing does not delete the inbox or confirm delivery.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.padding(12.dp),
                )
            }
            loadErrors.forEach { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            errorMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp).testTag("beta-feedback-inbox-error"),
                )
            }
            Spacer(modifier = Modifier.height(12.dp))

            if (items.isEmpty()) {
                Text(
                    text = "No saved issues. Shake the phone or create a report, then choose Save to feedback inbox.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(max = 440.dp).testTag("beta-feedback-inbox-list"),
                ) {
                    itemsIndexed(items, key = { _, item -> item.id }) { index, item ->
                        Card(
                            colors = CardDefaults.quietCardColors(),
                            border = CardDefaults.quietCardBorder(),
                            elevation = CardDefaults.quietCardElevation(),
                            modifier = Modifier.fillMaxWidth().testTag("inbox-issue-${item.id}"),
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.Top) {
                                    val screenshot = item.screenshot
                                    val thumbnail =
                                        remember(screenshot?.absolutePath, screenshot?.lastModified()) {
                                            screenshot?.takeIf { it.isFile }?.let { AppScreenshotCapture.decodeSampledBitmap(it, 320) }
                                        }
                                    if (screenshot?.isFile == true && thumbnail != null) {
                                        Image(
                                            bitmap = thumbnail.asImageBitmap(),
                                            contentDescription = "Screenshot for issue ${index + 1}. Tap to enlarge.",
                                            contentScale = ContentScale.Crop,
                                            modifier =
                                                Modifier
                                                    .size(width = 88.dp, height = 116.dp)
                                                    .clip(MaterialTheme.shapes.small)
                                                    .clickable { previewScreenshot = screenshot }
                                                    .testTag("inbox-screenshot-${item.id}"),
                                        )
                                    } else {
                                        Surface(
                                            shape = MaterialTheme.shapes.small,
                                            color = MaterialTheme.colorScheme.surfaceVariant,
                                            modifier = Modifier.size(width = 88.dp, height = 116.dp),
                                        ) {
                                            Column(
                                                verticalArrangement = Arrangement.Center,
                                                horizontalAlignment = Alignment.CenterHorizontally,
                                            ) {
                                                Text(
                                                    text = if (screenshot?.isFile == true) "Preview\nunavailable" else "No\nscreenshot",
                                                    style = MaterialTheme.typography.labelSmall,
                                                )
                                            }
                                        }
                                    }
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = "Issue ${index + 1} · ${item.screenName}",
                                            style = MaterialTheme.typography.titleSmall,
                                        )
                                        Text(
                                            text = formatInboxTimestamp(item.createdAt),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        Spacer(modifier = Modifier.height(4.dp))
                                        Text(
                                            text =
                                                buildList {
                                                    if (item.screenshot != null) add("screenshot")
                                                    if (item.voiceNote != null) add("voice note")
                                                }.let { attachments ->
                                                    if (attachments.isEmpty()) "No attachments" else attachments.joinToString(" + ")
                                                },
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = item.note.ifBlank { "Voice-only report — no written note." },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface,
                                )
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (item.voiceNote?.isFile == true) {
                                        val isThisPlaying = playingItemId == item.id
                                        TextButton(
                                            onClick = { onToggleVoicePlayback(item) },
                                            enabled = !isExporting,
                                            modifier = Modifier.testTag("inbox-voice-${item.id}"),
                                        ) {
                                            Icon(Icons.Outlined.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text(if (isThisPlaying) "Stop voice note" else "Play voice note")
                                        }
                                    } else {
                                        Spacer(modifier = Modifier.width(1.dp))
                                    }
                                    TextButton(
                                        onClick = { pendingDelete = item },
                                        enabled = !isExporting,
                                        modifier = Modifier.testTag("inbox-delete-${item.id}"),
                                    ) {
                                        Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text("Delete issue", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = onExport,
                enabled = items.isNotEmpty() && !isExporting,
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = PillButtonMinHeight)
                        .testTag("beta-feedback-export-all"),
            ) {
                if (isExporting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = LocalContentColor.current,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Preparing batch ZIP…")
                } else {
                    Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        if (items.size == 1) {
                            "Export 1 issue as ZIP"
                        } else {
                            "Export all ${items.size} issues as ZIP"
                        },
                    )
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = { showClearConfirmation = true },
                enabled = canClearInbox,
                colors = ButtonDefaults.destructivePill(),
                contentPadding = PillButtonContentPadding,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = PillButtonMinHeight)
                        .testTag("beta-feedback-clear-inbox"),
            ) {
                Text("Clear feedback inbox")
            }
            TextButton(onClick = onDismiss, enabled = !isExporting, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Close")
            }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    pendingDelete?.let { item ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Delete this saved issue?") },
            text = { Text("Its screenshot and voice note will also be deleted. Other issues stay in the inbox.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDelete = null
                        onDeleteItem(item.id)
                    },
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Keep issue") } },
        )
    }

    if (showClearConfirmation) {
        val clearDescription =
            when {
                items.isEmpty() -> "Any unreadable feedback entries on this device will be removed. Exported ZIPs are not affected."
                items.size == 1 -> "This saved issue and its attachments will be deleted. Exported ZIPs are not affected."
                else -> "All ${items.size} saved issues and their attachments will be deleted. Exported ZIPs are not affected."
            }
        AlertDialog(
            onDismissRequest = { showClearConfirmation = false },
            title = { Text("Clear the entire feedback inbox?") },
            text = { Text(clearDescription) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showClearConfirmation = false
                        onClear()
                    },
                ) {
                    Text("Clear all", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { showClearConfirmation = false }) { Text("Keep issues") } },
        )
    }

    previewScreenshot?.let { screenshot ->
        val bitmap =
            remember(screenshot.absolutePath, screenshot.lastModified()) {
                AppScreenshotCapture.decodeSampledBitmap(screenshot, 1_280)
            }
        AlertDialog(
            onDismissRequest = { previewScreenshot = null },
            title = { Text("Issue screenshot") },
            text = {
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "Enlarged issue screenshot",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp),
                    )
                } else {
                    Text("The screenshot could not be decoded.")
                }
            },
            confirmButton = { TextButton(onClick = { previewScreenshot = null }) { Text("Close") } },
        )
    }
}

internal fun formatInboxTimestamp(
    instant: Instant,
    zoneId: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
): String = DateTimeFormatter.ofPattern("MMM d, yyyy · HH:mm", locale).withZone(zoneId).format(instant)
