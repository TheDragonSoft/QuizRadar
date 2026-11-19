package com.quizradar.app.feedback

import android.content.ClipData
import android.content.Intent
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import com.quizradar.app.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

internal const val MAX_FEEDBACK_NOTE_LENGTH = 4_000

data class BetaFeedbackDraft(
    val id: String,
    val directory: File,
    val screenName: String,
    val createdAt: Instant,
    val screenshot: File?,
    val voiceNote: File?,
)

data class BetaFeedbackUiState(
    val draft: BetaFeedbackDraft? = null,
    val isRecording: Boolean = false,
    val recordingSeconds: Long = 0L,
    val isPlaying: Boolean = false,
    val isExporting: Boolean = false,
    val errorMessage: String? = null,
)

internal data class FeedbackBuildInfo(
    val appVersion: String,
    val buildType: String,
    val androidSdk: Int,
    val device: String,
) {
    companion object {
        fun current(): FeedbackBuildInfo =
            FeedbackBuildInfo(
                appVersion = BuildConfig.VERSION_NAME,
                buildType = BuildConfig.BUILD_TYPE,
                androidSdk = Build.VERSION.SDK_INT,
                device = listOf(Build.MANUFACTURER, Build.MODEL).joinToString(" ").trim(),
            )
    }
}

internal class BetaFeedbackPackageBuilder(
    private val buildInfo: FeedbackBuildInfo = FeedbackBuildInfo.current(),
) {
    fun build(
        draft: BetaFeedbackDraft,
        note: String,
        packageDirectory: File,
    ): File {
        val cleanNote = note.trim().take(MAX_FEEDBACK_NOTE_LENGTH)
        require(cleanNote.isNotEmpty() || draft.voiceNote?.isFile == true) {
            "Add a written or voice description before sharing"
        }
        packageDirectory.mkdirs()
        val timestamp = FILE_TIMESTAMP.format(draft.createdAt)
        val output = File(packageDirectory, "quizradar-feedback-$timestamp-${draft.id.take(8)}.zip")
        val hasScreenshot = draft.screenshot?.isFile == true
        val hasVoiceNote = draft.voiceNote?.isFile == true

        ZipOutputStream(FileOutputStream(output)).use { zip ->
            zip.putText(
                name = "agent-brief.md",
                content = agentBrief(draft, cleanNote, hasScreenshot, hasVoiceNote),
            )
            if (hasScreenshot) zip.putFile("screenshot.png", requireNotNull(draft.screenshot), draft.createdAt)
            if (hasVoiceNote) zip.putFile("voice-note.m4a", requireNotNull(draft.voiceNote), draft.createdAt)
        }
        check(output.isFile && output.length() > 0L) { "The feedback ZIP was not created" }
        // Verify our own artifact before handing it to another application.
        ZipFile(output).use { zip ->
            check(zip.getEntry("agent-brief.md") != null) { "The feedback brief is missing" }
        }
        return output
    }

    private fun agentBrief(
        draft: BetaFeedbackDraft,
        note: String,
        hasScreenshot: Boolean,
        hasVoiceNote: Boolean,
    ): String =
        buildString {
            appendLine("# QuizRadar beta feedback")
            appendLine()
            appendLine("## Tester report")
            appendLine()
            appendLine(note.ifBlank { "No written note. Review the attached voice note." })
            appendLine()
            appendLine("## Minimal diagnostics")
            appendLine()
            appendLine("- Created (UTC): ${draft.createdAt}")
            appendLine("- App version: ${buildInfo.appVersion}")
            appendLine("- Build type: ${buildInfo.buildType}")
            appendLine("- Current screen: ${draft.screenName}")
            appendLine("- Android API: ${buildInfo.androidSdk}")
            appendLine("- Device: ${buildInfo.device.ifBlank { "Not available" }}")
            appendLine("- Screenshot attached: ${if (hasScreenshot) "yes" else "no"}")
            appendLine("- Voice note attached: ${if (hasVoiceNote) "yes" else "no"}")
            appendLine()
            appendLine("## Suggested ZCode workflow")
            appendLine()
            appendLine("1. Read the tester report and inspect every attachment.")
            appendLine(
                "2. If a voice note is present, transcribe it with an available speech-to-text tool. " +
                    "If transcription is unavailable, ask for a transcript instead of guessing.",
            )
            appendLine("3. Reproduce the problem in the Android app and identify its root cause.")
            appendLine(
                "4. Add a focused regression test, implement the smallest appropriate fix, " +
                    "and run the required Android/repository gates.",
            )
            appendLine(
                "5. Report exactly what was verified. Do not claim the issue is fixed merely " +
                    "because this package exists.",
            )
            appendLine()
            appendLine("## Privacy and delivery")
            appendLine()
            appendLine(
                "The tester reviewed this package and explicitly opened the Android share sheet. " +
                    "QuizRadar did not automatically upload it and cannot confirm delivery.",
            )
            appendLine(
                "No OAuth tokens, API keys, logcat, account database, or full application state is included. " +
                    "A screenshot can still contain whatever was visible on screen, so its preview must be reviewed by the tester.",
            )
        }

    private fun ZipOutputStream.putText(
        name: String,
        content: String,
    ) {
        putNextEntry(ZipEntry(name))
        write(content.toByteArray(Charsets.UTF_8))
        closeEntry()
    }

    private fun ZipOutputStream.putFile(
        name: String,
        source: File,
        createdAt: Instant,
    ) {
        val entry = ZipEntry(name).apply { time = createdAt.toEpochMilli() }
        putNextEntry(entry)
        source.inputStream().use { input -> input.copyTo(this) }
        closeEntry()
    }

    private companion object {
        val FILE_TIMESTAMP: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC)
    }
}

internal object BetaFeedbackSharer {
    fun share(
        activity: ComponentActivity,
        packageFile: File,
    ) {
        require(packageFile.isFile) { "The feedback package does not exist" }
        val uri =
            FileProvider.getUriForFile(
                activity,
                "${BuildConfig.APPLICATION_ID}.feedback",
                packageFile,
            )
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "QuizRadar beta feedback")
                putExtra(Intent.EXTRA_TEXT, "Reviewed QuizRadar beta feedback package (ZIP).")
                clipData = ClipData.newUri(activity.contentResolver, "QuizRadar beta feedback", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        val chooser =
            Intent.createChooser(send, "Share beta feedback").apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        activity.startActivity(chooser)
    }
}

internal fun newFeedbackDraft(
    cacheDir: File,
    screenName: String,
): BetaFeedbackDraft {
    val id = UUID.randomUUID().toString()
    val directory = File(cacheDir, "beta-feedback/drafts/$id")
    return BetaFeedbackDraft(
        id = id,
        directory = directory,
        screenName = screenName.trim().take(80).ifBlank { "Unknown" },
        createdAt = Instant.now(),
        screenshot = null,
        voiceNote = null,
    )
}
