package com.quizradar.app.glance

import android.content.Context
import android.content.Intent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
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
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.QuizRadarJsonParser
import com.quizradar.app.ui.calendar.WeekParityHelper
import com.quizradar.app.ui.theme.CoursePalette
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Slot item representation for Glance today's schedule widget.
 */
data class TodaySlotItem(
    val courseCode: String,
    val courseName: String,
    val timeDisplay: String,
    val room: String,
    val type: String,
    val colorHex: String,
) {
    fun toJson(): JSONObject =
        JSONObject().apply {
            put("courseCode", courseCode)
            put("courseName", courseName)
            put("timeDisplay", timeDisplay)
            put("room", room)
            put("type", type)
            put("colorHex", colorHex)
        }

    companion object {
        fun fromJson(obj: JSONObject): TodaySlotItem =
            TodaySlotItem(
                courseCode = obj.optString("courseCode", ""),
                courseName = obj.optString("courseName", ""),
                timeDisplay = obj.optString("timeDisplay", ""),
                room = obj.optString("room", "—"),
                type = obj.optString("type", "Lecture"),
                colorHex = obj.optString("colorHex", "#1a73e8"),
            )
    }
}

/**
 * State snapshot for the 4x2 Today's Schedule widget.
 */
data class TodayScheduleWidgetState(
    val todayHeader: String,
    val classCount: Int,
    val studyBlockCount: Int,
    val slots: List<TodaySlotItem>,
    val nextExamBanner: String?,
    val nextExamBadge: String?,
    val nextExamBadgeColor: String?,
) {
    fun toJson(): String {
        return JSONObject().apply {
            put("todayHeader", todayHeader)
            put("classCount", classCount)
            put("studyBlockCount", studyBlockCount)
            put("nextExamBanner", nextExamBanner)
            put("nextExamBadge", nextExamBadge)
            put("nextExamBadgeColor", nextExamBadgeColor)
            val arr = JSONArray()
            slots.forEach { arr.put(it.toJson()) }
            put("slots", arr)
        }.toString()
    }

    companion object {
        fun empty(): TodayScheduleWidgetState =
            TodayScheduleWidgetState(
                todayHeader = LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMM d")),
                classCount = 0,
                studyBlockCount = 0,
                slots = emptyList(),
                nextExamBanner = null,
                nextExamBadge = null,
                nextExamBadgeColor = null,
            )

        fun fromJson(json: String?): TodayScheduleWidgetState {
            if (json.isNullOrBlank()) return empty()
            return try {
                val obj = JSONObject(json)
                val slotsList = mutableListOf<TodaySlotItem>()
                val arr = obj.optJSONArray("slots")
                if (arr != null) {
                    for (i in 0 until arr.length()) {
                        slotsList.add(TodaySlotItem.fromJson(arr.getJSONObject(i)))
                    }
                }
                TodayScheduleWidgetState(
                    todayHeader = obj.optString("todayHeader", "Today"),
                    classCount = obj.optInt("classCount", 0),
                    studyBlockCount = obj.optInt("studyBlockCount", 0),
                    slots = slotsList,
                    nextExamBanner =
                        if (obj.has("nextExamBanner") && !obj.isNull("nextExamBanner")) {
                            obj.getString(
                                "nextExamBanner",
                            )
                        } else {
                            null
                        },
                    nextExamBadge =
                        if (obj.has("nextExamBadge") && !obj.isNull("nextExamBadge")) {
                            obj.getString(
                                "nextExamBadge",
                            )
                        } else {
                            null
                        },
                    nextExamBadgeColor =
                        if (obj.has("nextExamBadgeColor") && !obj.isNull("nextExamBadgeColor")) {
                            obj.getString(
                                "nextExamBadgeColor",
                            )
                        } else {
                            null
                        },
                )
            } catch (_: Exception) {
                empty()
            }
        }

        fun fromSnapshot(snapshot: AppSnapshotModel): TodayScheduleWidgetState {
            val today = LocalDate.now()
            val dayName = today.dayOfWeek.name.lowercase().replaceFirstChar { it.uppercase() }
            val todayHeader = today.format(DateTimeFormatter.ofPattern("EEEE, MMM d"))

            // Find slots for today (matching weekday and week parity)
            val todaySlots =
                snapshot.schedule.slots
                    .filter { WeekParityHelper.slotMatchesDate(it, today) }
                    .sortedBy { it.startTime }
                    .map { slot ->
                        TodaySlotItem(
                            courseCode = slot.courseId,
                            courseName = slot.courseName,
                            timeDisplay = "${slot.startTime}–${slot.endTime}",
                            room = slot.room ?: "—",
                            type = slot.type,
                            colorHex = CoursePalette.getHex(slot.courseId),
                        )
                    }

            // Next exam info
            val nextUp = snapshot.dashboard.nextUp
            val nextExamBanner =
                nextUp?.let {
                    val course = snapshot.schedule.courses.find { c -> c.id == it.courseId }
                    val code = it.courseName ?: it.courseId ?: course?.name ?: "EXAM"
                    "$code: ${it.title} @ ${it.room ?: "—"}"
                }
            val days = nextUp?.daysUntil
            val nextBadge =
                when {
                    days == null -> null
                    days <= 0 -> "TODAY"
                    days == 1 -> "TOMORROW"
                    else -> "IN $days DAYS"
                }
            val badgeColor =
                when {
                    days == null -> "#1a73e8"
                    days <= 0 -> "#ef4444"
                    days == 1 -> "#f59e0b"
                    else -> "#1a73e8"
                }

            return TodayScheduleWidgetState(
                todayHeader = todayHeader,
                classCount = todaySlots.size,
                studyBlockCount = 0,
                slots = todaySlots,
                nextExamBanner = nextExamBanner,
                nextExamBadge = nextBadge,
                nextExamBadgeColor = badgeColor,
            )
        }
    }
}

/**
 * SharedPreferences storage for Today's Schedule widget.
 */
object TodayScheduleWidgetStore {
    private const val PREFS_NAME = "quizradar_today_widget_prefs"
    private const val KEY_STATE = "today_widget_state_json"

    fun load(context: Context): TodayScheduleWidgetState {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return TodayScheduleWidgetState.fromJson(prefs.getString(KEY_STATE, null))
    }

    fun save(
        context: Context,
        state: TodayScheduleWidgetState,
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_STATE, state.toJson()).apply()
    }
}

/**
 * 4x2 / 4x1 Glance widget displaying Today's Schedule & upcoming exam alerts.
 */
class TodayScheduleWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val state = TodayScheduleWidgetStore.load(context)

        provideContent {
            val isNight =
                (
                    context.resources.configuration.uiMode and
                        android.content.res.Configuration.UI_MODE_NIGHT_MASK
                ) == android.content.res.Configuration.UI_MODE_NIGHT_YES

            val bgDark = if (isNight) Color(0xFF0B0F19) else Color(0xFFF8FAFC)
            val cardBg = if (isNight) Color(0xFF1E293B) else Color(0xFFFFFFFF)
            val textWhite = if (isNight) Color(0xFFFFFFFF) else Color(0xFF0F172A)
            val textSlate = if (isNight) Color(0xFF94A3B8) else Color(0xFF475569)
            val accentBlue = Color(0xFF1A73E8)

            val launchIntent =
                Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("EXTRA_FROM_TODAY_WIDGET", true)
                }

            Box(
                modifier =
                    GlanceModifier
                        .fillMaxSize()
                        .background(bgDark)
                        .padding(8.dp)
                        .clickable(actionStartActivity(launchIntent)),
                contentAlignment = Alignment.TopStart,
            ) {
                Column(modifier = GlanceModifier.fillMaxSize()) {
                    // Header Row: Day & Date + count pill
                    Row(
                        modifier = GlanceModifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = state.todayHeader,
                            style =
                                TextStyle(
                                    color = ColorProvider(textWhite),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                        )
                        Spacer(modifier = GlanceModifier.defaultWeight())
                        Text(
                            text = if (state.classCount > 0) "${state.classCount} classes" else "All clear",
                            style =
                                TextStyle(
                                    color = ColorProvider(accentBlue),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                        )
                    }

                    Spacer(modifier = GlanceModifier.height(6.dp))

                    // Next Exam Banner (if any)
                    if (state.nextExamBanner != null) {
                        Row(
                            modifier =
                                GlanceModifier
                                    .fillMaxWidth()
                                    .background(cardBg)
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "🎯 ${state.nextExamBanner}",
                                style =
                                    TextStyle(
                                        color = ColorProvider(textWhite),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                    ),
                                maxLines = 1,
                                modifier = GlanceModifier.defaultWeight(),
                            )
                            if (state.nextExamBadge != null) {
                                Spacer(modifier = GlanceModifier.width(4.dp))
                                Text(
                                    text = state.nextExamBadge,
                                    style =
                                        TextStyle(
                                            color =
                                                ColorProvider(
                                                    state.nextExamBadgeColor?.let {
                                                        try {
                                                            Color(android.graphics.Color.parseColor(it))
                                                        } catch (_: Exception) {
                                                            accentBlue
                                                        }
                                                    } ?: accentBlue,
                                                ),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                        ),
                                )
                            }
                        }
                        Spacer(modifier = GlanceModifier.height(6.dp))
                    }

                    // Today's classes list
                    if (state.slots.isEmpty()) {
                        Box(
                            modifier =
                                GlanceModifier
                                    .fillMaxWidth()
                                    .background(cardBg)
                                    .padding(12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "No classes scheduled today • Tap to view study tasks",
                                style =
                                    TextStyle(
                                        color = ColorProvider(textSlate),
                                        fontSize = 11.sp,
                                    ),
                            )
                        }
                    } else {
                        val maxSlots = 3
                        val displaySlots = state.slots.take(maxSlots)
                        displaySlots.forEach { slot ->
                            Row(
                                modifier =
                                    GlanceModifier
                                        .fillMaxWidth()
                                        .background(cardBg)
                                        .padding(horizontal = 8.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                // Color bar indicator
                                val barColor =
                                    try {
                                        Color(android.graphics.Color.parseColor(slot.colorHex))
                                    } catch (_: Exception) {
                                        accentBlue
                                    }
                                Box(
                                    modifier =
                                        GlanceModifier
                                            .width(4.dp)
                                            .height(24.dp)
                                            .background(barColor),
                                ) {}

                                Spacer(modifier = GlanceModifier.width(6.dp))

                                Column(modifier = GlanceModifier.defaultWeight()) {
                                    Text(
                                        text = "${slot.courseCode} · ${slot.type}",
                                        style =
                                            TextStyle(
                                                color = ColorProvider(textWhite),
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                            ),
                                        maxLines = 1,
                                    )
                                    Text(
                                        text = "${slot.timeDisplay} @ ${slot.room}",
                                        style =
                                            TextStyle(
                                                color = ColorProvider(textSlate),
                                                fontSize = 10.sp,
                                            ),
                                        maxLines = 1,
                                    )
                                }
                            }
                            Spacer(modifier = GlanceModifier.height(4.dp))
                        }
                    }
                }
            }
        }
    }

    companion object {
        suspend fun updateWidget(
            context: Context,
            state: TodayScheduleWidgetState,
        ) {
            TodayScheduleWidgetStore.save(context, state)
            TodayScheduleWidget().updateAll(context)
        }

        suspend fun refreshFromEngine(
            context: Context,
            engine: QuizRadarEngine,
        ) {
            try {
                val stateJson = engine.getState()
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(stateJson)
                val state = TodayScheduleWidgetState.fromSnapshot(snapshot)
                updateWidget(context, state)
            } catch (_: Exception) {
                // Keep existing widget state if refresh fails
            }
        }
    }
}

class TodayScheduleWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayScheduleWidget()
}
