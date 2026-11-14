package com.quizradar.app.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope

private data class CelestialStar(
    val x: Float,
    val y: Float,
    val radius: Float,
    val alpha: Float,
    val isGold: Boolean = false,
    val hasSparkleCross: Boolean = false,
)

// 80+ celestial stars scattered gracefully across the entire phone screen viewport
private val AMOLED_STARS: List<CelestialStar> =
    listOf(
        // Top Bar & Header Horizon (y: 0.02 - 0.15)
        CelestialStar(0.06f, 0.03f, 1.4f, 0.85f),
        CelestialStar(0.18f, 0.07f, 2.2f, 0.95f, isGold = true, hasSparkleCross = true),
        CelestialStar(0.32f, 0.04f, 1.2f, 0.70f),
        CelestialStar(0.48f, 0.09f, 1.6f, 0.90f),
        CelestialStar(0.65f, 0.05f, 2.0f, 0.95f, hasSparkleCross = true),
        CelestialStar(0.82f, 0.08f, 1.3f, 0.75f),
        CelestialStar(0.94f, 0.04f, 1.8f, 0.90f, isGold = true),
        CelestialStar(0.12f, 0.13f, 1.5f, 0.80f),
        CelestialStar(0.28f, 0.16f, 2.4f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.55f, 0.14f, 1.3f, 0.70f),
        CelestialStar(0.74f, 0.17f, 1.7f, 0.85f),
        CelestialStar(0.88f, 0.12f, 2.0f, 0.95f, isGold = true),
        // Upper Section (y: 0.18 - 0.35)
        CelestialStar(0.04f, 0.22f, 1.8f, 0.90f),
        CelestialStar(0.15f, 0.27f, 1.2f, 0.75f),
        CelestialStar(0.24f, 0.21f, 1.6f, 0.85f),
        CelestialStar(0.38f, 0.29f, 2.2f, 0.95f, isGold = true, hasSparkleCross = true),
        CelestialStar(0.52f, 0.24f, 1.4f, 0.80f),
        CelestialStar(0.68f, 0.31f, 1.9f, 0.90f),
        CelestialStar(0.85f, 0.25f, 2.5f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.96f, 0.29f, 1.3f, 0.70f),
        CelestialStar(0.09f, 0.34f, 2.1f, 0.95f, isGold = true),
        CelestialStar(0.44f, 0.36f, 1.5f, 0.80f),
        CelestialStar(0.79f, 0.35f, 1.7f, 0.85f),
        // Midsection (y: 0.38 - 0.60)
        CelestialStar(0.03f, 0.42f, 1.5f, 0.80f),
        CelestialStar(0.16f, 0.46f, 2.4f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.27f, 0.40f, 1.2f, 0.70f),
        CelestialStar(0.36f, 0.48f, 1.8f, 0.90f, isGold = true),
        CelestialStar(0.58f, 0.44f, 2.0f, 0.95f),
        CelestialStar(0.71f, 0.50f, 1.4f, 0.75f),
        CelestialStar(0.86f, 0.43f, 2.6f, 1.00f, isGold = true, hasSparkleCross = true),
        CelestialStar(0.95f, 0.49f, 1.3f, 0.70f),
        CelestialStar(0.08f, 0.55f, 2.0f, 0.90f),
        CelestialStar(0.22f, 0.58f, 1.6f, 0.85f),
        CelestialStar(0.49f, 0.54f, 2.2f, 0.95f, hasSparkleCross = true),
        CelestialStar(0.64f, 0.59f, 1.3f, 0.75f),
        CelestialStar(0.80f, 0.56f, 1.7f, 0.85f),
        CelestialStar(0.92f, 0.57f, 2.1f, 0.90f, isGold = true),
        // Lower Midsection (y: 0.62 - 0.80)
        CelestialStar(0.05f, 0.64f, 1.9f, 0.90f),
        CelestialStar(0.18f, 0.69f, 1.4f, 0.80f),
        CelestialStar(0.31f, 0.65f, 2.3f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.45f, 0.71f, 1.2f, 0.70f),
        CelestialStar(0.60f, 0.66f, 1.8f, 0.85f, isGold = true),
        CelestialStar(0.73f, 0.73f, 2.5f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.89f, 0.67f, 1.5f, 0.80f),
        CelestialStar(0.97f, 0.72f, 2.0f, 0.95f),
        CelestialStar(0.11f, 0.77f, 1.6f, 0.85f),
        CelestialStar(0.25f, 0.79f, 2.1f, 0.95f, isGold = true),
        CelestialStar(0.53f, 0.76f, 1.4f, 0.75f),
        CelestialStar(0.83f, 0.78f, 2.2f, 0.95f, hasSparkleCross = true),
        // Bottom Navigation Horizon (y: 0.82 - 0.98)
        CelestialStar(0.04f, 0.84f, 1.5f, 0.80f),
        CelestialStar(0.19f, 0.88f, 2.4f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.34f, 0.85f, 1.3f, 0.70f),
        CelestialStar(0.47f, 0.91f, 2.0f, 0.95f, isGold = true),
        CelestialStar(0.62f, 0.86f, 1.7f, 0.85f),
        CelestialStar(0.77f, 0.92f, 2.5f, 1.00f, hasSparkleCross = true),
        CelestialStar(0.91f, 0.87f, 1.4f, 0.75f),
        CelestialStar(0.07f, 0.95f, 2.0f, 0.90f),
        CelestialStar(0.26f, 0.96f, 1.6f, 0.80f),
        CelestialStar(0.58f, 0.97f, 2.2f, 0.95f, isGold = true, hasSparkleCross = true),
        CelestialStar(0.84f, 0.95f, 1.8f, 0.90f),
        CelestialStar(0.96f, 0.96f, 1.3f, 0.75f),
    )

private const val MAX_STAR_ALPHA = 0.56f

@Composable
fun AmoledStarrySky(modifier: Modifier = Modifier) {
    val infiniteTransition = rememberInfiniteTransition(label = "star_twinkle_transition")
    val twinklePulse by infiniteTransition.animateFloat(
        initialValue = 0.76f,
        targetValue = 1.0f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 2800, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "twinkle_alpha",
    )

    Canvas(modifier = modifier) {
        drawRect(color = Color.Black)
        // Subtle deep-space zenith nebula glow so the starfield has depth while
        // preserving true-black AMOLED contrast across the main viewport.
        drawCircle(
            brush =
                Brush.radialGradient(
                    colors =
                        listOf(
                            Color(0xFF1E1B4B).copy(alpha = 0.34f),
                            Color(0xFF0F172A).copy(alpha = 0.14f),
                            Color.Transparent,
                        ),
                    center = Offset(size.width * 0.24f, size.height * 0.12f),
                    radius = size.width * 0.72f,
                ),
            radius = size.width * 0.72f,
            center = Offset(size.width * 0.24f, size.height * 0.12f),
        )
        drawCircle(
            brush =
                Brush.radialGradient(
                    colors =
                        listOf(
                            Color(0xFF172554).copy(alpha = 0.26f),
                            Color.Transparent,
                        ),
                    center = Offset(size.width * 0.82f, size.height * 0.20f),
                    radius = size.width * 0.58f,
                ),
            radius = size.width * 0.58f,
            center = Offset(size.width * 0.82f, size.height * 0.20f),
        )
        drawAmoledStars(AMOLED_STARS, twinklePulse)
    }
}

private fun DrawScope.drawAmoledStars(
    stars: List<CelestialStar>,
    twinkleScale: Float,
) {
    stars.forEach { star ->
        val center = Offset(size.width * star.x, size.height * star.y)
        val alpha = (star.alpha * MAX_STAR_ALPHA * twinkleScale).coerceIn(0f, MAX_STAR_ALPHA)

        val coreColor =
            if (star.isGold) {
                Color(0xFFFEF08A).copy(alpha = alpha)
            } else {
                Color(0xFFF8FAFC).copy(alpha = alpha)
            }

        // Outer atmospheric halo
        drawCircle(
            color =
                if (star.isGold) {
                    Color(0xFFF59E0B).copy(alpha = alpha * 0.14f)
                } else {
                    Color(0xFF818CF8).copy(alpha = alpha * 0.16f)
                },
            radius = star.radius * 3.1f,
            center = center,
        )

        // Mid corona bloom
        drawCircle(
            color =
                if (star.isGold) {
                    Color(0xFFFDE68A).copy(alpha = alpha * 0.34f)
                } else {
                    Color(0xFFC7D2FE).copy(alpha = alpha * 0.34f)
                },
            radius = star.radius * 1.75f,
            center = center,
        )

        // Crisp starlight core
        drawCircle(
            color = coreColor,
            radius = star.radius * 0.92f,
            center = center,
        )

        // Refined 4-point sparkle cross on landmark stars
        if (star.hasSparkleCross) {
            val sparkLen = star.radius * 3.2f
            val sparkWidth = 1.0f
            val sparkColor = coreColor.copy(alpha = alpha * 0.62f)

            drawLine(
                color = sparkColor,
                start = Offset(center.x - sparkLen, center.y),
                end = Offset(center.x + sparkLen, center.y),
                strokeWidth = sparkWidth,
            )
            drawLine(
                color = sparkColor,
                start = Offset(center.x, center.y - sparkLen),
                end = Offset(center.x, center.y + sparkLen),
                strokeWidth = sparkWidth,
            )
        }
    }
}
