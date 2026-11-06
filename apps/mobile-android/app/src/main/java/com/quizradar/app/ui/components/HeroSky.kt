package com.quizradar.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope

/**
 * The desktop's "night sky over the exam radar" motif for mobile: dim stars +
 * a warm breathing sun in light theme, a denser brighter gently-pulsing
 * starfield plus a diagonal sheen sweep in both themes. Star positions are
 * fixed (no runtime randomness) so every render — and every test screenshot —
 * is identical apart from the twinkle phases.
 */
private data class SkyStar(
    val x: Float,
    val y: Float,
    val radius: Float,
    val alpha: Float,
)

// (x, y) in fractions of the canvas, radius in dp-ish px, base alpha.
// Kept in sync with the web hero (apps/web/src/views/DashboardView.tsx).
private val DAY_STARS =
    listOf(
        SkyStar(0.07f, 0.24f, 1.0f, 0.28f),
        SkyStar(0.15f, 0.64f, 1.1f, 0.20f),
        SkyStar(0.24f, 0.32f, 0.9f, 0.35f),
        SkyStar(0.33f, 0.74f, 1.0f, 0.22f),
        SkyStar(0.42f, 0.18f, 1.1f, 0.30f),
        SkyStar(0.52f, 0.52f, 0.9f, 0.25f),
        SkyStar(0.61f, 0.30f, 1.0f, 0.30f),
        SkyStar(0.69f, 0.70f, 0.9f, 0.20f),
        SkyStar(0.76f, 0.40f, 1.0f, 0.28f),
        SkyStar(0.84f, 0.58f, 0.9f, 0.22f),
        SkyStar(0.92f, 0.34f, 1.0f, 0.30f),
        SkyStar(0.20f, 0.86f, 0.9f, 0.25f),
        SkyStar(0.03f, 0.48f, 0.9f, 0.22f),
        SkyStar(0.28f, 0.52f, 1.0f, 0.18f),
        SkyStar(0.38f, 0.88f, 0.9f, 0.20f),
        SkyStar(0.47f, 0.38f, 0.9f, 0.24f),
        SkyStar(0.58f, 0.82f, 1.0f, 0.20f),
        SkyStar(0.88f, 0.72f, 0.9f, 0.22f),
    )

private val NIGHT_STARS_A =
    listOf(
        SkyStar(0.04f, 0.18f, 1.4f, 0.95f),
        SkyStar(0.14f, 0.40f, 1.2f, 1.00f),
        SkyStar(0.18f, 0.12f, 1.0f, 0.80f),
        SkyStar(0.27f, 0.26f, 1.4f, 0.90f),
        SkyStar(0.36f, 0.08f, 1.6f, 0.85f),
        SkyStar(0.45f, 0.66f, 1.1f, 0.90f),
        SkyStar(0.49f, 0.22f, 1.5f, 0.95f),
        SkyStar(0.57f, 0.36f, 1.2f, 1.00f),
        SkyStar(0.66f, 0.14f, 1.3f, 0.90f),
        SkyStar(0.74f, 0.44f, 1.4f, 0.95f),
        SkyStar(0.83f, 0.68f, 1.3f, 0.85f),
        SkyStar(0.91f, 0.82f, 1.2f, 0.90f),
        SkyStar(0.50f, 0.94f, 1.1f, 0.80f),
        SkyStar(0.12f, 0.90f, 1.3f, 0.85f),
        SkyStar(0.08f, 0.52f, 1.2f, 0.85f),
        SkyStar(0.22f, 0.74f, 1.1f, 0.80f),
        SkyStar(0.31f, 0.44f, 1.3f, 0.90f),
        SkyStar(0.41f, 0.30f, 1.0f, 0.75f),
        SkyStar(0.55f, 0.82f, 1.2f, 0.85f),
        SkyStar(0.63f, 0.52f, 1.1f, 0.80f),
        SkyStar(0.80f, 0.52f, 1.7f, 0.95f),
        SkyStar(0.86f, 0.08f, 1.3f, 0.85f),
    )

private val NIGHT_STARS_B =
    listOf(
        SkyStar(0.09f, 0.72f, 1.6f, 0.90f),
        SkyStar(0.23f, 0.58f, 1.3f, 0.85f),
        SkyStar(0.31f, 0.84f, 1.2f, 0.80f),
        SkyStar(0.40f, 0.46f, 1.4f, 0.90f),
        SkyStar(0.53f, 0.88f, 1.2f, 0.75f),
        SkyStar(0.62f, 0.60f, 1.5f, 0.90f),
        SkyStar(0.70f, 0.78f, 1.2f, 0.80f),
        SkyStar(0.79f, 0.20f, 1.3f, 0.85f),
        SkyStar(0.87f, 0.34f, 1.4f, 0.90f),
        SkyStar(0.95f, 0.50f, 1.5f, 0.85f),
        SkyStar(0.33f, 0.12f, 1.1f, 0.70f),
        SkyStar(0.58f, 0.06f, 1.2f, 0.75f),
        SkyStar(0.05f, 0.38f, 1.4f, 0.85f),
        SkyStar(0.17f, 0.92f, 1.2f, 0.75f),
        SkyStar(0.37f, 0.62f, 1.3f, 0.85f),
        SkyStar(0.44f, 0.74f, 1.7f, 0.90f),
        SkyStar(0.47f, 0.10f, 1.1f, 0.70f),
        SkyStar(0.59f, 0.28f, 1.4f, 0.90f),
        SkyStar(0.75f, 0.92f, 1.2f, 0.80f),
        SkyStar(0.93f, 0.68f, 1.3f, 0.85f),
    )

private fun DrawScope.drawStars(
    stars: List<SkyStar>,
    alphaScale: Float,
) {
    stars.forEach { star ->
        val center = Offset(size.width * star.x, size.height * star.y)
        val alpha = (star.alpha * alphaScale).coerceIn(0f, 1f)

        // Soft celestial diffraction bloom
        drawCircle(
            color = Color(0xFFC7D2FE).copy(alpha = alpha * 0.40f),
            radius = star.radius * 3.2f,
            center = center,
        )
        // Brilliant white focal core
        drawCircle(
            color = Color.White.copy(alpha = alpha),
            radius = star.radius * 1.6f,
            center = center,
        )
        // Prominent 4-point sparkle cross on key landmark stars
        if (star.radius >= 1.4f) {
            val sparkLen = star.radius * 4.2f
            val sparkWidth = 1.2f
            drawLine(
                color = Color.White.copy(alpha = alpha * 0.70f),
                start = Offset(center.x - sparkLen, center.y),
                end = Offset(center.x + sparkLen, center.y),
                strokeWidth = sparkWidth,
            )
            drawLine(
                color = Color.White.copy(alpha = alpha * 0.70f),
                start = Offset(center.x, center.y - sparkLen),
                end = Offset(center.x, center.y + sparkLen),
                strokeWidth = sparkWidth,
            )
        }
    }
}

/** One diagonal light band sweeping left→right; off-canvas at both ends. */
private fun DrawScope.drawSheen(progress: Float) {
    val span = size.width * 1.6f
    val x = -size.width * 0.3f + progress * span
    drawRect(
        brush =
            Brush.linearGradient(
                colors =
                    listOf(
                        Color.Transparent,
                        Color.White.copy(alpha = 0.05f),
                        Color.White.copy(alpha = 0.16f),
                        Color.White.copy(alpha = 0.05f),
                        Color.Transparent,
                    ),
                start = Offset(x, 0f),
                end = Offset(x + size.width * 0.3f, size.height),
            ),
    )
}

/**
 * The sky overlay: fill its parent. `dark` picks the scene — sun + dim stars
 * for day, brighter pulsing stars for night — plus the sheen sweep on top of
 * both.
 *
 * Reduced motion: every motion here is a Compose `infiniteRepeatable`, and
 * Compose's own infinite-animation policy consults the system animator
 * duration scale. With "Remove animations" on, the scale is 0, the policy
 * runs the transition once instead of looping, and the sky settles on a
 * static frame — no endless invalidation. (Verified against compose-ui
 * 1.7.6: `androidx.compose.ui.platform.InfiniteAnimationPolicy` +
 * `MotionDurationScaleImpl`.) The app therefore needs no second mechanism,
 * and the Settings copy "Reduced motion follows system accessibility
 * settings" is accurate.
 */
@Composable
fun HeroSky(
    dark: Boolean,
    modifier: Modifier = Modifier,
) {
    // All infinite transitions are hoisted unconditionally (hook order must
    // not depend on `dark`, which can flip at runtime).
    val twinkleTransition = rememberInfiniteTransition(label = "heroTwinkle")
    val alphaA by twinkleTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0.5f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 4500),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "heroTwinkleA",
    )
    val alphaB by twinkleTransition.animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 5600, delayMillis = 900),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "heroTwinkleB",
    )
    val dayTransition = rememberInfiniteTransition(label = "heroSunGlow")
    val sunGlow by dayTransition.animateFloat(
        initialValue = 0.34f,
        targetValue = 0.46f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 5000),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "heroSunGlow",
    )
    val sheenTransition = rememberInfiniteTransition(label = "heroSheen")
    val sheen by sheenTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 6500),
                repeatMode = RepeatMode.Restart,
            ),
        label = "heroSheen",
    )

    androidx.compose.foundation.Canvas(modifier = modifier) {
        if (dark) {
            drawStars(NIGHT_STARS_A, alphaA)
            drawStars(NIGHT_STARS_B, alphaB)
        } else {
            // Expansive warm golden atmospheric corona
            val sunCenter = Offset(size.width * 0.90f, -size.height * 0.08f)
            val outerCoronaRadius = size.minDimension * 0.95f
            val midCoronaRadius = size.minDimension * 0.55f
            val coreRadius = size.minDimension * 0.22f

            // 1. Broad radiant warm atmospheric corona
            drawCircle(
                brush =
                    Brush.radialGradient(
                        colors =
                            listOf(
                                Color(0xFFFFB300).copy(alpha = (sunGlow * 1.15f).coerceIn(0f, 1f)),
                                Color(0xFFFFA000).copy(alpha = 0.26f),
                                Color(0xFFFFD54F).copy(alpha = 0.08f),
                                Color.Transparent,
                            ),
                        center = sunCenter,
                        radius = outerCoronaRadius,
                    ),
                radius = outerCoronaRadius,
                center = sunCenter,
            )

            // 2. Brilliant golden mid corona
            drawCircle(
                brush =
                    Brush.radialGradient(
                        colors =
                            listOf(
                                Color(0xFFFFF176).copy(alpha = 0.88f),
                                Color(0xFFFFB300).copy(alpha = 0.52f),
                                Color.Transparent,
                            ),
                        center = sunCenter,
                        radius = midCoronaRadius,
                    ),
                radius = midCoronaRadius,
                center = sunCenter,
            )

            // 3. Blazing incandescent solar core
            drawCircle(
                brush =
                    Brush.radialGradient(
                        colors =
                            listOf(
                                Color.White,
                                Color(0xFFFFF9C4).copy(alpha = 0.98f),
                                Color(0xFFFFEE58).copy(alpha = 0.88f),
                                Color(0xFFFFA000).copy(alpha = 0.42f),
                                Color.Transparent,
                            ),
                        center = sunCenter,
                        radius = coreRadius,
                    ),
                radius = coreRadius,
                center = sunCenter,
            )
            drawStars(DAY_STARS, 1f)
        }
        drawSheen(sheen)
    }
}
