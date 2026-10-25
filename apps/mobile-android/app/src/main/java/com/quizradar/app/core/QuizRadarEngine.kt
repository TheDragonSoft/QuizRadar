package com.quizradar.app.core

import android.content.Context
import java.time.Instant
import java.time.LocalDate

class QuizRadarEngine(
    val store: NativeStoreInterface,
    val tokenProvider: TokenProvider,
) : QuizRadarCore {
    override fun version(): String {
        return coreVersion()
    }

    private fun nowIso(): String = Instant.now().toString()

    override suspend fun getState(refDate: LocalDate): String {
        return store.getState(refDate.toString())
    }

    override suspend fun saveSchedule(
        scheduleJson: String,
        refDate: LocalDate,
    ): String {
        return store.saveSchedule(scheduleJson, nowIso(), refDate.toString())
    }

    override suspend fun upsertCourse(
        courseJson: String,
        slotsJson: String,
        refDate: LocalDate,
    ): String {
        return store.upsertCourse(courseJson, slotsJson, nowIso(), refDate.toString())
    }

    override suspend fun deleteCourse(
        code: String,
        refDate: LocalDate,
    ): String {
        return store.deleteCourse(code, nowIso(), refDate.toString())
    }

    override suspend fun replaceAssessments(
        assessmentsJson: String,
        refDate: LocalDate,
    ): String {
        return store.replaceAssessments(assessmentsJson, nowIso(), refDate.toString())
    }

    override suspend fun toggleTopic(
        topicKey: String,
        done: Boolean,
        refDate: LocalDate,
    ): String {
        return store.toggleTopic(topicKey, done, nowIso(), refDate.toString())
    }

    override suspend fun updateGrade(
        assessmentId: String,
        achieved: Double?,
        max: Double?,
        weightage: Double?,
        refDate: LocalDate,
    ): String {
        return store.updateGrade(assessmentId, achieved, max, weightage, nowIso(), refDate.toString())
    }

    override suspend fun upsertCustomEvent(
        eventJson: String,
        refDate: LocalDate,
    ): String {
        return store.upsertCustomEvent(eventJson, nowIso(), refDate.toString())
    }

    override suspend fun deleteCustomEvent(
        id: String,
        refDate: LocalDate,
    ): String {
        return store.deleteCustomEvent(id, nowIso(), refDate.toString())
    }

    override suspend fun setConfigString(
        key: String,
        value: String?,
    ) {
        store.setConfigString(key, value)
    }

    override suspend fun getConfigString(key: String): String? {
        return store.getConfigString(key)
    }

    override suspend fun setConfigBool(
        key: String,
        value: Boolean,
    ) {
        store.setConfigBool(key, value)
    }

    override suspend fun getConfigBool(
        key: String,
        default: Boolean,
    ): Boolean {
        return store.getConfigBool(key, default)
    }

    override suspend fun exportBackup(refDate: LocalDate): String {
        return store.exportBackup(nowIso(), refDate.toString())
    }

    override suspend fun importBackup(
        backupJson: String,
        refDate: LocalDate,
    ): String {
        return store.importBackup(backupJson, nowIso(), refDate.toString())
    }

    override fun parseEmail(
        emailJson: String,
        scheduleJson: String,
        refDate: LocalDate,
    ): String {
        return parseEmail(emailJson, scheduleJson, refDate.toString())
    }

    override fun parseIcs(
        content: String,
        scheduleJson: String,
        refDate: LocalDate,
    ): String {
        return parseIcs(content, scheduleJson, refDate.toString())
    }

    override fun radarOrder(
        assessmentsJson: String,
        refDate: LocalDate,
    ): String {
        return radarOrderList(assessmentsJson, refDate.toString())
    }

    override fun deriveDashboard(
        assessmentsJson: String,
        topicsJson: String,
        eventsJson: String,
        refDate: LocalDate,
    ): String {
        return deriveDashboardSummary(assessmentsJson, topicsJson, eventsJson, refDate.toString())
    }

    override fun deriveStudyTasks(
        assessmentsJson: String,
        topicsJson: String,
        refDate: LocalDate,
    ): String {
        return deriveStudyTasks(assessmentsJson, topicsJson, refDate.toString())
    }

    override fun detectConflicts(
        assessmentsJson: String,
        eventsJson: String,
    ): String {
        return detectScheduleConflicts(assessmentsJson, eventsJson)
    }

    override fun generateStudyBlocks(
        assessmentJson: String,
        scheduleJson: String,
        eventsJson: String,
        today: LocalDate,
    ): String {
        return generateStudyBlocksForExam(assessmentJson, scheduleJson, eventsJson, today.toString())
    }

    override fun exportIcs(
        assessmentsJson: String,
        assessmentId: String?,
    ): String {
        return exportIcsCalendar(assessmentsJson, assessmentId)
    }

    override fun generatePracticeQuiz(assessmentJson: String): String {
        return generatePracticeMcq(assessmentJson)
    }

    override fun mergeSync(
        existingJson: String,
        incomingJson: String,
    ): String {
        return mergeSyncAssessments(existingJson, incomingJson)
    }

    companion object {
        /**
         * Initialize QuizRadarEngine for the Android application context.
         * Opens native SQLite database in app-private files directory and sets up
         * EncryptedSharedPreferences for credentials.
         */
        fun create(context: Context): QuizRadarEngine {
            val dbPath = context.filesDir.resolve("quizradar.db").absolutePath
            val store = openNativeStore(dbPath)
            val tokenProvider = EncryptedTokenStore(context)
            return QuizRadarEngine(store, tokenProvider)
        }

        /**
         * Initialize an in-memory QuizRadarEngine for unit testing and Robolectric.
         */
        fun createInMemory(tokenProvider: TokenProvider = MemoryTokenStore()): QuizRadarEngine {
            val store = openInMemoryNativeStore()
            return QuizRadarEngine(store, tokenProvider)
        }
    }
}
