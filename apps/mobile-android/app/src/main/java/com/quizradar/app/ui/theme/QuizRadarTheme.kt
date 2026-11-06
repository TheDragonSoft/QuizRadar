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
private val PageLight = Color(0xFFF5F7FB)
private val SurfaceLight = Color(0xFFFFFFFF)
private val TextLight = Color(0xFF0F172A)
private val DarkBase = Color(0xFF070A12)
private val SurfaceDark = Color(0xFF0E1526)

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
        surfaceVariant = Color(0xFF162035),
        onSurfaceVariant = Color(0xFF94A3B8),
        surfaceContainerLowest = DarkBase,
        surfaceContainerLow = Color(0xFF0A0F1D),
        surfaceContainer = SurfaceDark,
        surfaceContainerHigh = Color(0xFF162035),
        surfaceContainerHighest = Color(0xFF22304D),
        outline = Color(0xFF273654),
        outlineVariant = Color(0xFF1A243A),
        error = ExamRedDark,
        onError = Color(0xFF450A0A),
    )

private val AmoledColors: ColorScheme =
    darkColorScheme(
        primary = AccentDark,
        onPrimary = SurfaceLight,
        primaryContainer = Color(0xFF1E3A8A),
        onPrimaryContainer = Color(0xFFDBEAFE),
        secondary = Color(0xFF94A3B8),
        onSecondary = Color.Black,
        secondaryContainer = Color(0xFF1E3A8A),
        onSecondaryContainer = Color(0xFFDBEAFE),
        background = Color.Black,
        onBackground = Color(0xFFF1F5F9),
        surface = Color(0xFF08090D),
        onSurface = Color(0xFFF1F5F9),
        surfaceVariant = Color(0xFF101218),
        onSurfaceVariant = Color(0xFF94A3B8),
        surfaceContainerLowest = Color.Black,
        surfaceContainerLow = Color(0xFF050608),
        surfaceContainer = Color(0xFF0A0B10),
        surfaceContainerHigh = Color(0xFF12151E),
        surfaceContainerHighest = Color(0xFF1A1F2C),
        outline = Color(0xFF202534),
        outlineVariant = Color(0xFF141722),
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

/**
 * The status colours Material 3 has no role for.
 *
 * The app shows connected accounts, completed setup steps, "tomorrow"
 * badges and scores. These lived as raw hex literals copied into a dozen
 * screens, and the light-only green measured 3.2:1 on the dark surface -
 * below the 4.5:1 that WCAG AA asks of text. They live HERE, in the token
 * layer, with a light and a dark variant, so a screen picks the colour that
 * matches the theme it is drawn in.
 *
 * The ratios below are the sRGB relative luminance of these exact values:
 * - [onSuccessContainerLight] on [successContainerLight]: 4.6:1
 * - [onSuccessContainerDark] on [successContainerDark]: 6.4:1
 * - [successLight] on white: 5.6:1, [successDark] on the dark surface: 9.3:1
 * - [warningBadge] with white text: 5.0:1 (the old amber was 2.7:1)
 */
object StatusColors {
    /** "Connected / done / good" text and icons. */
    val successLight = Color(0xFF047857)
    val successDark = Color(0xFF34D399)

    /** The mint "connected" pill: its container and the content on it. */
    val successContainerLight = Color(0xFFDCFCE7)
    val successContainerDark = Color(0xFF064E3B)
    val onSuccessContainerLight = Color(0xFF15803D)
    val onSuccessContainerDark = Color(0xFF6EE7B7)

    /** The amber "tomorrow" badge. White text sits on it. */
    val warningBadge = Color(0xFFB45309)

    /** The success colour for the theme that is on screen. */
    fun success(isDark: Boolean): Color = if (isDark) successDark else successLight

    /** The connected-pill container for the theme that is on screen. */
    fun successContainer(isDark: Boolean): Color = if (isDark) successContainerDark else successContainerLight

    /** The content colour for the connected pill. */
    fun onSuccessContainer(isDark: Boolean): Color = if (isDark) onSuccessContainerDark else onSuccessContainerLight
}

@Composable
@Suppress("standard:function-naming")
fun QuizRadarTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    isAmoled: Boolean = false,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val activity = view.context as? Activity
            if (activity != null) {
                WindowCompat.getInsetsController(activity.window, view).apply {
                    isAppearanceLightStatusBars = !darkTheme && !isAmoled
                    isAppearanceLightNavigationBars = !darkTheme && !isAmoled
                }
            }
        }
    }

    val colors =
        when {
            isAmoled -> AmoledColors
            darkTheme -> DarkColors
            else -> LightColors
        }

    MaterialTheme(
        colorScheme = colors,
        content = content,
    )
}
