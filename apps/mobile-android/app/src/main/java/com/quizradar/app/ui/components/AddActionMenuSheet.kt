package com.quizradar.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.CustomEventPink
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddActionMenuSheet(
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onNewAssessment: () -> Unit = {},
    onNewCustomEvent: () -> Unit,
    onNewCourse: () -> Unit = {},
    onImportBackup: () -> Unit,
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
                    .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            Text(
                text = "Add to QuizRadar",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(modifier = Modifier.height(16.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.medium,
                colors = CardDefaults.quietCardColors(),
                elevation = CardDefaults.quietCardElevation(),
                border = CardDefaults.quietCardBorder(),
            ) {
                Column {
                    ListItem(
                        headlineContent = {
                            Text(
                                text = "New Assessment",
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                        supportingContent = {
                            Text(
                                text = "Type in a quiz, exam or assignment the teacher announced",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Quiz,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp),
                            )
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier =
                            Modifier.clickable(role = Role.Button) {
                                onDismiss()
                                onNewAssessment()
                            },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    ListItem(
                        headlineContent = {
                            Text(
                                text = "New Study or Custom Event",
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                        supportingContent = {
                            Text(
                                text = "Schedule a personal study session or reminder",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Event,
                                contentDescription = null,
                                tint = CustomEventPink,
                                modifier = Modifier.size(24.dp),
                            )
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier =
                            Modifier.clickable(role = Role.Button) {
                                onDismiss()
                                onNewCustomEvent()
                            },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    ListItem(
                        headlineContent = {
                            Text(
                                text = "Enrolled Course & Slots",
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                        supportingContent = {
                            Text(
                                text = "Add a new course and recurring weekly class times",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.School,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp),
                            )
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier =
                            Modifier.clickable(role = Role.Button) {
                                onDismiss()
                                onNewCourse()
                            },
                    )

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                    ListItem(
                        headlineContent = {
                            Text(
                                text = "Import Backup File",
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                        supportingContent = {
                            Text(
                                text = "Restore courses and assessments from JSON",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.UploadFile,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp),
                            )
                        },
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier =
                            Modifier.clickable(role = Role.Button) {
                                onDismiss()
                                onImportBackup()
                            },
                    )
                }
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
