package com.quizradar.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
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
        primary = Color(0xFFF1F5F9),
        onPrimary = Color.Black,
        primaryContainer = Color(0xFF1A1C24),
        onPrimaryContainer = Color(0xFFF4F4F5),
        secondary = Color(0xFFA1A1AA),
        onSecondary = Color.Black,
        secondaryContainer = Color(0xFF242732),
        onSecondaryContainer = Color(0xFFF4F4F5),
        background = Color.Black,
        onBackground = Color(0xFFF8FAFC),
        surface = Color(0xFF0C0D12),
        onSurface = Color(0xFFF8FAFC),
        surfaceVariant = Color(0xFF12141C),
        onSurfaceVariant = Color(0xFFA1A1AA),
        surfaceContainerLowest = Color.Black,
        surfaceContainerLow = Color(0xFF08090D),
        surfaceContainer = Color(0xFF0E1016),
        surfaceContainerHigh = Color(0xFF151720),
        surfaceContainerHighest = Color(0xFF1C1E2A),
        outline = Color(0xFF282C3A),
        outlineVariant = Color(0xFF1E212C),
        error = ExamRedDark,
        onError = Color(0xFF450A0A),
    )

/*
 * Typography scale — the one hierarchy (docs/ANDROID-DESIGN-SYSTEM.md §2).
 *
 * Only the roles the brief names are overridden; every other style keeps its
 * Material 3 token default, so screens read `MaterialTheme.typography.<role>`
 * and get the scale for free. Weight/tracking here, colour roles at the call
 * site (support/muted text pairs bodySmall with onSurfaceVariant).
 *
 * - titleLarge 22sp/600, tracking -0.01em: screen titles
 * - titleMedium 16sp/600: section headers and card titles
 * - bodyMedium 14sp/400, lineHeight 20sp: body copy
 * - bodySmall 12sp/400: support/muted text
 * - labelMedium 12sp/500: meta/labels
 */
private val QuizRadarTypography: Typography =
    Typography(
        titleLarge =
            TextStyle(
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
                lineHeight = 28.sp,
                letterSpacing = (-0.01).em,
            ),
        titleMedium =
            TextStyle(
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                lineHeight = 24.sp,
            ),
        bodyMedium =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
        bodySmall =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
        labelMedium =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
    )

/*
 * Radius system — declared once (docs/ANDROID-DESIGN-SYSTEM.md §1) so the
 * whole app inherits it without touching call sites. The slots below are
 * mapped to what each Material 3 component ACTUALLY reads in this version
 * (compose-bom 2025.01.00 -> material3 1.3.1, verified against the artifact):
 *
 * - extraSmall (12dp): OutlinedTextField/TextField (OutlinedTextFieldTokens
 *   ContainerShape = CornerExtraSmall), Snackbar, DropdownMenu. Text fields
 *   do NOT share the small slot in this version, so the brief's 12dp field
 *   radius lands here with no per-screen shape override.
 * - small (full pill): FilterChip and the other chips (FilterChipTokens
 *   ContainerShape = CornerSmall). Buttons do NOT read this slot — they
 *   resolve the hardcoded CornerFull token (CircleShape), so every
 *   Button/TextButton is already a pill and stays one.
 * - medium (16dp): Card/ElevatedCard/OutlinedCard (CornerMedium).
 * - large (28dp): FAB and other large-end surfaces (CornerLarge).
 * - extraLarge (28dp): ModalBottomSheet and AlertDialog (CornerExtraLarge).
 *
 * No screen references `MaterialTheme.shapes` today, so these are the only
 * radii in force unless a call site passes an explicit shape.
 */
private val QuizRadarShapes: Shapes =
    Shapes(
        extraSmall = RoundedCornerShape(12.dp),
        small = CircleShape,
        medium = RoundedCornerShape(16.dp),
        large = RoundedCornerShape(28.dp),
        extraLarge = RoundedCornerShape(28.dp),
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
        typography = QuizRadarTypography,
        shapes = QuizRadarShapes,
        content = content,
    )
}
