package com.quizradar.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.ByteArrayOutputStream

/**
 * A picked image, decoded and scaled down to something an AI can read
 * without shipping ten megabytes across the network.
 */
data class ScaledImage(
    val bytes: ByteArray,
    val mime: String,
)

/**
 * Reads a picked image, downscaled so its longest edge is at most
 * [maxDimension] pixels, and re-encoded as JPEG.
 *
 * A phone photo is ~4000x3000 and 8 MB. Reading it whole and Base64
 * encoding it (the core takes Base64) costs tens of megabytes of garbage
 * on the UI thread - a dropped-frame stall at best, an ANR at worst. The
 * model only has to read a timetable, so the image is scaled first: 1568px
 * is the largest size the vision models use anyway.
 *
 * MUST be called off the main thread (the caller does it on Dispatchers.IO).
 */
fun readScaledImage(
    context: Context,
    uri: Uri,
    maxDimension: Int = 1568,
): ScaledImage? {
    val resolver = context.contentResolver

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { input ->
        BitmapFactory.decodeStream(input, null, bounds)
    }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    // Sub-sample while decoding so a 12 MP photo never becomes a 48 MB
    // bitmap just to be scaled down afterwards.
    var sample = 1
    while (
        bounds.outWidth / (sample * 2) >= maxDimension ||
        bounds.outHeight / (sample * 2) >= maxDimension
    ) {
        sample *= 2
    }
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded =
        resolver.openInputStream(uri)?.use { input ->
            BitmapFactory.decodeStream(input, null, options)
        } ?: return null

    val longest = maxOf(decoded.width, decoded.height)
    val scaled =
        if (longest > maxDimension) {
            val ratio = maxDimension.toFloat() / longest.toFloat()
            Bitmap.createScaledBitmap(
                decoded,
                (decoded.width * ratio).toInt().coerceAtLeast(1),
                (decoded.height * ratio).toInt().coerceAtLeast(1),
                true,
            )
        } else {
            decoded
        }

    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
    if (scaled !== decoded) scaled.recycle()
    decoded.recycle()
    return ScaledImage(out.toByteArray(), "image/jpeg")
}
