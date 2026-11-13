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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.icons.Icons
import com.quizradar.app.ui.theme.ChipLeadingCheck
import com.quizradar.app.ui.theme.CoursePalette
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietChipColors
import com.quizradar.app.ui.theme.quietTextFieldColors
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val TYPE_FILTERS = listOf("ALL", "QUIZ", "EXAM", "ASSIGNMENT", "LAB")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchSheet(
    snapshot: AppSnapshotModel,
    sheetState: SheetState,
    onDismiss: () -> Unit,
    onSelectAssessment: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var searchQuery by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf("ALL") }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

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
                    .fillMaxSize()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            // Top Bar: Search Input with Clear & Close Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = {
                        Text(
                            text = "Search quizzes, exams, topics, or courses...",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Outlined.Search,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(
                                    imageVector = Icons.Outlined.Close,
                                    contentDescription = "Clear search",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    modifier =
                        Modifier
                            .weight(1f)
                            .focusRequester(focusRequester),
                )
                Spacer(modifier = Modifier.width(8.dp))
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Close,
                        contentDescription = "Close search",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Filter Chips Row
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                items(TYPE_FILTERS) { filterType ->
                    val isSelected = selectedType == filterType
                    val label =
                        when (filterType) {
                            "ALL" -> "All types"
                            "QUIZ" -> "Quizzes"
                            "EXAM" -> "Exams"
                            "ASSIGNMENT" -> "Assignments"
                            "LAB" -> "Labs"
                            else -> filterType
                        }
                    FilterChip(
                        selected = isSelected,
                        onClick = { selectedType = filterType },
                        label = {
                            Text(
                                text = label,
                                style = MaterialTheme.typography.labelMedium,
                            )
                        },
                        leadingIcon = { if (isSelected) ChipLeadingCheck() },
                        colors = FilterChipDefaults.quietChipColors(),
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Results List Calculation
            val filteredAssessments =
                snapshot.assessments.filter { assessment ->
                    // Type filtering
                    val typeMatches =
                        when (selectedType) {
                            "ALL" -> true
                            "QUIZ" -> assessment.assessmentType.contains("Quiz", ignoreCase = true)
                            "EXAM" ->
                                assessment.assessmentType.contains("Exam", ignoreCase = true) ||
                                    assessment.assessmentType.contains("Midterm", ignoreCase = true) ||
                                    assessment.assessmentType.contains("Final", ignoreCase = true)
                            "ASSIGNMENT" -> assessment.assessmentType.contains("Assignment", ignoreCase = true)
                            "LAB" -> assessment.assessmentType.contains("Lab", ignoreCase = true)
                            else -> true
                        }

                    if (!typeMatches) return@filter false

                    if (searchQuery.isBlank()) return@filter true

                    val query = searchQuery.trim().lowercase()
                    assessment.title.lowercase().contains(query) ||
                        (assessment.courseId?.lowercase()?.contains(query) == true) ||
                        (assessment.courseName?.lowercase()?.contains(query) == true) ||
                        (assessment.room?.lowercase()?.contains(query) == true) ||
                        (assessment.instructor?.lowercase()?.contains(query) == true) ||
                        assessment.topics.any { it.lowercase().contains(query) }
                }

            if (filteredAssessments.isEmpty()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .weight(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Outlined.Search,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.size(48.dp),
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text =
                                if (searchQuery.isBlank()) {
                                    "Type above to search assessments and topics"
                                } else {
                                    "No matching assessments found"
                                },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                Text(
                    text = "${filteredAssessments.size} ${if (filteredAssessments.size == 1) "result" else "results"}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 8.dp),
                )

                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    items(filteredAssessments, key = { it.id }) { assessment ->
                        SearchResultRow(
                            assessment = assessment,
                            onClick = {
                                onSelectAssessment(assessment.id)
                                onDismiss()
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchResultRow(
    assessment: AssessmentModel,
    onClick: () -> Unit,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val courseColor = CoursePalette.get(assessment.courseId).color
    val courseTextColor = CoursePalette.textOnSurface(assessment.courseId, isDark)
    val dateFormatter = remember { DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM) }
    val formattedDate = assessment.dateIso?.let { dateFormatter.format(it) } ?: "—"
    val urgency = urgencyTagStyle(assessment.daysUntil)

    Card(
        onClick = onClick,
        modifier =
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 56.dp),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Course color dot - the same identity mark the timeline row uses.
            Box(
                modifier =
                    Modifier
                        .size(8.dp)
                        .clip(MaterialTheme.shapes.small)
                        .background(courseColor),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = assessment.courseName ?: assessment.courseId ?: "General",
                        style = MaterialTheme.typography.labelMedium,
                        color = courseTextColor,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (urgency != null) {
                        StatusTag(
                            text = urgency.label,
                            containerColor = urgency.container,
                            contentColor = urgency.content,
                            tabular = true,
                        )
                    }
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = assessment.title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = formattedDate,
                        style =
                            MaterialTheme.typography.bodySmall.copy(
                                fontFeatureSettings = "tnum",
                            ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (assessment.topics.isNotEmpty()) {
                        Text(
                            text = " • ${assessment.topics.size} topics",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (!assessment.room.isNullOrBlank()) {
                        Text(
                            text = " • Room ${assessment.room}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
