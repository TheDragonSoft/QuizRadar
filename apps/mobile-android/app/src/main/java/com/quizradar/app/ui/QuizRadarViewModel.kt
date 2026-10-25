package com.quizradar.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.quizradar.app.core.QuizRadarCore
import com.quizradar.app.model.AppSnapshotModel
import com.quizradar.app.model.PracticeQuizModel
import com.quizradar.app.model.QuizRadarJsonParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate

sealed interface UiState {
    object Loading : UiState

    data class Ready(val snapshot: AppSnapshotModel) : UiState

    data class Error(val message: String) : UiState
}

enum class DashboardSubTab {
    STUDY,
    ASSESSMENTS,
    OVERVIEW,
}

class QuizRadarViewModel(
    val core: QuizRadarCore,
    private val clockDate: () -> LocalDate = { LocalDate.now() },
) : ViewModel() {
    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _isConflictDismissed = MutableStateFlow(false)
    val isConflictDismissed: StateFlow<Boolean> = _isConflictDismissed.asStateFlow()

    private val _dashboardSubTab = MutableStateFlow(DashboardSubTab.STUDY)
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

    private val _activeDetailAssessmentId = MutableStateFlow<String?>(null)
    val activeDetailAssessmentId: StateFlow<String?> = _activeDetailAssessmentId.asStateFlow()

    private val _activePracticeAssessmentId = MutableStateFlow<String?>(null)
    val activePracticeAssessmentId: StateFlow<String?> = _activePracticeAssessmentId.asStateFlow()

    private val _practiceQuiz = MutableStateFlow<PracticeQuizModel?>(null)
    val practiceQuiz: StateFlow<PracticeQuizModel?> = _practiceQuiz.asStateFlow()

    private val _isPracticeLoading = MutableStateFlow(false)
    val isPracticeLoading: StateFlow<Boolean> = _isPracticeLoading.asStateFlow()

    private val _activePomodoroAssessmentId = MutableStateFlow<String?>(null)
    val activePomodoroAssessmentId: StateFlow<String?> = _activePomodoroAssessmentId.asStateFlow()

    private val _activePomodoroTopic = MutableStateFlow<String?>(null)
    val activePomodoroTopic: StateFlow<String?> = _activePomodoroTopic.asStateFlow()

    init {
        loadState()
    }

    fun loadState() {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val json = core.getState(refDate)
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(json)
                val dismissed = core.getConfigBool("dismiss_conflict_banner", false)
                _isConflictDismissed.value = dismissed
                _uiState.value = UiState.Ready(snapshot)
            } catch (e: Exception) {
                _uiState.value = UiState.Error(e.message ?: "Failed to load state")
            }
        }
    }

    fun refreshState() {
        viewModelScope.launch {
            _isRefreshing.value = true
            try {
                val refDate = clockDate()
                val json = core.getState(refDate)
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(json)
                _uiState.value = UiState.Ready(snapshot)
            } catch (e: Exception) {
                _uiState.value = UiState.Error(e.message ?: "Refresh failed")
            } finally {
                _isRefreshing.value = false
            }
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
        _isPracticeLoading.value = true

        val current = (_uiState.value as? UiState.Ready)?.snapshot ?: return
        val assessment = current.assessments.find { it.id == assessmentId }
        if (assessment == null) {
            _isPracticeLoading.value = false
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

                val quizJson = core.generatePracticeQuiz(assessmentJson)
                val quiz = QuizRadarJsonParser.parsePracticeQuiz(quizJson)
                _practiceQuiz.value = quiz
            } catch (_: Exception) {
                _practiceQuiz.value = null
            } finally {
                _isPracticeLoading.value = false
            }
        }
    }

    fun closePracticeQuiz() {
        _activePracticeAssessmentId.value = null
        _practiceQuiz.value = null
    }

    fun openPomodoro(
        assessmentId: String? = null,
        topic: String? = null,
    ) {
        _activePomodoroAssessmentId.value = assessmentId
        _activePomodoroTopic.value = topic
    }

    fun closePomodoro() {
        _activePomodoroAssessmentId.value = null
        _activePomodoroTopic.value = null
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
                val updatedJson = core.toggleTopic(topicKey, targetDone, refDate)
                val finalSnapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(finalSnapshot)
            } catch (e: Exception) {
                // Rollback on error
                _uiState.value = UiState.Ready(current.snapshot)
            }
        }
    }

    fun saveGrade(
        assessmentId: String,
        achieved: Double?,
        max: Double?,
        weight: Double?,
    ) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson =
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
                val finalSnapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(finalSnapshot)
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    fun dismissConflicts() {
        _isConflictDismissed.value = true
        viewModelScope.launch {
            core.setConfigBool("dismiss_conflict_banner", true)
        }
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

                val blocksJson = core.generateStudyBlocks(assessmentJson, scheduleJson, eventsJson, refDate)
                val blocksArr = JSONArray(blocksJson)

                if (blocksArr.length() > 0) {
                    val candidate = blocksArr.getJSONObject(0)
                    val updatedState = core.upsertCustomEvent(candidate.toString(), refDate)
                    val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedState)
                    _uiState.value = UiState.Ready(snapshot)
                }
            } catch (_: Exception) {
            }
        }
    }

    fun deleteCustomEvent(id: String) {
        viewModelScope.launch {
            try {
                val refDate = clockDate()
                val updatedJson = core.deleteCustomEvent(id, refDate)
                val snapshot = QuizRadarJsonParser.parseAppSnapshot(updatedJson)
                _uiState.value = UiState.Ready(snapshot)
            } catch (_: Exception) {
            }
        }
    }

    fun exportIcs(assessmentId: String?): String {
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
            clockDate: () -> LocalDate = { LocalDate.now() },
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return QuizRadarViewModel(core, clockDate) as T
                }
            }
    }
}
