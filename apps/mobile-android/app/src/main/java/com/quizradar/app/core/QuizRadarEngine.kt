package com.quizradar.app.core

import android.content.Context
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate

class QuizRadarEngine(
    private val storeProvider: () -> NativeStoreInterface,
    private val tokenProviderProvider: () -> TokenProvider,
    /**
     * The dispatcher every native store call runs on.
     *
     * A single-threaded view of the IO pool: the store calls stay serialized
     * (the SQLite connection is not safe to use from several threads at once)
     * but they never run on the main thread. Opening the store pulls in the
     * Rust core through JNA (dlopen + runtime start-up) and the token store
     * creates an Android Keystore master key - both are slow enough to trip
     * the ANR watchdog when they happen on the UI thread.
     *
     * The dispatcher belongs to the ENGINE, not to the ViewModel: every
     * caller (the UI, the Glance widget, the reminder worker, the share
     * intent) then inherits "no native call on the main thread" for free.
     */
    override val coreDispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1),
    /**
     * The dispatcher for the calls that talk to the network (the OAuth token
     * exchange and the Gemini timetable extraction).
     *
     * It is deliberately NOT the serialized store dispatcher: a Gemini
     * round-trip can take a minute, and it must not block every other core
     * call for that minute.
     */
    private val networkDispatcher: CoroutineDispatcher = Dispatchers.IO,
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
     * The first call now happens from [coreDispatcher] (every suspend method
     * below runs on it), so the cost lands off the main thread.
     */
    private val store: NativeStoreInterface by lazy(LazyThreadSafetyMode.SYNCHRONIZED, storeProvider)

    val tokenProvider: TokenProvider by lazy(LazyThreadSafetyMode.SYNCHRONIZED, tokenProviderProvider)

    /** Direct-construction seam for tests and for callers that already own both parts. */
    constructor(
        store: NativeStoreInterface,
        tokenProvider: TokenProvider,
        coreDispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1),
    ) : this({ store }, { tokenProvider }, coreDispatcher)

    /**
     * Runs one native store call on [coreDispatcher].
     *
     * This is the single place where the "no native call on the main thread"
     * rule is enforced, so a new core method cannot forget it.
     */
    private suspend fun <T> onCore(block: suspend () -> T): T = withContext(coreDispatcher) { block() }

    override suspend fun version(): String {
        return onCore { coreVersion() }
    }

    override fun geminiApiKey(): String? {
        return tokenProvider.getGeminiApiKey()
    }

    private fun nowIso(): String = Instant.now().toString()

    override suspend fun getState(refDate: LocalDate): String {
        return onCore { store.getState(refDate.toString()) }
    }

    override suspend fun saveSchedule(
        scheduleJson: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.saveSchedule(scheduleJson, nowIso(), refDate.toString()) }
    }

    override suspend fun upsertCourse(
        courseJson: String,
        slotsJson: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.upsertCourse(courseJson, slotsJson, nowIso(), refDate.toString()) }
    }

    override suspend fun deleteCourse(
        code: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.deleteCourse(code, nowIso(), refDate.toString()) }
    }

    override suspend fun replaceAssessments(
        assessmentsJson: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.replaceAssessments(assessmentsJson, nowIso(), refDate.toString()) }
    }

    override suspend fun toggleTopic(
        topicKey: String,
        done: Boolean,
        refDate: LocalDate,
    ): String {
        return onCore { store.toggleTopic(topicKey, done, nowIso(), refDate.toString()) }
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
        return onCore {
            store.updateGrade(
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
    }

    override suspend fun upsertCustomEvent(
        eventJson: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.upsertCustomEvent(eventJson, nowIso(), refDate.toString()) }
    }

    override suspend fun deleteCustomEvent(
        id: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.deleteCustomEvent(id, nowIso(), refDate.toString()) }
    }

    override suspend fun setConfigString(
        key: String,
        value: String?,
    ) {
        onCore { store.setConfigString(key, value) }
    }

    override suspend fun getConfigString(key: String): String? {
        return onCore { store.getConfigString(key) }
    }

    override suspend fun setConfigBool(
        key: String,
        value: Boolean,
    ) {
        onCore { store.setConfigBool(key, value) }
    }

    override suspend fun getConfigBool(
        key: String,
        default: Boolean,
    ): Boolean {
        return onCore { store.getConfigBool(key, default) }
    }

    override suspend fun exportBackup(refDate: LocalDate): String {
        return onCore { store.exportBackup(nowIso(), refDate.toString()) }
    }

    override suspend fun importBackup(
        backupJson: String,
        refDate: LocalDate,
    ): String {
        return onCore { store.importBackup(backupJson, nowIso(), refDate.toString()) }
    }

    override suspend fun extractTimetableFromImage(
        imageB64: String,
        mime: String,
        apiKey: String,
    ): String {
        // A network round-trip to Gemini: it runs on the network dispatcher,
        // not on the single threaded store dispatcher (it would block every
        // other core call for up to a minute) and never on the main thread.
        return withContext(networkDispatcher) {
            store.extractTimetableFromImage(imageB64, mime, apiKey)
        }
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
        offsetSeconds: Int,
    ): String {
        return com.quizradar.app.core.parseIcs(content, scheduleJson, refDate.toString(), offsetSeconds)
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
        academicTrack: String,
    ): String {
        return deriveStudyTasks(assessmentsJson, topicsJson, refDate.toString(), academicTrack)
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

    override suspend fun exportIcs(
        assessmentsJson: String,
        assessmentId: String?,
    ): String {
        return onCore { exportIcsCalendar(assessmentsJson, assessmentId) }
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
        return withContext(networkDispatcher) {
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

    /**
     * The OAuth client ids the token callback uses for silent refreshes.
     *
     * `bearerToken` is a SYNCHRONOUS UniFFI callback - it cannot suspend to
     * read the config store - so the shell caches the ids here whenever it
     * loads config (the ViewModel's loadState, the background worker before
     * its run). Empty by default: a refresh without a client id returns null
     * and the core reports the source honestly.
     */
    @Volatile
    var oauthClientIds: OAuthClientIds = OAuthClientIds.EMPTY

    /**
     * The Google half of the core's token callback.
     *
     * Built per call (not stored): it wraps the process-wide token store, and
     * the served-token TTL state must not outlive the run it was built for.
     */
    fun googleFfiTokens(): EngineFfiTokens = EngineFfiTokens(tokenProvider, google = true, clientIds = oauthClientIds)

    fun microsoftFfiTokens(): EngineFfiTokens = EngineFfiTokens(tokenProvider, google = false, clientIds = oauthClientIds)

    /**
     * Runs the full on-device source scan (Gmail/Teams/Moodle/Classroom/.ics
     * feeds) and persists the merged radar - the same Rust orchestration the
     * desktop shell calls. The report JSON is parsed by the ViewModel layer.
     *
     * Tokens reach the core only through the [EngineFfiTokens] callbacks, and
     * only for the providers this config actually enables - a source that is
     * disabled or not signed in never sees a token provider at all.
     *
     * Runs on the serialized store dispatcher like every other native call;
     * the core enforces single-flight itself (an overlapping run errors).
     */
    suspend fun runNativeSync(
        syncConfig: FfiSyncConfig,
        progress: FfiSyncProgressListener,
    ): String {
        return onCore {
            val googleTokens = if (syncConfig.gmailEnabled || syncConfig.classroomEnabled) googleFfiTokens() else null
            val microsoftTokens = if (syncConfig.teamsEnabled) microsoftFfiTokens() else null
            store.runNativeSync(
                syncConfig,
                todayIso(),
                zoneOffsetSeconds(),
                nowIso(),
                localStamp(),
                progress,
                googleTokens,
                microsoftTokens,
            )
        }
    }

    /**
     * Pushes every dated upcoming assessment to the user's primary Google
     * Calendar. Returns the report JSON (`created`/`updated`/`needsScope`…).
     */
    suspend fun pushGcal(tokens: FfiTokenProvider = googleFfiTokens()): String {
        return onCore {
            store.pushNativeGcal(todayIso(), zoneOffsetSeconds(), localStamp(), tokens, null)
        }
    }

    /**
     * Pushes the data-only Drive-appDataFolder backup. `deviceId` marks the
     * pushing device inside the payload; it must be stable per device.
     */
    suspend fun pushDriveBackup(
        deviceId: String,
        tokens: FfiTokenProvider = googleFfiTokens(),
    ): String {
        return onCore {
            store.pushNativeDriveBackup(deviceId, nowIso(), localStamp(), tokens)
        }
    }

    /**
     * Pulls and additively merges the Drive backup. Returns
     * `{"found": bool, "mergeReport": {...}|null}`.
     */
    suspend fun pullDriveBackup(tokens: FfiTokenProvider = googleFfiTokens()): String {
        return onCore {
            store.pullNativeDriveBackup(todayIso(), nowIso(), tokens)
        }
    }

    private fun todayIso(): String = LocalDate.now().toString()

    private fun localStamp(): String =
        java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))

    private fun zoneOffsetSeconds(): Int = java.time.ZoneOffset.systemDefault().rules.getOffset(java.time.Instant.now()).totalSeconds

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
         *
         * The dispatcher is injectable so a test can hand in the test
         * dispatcher: a real background dispatcher would race the test
         * scheduler and make `advanceUntilIdle()` return before the core
         * call had finished.
         */
        fun createInMemory(
            tokenProvider: TokenProvider = MemoryTokenStore(),
            coreDispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1),
        ): QuizRadarEngine {
            val store = openInMemoryNativeStore()
            return QuizRadarEngine(store, tokenProvider, coreDispatcher)
        }
    }
}
