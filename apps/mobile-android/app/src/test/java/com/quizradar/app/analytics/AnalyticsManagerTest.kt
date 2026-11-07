package com.quizradar.app.analytics

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AnalyticsManagerTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        // Reset SharedPreferences
        val prefs = context.getSharedPreferences("quizradar_prefs", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
    }

    @Test
    fun defaultOptOut_isFalse() {
        assertFalse(AnalyticsManager.isOptedOut(context))
    }

    @Test
    fun setOptOut_updatesPreferenceAndState() {
        AnalyticsManager.setOptOut(context, true)
        assertTrue(AnalyticsManager.isOptedOut(context))

        AnalyticsManager.setOptOut(context, false)
        assertFalse(AnalyticsManager.isOptedOut(context))
    }

    @Test
    fun trackingMethods_doNotThrowWhenNotInitialized() {
        // Safe no-ops without crashing
        AnalyticsManager.trackWidgetInteraction("click")
        AnalyticsManager.trackExamReminderNotification("24h")
        AnalyticsManager.trackScanCompleted("manual", 2, true)
    }
}
