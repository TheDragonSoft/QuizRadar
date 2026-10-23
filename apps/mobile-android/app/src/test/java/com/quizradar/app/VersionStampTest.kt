package com.quizradar.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guardrail for the tooling-stamped version sinks: `versionName` (from
 * tooling/version.json) must stay consistent with `versionCode`
 * (major*10000 + minor*100 + patch, pre-release suffix ignored).
 */
class VersionStampTest {
    @Test
    fun versionCode_matches_stamped_semver_versionName() {
        val match = Regex("(\\d+)\\.(\\d+)\\.(\\d+)").find(BuildConfig.VERSION_NAME)
        assertTrue("versionName must carry MAJOR.MINOR.PATCH: ${BuildConfig.VERSION_NAME}", match != null)
        val (major, minor, patch) = match!!.destructured
        val derived = major.toInt() * 10000 + minor.toInt() * 100 + patch.toInt()
        assertEquals(derived, BuildConfig.VERSION_CODE)
    }

    @Test
    fun applicationId_is_locked() {
        assertEquals("com.quizradar.app", BuildConfig.APPLICATION_ID)
    }
}
