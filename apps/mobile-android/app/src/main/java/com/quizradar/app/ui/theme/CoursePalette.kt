package com.quizradar.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Per-course palette derivation (docs/rebuild/01-product-spec.md §6).
 *
 * Exact 8 preset colors matching web tier coursePalette.ts:
 * Blue (#1a73e8), Emerald (#0f9d58), Amber (#ea8600), Red (#d93025),
 * Purple (#8e24aa), Cyan (#00acc1), Coral (#e67c73), Indigo (#3949ab).
 */
object CoursePalette {
    val PRESETS =
        listOf(
            Color(0xFF1A73E8),
            Color(0xFF0F9D58),
            Color(0xFFEA8600),
            Color(0xFFD93025),
            Color(0xFF8E24AA),
            Color(0xFF00ACC1),
            Color(0xFFE67C73),
            Color(0xFF3949AB),
        )

    private fun hashCourseId(id: String): Int {
        var hash = -0x7ee3623b // 0x811c9dc5 as signed int
        for (char in id) {
            hash = hash xor char.code
            hash *= 0x01000193
        }
        return kotlin.math.abs(hash)
    }

    data class CourseColors(
        val color: Color,
        val background: Color,
        val border: Color,
    )

    fun get(courseId: String?): CourseColors {
        val id = courseId?.trim()?.ifEmpty { null } ?: "GENERAL"
        val index = hashCourseId(id) % PRESETS.size
        val primary = PRESETS[index]
        return CourseColors(
            color = primary,
            background = primary.copy(alpha = 0.12f),
            border = primary.copy(alpha = 0.35f),
        )
    }
}
