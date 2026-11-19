package com.quizradar.app.feedback

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.destructivePill
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill

@Composable
fun BetaFeedbackHost(controller: BetaFeedbackController) {
    if (!controller.isAvailable) return
    val state by controller.uiState.collectAsState()
    val context = LocalContext.current
    val microphonePermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            // startRecording re-checks the result and publishes an honest denial
            // message when Android did not grant access.
            controller.startRecording()
        }

    BetaFeedbackSheet(
        state = state,
        onDismiss = controller::dismiss,
        onRemoveScreenshot = controller::removeScreenshot,
        onRecordClick = {
            if (state.isRecording) {
                controller.stopRecording()
            } else if (
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            ) {
                controller.startRecording()
            } else {
                microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        },
        onDeleteVoiceNote = controller::deleteVoiceNote,
        onPlaybackClick = controller::startPlayback,
        onShare = controller::shareFeedback,
        onClearError = controller::clearError,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BetaFeedbackSheet(
    state: BetaFeedbackUiState,
    onDismiss: () -> Unit,
    onRemoveScreenshot: () -> Unit,
    onRecordClick: () -> Unit,
    onDeleteVoiceNote: () -> Unit,
    onPlaybackClick: () -> Unit,
    onShare: (String) -> Unit,
    onClearError: () -> Unit,
) {
    val draft = state.draft ?: return
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var note by rememberSaveable(draft.id) { mutableStateOf("") }
    var showDiscardConfirmation by remember { mutableStateOf(false) }
    var showScreenshotPreview by remember { mutableStateOf(false) }
    val hasVoiceNote = draft.voiceNote?.isFile == true
    val canShare = !state.isExporting && !state.isRecording && (note.isNotBlank() || hasVoiceNote)

    ModalBottomSheet(
        onDismissRequest = {
            if (!state.isExporting) showDiscardConfirmation = true
        },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = Modifier.padding(top = statusBarPadding).testTag("beta-feedback-sheet"),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            Text(
                text = "Beta feedback",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "Captured from ${draft.screenName} · tester feedback",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Surface(
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text =
                            "Nothing uploads automatically. Review every attachment before sharing. " +
                                "Tokens, API keys, logcat, and your QuizRadar database are never included.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text("1. Review the screenshot", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            val screenshot = draft.screenshot
            if (screenshot?.isFile == true) {
                val bitmap =
                    remember(screenshot.absolutePath, screenshot.lastModified()) {
                        BitmapFactory.decodeFile(screenshot.absolutePath)
                    }
                Card(
                    colors = CardDefaults.quietCardColors(),
                    border = CardDefaults.quietCardBorder(),
                    elevation = CardDefaults.quietCardElevation(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        if (bitmap != null) {
                            Image(
                                bitmap = bitmap.asImageBitmap(),
                                contentDescription = "Screenshot attached to this feedback. Tap to enlarge.",
                                contentScale = ContentScale.Fit,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .heightIn(max = 320.dp)
                                        .clip(MaterialTheme.shapes.small)
                                        .clickable { showScreenshotPreview = true }
                                        .testTag("beta-feedback-screenshot"),
                            )
                        } else {
                            Text("The screenshot preview could not be decoded. Remove it or discard this report.")
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "Screenshot attached · tap to enlarge",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            TextButton(onClick = onRemoveScreenshot) { Text("Remove") }
                        }
                    }
                }
            } else {
                Text(
                    text = "No screenshot attached. You can still send a written or voice report.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text("2. Describe what happened", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = note,
                onValueChange = {
                    note = it.take(MAX_FEEDBACK_NOTE_LENGTH)
                    onClearError()
                },
                label = { Text("What went wrong?") },
                placeholder = { Text("What did you expect, and what happened instead?") },
                supportingText = {
                    Text("${note.length}/$MAX_FEEDBACK_NOTE_LENGTH · required unless you attach a voice note")
                },
                minLines = 4,
                maxLines = 8,
                colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                modifier = Modifier.fillMaxWidth().testTag("beta-feedback-note"),
            )

            Spacer(modifier = Modifier.height(12.dp))
            Card(
                colors = CardDefaults.quietCardColors(),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("Optional voice note", style = MaterialTheme.typography.titleSmall)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text =
                            "Android asks for microphone access only when you tap Record. " +
                                "The audio stays in private app storage until you share it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    if (state.isRecording) {
                        Button(
                            onClick = onRecordClick,
                            colors = ButtonDefaults.destructivePill(),
                            contentPadding = PillButtonContentPadding,
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .defaultMinSize(minHeight = PillButtonMinHeight)
                                    .testTag("beta-feedback-record"),
                        ) {
                            Text("Stop recording · ${formatRecordingTime(state.recordingSeconds)}")
                        }
                    } else if (hasVoiceNote) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = onPlaybackClick,
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Icon(Icons.Outlined.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(if (state.isPlaying) "Stop playback" else "Play voice note")
                            }
                            TextButton(
                                onClick = onDeleteVoiceNote,
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Delete")
                            }
                        }
                    } else {
                        Button(
                            onClick = onRecordClick,
                            colors = ButtonDefaults.tonalPill(),
                            contentPadding = PillButtonContentPadding,
                            enabled = !state.isExporting,
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .defaultMinSize(minHeight = PillButtonMinHeight)
                                    .testTag("beta-feedback-record"),
                        ) {
                            Text("Record voice note")
                        }
                    }
                }
            }

            state.errorMessage?.let { message ->
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("beta-feedback-error"),
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text("3. Share for review", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text =
                    "The ZIP contains your report, the reviewed attachments, and minimal app/Android diagnostics. " +
                        "Send it to your QuizRadar maintainer for AI-assisted investigation.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = { onShare(note) },
                enabled = canShare,
                colors = ButtonDefaults.filledPill(),
                contentPadding = PillButtonContentPadding,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = PillButtonMinHeight)
                        .testTag("beta-feedback-share"),
            ) {
                if (state.isExporting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Preparing ZIP…")
                } else {
                    Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Reviewed — share ZIP")
                }
            }
            if (state.isRecording) {
                Text(
                    text = "Stop the voice recording before sharing.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Text(
                text = "Opens Android's share sheet. QuizRadar cannot confirm delivery or a fix.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            TextButton(
                onClick = { if (!state.isExporting) showDiscardConfirmation = true },
                enabled = !state.isExporting,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text("Discard feedback", color = MaterialTheme.colorScheme.error)
            }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    if (showDiscardConfirmation) {
        AlertDialog(
            onDismissRequest = { showDiscardConfirmation = false },
            title = { Text("Discard this feedback?") },
            text = { Text("The draft screenshot and voice note will be deleted. Nothing has been uploaded.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDiscardConfirmation = false
                        onDismiss()
                    },
                ) {
                    Text("Discard", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDiscardConfirmation = false }) { Text("Keep editing") }
            },
        )
    }

    val screenshot = draft.screenshot
    if (showScreenshotPreview && screenshot?.isFile == true) {
        val bitmap = remember(screenshot.absolutePath) { BitmapFactory.decodeFile(screenshot.absolutePath) }
        AlertDialog(
            onDismissRequest = { showScreenshotPreview = false },
            title = { Text("Screenshot review") },
            text = {
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "Full screenshot attached to this feedback",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp),
                    )
                } else {
                    Text("The screenshot could not be decoded.")
                }
            },
            confirmButton = {
                TextButton(onClick = { showScreenshotPreview = false }) { Text("Close") }
            },
        )
    }
}

internal fun formatRecordingTime(seconds: Long): String {
    val safeSeconds = seconds.coerceAtLeast(0L)
    return "${safeSeconds / 60}:${(safeSeconds % 60).toString().padStart(2, '0')}"
}
