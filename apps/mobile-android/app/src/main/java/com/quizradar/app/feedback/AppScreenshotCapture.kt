package com.quizradar.app.feedback

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
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
        val view = activity.findViewById<View>(android.R.id.content)
        check(view.width > 0 && view.height > 0) { "The app window is not laid out yet" }
        checkNotNull(destination.parentFile).mkdirs()

        val original = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        var output = original
        try {
            original.eraseColor(android.graphics.Color.WHITE)
            view.draw(Canvas(original))
            val scale = min(1f, MAX_DIMENSION_PX.toFloat() / max(view.width, view.height).toFloat())
            if (scale < 1f) {
                output =
                    Bitmap.createScaledBitmap(
                        original,
                        (view.width * scale).toInt().coerceAtLeast(1),
                        (view.height * scale).toInt().coerceAtLeast(1),
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
}
