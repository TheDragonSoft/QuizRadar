package com.quizradar.app.glance

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.quizradar.app.MainActivity
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.QuizRadarJsonParser
import com.quizradar.app.ui.theme.CoursePalette
import org.json.JSONObject

/**
 * Snapshot state for the 2x1 Glance home screen countdown widget.
 */
data class WidgetState(
    val hasNextUp: Boolean,
    val courseCode: String,
    val courseColorHex: String,
    val title: String,
    val dateDisplay: String,
    val badgeText: String?,
    val badgeColorHex: String,
    val room: String,
) {
    fun toJson(): String {
        return JSONObject().apply {
            put("hasNextUp", hasNextUp)
            put("courseCode", courseCode)
            put("courseColorHex", courseColorHex)
            put("title", title)
            put("dateDisplay", dateDisplay)
            put("badgeText", badgeText)
            put("badgeColorHex", badgeColorHex)
            put("room", room)
        }.toString()
    }

    companion object {
        fun empty(): WidgetState =
            WidgetState(
                hasNextUp = false,
                courseCode = "QUIZRADAR",
                courseColorHex = "#1a73e8",
                title = "No upcoming quizzes or exams",
                dateDisplay = "You're all caught up!",
                badgeText = null,
                badgeColorHex = "#1a73e8",
                room = "—",
            )

        fun fromJson(json: String?): WidgetState {
            if (json.isNullOrBlank()) return empty()
            return try {
                val obj = JSONObject(json)
                WidgetState(
                    hasNextUp = obj.optBoolean("hasNextUp", false),
                    courseCode = obj.optString("courseCode", "QUIZRADAR"),
                    courseColorHex = obj.optString("courseColorHex", "#1a73e8"),
                    title = obj.optString("title", "No upcoming quizzes or exams"),
                    dateDisplay = obj.optString("dateDisplay", "You're all caught up!"),
                    badgeText = if (obj.has("badgeText") && !obj.isNull("badgeText")) obj.getString("badgeText") else null,
                    badgeColorHex = obj.optString("badgeColorHex", "#1a73e8"),
                    room = obj.optString("room", "—"),
                )
            } catch (_: Exception) {
                empty()
            }
        }

        fun fromAssessment(
            assessment: AssessmentModel,
            course: CourseModel?,
        ): WidgetState {
            val days = assessment.daysUntil
            val badge =
                when {
                    days == null -> null
                    days < 0 -> "PAST"
                    days == 0 -> "TODAY"
                    days == 1 -> "TOMORROW"
                    else -> "IN $days DAYS"
                }
            val badgeColor =
                when {
                    days == null -> "#1a73e8"
                    days <= 0 -> "#ef4444" // red
                    days == 1 -> "#f59e0b" // amber
                    else -> "#1a73e8" // blue
                }
            val courseColor = CoursePalette.getHex(assessment.courseId)
            val timePart = assessment.displayTime?.let { " · $it" } ?: ""
            val datePart = assessment.dateIso ?: "Undated"

            return WidgetState(
                hasNextUp = true,
                courseCode = assessment.courseId ?: course?.id ?: "EXAM",
                courseColorHex = courseColor,
                title = assessment.title,
                dateDisplay = "$datePart$timePart",
                badgeText = badge,
                badgeColorHex = badgeColor,
                room = assessment.room ?: "—",
            )
        }
    }
}

/**
 * Storage helper for persisting WidgetState to SharedPreferences.
 */
object QuizRadarWidgetStore {
    private const val PREFS_NAME = "quizradar_widget_prefs"
    private const val KEY_WIDGET_STATE = "widget_state_json"

    fun load(context: Context): WidgetState {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return WidgetState.fromJson(prefs.getString(KEY_WIDGET_STATE, null))
    }

    fun save(
        context: Context,
        state: WidgetState,
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_WIDGET_STATE, state.toJson()).apply()
    }
}

/**
 * 2x1 Glance AppWidget displaying countdown to the next exam/quiz.
 */
class QuizRadarWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val state = QuizRadarWidgetStore.load(context)

        provideContent {
            val bgDark = Color(0xFF0B0F19)
            val textWhite = Color(0xFFFFFFFF)
            val textSlate = Color(0xFF94A3B8)
            val accentBlue = Color(0xFF1A73E8)

            val launchIntent =
                android.content.Intent(context, MainActivity::class.java).apply {
                    flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
                }

            Box(
                modifier =
                    GlanceModifier
                        .fillMaxSize()
                        .background(bgDark)
                        .padding(10.dp)
                        .clickable(actionStartActivity(launchIntent)),
                contentAlignment = Alignment.TopStart,
            ) {
                if (!state.hasNextUp) {
                    Column(
                        modifier = GlanceModifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "QuizRadar",
                            style =
                                TextStyle(
                                    color = ColorProvider(accentBlue),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                        )
                        Spacer(modifier = GlanceModifier.height(4.dp))
                        Text(
                            text = state.title,
                            style =
                                TextStyle(
                                    color = ColorProvider(textWhite),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                            maxLines = 1,
                        )
                        Spacer(modifier = GlanceModifier.height(2.dp))
                        Text(
                            text = state.dateDisplay,
                            style =
                                TextStyle(
                                    color = ColorProvider(textSlate),
                                    fontSize = 11.sp,
                                ),
                            maxLines = 1,
                        )
                    }
                } else {
                    val courseColor =
                        try {
                            Color(android.graphics.Color.parseColor(state.courseColorHex))
                        } catch (_: Exception) {
                            accentBlue
                        }
                    val badgeColor =
                        try {
                            Color(android.graphics.Color.parseColor(state.badgeColorHex))
                        } catch (_: Exception) {
                            accentBlue
                        }

                    Column(
                        modifier = GlanceModifier.fillMaxSize(),
                    ) {
                        // Header Row: Course tag + Urgency badge
                        Row(
                            modifier = GlanceModifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = state.courseCode,
                                style =
                                    TextStyle(
                                        color = ColorProvider(courseColor),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                    ),
                            )
                            Spacer(modifier = GlanceModifier.defaultWeight())
                            if (state.badgeText != null) {
                                Text(
                                    text = state.badgeText,
                                    style =
                                        TextStyle(
                                            color = ColorProvider(badgeColor),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                        ),
                                )
                            }
                        }

                        Spacer(modifier = GlanceModifier.height(4.dp))

                        // Title
                        Text(
                            text = state.title,
                            style =
                                TextStyle(
                                    color = ColorProvider(textWhite),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                            maxLines = 2,
                        )

                        Spacer(modifier = GlanceModifier.defaultWeight())

                        // Footer: Date + Room
                        Row(
                            modifier = GlanceModifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = state.dateDisplay,
                                style =
                                    TextStyle(
                                        color = ColorProvider(textSlate),
                                        fontSize = 10.sp,
                                    ),
                                maxLines = 1,
                            )
                            if (state.room != "—") {
                                Spacer(modifier = GlanceModifier.width(6.dp))
                                Text(
                                    text = "· ${state.room}",
                                    style =
                                        TextStyle(
                                            color = ColorProvider(textSlate),
                                            fontSize = 10.sp,
                                        ),
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    companion object {
        suspend fun updateWidget(
            context: Context,
            state: WidgetState,
        ) {
            QuizRadarWidgetStore.save(context, state)
            QuizRadarWidget().updateAll(context)
        }

        suspend fun refreshFromEngine(
            context: Context,
            engine: QuizRadarEngine,
        ) {
            try {
                val stateJson = engine.getState()
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(stateJson)
                val nextUp = snapshot.dashboard.nextUp
                val widgetState =
                    if (nextUp != null) {
                        val course = snapshot.schedule.courses.find { it.id == nextUp.courseId }
                        WidgetState.fromAssessment(nextUp, course)
                    } else {
                        WidgetState.empty()
                    }
                updateWidget(context, widgetState)
            } catch (_: Exception) {
                // Keep existing widget state if load fails
            }
        }
    }
}
