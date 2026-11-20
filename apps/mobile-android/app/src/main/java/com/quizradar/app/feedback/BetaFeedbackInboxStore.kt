package com.quizradar.app.feedback

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.io.File
import java.time.Instant

data class BetaFeedbackInboxItem(
    val id: String,
    val directory: File,
    val screenName: String,
    val createdAt: Instant,
    val note: String,
    val screenshot: File?,
    val voiceNote: File?,
) {
    fun toDraft(): BetaFeedbackDraft =
        BetaFeedbackDraft(
            id = id,
            directory = directory,
            screenName = screenName,
            createdAt = createdAt,
            screenshot = screenshot,
            voiceNote = voiceNote,
        )
}

/** App-private, persistent issue queue. Metadata and attachments always share one issue directory. */
class BetaFeedbackInboxStore internal constructor(
    private val rootDirectory: File,
) {
    constructor(context: Context) : this(File(context.filesDir, "beta-feedback/inbox"))

    private val _items = MutableStateFlow<List<BetaFeedbackInboxItem>>(emptyList())
    val items: StateFlow<List<BetaFeedbackInboxItem>> = _items

    private val _loadErrors = MutableStateFlow<List<String>>(emptyList())
    val loadErrors: StateFlow<List<String>> = _loadErrors

    init {
        reload()
    }

    fun reload() {
        val issuesDirectory = File(rootDirectory, "issues")
        val loaded = mutableListOf<BetaFeedbackInboxItem>()
        val errors = mutableListOf<String>()
        issuesDirectory.listFiles()?.sortedBy { it.name }?.forEach { directory ->
            if (!directory.isDirectory) return@forEach
            try {
                loaded += readItem(directory)
            } catch (_: Exception) {
                errors += "A saved feedback item could not be read (${directory.name.take(8)})."
            }
        }
        _items.value = loaded.sortedWith(compareBy({ it.createdAt }, { it.id }))
        _loadErrors.value = errors
    }

    fun saveDraft(
        draft: BetaFeedbackDraft,
        note: String,
    ): BetaFeedbackInboxItem {
        val cleanNote = note.trim().take(MAX_FEEDBACK_NOTE_LENGTH)
        require(cleanNote.isNotEmpty() || draft.voiceNote?.isFile == true) {
            "Add a written or voice description before saving"
        }
        val issuesDirectory = File(rootDirectory, "issues")
        val destination = File(issuesDirectory, draft.id)
        require(!destination.exists()) { "This issue is already in the feedback inbox" }
        check(issuesDirectory.exists() || issuesDirectory.mkdirs()) { "Could not create the feedback inbox" }

        try {
            if (draft.directory.isDirectory) {
                check(draft.directory.copyRecursively(destination, overwrite = false)) {
                    "Could not copy feedback attachments"
                }
            } else {
                check(destination.mkdirs()) { "Could not create the saved issue directory" }
            }
            val item =
                BetaFeedbackInboxItem(
                    id = draft.id,
                    directory = destination,
                    screenName = draft.screenName,
                    createdAt = draft.createdAt,
                    note = cleanNote,
                    screenshot = File(destination, "screenshot.png").takeIf { it.isFile },
                    voiceNote = File(destination, "voice-note.m4a").takeIf { it.isFile },
                )
            writeMetadata(item)
            draft.directory.deleteRecursively()
            _items.value = (_items.value + item).sortedWith(compareBy({ it.createdAt }, { it.id }))
            return item
        } catch (error: Exception) {
            destination.deleteRecursively()
            throw error
        }
    }

    fun deleteItem(id: String) {
        val item = _items.value.firstOrNull { it.id == id } ?: return
        if (item.directory.exists() && !item.directory.deleteRecursively()) {
            throw IllegalStateException("The saved issue could not be deleted")
        }
        _items.value = _items.value.filterNot { it.id == id }
    }

    fun clear() {
        val failures = mutableListOf<String>()
        _items.value.forEach { item ->
            if (item.directory.exists() && !item.directory.deleteRecursively()) failures += item.id
        }
        if (failures.isNotEmpty()) {
            reload()
            throw IllegalStateException("Some saved issues could not be deleted")
        }
        _items.value = emptyList()
    }

    private fun readItem(directory: File): BetaFeedbackInboxItem {
        val metadataFile = File(directory, METADATA_FILE)
        check(metadataFile.isFile) { "Metadata is missing" }
        val metadata = JSONObject(metadataFile.readText())
        check(metadata.getInt("schema_version") == SCHEMA_VERSION) { "Unsupported metadata version" }
        val id = metadata.getString("id")
        check(id == directory.name) { "Issue id does not match its directory" }
        val screenshot =
            if (metadata.optString("screenshot").isNotEmpty()) {
                File(directory, "screenshot.png").takeIf { it.isFile }
            } else {
                null
            }
        val voiceNote =
            if (metadata.optString("voice_note").isNotEmpty()) {
                File(directory, "voice-note.m4a").takeIf { it.isFile }
            } else {
                null
            }
        return BetaFeedbackInboxItem(
            id = id,
            directory = directory,
            screenName = metadata.getString("screen_name"),
            createdAt = Instant.parse(metadata.getString("created_at")),
            note = metadata.getString("note"),
            screenshot = screenshot,
            voiceNote = voiceNote,
        )
    }

    private fun writeMetadata(item: BetaFeedbackInboxItem) {
        val metadata =
            JSONObject()
                .put("schema_version", SCHEMA_VERSION)
                .put("id", item.id)
                .put("created_at", item.createdAt.toString())
                .put("screen_name", item.screenName)
                .put("note", item.note)
                .put("screenshot", item.screenshot?.name ?: JSONObject.NULL)
                .put("voice_note", item.voiceNote?.name ?: JSONObject.NULL)
        val metadataFile = File(item.directory, METADATA_FILE)
        metadataFile.writeText(metadata.toString(2))
        check(metadataFile.isFile && metadataFile.length() > 0L) { "Could not save issue metadata" }
    }

    private companion object {
        const val SCHEMA_VERSION = 1
        const val METADATA_FILE = "feedback.json"
    }
}
