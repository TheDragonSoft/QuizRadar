package com.quizradar.app.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.util.Locale

private const val MAX_SYLLABUS_DOCS = 6
private const val MAX_SYLLABUS_PDF_BYTES = 10 * 1024 * 1024

object SyllabusDocumentReader {
    data class Result(
        val documents: List<Triple<String, ByteArray, String>>,
        val errors: List<String>,
    )

    fun readFromUris(
        context: Context,
        uris: List<Uri>,
    ): Result {
        if (uris.isEmpty()) {
            return Result(emptyList(), emptyList())
        }
        if (uris.size > MAX_SYLLABUS_DOCS) {
            return Result(
                emptyList(),
                listOf("Select up to $MAX_SYLLABUS_DOCS syllabus files at once (got ${uris.size})."),
            )
        }

        val docs = ArrayList<Triple<String, ByteArray, String>>(uris.size)
        val errors = ArrayList<String>()
        val resolver = context.contentResolver

        for ((index, uri) in uris.withIndex()) {
            val displayName = queryDisplayName(context, uri) ?: "Syllabus ${index + 1}"
            val rawMime = resolver.getType(uri)?.lowercase(Locale.US).orEmpty()
            val isPdf =
                rawMime == "application/pdf" ||
                    displayName.lowercase(Locale.US).endsWith(".pdf")

            try {
                if (isPdf) {
                    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
                    when {
                        bytes == null || bytes.isEmpty() ->
                            errors.add("$displayName: PDF file was empty.")
                        bytes.size > MAX_SYLLABUS_PDF_BYTES ->
                            errors.add("$displayName: exceeds the 10 MB per-file limit.")
                        else ->
                            docs.add(Triple(displayName, bytes, "application/pdf"))
                    }
                } else {
                    val scaled = readScaledImage(context, uri)
                    if (scaled == null || scaled.bytes.isEmpty()) {
                        errors.add("$displayName: could not decode image.")
                    } else {
                        docs.add(Triple(displayName, scaled.bytes, scaled.mime))
                    }
                }
            } catch (e: Exception) {
                errors.add("$displayName: ${e.message ?: "could not be read"}")
            }
        }

        return Result(documents = docs, errors = errors)
    }

    private fun queryDisplayName(
        context: Context,
        uri: Uri,
    ): String? {
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    val col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (col >= 0 && cursor.moveToFirst()) {
                        cursor.getString(col)?.takeIf { it.isNotBlank() }
                    } else {
                        null
                    }
                }
        } catch (_: Exception) {
            null
        }
    }
}
