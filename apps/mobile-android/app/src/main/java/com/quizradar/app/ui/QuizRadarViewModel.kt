package com.quizradar.app.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.quizradar.app.analytics.AnalyticsManager
import com.quizradar.app.core.OAuthClientIds
import com.quizradar.app.core.QuizRadarCore
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.AttendanceEntryModel
import com.quizradar.app.model.CourseModel
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.model.PracticeQuizModel
import com.quizradar.app.model.QuizRadarJsonParser
import com.quizradar.app.model.ScheduleSlotModel
import com.quizradar.app.notifications.NotificationHelper
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.DayOfWeek
import java.time.LocalDate

sealed interface UiState {
    object Loading : UiState

    data class Ready(val snapshot: AppSnapshotModel) : UiState

    data class Error(val message: String) : UiState
}

/**
 * Outcome of one grade write.
 *
 * The detail sheet may only claim "Grade Saved!" for [Saved] - a write that
 * threw must be reported as [Failed] with the reason (AGENTS §3 honesty
 * doctrine: a failed check fails loudly, never a fake success message).
 */
sealed interface GradeSaveResult {
    object Saved : GradeSaveResult

    data class Failed(val message: String) : GradeSaveResult
}

enum class DashboardSubTab {
    STUDY,
    ASSESSMENTS,
    OVERVIEW,
}

/**
 * The AI timetable-image import (`01` §4.1).
 *
 * The states are honest about what happened: [Working] while Gemini reads
 * the image, [Preview] with what it actually found (including the dropped
 * rows), [Failed] with the reason. There is no "imported" state that does
 * not say how many courses were saved.
 */
sealed interface TimetableImportState {
    object Idle : TimetableImportState

    object Working : TimetableImportState

    data class Preview(val extracted: com.quizradar.app.model.ExtractedTimetableModel) : TimetableImportState

    data class Failed(val message: String) : TimetableImportState
}

enum class PomodoroInterval(val minutes: Int, val label: String) {
    POMODORO(25, "Pomodoro"),
    SHORT_BREAK(5, "Short Break"),
    LONG_BREAK(15, "Long Break"),
}

/**
 * One live row of the scan overlay: the per-source pulse the core reports
 * (`FfiSyncProgressListener.onProgress`). `stage` is the core's own stage
 * label - the shell renders it verbatim instead of inventing stages.
 */
data class ScanSourceProgress(
    val name: String,
    val stage: String,
    val found: Int,
    val done: Int,
)

/**
 * Config key for the per-device id the Drive backup payload carries.
 * Generated once, persisted in the store's config table, never synced.
 */
private const val DEVICE_ID_CONFIG_KEY = "device_id"

/**
 * Total onboarding wizard steps. Must match `ONBOARDING_STEP_COUNT` in
 * `OnboardingWizardScreen` — the wizard has SIX steps since the A07/A14
 * rework (AI consent moved before import; sources and theme are their own
 * steps), and every persisted/clamped step value is bounded by this.
 */
private const val ONBOARDING_STEP_COUNT = 6

/**
 * How long the reset waits for a cancelled scan to actually return before
 * the store is wiped.
 *
 * The wait is BOUNDED on purpose: a reset must never hang, even if the
 * native call refuses to come back. The core's cancel flag aborts the
 * fetch phase (and is re-checked before every persist), so a normal scan
 * returns well inside this budget.
 */
private const val SCAN_SETTLE_TIMEOUT_MS = 5_000L

/**
 * The honest one-line summary of a scan report: real counts, real per-source
 * outcomes, the core's own notes. A scan that found nothing says exactly
 * that; a skipped-only run is not dressed up as success.
 */
internal fun buildScanSummary(report: com.quizradar.app.model.SyncReportModel): String {
    val counts = "${report.totalNew} new · ${report.totalUpdated} updated"
    val failed = report.perSource.filter { it.status == "failed" }
    val ran = report.perSource.filter { it.status == "ran" }
    val parts = mutableListOf(counts)
    if (ran.isNotEmpty()) parts.add("ran: ${ran.joinToString(", ") { it.name }}")
    failed.forEach { failure ->
        parts.add("${failure.name} failed: ${failure.detail ?: "unknown error"}")
    }
    val skipped = report.perSource.filter { it.status == "skipped" }
    if (skipped.isNotEmpty() && ran.isEmpty() && failed.isEmpty()) {
        parts.add(
            "all sources skipped: " +
                skipped.joinToString(", ") { "${it.name} (${it.detail ?: "no reason given"})" },
        )
    }
    report.notes.forEach { parts.add(it) }
    return parts.joinToString(" · ")
}

class QuizRadarViewModel(
    val core: QuizRadarCore,
    private val onStateMutated: (() -> Unit)? = null,
    /**
     * Platform cleanup for "Reset All" (audit A05): invoked exactly once,
     * AFTER the transactional wipe + reload succeeded - cancelling the shell's
     * owned notifications, clearing the pending OAuth transaction and
     * refreshing BOTH widgets against the emptied store. The ViewModel has no
     * Context of its own; MainActivity wires the real work in.
     */
    private val onDataReset: (() -> Unit)? = null,
    /**
     * The dispatcher the core reads/writes run on.
     *
     * It is the CORE's dispatcher (see `QuizRadarEngine.coreDispatcher`): the
     * engine owns it so that every caller - not just this ViewModel - keeps
     * the native store and the Keystore off the main thread. It stays
     * injectable so the unit tests can hand in the test dispatcher - a real
     * background dispatcher would race the test scheduler and make
     * `advanceUntilIdle()` return before the load had finished.
     */
    private val coreDispatcher: CoroutineDispatcher = core.coreDispatcher,
    private val clockDate: () -> LocalDate = { LocalDate.now() },
) : ViewModel() {
    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    private val _selectedTab = MutableStateFlow("Dashboard")
    val selectedTab: StateFlow<String> = _selectedTab.asStateFlow()

    fun selectTab(tabLabel: String) {
        _selectedTab.value = tabLabel
    }

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _isConflictDismissed = MutableStateFlow(false)
    val isConflictDismissed: StateFlow<Boolean> = _isConflictDismissed.asStateFlow()

    /**
     * The dashboard opens on OVERVIEW: the radar banner is above the bar and
     * the first thing the bar can show is the summary (what is due, how ready
     * you are), not an empty study list.
     */
    private val _dashboardSubTab = MutableStateFlow(DashboardSubTab.OVERVIEW)
    val dashboardSubTab: StateFlow<DashboardSubTab> = _dashboardSubTab.asStateFlow()

    private val _activeSourceFilter = MutableStateFlow("ALL")
    val activeSourceFilter: StateFlow<String> = _activeSourceFilter.asStateFlow()

    private val _activeTypeFilter = MutableStateFlow("ALL")
    val activeTypeFilter: StateFlow<String> = _activeTypeFilter.asStateFlow()

    private val _tasksCourseFilter = MutableStateFlow("ALL")
    val tasksCourseFilter: StateFlow<String> = _tasksCourseFilter.asStateFlow()

    private val _currentWeekStart = MutableStateFlow(getWeekStart(clockDate()))
    val currentWeekStart: StateFlow<LocalDate> = _currentWeekStart.asStateFlow()

    private val _selectedCalendarDate = MutableStateFlow(clockDate())
    val selectedCalendarDate: StateFlow<LocalDate> = _selectedCalendarDate.asStateFlow()

    /**
     * The ViewModel's injected "today" (production: `LocalDate.now()`).
     *
     * Every "today" highlight in the UI reads THIS instead of the real
     * clock, so a test that injects a fixed date sees exactly the "Today"
     * marks the device would show on that day.
     */
    val today: LocalDate get() = clockDate()

    // Day-rollover tracking: every "today"-derived value (due dates, countdowns,
    // daysUntil, week highlight) is computed inside the core against the date we
    // pass in — when the calendar day changes while the app is backgrounded, the
    // cached snapshot goes stale after midnight unless we reload on resume.
    private var lastLoadedDate: LocalDate? = null

    private val _activeDetailAssessmentId = MutableStateFlow<String?>(null)
    val activeDetailAssessmentId: StateFlow<String?> = _activeDetailAssessmentId.asStateFlow()

    private val _activePracticeAssessmentId = MutableStateFlow<String?>(null)
    val activePracticeAssessmentId: StateFlow<String?> = _activePracticeAssessmentId.asStateFlow()

    private val _practiceQuiz = MutableStateFlow<PracticeQuizModel?>(null)
    val practiceQuiz: StateFlow<PracticeQuizModel?> = _practiceQuiz.asStateFlow()

    private val _isPracticeLoading = MutableStateFlow(false)
    val isPracticeLoading: StateFlow<Boolean> = _isPracticeLoading.asStateFlow()

    private var practiceQuizJob: Job? = null

    /**
     * The AI timetable-image import (`01` §4.1). `null` means no import is
     * running; the UI shows the picker, the spinner or the preview from it.
     */
    private val _timetableImportState = MutableStateFlow<TimetableImportState>(TimetableImportState.Idle)
    val timetableImportState: StateFlow<TimetableImportState> = _timetableImportState.asStateFlow()

    /**
     * Which accounts are connected.
     *
     * These are read from the Keystore-backed token store, which is slow to
     * open. The flags are refreshed on the background dispatcher and cached
     * here so that a COMPOSITION can never be the thing that builds the
     * Keystore master key (that blocked the first frame for seconds).
     */
    private val _googleConnected = MutableStateFlow(false)
    val googleConnected: StateFlow<Boolean> = _googleConnected.asStateFlow()

    private val _microsoftConnected = MutableStateFlow(false)
    val microsoftConnected: StateFlow<Boolean> = _microsoftConnected.asStateFlow()

    /**
     * Why the last practice-quiz generation failed. A failed generation is
     * NOT an empty state - the user picked an exam, so the screen must say
     * what went wrong instead of telling them to pick an exam again.
     */
    private val _practiceQuizError = MutableStateFlow<String?>(null)
    val practiceQuizError: StateFlow<String?> = _practiceQuizError.asStateFlow()

    private val _activePomodoroAssessmentId = MutableStateFlow<String?>(null)
    val activePomodoroAssessmentId: StateFlow<String?> = _activePomodoroAssessmentId.asStateFlow()

    private val _activePomodoroTopic = MutableStateFlow<String?>(null)
    val activePomodoroTopic: StateFlow<String?> = _activePomodoroTopic.asStateFlow()

    /**
     * Index of the topic the timer is working on. The completion key is
     * "{assessment_id}::{topic_index}" (`01` §3), so the index has to travel
     * with the topic - a hardcoded 0 marks the first topic, not the one on
     * screen.
     */
    private val _activePomodoroTopicIndex = MutableStateFlow<Int?>(null)
    val activePomodoroTopicIndex: StateFlow<Int?> = _activePomodoroTopicIndex.asStateFlow()

    private val _activeCreateEventDraft = MutableStateFlow<com.quizradar.app.ui.share.SharedEventDraft?>(null)
    val activeCreateEventDraft: StateFlow<com.quizradar.app.ui.share.SharedEventDraft?> = _activeCreateEventDraft.asStateFlow()

    private val _toastMessage = MutableStateFlow<String?>(null)
    val toastMessage: StateFlow<String?> = _toastMessage.asStateFlow()

    private val _userName = MutableStateFlow("")
    val userName: StateFlow<String> = _userName.asStateFlow()

    private val _userEmail = MutableStateFlow("")
    val userEmail: StateFlow<String> = _userEmail.asStateFlow()

    private val _geminiApiKey = MutableStateFlow("")
    val geminiApiKey: StateFlow<String> = _geminiApiKey.asStateFlow()

    private val _geminiEnabled = MutableStateFlow(false)
    val geminiEnabled: StateFlow<Boolean> = _geminiEnabled.asStateFlow()

    private val _gmailEnabled = MutableStateFlow(true)
    val gmailEnabled: StateFlow<Boolean> = _gmailEnabled.asStateFlow()

    private val _classroomEnabled = MutableStateFlow(true)
    val classroomEnabled: StateFlow<Boolean> = _classroomEnabled.asStateFlow()

    private val _teamsEnabled = MutableStateFlow(true)
    val teamsEnabled: StateFlow<Boolean> = _teamsEnabled.asStateFlow()

    private val _notifyExam24h = MutableStateFlow(true)
    val notifyExam24h: StateFlow<Boolean> = _notifyExam24h.asStateFlow()

    private val _notifyExamSameDay = MutableStateFlow(true)
    val notifyExamSameDay: StateFlow<Boolean> = _notifyExamSameDay.asStateFlow()

    private val _notifyMorningDigest = MutableStateFlow(false)
    val notifyMorningDigest: StateFlow<Boolean> = _notifyMorningDigest.asStateFlow()

    private val _notifyMorningTime = MutableStateFlow("08:00")
    val notifyMorningTime: StateFlow<String> = _notifyMorningTime.asStateFlow()

    private val _autoSyncGcal = MutableStateFlow(false)
    val autoSyncGcal: StateFlow<Boolean> = _autoSyncGcal.asStateFlow()

    /**
     * Live scan state. `isScanning` gates re-entry (the core enforces
     * single-flight itself, but the UI must not even try), `scanProgress`
     * carries the honest per-source rows while running, and `lastScanReport`
     * keeps the last completed report so the dashboard can show what each
     * source actually did. [cancelScan] aborts the core's fetch phase; a
     * cancelled run persists NOTHING and reports `"cancelled": true`.
     */
    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

    private val _scanProgress = MutableStateFlow<List<ScanSourceProgress>>(emptyList())
    val scanProgress: StateFlow<List<ScanSourceProgress>> = _scanProgress.asStateFlow()

    private val _lastScanReport = MutableStateFlow<com.quizradar.app.model.SyncReportModel?>(null)
    val lastScanReport: StateFlow<com.quizradar.app.model.SyncReportModel?> = _lastScanReport.asStateFlow()

    /** The "Last synced" stamp, written by the core only when a source ran. */
    private val _lastSyncedStamp = MutableStateFlow<String?>(null)
    val lastSyncedStamp: StateFlow<String?> = _lastSyncedStamp.asStateFlow()

    /**
     * The user's own OAuth client ids (Settings -> Sources). Empty = the
     * built-in Google client id is used; Microsoft sign-in additionally
     * needs the user's Azure app id, so a blank teams id keeps the honest
     * "add your Azure app id" copy on Microsoft's own sign-in button.
     */
    private val _googleClientId = MutableStateFlow("")
    val googleClientId: StateFlow<String> = _googleClientId.asStateFlow()

    private val _teamsClientId = MutableStateFlow("")
    val teamsClientId: StateFlow<String> = _teamsClientId.asStateFlow()

    /**
     * Background periodic scan (explicit opt-in, default OFF). The gate the
     * worker re-checks at run time is the persisted config key; this flow
     * only mirrors it for the Settings switch.
     */
    private val _backgroundScanEnabled = MutableStateFlow(false)
    val backgroundScanEnabled: StateFlow<Boolean> = _backgroundScanEnabled.asStateFlow()

    /**
     * Appearance mode: "system" | "light" | "dark". Which dark scheme renders
     * (Obsidian or AMOLED) is NOT a mode - it is the separate
     * [preferredDarkTheme] preference, so switching modes can never silently
     * drop a chosen AMOLED scheme again.
     */
    private val _themeMode = MutableStateFlow("system")
    val themeMode: StateFlow<String> = _themeMode.asStateFlow()

    /**
     * Preferred dark theme: "obsidian" (default) | "amoled". Orthogonal to
     * [themeMode]: it applies whenever a dark scheme resolves (Dark mode, or
     * System mode with a dark system).
     */
    private val _preferredDarkTheme = MutableStateFlow("obsidian")
    val preferredDarkTheme: StateFlow<String> = _preferredDarkTheme.asStateFlow()

    /**
     * The onboarding "study track / field" preset (`01` §4.1: the
     * track/rhythm chips are persisted). `null` means the user never picked
     * one — the UI says so instead of inventing a default.
     */
    private val _academicTrack = MutableStateFlow<String?>(null)
    val academicTrack: StateFlow<String?> = _academicTrack.asStateFlow()

    private val _onboardingCompleted = MutableStateFlow(true)
    val onboardingCompleted: StateFlow<Boolean> = _onboardingCompleted.asStateFlow()

    private val _onboardingStep = MutableStateFlow(1)
    val onboardingStep: StateFlow<Int> = _onboardingStep.asStateFlow()

    private val _isSetupChecklistDismissed = MutableStateFlow(false)
    val isSetupChecklistDismissed: StateFlow<Boolean> = _isSetupChecklistDismissed.asStateFlow()

    private val _pomodoroInterval = MutableStateFlow(PomodoroInterval.POMODORO)
    val pomodoroInterval: StateFlow<PomodoroInterval> = _pomodoroInterval.asStateFlow()

    private val _pomodoroSecondsLeft = MutableStateFlow(25 * 60)
    val pomodoroSecondsLeft: StateFlow<Int> = _pomodoroSecondsLeft.asStateFlow()

    private val _pomodoroIsRunning = MutableStateFlow(false)
    val pomodoroIsRunning: StateFlow<Boolean> = _pomodoroIsRunning.asStateFlow()

    // Attendance Tracking
    //
    // The log of truth is the core's attendance store (audit A10): marks are
    // recorded with the EXPLICIT slot/course/date association the core's
    // `record_attendance` requires, reloaded from the store on launch, and
    // absence counts match the record's `course_id` exactly - never a
    // substring search inside a `slotId::date` key (generated slot ids need
    // not contain the course id).
    private val _attendanceRecords = MutableStateFlow<List<AttendanceEntryModel>>(emptyList())

    /** The persisted log itself, re-derived from the store on every load. */
    val attendanceRecords: StateFlow<List<AttendanceEntryModel>> = _attendanceRecords.asStateFlow()

    /** UI cache keyed `"{slotId}::{dateIso}"` — the format the calendar reads. */
    private val _attendanceMap = MutableStateFlow<Map<String, String>>(emptyMap())
    val attendanceMap: StateFlow<Map<String, String>> = _attendanceMap.asStateFlow()

    private fun applyAttendanceRecords(records: List<AttendanceEntryModel>) {
        _attendanceRecords.value = records
        _attendanceMap.value =
            records.associate { entry ->
                "${entry.slotId}::${entry.dateIso}" to entry.status
            }
    }

    private suspend fun reloadAttendance() {
        applyAttendanceRecords(
            QuizRadarJsonParser.parseAttendanceEntries(callCore { core.listAttendance(null) }),
        )
    }

    fun toggleAttendance(
        slotId: String,
        courseId: String,
        dateIso: String,
    ) {
        val key = "$slotId::$dateIso"
        val current = _attendanceMap.value[key]
        val next =
            when (current) {
                "attended" -> "absent"
                "absent" -> "excused"
                "excused" -> null
                else -> "attended"
            }
        _attendanceMap.update { map ->
            if (next == null) map - key else map + (key to next)
        }
        _attendanceRecords.update { records ->
            if (next == null) {
                records.filterNot { it.slotId == slotId && it.dateIso == dateIso }
            } else {
                records.filterNot { it.slotId == slotId && it.dateIso == dateIso } +
                    AttendanceEntryModel(
                        id = "att-$slotId-$dateIso",
                        slotId = slotId,
                        courseId = courseId,
                        dateIso = dateIso,
                        status = next,
                    )
            }
        }
        viewModelScope.launch {
            try {
                if (next != null) {
                    callCore {
                        core.recordAttendance(
                            slotId = slotId,
                            courseId = courseId,
                            date = LocalDate.parse(dateIso),
                            status = next,
                            refDate = clockDate(),
                        )
                    }
                } else {
                    // The excused -> clear step of the cycle persists as a
                    // deletion against the same deterministic id
                    // `recordAttendance` mints, so a cleared mark never
                    // reappears on restart.
                    callCore {
                        core.deleteAttendance(
                            slotId = slotId,
                            dateIso = dateIso,
                            refDate = clockDate(),
                        )
                    }
                }
            } catch (e: Exception) {
                // The store rejected the write: say so, then re-sync the UI to
                // what the store ACTUALLY holds - never leave a mark on screen
                // that the store does not have.
                showToast("Could not save the attendance mark: ${e.message}")
                try {
                    reloadAttendance()
                } catch (_: Exception) {
                    // The store is unreachable; the retry on next toggle/launch resyncs.
                }
            }
        }
    }

    fun getCourseAbsenceCount(courseId: String): Int {
        return _attendanceRecords.value.count { record ->
            record.status == "absent" && record.courseId.equals(courseId, ignoreCase = true)
        }
    }

    // Study Analytics
    //
    // Everything below is derived from the core's persisted session log
    // (audit A06): the shell starts EMPTY and never seeds example courses or
    // a starter streak. A completed focus session is persisted exactly once
    // via `log_study_session` and the totals are then re-read from the store
    // - the screen can only ever show history that was really saved.
    private val _studyMinutesByCourse = MutableStateFlow<Map<String, Int>>(emptyMap())
    val studyMinutesByCourse: StateFlow<Map<String, Int>> = _studyMinutesByCourse.asStateFlow()

    private val _studyStreakDays = MutableStateFlow(0)
    val studyStreakDays: StateFlow<Int> = _studyStreakDays.asStateFlow()

    private suspend fun reloadStudyAnalytics() {
        val analytics = QuizRadarJsonParser.parseStudyAnalytics(callCore { core.getStudyAnalytics(clockDate()) })
        _studyMinutesByCourse.value = analytics.minutesByCourse
        _studyStreakDays.value = analytics.currentStreakDays
    }

    fun logFocusCompleted(
        courseId: String?,
        minutes: Int,
    ) {
        if (minutes <= 0) return
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val cid = courseId?.trim()?.takeIf { it.isNotEmpty() }
                val sessionJson =
                    JSONObject().apply {
                        put("id", "ss-${java.util.UUID.randomUUID()}")
                        // A courseless session stays courseless: no invented
                        // "GENERAL" course id is written to the store.
                        if (cid != null) put("course_id", cid)
                        put("duration_minutes", minutes)
                        put("timestamp", java.time.LocalDateTime.now().toString())
                        put("date_iso", refDate.toString())
                    }.toString()
                callCore { core.logStudySession(sessionJson, refDate) }
                reloadStudyAnalytics()
            } catch (e: Exception) {
                // The session was NOT saved: say so instead of bumping an
                // in-memory counter the store does not know about.
                showToast("Could not save the focus session: ${e.message}")
                try {
                    reloadStudyAnalytics()
                } catch (_: Exception) {
                    // Store unreachable; the next successful reload resyncs.
                }
            }
        }
    }

    private var pomodoroJob: Job? = null

    /**
     * Runs one core call on the core dispatcher.
     *
     * Every native call (JNA -> Rust -> SQLite) is blocking, and the first
     * one also pays the `dlopen` + runtime start-up cost of the Rust core.
     * On the main thread that is what produced the "QuizRadar isn't
     * responding" ANR at start-up, so no core call may run there.
     */
    private suspend fun <T> callCore(block: suspend () -> T): T = withContext(coreDispatcher) { block() }

    /**
     * Persists one config value.
     *
     * A config write is a native store write, so it goes through the core
     * dispatcher - never on the main thread.
     */
    private fun persistConfig(
        key: String,
        value: String?,
    ) {
        viewModelScope.launch { callCore { core.setConfigString(key, value) } }
    }

    private fun persistConfig(
        key: String,
        value: Boolean,
    ) {
        viewModelScope.launch { callCore { core.setConfigBool(key, value) } }
    }

    fun selectPomodoroInterval(interval: PomodoroInterval) {
        if (_pomodoroIsRunning.value) {
            pausePomodoro()
        }
        _pomodoroInterval.value = interval
        _pomodoroSecondsLeft.value = interval.minutes * 60
    }

    fun startPomodoro(context: Context? = null) {
        if (_pomodoroIsRunning.value) return
        _pomodoroIsRunning.value = true
        pomodoroJob?.cancel()
        pomodoroJob =
            viewModelScope.launch {
                while (_pomodoroIsRunning.value && _pomodoroSecondsLeft.value > 0) {
                    delay(1000)
                    if (_pomodoroIsRunning.value && _pomodoroSecondsLeft.value > 0) {
                        _pomodoroSecondsLeft.value -= 1
                    }
                }
                if (_pomodoroSecondsLeft.value <= 0 && _pomodoroIsRunning.value) {
                    _pomodoroIsRunning.value = false
                    val isBreak = _pomodoroInterval.value != PomodoroInterval.POMODORO
                    // One real completion is persisted EXACTLY ONCE, here at
                    // the completion point: a full focus interval against the
                    // course of the assessment the timer is on. Breaks and
                    // reset/pause never log (audit A06 - the timer used to
                    // complete without ever touching the persisted log).
                    if (!isBreak) {
                        logFocusCompleted(activePomodoroCourseId(), _pomodoroInterval.value.minutes)
                    }
                    if (context != null) {
                        val posted =
                            try {
                                NotificationHelper.sendTimerCompleteNotification(context, isBreak)
                            } catch (_: Exception) {
                                false
                            }
                        showToast(
                            when {
                                // The notification could not be posted (Android 13+
                                // without POST_NOTIFICATIONS). Say so instead of
                                // pretending the chime happened.
                                !posted ->
                                    "Timer finished, but notifications are off - " +
                                        "allow them in Settings to hear the chime."

                                isBreak -> "Break complete! Ready to study?"
                                else -> "Pomodoro complete! Great focus session."
                            },
                        )
                    } else {
                        showToast(
                            if (isBreak) "Break complete! Ready to study?" else "Pomodoro complete! Great focus session.",
                        )
                    }
                }
            }
    }

    fun pausePomodoro() {
        _pomodoroIsRunning.value = false
        pomodoroJob?.cancel()
        pomodoroJob = null
    }

    fun resetPomodoro() {
        pausePomodoro()
        _pomodoroSecondsLeft.value = _pomodoroInterval.value.minutes * 60
    }

    fun openCreateEventDraft(draft: com.quizradar.app.ui.share.SharedEventDraft) {
        _activeCreateEventDraft.value = draft
    }

    fun dismissCreateEventDraft() {
        _activeCreateEventDraft.value = null
    }

    fun showToast(message: String) {
        _toastMessage.value = message
    }

    fun clearToast() {
        _toastMessage.value = null
    }

    fun loadState() {
        viewModelScope.launch {
            try {
                // The core calls open the native store (JNA + SQLite) and the
                // Keystore-backed token store. Both are slow, and doing them
                // on the main thread is what made the app look frozen at
                // start-up (the system showed "QuizRadar isn't responding").
                // The whole body runs on the IO dispatcher; the single-thread
                // view keeps two concurrent loads in submission order so a
                // stale snapshot can never overwrite a newer one.
                withContext(coreDispatcher) {
                    val refDate = clockDate()
                    val json = core.getState(refDate)
                    val snapshot = QuizRadarJsonParser.parseAppSnapshot(json)
                    val dismissed = core.getConfigBool("dismiss_conflict_banner", false)
                    _isConflictDismissed.value = dismissed

                    _userName.value = core.getConfigString("user_name") ?: ""
                    _userEmail.value = core.getConfigString("user_email") ?: ""
                    _geminiEnabled.value = core.getConfigBool("gemini_enabled", false)
                    _gmailEnabled.value = core.getConfigBool("gmail_enabled", true)
                    _classroomEnabled.value = core.getConfigBool("classroom_enabled", true)
                    _teamsEnabled.value = core.getConfigBool("teams_enabled", true)
                    _notifyExam24h.value = core.getConfigBool("notify_exam_24h", true)
                    _notifyExamSameDay.value = core.getConfigBool("notify_exam_same_day", true)
                    _notifyMorningDigest.value = core.getConfigBool("notify_morning_digest", false)
                    _notifyMorningTime.value = core.getConfigString("notify_morning_time") ?: "08:00"
                    _autoSyncGcal.value = core.getConfigBool("auto_sync_gcal", false)
                    // The user's own OAuth client ids (Settings -> Sources) and
                    // the background-scan opt-in. The ids are ALSO cached on
                    // the engine: the core's token callback is synchronous and
                    // cannot read the store itself.
                    _googleClientId.value = core.getConfigString("google_client_id") ?: ""
                    _teamsClientId.value = core.getConfigString("teams_client_id") ?: ""
                    (core as? QuizRadarEngine)?.oauthClientIds =
                        OAuthClientIds(
                            google = { _googleClientId.value },
                            microsoft = { _teamsClientId.value },
                        )
                    _backgroundScanEnabled.value = core.getConfigBool("background_scan_enabled", false)
                    // One-time migration: the legacy `theme` key packed the mode
                    // AND the dark scheme into a single string
                    // ("system"|"light"|"dark"|"amoled"), which made AMOLED a
                    // MODE - any later mode switch silently dropped it, and in
                    // System mode the AMOLED scheme was unreachable. Split it
                    // into the two orthogonal preferences, write them once, and
                    // drop the legacy key so a later user choice is never
                    // overwritten by this mapping:
                    //   "light"  -> mode light  + obsidian
                    //   "dark"   -> mode dark   + obsidian
                    //   "system" -> mode system + obsidian
                    //   "amoled" -> mode dark   + amoled (the old value forced dark)
                    val legacyTheme = core.getConfigString("theme")
                    if (legacyTheme != null) {
                        val (mode, darkTheme) =
                            when (legacyTheme) {
                                "light" -> "light" to "obsidian"
                                "dark", "system" -> legacyTheme to "obsidian"
                                "amoled" -> "dark" to "amoled"
                                // An unknown legacy value must not propagate
                                // garbage into the new keys - resolve like a
                                // fresh install instead.
                                else -> "system" to "obsidian"
                            }
                        // Split keys written by a newer build win: the legacy
                        // key is only ever the bootstrap. The mapped values are
                        // PERSISTED once (a memory-only mapping made the second
                        // load fall back to "system" after the legacy key was
                        // deleted) - an existing split key is never overwritten.
                        if (core.getConfigString("theme_mode") == null) {
                            core.setConfigString("theme_mode", mode)
                        }
                        if (core.getConfigString("preferred_dark_theme") == null) {
                            core.setConfigString("preferred_dark_theme", darkTheme)
                        }
                        _themeMode.value = core.getConfigString("theme_mode") ?: mode
                        _preferredDarkTheme.value =
                            core.getConfigString("preferred_dark_theme") ?: darkTheme
                        core.setConfigString("theme", null)
                    } else {
                        _themeMode.value = core.getConfigString("theme_mode") ?: "system"
                        _preferredDarkTheme.value =
                            core.getConfigString("preferred_dark_theme") ?: "obsidian"
                    }
                    _academicTrack.value = core.getConfigString("academic_track")
                    // The "Last synced" stamp the core writes ONLY after a scan
                    // in which a source really ran (`core/src/ffi.rs`).
                    _lastSyncedStamp.value = core.getConfigString("last_gmail_sync")

                    // `onboarding_completed` is WRITTEN as a bool (completeOnboarding,
                    // reRunOnboarding, sign-out), and a bool row is not readable
                    // through getConfigString - a JSON `true` has no string form.
                    // Probing it that way always returned null, so the flag fell
                    // through to "has courses" and a fresh install with an empty
                    // timetable re-showed the wizard on every launch. Read it as
                    // the bool it is, and only when it was never set at all fall
                    // back to "has courses".
                    val isDone =
                        core.getConfigBool(
                            "onboarding_completed",
                            snapshot.schedule.courses.isNotEmpty(),
                        )
                    _onboardingCompleted.value = isDone
                    _onboardingStep.value =
                        core.getConfigString("onboarding_step")?.toIntOrNull()?.coerceIn(1, ONBOARDING_STEP_COUNT) ?: 1
                    _isSetupChecklistDismissed.value =
                        core.getConfigBool("dismiss_setup_checklist", false)

                    val engine = core as? QuizRadarEngine
                    _geminiApiKey.value = core.geminiApiKey() ?: ""
                    // The version is a native call too - read it here, on the
                    // core dispatcher, instead of from the UI.
                    _coreVersion.value = core.version()
                    refreshAccountFlags(engine)

                    // The persisted student state the snapshot JSON does not
                    // carry: the attendance log and the study-session
                    // analytics (audits A06/A10 - reloaded on every launch),
                    // plus the review surfaces (GPA, flashcards, mistake
                    // bank, attempt + session history) so a restart keeps
                    // exactly what the student saved.
                    reloadAttendance()
                    reloadStudyAnalytics()
                    reloadPersistentReviewState()

                    _uiState.value = UiState.Ready(snapshot)
                    lastLoadedDate = refDate
                    // importBackup / resetAllData / addIcsFeed / removeIcsFeed all end
                    // in loadState() — without this the widget-refresh callback never
                    // fires after those and the glance widget stays stale.
                    onStateMutated?.invoke()
                }
            } catch (e: Exception) {
                _uiState.value = UiState.Error(e.message ?: "Failed to load state")
            }
        }
    }

    fun refreshState() {
        viewModelScope.launch {
            _isRefreshing.value = true
            try {
                withContext(coreDispatcher) {
                    val refDate = clockDate()
                    val json = core.getState(refDate)
                    val snapshot = QuizRadarJsonParser.parseAppSnapshot(json)
                    // Day-rollover refresh also re-reads the persisted
                    // attendance log and analytics: the streak and weekly
                    // totals are computed against the reference date, so they
                    // change when the day changes even if no session ran.
                    reloadAttendance()
                    reloadStudyAnalytics()
                    _uiState.value = UiState.Ready(snapshot)
                    lastLoadedDate = refDate
                    refreshAccountFlags(core as? QuizRadarEngine)
                    onStateMutated?.invoke()
                }
            } catch (e: Exception) {
                _uiState.value = UiState.Error(e.message ?: "Refresh failed")
            } finally {
                _isRefreshing.value = false
            }
        }
    }

    /**
     * Re-reads the connected-account flags from the token store.
     *
     * Runs on the background dispatcher (the token store opens an Android
     * Keystore master key, which is slow), so the UI can read the cached
     * flags instead of touching the Keystore during composition.
     */
    private fun refreshAccountFlags(engine: QuizRadarEngine?) {
        if (engine == null) {
            _googleConnected.value = false
            _microsoftConnected.value = false
            return
        }
        val provider = engine.tokenProvider
        _googleConnected.value =
            !provider.getGoogleAccessToken().isNullOrBlank() ||
            !provider.getGoogleRefreshToken().isNullOrBlank()
        _microsoftConnected.value =
            !provider.getMicrosoftAccessToken().isNullOrBlank() ||
            !provider.getMicrosoftRefreshToken().isNullOrBlank()
    }

    /**
     * Called from `MainActivity.onResume`: if the calendar day changed while the
     * app was backgrounded, reload the snapshot so due dates, countdowns and the
     * "today" highlight recompute against the new day. Week/calendar selection
     * only follows the new day when the user was still looking at the old "today"
     * (navigating away is a deliberate choice and is preserved).
     */
    fun onAppResumed() {
        val today = clockDate()
        val loaded = lastLoadedDate
        if (loaded != null && loaded != today) {
            // refreshState() stamps lastLoadedDate on success; on failure the old
            // date stays so the NEXT resume retries the rollover reload.
            refreshState()
            if (getWeekStart(loaded) == _currentWeekStart.value) {
                _currentWeekStart.value = getWeekStart(today)
            }
            if (_selectedCalendarDate.value == loaded) {
                _selectedCalendarDate.value = today
            }
        } else {
            lastLoadedDate = today
        }
    }

    fun setDashboardSubTab(tab: DashboardSubTab) {
        _dashboardSubTab.value = tab
    }

    fun setActiveSourceFilter(source: String) {
        _activeSourceFilter.value = source
    }

    fun setActiveTypeFilter(type: String) {
        _activeTypeFilter.value = type
    }

    fun setTasksCourseFilter(courseId: String) {
        _tasksCourseFilter.value = courseId
    }

    fun openAssessmentDetail(assessmentId: String) {
        _activeDetailAssessmentId.value = assessmentId
    }

    fun closeAssessmentDetail() {
        _activeDetailAssessmentId.value = null
    }

    fun openPracticeQuiz(assessmentId: String) {
        practiceQuizJob?.cancel()
        _activePracticeAssessmentId.value = assessmentId
        _practiceQuiz.value = null
        _practiceQuizError.value = null
        _isPracticeLoading.value = true

        val current = (_uiState.value as? UiState.Ready)?.snapshot
        if (current == null) {
            _isPracticeLoading.value = false
            _practiceQuizError.value = "Practice quiz unavailable: the app data is not loaded yet."
            return
        }
        val assessment = current.assessments.find { it.id == assessmentId }
        if (assessment == null) {
            _isPracticeLoading.value = false
            _practiceQuizError.value =
                "Practice quiz unavailable: assessment \"$assessmentId\" is no longer on the radar."
            return
        }

        practiceQuizJob =
            viewModelScope.launch {
                try {
                    val assessmentJson =
                        JSONObject().apply {
                            put("id", assessment.id)
                            put("title", assessment.title)
                            put("course_id", assessment.courseId)
                            put("course_name", assessment.courseName)
                            put("assessment_type", assessment.assessmentType)
                            put("date_iso", assessment.dateIso?.toString())
                            put("day_name", assessment.dayName)
                            put("start_time", assessment.startTime)
                            put("end_time", assessment.endTime)
                            put("display_time", assessment.displayTime)
                            put("room", assessment.room)
                            put("instructor", assessment.instructor)
                            put("group", assessment.group)
                            put("is_upcoming", assessment.isUpcoming)
                            put("days_until", assessment.daysUntil)
                            put("urgency_level", assessment.urgencyLevel)
                            put("priority_score", assessment.priorityScore)
                            put("topics", JSONArray(assessment.topics))
                            put("warnings", JSONArray(assessment.warnings))
                            put("source", assessment.source)
                        }.toString()

                    // A07: the consent-gated AI authoring path. The core
                    // checks `gemini_enabled` itself and labels the quiz's
                    // provenance (`generated_by_ai` / `authored_locally` +
                    // `fallback_reason`) — the UI only relays what happened.
                    val quizJson =
                        callCore {
                            core.generatePracticeQuizAi(assessmentJson, geminiApiKeyOrNull())
                        }
                    val quiz = QuizRadarJsonParser.parsePracticeQuiz(quizJson)
                    _practiceQuiz.value = quiz
                    if (quiz.authoredLocally && quiz.fallbackReason != null) {
                        // A labeled fallback is SUCCESS, but it is never
                        // silent: the user learns the quiz did NOT come from
                        // Gemini and why.
                        showToast(quiz.fallbackReason ?: "")
                    }
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    // A failed generation is a FAILURE, not an empty state: the
                    // Focus screen must show what went wrong (and offer a retry)
                    // instead of the "select an exam" instruction.
                    _practiceQuiz.value = null
                    _practiceQuizError.value = "Practice quiz failed: ${e.message ?: "unknown error"}"
                } finally {
                    _isPracticeLoading.value = false
                }
            }
    }

    fun closePracticeQuiz() {
        practiceQuizJob?.cancel()
        practiceQuizJob = null
        _activePracticeAssessmentId.value = null
        _practiceQuiz.value = null
        _practiceQuizError.value = null
        _isPracticeLoading.value = false
    }

    // ------------------------------------------------------------------
    // A07/A08 surfaces for the screens: consent-gated study-plan
    // optimization, manual assessment CRUD with success callbacks, event
    // edit, the calendar date jump, and the persistent Grade Center /
    // review states (GPA, flashcards, mistake bank, attempt + session
    // history). Everything below reads the REAL store — nothing here
    // fabricates content, and an empty list is an honest empty list.
    // ------------------------------------------------------------------

    /** Honest outcome of one manual assessment write (A08 CRUD callback). */
    sealed interface AssessmentSaveResult {
        data object Saved : AssessmentSaveResult

        data class Failed(val message: String) : AssessmentSaveResult
    }

    /** State of the consent-gated "Optimize with AI" roadmap run. */
    sealed interface StudyOptimizeState {
        data object Idle : StudyOptimizeState

        data object Working : StudyOptimizeState

        /** `source` is exactly what the core reported: "ai" | "deterministic". */
        data class Done(
            val source: String,
            val note: String?,
            val payloadJson: String,
        ) : StudyOptimizeState

        data class Failed(val message: String) : StudyOptimizeState
    }

    private val _studyOptimizeState = MutableStateFlow<StudyOptimizeState>(StudyOptimizeState.Idle)
    val studyOptimizeState: StateFlow<StudyOptimizeState> = _studyOptimizeState.asStateFlow()

    /**
     * Runs the "Optimize with AI" roadmap against the current store state.
     * The CORE owns the consent gate: with `gemini_enabled` off (or no key)
     * it returns the deterministic planner labeled `source:
     * "deterministic"` with a note that names why — no request is made.
     */
    fun optimizeStudyPlanWithAi() {
        if (_studyOptimizeState.value is StudyOptimizeState.Working) return
        _studyOptimizeState.value = StudyOptimizeState.Working
        viewModelScope.launch {
            try {
                val json = callCore { core.optimizeStudyPlan(clockDate(), geminiApiKeyOrNull()) }
                val root = JSONObject(json)
                _studyOptimizeState.value =
                    StudyOptimizeState.Done(
                        source = root.optString("source", "deterministic"),
                        note = root.optString("note", "").ifBlank { null },
                        payloadJson = root.getJSONObject("tasks").toString(),
                    )
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _studyOptimizeState.value =
                    StudyOptimizeState.Failed(e.message ?: "unknown error")
            }
        }
    }

    /** Closes the optimize sheet (or clears its error) without side effects. */
    fun dismissStudyOptimize() {
        _studyOptimizeState.value = StudyOptimizeState.Idle
    }

    /**
     * Manual assessment create/edit (A08). The core's `upsert_assessment`
     * persists the item and returns the whole post-write snapshot; the
     * [onResult] callback tells the sheet whether to close with "Saved!" or
     * stay open with the failure — a failed write is never a fake success.
     */
    fun upsertAssessment(
        assessmentJson: String,
        onResult: (AssessmentSaveResult) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = callCore { core.upsertAssessment(assessmentJson, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                onResult(AssessmentSaveResult.Saved)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(
                    AssessmentSaveResult.Failed(e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                )
            }
        }
    }

    /** Deletes one assessment (A08); the callback reports the real outcome. */
    fun deleteAssessment(
        id: String,
        onResult: (AssessmentSaveResult) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = callCore { core.deleteAssessment(id, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                onResult(AssessmentSaveResult.Saved)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(
                    AssessmentSaveResult.Failed(e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                )
            }
        }
    }

    /**
     * Edits an existing custom event (A08): an edit is an upsert under the
     * SAME id, so reminders and calendar identity survive the correction.
     * Unlike [addCustomEvent] this does not clear the share-intent draft.
     */
    fun updateCustomEvent(
        event: CustomEventModel,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val eventJson =
                    JSONObject().apply {
                        put("id", event.id)
                        put("title", event.title)
                        put("course_id", event.courseId)
                        put("event_type", event.eventType ?: "Custom")
                        put("date_iso", event.dateIso?.toString())
                        put("start_time", event.startTime)
                        put("end_time", event.endTime)
                        put("room", event.room)
                        put("notes", event.notes)
                        put("color", event.color ?: "#db2777")
                    }.toString()
                val updatedJson = callCore { core.upsertCustomEvent(eventJson, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                onResult(true)
            } catch (e: Exception) {
                showToast(
                    "Could not update the event: " +
                        (e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                )
                onResult(false)
            }
        }
    }

    /**
     * Jumps the calendar to an arbitrary date (A08 date jump): selects the
     * date and re-anchors the week grid on its week, so the tapped day is
     * actually on screen.
     */
    fun jumpToDate(date: LocalDate) {
        _currentWeekStart.value = getWeekStart(date)
        _selectedCalendarDate.value = date
    }

    // --- Persistent review states (GPA / flashcards / mistake bank / history) ---

    /** Raw GPA summary JSON from the shared Rust calculator (`GpaSummary`). */
    private val _gpaSummaryJson = MutableStateFlow<String?>(null)
    val gpaSummaryJson: StateFlow<String?> = _gpaSummaryJson.asStateFlow()

    /** Raw weighted grade-target JSON (`GradeTargetResult`) for the UI. */
    private val _gradeTargetJson = MutableStateFlow<String?>(null)
    val gradeTargetJson: StateFlow<String?> = _gradeTargetJson.asStateFlow()

    private val _flashcardsJson = MutableStateFlow("[]")
    val flashcardsJson: StateFlow<String> = _flashcardsJson.asStateFlow()

    private val _mistakesJson = MutableStateFlow("[]")
    val mistakesJson: StateFlow<String> = _mistakesJson.asStateFlow()

    private val _quizAttemptsJson = MutableStateFlow("[]")
    val quizAttemptsJson: StateFlow<String> = _quizAttemptsJson.asStateFlow()

    private val _studySessionsJson = MutableStateFlow("[]")
    val studySessionsJson: StateFlow<String> = _studySessionsJson.asStateFlow()

    /**
     * Reloads every persistent review state from the store. Called on launch
     * and after any mutation of these surfaces, so a restart keeps what the
     * student actually saved — and nothing else.
     */
    suspend fun reloadPersistentReviewState() {
        _flashcardsJson.value = callCore { core.listFlashcards() }
        _mistakesJson.value = callCore { core.listMistakes() }
        _quizAttemptsJson.value = callCore { core.listQuizAttempts() }
        _studySessionsJson.value = callCore { core.listStudySessions() }
        refreshGpaSummary()
    }

    /**
     * Recomputes the GPA summary from the CURRENT snapshot via the shared
     * Rust engine. Nothing is invented: a course without graded work simply
     * carries no percentage.
     */
    suspend fun refreshGpaSummary(scale: String = "4.0") {
        val current = _uiState.value as? UiState.Ready ?: return
        val snapshot = current.snapshot
        val coursesJson =
            JSONArray().apply {
                snapshot.schedule.courses.forEach { course ->
                    put(
                        JSONObject().apply {
                            put("id", course.id)
                            put("name", course.name)
                            put("color", course.color ?: "#1a73e8")
                        },
                    )
                }
            }.toString()
        val assessmentsJson =
            JSONArray().apply {
                snapshot.assessments.forEach { assessment ->
                    put(
                        JSONObject().apply {
                            put("id", assessment.id)
                            put("title", assessment.title)
                            put("source", assessment.source)
                            put("assessment_type", assessment.assessmentType)
                            put("course_id", assessment.courseId)
                        },
                    )
                }
            }.toString()
        val gradesJson =
            JSONObject().apply {
                snapshot.grades.forEach { (id, record) ->
                    put(
                        id,
                        JSONObject().apply {
                            record.achievedScore?.let { put("achieved_score", it) }
                            record.maxScore?.let { put("max_score", it) }
                            record.weightagePercent?.let { put("weightage_percent", it) }
                        },
                    )
                }
            }.toString()
        _gpaSummaryJson.value =
            callCore { core.calculateGpa(coursesJson, assessmentsJson, gradesJson, scale) }
    }

    /**
     * The thin UI-facing weighted grade-target calculation (A08): what the
     * student still needs to average on the remaining weight to reach
     * [targetLetter]. Unknown weights stay an honestly-labeled equal-weight
     * assumption inside the core — the shell adds no math of its own.
     */
    suspend fun calculateGradeTarget(
        courseId: String,
        targetLetter: String,
        scale: String = "4.0",
    ) {
        val current = _uiState.value as? UiState.Ready ?: return
        val snapshot = current.snapshot
        val assessmentsJson =
            JSONArray().apply {
                snapshot.assessments.forEach { assessment ->
                    put(
                        JSONObject().apply {
                            put("id", assessment.id)
                            put("title", assessment.title)
                            put("source", assessment.source)
                            put("assessment_type", assessment.assessmentType)
                            put("course_id", assessment.courseId)
                            put("achieved_score", assessment.achievedScore ?: JSONObject.NULL)
                            put("max_score", assessment.maxScore ?: JSONObject.NULL)
                            put("weightage_percent", assessment.weightagePercent ?: JSONObject.NULL)
                        },
                    )
                }
            }.toString()
        val gradesJson =
            JSONObject().apply {
                snapshot.grades.forEach { (id, record) ->
                    put(
                        id,
                        JSONObject().apply {
                            record.achievedScore?.let { put("achieved_score", it) }
                            record.maxScore?.let { put("max_score", it) }
                            record.weightagePercent?.let { put("weightage_percent", it) }
                        },
                    )
                }
            }.toString()
        _gradeTargetJson.value =
            callCore { core.calculateGradeTarget(courseId, assessmentsJson, gradesJson, scale, targetLetter) }
    }

    /** Saves one quiz attempt (+ its mistake bank entries) from the practice flow. */
    fun saveQuizAttempt(
        attemptJson: String,
        mistakesJson: String,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                callCore { core.saveQuizAttempt(attemptJson, mistakesJson, refDate) }
                _quizAttemptsJson.value = callCore { core.listQuizAttempts() }
                _mistakesJson.value = callCore { core.listMistakes() }
                onResult(true)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(false)
            }
        }
    }

    /** Marks one mistake resolved and refreshes the persisted bank. */
    fun resolveMistake(
        mistakeId: String,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                callCore { core.resolveMistake(mistakeId) }
                _mistakesJson.value = callCore { core.listMistakes() }
                onResult(true)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(false)
            }
        }
    }

    /** Upserts one flashcard and refreshes the persisted deck. */
    fun upsertFlashcard(
        cardJson: String,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                callCore { core.upsertFlashcard(cardJson) }
                _flashcardsJson.value = callCore { core.listFlashcards() }
                onResult(true)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(false)
            }
        }
    }

    /** Deletes one flashcard and refreshes the persisted deck. */
    fun deleteFlashcard(
        cardId: String,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                callCore { core.deleteFlashcard(cardId) }
                _flashcardsJson.value = callCore { core.listFlashcards() }
                onResult(true)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(false)
            }
        }
    }

    /** Records one flashcard review (SM-2 state lives in the core). */
    fun reviewFlashcard(
        cardId: String,
        correct: Boolean,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                callCore { core.reviewFlashcard(cardId, correct, clockDate()) }
                _flashcardsJson.value = callCore { core.listFlashcards() }
                onResult(true)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(false)
            }
        }
    }

    /**
     * Opens the focus timer on one topic of an assessment.
     *
     * The topic INDEX is resolved here (against the assessment's own topic
     * list) and carried next to the topic text: the completion key is
     * "{assessment_id}::{topic_index}", so the Focus screen has to mark the
     * topic it actually shows. When the topic cannot be located the index
     * stays null - the screen then refuses to guess one.
     */
    fun openPomodoro(
        assessmentId: String? = null,
        topic: String? = null,
        topicIndex: Int? = null,
    ) {
        _activePomodoroAssessmentId.value = assessmentId
        _activePomodoroTopic.value = topic
        _activePomodoroTopicIndex.value = topicIndex ?: resolveTopicIndex(assessmentId, topic)
    }

    fun closePomodoro() {
        _activePomodoroAssessmentId.value = null
        _activePomodoroTopic.value = null
        _activePomodoroTopicIndex.value = null
    }

    /**
     * The course of the assessment the timer is working on. Unknown/null when
     * the timer is courseless - the session is then persisted courseless, the
     * same honest attribution the manual log path uses.
     */
    private fun activePomodoroCourseId(): String? {
        val assessmentId = _activePomodoroAssessmentId.value ?: return null
        val snapshot = (_uiState.value as? UiState.Ready)?.snapshot ?: return null
        return snapshot.assessments.find { it.id == assessmentId }?.courseId
    }

    private fun resolveTopicIndex(
        assessmentId: String?,
        topic: String?,
    ): Int? {
        if (assessmentId == null || topic == null) return null
        val snapshot = (_uiState.value as? UiState.Ready)?.snapshot ?: return null
        val assessment = snapshot.assessments.find { it.id == assessmentId } ?: return null
        val index = assessment.topics.indexOfFirst { it == topic }
        return if (index >= 0) index else null
    }

    fun shiftWeek(delta: Int) {
        _currentWeekStart.value = _currentWeekStart.value.plusWeeks(delta.toLong())
    }

    fun jumpToToday() {
        val today = clockDate()
        _currentWeekStart.value = getWeekStart(today)
        _selectedCalendarDate.value = today
    }

    fun setSelectedCalendarDate(date: LocalDate) {
        _selectedCalendarDate.value = date
    }

    fun toggleTopic(
        topicKey: String,
        targetDone: Boolean,
    ) {
        val current = _uiState.value as? UiState.Ready ?: return
        val previousCompleted = current.snapshot.completedTopics

        // 1. Optimistic update
        val updatedTopics = previousCompleted.toMutableMap()
        if (targetDone) {
            updatedTopics[topicKey] = true
        } else {
            updatedTopics.remove(topicKey)
        }

        val optimisticSnapshot = current.snapshot.copy(completedTopics = updatedTopics)
        _uiState.value = UiState.Ready(optimisticSnapshot)

        // 2. Perform backend store update
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = callCore { core.toggleTopic(topicKey, targetDone, refDate) }
                val finalSnapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(finalSnapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
            } catch (e: Exception) {
                // Rollback on error
                _uiState.value = UiState.Ready(current.snapshot)
            }
        }
    }

    /**
     * Writes one grade record and reports what actually happened.
     *
     * The caller decides whether it may say "Grade Saved!": this function
     * returns [GradeSaveResult.Saved] only after the core confirmed the
     * write, and [GradeSaveResult.Failed] with the reason otherwise. The
     * exception is never swallowed - a silent failure is what made the sheet
     * claim a save that never happened.
     */
    suspend fun saveGrade(
        assessmentId: String,
        achieved: Double?,
        max: Double?,
        weight: Double?,
    ): GradeSaveResult {
        return try {
            val refDate = clockDate()
            val updatedJson =
                callCore {
                    core.updateGrade(
                        assessmentId = assessmentId,
                        achieved = achieved,
                        max = max,
                        weightage = weight,
                        clearAchieved = (achieved == null),
                        clearMax = (max == null),
                        clearWeightage = (weight == null),
                        refDate = refDate,
                    )
                }
            val finalSnapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
            _uiState.value = UiState.Ready(finalSnapshot)
            lastLoadedDate = refDate
            onStateMutated?.invoke()
            GradeSaveResult.Saved
        } catch (e: Exception) {
            GradeSaveResult.Failed(e.message?.takeIf { it.isNotBlank() } ?: "Grade save failed")
        }
    }

    fun dismissConflicts() {
        _isConflictDismissed.value = true
        persistConfig("dismiss_conflict_banner", true)
    }

    fun scheduleStudyBlocks(assessmentId: String) {
        val current = (_uiState.value as? UiState.Ready)?.snapshot ?: return
        val assessment = current.assessments.find { it.id == assessmentId } ?: return

        viewModelScope.launch {
            try {
                val refDate = clockDate()

                val assessmentJson =
                    JSONObject().apply {
                        put("id", assessment.id)
                        put("title", assessment.title)
                        put("course_id", assessment.courseId)
                        put("course_name", assessment.courseName)
                        put("assessment_type", assessment.assessmentType)
                        put("date_iso", assessment.dateIso?.toString())
                        put("topics", JSONArray(assessment.topics))
                    }.toString()

                val scheduleJson =
                    JSONObject().apply {
                        put("semester", current.schedule.semester)
                        val coursesArr = JSONArray()
                        current.schedule.courses.forEach { c ->
                            coursesArr.put(
                                JSONObject().apply {
                                    put("id", c.id)
                                    put("name", c.name)
                                    put("color", c.color)
                                },
                            )
                        }
                        put("courses", coursesArr)
                        val slotsArr = JSONArray()
                        current.schedule.slots.forEach { s ->
                            slotsArr.put(
                                JSONObject().apply {
                                    put("id", s.id)
                                    put("day", s.day)
                                    put("course_id", s.courseId)
                                    put("type", s.type)
                                    put("start_time", s.startTime)
                                    put("end_time", s.endTime)
                                },
                            )
                        }
                        put("slots", slotsArr)
                    }.toString()

                val eventsArr = JSONArray()
                current.customEvents.forEach { e ->
                    eventsArr.put(
                        JSONObject().apply {
                            put("id", e.id)
                            put("title", e.title)
                            // Core contract key (`core/src/types.rs` has no
                            // `date` alias) - `generateStudyBlocks` uses this
                            // list for collision avoidance, so a wrong key
                            // makes it treat placed events as unscheduled.
                            put("date_iso", e.dateIso?.toString())
                            put("start_time", e.startTime)
                            put("end_time", e.endTime)
                        },
                    )
                }
                val eventsJson = eventsArr.toString()

                val blocksJson =
                    callCore { core.generateStudyBlocks(assessmentJson, scheduleJson, eventsJson, refDate) }
                val blocksArr = JSONArray(blocksJson)

                if (blocksArr.length() == 0) {
                    // The core declines honestly: no free window the day
                    // before, a block that is already there, or an exam date
                    // that is not confirmed. A silent no-op used to look like
                    // "scheduled" - say which one it is.
                    showToast(
                        if (assessment.dateIso == null) {
                            "No study block placed: this assessment has no confirmed date yet."
                        } else {
                            "No study block placed: no free study window on " +
                                "${assessment.dateIso.minusDays(1)}."
                        },
                    )
                    return@launch
                }

                val candidate = blocksArr.getJSONObject(0)
                val updatedState = callCore { core.upsertCustomEvent(candidate.toString(), refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedState)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                showToast("Study block added for ${assessment.title}.")
            } catch (e: Exception) {
                showToast(
                    "Could not schedule the study block: " +
                        (e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                )
            }
        }
    }

    /**
     * Saves a custom event and reports the outcome.
     *
     * The write failure used to be swallowed (`catch (_: Exception) {}`): the
     * sheet dismissed, the draft vanished and the event was simply gone. Now
     * the failure surfaces as a toast and the DRAFT STAYS OPEN - the user can
     * retry or copy their text out. `onResult(false)` lets the caller keep
     * the sheet up; the draft state is only cleared after a real success.
     */
    fun addCustomEvent(
        event: CustomEventModel,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val eventJson =
                    JSONObject().apply {
                        put("id", event.id)
                        put("title", event.title)
                        put("course_id", event.courseId)
                        put("event_type", event.eventType ?: "Custom")
                        // Canonical core key `date_iso` (`core/src/types.rs:723`):
                        // no `date` alias, so a typo would silently turn the
                        // event into an undated one the core cannot schedule.
                        put("date_iso", event.dateIso?.toString())
                        put("start_time", event.startTime)
                        put("end_time", event.endTime)
                        put("room", event.room)
                        put("notes", event.notes)
                        put("color", event.color ?: "#db2777")
                    }.toString()
                val updatedJson = callCore { core.upsertCustomEvent(eventJson, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                _activeCreateEventDraft.value = null
                onStateMutated?.invoke()
                onResult(true)
            } catch (e: Exception) {
                showToast(
                    "Could not save the event: " +
                        (e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                )
                onResult(false)
            }
        }
    }

    /** Deletes a custom event; a failed delete is a loud failure, not silence. */
    fun deleteCustomEvent(
        id: String,
        onResult: (Boolean) -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = callCore { core.deleteCustomEvent(id, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                onResult(true)
            } catch (e: Exception) {
                showToast(
                    "Could not delete the event: " +
                        (e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                )
                onResult(false)
            }
        }
    }

    fun importBackup(
        jsonContent: String,
        onComplete: ((String) -> Unit)? = null,
    ) {
        viewModelScope.launch {
            try {
                val reportJson = callCore { core.importBackup(jsonContent, clockDate()) }
                loadState()
                onComplete?.invoke(reportJson)
                // The core's ImportReport serializes camelCase
                // (`core/src/store/importer.rs`: `#[serde(rename_all =
                // "camelCase")]`) - the snake_case keys used to read as 0 and
                // the toast claimed "Restored: 0 courses" for a full backup.
                val reportObj = org.json.JSONObject(reportJson)
                val courses = reportObj.optInt("coursesImported", 0)
                val assessments = reportObj.optInt("assessmentsImported", 0)
                val slots = reportObj.optInt("slotsImported", 0)
                val grades = reportObj.optInt("gradesImported", 0)
                val topics = reportObj.optInt("topicsImported", 0)
                val customEvents = reportObj.optInt("customEventsImported", 0)
                val feeds = reportObj.optInt("feedsImported", 0)
                val secretsCount = reportObj.optJSONArray("secretsIgnored")?.length() ?: 0
                val secretsMsg = if (secretsCount > 0) " ($secretsCount legacy secrets dropped)" else ""
                val extras =
                    listOf(
                        "$slots class slots" to slots,
                        "$customEvents custom events" to customEvents,
                        "$feeds feeds" to feeds,
                    ).filter { it.second > 0 }.joinToString(", ") { it.first }
                val extrasMsg = if (extras.isEmpty()) "" else ", $extras"
                val warnings = reportObj.optJSONArray("warnings") ?: org.json.JSONArray()
                val warningsMsg =
                    if (warnings.length() > 0) {
                        " — " + (0 until warnings.length()).joinToString("; ") { warnings.optString(it) }
                    } else {
                        ""
                    }
                _toastMessage.value =
                    "Restored: $courses courses, $assessments assessments, $grades grades, $topics topics$extrasMsg.$secretsMsg$warningsMsg"
            } catch (e: Exception) {
                _toastMessage.value = "Import failed: ${e.message}"
            }
        }
    }

    /**
     * Serializes the calendar into an `.ics` document.
     *
     * `suspend`: the native call blocks (it serializes every assessment and
     * builds the calendar), and the audit found the "Export .ics" button
     * running it straight on the UI thread - a freeze on a large timetable.
     * The engine routes the call through its own dispatcher, so it never
     * touches the main thread.
     */
    suspend fun exportIcs(assessmentId: String?): String {
        val current = (_uiState.value as? UiState.Ready)?.snapshot ?: return ""
        val arr = JSONArray()
        current.assessments.forEach { a ->
            arr.put(
                JSONObject().apply {
                    put("id", a.id)
                    put("title", a.title)
                    put("course_id", a.courseId)
                    put("course_name", a.courseName)
                    put("assessment_type", a.assessmentType)
                    put("date_iso", a.dateIso?.toString())
                    put("day_name", a.dayName)
                    put("start_time", a.startTime)
                    put("end_time", a.endTime)
                    put("display_time", a.displayTime)
                    put("room", a.room)
                    put("instructor", a.instructor)
                    put("group", a.group)
                    put("is_upcoming", a.isUpcoming)
                    put("days_until", a.daysUntil)
                    put("urgency_level", a.urgencyLevel)
                    put("priority_score", a.priorityScore)
                    put("topics", JSONArray(a.topics))
                    put("warnings", JSONArray(a.warnings))
                    put("source", a.source)
                    put("achieved_score", a.achievedScore)
                    put("max_score", a.maxScore)
                    put("weightage_percent", a.weightagePercent)
                    put("e_learning_url", a.eLearningUrl)
                },
            )
        }
        return core.exportIcs(arr.toString(), assessmentId)
    }

    fun isGoogleConnected(): Boolean = _googleConnected.value

    fun isMicrosoftConnected(): Boolean = _microsoftConnected.value

    fun disconnectGoogle() {
        val engine = core as? com.quizradar.app.core.QuizRadarEngine ?: return
        _googleConnected.value = false
        showToast("Google account disconnected")
        viewModelScope.launch {
            // The token store writes into the Android Keystore - the first
            // touch builds the master key, which takes seconds. It must not
            // run on the main thread.
            withContext(coreDispatcher) {
                engine.tokenProvider.setGoogleAccessToken(null)
                engine.tokenProvider.setGoogleRefreshToken(null)
                clearAccountIdentity()
            }
            refreshState()
        }
    }

    fun disconnectMicrosoft() {
        val engine = core as? com.quizradar.app.core.QuizRadarEngine ?: return
        _microsoftConnected.value = false
        showToast("Microsoft account disconnected")
        viewModelScope.launch {
            withContext(coreDispatcher) {
                engine.tokenProvider.setMicrosoftAccessToken(null)
                engine.tokenProvider.setMicrosoftRefreshToken(null)
                clearAccountIdentity()
            }
            refreshState()
        }
    }

    /**
     * Wipes the account identity together with the tokens.
     *
     * Clearing only the tokens left `user_email` / `user_name` (and the
     * picture) in the config store, so a shared device kept showing the
     * previous account's address after a disconnect. The desktop's
     * `google_logout` clears the same three keys.
     */
    private suspend fun clearAccountIdentity() {
        _userName.value = ""
        _userEmail.value = ""
        callCore {
            core.setConfigString("user_email", null)
            core.setConfigString("user_name", null)
            core.setConfigString("user_picture", null)
        }
    }

    fun saveUserProfile(
        name: String,
        email: String,
    ) {
        _userName.value = name
        _userEmail.value = email
        viewModelScope.launch {
            callCore {
                core.setConfigString("user_name", name.trim().ifEmpty { null })
                core.setConfigString("user_email", email.trim().ifEmpty { null })
            }
            showToast("Profile updated")
        }
    }

    fun upsertCourse(
        course: CourseModel,
        slots: List<ScheduleSlotModel>,
        onComplete: (() -> Unit)? = null,
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                // The editor form carries only id/name/color; credits and the
                // absence limit live on the persisted course and are NOT part
                // of this form. `upsert_course` replaces the row, so dropping
                // them here would silently wipe them on every save - re-emit
                // what the store currently holds for this course.
                val existingCourse =
                    (_uiState.value as? UiState.Ready)?.snapshot?.schedule?.courses?.firstOrNull {
                        it.id.equals(course.id.trim(), ignoreCase = true)
                    }
                val credits = course.credits ?: existingCourse?.credits
                val maxAbsences = course.maxAbsences ?: existingCourse?.maxAbsences
                val courseJson =
                    JSONObject().apply {
                        put("id", course.id.trim().uppercase())
                        put("name", course.name.trim())
                        put("color", course.color ?: "#1a73e8")
                        if (credits != null) put("credits", credits)
                        if (maxAbsences != null) put("max_absences", maxAbsences)
                    }.toString()

                val slotsArr = JSONArray()
                slots.forEachIndexed { idx, s ->
                    slotsArr.put(
                        JSONObject().apply {
                            val slotId = if (s.id.isBlank()) "slot-${System.currentTimeMillis()}-$idx" else s.id
                            put("id", slotId)
                            put("day", s.day)
                            put("course_id", course.id.trim().uppercase())
                            put("course_name", course.name.trim())
                            put("type", s.type)
                            put("start_time", s.startTime)
                            put("end_time", s.endTime)
                            put("display_time", "${s.startTime}–${s.endTime}")
                            if (!s.room.isNullOrBlank() && s.room != "—") put("room", s.room.trim())
                            if (!s.instructor.isNullOrBlank()) put("instructor", s.instructor.trim())
                            if (!s.group.isNullOrBlank()) put("group", s.group.trim())
                            // Alternating-week parity is set by the editor's
                            // parity helper; dropping it would move the class
                            // to every week (`week_parity`: all/week_a/week_b).
                            if (!s.weekParity.isNullOrBlank()) put("week_parity", s.weekParity)
                        },
                    )
                }
                val updatedJson = callCore { core.upsertCourse(courseJson, slotsArr.toString(), refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                showToast("Course ${course.id.uppercase()} saved")
                onComplete?.invoke()
            } catch (e: Exception) {
                showToast("Failed to save course: ${e.message}")
            }
        }
    }

    fun deleteCourse(
        code: String,
        onComplete: (() -> Unit)? = null,
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = callCore { core.deleteCourse(code, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                showToast("Course $code deleted")
                onComplete?.invoke()
            } catch (e: Exception) {
                showToast("Failed to delete course: ${e.message}")
            }
        }
    }

    fun setSourceEnabled(
        source: String,
        enabled: Boolean,
    ) {
        when (source.lowercase()) {
            "gmail" -> {
                _gmailEnabled.value = enabled
                persistConfig("gmail_enabled", enabled)
            }
            "classroom" -> {
                _classroomEnabled.value = enabled
                persistConfig("classroom_enabled", enabled)
            }
            "teams" -> {
                _teamsEnabled.value = enabled
                persistConfig("teams_enabled", enabled)
            }
        }
    }

    fun addIcsFeed(
        url: String,
        label: String,
        onComplete: (() -> Unit)? = null,
    ) {
        if (!url.startsWith("https://", ignoreCase = true)) {
            showToast("Only secure HTTPS feed URLs are supported")
            return
        }
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val existing = (_uiState.value as? UiState.Ready)?.snapshot?.feeds.orEmpty()
                if (existing.size >= 10) {
                    showToast("Maximum 10 calendar feeds allowed")
                    return@launch
                }
                if (existing.any { it.url.equals(url.trim(), ignoreCase = true) }) {
                    showToast("This feed URL is already subscribed")
                    return@launch
                }
                // The core's real feed upsert (https-only enforced by the
                // store) - NOT a backup export/import round trip, which is
                // additive CRUD via the importer and would force unrelated
                // legacy preferences off (audit A02).
                val feedJson =
                    JSONObject().apply {
                        put("id", "feed-${System.currentTimeMillis()}")
                        put("name", label.trim().ifEmpty { "Calendar Feed" })
                        put("url", url.trim())
                        put("enabled", true)
                    }.toString()
                callCore { core.saveFeed(feedJson, refDate) }
                loadState()
                showToast("Feed added")
                onComplete?.invoke()
            } catch (e: Exception) {
                showToast("Failed to add feed: ${e.message}")
            }
        }
    }

    /**
     * Removes a subscribed feed by URL (the parsed feed model carries the
     * store's stable id; the URL is how the UI identifies the row). The
     * deletion goes through the core's real feed-delete operation — one
     * targeted store write: the deleted feed stays deleted and unrelated
     * preferences are untouched. It used to be a backup export/edit/reimport,
     * and import is additive, so the "removed" feed silently came back.
     */
    fun removeIcsFeed(feedUrl: String) {
        viewModelScope.launch {
            try {
                val snapshot = (_uiState.value as? UiState.Ready)?.snapshot
                val feed =
                    snapshot?.feeds?.firstOrNull { it.url.equals(feedUrl, ignoreCase = true) }
                if (feed == null || feed.id.isBlank()) {
                    showToast("Feed not found")
                    return@launch
                }
                callCore { core.deleteFeed(feed.id, clockDate()) }
                loadState()
                showToast("Feed removed")
            } catch (e: Exception) {
                showToast("Failed to remove feed: ${e.message}")
            }
        }
    }

    // =========================================================================
    // Real on-device scanning (UniFFI runNativeSync)
    // =========================================================================

    /**
     * The sync config this device would run RIGHT NOW, derived exactly like
     * the desktop (see [deriveSyncConfig]).
     */
    private suspend fun currentSyncConfig(): com.quizradar.app.core.FfiSyncConfig? {
        val snapshot = (_uiState.value as? UiState.Ready)?.snapshot
        val moodleConfigured =
            !(core.getConfigString("moodle_ical_url").isNullOrBlank()) ||
                !(core.getConfigString("moodle_rest_url").isNullOrBlank())
        val config =
            deriveSyncConfig(
                googleConnected = _googleConnected.value,
                microsoftConnected = _microsoftConnected.value,
                gmailToggle = _gmailEnabled.value,
                classroomToggle = _classroomEnabled.value,
                teamsToggle = _teamsEnabled.value,
                moodleEnabled = core.getConfigBool("moodle_enabled", false) && moodleConfigured,
                moodleIcalUrl = core.getConfigString("moodle_ical_url"),
                moodleRestUrl = core.getConfigString("moodle_rest_url"),
                // No Moodle token storage exists on this shell (no UI for it);
                // a half-configured channel is reported by the core, not half-run.
                moodleRestToken = null,
            )
        val feedsEnabled = snapshot?.feeds?.any { it.enabled } ?: false
        if (
            !hasConfiguredSource(
                googleConnected = _googleConnected.value,
                microsoftConnected = _microsoftConnected.value,
                gmailToggle = _gmailEnabled.value,
                classroomToggle = _classroomEnabled.value,
                teamsToggle = _teamsEnabled.value,
                moodleConfigured = moodleConfigured,
                feedsEnabled = feedsEnabled,
            )
        ) {
            return null
        }
        return config
    }

    /**
     * The sync config for one scan, derived exactly like the desktop: a
     * source is enabled only when its account is signed in AND its toggle
     * allows it (a classroom toggle that was never set follows the account =
     * on), and Moodle carries its own channel config. Pure and `internal` so
     * the unit tests can pin the defaults.
     */
    internal fun deriveSyncConfig(
        googleConnected: Boolean,
        microsoftConnected: Boolean,
        gmailToggle: Boolean,
        classroomToggle: Boolean,
        teamsToggle: Boolean,
        moodleEnabled: Boolean,
        moodleIcalUrl: String?,
        moodleRestUrl: String?,
        moodleRestToken: String?,
    ): com.quizradar.app.core.FfiSyncConfig =
        com.quizradar.app.core.FfiSyncConfig(
            gmailEnabled = googleConnected && gmailToggle,
            teamsEnabled = microsoftConnected && teamsToggle,
            moodleEnabled = moodleEnabled,
            classroomEnabled = googleConnected && classroomToggle,
            moodleIcalUrl = moodleIcalUrl?.trim()?.takeIf { it.isNotEmpty() },
            moodleRestUrl = moodleRestUrl?.trim()?.takeIf { it.isNotEmpty() },
            moodleRestToken = moodleRestToken?.trim()?.takeIf { it.isNotEmpty() },
        )

    /**
     * True when a scan would have something to do: a signed-in account with
     * at least one OAuth source toggled on, a configured Moodle channel, or
     * an enabled .ics feed. When this is false the UI shows the honest
     * "No sources connected" state instead of spinning forever.
     */
    internal fun hasConfiguredSource(
        googleConnected: Boolean,
        microsoftConnected: Boolean,
        gmailToggle: Boolean,
        classroomToggle: Boolean,
        teamsToggle: Boolean,
        moodleConfigured: Boolean,
        feedsEnabled: Boolean,
    ): Boolean =
        (googleConnected && (gmailToggle || classroomToggle)) ||
            (microsoftConnected && teamsToggle) ||
            moodleConfigured ||
            feedsEnabled

    /** The in-flight manual scan, cancelled on reset so it cannot repopulate the wiped store. */
    private var scanJob: Job? = null

    /**
     * Runs the real on-device scan: Gmail/Teams/Classroom/Moodle/.ics feeds
     * through the Rust core, live per-source progress, honest report.
     *
     * Honesty rules implemented here (AGENTS §3):
     * - re-entry is a no-op (the core is single-flight),
     * - zero configured sources is a no-op with a truthful message - never a
     *   spinner,
     * - there is NO cancel button: the core has no mid-scan cancel API,
     * - a failed source is shown as failed with its real detail string,
     * - a scan that found nothing says so.
     */
    fun runScan() {
        if (_isScanning.value) return
        val engine = core as? QuizRadarEngine
        if (engine == null) {
            showToast("Scanning needs the native core - it is not available in this process.")
            return
        }
        scanJob =
            viewModelScope.launch {
                // Claim the slot ON the main thread before anything suspends: two
                // rapid pulls can both pass a later check, and the core's
                // single-flight would only fail the second run with an error.
                if (_isScanning.value) return@launch
                _isScanning.value = true
                _scanProgress.value = emptyList()
                try {
                    val syncConfig =
                        try {
                            currentSyncConfig()
                        } catch (e: Exception) {
                            showToast("Could not read the source configuration: ${e.message}")
                            return@launch
                        }
                    if (syncConfig == null) {
                        showToast("No announcement sources connected - sign in or add a calendar feed first.")
                        return@launch
                    }

                    val listener =
                        object : com.quizradar.app.core.FfiSyncProgressListener {
                            override fun onProgress(
                                source: String,
                                stage: String,
                                found: UInt,
                                done: UInt,
                            ) {
                                _scanProgress.update { current ->
                                    val row = ScanSourceProgress(source, stage, found.toInt(), done.toInt())
                                    val existing = current.indexOfFirst { it.name == source }
                                    if (existing >= 0) current.mapIndexed { i, r -> if (i == existing) row else r } else current + row
                                }
                            }
                        }
                    val reportJson = engine.runNativeSync(syncConfig, listener, geminiApiKeyOrNull())
                    val report = QuizRadarJsonParser.parseSyncReport(reportJson)
                    if (report.cancelled) {
                        // The core aborted the fetch and persisted NOTHING —
                        // the radar and the 'Last synced' stamp are exactly
                        // as before (A07 cancellation, not UI theatre).
                        _lastScanReport.value = report
                        showToast("Scan cancelled - nothing was saved.")
                        return@launch
                    }
                    _lastScanReport.value = report
                    _lastSyncedStamp.value = core.getConfigString("last_gmail_sync")
                    refreshState()
                    AnalyticsManager.trackScanCompleted(
                        source = "manual",
                        assessmentCount = report.totalNew + report.totalUpdated,
                        success = report.success,
                    )
                    var summary = buildScanSummary(report)
                    if (
                        report.success &&
                        report.totalNew + report.totalUpdated > 0 &&
                        _googleConnected.value &&
                        _autoSyncGcal.value
                    ) {
                        // The auto-push the Settings toggle promises: after a scan
                        // that actually discovered/updated items, push them. The
                        // push's real outcome joins the summary.
                        val pushMessage = pushGcalInternal()
                        if (pushMessage != null) summary += "\n$pushMessage"
                    }
                    showToast(summary)
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    AnalyticsManager.trackScanCompleted(
                        source = "manual",
                        assessmentCount = 0,
                        success = false,
                    )
                    // The core throws on store/parse failures - fail loudly, keep
                    // the previous report (it is still the last REAL outcome).
                    showToast("Scan failed: ${e.message ?: "unknown error"}")
                } finally {
                    _isScanning.value = false
                }
            }
    }

    /**
     * Cancels the in-flight native scan. The core aborts the fetch phase and
     * persists NOTHING for the cancelled run — the honest report the run
     * then returns carries `"cancelled": true` and the scan summary says so.
     */
    fun cancelScan() {
        requestNativeScanCancellation()
    }

    /**
     * Asks the CORE to abort the in-flight native scan.
     *
     * This is the native cancel the scan's cancel button uses
     * (`QuizRadarCore.cancelScan()` → `NativeStore.cancel_native_sync`): the
     * core sets its `scan_cancelled` flag, which aborts the fetch phase and
     * is re-checked before EVERY persist - so a cancelled run writes
     * nothing back into the store.
     *
     * A core that does not implement native cancellation throws
     * `UnsupportedOperationException` (the interface's safe default) - the
     * caller must survive that, not break on it.
     */
    private fun requestNativeScanCancellation() {
        try {
            // Deliberately NOT dispatched through the core dispatcher: that
            // one is single-threaded and an in-flight scan occupies it, so a
            // dispatched cancel would queue BEHIND the scan it is meant to
            // abort. The native cancel only flips an atomic flag, so calling
            // it straight away is both safe and immediate.
            core.cancelScan()
        } catch (_: UnsupportedOperationException) {
            // This core has no native cancellation (a fake): the Kotlin job
            // cancellation is all there is.
        }
    }

    /**
     * The Gemini key the core may use this run, or `null` when AI is
     * disabled or no key is saved. Defense in depth on top of the core's
     * own consent gate (A07): with the toggle off nothing is even passed
     * through, so a retained key cannot reach the network from either side.
     */
    private fun geminiApiKeyOrNull(): String? = if (_geminiEnabled.value) _geminiApiKey.value.ifBlank { null } else null

    /**
     * The "Push now to Google Calendar" action (Settings -> Sources). Returns
     * the honest one-line outcome, or null when the push could not even start
     * (the toast in that case is the failure).
     */
    fun pushGcalNow() {
        viewModelScope.launch {
            val message = pushGcalInternal()
            if (message != null) showToast(message)
        }
    }

    private suspend fun pushGcalInternal(): String? {
        val engine = core as? QuizRadarEngine
        if (engine == null) {
            return "Google Calendar push failed: the native core is not available."
        }
        if (!_googleConnected.value) {
            return "Google Calendar push skipped: no Google account is signed in."
        }
        return try {
            val report = QuizRadarJsonParser.parseGcalPushReport(engine.pushGcal())
            when {
                report.needsScope ->
                    "Calendar push refused by Google (scope missing) - reconnect Google, " +
                        "nothing was marked as synced."
                !report.success ->
                    "Calendar push failed: ${report.message ?: "Google returned an error"}."
                else -> {
                    // The calendar push stamps `last_gcal_sync` (the scan
                    // stamps `last_gmail_sync`) - read the one this run wrote.
                    _lastSyncedStamp.value = core.getConfigString("last_gcal_sync")
                    refreshState()
                    "Calendar push: ${report.created} created · ${report.updated} updated" +
                        (if (report.skippedUndated > 0) " · ${report.skippedUndated} undated skipped" else "") +
                        (if (report.failedIds.isNotEmpty()) " · ${report.failedIds.size} failed" else "")
                }
            }
        } catch (e: Exception) {
            "Calendar push failed: ${e.message ?: "unknown error"}"
        }
    }

    /**
     * The Drive backup push (Settings -> Data Management): explicit user
     * action, data-only payload, honest outcome.
     */
    fun pushDriveBackupNow() {
        viewModelScope.launch {
            val engine = core as? QuizRadarEngine
            if (engine == null) {
                showToast("Drive backup failed: the native core is not available.")
                return@launch
            }
            if (!_googleConnected.value) {
                showToast("Drive backup skipped: no Google account is signed in.")
                return@launch
            }
            try {
                val deviceId = ensureDeviceId()
                engine.pushDriveBackup(deviceId)
                showToast("Backed up to Google Drive (app data folder).")
            } catch (e: Exception) {
                showToast("Drive backup failed: ${e.message ?: "unknown error"}")
            }
        }
    }

    /**
     * The Drive restore (Settings -> Data Management): pulls the backup and
     * merges additively. "No backup found" is the honest empty state.
     */
    fun restoreDriveBackupNow() {
        viewModelScope.launch {
            val engine = core as? QuizRadarEngine
            if (engine == null) {
                showToast("Restore failed: the native core is not available.")
                return@launch
            }
            if (!_googleConnected.value) {
                showToast("Restore skipped: no Google account is signed in.")
                return@launch
            }
            try {
                val result = QuizRadarJsonParser.parseDriveBackupResult(engine.pullDriveBackup())
                if (!result.found || result.mergeReport == null) {
                    showToast("No backup found in your Drive app data folder.")
                    return@launch
                }
                val merged = result.mergeReport
                loadState()
                showToast(
                    "Restored from Drive: ${merged.assessmentsReplaced} assessments · " +
                        "${merged.topicsMerged} topics · ${merged.gradesMerged} grades · " +
                        "${merged.eventsUpserted} events updated",
                )
            } catch (e: Exception) {
                showToast("Restore failed: ${e.message ?: "unknown error"}")
            }
        }
    }

    /**
     * The stable per-device id the backup payload carries. Generated once and
     * persisted in the store's config table - a random UUID, nothing derived
     * from hardware or account identifiers.
     */
    private suspend fun ensureDeviceId(): String {
        val existing = core.getConfigString(DEVICE_ID_CONFIG_KEY)
        if (!existing.isNullOrBlank()) return existing
        val fresh = java.util.UUID.randomUUID().toString()
        core.setConfigString(DEVICE_ID_CONFIG_KEY, fresh)
        return fresh
    }

    fun setGoogleClientId(id: String) {
        val trimmed = id.trim()
        _googleClientId.value = trimmed
        persistConfig("google_client_id", trimmed.ifEmpty { null })
    }

    fun setTeamsClientId(id: String) {
        val trimmed = id.trim()
        _teamsClientId.value = trimmed
        persistConfig("teams_client_id", trimmed.ifEmpty { null })
    }

    fun setBackgroundScanEnabled(enabled: Boolean) {
        _backgroundScanEnabled.value = enabled
        persistConfig("background_scan_enabled", enabled)
    }

    fun setGeminiEnabled(enabled: Boolean) {
        // A native config write per keystroke is a native store write per
        // keystroke. The flag only changes when the key goes from empty to
        // filled (or back), so the write happens once, not on every letter.
        if (_geminiEnabled.value == enabled) return
        _geminiEnabled.value = enabled
        persistConfig("gemini_enabled", enabled)
    }

    /**
     * Reads a timetable image with Gemini and previews what it found.
     *
     * The image and the user's own BYOK key go straight into the Rust core,
     * which owns the prompt, the validation and the drop rules — the same
     * code the desktop shell and the browser tier run. The key is read from
     * the Keystore-backed token store OFF the main thread, and it never
     * reaches a log line or an error string.
     *
     * Nothing is written to the timetable here: the user sees the preview
     * first and applies it deliberately.
     */
    fun importTimetableFromImage(
        imageBytes: ByteArray,
        mime: String,
    ) {
        if (imageBytes.isEmpty()) {
            _timetableImportState.value =
                TimetableImportState.Failed("The picked image was empty - choose another file.")
            return
        }
        _timetableImportState.value = TimetableImportState.Working
        viewModelScope.launch {
            try {
                // A07 consent gate: a RETAINED key must not permit a send
                // while AI is disabled. The preference is checked FIRST, so
                // with the toggle off nothing — not even the Keystore read —
                // starts and zero bytes ever leave the device.
                if (!_geminiEnabled.value) {
                    _timetableImportState.value =
                        TimetableImportState.Failed(
                            "AI features are turned off in Settings, so this image never " +
                                "leaves the device. Turn Gemini back on to import a timetable.",
                        )
                    return@launch
                }
                val key =
                    withContext(coreDispatcher) {
                        core.geminiApiKey().orEmpty()
                    }
                if (key.isBlank()) {
                    _timetableImportState.value =
                        TimetableImportState.Failed(
                            "AI course import needs a Gemini API key. Add your own key in " +
                                "Settings -> AI (Gemini BYOK) and try again.",
                        )
                    return@launch
                }
                val encoded =
                    withContext(coreDispatcher) {
                        // Base64 of a photo-sized buffer is megabytes of
                        // garbage: encoding it on the main thread is a
                        // frame-dropping stall (and an ANR on a big image).
                        // It runs on the CORE dispatcher - off the main thread
                        // in the app, and on the test scheduler in the tests
                        // (a hard-coded Dispatchers.Default would race the
                        // test clock and leave the import stuck on "working").
                        android.util.Base64.encodeToString(imageBytes, android.util.Base64.NO_WRAP)
                    }
                val json = core.extractTimetableFromImage(encoded, mime, key)
                val extracted = QuizRadarJsonParser.parseExtractedTimetable(json)
                if (extracted.schedule.courses.isEmpty()) {
                    _timetableImportState.value =
                        TimetableImportState.Failed(
                            "Gemini could not read a single course from that image. " +
                                "Try a sharper screenshot of the whole timetable.",
                        )
                } else {
                    _timetableImportState.value = TimetableImportState.Preview(extracted)
                }
            } catch (e: Exception) {
                _timetableImportState.value =
                    TimetableImportState.Failed(
                        "AI course import failed: " +
                            (e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                    )
            }
        }
    }

    /**
     * Writes the previewed courses and their class slots into the timetable.
     *
     * Each course is upserted with its own slots, so an import never drops a
     * course that is already enrolled. The toast states what was actually
     * saved - and the preview's dropped-row count stays visible in the
     * summary, because rows the model could not read were NOT imported.
     */
    fun applyImportedTimetable(extracted: com.quizradar.app.model.ExtractedTimetableModel) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                var savedCourses = 0
                var savedSlots = 0
                for (course in extracted.schedule.courses) {
                    val courseSlots =
                        extracted.schedule.slots.filter { slot ->
                            slot.courseId.equals(course.id, ignoreCase = true)
                        }
                    val courseJson =
                        JSONObject().apply {
                            put("id", course.id.trim())
                            put("name", course.name.trim())
                            put("color", course.color ?: "#1a73e8")
                        }.toString()
                    val slotsJson =
                        JSONArray().apply {
                            courseSlots.forEachIndexed { index, slot ->
                                put(
                                    JSONObject().apply {
                                        put(
                                            "id",
                                            slot.id.ifBlank { "slot-${course.id}-${index + 1}" },
                                        )
                                        put("day", slot.day)
                                        put("course_id", course.id.trim())
                                        put("course_name", course.name.trim())
                                        put("type", slot.type.ifBlank { "Lecture" })
                                        put("start_time", slot.startTime)
                                        put("end_time", slot.endTime)
                                        put(
                                            "display_time",
                                            slot.displayTime ?: "${slot.startTime}-${slot.endTime}",
                                        )
                                        if (!slot.room.isNullOrBlank()) put("room", slot.room.trim())
                                        if (!slot.group.isNullOrBlank()) put("group", slot.group.trim())
                                        if (!slot.weekParity.isNullOrBlank()) put("week_parity", slot.weekParity)
                                    },
                                )
                            }
                        }.toString()
                    val updatedJson = callCore { core.upsertCourse(courseJson, slotsJson, refDate) }
                    val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                    _uiState.value = UiState.Ready(snapshot)
                    savedCourses += 1
                    savedSlots += courseSlots.size
                }
                lastLoadedDate = refDate
                onStateMutated?.invoke()
                _timetableImportState.value = TimetableImportState.Idle
                showToast("Imported $savedCourses courses and $savedSlots class slots")
            } catch (e: Exception) {
                _timetableImportState.value =
                    TimetableImportState.Failed(
                        "Could not save the imported timetable: " +
                            (e.message?.takeIf { it.isNotBlank() } ?: "unknown error"),
                    )
            }
        }
    }

    /** Closes the import preview (or clears the error) without saving anything. */
    fun dismissTimetableImport() {
        _timetableImportState.value = TimetableImportState.Idle
    }

    /**
     * Persists the user's own Gemini (BYOK) key.
     *
     * The key lives in the Keystore-backed token store, so a write is slow
     * and must not happen on the main thread. The write is DEBOUNCED: the
     * text field reports every keystroke, and a 30-character key would
     * otherwise queue 30 Keystore round trips and 30 "key saved" toasts,
     * each of which interrupts a screen reader.
     *
     * @param announce show the confirmation toast (the explicit Save action
     *   does; a keystroke does not).
     */
    fun saveGeminiApiKey(
        key: String,
        announce: Boolean = true,
    ) {
        val trimmed = key.trim()
        _geminiApiKey.value = trimmed
        val engine = core as? QuizRadarEngine
        geminiKeySaveAnnounce = geminiKeySaveAnnounce || announce
        geminiKeySaveJob?.cancel()
        geminiKeySaveJob =
            viewModelScope.launch {
                delay(350)
                val announceNow = geminiKeySaveAnnounce
                geminiKeySaveAnnounce = false
                // Keystore write - off the main thread (see disconnectGoogle).
                withContext(coreDispatcher) {
                    engine?.tokenProvider?.setGeminiApiKey(trimmed.ifEmpty { null })
                }
                if (announceNow) {
                    showToast(if (trimmed.isEmpty()) "Gemini key removed" else "Gemini key saved")
                }
            }
    }

    private var geminiKeySaveJob: Job? = null
    private var geminiKeySaveAnnounce = false

    fun validateGeminiKey(
        key: String,
        onResult: (Boolean, String) -> Unit,
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            val trimmed = key.trim()
            if (trimmed.isEmpty()) {
                onResult(false, "API key cannot be empty")
                return@launch
            }
            try {
                // The key travels in the `x-goog-api-key` header only - never
                // in the query string, where it would land in proxy logs and
                // crash reports (AGENTS §8).
                val endpoint = URL("https://generativelanguage.googleapis.com/v1beta/models")
                val conn = endpoint.openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.setRequestProperty("x-goog-api-key", trimmed)
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                val code = conn.responseCode
                if (code == 200) {
                    onResult(true, "Key is valid. Gemini models accessible.")
                } else {
                    onResult(false, "Validation failed: HTTP $code (${conn.responseMessage})")
                }
            } catch (e: Exception) {
                onResult(false, "Validation error: ${e.message}")
            }
        }
    }

    fun setNotifyExam24h(enabled: Boolean) {
        _notifyExam24h.value = enabled
        persistConfig("notify_exam_24h", enabled)
    }

    fun setNotifyExamSameDay(enabled: Boolean) {
        _notifyExamSameDay.value = enabled
        persistConfig("notify_exam_same_day", enabled)
    }

    fun setNotifyMorningDigest(enabled: Boolean) {
        _notifyMorningDigest.value = enabled
        persistConfig("notify_morning_digest", enabled)
    }

    fun setNotifyMorningTime(time: String) {
        _notifyMorningTime.value = time
        persistConfig("notify_morning_time", time)
    }

    fun setAutoSyncGcal(enabled: Boolean) {
        _autoSyncGcal.value = enabled
        persistConfig("auto_sync_gcal", enabled)
    }

    /** Sets only the appearance mode; the dark scheme preference is untouched. */
    fun setThemeMode(mode: String) {
        _themeMode.value = mode
        persistConfig("theme_mode", mode)
    }

    /** Sets only the preferred dark scheme; the appearance mode is untouched. */
    fun setPreferredDarkTheme(theme: String) {
        _preferredDarkTheme.value = theme
        persistConfig("preferred_dark_theme", theme)
    }

    /**
     * Persists the onboarding study-track preset. The chips used to keep the
     * answer in local Compose state only, so it was gone the moment the
     * wizard closed — the user answered a question and nothing happened.
     */
    fun setAcademicTrack(track: String?) {
        val value = track?.trim()?.takeIf { it.isNotEmpty() }
        _academicTrack.value = value
        persistConfig("academic_track", value)
        refreshState()
    }

    /**
     * Stateless study tasks derivation with the active (or overridden) academic track.
     */
    suspend fun deriveStudyTasks(
        assessmentsJson: String,
        topicsJson: String,
        refDate: LocalDate = clockDate(),
        trackOverride: String? = null,
    ): String =
        callCore {
            val track = trackOverride ?: _academicTrack.value ?: ""
            core.deriveStudyTasks(
                assessmentsJson = assessmentsJson,
                topicsJson = topicsJson,
                refDate = refDate,
                academicTrack = track,
            )
        }

    fun exportBackup(onResult: (String) -> Unit) {
        viewModelScope.launch {
            try {
                val json = callCore { core.exportBackup(clockDate()) }
                onResult(json)
            } catch (e: Exception) {
                showToast("Export failed: ${e.message}")
            }
        }
    }

    fun resetAllData(onComplete: () -> Unit) {
        viewModelScope.launch {
            // Stop everything that could touch the store while (or after) the
            // wipe: the running timer, the in-flight scan and the compose
            // draft. The scan is cancelled at the CORE level FIRST: the
            // native call is blocking, so cancelling the Kotlin coroutine
            // alone cannot stop it - only the core's own cancel flag aborts
            // the fetch phase and makes the run persist nothing (the flag is
            // re-checked before every persist). Cancelling the coroutine
            // then keeps the run from ever repopulating the UI or the state
            // flows with the wiped store's history.
            pausePomodoro()
            _pomodoroSecondsLeft.value = _pomodoroInterval.value.minutes * 60
            closePomodoro()
            try {
                requestNativeScanCancellation()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                // The core could not be told to abort the running scan, so
                // that scan may still persist AFTER the wipe and undo it.
                // Fail loudly instead of claiming a clean store.
                showToast("Reset failed: the running scan could not be cancelled: ${e.message}")
                return@launch
            }
            val runningScan = scanJob
            runningScan?.cancel()
            scanJob = null
            // Let the cancelled scan settle so its native call has RETURNED
            // before the store is wiped (otherwise it could persist right
            // after the wipe). Bounded: a reset must never hang.
            withTimeoutOrNull(SCAN_SETTLE_TIMEOUT_MS) { runningScan?.join() }
            _activeCreateEventDraft.value = null
            _isScanning.value = false
            val engine = core as? QuizRadarEngine
            try {
                // The core's canonical transactional reset (ONE SQLite
                // transaction wiping EVERY owned table: schedule, assessments,
                // custom events, feeds, config, attendance, study sessions,
                // quiz attempts, flashcards, mistake bank, email caches,
                // token metadata - audit A05).
                callCore { core.resetAllData() }
            } catch (e: Exception) {
                // A failed reset must fail loudly: the store may still hold
                // data, so the success toast is never shown (audit A05).
                showToast("Reset failed: ${e.message}")
                return@launch
            }
            try {
                // The credential wipe is a Keystore write (device-side, outside
                // the store). It runs AFTER the wipe: a failure here must not
                // mask the fact that the data itself is already gone.
                callCore { engine?.tokenProvider?.clearAll() }
            } catch (e: Exception) {
                showToast("Data reset, but clearing the stored credentials failed: ${e.message}")
            }
            // In-memory state loadState() does not repopulate: the scan
            // report/progress belong to the (now wiped) store history.
            // Attendance, analytics and every config-derived flow are
            // re-read from the emptied store by loadState() below.
            _lastScanReport.value = null
            _scanProgress.value = emptyList()
            _isScanning.value = false
            loadState()
            // Platform cleanup runs only AFTER the transactional reset AND the
            // reload succeeded: notifications survive a reset otherwise (their
            // registry is shell-side, not in the store), and BOTH widgets
            // would keep rendering the wiped data.
            onDataReset?.invoke()
            showToast("All data and credentials reset")
            onComplete()
        }
    }

    fun setOnboardingStep(step: Int) {
        val clamped = step.coerceIn(1, ONBOARDING_STEP_COUNT)
        _onboardingStep.value = clamped
        persistConfig("onboarding_step", clamped.toString())
    }

    fun completeOnboarding() {
        _onboardingCompleted.value = true
        _onboardingStep.value = 1
        persistConfig("onboarding_completed", true)
        persistConfig("onboarding_step", null)
        if (isGoogleConnected() || isMicrosoftConnected()) {
            refreshState()
        }
    }

    fun reRunOnboarding() {
        _onboardingStep.value = 1
        _onboardingCompleted.value = false
        persistConfig("onboarding_completed", false)
        persistConfig("onboarding_step", "1")
    }

    fun dismissSetupChecklist() {
        _isSetupChecklistDismissed.value = true
        persistConfig("dismiss_setup_checklist", true)
    }

    /**
     * The core version, read ONCE off the main thread.
     *
     * The audit found this being called inline during composition: a JNA ->
     * Rust round trip on the UI thread, on every recomposition of the About
     * card. The value is loaded with the rest of the state and published
     * here, so the UI only ever reads a cached string.
     *
     * It is declared with the other state flows (see the block above `init`)
     * so that it exists before the first load can publish into it.
     */
    private val _coreVersion = MutableStateFlow("")
    val coreVersion: StateFlow<String> = _coreVersion.asStateFlow()

    /** The cached core version - never a native call. */
    fun getCoreVersion(): String = _coreVersion.value

    /**
     * The first load.
     *
     * This init block sits at the END of the class on purpose: Kotlin runs
     * property initializers and init blocks in declaration order, so a load
     * that starts here can only touch state flows that already exist. When
     * this block ran in the middle of the class, the background load could
     * publish into a flow that had not been created yet - a NullPointerException
     * on a field the compiler happily calls "initialized".
     */
    init {
        loadState()
    }

    companion object {
        fun getWeekStart(date: LocalDate): LocalDate {
            var curr = date
            while (curr.dayOfWeek != DayOfWeek.SUNDAY) {
                curr = curr.minusDays(1)
            }
            return curr
        }

        fun provideFactory(
            core: QuizRadarCore,
            onStateMutated: (() -> Unit)? = null,
            onDataReset: (() -> Unit)? = null,
            clockDate: () -> LocalDate = { LocalDate.now() },
            coreDispatcher: CoroutineDispatcher = core.coreDispatcher,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return QuizRadarViewModel(
                        core = core,
                        onStateMutated = onStateMutated,
                        onDataReset = onDataReset,
                        coreDispatcher = coreDispatcher,
                        clockDate = clockDate,
                    ) as T
                }
            }
    }
}
