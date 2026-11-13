package com.quizradar.app.ui.components

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation

private data class FaqItem(val question: String, val answer: String)

private val FAQS =
    listOf(
        FaqItem(
            question = "Where are my credentials and tokens stored?",
            answer =
                "On Android, your tokens reside in EncryptedSharedPreferences backed by Android Keystore. " +
                    "On Desktop, they live in your OS Keyring. Tokens never leave your hardware and never cross a network.",
        ),
        FaqItem(
            question = "Does QuizRadar communicate with a central cloud server?",
            answer =
                "No. QuizRadar is entirely zero-server. All parsers, timetable conflict algorithms, and calendar computations " +
                    "run locally inside the Rust core. There are no user accounts, no tracking, and no telemetry.",
        ),
        FaqItem(
            question = "How does the AI assistant extract announcements without compromising privacy?",
            answer =
                "QuizRadar uses BYOK (Bring Your Own Key) directly with Google Gemini. HTTPS requests travel straight from " +
                    "your phone to Google's API with your personal key. Your key is stored securely on device.",
        ),
        FaqItem(
            question = "Can I export my exam dates to Google Calendar or Outlook?",
            answer =
                "Yes. You can push dated assessments to Google Calendar or export standard universal .ics calendar files from " +
                    "any assessment detail screen.",
        ),
    )

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpSheet(
    sheetState: SheetState,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val statusBarPadding = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()

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
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                QuizRadarLogo(modifier = Modifier.size(32.dp))
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(
                        text = "QuizRadar Help & FAQ",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "Zero-server, local-first intelligence engine",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(modifier = Modifier.height(16.dp))

            // FAQ Items
            FAQS.forEach { faq ->
                var expanded by remember { mutableStateOf(false) }
                Card(
                    onClick = { expanded = !expanded },
                    shape = MaterialTheme.shapes.medium,
                    colors = CardDefaults.quietCardColors().copy(containerColor = MaterialTheme.colorScheme.surface),
                    border = CardDefaults.quietCardBorder(),
                    elevation = CardDefaults.quietCardElevation(),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                ) {
                    // The state description merges up into the card's clickable
                    // node: TalkBack announces Expanded/Collapsed, not just the
                    // question (the chevron icon itself is decorative).
                    Column(
                        modifier =
                            Modifier
                                .padding(16.dp)
                                .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = faq.question,
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(
                                imageVector = if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                        if (expanded) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = faq.answer,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.filledPill(),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = PillButtonMinHeight),
                contentPadding = PillButtonContentPadding,
            ) {
                Text("Got it")
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
