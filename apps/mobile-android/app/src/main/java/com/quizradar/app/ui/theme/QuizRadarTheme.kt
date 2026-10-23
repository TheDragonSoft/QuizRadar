package com.quizradar.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * Design tokens mapped from apps/web/src/tokens.css
 * (docs/rebuild/01-product-spec.md §6 — same hexes across all shells).
 */
private val Accent = Color(0xFF1A73E8)
private val AccentDark = Color(0xFF3B82F6)
private val ExamRed = Color(0xFFD93025)
private val PageLight = Color(0xFFF8FAFC)
private val SurfaceLight = Color(0xFFFFFFFF)
private val TextLight = Color(0xFF1E293B)
private val DarkBase = Color(0xFF0B0F19)
private val SurfaceDark = Color(0xFF0F172A)

private val LightColors: ColorScheme =
    lightColorScheme(
        primary = Accent,
        onPrimary = SurfaceLight,
        background = PageLight,
        onBackground = TextLight,
        surface = SurfaceLight,
        onSurface = TextLight,
        error = ExamRed,
    )

private val DarkColors: ColorScheme =
    darkColorScheme(
        primary = AccentDark,
        onPrimary = SurfaceDark,
        background = DarkBase,
        onBackground = Color(0xFFF1F5F9),
        surface = SurfaceDark,
        onSurface = Color(0xFFF1F5F9),
        error = ExamRed,
    )

/**
 * QuizRadar theme over Material 3, token-driven (no dynamic color — the
 * brand palette is a locked design decision, 01 §6). Custom-event pink
 * (#DB2777, [CustomEventPink]) is reserved for the calendar/event layer in
 * phase 13; declared here so the full token set lives in one place.
 */
val CustomEventPink = Color(0xFFDB2777)

@Composable
@Suppress("standard:function-naming")
fun QuizRadarTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
