package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.tonalPill

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSheet(
    isGoogleConnected: Boolean,
    isMicrosoftConnected: Boolean,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onStartGoogleLogin: () -> Unit,
    onDisconnectGoogle: () -> Unit,
    onStartMicrosoftLogin: () -> Unit,
    onDisconnectMicrosoft: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenHelp: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    // The "connected" green needs a dark-theme variant: the light one
    // measured 3.2:1 on the dark sheet surface - below the 4.5:1 that text
    // needs.
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val connectedColor = StatusColors.success(isDark)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = modifier.padding(top = statusBarPadding),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header: Profile Avatar + Title. The sheet is dismissed by
            // dragging it down (the sheet's own drag handle), so the close
            // button and the "Local-first" subtitle were redundant chrome.
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier =
                        Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.AccountCircle,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(32.dp),
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = "Student Profile",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // A07: the privacy claim states exactly what is true - local
            // storage, encrypted tokens, and ONLY the optional flows the
            // user turns on sending what those features send. The old
            // "No personal data crosses external servers" was false the
            // moment AI or Drive backup is enabled.
            Surface(
                shape = MaterialTheme.shapes.extraSmall,
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text =
                            "Your schedule, radar and grades stay in this app's private storage on this phone, " +
                                "and sign-in tokens are encrypted with the Android Keystore. " +
                                "Nothing is sent anywhere unless you turn on an optional feature that needs it: " +
                                "AI features send what you ask Gemini, and Drive backup sends a data-only copy to your own Drive.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Connected Sources",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(8.dp))

            // Google Account Card
            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f),
                    ) {
                        Box(
                            modifier =
                                Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primaryContainer),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Email,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Google Services",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = if (isGoogleConnected) "Gmail & Classroom active" else "Not connected",
                                style = MaterialTheme.typography.bodySmall,
                                color =
                                    if (isGoogleConnected) {
                                        connectedColor
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                        }
                    }

                    if (isGoogleConnected) {
                        Button(
                            onClick = onDisconnectGoogle,
                            colors = ButtonDefaults.tonalPill(),
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            contentPadding = PillButtonContentPadding,
                        ) {
                            Text("Disconnect")
                        }
                    } else {
                        Button(
                            onClick = onStartGoogleLogin,
                            colors = ButtonDefaults.filledPill(),
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            contentPadding = PillButtonContentPadding,
                        ) {
                            Text("Sign In")
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Microsoft Account Card
            Card(
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                border = CardDefaults.quietCardBorder(),
                elevation = CardDefaults.quietCardElevation(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f),
                    ) {
                        Box(
                            modifier =
                                Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.secondaryContainer),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Groups,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Microsoft Teams",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = if (isMicrosoftConnected) "Teams Graph active" else "Not connected",
                                style = MaterialTheme.typography.bodySmall,
                                color =
                                    if (isMicrosoftConnected) {
                                        connectedColor
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                        }
                    }

                    if (isMicrosoftConnected) {
                        Button(
                            onClick = onDisconnectMicrosoft,
                            colors = ButtonDefaults.tonalPill(),
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            contentPadding = PillButtonContentPadding,
                        ) {
                            Text("Disconnect")
                        }
                    } else {
                        Button(
                            onClick = onStartMicrosoftLogin,
                            colors = ButtonDefaults.filledPill(),
                            modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            contentPadding = PillButtonContentPadding,
                        ) {
                            Text("Sign In")
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = {
                        onOpenHelp()
                        onDismiss()
                    },
                    colors = ButtonDefaults.tonalPill(),
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Info,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Help & FAQ")
                }
                Button(
                    onClick = {
                        onOpenSettings()
                        onDismiss()
                    },
                    colors = ButtonDefaults.tonalPill(),
                    modifier =
                        Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                    contentPadding = PillButtonContentPadding,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Settings,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Settings")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
