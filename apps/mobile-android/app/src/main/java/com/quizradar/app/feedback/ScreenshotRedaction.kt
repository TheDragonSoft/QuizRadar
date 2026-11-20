package com.quizradar.app.feedback

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlin.math.min

data class NormalizedPoint(
    val x: Float,
    val y: Float,
)

data class RedactionStroke(
    val points: List<NormalizedPoint>,
    val brushWidthFraction: Float = ScreenshotRedactor.DEFAULT_BRUSH_WIDTH_FRACTION,
)

internal object ScreenshotRedactor {
    const val DEFAULT_BRUSH_WIDTH_FRACTION = 0.065f

    /** Permanently burns opaque black redaction strokes into the PNG file on disk. */
    fun applyRedactions(
        sourceFile: File,
        strokes: List<RedactionStroke>,
    ): File {
        require(sourceFile.isFile) { "Screenshot file does not exist" }
        if (strokes.isEmpty()) return sourceFile

        val decodeOptions = BitmapFactory.Options().apply { inMutable = true }
        val decoded =
            checkNotNull(
                sourceFile.inputStream().use { input ->
                    BitmapFactory.decodeStream(input, null, decodeOptions)
                },
            ) {
                "Could not decode screenshot for redaction"
            }
        val bitmap =
            if (decoded.isMutable && decoded.config == Bitmap.Config.ARGB_8888) {
                decoded
            } else {
                val copied = decoded.copy(Bitmap.Config.ARGB_8888, true)
                decoded.recycle()
                checkNotNull(copied) { "Could not allocate mutable bitmap for redaction" }
            }

        val tempFile = File(sourceFile.parentFile, "${sourceFile.name}.redacting")
        try {
            drawStrokes(bitmap, strokes)
            FileOutputStream(tempFile).use { stream ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                    "Redacted PNG compression failed"
                }
            }
            check(tempFile.isFile && tempFile.length() > 0L) { "Redacted screenshot was not written" }
            try {
                Files.move(tempFile.toPath(), sourceFile.toPath(), StandardCopyOption.REPLACE_EXISTING)
            } catch (_: Exception) {
                tempFile.inputStream().use { input ->
                    FileOutputStream(sourceFile, false).use { output ->
                        input.copyTo(output)
                    }
                }
                tempFile.delete()
            }
            return sourceFile
        } catch (error: Throwable) {
            tempFile.delete()
            throw error
        } finally {
            bitmap.recycle()
        }
    }

    internal fun drawStrokes(
        bitmap: Bitmap,
        strokes: List<RedactionStroke>,
    ) {
        val canvas = Canvas(bitmap)
        val width = bitmap.width.toFloat()
        val height = bitmap.height.toFloat()
        val minDim = min(width, height).coerceAtLeast(1f)
        val strokePaint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.BLACK
                style = Paint.Style.STROKE
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
            }
        val dotPaint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.BLACK
                style = Paint.Style.FILL
            }

        strokes.forEach { stroke ->
            if (stroke.points.isEmpty()) return@forEach
            val brushPx = (stroke.brushWidthFraction.coerceIn(0.01f, 0.25f) * minDim).coerceAtLeast(4f)
            if (stroke.points.size == 1) {
                val p = stroke.points.first()
                canvas.drawCircle(
                    p.x.coerceIn(0f, 1f) * width,
                    p.y.coerceIn(0f, 1f) * height,
                    brushPx / 2f,
                    dotPaint,
                )
            } else {
                strokePaint.strokeWidth = brushPx
                val path = Path()
                val first = stroke.points.first()
                path.moveTo(first.x.coerceIn(0f, 1f) * width, first.y.coerceIn(0f, 1f) * height)
                stroke.points.drop(1).forEach { pt ->
                    path.lineTo(pt.x.coerceIn(0f, 1f) * width, pt.y.coerceIn(0f, 1f) * height)
                }
                canvas.drawPath(path, strokePaint)
            }
        }
    }
}

@Composable
internal fun ScreenshotRedactionDialog(
    imageBitmap: ImageBitmap?,
    isApplying: Boolean,
    errorMessage: String? = null,
    onApply: (List<RedactionStroke>) -> Unit,
    onDismiss: () -> Unit,
) {
    val completedStrokes = remember { mutableStateListOf<RedactionStroke>() }
    var activePoints by remember { mutableStateOf<List<NormalizedPoint>>(emptyList()) }

    AlertDialog(
        onDismissRequest = { if (!isApplying) onDismiss() },
        title = { Text("Redact private info") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text =
                        "Drag over names, emails, or anything private. " +
                            "Redactions are burned permanently into the screenshot before sharing.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                errorMessage?.let { message ->
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("beta-feedback-redact-error"),
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                if (imageBitmap != null && imageBitmap.width > 0 && imageBitmap.height > 0) {
                    val ratio = imageBitmap.width.toFloat() / imageBitmap.height.toFloat()
                    // Do not apply fillMaxWidth() before aspectRatio: portrait screenshots must shrink
                    // horizontally to keep an exact 1:1 coordinate and brush-width mapping with the PNG.
                    Box(
                        modifier =
                            Modifier
                                .weight(1f, fill = false)
                                .heightIn(max = 440.dp)
                                .aspectRatio(ratio, matchHeightConstraintsFirst = ratio < 1f)
                                .clip(MaterialTheme.shapes.extraSmall)
                                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.extraSmall)
                                .pointerInput(isApplying) {
                                    if (isApplying) return@pointerInput
                                    awaitEachGesture {
                                        val down = awaitFirstDown(requireUnconsumed = false)
                                        if (size.width <= 0 || size.height <= 0) return@awaitEachGesture

                                        fun toNormalized(pos: Offset): NormalizedPoint =
                                            NormalizedPoint(
                                                x = (pos.x / size.width.toFloat()).coerceIn(0f, 1f),
                                                y = (pos.y / size.height.toFloat()).coerceIn(0f, 1f),
                                            )

                                        val current = mutableListOf(toNormalized(down.position))
                                        activePoints = current.toList()
                                        down.consume()
                                        try {
                                            while (true) {
                                                val event = awaitPointerEvent()
                                                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                                if (!change.pressed) {
                                                    change.consume()
                                                    break
                                                }
                                                current += toNormalized(change.position)
                                                activePoints = current.toList()
                                                change.consume()
                                            }
                                            if (current.isNotEmpty()) {
                                                completedStrokes += RedactionStroke(current.toList())
                                            }
                                        } finally {
                                            activePoints = emptyList()
                                        }
                                    }
                                }
                                .testTag("beta-feedback-redact-canvas"),
                    ) {
                        Image(
                            bitmap = imageBitmap,
                            contentDescription = "Screenshot redaction canvas. Drag to black out private areas.",
                            contentScale = ContentScale.FillBounds,
                            modifier = Modifier.fillMaxSize(),
                        )
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val minDim = min(size.width, size.height).coerceAtLeast(1f)
                            val allStrokes =
                                if (activePoints.isNotEmpty()) {
                                    completedStrokes + RedactionStroke(activePoints)
                                } else {
                                    completedStrokes.toList()
                                }
                            allStrokes.forEach { stroke ->
                                if (stroke.points.isEmpty()) return@forEach
                                val strokePx = stroke.brushWidthFraction * minDim
                                if (stroke.points.size == 1) {
                                    val p = stroke.points.first()
                                    drawCircle(
                                        color = androidx.compose.ui.graphics.Color.Black,
                                        radius = strokePx / 2f,
                                        center = Offset(p.x * size.width, p.y * size.height),
                                    )
                                } else {
                                    val path =
                                        androidx.compose.ui.graphics.Path().apply {
                                            val first = stroke.points.first()
                                            moveTo(first.x * size.width, first.y * size.height)
                                            stroke.points.drop(1).forEach { pt ->
                                                lineTo(pt.x * size.width, pt.y * size.height)
                                            }
                                        }
                                    drawPath(
                                        path = path,
                                        color = androidx.compose.ui.graphics.Color.Black,
                                        style =
                                            Stroke(
                                                width = strokePx,
                                                cap = StrokeCap.Round,
                                                join = StrokeJoin.Round,
                                            ),
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(
                            onClick = { if (completedStrokes.isNotEmpty()) completedStrokes.removeAt(completedStrokes.lastIndex) },
                            enabled = completedStrokes.isNotEmpty() && !isApplying,
                            modifier = Modifier.testTag("beta-feedback-redact-undo"),
                        ) {
                            Text("Undo")
                        }
                        TextButton(
                            onClick = { completedStrokes.clear() },
                            enabled = completedStrokes.isNotEmpty() && !isApplying,
                            modifier = Modifier.testTag("beta-feedback-redact-clear"),
                        ) {
                            Text("Clear marks")
                        }
                    }
                } else {
                    Text("The screenshot could not be decoded.")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onApply(completedStrokes.toList()) },
                enabled = completedStrokes.isNotEmpty() && !isApplying,
                modifier = Modifier.testTag("beta-feedback-redact-apply"),
            ) {
                if (isApplying) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Applying…")
                } else {
                    Text("Apply redaction")
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = !isApplying,
            ) {
                Text("Cancel")
            }
        },
    )
}
