package com.quizradar.app.feedback

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.min

internal sealed interface SampledBitmapState {
    data object Loading : SampledBitmapState

    data class Loaded(
        val bitmap: Bitmap,
        val imageBitmap: ImageBitmap,
    ) : SampledBitmapState

    data object Failed : SampledBitmapState
}

internal val LocalFeedbackImageDecoderDispatcher =
    staticCompositionLocalOf<CoroutineDispatcher> { Dispatchers.IO }

@Composable
internal fun rememberSampledBitmap(
    file: File?,
    maxDimensionPx: Int,
    revision: Int = 0,
): State<SampledBitmapState> {
    val dispatcher = LocalFeedbackImageDecoderDispatcher.current
    val filePath = file?.absolutePath
    return produceState<SampledBitmapState>(
        initialValue = if (filePath == null) SampledBitmapState.Failed else SampledBitmapState.Loading,
        key1 = filePath,
        key2 = revision,
        key3 = maxDimensionPx,
    ) {
        if (file == null) {
            value = SampledBitmapState.Failed
            return@produceState
        }
        val decoded =
            withContext(dispatcher) {
                AppScreenshotCapture.decodeSampledBitmap(file, maxDimensionPx)
            }
        value =
            if (decoded != null) {
                SampledBitmapState.Loaded(decoded, decoded.asImageBitmap())
            } else {
                SampledBitmapState.Failed
            }
    }
}

internal object AppScreenshotCapture {
    private const val MAX_DIMENSION_PX = 1_600
    private const val PIXEL_COPY_TIMEOUT_MS = 1_500L

    /** Captures only QuizRadar's content view, never another app or the system UI. */
    fun capture(
        activity: Activity,
        destination: File,
    ): File {
        val original = captureBitmap(activity)
        return writeScaledPng(original, destination)
    }

    /**
     * Prefers PixelCopy on API 26+ hardware-accelerated windows (accurately capturing Compose layers)
     * with automatic fallback to software view.draw(Canvas), then scales and encodes PNG off the main thread.
     */
    suspend fun captureOffMainThread(
        activity: Activity,
        destination: File,
        ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    ): File {
        val original = captureBitmapAsync(activity)
        return withContext(ioDispatcher) {
            writeScaledPng(original, destination)
        }
    }

    suspend fun captureBitmapAsync(activity: Activity): Bitmap {
        check(!activity.isDestroyed && !activity.isFinishing) { "The app window is no longer active" }
        val view = activity.findViewById<View>(android.R.id.content)
        check(view != null && view.width > 0 && view.height > 0) { "The app window is not laid out yet" }
        val window = activity.window
        if (window != null && view.isAttachedToWindow && window.peekDecorView()?.windowToken != null) {
            val pixelCopyBitmap = tryPixelCopy(window, view)
            if (pixelCopyBitmap != null) return pixelCopyBitmap
        }
        check(!activity.isDestroyed && !activity.isFinishing && view.isAttachedToWindow) {
            "The app window detached before screenshot capture completed"
        }
        return captureBitmap(activity)
    }

    private suspend fun tryPixelCopy(
        window: android.view.Window,
        view: View,
    ): Bitmap? {
        val location = IntArray(2)
        view.getLocationInWindow(location)
        val rect = Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
        if (rect.width() <= 0 || rect.height() <= 0) return null
        val bitmap = Bitmap.createBitmap(rect.width(), rect.height(), Bitmap.Config.ARGB_8888)
        // Ownership guard: never recycle while RenderThread may still write pixels on timeout/cancellation.
        val ownershipClaimed = AtomicBoolean(false)
        val copyResult =
            withTimeoutOrNull(PIXEL_COPY_TIMEOUT_MS) {
                suspendCancellableCoroutine<Int> { continuation ->
                    try {
                        PixelCopy.request(
                            window,
                            rect,
                            bitmap,
                            { result ->
                                if (result == PixelCopy.SUCCESS && continuation.isActive && ownershipClaimed.compareAndSet(false, true)) {
                                    continuation.resume(result)
                                } else {
                                    bitmap.recycle()
                                    if (continuation.isActive) continuation.resume(result)
                                }
                            },
                            Handler(Looper.getMainLooper()),
                        )
                    } catch (_: Exception) {
                        if (ownershipClaimed.compareAndSet(false, true)) {
                            bitmap.recycle()
                        }
                        if (continuation.isActive) continuation.resume(PixelCopy.ERROR_UNKNOWN)
                    }
                }
            }
        return if (copyResult == PixelCopy.SUCCESS && ownershipClaimed.get()) {
            bitmap
        } else {
            // If timed out, the PixelCopy callback will recycle the bitmap once RenderThread finishes.
            null
        }
    }

    fun captureBitmap(activity: Activity): Bitmap {
        val view = activity.findViewById<View>(android.R.id.content)
        check(view != null && view.width > 0 && view.height > 0) { "The app window is not laid out yet" }
        val original = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        original.eraseColor(Color.TRANSPARENT)
        view.draw(Canvas(original))
        return original
    }

    fun writeScaledPng(
        original: Bitmap,
        destination: File,
    ): File {
        checkNotNull(destination.parentFile).mkdirs()
        var output = original
        try {
            val scale = min(1f, MAX_DIMENSION_PX.toFloat() / max(original.width, original.height).toFloat())
            if (scale < 1f) {
                output =
                    Bitmap.createScaledBitmap(
                        original,
                        (original.width * scale).toInt().coerceAtLeast(1),
                        (original.height * scale).toInt().coerceAtLeast(1),
                        true,
                    )
            }
            FileOutputStream(destination).use { stream ->
                check(output.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                    "PNG compression failed"
                }
            }
            check(destination.isFile && destination.length() > 0L) { "No screenshot was written" }
            return destination
        } finally {
            if (output !== original) output.recycle()
            original.recycle()
        }
    }

    /** Subsamples PNG files so thumbnails and preview cards never allocate unneeded full-size bitmaps. */
    fun decodeSampledBitmap(
        file: File,
        maxDimensionPx: Int,
    ): Bitmap? {
        val targetMaxPx = maxDimensionPx.coerceAtLeast(1)
        return try {
            if (!file.isFile) return null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            file.inputStream().use { input ->
                BitmapFactory.decodeStream(input, null, bounds)
            }
            val longestSide = max(bounds.outWidth, bounds.outHeight)
            if (longestSide <= 0) return null
            var sampleSize = 1
            while (longestSide / (sampleSize * 2) >= targetMaxPx) {
                sampleSize *= 2
            }
            val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
            file.inputStream().use { input ->
                BitmapFactory.decodeStream(input, null, options)
            }
        } catch (_: Exception) {
            null
        } catch (_: OutOfMemoryError) {
            null
        }
    }
}
