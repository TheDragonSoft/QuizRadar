package com.quizradar.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import java.util.Locale

/**
 * Per-course palette derivation (docs/rebuild/01-product-spec.md §6).
 *
 * Exact 8 preset colors matching web tier coursePalette.ts:
 * Blue (#1a73e8), Emerald (#0f9d58), Amber (#ea8600), Red (#d93025),
 * Purple (#8e24aa), Cyan (#00acc1), Coral (#e67c73), Indigo (#3949ab).
 */
object CoursePalette {
    private const val MIN_TEXT_CONTRAST = 4.5f
    private val LIGHT_REFERENCE_SURFACE = Color(0xFFF1F5F9)
    private val DARK_REFERENCE_SURFACE = Color(0xFF162035)

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

    private data class ParsedHex(
        val color: Color,
        val normalizedHex: String,
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

    private fun parseStoredHex(storedHex: String?): ParsedHex? {
        val trimmed = storedHex?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val normalizedInput =
            if (trimmed.startsWith("#")) {
                val raw = trimmed.substring(1)
                when (raw.length) {
                    3 -> {
                        val expanded = "${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}"
                        if (expanded.toLongOrNull(16) == null) return null
                        "#${expanded.lowercase(Locale.US)}"
                    }
                    6 -> {
                        if (raw.toLongOrNull(16) == null) return null
                        "#${raw.lowercase(Locale.US)}"
                    }
                    8 -> {
                        val parsed = raw.toLongOrNull(16) ?: return null
                        val alpha = (parsed ushr 24) and 0xFFL
                        if (alpha == 0L) return null
                        if (alpha == 0xFFL) {
                            "#${raw.substring(2).lowercase(Locale.US)}"
                        } else {
                            "#${raw.lowercase(Locale.US)}"
                        }
                    }
                    else -> null
                }
            } else {
                null
            }
        if (normalizedInput != null) {
            val rawHex = normalizedInput.substring(1)
            val argb =
                if (rawHex.length == 6) {
                    (0xFF000000L or rawHex.toLong(16)).toInt()
                } else {
                    rawHex.toLong(16).toInt()
                }
            return ParsedHex(color = Color(argb), normalizedHex = normalizedInput)
        }
        return try {
            val parsedInt = android.graphics.Color.parseColor(trimmed)
            if (parsedInt == 0) return null
            val rgbHex = String.format(Locale.US, "#%06x", parsedInt and 0x00FFFFFF)
            ParsedHex(color = Color(parsedInt), normalizedHex = rgbHex)
        } catch (_: Exception) {
            null
        }
    }

    private fun presetIndexForHex(normalizedHex: String): Int = HEX_PRESETS.indexOfFirst { it.equals(normalizedHex, ignoreCase = true) }

    private fun contrastRatio(
        foreground: Color,
        background: Color,
    ): Float {
        val l1 = foreground.luminance()
        val l2 = background.luminance()
        val lighter = maxOf(l1, l2)
        val darker = minOf(l1, l2)
        return (lighter + 0.05f) / (darker + 0.05f)
    }

    private fun blendColors(
        start: Color,
        end: Color,
        fraction: Float,
    ): Color =
        Color(
            red = (start.red + (end.red - start.red) * fraction).coerceIn(0f, 1f),
            green = (start.green + (end.green - start.green) * fraction).coerceIn(0f, 1f),
            blue = (start.blue + (end.blue - start.blue) * fraction).coerceIn(0f, 1f),
            alpha = 1f,
        )

    private fun ensureAccessibleTextColor(
        base: Color,
        darkTheme: Boolean,
    ): Color {
        val opaque = if (base.alpha < 1f) base.copy(alpha = 1f) else base
        val referenceSurface = if (darkTheme) DARK_REFERENCE_SURFACE else LIGHT_REFERENCE_SURFACE
        val target = if (darkTheme) Color.White else Color.Black
        val isAccessible: (Color) -> Boolean = { candidate ->
            contrastRatio(candidate, referenceSurface) >= MIN_TEXT_CONTRAST &&
                if (darkTheme) candidate.luminance() > 0.25f else candidate.luminance() < 0.35f
        }
        if (isAccessible(opaque)) {
            return opaque
        }
        var low = 0f
        var high = 1f
        repeat(12) {
            val mid = (low + high) * 0.5f
            val candidate = blendColors(opaque, target, mid)
            if (isAccessible(candidate)) {
                high = mid
            } else {
                low = mid
            }
        }
        return blendColors(opaque, target, high)
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

    fun get(
        courseId: String?,
        storedHex: String?,
    ): CourseColors {
        val parsed = parseStoredHex(storedHex) ?: return get(courseId)
        val presetIndex = presetIndexForHex(parsed.normalizedHex)
        val primary = if (presetIndex >= 0) PRESETS[presetIndex] else parsed.color
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

    fun textOnSurface(
        courseId: String?,
        darkTheme: Boolean,
        storedHex: String?,
    ): Color {
        val parsed = parseStoredHex(storedHex) ?: return textOnSurface(courseId, darkTheme)
        val presetIndex = presetIndexForHex(parsed.normalizedHex)
        if (presetIndex >= 0) {
            return if (darkTheme) DARK_TEXT_PRESETS[presetIndex] else LIGHT_TEXT_PRESETS[presetIndex]
        }
        return ensureAccessibleTextColor(parsed.color, darkTheme)
    }

    fun getHex(courseId: String?): String {
        val id = courseId?.trim()?.ifEmpty { null } ?: "GENERAL"
        val index = hashCourseId(id) % HEX_PRESETS.size
        return HEX_PRESETS[index]
    }

    fun getHex(
        courseId: String?,
        storedHex: String?,
    ): String {
        val parsed = parseStoredHex(storedHex) ?: return getHex(courseId)
        val presetIndex = presetIndexForHex(parsed.normalizedHex)
        return if (presetIndex >= 0) HEX_PRESETS[presetIndex] else parsed.normalizedHex
    }

    fun hexFromCourses(
        courseId: String?,
        courses: Map<String, String?>,
    ): String? {
        val id = courseId?.trim()?.ifEmpty { null } ?: return null
        return courses[id]
            ?: courses.entries.firstOrNull { (key, _) -> key.equals(id, ignoreCase = true) }?.value
    }

    fun getFromCourses(
        courseId: String?,
        courses: Map<String, String?>,
    ): CourseColors = get(courseId, hexFromCourses(courseId, courses))

    fun textOnSurfaceFromCourses(
        courseId: String?,
        darkTheme: Boolean,
        courses: Map<String, String?>,
    ): Color = textOnSurface(courseId, darkTheme, hexFromCourses(courseId, courses))

    fun getHexFromCourses(
        courseId: String?,
        courses: Map<String, String?>,
    ): String = getHex(courseId, hexFromCourses(courseId, courses))
}
