package com.quizradar.app.ui

import androidx.compose.ui.graphics.Color
import com.quizradar.app.ui.theme.StatusColors
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.pow

/**
 * Two guards the impeccable native audit relies on:
 *
 *  1. Every [androidx.compose.material3.IconButton] in the UI sources keeps a
 *     48dp touch target. M3 gives an IconButton a 48dp minimum by default, so
 *     only an EXPLICIT smaller `Modifier.size(N.dp)` in the parameter list can
 *     shrink it - that is exactly what this scan flags (sizes inside the
 *     content lambda, i.e. after `) {`, are the inner icon and do not count).
 *
 *  2. The [StatusColors] tokens keep WCAG AA contrast (>= 4.5:1 for text)
 *     against the surface they are drawn on in each appearance. The dark-mode
 *     "TODAY" chip bug (white on the dark error red = 2.8:1) was a hardcoded
 *     colour outside this token layer; these pins keep the tokens honest.
 */
class AccessibilityConformanceTest {
    private val uiDir =
        File(System.getProperty("user.dir") ?: ".").let { root ->
            listOf(
                File(root, "src/main/java/com/quizradar/app/ui"),
                File(root, "app/src/main/java/com/quizradar/app/ui"),
            ).firstOrNull { it.exists() } ?: File(root, "src/main/java/com/quizradar/app/ui")
        }

    private val iconButton = Regex("""IconButton\(""")
    private val size = Regex("""size\((\d+)\.dp\)""")

    @Test
    fun `every icon button keeps at least a 48dp touch target`() {
        assertTrue("the UI source directory must exist", uiDir.exists())
        val offenders = mutableListOf<String>()
        uiDir.walkTopDown().filter { it.extension == "kt" }.forEach { file ->
            val lines = file.readLines()
            for (i in lines.indices) {
                val line = lines[i]
                if (line.trimStart().startsWith("import ")) continue
                if (!iconButton.containsMatchIn(line)) continue
                // Only the parameter list counts: the content lambda starts at ") {".
                val params = StringBuilder()
                for (j in i until minOf(i + 12, lines.size)) {
                    params.append(lines[j]).append('\n')
                    if (") {" in lines[j]) break
                }
                val m = size.find(params.toString()) ?: continue
                val dp = m.groupValues[1].toInt()
                if (dp < 48) {
                    offenders += "${file.name}:${i + 1} uses ${dp}dp (min 48dp)"
                }
            }
        }
        assertTrue(
            "IconButtons below the 48dp minimum touch target: ${offenders.joinToString("; ")}",
            offenders.isEmpty(),
        )
    }

    @Test
    fun `status colors keep WCAG AA contrast on their surfaces`() {
        // M3 default surfaces, close enough for a luminance pin.
        val lightSurface = Color(0xFFFFFBFE)
        val darkSurface = Color(0xFF121212)

        assertTrue(
            "white on warningBadge (TOMORROW chip) must be >= 4.5:1, was " +
                contrast(Color.White, StatusColors.warningBadge).format(2),
            contrast(Color.White, StatusColors.warningBadge) >= 4.5,
        )
        assertTrue(
            "successLight on the light surface must be >= 4.5:1, was " +
                contrast(StatusColors.successLight, lightSurface).format(2),
            contrast(StatusColors.successLight, lightSurface) >= 4.5,
        )
        assertTrue(
            "successDark on the dark surface must be >= 4.5:1, was " +
                contrast(StatusColors.successDark, darkSurface).format(2),
            contrast(StatusColors.successDark, darkSurface) >= 4.5,
        )
        assertTrue(
            "onSuccessContainerLight on successContainerLight must be >= 4.5:1, was " +
                contrast(StatusColors.onSuccessContainerLight, StatusColors.successContainerLight).format(2),
            contrast(StatusColors.onSuccessContainerLight, StatusColors.successContainerLight) >= 4.5,
        )
        assertTrue(
            "onSuccessContainerDark on successContainerDark must be >= 4.5:1, was " +
                contrast(StatusColors.onSuccessContainerDark, StatusColors.successContainerDark).format(2),
            contrast(StatusColors.onSuccessContainerDark, StatusColors.successContainerDark) >= 4.5,
        )
    }

    private fun contrast(
        a: Color,
        b: Color,
    ): Double {
        val l1 = luminance(a)
        val l2 = luminance(b)
        return (maxOf(l1, l2) + 0.05) / (minOf(l1, l2) + 0.05)
    }

    private fun luminance(color: Color): Double {
        fun linear(c: Float): Double =
            if (c <= 0.03928f) {
                c.toDouble() / 12.92
            } else {
                ((c.toDouble() + 0.055) / 1.055).pow(2.4)
            }
        return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    }

    private fun Double.format(decimals: Int): String = "%.${decimals}f".format(this)
}
