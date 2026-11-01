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

    val HEX_PRESETS =
        listOf(
            "#1a73e8",
            "#0f9d58",
            "#ea8600",
            "#d93025",
            "#8e24aa",
            "#00acc1",
            "#e67c73",
            "#3949ab",
        )

    private val LIGHT_TEXT_PRESETS =
        listOf(
            Color(0xFF1557B0),
            Color(0xFF0B7A43),
            Color(0xFFB45309),
            Color(0xFFB91C1C),
            Color(0xFF7E22CE),
            Color(0xFF0E7490),
            Color(0xFFC2410C),
            Color(0xFF3730A3),
        )

    private val DARK_TEXT_PRESETS =
        listOf(
            Color(0xFF60A5FA),
            Color(0xFF34D399),
            Color(0xFFFBBF24),
            Color(0xFFF87171),
            Color(0xFFC084FC),
            Color(0xFF22D3EE),
            Color(0xFFFCA5A5),
            Color(0xFF818CF8),
        )

    private fun hashCourseId(id: String): Int {
        var hash = -0x7ee3623b // 0x811c9dc5 as signed int
        for (char in id) {
            hash = hash xor char.code
            hash *= 0x01000193
        }
        // floorMod, not abs(): for the one id whose FNV hash is Int.MIN_VALUE,
        // abs() returns the negative value and the palette index crashes.
        return Math.floorMod(hash, PRESETS.size)
    }

    data class CourseColors(
        val color: Color,
        val background: Color,
        val border: Color,
    )

    fun get(courseId: String?): CourseColors {
        val id = courseId?.trim()?.ifEmpty { null } ?: "GENERAL"
        val index = hashCourseId(id).mod(PRESETS.size)
        val primary = PRESETS[index]
        return CourseColors(
            color = primary,
            background = primary.copy(alpha = 0.12f),
            border = primary.copy(alpha = 0.35f),
        )
    }

    fun textOnSurface(
        courseId: String?,
        darkTheme: Boolean,
    ): Color {
        val id = courseId?.trim()?.ifEmpty { null } ?: "GENERAL"
        val index = hashCourseId(id) % PRESETS.size
        return if (darkTheme) DARK_TEXT_PRESETS[index] else LIGHT_TEXT_PRESETS[index]
    }

    fun getHex(courseId: String?): String {
        val id = courseId?.trim()?.ifEmpty { null } ?: "GENERAL"
        val index = hashCourseId(id) % HEX_PRESETS.size
        return HEX_PRESETS[index]
    }
}
