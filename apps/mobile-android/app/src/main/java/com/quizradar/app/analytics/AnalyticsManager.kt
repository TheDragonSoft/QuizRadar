package com.quizradar.app.analytics

import android.content.Context

object AnalyticsManager {
    private const val PREFS_NAME = "quizradar_prefs"
    private const val OPT_OUT_KEY = "quizradar_telemetry_opt_out"

    fun init(context: Context) {}

    fun isOptedOut(context: Context): Boolean {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(OPT_OUT_KEY, false)
    }

    fun setOptOut(
        context: Context,
        optOut: Boolean,
    ) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(OPT_OUT_KEY, optOut).apply()
    }

    fun trackWidgetInteraction(action: String) {}

    fun trackExamReminderNotification(reminderType: String) {}

    fun trackScanCompleted(
        source: String,
        assessmentCount: Int,
        success: Boolean,
    ) {}
}
