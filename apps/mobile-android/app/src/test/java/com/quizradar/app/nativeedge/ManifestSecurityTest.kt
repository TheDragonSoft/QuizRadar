package com.quizradar.app.nativeedge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ManifestSecurityTest {
    private val projectRoot = File(System.getProperty("user.dir") ?: ".")
    private val manifestFile =
        File(projectRoot, "src/main/AndroidManifest.xml").let {
            if (it.exists()) it else File(projectRoot, "app/src/main/AndroidManifest.xml")
        }

    @Test
    fun testManifestSecurityConstraints() {
        assertTrue("AndroidManifest.xml must exist", manifestFile.exists())
        val content = manifestFile.readText()

        // 1. Strict HTTPS: android:usesCleartextTraffic must be false
        assertTrue(
            "Manifest must set android:usesCleartextTraffic=\"false\"",
            content.contains("""android:usesCleartextTraffic="false""""),
        )

        // 2. No Foreground Service or specialUse FGS
        assertFalse(
            "Manifest must not declare foregroundServiceType=\"specialUse\"",
            content.contains("""specialUse"""),
        )
        assertFalse(
            "Manifest must not declare FOREGROUND_SERVICE permission",
            content.contains("""android.permission.FOREGROUND_SERVICE"""),
        )

        // 3. No VIEW intents on http or https schemes (custom-scheme only)
        assertFalse(
            "Manifest must not have VIEW intents on http scheme",
            content.contains("""android:scheme="http""""),
        )
        assertFalse(
            "Manifest must not have VIEW intents on https scheme (browser CustomTabs does that)",
            content.contains("""android:scheme="https""""),
        )

        // 4. Custom scheme com.quizradar.app must be registered for oauth
        assertTrue(
            "Manifest must register com.quizradar.app custom scheme",
            content.contains("""android:scheme="com.quizradar.app""""),
        )
        assertTrue(
            "Manifest must handle oauth host",
            content.contains("""android:host="oauth""""),
        )
        assertFalse(
            "Manifest must not handle obsolete pair host in zero-server mode",
            content.contains("""android:host="pair""""),
        )

        // 5. Share-sheet ingest must be registered
        assertTrue(
            "Manifest must register ACTION_SEND",
            content.contains("""android.intent.action.SEND"""),
        )

        // 6. Glance widget receiver must be registered
        assertTrue(
            "Manifest must register QuizRadarWidgetReceiver",
            content.contains("QuizRadarWidgetReceiver"),
        )

        // 7. App Shortcuts & Action Scheme must be registered
        assertTrue(
            "Manifest must register quizradar custom scheme",
            content.contains("""android:scheme="quizradar""""),
        )
        assertTrue(
            "Manifest must declare shortcuts metadata",
            content.contains("""android:name="android.app.shortcuts""""),
        )
    }

    @Test
    fun testZeroClientSecretsInSourceTree() {
        val srcDir =
            File(projectRoot, "src/main").let {
                if (it.exists()) it else File(projectRoot, "app/src/main")
            }
        assertTrue("Source directory must exist", srcDir.exists())

        srcDir.walkTopDown().filter { it.isFile && (it.extension == "kt" || it.extension == "xml") }.forEach { file ->
            val text = file.readText()
            assertFalse(
                "File ${file.name} must never contain 'client_secret'",
                text.contains("client_secret", ignoreCase = true) && !file.name.contains("ManifestSecurityTest"),
            )
        }
    }
}
