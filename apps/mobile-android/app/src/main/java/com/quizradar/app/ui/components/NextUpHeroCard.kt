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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.ui.formatIsoDateForDisplay
import com.quizradar.app.ui.icons.Icons

private data class HeroPalette(
    val gradient: Brush,
    val border: Color,
)

private fun heroPalette(isDark: Boolean): HeroPalette =
    if (isDark) {
        HeroPalette(
            gradient =
                Brush.horizontalGradient(
                    listOf(Color(0xFF0F172A), Color(0xFF172554), Color(0xFF1E1B4B)),
                ),
            border = Color(0xFF1E40AF).copy(alpha = 0.50f),
        )
    } else {
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
    val palette = heroPalette(isDark)
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(palette.gradient)
                .border(1.dp, palette.border, RoundedCornerShape(20.dp))
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

        if (assessment == null) {
            Column(modifier = Modifier.padding(18.dp)) {
                Text(
                    text = "No Upcoming Assessments Scheduled",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Connect an account or add a course — your radar fills in as announcements land.",
                    fontSize = 12.sp,
                    color = Color(0xFFBFDBFE),
                    lineHeight = 17.sp,
                )
            }
            return@Box
        }

        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (countdownLabel(assessment.daysUntil).isNotEmpty()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier =
                            Modifier
                                .background(Color(0xFFFBBF24), RoundedCornerShape(999.dp))
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.SquareFoot,
                            contentDescription = null,
                            tint = Color(0xFF020617),
                            modifier = Modifier.size(11.dp),
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Up next · ${countdownLabel(assessment.daysUntil)}",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF020617),
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
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White.copy(alpha = 0.85f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = assessment.title,
                fontSize = 21.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 26.sp,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Filled.CalendarMonth,
                    contentDescription = null,
                    tint = Color(0xFFBFDBFE),
                    modifier = Modifier.size(13.dp),
                )
                Spacer(modifier = Modifier.width(5.dp))
                Text(
                    text =
                        assessment.displayTime
                            // Never print the raw storage date; an ISO string
                            // in the hero reads like a database dump.
                            ?: formatIsoDateForDisplay(assessment.dateIso?.toString())
                            ?: "Date not confirmed",
                    fontSize = 12.sp,
                    color = Color(0xFFBFDBFE),
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
                        tint = Color(0xFFBFDBFE),
                        modifier = Modifier.size(13.dp),
                    )
                    Spacer(modifier = Modifier.width(5.dp))
                    Text(
                        text = assessment.room,
                        fontSize = 12.sp,
                        color = Color(0xFFBFDBFE),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
            }
        }
    }
}
