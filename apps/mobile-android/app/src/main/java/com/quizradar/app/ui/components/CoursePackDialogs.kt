package com.quizradar.app.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.core.QrCodeEncoder
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.CoursePackExportModel
import com.quizradar.app.model.CoursePackPayloadModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill

@Composable
fun CoursePackShareDialog(
    export: CoursePackExportModel?,
    isLoading: Boolean,
    errorMessage: String?,
    onCopied: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.Share,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Share Course Pack",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        },
        text = {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 440.dp)
                        .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.secondaryContainer,
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Shield,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text =
                                "Data-only share — your grades, completed checkboxes, private notes, " +
                                    "and tokens are never included.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    }
                }

                when {
                    isLoading -> {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(vertical = 12.dp),
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                strokeWidth = 2.dp,
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = "Building Course Pack...",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }

                    !errorMessage.isNullOrBlank() -> {
                        Text(
                            text = errorMessage,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }

                    export != null -> {
                        Text(
                            text = "${export.pack.course.id} — ${export.pack.course.name}",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text =
                                "${export.pack.slots.size} class slot(s) · " +
                                    "${export.pack.assessments.size} assessment(s) · " +
                                    "${export.links.byteLen} bytes",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )

                        export.qr?.let { qr ->
                            Box(
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Surface(
                                    shape = MaterialTheme.shapes.medium,
                                    color = Color.White,
                                ) {
                                    QrMatrixCanvas(
                                        matrix = qr,
                                        modifier = Modifier.padding(10.dp).size(180.dp),
                                    )
                                }
                            }
                        }

                        if (!export.links.fitsQr) {
                            Text(
                                text = "Pack exceeds QR code byte limit — copy and share the link below instead.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        OutlinedTextField(
                            value = export.links.webUrl,
                            onValueChange = {},
                            readOnly = true,
                            singleLine = true,
                            label = { Text("Classmate Web Link") },
                            colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            FilledTonalButton(
                                onClick = {
                                    val clipboard =
                                        context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                    clipboard?.setPrimaryClip(
                                        ClipData.newPlainText(
                                            "QuizRadar Course Pack",
                                            export.links.webUrl,
                                        ),
                                    )
                                    onCopied("Classmate link copied")
                                },
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text("Copy Link")
                            }
                            Button(
                                onClick = {
                                    val shareIntent =
                                        Intent(Intent.ACTION_SEND).apply {
                                            type = "text/plain"
                                            putExtra(
                                                Intent.EXTRA_SUBJECT,
                                                "${export.pack.course.id} — ${export.pack.course.name}",
                                            )
                                            putExtra(Intent.EXTRA_TEXT, export.links.webUrl)
                                        }
                                    context.startActivity(
                                        Intent.createChooser(shareIntent, "Share Course Pack"),
                                    )
                                },
                                colors = ButtonDefaults.filledPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.weight(1f).defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text("Share")
                            }
                        }

                        Text(
                            text = "App Deep Link: ${export.links.deepLink.take(44)}…",
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        },
    )
}

@Composable
fun CoursePackImportDialog(
    rawInput: String?,
    pack: CoursePackPayloadModel?,
    existingCourses: List<CourseModel>,
    isBusy: Boolean,
    errorMessage: String?,
    onPreviewLink: (String) -> Unit,
    onApplyImport: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var linkDraft by remember(rawInput) { mutableStateOf(rawInput.orEmpty()) }
    val alreadyEnrolled =
        pack != null &&
            existingCourses.any {
                it.id.equals(pack.course.id, ignoreCase = true) ||
                    it.aliases.any { alias -> alias.equals(pack.course.id, ignoreCase = true) }
            }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.Download,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Import Shared Course Pack",
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        },
        text = {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!errorMessage.isNullOrBlank()) {
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }

                when {
                    isBusy -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = "Processing Course Pack...",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }

                    pack == null -> {
                        OutlinedTextField(
                            value = linkDraft,
                            onValueChange = { linkDraft = it },
                            label = { Text("Paste classmate's Course Pack URL or link") },
                            placeholder = { Text("https://.../#course= or quizradar://course?d=") },
                            minLines = 2,
                            colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    else -> {
                        Text(
                            text = "${pack.course.id} — ${pack.course.name}",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        val metaParts =
                            listOfNotNull(
                                pack.course.credits?.let { "$it credits" },
                                pack.semester?.takeIf { it.isNotBlank() },
                            )
                        if (metaParts.isNotEmpty()) {
                            Text(
                                text = metaParts.joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        if (alreadyEnrolled) {
                            Surface(
                                shape = MaterialTheme.shapes.small,
                                color = MaterialTheme.colorScheme.secondaryContainer,
                            ) {
                                Row(
                                    modifier = Modifier.padding(10.dp),
                                    verticalAlignment = Alignment.Top,
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Info,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSecondaryContainer,
                                        modifier = Modifier.size(16.dp),
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text =
                                            "You already have this course — new slots and deadlines merge " +
                                                "additively without touching your recorded grades.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    )
                                }
                            }
                        }

                        HorizontalDivider()

                        Text(
                            text = "Weekly Slots (${pack.slots.size})",
                            style = MaterialTheme.typography.labelLarge,
                        )
                        if (pack.slots.isEmpty()) {
                            Text(
                                text = "No weekly class slots attached.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            pack.slots.forEach { slot ->
                                Text(
                                    text =
                                        "${slot.day} · ${slot.displayTime ?: "${slot.startTime}–${slot.endTime}"} · " +
                                            "${slot.type.ifBlank { "Lecture" }} · ${slot.room?.takeIf { it.isNotBlank() } ?: "—"}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }

                        Text(
                            text = "Shared Deadlines (${pack.assessments.size})",
                            style = MaterialTheme.typography.labelLarge,
                        )
                        if (pack.assessments.isEmpty()) {
                            Text(
                                text = "No graded assessments attached.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            pack.assessments.forEach { item ->
                                val dateStr = item.dateIso?.toString() ?: "Date TBA"
                                val weightStr = item.weightagePercent?.let { " · $it%" }.orEmpty()
                                Text(
                                    text = "${item.title} (${item.assessmentType}) · $dateStr$weightStr",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (pack != null) {
                Button(
                    onClick = { onApplyImport(rawInput ?: linkDraft) },
                    enabled = !isBusy,
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Add Course to My Radar")
                }
            } else {
                Button(
                    onClick = { onPreviewLink(linkDraft) },
                    enabled = !isBusy && linkDraft.isNotBlank(),
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Preview Link")
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@Composable
private fun QrMatrixCanvas(
    matrix: QrCodeEncoder.QrMatrix,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.background(Color.White)) {
        val size = matrix.size
        if (size <= 0) return@Canvas
        val modulePx = drawContext.size.width / size.toFloat()
        for (y in 0 until size) {
            for (x in 0 until size) {
                if (matrix.get(x, y)) {
                    drawRect(
                        color = Color(0xFF111827),
                        topLeft = Offset(x * modulePx, y * modulePx),
                        size = Size(modulePx + 0.5f, modulePx + 0.5f),
                    )
                }
            }
        }
    }
}
