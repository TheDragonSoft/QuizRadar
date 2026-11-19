package com.quizradar.app.feedback

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import com.quizradar.app.BuildConfig
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class BetaFeedbackController internal constructor(
    private val activity: ComponentActivity,
    private val scope: CoroutineScope,
    private val currentScreenName: () -> String,
    private val captureScreenshot: (File) -> File?,
    private val sharePackage: (File) -> Unit,
    private val packageBuilder: BetaFeedbackPackageBuilder,
    private val exportDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    constructor(
        activity: ComponentActivity,
        scope: CoroutineScope,
        currentScreenName: () -> String,
    ) : this(
        activity = activity,
        scope = scope,
        currentScreenName = currentScreenName,
        captureScreenshot = { destination -> AppScreenshotCapture.capture(activity, destination) },
        sharePackage = { packageFile -> BetaFeedbackSharer.share(activity, packageFile) },
        packageBuilder = BetaFeedbackPackageBuilder(),
    )

    val isAvailable: Boolean = BuildConfig.BETA_FEEDBACK_ENABLED

    private val preferences = activity.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val _shakeEnabled =
        kotlinx.coroutines.flow.MutableStateFlow(
            isAvailable && preferences.getBoolean(SHAKE_ENABLED_KEY, true),
        )
    val shakeEnabled: kotlinx.coroutines.flow.StateFlow<Boolean> = _shakeEnabled

    private val _uiState = kotlinx.coroutines.flow.MutableStateFlow(BetaFeedbackUiState())
    val uiState: kotlinx.coroutines.flow.StateFlow<BetaFeedbackUiState> = _uiState

    private val shakeDetector =
        ShakeDetector(activity) {
            openFeedback(currentScreenName())
        }
    private var resumed = false
    private var destroyed = false
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var recordingJob: Job? = null
    private var recordingStartedAtMs = 0L

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
        shakeDetector.stop()
        recordingJob?.cancel()
        releaseRecorder()
        stopPlayback()
    }

    fun setShakeEnabled(enabled: Boolean) {
        if (!isAvailable) return
        preferences.edit().putBoolean(SHAKE_ENABLED_KEY, enabled).apply()
        _shakeEnabled.value = enabled
        updateShakeRegistration()
    }

    fun openFeedback(screenName: String) {
        if (!isAvailable || destroyed || _uiState.value.draft != null) return
        shakeDetector.stop()
        val initialDraft = newFeedbackDraft(activity.cacheDir, screenName)
        var captureFailed = false
        val screenshot =
            try {
                captureScreenshot(File(initialDraft.directory, "screenshot.png"))
            } catch (_: Exception) {
                captureFailed = true
                null
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
    }

    fun dismiss() {
        if (_uiState.value.isExporting) return
        if (_uiState.value.isRecording) stopRecording()
        stopPlayback()
        _uiState.value.draft?.directory?.deleteRecursively()
        _uiState.value = BetaFeedbackUiState()
        updateShakeRegistration()
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(errorMessage = null)
    }

    fun removeScreenshot() {
        val draft = _uiState.value.draft ?: return
        val screenshot = draft.screenshot ?: return
        if (screenshot.exists() && !screenshot.delete()) {
            _uiState.value = _uiState.value.copy(errorMessage = "The screenshot could not be removed. Discard this report and try again.")
            return
        }
        _uiState.value = _uiState.value.copy(draft = draft.copy(screenshot = null), errorMessage = null)
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
            ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) !=
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
                    MediaRecorder(activity)
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

    fun stopRecording() {
        val activeRecorder = recorder ?: return
        val draft = _uiState.value.draft
        val output = draft?.let { File(it.directory, "voice-note.m4a") }
        recordingJob?.cancel()
        recordingJob = null
        var errorMessage: String? = null
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
        try {
            val mediaPlayer = MediaPlayer()
            player = mediaPlayer
            mediaPlayer.setDataSource(voiceNote.absolutePath)
            mediaPlayer.setOnCompletionListener { stopPlayback() }
            mediaPlayer.setOnErrorListener { _, _, _ ->
                stopPlayback()
                _uiState.value = _uiState.value.copy(errorMessage = "The voice note could not be played.")
                true
            }
            mediaPlayer.prepare()
            mediaPlayer.start()
            _uiState.value = _uiState.value.copy(isPlaying = true, errorMessage = null)
        } catch (_: Exception) {
            stopPlayback()
            _uiState.value = _uiState.value.copy(errorMessage = "The voice note could not be played.")
        }
    }

    fun stopPlayback() {
        try {
            player?.stop()
        } catch (_: Exception) {
        }
        player?.release()
        player = null
        if (_uiState.value.isPlaying) _uiState.value = _uiState.value.copy(isPlaying = false)
    }

    fun shareFeedback(note: String) {
        if (_uiState.value.isRecording) stopRecording()
        val draft = _uiState.value.draft ?: return
        val cleanNote = note.trim().take(MAX_FEEDBACK_NOTE_LENGTH)
        if (cleanNote.isEmpty() && draft.voiceNote?.isFile != true) {
            _uiState.value =
                _uiState.value.copy(
                    errorMessage = "Describe the issue in writing or attach a voice note before sharing.",
                )
            return
        }
        if (_uiState.value.isExporting) return
        _uiState.value = _uiState.value.copy(isExporting = true, errorMessage = null)
        scope.launch {
            val result =
                runCatching {
                    withContext(exportDispatcher) {
                        packageBuilder.build(
                            draft = draft,
                            note = cleanNote,
                            packageDirectory = File(activity.cacheDir, "beta-feedback/packages"),
                        )
                    }
                }
            if (destroyed) return@launch
            val packageFile = result.getOrNull()
            if (packageFile == null) {
                _uiState.value =
                    _uiState.value.copy(
                        isExporting = false,
                        errorMessage = "The feedback ZIP could not be created. Nothing was shared; please try again.",
                    )
                return@launch
            }
            try {
                sharePackage(packageFile)
                draft.directory.deleteRecursively()
                _uiState.value = BetaFeedbackUiState()
                updateShakeRegistration()
            } catch (_: Exception) {
                _uiState.value =
                    _uiState.value.copy(
                        isExporting = false,
                        errorMessage = "No application could open the share sheet. The ZIP remains on this device; nothing was uploaded.",
                    )
            }
        }
    }

    private fun updateShakeRegistration() {
        if (!isAvailable || destroyed || !resumed || !_shakeEnabled.value || _uiState.value.draft != null) {
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

    private companion object {
        const val PREFERENCES_NAME = "quizradar_beta_feedback"
        const val SHAKE_ENABLED_KEY = "shake_enabled"
    }
}
