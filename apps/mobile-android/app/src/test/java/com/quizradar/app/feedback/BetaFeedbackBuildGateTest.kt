package com.quizradar.app.feedback

import com.quizradar.app.BuildConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class BetaFeedbackBuildGateTest {
    private val projectRoot = File(System.getProperty("user.dir") ?: ".")
    private val sourceRoot =
        File(projectRoot, "src").let {
            if (it.exists()) it else File(projectRoot, "app/src")
        }

    @Test
    fun `feature is enabled in debug staging and GitHub release builds`() {
        assertTrue(
            "${BuildConfig.BUILD_TYPE} must include shake-to-feedback",
            BuildConfig.BETA_FEEDBACK_ENABLED,
        )
    }

    @Test
    fun `main manifest includes voice permission for every distributed APK`() {
        val mainManifest = File(sourceRoot, "main/AndroidManifest.xml").readText()
        assertTrue(mainManifest.contains("android.permission.RECORD_AUDIO"))
    }

    @Test
    fun `feedback provider cannot export the app database or token storage`() {
        val mainManifest = File(sourceRoot, "main/AndroidManifest.xml").readText()
        assertTrue(mainManifest.contains("android:exported=\"false\""))
        assertTrue(mainManifest.contains("android:grantUriPermissions=\"true\""))

        val paths = File(sourceRoot, "main/res/xml/feedback_paths.xml").readText()
        assertTrue(paths.contains("<cache-path"))
        assertTrue(paths.contains("path=\"beta-feedback/\""))
        assertFalse(paths.contains("<files-path"))
        assertFalse(paths.contains("<root-path"))
        assertFalse(paths.contains("<external-path"))
    }
}
