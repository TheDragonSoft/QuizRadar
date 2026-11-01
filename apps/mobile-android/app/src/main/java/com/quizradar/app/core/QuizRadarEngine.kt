package com.quizradar.app.core

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate

class QuizRadarEngine(
    private val storeProvider: () -> NativeStoreInterface,
    private val tokenProviderProvider: () -> TokenProvider,
) : QuizRadarCore {
    /**
     * The native store and the Keystore-backed token store are BUILT LAZY.
     *
     * Both are expensive: opening the SQLite store pulls in the Rust core
     * through JNA (dlopen + runtime start-up) and the token store creates an
     * Android Keystore master key. Building them while the UI thread is
     * starting up blocked the first frame for seconds and made the app look
     * frozen (the system showed "app isn't responding").
     *
     * The first call now happens from a background dispatcher (see
     * `QuizRadarViewModel.loadState`), so the cost lands off the main thread.
     */
    private val store: NativeStoreInterface by lazy(LazyThreadSafetyMode.SYNCHRONIZED, storeProvider)

    val tokenProvider: TokenProvider by lazy(LazyThreadSafetyMode.SYNCHRONIZED, tokenProviderProvider)

    /** Direct-construction seam for tests and for callers that already own both parts. */
    constructor(
        store: NativeStoreInterface,
        tokenProvider: TokenProvider,
    ) : this({ store }, { tokenProvider })

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
        clearAchieved: Boolean,
        clearMax: Boolean,
        clearWeightage: Boolean,
        refDate: LocalDate,
    ): String {
        return store.updateGrade(
            assessmentId,
            achieved,
            max,
            weightage,
            clearAchieved,
            clearMax,
            clearWeightage,
            nowIso(),
            refDate.toString(),
        )
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

    override fun buildGoogleAuthUrl(
        clientId: String,
        redirectUri: String,
    ): String {
        return com.quizradar.app.core.buildGoogleAuthUrl(clientId, redirectUri)
    }

    override fun buildMicrosoftAuthUrl(
        clientId: String,
        redirectUri: String,
    ): String {
        return com.quizradar.app.core.buildMicrosoftAuthUrl(clientId, redirectUri)
    }

    override suspend fun exchangeOAuthCode(
        provider: String,
        clientId: String,
        code: String,
        redirectUri: String,
        codeVerifier: String,
        tokenEndpointOverride: String?,
    ): String {
        return withContext(Dispatchers.IO) {
            com.quizradar.app.core.exchangeOauthCode(
                provider = provider,
                clientId = clientId,
                code = code,
                redirectUri = redirectUri,
                codeVerifier = codeVerifier,
                tokenEndpointOverride = tokenEndpointOverride,
            )
        }
    }

    override fun notificationIdFor(
        assessmentId: String,
        kind: String,
    ): Int {
        return com.quizradar.app.core.notificationIdFor(assessmentId, kind)
    }

    companion object {
        /**
         * Process-scoped cache: after an Activity recreation (rotation, theme
         * change, dark-mode switch) the ViewModel survives and stays bound to
         * the ORIGINAL engine, while a fresh `create` would hand OAuth and
         * widget callers a SECOND store/token provider the UI never sees.
         * Keyed by dbPath so tests with in-memory stores are unaffected.
         *
         * Workers (WorkManager background dispatcher) and the UI (main thread)
         * both call create() — a plain HashMap would be an unsynchronized
         * cross-thread read/write, so use a ConcurrentHashMap + computeIfAbsent.
         */
        private val cachedEngines = java.util.concurrent.ConcurrentHashMap<String, QuizRadarEngine>()

        /**
         * Initialize QuizRadarEngine for the Android application context.
         * Opens native SQLite database in app-private files directory and sets up
         * EncryptedSharedPreferences for credentials. Returns the cached
         * process-wide instance when one already exists for this database.
         *
         * The application context is used on purpose: the engine is cached for
         * the whole process lifetime, so holding on to an Activity context
         * would leak it (and its whole view tree) until the process dies.
         */
        fun create(context: Context): QuizRadarEngine {
            val appContext = context.applicationContext
            val dbPath = appContext.filesDir.resolve("quizradar.db").absolutePath
            return cachedEngines.computeIfAbsent(dbPath) {
                QuizRadarEngine(
                    storeProvider = { openNativeStore(dbPath) },
                    tokenProviderProvider = { EncryptedTokenStore(appContext) },
                )
            }
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
