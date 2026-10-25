package com.quizradar.app.model

import java.time.LocalDate

data class CourseModel(
    val id: String,
    val name: String,
    val color: String? = null,
)

data class ScheduleSlotModel(
    val id: String,
    val day: String,
    val courseId: String,
    val courseName: String,
    val type: String,
    val startTime: String,
    val endTime: String,
    val displayTime: String? = null,
    val room: String? = null,
    val instructor: String? = null,
    val group: String? = null,
)

data class ScheduleDataModel(
    val semester: String? = null,
    val courses: List<CourseModel> = emptyList(),
    val slots: List<ScheduleSlotModel> = emptyList(),
)

data class CustomEventModel(
    val id: String,
    val title: String,
    val courseId: String? = null,
    val eventType: String? = null,
    val dateIso: LocalDate? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val room: String? = null,
    val notes: String? = null,
    val color: String? = null,
)

data class FeedConfigModel(
    val url: String,
    val label: String,
    val enabled: Boolean = true,
)

data class GradeRecordModel(
    val achievedScore: Double? = null,
    val maxScore: Double? = null,
    val weightagePercent: Double? = null,
    val updatedAt: String? = null,
)

data class AssessmentModel(
    val id: String,
    val title: String,
    val courseId: String? = null,
    val courseName: String? = null,
    val assessmentType: String = "Class Quiz",
    val dateIso: LocalDate? = null,
    val dayName: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val displayTime: String? = null,
    val room: String? = null,
    val instructor: String? = null,
    val group: String? = null,
    val isUpcoming: Boolean = true,
    val daysUntil: Int? = null,
    val urgencyLevel: String = "normal",
    val priorityScore: Int = 50,
    val topics: List<String> = emptyList(),
    val warnings: List<String> = emptyList(),
    val source: String = "Gmail",
    val achievedScore: Double? = null,
    val maxScore: Double? = null,
    val weightagePercent: Double? = null,
    val eLearningUrl: String? = null,
    val isGcalSynced: Boolean = false,
    val gcalEventId: String? = null,
)

data class TopicCheckItemModel(
    val key: String,
    val topic: String,
    val completed: Boolean = false,
)

data class StudyRecommendationModel(
    val assessmentId: String,
    val courseId: String? = null,
    val courseName: String? = null,
    val title: String,
    val assessmentType: String,
    val dateIso: LocalDate? = null,
    val displayTime: String? = null,
    val daysUntil: Int? = null,
    val urgencyBadge: String? = null,
    val priorityScore: Int = 50,
    val whyStudyNow: String,
    val aiStudyPlan: String? = null,
    val topics: List<TopicCheckItemModel> = emptyList(),
    val warnings: List<String> = emptyList(),
    val color: String? = null,
    val progressPercent: Int = 100,
)

enum class ConflictSeverity {
    CRITICAL,
    WARNING,
}

data class ConflictAlertModel(
    val assessmentIdA: String,
    val assessmentIdB: String,
    val titleA: String,
    val titleB: String,
    val courseA: String? = null,
    val courseB: String? = null,
    val dateA: LocalDate,
    val dateB: LocalDate,
    val gapHours: Int,
    val severity: ConflictSeverity,
    val message: String,
    val isMitigated: Boolean = false,
)

data class DashboardSummaryModel(
    val referenceDate: LocalDate,
    val nextUp: AssessmentModel? = null,
    val upcomingThisWeek: List<AssessmentModel> = emptyList(),
    val allUpcoming: List<AssessmentModel> = emptyList(),
    val examTypeCounts: Map<String, Int> = emptyMap(),
    val studyRecommendations: List<StudyRecommendationModel> = emptyList(),
    val totalTopicsCount: Int = 0,
    val completedTopicsCount: Int = 0,
    val readinessPercent: Int = 100,
    val conflictAlerts: List<ConflictAlertModel> = emptyList(),
    val sourcesCount: Map<String, Int> = emptyMap(),
)

data class DailyStudyTaskModel(
    val id: String,
    val key: String,
    val assessmentId: String,
    val courseId: String? = null,
    val courseName: String? = null,
    val assessmentTitle: String,
    val assessmentType: String,
    val topic: String,
    val dayOffset: Int,
    val targetDateIso: LocalDate,
    val displayDay: String,
    val priorityRank: Int,
    val urgency: String,
    val estimatedHours: Float? = null,
    val aiReasoning: String,
    val completed: Boolean = false,
    val color: String? = null,
    val daysUntilAssessment: Int,
    val assessmentDateIso: LocalDate,
)

data class DailyStudyDayGroupModel(
    val dayOffset: Int,
    val dateIso: LocalDate,
    val displayDay: String,
    val isToday: Boolean,
    val totalEstimatedHours: Float? = null,
    val tasks: List<DailyStudyTaskModel> = emptyList(),
)

data class ExamReadinessCardModel(
    val assessmentId: String,
    val courseId: String? = null,
    val courseName: String? = null,
    val title: String,
    val assessmentType: String,
    val dateIso: LocalDate,
    val displayDate: String? = null,
    val daysUntil: Int,
    val readinessPercent: Int,
    val completedCount: Int,
    val totalCount: Int,
    val priorityScore: Int,
    val color: String? = null,
    val recommendedFocus: String,
)

data class StudyTasksPayloadModel(
    val days: List<DailyStudyDayGroupModel> = emptyList(),
    val readinessCards: List<ExamReadinessCardModel> = emptyList(),
    val totalTasks: Int = 0,
    val pendingTasks: Int = 0,
    val completedTasks: Int = 0,
    val totalHours: Float? = null,
    val aiGenerated: Boolean = false,
)

data class AppSnapshotModel(
    val assessments: List<AssessmentModel> = emptyList(),
    val schedule: ScheduleDataModel = ScheduleDataModel(),
    val completedTopics: Map<String, Boolean> = emptyMap(),
    val customEvents: List<CustomEventModel> = emptyList(),
    val feeds: List<FeedConfigModel> = emptyList(),
    val grades: Map<String, GradeRecordModel> = emptyMap(),
    val dashboard: DashboardSummaryModel,
    val tasks: StudyTasksPayloadModel,
)

data class PracticeQuestionModel(
    val id: String,
    val question: String,
    val options: List<String>,
    val correctIndex: Int,
    val explanation: String? = null,
)

data class PracticeQuizModel(
    val assessmentId: String,
    val assessmentTitle: String,
    val authoredLocally: Boolean = true,
    val generatedByAi: Boolean = false,
    val questions: List<PracticeQuestionModel> = emptyList(),
)
