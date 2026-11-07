package com.quizradar.app.analytics

import android.content.Context
import com.posthog.PostHog
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig

/**
 * Privacy-preserving, local-first telemetry manager for QuizRadar on Android.
 *
 * PRIVACY GUARANTEES (AGENTS.md & Spec):
 * - Application lifecycle autocapture is explicitly DISABLED.
 * - Screen views autocapture is explicitly DISABLED.
 * - Session recording/replay is explicitly DISABLED.
 * - Respects the user's explicit opt-out toggle stored in SharedPreferences.
 * - Never captures or transmits student names, course titles, email bodies,
 *   schedule slots, or grades. Only coarse aggregate telemetry (e.g. widget clicks,
 *   scan success/failure counts).
 */
object AnalyticsManager {
    private const val PREFS_NAME = "quizradar_prefs"
    private const val OPT_OUT_KEY = "quizradar_telemetry_opt_out"

    // QuizRadar PostHog Project API key & Host
    private const val POSTHOG_API_KEY = "phc_rnRfLANnroSpaKMJQxw3NJqz65oZ6VjYnkbykU7NTsL2"
    private const val POSTHOG_HOST = "https://us.i.posthog.com"

    @Volatile
    private var isInitialized = false

    /**
     * Initializes PostHog Android client with strict privacy guardrails.
     */
    fun init(context: Context) {
        if (isInitialized) return
        val appContext = context.applicationContext

        val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isOptedOut = prefs.getBoolean(OPT_OUT_KEY, false)

        val config =
            PostHogAndroidConfig(
                apiKey = POSTHOG_API_KEY,
                host = POSTHOG_HOST,
            ).apply {
                captureApplicationLifecycleEvents = false
                captureScreenViews = false
                sessionReplay = false
                preloadFeatureFlags = true
            }

        PostHogAndroid.setup(appContext, config)

        if (isOptedOut) {
            PostHog.optOut()
        } else {
            PostHog.register("platform", "android_native")
            PostHog.register("app_version", "v5.0.0")
        }

        isInitialized = true
    }

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

        if (optOut) {
            PostHog.optOut()
        } else {
            PostHog.optIn()
            PostHog.register("platform", "android_native")
            PostHog.register("app_version", "v5.0.0")
        }
    }

    fun trackWidgetInteraction(action: String) {
        if (!isInitialized || PostHog.isOptOut()) return
        PostHog.capture(
            "widget_interaction",
            properties = mapOf("action" to action),
        )
    }

    fun trackExamReminderNotification(reminderType: String) {
        if (!isInitialized || PostHog.isOptOut()) return
        PostHog.capture(
            "exam_reminder_posted",
            properties = mapOf("reminder_type" to reminderType),
        )
    }

    fun trackScanCompleted(
        source: String,
        assessmentCount: Int,
        success: Boolean,
    ) {
        if (!isInitialized || PostHog.isOptOut()) return
        PostHog.capture(
            "scan_completed",
            properties =
                mapOf(
                    "source" to source,
                    "assessment_count" to assessmentCount,
                    "success" to success,
                ),
        )
    }
}
