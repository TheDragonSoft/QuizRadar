package com.quizradar.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Pins the platform-conformance flags the impeccable native audit checks in
 * the manifest. If one of these disappears, a whole class of platform behaviour
 * silently regresses:
 *
 *  - `enableOnBackInvokedCallback` opt-in for the Android 13+ predictive back
 *    gesture (the app's own BackHandler already layers dismissal correctly);
 *  - `windowSoftInputMode="adjustResize"` so the IME never covers an input;
 *  - `usesCleartextTraffic="false"` and `allowBackup="false"` - no plaintext
 *    traffic, and no user data in cloud backups.
 */
class ManifestConformanceTest {
    private val manifest =
        File(System.getProperty("user.dir") ?: ".").let { root ->
            listOf(
                File(root, "src/main/AndroidManifest.xml"),
                File(root, "app/src/main/AndroidManifest.xml"),
            ).firstOrNull { it.exists() } ?: File(root, "src/main/AndroidManifest.xml")
        }

    @Test
    fun `predictive back is opted in`() {
        assertTrue("the manifest must exist", manifest.exists())
        val xml = manifest.readText()
        assertTrue(
            "AndroidManifest.xml must set android:enableOnBackInvokedCallback=\"true\" " +
                "so the Android 13+ predictive back gesture works",
            xml.contains("""android:enableOnBackInvokedCallback="true""""),
        )
    }

    @Test
    fun `the keyboard resizes the window instead of covering inputs`() {
        val xml = manifest.readText()
        assertTrue(
            "MainActivity must use windowSoftInputMode=\"adjustResize\"",
            xml.contains("""android:windowSoftInputMode="adjustResize""""),
        )
    }

    @Test
    fun `no cleartext traffic and no cloud backup of user data`() {
        val xml = manifest.readText()
        assertTrue(
            "usesCleartextTraffic must stay false (all network calls are https)",
            xml.contains("""android:usesCleartextTraffic="false""""),
        )
        assertTrue(
            "allowBackup must stay false (schedule/assessment data never leaves via backup)",
            xml.contains("""android:allowBackup="false""""),
        )
    }
}
