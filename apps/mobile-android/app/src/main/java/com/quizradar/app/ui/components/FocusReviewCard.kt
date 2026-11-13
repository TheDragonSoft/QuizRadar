package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.quizradar.app.ui.theme.PillButtonContentPadding
import com.quizradar.app.ui.theme.PillButtonMinHeight
import com.quizradar.app.ui.theme.StatusColors
import com.quizradar.app.ui.theme.filledPill
import com.quizradar.app.ui.theme.quietCardBorder
import com.quizradar.app.ui.theme.quietCardColors
import com.quizradar.app.ui.theme.quietCardElevation
import com.quizradar.app.ui.theme.quietTextFieldColors
import com.quizradar.app.ui.theme.tonalPill
import org.json.JSONArray
import org.json.JSONObject

/**
 * One stored flashcard (`core/src/types.rs`: `Flashcard`).
 *
 * The box level and the next review date are the core's Leitner state - the
 * shell only reads them.
 */
private data class FocusFlashcard(
    val id: String,
    val topic: String?,
    val front: String,
    val back: String,
    val boxLevel: Int,
    val nextReviewIso: String?,
)

/**
 * Parses the stored deck. A malformed payload yields an EMPTY deck instead
 * of a crash or an invented card.
 */
private fun parseFocusFlashcards(json: String): List<FocusFlashcard> =
    runCatching {
        val array = JSONArray(json)
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val id = item.optString("id")
            if (id.isBlank()) return@mapNotNull null
            FocusFlashcard(
                id = id,
                // `optString` renders a JSON null as the literal string
                // "null" - guard with isNull so absent fields stay absent.
                topic =
                    item.optString("topic").takeIf {
                        it.isNotBlank() && !item.isNull("topic")
                    },
                front = item.optString("front"),
                back = item.optString("back"),
                boxLevel = item.optInt("box_level", 1),
                nextReviewIso =
                    item.optString("next_review_iso").takeIf {
                        it.isNotBlank() && !item.isNull("next_review_iso")
                    },
            )
        }
    }.getOrDefault(emptyList())

/**
 * The flashcard deck review.
 *
 * The deck IS the store's deck: every card shown was saved on this device,
 * and the review result (known / missed) is written back through the core's
 * review operation. With an empty deck the card says so instead of showing
 * a made-up card.
 */
@Composable
fun FocusReviewCard(
    flashcardsJson: String,
    onReview: (cardId: String, correct: Boolean, onResult: (Boolean) -> Unit) -> Unit,
    onCreate: (cardJson: String, onResult: (Boolean) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cards = remember(flashcardsJson) { parseFocusFlashcards(flashcardsJson) }
    var revealedCardId by rememberSaveable { mutableStateOf<String?>(null) }
    var showForm by rememberSaveable { mutableStateOf(false) }
    var frontDraft by rememberSaveable { mutableStateOf("") }
    var backDraft by rememberSaveable { mutableStateOf("") }
    var createError by rememberSaveable { mutableStateOf<String?>(null) }
    var reviewError by rememberSaveable { mutableStateOf<String?>(null) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(
            modifier =
                Modifier
                    .padding(16.dp)
                    .imePadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Flashcards (${cards.size})",
                    style =
                        MaterialTheme.typography.titleMedium.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                FilledTonalButton(
                    onClick = {
                        showForm = !showForm
                        createError = null
                    },
                    colors = ButtonDefaults.tonalPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text(
                        text = if (showForm) "Cancel" else "New card",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }

            if (showForm) {
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = frontDraft,
                    onValueChange = { frontDraft = it },
                    label = { Text("Front (the question)") },
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = backDraft,
                    onValueChange = { backDraft = it },
                    label = { Text("Back (the answer)") },
                    colors = OutlinedTextFieldDefaults.quietTextFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (createError != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = createError ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = {
                        val front = frontDraft.trim()
                        val back = backDraft.trim()
                        if (front.isBlank() || back.isBlank()) {
                            createError = "Both sides of the card need text before it can be saved."
                        } else {
                            createError = null
                            val cardJson =
                                JSONObject().apply {
                                    put("id", "fc-" + java.util.UUID.randomUUID().toString())
                                    put("front", front)
                                    put("back", back)
                                }.toString()
                            onCreate(cardJson) { saved ->
                                if (saved) {
                                    frontDraft = ""
                                    backDraft = ""
                                    showForm = false
                                    createError = null
                                } else {
                                    createError =
                                        "The card could not be saved to the store - " +
                                        "nothing was changed. Try again."
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.filledPill(),
                    contentPadding = PillButtonContentPadding,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = PillButtonMinHeight),
                ) {
                    Text("Save card", style = MaterialTheme.typography.labelMedium)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            if (cards.isEmpty()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(MaterialTheme.shapes.extraSmall)
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(16.dp),
                ) {
                    Text(
                        text =
                            "No flashcards yet. Add one with \"New card\" and it is stored on " +
                                "this device, ready to review here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                if (reviewError != null) {
                    Text(
                        text = reviewError ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }
                cards.forEach { card ->
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp)
                                .clip(MaterialTheme.shapes.extraSmall)
                                .background(MaterialTheme.colorScheme.surfaceVariant)
                                .padding(16.dp),
                    ) {
                        Text(
                            text = card.topic ?: "General",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = card.front,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        if (revealedCardId == card.id) {
                            Text(
                                text = card.back,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = {
                                        reviewError = null
                                        onReview(card.id, true) { saved ->
                                            if (!saved) {
                                                reviewError =
                                                    "The review could not be saved to the store - " +
                                                    "the card was not moved. Try again."
                                            }
                                        }
                                    },
                                    colors = ButtonDefaults.filledPill(),
                                    contentPadding = PillButtonContentPadding,
                                    modifier =
                                        Modifier
                                            .weight(1f)
                                            .defaultMinSize(minHeight = PillButtonMinHeight),
                                ) {
                                    Text(
                                        text = "I knew it",
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                }
                                FilledTonalButton(
                                    onClick = {
                                        reviewError = null
                                        onReview(card.id, false) { saved ->
                                            if (!saved) {
                                                reviewError =
                                                    "The review could not be saved to the store - " +
                                                    "the card was not moved. Try again."
                                            }
                                        }
                                    },
                                    colors = ButtonDefaults.tonalPill(),
                                    contentPadding = PillButtonContentPadding,
                                    modifier =
                                        Modifier
                                            .weight(1f)
                                            .defaultMinSize(minHeight = PillButtonMinHeight),
                                ) {
                                    Text(
                                        text = "Missed",
                                        style = MaterialTheme.typography.labelMedium,
                                    )
                                }
                            }
                        } else {
                            FilledTonalButton(
                                onClick = { revealedCardId = card.id },
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text(
                                    text = "Show answer",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text =
                                buildString {
                                    append("Box ${card.boxLevel}")
                                    card.nextReviewIso?.let { append(" · next review ").append(it) }
                                },
                            style =
                                MaterialTheme.typography.labelMedium.copy(
                                    fontFeatureSettings = "tnum",
                                ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/**
 * One stored mistake (`core/src/types.rs`: `MistakeRecord`).
 */
private data class FocusMistake(
    val id: String,
    val questionText: String,
    val options: List<String>,
    val selectedIndex: Int,
    val correctIndex: Int,
    val explanation: String,
    val timestamp: String,
    val resolved: Boolean,
)

/**
 * Parses the stored mistake bank. A malformed payload yields an EMPTY bank
 * instead of a crash or an invented mistake.
 */
private fun parseFocusMistakes(json: String): List<FocusMistake> =
    runCatching {
        val array = JSONArray(json)
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val id = item.optString("id")
            if (id.isBlank()) return@mapNotNull null
            val optionsJson = item.optJSONArray("options")
            val options =
                (0 until (optionsJson?.length() ?: 0)).mapNotNull { optionIndex ->
                    optionsJson?.optString(optionIndex)?.takeIf { it.isNotBlank() }
                }
            FocusMistake(
                id = id,
                questionText = item.optString("question_text"),
                options = options,
                selectedIndex = item.optInt("selected_index", 0),
                correctIndex = item.optInt("correct_index", 0),
                explanation = item.optString("explanation"),
                timestamp = item.optString("timestamp"),
                resolved = item.optBoolean("resolved", false),
            )
        }
    }.getOrDefault(emptyList())

/**
 * The mistake bank.
 *
 * Every row is a mistake the student really made (saved from a practice
 * attempt). Resolving a row writes back to the store; a failed write says
 * so instead of quietly marking the row as handled.
 */
@Composable
fun FocusMistakeBankCard(
    mistakesJson: String,
    onResolve: (mistakeId: String, onResult: (Boolean) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = isSystemInDarkTheme()
    val mistakes = remember(mistakesJson) { parseFocusMistakes(mistakesJson) }
    var resolveError by rememberSaveable { mutableStateOf<String?>(null) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.quietCardColors(),
        elevation = CardDefaults.quietCardElevation(),
        border = CardDefaults.quietCardBorder(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Mistake bank (${mistakes.size})",
                style =
                    MaterialTheme.typography.titleMedium.copy(
                        fontFeatureSettings = "tnum",
                    ),
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(12.dp))

            if (mistakes.isEmpty()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(MaterialTheme.shapes.extraSmall)
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(16.dp),
                ) {
                    Text(
                        text =
                            "No mistakes recorded yet. Wrong answers from a saved practice " +
                                "attempt land here so you can review them.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                if (resolveError != null) {
                    Text(
                        text = resolveError ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }
                mistakes.forEach { mistake ->
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp)
                                .clip(MaterialTheme.shapes.extraSmall)
                                .background(MaterialTheme.colorScheme.surfaceVariant)
                                .padding(16.dp),
                    ) {
                        Text(
                            text = mistake.questionText,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Your answer: ${focusOptionLabel(mistake.options, mistake.selectedIndex)}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                        Text(
                            text = "Correct: ${focusOptionLabel(mistake.options, mistake.correctIndex)}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = StatusColors.success(isDark),
                        )
                        if (mistake.explanation.isNotBlank()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Why: ${mistake.explanation}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (mistake.timestamp.isNotBlank()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = mistake.timestamp.substringBefore('T'),
                                style =
                                    MaterialTheme.typography.labelMedium.copy(
                                        fontFeatureSettings = "tnum",
                                    ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(modifier = Modifier.height(12.dp))
                        if (mistake.resolved) {
                            StatusTag(
                                text = "Resolved",
                                containerColor = StatusColors.successContainer(isDark),
                                contentColor = StatusColors.onSuccessContainer(isDark),
                            )
                        } else {
                            FilledTonalButton(
                                onClick = {
                                    resolveError = null
                                    onResolve(mistake.id) { resolved ->
                                        if (!resolved) {
                                            resolveError =
                                                "The mistake could not be marked resolved in the " +
                                                "store - it is still open. Try again."
                                        }
                                    }
                                },
                                colors = ButtonDefaults.tonalPill(),
                                contentPadding = PillButtonContentPadding,
                                modifier = Modifier.defaultMinSize(minHeight = PillButtonMinHeight),
                            ) {
                                Text(
                                    text = "Mark resolved",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The stored option text for one index. When the store has no text for the
 * index the position is named - the answer itself is never invented.
 */
private fun focusOptionLabel(
    options: List<String>,
    index: Int,
): String = options.getOrNull(index) ?: "Option ${index + 1}"
