package com.quizradar.app.ui.share

import java.time.LocalDate

data class SharedEventDraft(
    val title: String,
    val notes: String,
    val courseId: String? = null,
    val dateIso: LocalDate? = null,
    val startTime: String? = null,
    val endTime: String? = null,
)

/**
 * Pure parser for Android ACTION_SEND text/plain intents.
 * Implements Gmail's subject\n\ntext split and pre-fills custom events.
 */
object ShareIngestParser {
    fun parse(
        subject: String?,
        text: String?,
    ): SharedEventDraft {
        val cleanSubject = subject?.trim()?.ifEmpty { null }
        val cleanText = text?.trim()?.ifEmpty { null }

        val (derivedTitle, derivedNotes) =
            when {
                cleanSubject != null -> {
                    Pair(cleanSubject, cleanText ?: "")
                }
                cleanText != null && cleanText.contains("\n\n") -> {
                    val split = cleanText.split("\n\n", limit = 2)
                    Pair(split[0].trim(), split.getOrNull(1)?.trim() ?: "")
                }
                cleanText != null && cleanText.contains("\n") -> {
                    val split = cleanText.split("\n", limit = 2)
                    Pair(split[0].trim(), split.getOrNull(1)?.trim() ?: "")
                }
                cleanText != null -> {
                    val line = cleanText.lines().firstOrNull()?.trim() ?: "Shared Event"
                    val rest = cleanText.removePrefix(line).trim()
                    Pair(line, rest)
                }
                else -> {
                    Pair("Shared Event", "")
                }
            }

        // Clean common email headers like "Subject: "
        val finalTitle =
            derivedTitle
                .removePrefix("Subject:")
                .removePrefix("subject:")
                .trim()
                .ifEmpty { "Shared Event" }

        // Heuristic course code matching (e.g. CS 101, MATH201, BIO-102)
        val courseRegex = Regex("""\b([A-Z]{2,4}\s*[-]?\s*\d{3,4})\b""")
        val courseMatch = courseRegex.find(finalTitle) ?: courseRegex.find(derivedNotes)
        val courseId = courseMatch?.value?.replace(Regex("""\s+"""), " ")

        // Heuristic date matching (YYYY-MM-DD)
        val dateRegex = Regex("""\b(20\d{2}-\d{2}-\d{2})\b""")
        val dateMatch = dateRegex.find(derivedNotes) ?: dateRegex.find(finalTitle)
        val dateIso =
            dateMatch?.value?.let {
                try {
                    LocalDate.parse(it)
                } catch (_: Exception) {
                    null
                }
            }

        return SharedEventDraft(
            title = finalTitle,
            notes = derivedNotes,
            courseId = courseId,
            dateIso = dateIso,
        )
    }
}
