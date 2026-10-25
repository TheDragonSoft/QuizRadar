package com.quizradar.app.core

import java.time.LocalDate

/**
 * High-level Kotlin interface for QuizRadar operations on Android.
 * Calls Rust core over UniFFI with zero server dependencies.
 */
interface QuizRadarCore {
    fun version(): String

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

    fun parseEmail(
        emailJson: String,
        scheduleJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String

    fun parseIcs(
        content: String,
        scheduleJson: String,
        refDate: LocalDate = LocalDate.now(),
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

    fun exportIcs(
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
