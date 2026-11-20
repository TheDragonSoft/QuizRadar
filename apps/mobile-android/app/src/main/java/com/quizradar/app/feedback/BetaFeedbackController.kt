package com.quizradar.app.feedback

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.quizradar.app.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class BetaFeedbackController internal constructor(
    context: Context,
    private val scope: CoroutineScope,
    currentScreenName: () -> String,
    private val captureScreenshot: suspend (ComponentActivity?, File) -> File?,
    private val sharePackage: (ComponentActivity?, File) -> Unit,
    private val packageBuilder: BetaFeedbackPackageBuilder,
    private val exportDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val inboxStore: BetaFeedbackInboxStore = BetaFeedbackInboxStore(context.applicationContext),
    showMessage: (String) -> Unit = {},
    initialActivity: ComponentActivity? = null,
    asyncInit: Boolean = false,
) {
    internal constructor(
        activity: ComponentActivity,
        scope: CoroutineScope,
        currentScreenName: () -> String,
        captureScreenshot: (File) -> File?,
        sharePackage: (File) -> Unit,
        packageBuilder: BetaFeedbackPackageBuilder,
        exportDispatcher: CoroutineDispatcher = Dispatchers.IO,
        inboxStore: BetaFeedbackInboxStore = BetaFeedbackInboxStore(activity),
        showMessage: (String) -> Unit = {},
    ) : this(
        context = activity.applicationContext,
        scope = scope,
        currentScreenName = currentScreenName,
        captureScreenshot = { _, destination -> captureScreenshot(destination) },
        sharePackage = { _, packageFile -> sharePackage(packageFile) },
        packageBuilder = packageBuilder,
        exportDispatcher = exportDispatcher,
        inboxStore = inboxStore,
        showMessage = showMessage,
        initialActivity = activity,
        asyncInit = false,
    )

    constructor(
        activity: ComponentActivity,
        scope: CoroutineScope,
        currentScreenName: () -> String,
        showMessage: (String) -> Unit = {},
    ) : this(
        context = activity.applicationContext,
        scope = scope,
        currentScreenName = currentScreenName,
        captureScreenshot = { attached, destination ->
            attached?.let { AppScreenshotCapture.captureOffMainThread(it, destination) }
        },
        sharePackage = { attached, packageFile ->
            val host = checkNotNull(attached) { "No active screen is available to open the share sheet" }
            BetaFeedbackSharer.share(host, packageFile)
        },
        packageBuilder = BetaFeedbackPackageBuilder(),
        inboxStore = BetaFeedbackInboxStore(activity.applicationContext, preload = false),
        showMessage = showMessage,
        initialActivity = activity,
        asyncInit = true,
    )

    private val appContext: Context = context.applicationContext
    private var attachedActivity: ComponentActivity? = initialActivity
    private var currentScreenNameProvider: () -> String = currentScreenName
    private var showMessageHandler: (String) -> Unit = showMessage

    val isAvailable: Boolean = BuildConfig.BETA_FEEDBACK_ENABLED

    private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val _shakeEnabled =
        MutableStateFlow(
            isAvailable && preferences.getBoolean(SHAKE_ENABLED_KEY, true),
        )
    val shakeEnabled: StateFlow<Boolean> = _shakeEnabled

    private val _uiState = MutableStateFlow(BetaFeedbackUiState())
    val uiState: StateFlow<BetaFeedbackUiState> = _uiState
    val inboxItems: StateFlow<List<BetaFeedbackInboxItem>> = inboxStore.items
    val inboxLoadErrors: StateFlow<List<String>> = inboxStore.loadErrors

    private val shakeDetector =
        ShakeDetector(appContext) {
            openFeedback(currentScreenNameProvider())
        }
    private var resumed = false
    private var destroyed = false
    private var captureJob: Job? = null
    private var pendingCaptureDirectory: File? = null

    @Volatile
    private var pendingCaptureId: String? = null

    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var recordingJob: Job? = null
    private var recordingStartedAtMs = 0L

    init {
        if (asyncInit && isAvailable) {
            scope.launch {
                runCatching {
                    withContext(exportDispatcher) {
                        inboxStore.reload()
                        pruneStaleCache(
                            cacheDir = appContext.cacheDir,
                            protectedDraftIds = setOfNotNull(_uiState.value.draft?.id, pendingCaptureId),
                        )
                    }
                }
            }
        }
    }

    fun attachActivity(
        activity: ComponentActivity,
        currentScreenName: () -> String,
        showMessage: (String) -> Unit,
    ) {
        attachedActivity = activity
        currentScreenNameProvider = currentScreenName
        showMessageHandler = showMessage
    }

    fun detachActivity(activity: ComponentActivity) {
        if (attachedActivity === activity) {
            resumed = false
            shakeDetector.stop()
            if (_uiState.value.isRecording) stopRecording()
            stopPlayback()
            attachedActivity = null
        }
    }

    fun onResume() {
        if (!isAvailable || destroyed) return
        resumed = true
        updateShakeRegistration()
    }

    fun onPause() {
        resumed = false
        shakeDetector.stop()
        if (_uiState.value.isRecording) stopRecording()
        stopPlayback()
    }

    fun onDestroy() {
        destroyed = true
        resumed = false
        attachedActivity = null
        captureJob?.cancel()
        captureJob = null
        pendingCaptureDirectory?.deleteRecursively()
        pendingCaptureDirectory = null
        pendingCaptureId = null
        shakeDetector.stop()
        recordingJob?.cancel()
        releaseRecorder()
        stopPlayback()
        _uiState.value.draft?.directory?.deleteRecursively()
    }

    fun setShakeEnabled(enabled: Boolean) {
        if (!isAvailable) return
        preferences.edit().putBoolean(SHAKE_ENABLED_KEY, enabled).apply()
        _shakeEnabled.value = enabled
        updateShakeRegistration()
    }

    fun openFeedback(screenName: String) {
        if (!isAvailable || destroyed || _uiState.value.draft != null || _uiState.value.isInboxOpen || captureJob?.isActive == true) {
            return
        }
        shakeDetector.stop()
        val initialDraft = newFeedbackDraft(appContext.cacheDir, screenName)
        pendingCaptureDirectory = initialDraft.directory
        pendingCaptureId = initialDraft.id
        var jobRef: Job? = null
        val launchedJob =
            scope.launch(start = CoroutineStart.UNDISPATCHED) {
                var captureFailed = false
                try {
                    val screenshot =
                        try {
                            captureScreenshot(attachedActivity, File(initialDraft.directory, "screenshot.png"))
                        } catch (cancelled: CancellationException) {
                            initialDraft.directory.deleteRecursively()
                            throw cancelled
                        } catch (_: Exception) {
                            captureFailed = true
                            null
                        }
                    if (destroyed) {
                        initialDraft.directory.deleteRecursively()
                        return@launch
                    }
                    captureFailed = captureFailed || screenshot == null
                    _uiState.value =
                        BetaFeedbackUiState(
                            draft = initialDraft.copy(screenshot = screenshot),
                            errorMessage =
                                if (captureFailed) {
                                    "The screenshot could not be captured. You can still send a written or voice report."
                                } else {
                                    null
                                },
                        )
                } finally {
                    if (pendingCaptureId == initialDraft.id) {
                        pendingCaptureDirectory = null
                        pendingCaptureId = null
                    }
                    if (captureJob === jobRef) {
                        captureJob = null
                    }
                }
            }
        jobRef = launchedJob
        if (launchedJob.isActive) {
            captureJob = launchedJob
        }
    }

    fun dismiss() {
        if (_uiState.value.isExporting || _uiState.value.isRedactingScreenshot) return
        captureJob?.cancel()
        captureJob = null
        pendingCaptureDirectory?.deleteRecursively()
        pendingCaptureDirectory = null
        pendingCaptureId = null
        if (_uiState.value.isRecording) stopRecording()
        stopPlayback()
        _uiState.value.draft?.directory?.deleteRecursively()
        _uiState.value = BetaFeedbackUiState()
        updateShakeRegistration()
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }

    fun reportError(message: String) {
        _uiState.value = _uiState.value.copy(errorMessage = message)
    }

    fun removeScreenshot() {
        if (_uiState.value.isRedactingScreenshot || _uiState.value.isExporting) return
        val draft = _uiState.value.draft ?: return
        val screenshot = draft.screenshot ?: return
        if (screenshot.exists() && !screenshot.delete()) {
            _uiState.value = _uiState.value.copy(errorMessage = "The screenshot could not be removed. Discard this report and try again.")
            return
        }
        _uiState.value = _uiState.value.copy(draft = draft.copy(screenshot = null), errorMessage = null)
    }

    fun applyScreenshotRedactions(
        strokes: List<RedactionStroke>,
        onComplete: () -> Unit = {},
    ) {
        if (strokes.isEmpty() || _uiState.value.isRedactingScreenshot || _uiState.value.isExporting) return
        val draft = _uiState.value.draft ?: return
        val screenshot = draft.screenshot?.takeIf { it.isFile } ?: return
        _uiState.value = _uiState.value.copy(isRedactingScreenshot = true, errorMessage = null)
        scope.launch {
            val result =
                runCatching {
                    withContext(exportDispatcher) {
                        ScreenshotRedactor.applyRedactions(screenshot, strokes)
                    }
                }
            if (destroyed) return@launch
            val currentDraft = _uiState.value.draft
            if (currentDraft?.id != draft.id) {
                _uiState.value = _uiState.value.copy(isRedactingScreenshot = false)
                return@launch
            }
            if (result.isSuccess) {
                _uiState.value =
                    _uiState.value.copy(
                        draft = currentDraft.copy(screenshotRevision = currentDraft.screenshotRevision + 1),
                        isRedactingScreenshot = false,
                        errorMessage = null,
                    )
                onComplete()
            } else {
                _uiState.value =
                    _uiState.value.copy(
                        isRedactingScreenshot = false,
                        errorMessage = "Could not apply screenshot redaction. You can still remove the screenshot or try again.",
                    )
            }
        }
    }

    fun startRecording() {
        if (!isAvailable || destroyed) return
        if (_uiState.value.isRecording) {
            stopRecording()
            return
        }
        val draft = _uiState.value.draft ?: return
        if (draft.voiceNote != null) {
            _uiState.value = _uiState.value.copy(errorMessage = "Delete the current voice note before recording another one.")
            return
        }
        if (
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            _uiState.value = _uiState.value.copy(errorMessage = "Microphone permission is required only for a voice note.")
            return
        }

        val output = File(draft.directory, "voice-note.m4a")
        try {
            checkNotNull(draft.directory.parentFile).mkdirs()
            draft.directory.mkdirs()
            val newRecorder =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(appContext)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }
            recorder = newRecorder
            newRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            newRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            newRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            newRecorder.setAudioSamplingRate(44_100)
            newRecorder.setAudioEncodingBitRate(96_000)
            newRecorder.setOutputFile(output.absolutePath)
            newRecorder.prepare()
            newRecorder.start()
            recordingStartedAtMs = SystemClock.elapsedRealtime()
            _uiState.value =
                _uiState.value.copy(
                    isRecording = true,
                    recordingSeconds = 0L,
                    errorMessage = null,
                )
            recordingJob?.cancel()
            recordingJob =
                scope.launch {
                    while (isActive) {
                        delay(1_000L)
                        val elapsed = (SystemClock.elapsedRealtime() - recordingStartedAtMs) / 1_000L
                        if (elapsed >= MAX_RECORDING_SECONDS) {
                            stopRecording(limitReachedMessage = "Reached the 3-minute voice note limit. Play it back or delete it below.")
                            break
                        }
                        _uiState.value = _uiState.value.copy(recordingSeconds = elapsed)
                    }
                }
        } catch (_: Exception) {
            releaseRecorder()
            output.delete()
            _uiState.value =
                _uiState.value.copy(
                    isRecording = false,
                    recordingSeconds = 0L,
                    errorMessage = "Recording could not start. Check microphone access or send a written report instead.",
                )
        }
    }

    fun stopRecording(limitReachedMessage: String? = null) {
        val activeRecorder = recorder ?: return
        val draft = _uiState.value.draft
        val output = draft?.let { File(it.directory, "voice-note.m4a") }
        recordingJob?.cancel()
        recordingJob = null
        var errorMessage: String? = limitReachedMessage
        var recordedFile: File? = null
        try {
            activeRecorder.stop()
            if (output?.isFile == true && output.length() > 0L) {
                recordedFile = output
            } else {
                errorMessage = "No audio was recorded. Try again or send a written report."
            }
        } catch (_: Exception) {
            output?.delete()
            errorMessage = "That recording was too short or could not be saved. Try again or send a written report."
        } finally {
            releaseRecorder()
        }
        val currentDraft = _uiState.value.draft
        _uiState.value =
            _uiState.value.copy(
                draft = currentDraft?.copy(voiceNote = recordedFile),
                isRecording = false,
                recordingSeconds = 0L,
                errorMessage = errorMessage,
            )
    }

    fun deleteVoiceNote() {
        stopPlayback()
        val draft = _uiState.value.draft ?: return
        val voiceNote = draft.voiceNote ?: return
        if (voiceNote.exists() && !voiceNote.delete()) {
            _uiState.value = _uiState.value.copy(errorMessage = "The voice note could not be deleted. Discard this report and try again.")
            return
        }
        _uiState.value = _uiState.value.copy(draft = draft.copy(voiceNote = null), errorMessage = null)
    }

    fun startPlayback() {
        if (_uiState.value.isPlaying) {
            stopPlayback()
            return
        }
        val voiceNote = _uiState.value.draft?.voiceNote ?: return
        playAudioFile(
            file = voiceNote,
            onStarted = { _uiState.value = _uiState.value.copy(isPlaying = true, playingInboxItemId = null, errorMessage = null) },
            onError = { _uiState.value = _uiState.value.copy(errorMessage = "The voice note could not be played.") },
        )
    }

    fun toggleInboxVoicePlayback(item: BetaFeedbackInboxItem) {
        if (_uiState.value.playingInboxItemId == item.id) {
            stopPlayback()
            return
        }
        val voiceNote = item.voiceNote ?: return
        stopPlayback()
        playAudioFile(
            file = voiceNote,
            onStarted = { _uiState.value = _uiState.value.copy(isPlaying = false, playingInboxItemId = item.id, inboxErrorMessage = null) },
            onError = { _uiState.value = _uiState.value.copy(inboxErrorMessage = "The saved voice note could not be played.") },
        )
    }

    private fun playAudioFile(
        file: File,
        onStarted: () -> Unit,
        onError: () -> Unit,
    ) {
        try {
            val mediaPlayer = MediaPlayer()
            player = mediaPlayer
            mediaPlayer.setDataSource(file.absolutePath)
            mediaPlayer.setOnCompletionListener { stopPlayback() }
            mediaPlayer.setOnErrorListener { _, _, _ ->
                stopPlayback()
                onError()
                true
            }
            mediaPlayer.prepare()
            mediaPlayer.start()
            onStarted()
        } catch (_: Exception) {
            stopPlayback()
            onError()
        }
    }

    fun stopPlayback() {
        try {
            player?.stop()
        } catch (_: Exception) {
        }
        player?.release()
        player = null
        if (_uiState.value.isPlaying || _uiState.value.playingInboxItemId != null) {
            _uiState.value = _uiState.value.copy(isPlaying = false, playingInboxItemId = null)
        }
    }

    fun shareFeedback(note: String) {
        if (_uiState.value.isRecording) stopRecording()
        stopPlayback()
        val draft = _uiState.value.draft ?: return
        val cleanNote = note.trim().take(MAX_FEEDBACK_NOTE_LENGTH)
        if (cleanNote.isEmpty() && draft.voiceNote?.isFile != true) {
            _uiState.value =
                _uiState.value.copy(
                    errorMessage = "Describe the issue in writing or attach a voice note before sharing.",
                )
            return
        }
        if (_uiState.value.isExporting || _uiState.value.isRedactingScreenshot) return
        _uiState.value =
            _uiState.value.copy(
                pendingAction = BetaFeedbackPendingAction.SHARING_SINGLE,
                errorMessage = null,
            )
        scope.launch {
            val result =
                runCatching {
                    withContext(exportDispatcher) {
                        val packagesDir = File(appContext.cacheDir, "beta-feedback/packages")
                        pruneOldPackages(packagesDir)
                        packageBuilder.build(
                            draft = draft,
                            note = cleanNote,
                            packageDirectory = packagesDir,
                        )
                    }
                }
            if (destroyed) return@launch
            val packageFile = result.getOrNull()
            if (packageFile == null) {
                _uiState.value =
                    _uiState.value.copy(
                        pendingAction = BetaFeedbackPendingAction.NONE,
                        errorMessage = "The feedback ZIP could not be created. Nothing was shared; please try again.",
                    )
                return@launch
            }
            try {
                sharePackage(attachedActivity, packageFile)
                draft.directory.deleteRecursively()
                _uiState.value = BetaFeedbackUiState()
                updateShakeRegistration()
            } catch (_: Exception) {
                _uiState.value =
                    _uiState.value.copy(
                        pendingAction = BetaFeedbackPendingAction.NONE,
                        errorMessage = "No application could open the share sheet. The ZIP remains on this device; nothing was uploaded.",
                    )
            }
        }
    }

    fun saveFeedback(note: String) {
        if (_uiState.value.isRecording) stopRecording()
        stopPlayback()
        val draft = _uiState.value.draft ?: return
        val cleanNote = note.trim().take(MAX_FEEDBACK_NOTE_LENGTH)
        if (cleanNote.isEmpty() && draft.voiceNote?.isFile != true) {
            _uiState.value =
                _uiState.value.copy(
                    errorMessage = "Describe the issue in writing or attach a voice note before saving.",
                )
            return
        }
        if (_uiState.value.isExporting || _uiState.value.isRedactingScreenshot) return
        _uiState.value =
            _uiState.value.copy(
                pendingAction = BetaFeedbackPendingAction.SAVING_TO_INBOX,
                errorMessage = null,
            )
        scope.launch {
            val result =
                runCatching {
                    withContext(exportDispatcher) {
                        inboxStore.saveDraft(draft = draft, note = cleanNote)
                    }
                }
            if (destroyed) return@launch
            if (result.isSuccess) {
                _uiState.value = BetaFeedbackUiState()
                updateShakeRegistration()
                showMessageHandler("Issue saved to feedback inbox (${inboxItems.value.size} pending)")
            } else {
                _uiState.value =
                    _uiState.value.copy(
                        pendingAction = BetaFeedbackPendingAction.NONE,
                        errorMessage = "The issue could not be saved to the feedback inbox. Your draft is still open; please try again.",
                    )
            }
        }
    }

    fun openInbox() {
        if (!isAvailable || destroyed || _uiState.value.draft != null || captureJob?.isActive == true) return
        _uiState.value = _uiState.value.copy(isInboxOpen = true, inboxErrorMessage = null)
        updateShakeRegistration()
    }

    fun closeInbox() {
        if (_uiState.value.isBatchExporting) return
        stopPlayback()
        _uiState.value = _uiState.value.copy(isInboxOpen = false, inboxErrorMessage = null)
        updateShakeRegistration()
    }

    fun clearInboxError() {
        _uiState.value = _uiState.value.copy(inboxErrorMessage = null)
    }

    fun deleteInboxItem(id: String) {
        if (_uiState.value.isBatchExporting) return
        if (_uiState.value.playingInboxItemId == id) stopPlayback()
        _uiState.value = _uiState.value.copy(isBatchExporting = true, inboxErrorMessage = null)
        scope.launch {
            val result = runCatching { withContext(exportDispatcher) { inboxStore.deleteItem(id) } }
            if (destroyed) return@launch
            _uiState.value =
                _uiState.value.copy(
                    isBatchExporting = false,
                    inboxErrorMessage =
                        if (result.isFailure) {
                            "The saved issue could not be deleted. It remains in the inbox."
                        } else {
                            null
                        },
                )
        }
    }

    fun clearInbox() {
        if (_uiState.value.isBatchExporting) return
        stopPlayback()
        _uiState.value = _uiState.value.copy(isBatchExporting = true, inboxErrorMessage = null)
        scope.launch {
            val result = runCatching { withContext(exportDispatcher) { inboxStore.clear() } }
            if (destroyed) return@launch
            _uiState.value =
                _uiState.value.copy(
                    isBatchExporting = false,
                    inboxErrorMessage =
                        if (result.isFailure) {
                            "Some saved issues could not be deleted. The remaining inbox is still shown."
                        } else {
                            null
                        },
                )
            if (result.isSuccess) showMessageHandler("Feedback inbox cleared")
        }
    }

    fun shareInbox() {
        if (_uiState.value.isBatchExporting) return
        stopPlayback()
        val items = inboxItems.value
        if (items.isEmpty()) {
            _uiState.value = _uiState.value.copy(inboxErrorMessage = "Save at least one issue before exporting the feedback inbox.")
            return
        }
        _uiState.value = _uiState.value.copy(isBatchExporting = true, inboxErrorMessage = null)
        scope.launch {
            val result =
                runCatching {
                    withContext(exportDispatcher) {
                        val packagesDir = File(appContext.cacheDir, "beta-feedback/packages")
                        pruneOldPackages(packagesDir)
                        packageBuilder.buildBatch(
                            items = items,
                            packageDirectory = packagesDir,
                        )
                    }
                }
            if (destroyed) return@launch
            val packageFile = result.getOrNull()
            if (packageFile == null) {
                _uiState.value =
                    _uiState.value.copy(
                        isBatchExporting = false,
                        inboxErrorMessage = "The feedback batch could not be created. Nothing was shared; every issue remains saved.",
                    )
                return@launch
            }
            try {
                sharePackage(attachedActivity, packageFile)
                _uiState.value =
                    _uiState.value.copy(
                        isInboxOpen = false,
                        isBatchExporting = false,
                        inboxErrorMessage = null,
                    )
                updateShakeRegistration()
                val issueLabel = if (items.size == 1) "1 issue" else "${items.size} issues"
                showMessageHandler("Share sheet opened for $issueLabel. Delivery is not confirmed; the inbox is still saved.")
            } catch (_: Exception) {
                _uiState.value =
                    _uiState.value.copy(
                        isBatchExporting = false,
                        inboxErrorMessage = "No application could open the share sheet. Every issue remains saved; nothing was uploaded.",
                    )
            }
        }
    }

    fun resetFeedbackData() {
        captureJob?.cancel()
        captureJob = null
        pendingCaptureDirectory?.deleteRecursively()
        pendingCaptureDirectory = null
        pendingCaptureId = null
        if (_uiState.value.isRecording) stopRecording()
        stopPlayback()
        scope.launch {
            runCatching {
                withContext(exportDispatcher) {
                    inboxStore.clear()
                    File(appContext.cacheDir, "beta-feedback").deleteRecursively()
                }
            }
            if (!destroyed) {
                _uiState.value = BetaFeedbackUiState()
                updateShakeRegistration()
            }
        }
    }

    private fun updateShakeRegistration() {
        if (!isAvailable || destroyed || !resumed || !_shakeEnabled.value ||
            _uiState.value.draft != null || _uiState.value.isInboxOpen || captureJob?.isActive == true
        ) {
            shakeDetector.stop()
        } else {
            shakeDetector.start()
        }
    }

    private fun releaseRecorder() {
        try {
            recorder?.reset()
            recorder?.release()
        } catch (_: Exception) {
        }
        recorder = null
    }

    internal companion object {
        const val PREFERENCES_NAME = "quizradar_beta_feedback"
        const val SHAKE_ENABLED_KEY = "shake_enabled"
        const val MAX_RECORDING_SECONDS = 180L
        private const val PACKAGE_RETENTION_MS = 24L * 60L * 60L * 1_000L
        private const val MIN_PACKAGES_TO_KEEP = 3

        internal fun pruneStaleCache(
            cacheDir: File,
            activeDraftId: String?,
            nowMs: Long = System.currentTimeMillis(),
        ) {
            pruneStaleCache(
                cacheDir = cacheDir,
                protectedDraftIds = setOfNotNull(activeDraftId),
                nowMs = nowMs,
            )
        }

        internal fun pruneStaleCache(
            cacheDir: File,
            protectedDraftIds: Set<String>,
            nowMs: Long = System.currentTimeMillis(),
        ) {
            val draftsDir = File(cacheDir, "beta-feedback/drafts")
            draftsDir.listFiles().orEmpty().forEach { entry ->
                if (entry.name !in protectedDraftIds) {
                    entry.deleteRecursively()
                }
            }
            pruneOldPackages(File(cacheDir, "beta-feedback/packages"), nowMs)
        }

        internal fun pruneOldPackages(
            packagesDir: File,
            nowMs: Long = System.currentTimeMillis(),
        ) {
            val files =
                packagesDir.listFiles().orEmpty()
                    .filter { it.isFile && it.name.endsWith(".zip") }
                    .sortedByDescending { it.lastModified() }
            files.drop(MIN_PACKAGES_TO_KEEP).forEach { file ->
                if (nowMs - file.lastModified() > PACKAGE_RETENTION_MS) {
                    file.delete()
                }
            }
        }
    }
}

/** Keeps the active feedback draft and inbox state alive across Activity configuration changes. */
class BetaFeedbackViewModel(
    application: Application,
) : ViewModel() {
    val controller: BetaFeedbackController =
        BetaFeedbackController(
            context = application,
            scope = viewModelScope,
            currentScreenName = { "Dashboard" },
            captureScreenshot = { attached, destination ->
                attached?.let { AppScreenshotCapture.captureOffMainThread(it, destination) }
            },
            sharePackage = { attached, packageFile ->
                val host = checkNotNull(attached) { "No active screen is available to open the share sheet" }
                BetaFeedbackSharer.share(host, packageFile)
            },
            packageBuilder = BetaFeedbackPackageBuilder(),
            inboxStore = BetaFeedbackInboxStore(application, preload = false),
            asyncInit = true,
        )

    override fun onCleared() {
        controller.onDestroy()
        super.onCleared()
    }

    companion object {
        fun provideFactory(application: Application): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T = BetaFeedbackViewModel(application) as T
            }
    }
}
