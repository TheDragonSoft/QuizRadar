package com.quizradar.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.QuizRadarViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop

/**
 * The bring-your-own OAuth client id editors (Settings -> Sources and the
 * onboarding connections step share this).
 *
 * The ids AUTO-SAVE ~600 ms after the last keystroke. The original explicit
 * "Save Client IDs" button sat at the bottom of a long settings scroll: an
 * id that was typed but never saved looked exactly like "the app has no
 * client id" after a restart, which is the failure this replaces. Editors
 * reload from the saved state only while they are not focused, so a refresh
 * (a scan finishing, a reconnect) can never clobber in-progress typing.
 */
@OptIn(FlowPreview::class)
@Composable
fun OAuthClientIdFields(
    viewModel: QuizRadarViewModel,
    modifier: Modifier = Modifier,
) {
    val googleClientId by viewModel.googleClientId.collectAsState()
    val teamsClientId by viewModel.teamsClientId.collectAsState()

    var googleFocused by remember { mutableStateOf(false) }
    var microsoftFocused by remember { mutableStateOf(false) }
    var googleInput by remember { mutableStateOf(googleClientId) }
    var microsoftInput by remember { mutableStateOf(teamsClientId) }

    LaunchedEffect(googleClientId) {
        if (!googleFocused) googleInput = googleClientId
    }
    LaunchedEffect(teamsClientId) {
        if (!microsoftFocused) microsoftInput = teamsClientId
    }

    LaunchedEffect(Unit) {
        snapshotFlow { googleInput }
            .drop(1)
            .debounce(600)
            .collectLatest {
                if (it.trim() != googleClientId) viewModel.setGoogleClientId(it)
            }
    }
    LaunchedEffect(Unit) {
        snapshotFlow { microsoftInput }
            .drop(1)
            .debounce(600)
            .collectLatest {
                if (it.trim() != teamsClientId) viewModel.setTeamsClientId(it)
            }
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "OAuth client IDs (bring your own)",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text =
                "Google sign-in ships with a built-in QuizRadar client id — paste your own to " +
                    "override it. Microsoft needs YOUR Azure app id: register one with the redirect " +
                    "com.quizradar.app://oauth/microsoft. Both fields save automatically as you type.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = googleInput,
            onValueChange = { googleInput = it },
            label = { Text("Google client ID") },
            singleLine = true,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .onFocusChanged { googleFocused = it.hasFocus },
            supportingText = {
                Text(
                    when {
                        googleInput.trim() != googleClientId -> "Saving automatically…"
                        googleClientId.isNotBlank() -> "Saved ✓ - Google sign-in will use this id"
                        else -> "Not set - the built-in QuizRadar client id will be used"
                    },
                )
            },
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = microsoftInput,
            onValueChange = { microsoftInput = it },
            label = { Text("Microsoft (Azure) client ID") },
            singleLine = true,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .onFocusChanged { microsoftFocused = it.hasFocus },
            supportingText = {
                Text(
                    when {
                        microsoftInput.trim() != teamsClientId -> "Saving automatically…"
                        teamsClientId.isNotBlank() -> "Saved ✓ - Microsoft sign-in will use this id"
                        else -> "Not set - Microsoft sign-in is refused until one is saved"
                    },
                )
            },
        )
        Spacer(modifier = Modifier.height(8.dp))

        // The explicit save stays as an option next to the auto-save: some
        // users want the certainty of pressing a button, and the label doubles
        // as the saved/unsaved indicator for both fields.
        val unsavedChanges =
            googleInput.trim() != googleClientId || microsoftInput.trim() != teamsClientId
        OutlinedButton(
            onClick = {
                viewModel.setGoogleClientId(googleInput)
                viewModel.setTeamsClientId(microsoftInput)
                viewModel.showToast("OAuth client IDs saved")
            },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
        ) {
            Text(if (unsavedChanges) "Save now" else "Saved ✓")
        }
    }
}
