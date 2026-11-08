package com.quizradar.app.core

import kotlinx.coroutines.CoroutineDispatcher
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * High-level Kotlin interface for QuizRadar operations on Android.
 * Calls Rust core over UniFFI with zero server dependencies.
 */
interface QuizRadarCore {
    /**
     * The dispatcher this core runs its native calls on.
     *
     * The core opens a SQLite store through JNA and reads the Keystore-backed
     * token store; both are slow enough to trip the ANR watchdog on the main
     * thread. The dispatcher lives HERE, in the core, so that every caller -
     * the ViewModel, the Glance widget, the reminder worker, the share
     * intent - inherits "never touch the native core on the main thread"
     * instead of having to remember it.
     */
    val coreDispatcher: CoroutineDispatcher

    /**
     * The core version string.
     *
     * This is a JNA -> Rust round trip, and the FIRST one loads the native
     * library (dlopen + runtime start-up) - slow enough to trip the ANR
     * watchdog on the main thread. It is `suspend` so every caller gets it
     * off the UI thread for free; the audit found it being called inline
     * during composition.
     */
    suspend fun version(): String

    /**
     * The user's own Gemini (BYOK) key, or `null` when there is none.
     *
     * The key lives in the Keystore-backed token store; reading it is slow,
     * so callers must do it off the main thread.
     */
    fun geminiApiKey(): String?

    suspend fun getState(refDate: LocalDate = LocalDate.now()): String

    suspend fun saveSchedule(
        scheduleJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun upsertCourse(
        courseJson: String,
        slotsJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun deleteCourse(
        code: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun replaceAssessments(
        assessmentsJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun toggleTopic(
        topicKey: String,
        done: Boolean,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun updateGrade(
        assessmentId: String,
        achieved: Double?,
        max: Double?,
        weightage: Double?,
        clearAchieved: Boolean = false,
        clearMax: Boolean = false,
        clearWeightage: Boolean = false,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun upsertCustomEvent(
        eventJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun deleteCustomEvent(
        id: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    suspend fun setConfigString(
        key: String,
        value: String?,
    )

    suspend fun getConfigString(key: String): String?

    suspend fun setConfigBool(
        key: String,
        value: Boolean,
    )

    suspend fun getConfigBool(
        key: String,
        default: Boolean,
    ): Boolean

    suspend fun exportBackup(refDate: LocalDate = LocalDate.now()): String

    suspend fun importBackup(
        backupJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    /**
     * The AI timetable-image extraction (`01` §4.1).
     *
     * The image is base64 (no data-URL prefix) and the key is the user's own
     * BYOK Gemini key; both travel into the Rust core, which owns the prompt,
     * the validation and the drop rules. The key never leaves the device
     * except in the `x-goog-api-key` header of the Gemini request.
     */
    suspend fun extractTimetableFromImage(
        imageB64: String,
        mime: String,
        apiKey: String,
    ): String

    fun parseEmail(
        emailJson: String,
        scheduleJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    fun parseIcs(
        content: String,
        scheduleJson: String,
        refDate: LocalDate = LocalDate.now(),
        offsetSeconds: Int = ZoneId.systemDefault().rules.getOffset(Instant.now()).totalSeconds,
    ): String

    fun radarOrder(
        assessmentsJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    fun deriveDashboard(
        assessmentsJson: String,
        topicsJson: String,
        eventsJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    fun deriveStudyTasks(
        assessmentsJson: String,
        topicsJson: String,
        refDate: LocalDate = LocalDate.now(),
        // The declared academic rhythm ("med" | "eng" | "biz"); an empty
        // string behaves like the default spread.
        academicTrack: String = "",
    ): String

    fun detectConflicts(
        assessmentsJson: String,
        eventsJson: String,
    ): String

    fun generateStudyBlocks(
        assessmentJson: String,
        scheduleJson: String,
        eventsJson: String,
        today: LocalDate = LocalDate.now(),
    ): String

    /**
     * Serializes the calendar into an `.ics` document.
     *
     * `suspend` for the same reason as [version]: the native call is
     * blocking, and the audit found the button handler running it on the
     * UI thread.
     */
    suspend fun exportIcs(
        assessmentsJson: String,
        assessmentId: String? = null,
    ): String

    fun generatePracticeQuiz(assessmentJson: String): String

    fun mergeSync(
        existingJson: String,
        incomingJson: String,
    ): String

    fun buildGoogleAuthUrl(
        clientId: String,
        redirectUri: String,
    ): String

    fun buildMicrosoftAuthUrl(
        clientId: String,
        redirectUri: String,
    ): String

    suspend fun exchangeOAuthCode(
        provider: String,
        clientId: String,
        code: String,
        redirectUri: String,
        codeVerifier: String,
        tokenEndpointOverride: String? = null,
    ): String

    fun notificationIdFor(
        assessmentId: String,
        kind: String,
    ): Int
}
