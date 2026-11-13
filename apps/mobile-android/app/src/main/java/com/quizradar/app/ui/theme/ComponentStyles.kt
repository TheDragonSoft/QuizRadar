package com.quizradar.app.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CardElevation
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SelectableChipColors
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.ui.icons.Icons

/*
 * Control-level defaults for the "Quiet instrument" system
 * (docs/ANDROID-DESIGN-SYSTEM.md sections 1-4).
 *
 * The theme (QuizRadarTheme.kt) already pushes typography and radius through
 * MaterialTheme; what it cannot push - min sizes, paddings, borders, the
 * destructive/selected/disabled state colours - lives here as small reusable
 * helpers so the screen sweep adopts one system instead of hand-rolling
 * styles. Every helper is a DEFAULT the sweep applies at existing call
 * sites; deviations need a reason, and no surface ever stacks a border and
 * a shadow. The factory parameter names here were verified against the
 * material3 1.3.1 artifact that compose-bom 2025.01.00 resolves.
 *
 * KNOWN TOKEN GAP: the locked color schemes do not define
 * errorContainer/onErrorContainer yet, so [ButtonDefaults.destructivePill]
 * currently resolves those roles to the Material baseline until a scheme
 * pass defines them - keep using the roles, never raw hex.
 */

/** 38% content alpha for disabled controls (brief section 3) - applied to onSurfaceVariant, never to an enabled look. */
private const val DISABLED_CONTENT_ALPHA = 0.38f

/** Pill button minimum height (brief section 3, Primary/Secondary/Destructive) - pass via `Modifier.defaultMinSize(minHeight = PillButtonMinHeight)`. */
val PillButtonMinHeight = 48.dp

/** Pill button content padding (brief section 3: 24dp horizontal, 12dp vertical) - pass as `contentPadding = PillButtonContentPadding`. */
val PillButtonContentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp)

/** Primary action - the one filled pill per flow (brief section 3 Primary): primary/onPrimary, disabled = surfaceVariant + 38% onSurfaceVariant. */
@Composable
fun ButtonDefaults.filledPill(): ButtonColors =
    buttonColors(
        containerColor = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = DISABLED_CONTENT_ALPHA),
    )

/** Secondary action - the tonal pill, same metrics as [filledPill] (brief section 3 Secondary): secondaryContainer/onSecondaryContainer. */
@Composable
fun ButtonDefaults.tonalPill(): ButtonColors =
    filledTonalButtonColors(
        containerColor = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = DISABLED_CONTENT_ALPHA),
    )

/** Destructive action - the filled pill in errorContainer/onErrorContainer (brief section 3 Destructive); see the token-gap note above. */
@Composable
fun ButtonDefaults.destructivePill(): ButtonColors =
    buttonColors(
        containerColor = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = DISABLED_CONTENT_ALPHA),
    )

/** The one filter-chip look (brief section 4): unselected = surfaceVariant + onSurfaceVariant, selected = secondaryContainer + onSecondaryContainer. */
@Composable
fun FilterChipDefaults.quietChipColors(): SelectableChipColors =
    filterChipColors(
        containerColor = MaterialTheme.colorScheme.surfaceVariant,
        labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
        iconColor = MaterialTheme.colorScheme.onSurfaceVariant,
        selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
        selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
        selectedLeadingIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
        selectedTrailingIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
    )

/** Leading check for the selected filter chip (brief section 4) - selection is never colour-only; use as `leadingIcon = { if (selected) ChipLeadingCheck() }`. */
@Composable
fun ChipLeadingCheck() {
    Icon(
        imageVector = Icons.Outlined.Check,
        contentDescription = null,
        modifier = Modifier.size(16.dp),
    )
}

/** Card surface (brief section 1): 16dp radius comes from the theme, 1dp outlineVariant border, NO shadow - pairs with `border = CardDefaults.quietCardBorder()`. */
@Composable
fun CardDefaults.quietCardColors(): CardColors = outlinedCardColors()

/** Card border (brief section 1): the single 1dp outlineVariant stroke; never combine it with a shadow on the same surface. */
@Composable
fun CardDefaults.quietCardBorder(): BorderStroke = outlinedCardBorder(enabled = true)

/** Card elevation (brief section 1): flat - borders carry the edge, shadows are for FAB and sheets only. */
@Composable
fun CardDefaults.quietCardElevation(): CardElevation = outlinedCardElevation()

/** Text fields (brief section 1): 12dp radius from the theme's extraSmall slot, outlineVariant unfocused border, primary focused border (M3 draws 1dp/2dp thickness). */
@Composable
fun OutlinedTextFieldDefaults.quietTextFieldColors(): TextFieldColors =
    colors(
        focusedBorderColor = MaterialTheme.colorScheme.primary,
        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
    )

/** Calendar day numbers (brief sections 2 and 6): 15sp/600 tabular figures for the CalendarScreen day strip - not a MaterialTheme role. */
val CalendarNumberStyle =
    TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        fontFeatureSettings = "tnum",
    )
