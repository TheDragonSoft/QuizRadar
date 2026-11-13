package com.quizradar.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.formatIsoDateForDisplay
import com.quizradar.app.ui.icons.Icons

/**
 * The starfield hero is a locked motif (docs/ANDROID-DESIGN-SYSTEM.md: the
 * brand palette is LOCKED, and the NextUp starfield hero is part of it), so
 * the gradients and the amber countdown badge keep their own values. They
 * are named here so the hero reads as one deliberate palette instead of a
 * scatter of hex literals - every other surface in the app is drawn from the
 * theme roles.
 */
private data class HeroPalette(
    val gradient: Brush,
    val border: Color,
)

/** The amber "up next" badge - the one accent the hero owns. */
private object CountdownBadge {
    val container = Color(0xFFFBBF24)
    val content = Color(0xFF020617)
}

private fun heroPalette(
    isDark: Boolean,
    isAmoled: Boolean = false,
): HeroPalette =
    when {
        isAmoled ->
            HeroPalette(
                gradient =
                    Brush.horizontalGradient(
                        listOf(Color(0xFF0B0D13), Color(0xFF10131C), Color(0xFF171B26)),
                    ),
                border = Color(0xFF282D3D),
            )
        isDark ->
            HeroPalette(
                gradient =
                    Brush.horizontalGradient(
                        listOf(Color(0xFF0F172A), Color(0xFF172554), Color(0xFF1E1B4B)),
                    ),
                border = Color(0xFF1E40AF).copy(alpha = 0.50f),
            )
        else ->
            HeroPalette(
                gradient =
                    Brush.horizontalGradient(
                        listOf(Color(0xFF1E3A8A), Color(0xFF1E40AF), Color(0xFF1D4ED8)),
                    ),
                border = Color(0xFF1D4ED8).copy(alpha = 0.30f),
            )
    }

private fun countdownLabel(daysUntil: Int?): String =
    when {
        daysUntil == null -> ""
        daysUntil == 0 -> "Today"
        daysUntil == 1 -> "Tomorrow"
        daysUntil > 1 -> "In $daysUntil days"
        else -> ""
    }

/**
 * The desktop dashboard's "Next Up" hero, ported to mobile: the exam-radar
 * gradient card with the starfield/sun sky, the amber countdown badge, the
 * course chip and the date/room facts. Tap opens the assessment detail.
 */
@Composable
fun NextUpHeroCard(
    assessment: AssessmentModel?,
    isDark: Boolean,
    onOpen: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val isAmoled = isDark && MaterialTheme.colorScheme.background == Color.Black
    val palette = heroPalette(isDark, isAmoled)
    val heroShape = MaterialTheme.shapes.medium
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(heroShape)
                .background(palette.gradient)
                .border(1.dp, palette.border, heroShape)
                .then(
                    if (assessment != null && onOpen != null) {
                        Modifier.clickable(onClick = onOpen)
                    } else {
                        Modifier
                    },
                ),
    ) {
        // The sky is a match-parent layer BEHIND the content, so the sheen
        // sweep covers the whole banner. The card's padding used to live on
        // the Box itself, which shrank this canvas to the inner content
        // rectangle - the glimmer was clipped to a smaller box floating
        // inside the banner.
        HeroSky(dark = isDark, modifier = Modifier.matchParentSize())

        val heroSubtitleColor = if (isAmoled) Color(0xFFCBD5E1) else Color(0xFFBFDBFE)

        if (assessment == null) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "No Upcoming Assessments Scheduled",
                    style = MaterialTheme.typography.titleMedium,
                    color = Color.White,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Connect an account or add a course — your radar fills in as announcements land.",
                    style = MaterialTheme.typography.bodySmall,
                    color = heroSubtitleColor,
                )
            }
            return@Box
        }

        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val countdown = countdownLabel(assessment.daysUntil)
                if (countdown.isNotEmpty()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier =
                            Modifier
                                .clip(CircleShape)
                                .background(CountdownBadge.container)
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Timer,
                            contentDescription = null,
                            tint = CountdownBadge.content,
                            modifier = Modifier.size(12.dp),
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Up next · $countdown",
                            style = MaterialTheme.typography.labelMedium,
                            color = CountdownBadge.content,
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(
                    text =
                        listOfNotNull(
                            assessment.courseName ?: assessment.courseId,
                            assessment.assessmentType.takeIf { it.isNotBlank() },
                        ).joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White.copy(alpha = 0.85f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = assessment.title,
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Filled.CalendarMonth,
                    contentDescription = null,
                    tint = heroSubtitleColor,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text =
                        assessment.displayTime
                            // Never print the raw storage date; an ISO string
                            // in the hero reads like a database dump.
                            ?: formatIsoDateForDisplay(assessment.dateIso?.toString())
                            ?: "Date not confirmed",
                    style =
                        MaterialTheme.typography.bodySmall.copy(
                            fontFeatureSettings = "tnum",
                        ),
                    color = heroSubtitleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }

            // The room gets its own line: the date string is long, and
            // squeezing both into one row truncated the room to "B…".
            if (!assessment.room.isNullOrBlank() && assessment.room != "—") {
                Spacer(modifier = Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Filled.Place,
                        contentDescription = null,
                        tint = heroSubtitleColor,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = assessment.room,
                        style = MaterialTheme.typography.bodySmall,
                        color = heroSubtitleColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
            }
        }
    }
}
