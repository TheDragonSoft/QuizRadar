package com.quizradar.app.feedback

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.view.View
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min

internal object AppScreenshotCapture {
    private const val MAX_DIMENSION_PX = 1_600

    /** Captures only QuizRadar's content view, never another app or the system UI. */
    fun capture(
        activity: Activity,
        destination: File,
    ): File {
        val original = captureBitmap(activity)
        return writeScaledPng(original, destination)
    }

    fun captureBitmap(activity: Activity): Bitmap {
        val view = activity.findViewById<View>(android.R.id.content)
        check(view.width > 0 && view.height > 0) { "The app window is not laid out yet" }
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
        if (!file.isFile) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val longestSide = max(bounds.outWidth, bounds.outHeight)
        if (longestSide <= 0) return null
        var sampleSize = 1
        while (longestSide / (sampleSize * 2) >= maxDimensionPx) {
            sampleSize *= 2
        }
        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        return BitmapFactory.decodeFile(file.absolutePath, options)
    }
}
