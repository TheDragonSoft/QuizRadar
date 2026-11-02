package com.quizradar.app.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.quizradar.app.core.QuizRadarCore
import com.quizradar.app.core.QuizRadarEngine
import com.quizradar.app.model.AppSnapshotModel
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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

class QuizRadarViewModel(
    val core: QuizRadarCore,
    private val onStateMutated: (() -> Unit)? = null,
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

    private val _syncWeeklyClassesToGcal = MutableStateFlow(false)
    val syncWeeklyClassesToGcal: StateFlow<Boolean> = _syncWeeklyClassesToGcal.asStateFlow()

    private val _theme = MutableStateFlow("system")
    val theme: StateFlow<String> = _theme.asStateFlow()

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
                    _syncWeeklyClassesToGcal.value =
                        core.getConfigBool("sync_weekly_classes_to_gcal", false)
                    _theme.value = core.getConfigString("theme") ?: "system"
                    _academicTrack.value = core.getConfigString("academic_track")

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
                        core.getConfigString("onboarding_step")?.toIntOrNull()?.coerceIn(1, 4) ?: 1
                    _isSetupChecklistDismissed.value =
                        core.getConfigBool("dismiss_setup_checklist", false)

                    val engine = core as? QuizRadarEngine
                    _geminiApiKey.value = core.geminiApiKey() ?: ""
                    // The version is a native call too - read it here, on the
                    // core dispatcher, instead of from the UI.
                    _coreVersion.value = core.version()
                    refreshAccountFlags(engine)

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

                val quizJson = callCore { core.generatePracticeQuiz(assessmentJson) }
                val quiz = QuizRadarJsonParser.parsePracticeQuiz(quizJson)
                _practiceQuiz.value = quiz
            } catch (e: Exception) {
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
        _activePracticeAssessmentId.value = null
        _practiceQuiz.value = null
        _practiceQuizError.value = null
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
                            put("date", e.dateIso?.toString())
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

    fun addCustomEvent(event: CustomEventModel) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val eventJson =
                    JSONObject().apply {
                        put("id", event.id)
                        put("title", event.title)
                        put("course_id", event.courseId)
                        put("event_type", event.eventType ?: "Custom")
                        put("date", event.dateIso?.toString())
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
            } catch (_: Exception) {
            }
        }
    }

    fun deleteCustomEvent(id: String) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = callCore { core.deleteCustomEvent(id, refDate) }
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
                lastLoadedDate = refDate
                onStateMutated?.invoke()
            } catch (_: Exception) {
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
                val reportObj = org.json.JSONObject(reportJson)
                val courses = reportObj.optInt("courses_imported", 0)
                val assessments = reportObj.optInt("assessments_imported", 0)
                val grades = reportObj.optInt("grades_imported", 0)
                val topics = reportObj.optInt("topics_imported", 0)
                val secretsCount = reportObj.optJSONArray("secrets_ignored")?.length() ?: 0
                val secretsMsg = if (secretsCount > 0) " ($secretsCount legacy secrets dropped)" else ""
                _toastMessage.value = "Restored: $courses courses, $assessments assessments, $grades grades, $topics topics.$secretsMsg"
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
                val courseJson =
                    JSONObject().apply {
                        put("id", course.id.trim().uppercase())
                        put("name", course.name.trim())
                        put("color", course.color ?: "#1a73e8")
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
                val backupJson = callCore { core.exportBackup(refDate) }
                val root = JSONObject(backupJson)
                val feedsArr = root.optJSONArray("feeds") ?: JSONArray()
                if (feedsArr.length() >= 10) {
                    showToast("Maximum 10 calendar feeds allowed")
                    return@launch
                }
                val newFeed =
                    JSONObject().apply {
                        put("id", "feed-${System.currentTimeMillis()}")
                        put("name", label.trim().ifEmpty { "Calendar Feed" })
                        put("url", url.trim())
                        put("enabled", true)
                    }
                feedsArr.put(newFeed)
                root.put("feeds", feedsArr)
                callCore { core.importBackup(root.toString(), refDate) }
                loadState()
                showToast("Feed added")
                onComplete?.invoke()
            } catch (e: Exception) {
                showToast("Failed to add feed: ${e.message}")
            }
        }
    }

    /**
     * Removes a subscribed feed by URL (the parsed feed model carries no id;
     * the URL is the feed's stable key). The delete button used to be a no-op
     * that toasted "Feed status updated" — a success message for an action
     * that did nothing.
     */
    fun removeIcsFeed(feedUrl: String) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val backupJson = callCore { core.exportBackup(refDate) }
                val root = JSONObject(backupJson)
                val feedsArr = root.optJSONArray("feeds") ?: JSONArray()
                val kept = JSONArray()
                var removed = false
                for (i in 0 until feedsArr.length()) {
                    val feed = feedsArr.getJSONObject(i)
                    if (feed.optString("url") == feedUrl) {
                        removed = true
                    } else {
                        kept.put(feed)
                    }
                }
                if (!removed) {
                    showToast("Feed not found")
                    return@launch
                }
                root.put("feeds", kept)
                callCore { core.importBackup(root.toString(), refDate) }
                loadState()
                showToast("Feed removed")
            } catch (e: Exception) {
                showToast("Failed to remove feed: ${e.message}")
            }
        }
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

    fun setSyncWeeklyClassesToGcal(enabled: Boolean) {
        _syncWeeklyClassesToGcal.value = enabled
        persistConfig("sync_weekly_classes_to_gcal", enabled)
    }

    fun setTheme(themeVal: String) {
        _theme.value = themeVal
        persistConfig("theme", themeVal)
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
            try {
                val refDate = clockDate()
                val currentEvents = (_uiState.value as? UiState.Ready)?.snapshot?.customEvents ?: emptyList()
                val engine = core as? QuizRadarEngine
                // Every step of the reset is a native store write (and the
                // token wipe is a Keystore write) - it all runs on the core
                // dispatcher, never on the main thread.
                callCore {
                    core.saveSchedule("""{"courses":[],"slots":[]}""", refDate)
                    core.replaceAssessments("[]", refDate)
                    for (ev in currentEvents) {
                        core.deleteCustomEvent(ev.id, refDate)
                    }
                    core.setConfigString("user_name", null)
                    core.setConfigString("user_email", null)
                    core.setConfigBool("auto_sync_gcal", false)
                    core.setConfigBool("gemini_enabled", false)
                    core.setConfigBool("onboarding_completed", false)
                    engine?.tokenProvider?.clearAll()
                }
                loadState()
                showToast("All data and credentials reset")
                onComplete()
            } catch (e: Exception) {
                showToast("Reset failed: ${e.message}")
            }
        }
    }

    fun setOnboardingStep(step: Int) {
        val clamped = step.coerceIn(1, 4)
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
            clockDate: () -> LocalDate = { LocalDate.now() },
            coreDispatcher: CoroutineDispatcher = core.coreDispatcher,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return QuizRadarViewModel(
                        core = core,
                        onStateMutated = onStateMutated,
                        coreDispatcher = coreDispatcher,
                        clockDate = clockDate,
                    ) as T
                }
            }
    }
}
