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
     *
     * It must also dispatch the RESUMPTION of a pending native call. UniFFI
     * wakes a pending export from the Rust side while holding its scheduler
     * lock, so a dispatcher that resumes inline (`Dispatchers.Unconfined`)
     * re-enters the poll and deadlocks on that lock. Use a dispatching
     * dispatcher - the default one is `Dispatchers.IO`-based.
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

    // ------------------------------------------------------------------
    // Persistent operations (audit: deleted feed stays deleted without
    // changing preferences; reset covers all owned data; attendance/focus
    // restart persistence).
    //
    // Every method below has a SAFE DEFAULT that throws, so pre-existing
    // test fakes implementing this interface keep compiling; the real
    // [QuizRadarEngine] overrides all of them with native calls.
    // ------------------------------------------------------------------

    /** Upserts an .ics feed config (https-only URL enforced by the core). */
    suspend fun saveFeed(
        feedJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("saveFeed is not supported by this fake")

    /** Deletes a feed config; unrelated state is untouched. */
    suspend fun deleteFeed(
        id: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("deleteFeed is not supported by this fake")

    /**
     * The canonical transactional reset: ONE SQLite transaction wipes every
     * owned table (feeds, config, tokens metadata, attendance, flashcards,
     * quiz attempts, mistake bank, study sessions, email caches). The shell
     * must not hand-roll a partial wipe around this.
     */
    suspend fun resetAllData(): Unit = throw UnsupportedOperationException("resetAllData is not supported by this fake")

    /** Records one attendance mark (status: `attended` | `absent` | `excused`). */
    suspend fun recordAttendance(
        slotId: String,
        courseId: String,
        date: LocalDate,
        status: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("recordAttendance is not supported by this fake")

    /**
     * Deletes the persisted attendance mark for one slot occurrence - the
     * write half of the toggle cycle's excused -> clear step (the same
     * deterministic id [recordAttendance] mints).
     */
    suspend fun deleteAttendance(
        slotId: String,
        dateIso: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("deleteAttendance is not supported by this fake")

    /** Persisted attendance entries (optionally one course). */
    suspend fun listAttendance(courseId: String? = null): String =
        throw UnsupportedOperationException("listAttendance is not supported by this fake")

    /** Per-course attendance summaries derived from the persisted records. */
    suspend fun attendanceSummaries(): String = throw UnsupportedOperationException("attendanceSummaries is not supported by this fake")

    /** Absence limit for a course; `null` clears the limit. */
    suspend fun setCourseAbsenceLimit(
        courseId: String,
        maxAbsences: UInt?,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("setCourseAbsenceLimit is not supported by this fake")

    /** Logs one real study session (focus timer / manual entry). */
    suspend fun logStudySession(
        sessionJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("logStudySession is not supported by this fake")

    /** Persisted study sessions (optionally one course) — never fabricated. */
    suspend fun listStudySessions(courseId: String? = null): String =
        throw UnsupportedOperationException("listStudySessions is not supported by this fake")

    /** Study analytics derived from the persisted session log. */
    suspend fun getStudyAnalytics(refDate: LocalDate = LocalDate.now()): String =
        throw UnsupportedOperationException("getStudyAnalytics is not supported by this fake")

    // ------------------------------------------------------------------
    // Parity surface for later UI (Grade Center/GPA, flashcards, mistake
    // bank, attempt history) — same safe-default pattern.
    // ------------------------------------------------------------------

    /** Single-assessment upsert (manual creation / edit). */
    suspend fun upsertAssessment(
        assessmentJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("upsertAssessment is not supported by this fake")

    suspend fun deleteAssessment(
        id: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("deleteAssessment is not supported by this fake")

    fun calculateGpa(
        coursesJson: String,
        assessmentsJson: String,
        gradesJson: String,
        scale: String,
    ): String = throw UnsupportedOperationException("calculateGpa is not supported by this fake")

    suspend fun listQuizAttempts(assessmentId: String? = null): String =
        throw UnsupportedOperationException("listQuizAttempts is not supported by this fake")

    suspend fun saveQuizAttempt(
        attemptJson: String,
        mistakesJson: String,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("saveQuizAttempt is not supported by this fake")

    suspend fun listMistakes(assessmentId: String? = null): String =
        throw UnsupportedOperationException("listMistakes is not supported by this fake")

    suspend fun resolveMistake(mistakeId: String): String =
        throw UnsupportedOperationException("resolveMistake is not supported by this fake")

    suspend fun upsertFlashcard(cardJson: String): String =
        throw UnsupportedOperationException("upsertFlashcard is not supported by this fake")

    suspend fun listFlashcards(courseId: String? = null): String =
        throw UnsupportedOperationException("listFlashcards is not supported by this fake")

    suspend fun deleteFlashcard(cardId: String): String =
        throw UnsupportedOperationException("deleteFlashcard is not supported by this fake")

    suspend fun reviewFlashcard(
        cardId: String,
        correct: Boolean,
        refDate: LocalDate = LocalDate.now(),
    ): String = throw UnsupportedOperationException("reviewFlashcard is not supported by this fake")

    // ------------------------------------------------------------------
    // A07: consent-gated AI + real scan cancellation. The CORE owns the
    // consent gate (it reads `gemini_enabled` from the store), so a saved
    // key can never send a request while AI is disabled — the shell only
    // passes the Keystore-held key through, and it rides the
    // `x-goog-api-key` header exclusively (never an OAuth bearer).
    // ------------------------------------------------------------------

    /**
     * Requests cancellation of the in-flight native scan. A cancelled scan
     * persists NOTHING and its report carries `"cancelled": true`.
     */
    fun cancelScan(): Unit = throw UnsupportedOperationException("cancelScan is not supported by this fake")

    /**
     * Consent-gated practice-quiz generation. With AI consent on and a key,
     * Gemini Flash-Lite authors the quiz; anything else falls back to the
     * deterministic on-device authoring — the payload's `generated_by_ai` /
     * `authored_locally` labels and the extra `fallback_reason` field keep
     * that honest.
     */
    suspend fun generatePracticeQuizAi(
        assessmentJson: String,
        geminiApiKey: String? = null,
    ): String = throw UnsupportedOperationException("generatePracticeQuizAi is not supported by this fake")

    /**
     * Consent-gated "Optimize with AI" study plan. Returns
     * `{"source": "ai"|"deterministic", "note": ..., "tasks": <payload>}` —
     * the UI can always tell which planner ran.
     */
    suspend fun optimizeStudyPlan(
        refDate: LocalDate = LocalDate.now(),
        geminiApiKey: String? = null,
    ): String = throw UnsupportedOperationException("optimizeStudyPlan is not supported by this fake")

    /**
     * Weighted grade target (`01` §4.2): what the student still needs to
     * average on the remaining weight to reach [targetLetter]. Unknown
     * weights are an honestly-labeled equal-weight assumption.
     */
    suspend fun calculateGradeTarget(
        courseId: String,
        assessmentsJson: String,
        gradesJson: String,
        scale: String,
        targetLetter: String,
    ): String = throw UnsupportedOperationException("calculateGradeTarget is not supported by this fake")
}
