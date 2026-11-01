package com.quizradar.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/*
 * Design tokens mapped from apps/web/src/tokens.css
 * (docs/rebuild/01-product-spec.md §6 — same hexes across all shells).
 */
private val Accent = Color(0xFF1A73E8)
private val AccentDark = Color(0xFF2563EB)
private val ExamRed = Color(0xFFD93025)
private val ExamRedDark = Color(0xFFF87171)
private val PageLight = Color(0xFFF8FAFC)
private val SurfaceLight = Color(0xFFFFFFFF)
private val TextLight = Color(0xFF0F172A)
private val DarkBase = Color(0xFF0B0F19)
private val SurfaceDark = Color(0xFF111827)

private val LightColors: ColorScheme =
    lightColorScheme(
        primary = Accent,
        onPrimary = SurfaceLight,
        primaryContainer = Color(0xFFE8F0FE),
        onPrimaryContainer = Color(0xFF0D47A1),
        secondary = Color(0xFF334155),
        onSecondary = SurfaceLight,
        secondaryContainer = Color(0xFFE8F0FE),
        onSecondaryContainer = Color(0xFF1557B0),
        background = PageLight,
        onBackground = TextLight,
        surface = SurfaceLight,
        onSurface = TextLight,
        surfaceVariant = Color(0xFFF1F5F9),
        onSurfaceVariant = Color(0xFF475569),
        surfaceContainerLowest = SurfaceLight,
        surfaceContainerLow = PageLight,
        surfaceContainer = Color(0xFFF1F5F9),
        surfaceContainerHigh = Color(0xFFE2E8F0),
        surfaceContainerHighest = Color(0xFFE2E8F0),
        outline = Color(0xFFCBD5E1),
        outlineVariant = Color(0xFFE2E8F0),
        error = ExamRed,
        onError = SurfaceLight,
    )

private val DarkColors: ColorScheme =
    darkColorScheme(
        primary = AccentDark,
        onPrimary = SurfaceLight,
        primaryContainer = Color(0xFF1E3A8A),
        onPrimaryContainer = Color(0xFFDBEAFE),
        secondary = Color(0xFF94A3B8),
        onSecondary = DarkBase,
        secondaryContainer = Color(0xFF1E3A8A),
        onSecondaryContainer = Color(0xFFDBEAFE),
        background = DarkBase,
        onBackground = Color(0xFFF1F5F9),
        surface = SurfaceDark,
        onSurface = Color(0xFFF1F5F9),
        surfaceVariant = Color(0xFF1E293B),
        onSurfaceVariant = Color(0xFF94A3B8),
        surfaceContainerLowest = DarkBase,
        surfaceContainerLow = Color(0xFF0F172A),
        surfaceContainer = SurfaceDark,
        surfaceContainerHigh = Color(0xFF1E293B),
        surfaceContainerHighest = Color(0xFF334155),
        outline = Color(0xFF334155),
        outlineVariant = Color(0xFF1E293B),
        error = ExamRedDark,
        onError = Color(0xFF450A0A),
    )

/**
 * QuizRadar theme over Material 3, token-driven (no dynamic color — the
 * brand palette is a locked design decision, 01 §6). Custom-event pink
 * (#DB2777, [CustomEventPink]) is reserved for the calendar/event layer;
 * declared here so the full token set lives in one place.
 */
val CustomEventPink = Color(0xFFDB2777)

@Composable
@Suppress("standard:function-naming")
fun QuizRadarTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val activity = view.context as? Activity
            if (activity != null) {
                WindowCompat.getInsetsController(activity.window, view).apply {
                    isAppearanceLightStatusBars = !darkTheme
                    isAppearanceLightNavigationBars = !darkTheme
                }
            }
        }
    }

    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
