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
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

internal const val MAX_FEEDBACK_NOTE_LENGTH = 4_000

enum class BetaFeedbackPendingAction {
    NONE,
    SAVING_TO_INBOX,
    SHARING_SINGLE,
}

data class BetaFeedbackDraft(
    val id: String,
    val directory: File,
    val screenName: String,
    val createdAt: Instant,
    val screenshot: File?,
    val voiceNote: File?,
    val screenshotRevision: Int = 0,
)

data class BetaFeedbackUiState(
    val draft: BetaFeedbackDraft? = null,
    val isRecording: Boolean = false,
    val recordingSeconds: Long = 0L,
    val isPlaying: Boolean = false,
    val isRedactingScreenshot: Boolean = false,
    val pendingAction: BetaFeedbackPendingAction = BetaFeedbackPendingAction.NONE,
    val errorMessage: String? = null,
    val isInboxOpen: Boolean = false,
    val isBatchExporting: Boolean = false,
    val playingInboxItemId: String? = null,
    val inboxErrorMessage: String? = null,
) {
    val isExporting: Boolean
        get() = pendingAction != BetaFeedbackPendingAction.NONE
}

data class FeedbackBuildInfo(
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
    private val exportedAt: () -> Instant = { Instant.now() },
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

        try {
            ZipOutputStream(FileOutputStream(output)).use { zip ->
                zip.putText(
                    name = "agent-brief.md",
                    content = agentBrief(draft, cleanNote, hasScreenshot, hasVoiceNote, buildInfo),
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
        } catch (error: Throwable) {
            output.delete()
            throw error
        }
    }

    fun buildBatch(
        items: List<BetaFeedbackInboxItem>,
        packageDirectory: File,
    ): File {
        require(items.isNotEmpty()) { "Save at least one issue before exporting the feedback inbox" }
        val orderedItems = items.sortedWith(compareBy({ it.createdAt }, { it.id }))
        val exportTime = exportedAt()
        val batchId = UUID.randomUUID().toString().take(8)
        packageDirectory.mkdirs()
        val output =
            File(
                packageDirectory,
                "quizradar-feedback-batch-${FILE_TIMESTAMP.format(exportTime)}-$batchId.zip",
            )
        val entries =
            orderedItems.mapIndexed { index, item ->
                val issueDirectory = "issues/issue-${(index + 1).toString().padStart(3, '0')}-${item.id.take(8)}"
                BatchEntry(
                    item = item,
                    directory = issueDirectory,
                    screenshotPath =
                        if (item.screenshot?.isFile == true) {
                            "$issueDirectory/screenshot.png"
                        } else {
                            null
                        },
                    voiceNotePath =
                        if (item.voiceNote?.isFile == true) {
                            "$issueDirectory/voice-note.m4a"
                        } else {
                            null
                        },
                )
            }

        try {
            ZipOutputStream(FileOutputStream(output)).use { zip ->
                zip.putText("batch-index.md", batchIndex(entries, exportTime))
                zip.putText("batch-manifest.json", batchManifest(entries, exportTime))
                entries.forEach { entry ->
                    val item = entry.item
                    zip.putText(
                        name = "${entry.directory}/agent-brief.md",
                        content =
                            agentBrief(
                                draft = item.toDraft(),
                                note = item.note,
                                hasScreenshot = entry.screenshotPath != null,
                                hasVoiceNote = entry.voiceNotePath != null,
                                itemBuildInfo = item.buildInfo ?: buildInfo,
                            ),
                    )
                    if (entry.screenshotPath != null) {
                        zip.putFile(entry.screenshotPath, requireNotNull(item.screenshot), item.createdAt)
                    }
                    if (entry.voiceNotePath != null) {
                        zip.putFile(entry.voiceNotePath, requireNotNull(item.voiceNote), item.createdAt)
                    }
                }
            }
            check(output.isFile && output.length() > 0L) { "The feedback batch ZIP was not created" }
            ZipFile(output).use { zip ->
                check(zip.getEntry("batch-index.md") != null) { "The batch index is missing" }
                check(zip.getEntry("batch-manifest.json") != null) { "The batch manifest is missing" }
                entries.forEach { entry ->
                    check(zip.getEntry("${entry.directory}/agent-brief.md") != null) {
                        "An issue brief is missing from the batch"
                    }
                }
            }
            return output
        } catch (error: Throwable) {
            output.delete()
            throw error
        }
    }

    private fun batchIndex(
        entries: List<BatchEntry>,
        exportTime: Instant,
    ): String =
        buildString {
            appendLine("# QuizRadar feedback inbox export")
            appendLine()
            appendLine("- Exported (UTC): $exportTime")
            appendLine("- Issues: ${entries.size}")
            appendLine("- App version: ${buildInfo.appVersion}")
            appendLine("- Build type: ${buildInfo.buildType}")
            appendLine()
            appendLine(
                "Each numbered directory is a separate issue. `batch-manifest.json` is the authoritative " +
                    "mapping between tester text and its screenshot/voice attachments.",
            )
            entries.forEachIndexed { index, entry ->
                val item = entry.item
                appendLine()
                appendLine("## Issue ${index + 1}: ${item.screenName}")
                appendLine()
                appendLine("- ID: ${item.id}")
                appendLine("- Directory: `${entry.directory}/`")
                appendLine("- Created (UTC): ${item.createdAt}")
                appendLine("- Screenshot: ${entry.screenshotPath?.let { "`$it`" } ?: "not attached"}")
                appendLine("- Voice note: ${entry.voiceNotePath?.let { "`$it`" } ?: "not attached"}")
                appendLine()
                appendLine(item.note.ifBlank { "No written note. Review the attached voice note." })
            }
            appendLine()
            appendLine("## Suggested ZCode workflow")
            appendLine()
            appendLine(
                "Investigate each issue independently, using its directory and manifest entry. " +
                    "Do not combine unrelated reproduction steps or claim an issue is fixed without focused tests.",
            )
            appendLine(
                "Voice notes require an available transcription tool; otherwise request a transcript. " +
                    "No delivery or fix is confirmed by this export.",
            )
        }

    private fun batchManifest(
        entries: List<BatchEntry>,
        exportTime: Instant,
    ): String =
        buildString {
            appendLine("{")
            appendLine("  \"schema_version\": 1,")
            appendLine("  \"exported_at\": ${jsonString(exportTime.toString())},")
            appendLine("  \"app_version\": ${jsonString(buildInfo.appVersion)},")
            appendLine("  \"build_type\": ${jsonString(buildInfo.buildType)},")
            appendLine("  \"issue_count\": ${entries.size},")
            appendLine("  \"issues\": [")
            entries.forEachIndexed { index, entry ->
                val item = entry.item
                appendLine("    {")
                appendLine("      \"id\": ${jsonString(item.id)},")
                appendLine("      \"directory\": ${jsonString(entry.directory)},")
                appendLine("      \"created_at\": ${jsonString(item.createdAt.toString())},")
                appendLine("      \"screen_name\": ${jsonString(item.screenName)},")
                appendLine("      \"note\": ${jsonString(item.note)},")
                appendLine("      \"agent_brief\": ${jsonString("${entry.directory}/agent-brief.md")},")
                appendLine("      \"screenshot\": ${entry.screenshotPath?.let { jsonString(it) } ?: "null"},")
                appendLine("      \"voice_note\": ${entry.voiceNotePath?.let { jsonString(it) } ?: "null"}")
                append("    }")
                if (index < entries.lastIndex) append(",")
                appendLine()
            }
            appendLine("  ]")
            appendLine("}")
        }

    private data class BatchEntry(
        val item: BetaFeedbackInboxItem,
        val directory: String,
        val screenshotPath: String?,
        val voiceNotePath: String?,
    )

    private fun agentBrief(
        draft: BetaFeedbackDraft,
        note: String,
        hasScreenshot: Boolean,
        hasVoiceNote: Boolean,
        itemBuildInfo: FeedbackBuildInfo,
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
            appendLine("- App version: ${itemBuildInfo.appVersion}")
            appendLine("- Build type: ${itemBuildInfo.buildType}")
            appendLine("- Current screen: ${draft.screenName}")
            appendLine("- Android API: ${itemBuildInfo.androidSdk}")
            appendLine("- Device: ${itemBuildInfo.device.ifBlank { "Not available" }}")
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

private fun jsonString(value: String): String =
    buildString {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> {
                    if (character.code < 0x20) {
                        append(String.format(Locale.US, "\\u%04x", character.code))
                    } else {
                        append(character)
                    }
                }
            }
        }
        append('"')
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
