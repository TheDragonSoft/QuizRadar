package com.quizradar.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The QuizRadar mark - the radar squircle.
 *
 * This is the EXACT artwork the desktop and the browser tier ship: the v4
 * `static/icon.svg`, inlined in `apps/web/src/components/BrandMarks.tsx` as
 * `RadarMark`. Same squircle, same gradient, same rings, same dashed middle
 * ring, same gold needle, same three exam blips.
 *
 * It used to be a different, monochrome radar drawn as an `ImageVector` and
 * tinted with the theme's primary colour, so the phone showed a plain blue
 * circle-and-line while the desktop showed the full radar squircle. A mark
 * that is the same product has to be the same picture on every platform.
 *
 * It is drawn with a [Canvas] rather than an `ImageVector` for two reasons:
 * the artwork has a gradient background and a dashed ring, and neither is
 * expressible in an `ImageVector` (the dashed ring has no `ImageVector`
 * equivalent at all).
 *
 * The geometry lives in [RadarMarkGeometry] so that the in-app mark and the
 * launcher icon are provably the same drawing - `RadarMarkTest` checks the
 * launcher vector against these very numbers.
 */
@Composable
fun QuizRadarLogo(
    modifier: Modifier = Modifier,
    size: Dp = 26.dp,
) {
    Canvas(modifier = modifier.size(size)) {
        drawRadarMark()
    }
}

/** The v4 palette, in one place, so the mark and the launcher icon agree. */
internal object RadarMarkColors {
    val BackgroundTop = Color(0xFF1E3A8A)
    val BackgroundMiddle = Color(0xFF1D4ED8)
    val BackgroundBottom = Color(0xFF2563EB)
    val SweepStart = Color(0xFF60A5FA).copy(alpha = 0.55f)
    val SweepEnd = Color(0xFF38BDF8).copy(alpha = 0f)
    val Needle = Color(0xFFFACC15)
    val Hub = Color(0xFFFFFFFF)
    val HubCore = Color(0xFF1D4ED8)
    val BlipFound = Color(0xFF34D399)
    val BlipUrgent = Color(0xFFF87171)
}

/**
 * The mark's geometry, in the 256x256 design space of the v4 `static/icon.svg`.
 *
 * Every number below is the desktop SVG's number, untouched - the mark is the
 * same picture as long as the numbers are the same numbers. The launcher icon
 * is the same drawing scaled into the 72dp safe zone the launcher never
 * crops, and [launcher] is the one place that conversion lives.
 */
internal object RadarMarkGeometry {
    /** The design box of the v4 SVG. */
    const val DESIGN_SIZE = 256f

    /** The squircle: a rounded square with the diagonal blue gradient. */
    const val SQUIRCLE_X = 12f
    const val SQUIRCLE_Y = 12f
    const val SQUIRCLE_SIZE = 232f
    const val SQUIRCLE_RADIUS = 56f

    /** The hairline that lifts the squircle off the launcher background. */
    const val HAIRLINE_INSET = 2f
    const val HAIRLINE_WIDTH = 3f
    const val HAIRLINE_ALPHA = 0.18f

    /** The two calendar binder tabs on the top edge. */
    val TAB_X = floatArrayOf(78f, 162f)
    const val TAB_Y = 28f
    const val TAB_WIDTH = 16f
    const val TAB_HEIGHT = 26f
    const val TAB_RADIUS = 8f
    const val TAB_ALPHA = 0.9f

    /** The radar hub, and the three rings around it. */
    const val CENTER_X = 128f
    const val CENTER_Y = 136f
    val RING_RADII = floatArrayOf(76f, 50f, 24f)
    val RING_STROKE_WIDTHS = floatArrayOf(5f, 4f, 4f)
    val RING_ALPHAS = floatArrayOf(0.22f, 0.32f, 0.45f)

    /** The dashed middle ring - what makes the mark read as a radar. */
    val DASH_ON = 10f
    val DASH_OFF = 8f

    /** The sweep sector: from the hub straight up, clockwise to the needle. */
    const val SWEEP_TOP_X = 128f
    const val SWEEP_TOP_Y = 60f
    const val SWEEP_END_X = 198f
    const val SWEEP_END_Y = 106f
    const val SWEEP_GRADIENT_START_X = 128f
    const val SWEEP_GRADIENT_START_Y = 36f
    const val SWEEP_GRADIENT_END_X = 210f
    const val SWEEP_GRADIENT_END_Y = 128f

    /** The gold needle. */
    const val NEEDLE_END_X = 184f
    const val NEEDLE_END_Y = 84f
    const val NEEDLE_WIDTH = 6f

    /** The hub. */
    const val HUB_RADIUS = 10f
    const val HUB_CORE_RADIUS = 5f

    /** The detected exam blips: one gold (the match), one green, one red. */
    const val GOLD_BLIP_X = 174f
    const val GOLD_BLIP_Y = 93f
    const val GOLD_BLIP_RADIUS = 9f
    const val GOLD_RING_RADIUS = 15f
    const val GOLD_RING_WIDTH = 3f
    const val GOLD_RING_ALPHA = 0.45f
    const val GREEN_BLIP_X = 92f
    const val GREEN_BLIP_Y = 112f
    const val BLIP_RADIUS = 6.5f
    const val RED_BLIP_X = 156f
    const val RED_BLIP_Y = 166f

    /**
     * The launcher icon scales the artwork by 72/256 - the safe zone the
     * launcher never crops - and centres it on the 108dp canvas.
     */
    const val LAUNCHER_SCALE = 72f / 256f
    const val LAUNCHER_OFFSET = 18f

    /** A design-space point in the launcher's 108dp space. */
    fun launcher(value: Float): Float = LAUNCHER_OFFSET + value * LAUNCHER_SCALE

    /** A design-space size (a radius, a stroke width) in the launcher's space. */
    fun launcherSize(value: Float): Float = value * LAUNCHER_SCALE
}

/**
 * Draws the mark in a 256x256 design space, scaled to the canvas.
 */
private fun DrawScope.drawRadarMark() {
    val geo = RadarMarkGeometry
    val scale = size.minDimension / geo.DESIGN_SIZE

    fun px(v: Float): Float = v * scale

    fun point(
        x: Float,
        y: Float,
    ): Offset = Offset(px(x), px(y))

    // The squircle: a 232x232 rounded square with the diagonal blue gradient.
    drawRoundRect(
        brush =
            Brush.linearGradient(
                colorStops =
                    arrayOf(
                        0f to RadarMarkColors.BackgroundTop,
                        0.5f to RadarMarkColors.BackgroundMiddle,
                        1f to RadarMarkColors.BackgroundBottom,
                    ),
                start = point(0f, 0f),
                end = point(geo.DESIGN_SIZE, geo.DESIGN_SIZE),
            ),
        topLeft = point(geo.SQUIRCLE_X, geo.SQUIRCLE_Y),
        size = Size(px(geo.SQUIRCLE_SIZE), px(geo.SQUIRCLE_SIZE)),
        cornerRadius = CornerRadius(px(geo.SQUIRCLE_RADIUS), px(geo.SQUIRCLE_RADIUS)),
    )

    // The hairline that lifts the squircle off the launcher background.
    drawRoundRect(
        color = Color.White.copy(alpha = geo.HAIRLINE_ALPHA),
        topLeft = point(geo.SQUIRCLE_X + geo.HAIRLINE_INSET, geo.SQUIRCLE_Y + geo.HAIRLINE_INSET),
        size = Size(px(geo.SQUIRCLE_SIZE - 2 * geo.HAIRLINE_INSET), px(geo.SQUIRCLE_SIZE - 2 * geo.HAIRLINE_INSET)),
        cornerRadius = CornerRadius(px(geo.SQUIRCLE_RADIUS - geo.HAIRLINE_INSET), px(geo.SQUIRCLE_RADIUS - geo.HAIRLINE_INSET)),
        style = Stroke(width = px(geo.HAIRLINE_WIDTH)),
    )

    // The two calendar binder tabs on the top edge.
    geo.TAB_X.forEach { tabX ->
        drawRoundRect(
            color = Color.White.copy(alpha = geo.TAB_ALPHA),
            topLeft = point(tabX, geo.TAB_Y),
            size = Size(px(geo.TAB_WIDTH), px(geo.TAB_HEIGHT)),
            cornerRadius = CornerRadius(px(geo.TAB_RADIUS), px(geo.TAB_RADIUS)),
        )
    }

    val center = point(geo.CENTER_X, geo.CENTER_Y)

    // The three radar rings. The middle one is dashed - that is what makes
    // the mark read as a radar rather than as a target.
    drawCircle(
        color = Color.White.copy(alpha = geo.RING_ALPHAS[0]),
        radius = px(geo.RING_RADII[0]),
        center = center,
        style = Stroke(width = px(geo.RING_STROKE_WIDTHS[0])),
    )
    drawCircle(
        color = Color.White.copy(alpha = geo.RING_ALPHAS[1]),
        radius = px(geo.RING_RADII[1]),
        center = center,
        style =
            Stroke(
                width = px(geo.RING_STROKE_WIDTHS[1]),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(px(geo.DASH_ON), px(geo.DASH_OFF))),
            ),
    )
    drawCircle(
        color = Color.White.copy(alpha = geo.RING_ALPHAS[2]),
        radius = px(geo.RING_RADII[2]),
        center = center,
        style = Stroke(width = px(geo.RING_STROKE_WIDTHS[2])),
    )

    // The sweep sector: from the hub straight up, clockwise to the needle.
    val sweep =
        Path().apply {
            moveTo(px(geo.CENTER_X), px(geo.CENTER_Y))
            lineTo(px(geo.SWEEP_TOP_X), px(geo.SWEEP_TOP_Y))
            arcTo(
                rect =
                    Rect(
                        center.x - px(geo.RING_RADII[0]),
                        center.y - px(geo.RING_RADII[0]),
                        center.x + px(geo.RING_RADII[0]),
                        center.y + px(geo.RING_RADII[0]),
                    ),
                startAngleDegrees = -90f,
                sweepAngleDegrees = 66.8f,
                forceMoveTo = false,
            )
            close()
        }
    drawPath(
        path = sweep,
        brush =
            Brush.linearGradient(
                colorStops = arrayOf(0f to RadarMarkColors.SweepStart, 1f to RadarMarkColors.SweepEnd),
                start = point(geo.SWEEP_GRADIENT_START_X, geo.SWEEP_GRADIENT_START_Y),
                end = point(geo.SWEEP_GRADIENT_END_X, geo.SWEEP_GRADIENT_END_Y),
            ),
    )

    // The gold needle.
    drawLine(
        color = RadarMarkColors.Needle,
        start = point(geo.CENTER_X, geo.CENTER_Y),
        end = point(geo.NEEDLE_END_X, geo.NEEDLE_END_Y),
        strokeWidth = px(geo.NEEDLE_WIDTH),
        cap = StrokeCap.Round,
    )

    // The hub.
    drawCircle(color = RadarMarkColors.Hub, radius = px(geo.HUB_RADIUS), center = center)
    drawCircle(color = RadarMarkColors.HubCore, radius = px(geo.HUB_CORE_RADIUS), center = center)

    // The detected exam blips: one gold (the match), one green, one red.
    drawCircle(color = RadarMarkColors.Needle, radius = px(geo.GOLD_BLIP_RADIUS), center = point(geo.GOLD_BLIP_X, geo.GOLD_BLIP_Y))
    drawCircle(
        color = RadarMarkColors.Needle.copy(alpha = geo.GOLD_RING_ALPHA),
        radius = px(geo.GOLD_RING_RADIUS),
        center = point(geo.GOLD_BLIP_X, geo.GOLD_BLIP_Y),
        style = Stroke(width = px(geo.GOLD_RING_WIDTH)),
    )
    drawCircle(color = RadarMarkColors.BlipFound, radius = px(geo.BLIP_RADIUS), center = point(geo.GREEN_BLIP_X, geo.GREEN_BLIP_Y))
    drawCircle(color = RadarMarkColors.BlipUrgent, radius = px(geo.BLIP_RADIUS), center = point(geo.RED_BLIP_X, geo.RED_BLIP_Y))
}
