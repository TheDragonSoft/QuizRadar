package com.quizradar.app.model

import java.time.LocalDate

data class CourseModel(
    val id: String,
    val name: String,
    val color: String? = null,
    /**
     * Credit weight for GPA (`core/src/types.rs`: `Course.credits`). Round
     * -tripped so a course EDIT that does not touch credits keeps the
     * persisted value instead of silently wiping it.
     */
    val credits: Double? = null,
    /** Absence warning threshold (`Course.max_absences`), same round-trip rule. */
    val maxAbsences: Int? = null,
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
    val weekParity: String? = null,
)

data class ScheduleDataModel(
    val semester: String? = null,
    val courses: List<CourseModel> = emptyList(),
    val slots: List<ScheduleSlotModel> = emptyList(),
)

/**
 * The result of one AI timetable-image extraction (`01` §4.1).
 *
 * The dropped counts are part of the payload on purpose: rows the model got
 * wrong are counted, never repaired into existence, and the preview shows
 * them so the user knows the image was only partly readable.
 */
data class ExtractedTimetableModel(
    val schedule: ScheduleDataModel = ScheduleDataModel(),
    val droppedCourses: Int = 0,
    val droppedSlots: Int = 0,
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
    /**
     * The store's stable feed id (`core/src/types.rs`: `FeedConfig.id`,
     * `"feed-<unix_millis>"`). Feed DELETE targets the id, not the URL -
     * without it the shell cannot call the core's real delete operation.
     */
    val id: String = "",
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

/**
 * One persisted attendance mark (`core/src/types.rs`: `AttendanceEntry`).
 *
 * The association is EXPLICIT - `slotId`, `courseId` and `dateIso` travel
 * with the record - so absence counts match on `courseId` exactly instead of
 * searching for the course id inside a `slotId::date` string (audit A10:
 * generated slot ids need not contain the course id).
 */
data class AttendanceEntryModel(
    val id: String,
    val slotId: String,
    val courseId: String,
    val dateIso: String,
    /** `attended` | `absent` | `excused` (`AttendanceStatus`). */
    val status: String,
)

/**
 * Study analytics derived by the core from the persisted session log
 * (`core/src/types.rs`: `StudyAnalytics`). Every number here is history the
 * user actually logged - the shell starts EMPTY and never seeds examples
 * (audit A06).
 */
data class StudyAnalyticsModel(
    val currentStreakDays: Int = 0,
    val bestStreakDays: Int = 0,
    val totalFocusMinutes: Int = 0,
    /** Focus minutes per course id; sessions without a course are unattributed. */
    val minutesByCourse: Map<String, Int> = emptyMap(),
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
    /**
     * Short "exam schedule cluster" line the core computes for an
     * assessment that clashes with a neighbour (`01` §4.3 timeline chip).
     * `null` when the assessment is clean.
     */
    val conflictWarning: String? = null,
    /**
     * What the pipeline inferred (heuristic vs explicit) and why the core
     * says so (`core/src/types.rs`). `null` only for fully user-created
     * items that need no explanation.
     */
    val aiInferenceNote: String? = null,
    /**
     * The core's study plan for this assessment, when one was produced.
     * The hour estimate below is labeled as an estimate inside this plan.
     */
    val aiStudyPlan: String? = null,
    /**
     * Heuristic study-hour estimate - never a confirmed workload.
     */
    val estimatedStudyHours: Float? = null,
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
    /**
     * A07 honesty: when an AI attempt was made but did NOT author the quiz,
     * the core names why (consent off, no key, quota, transport). `null`
     * when the provenance needs no excuse (AI authored it, or the user
     * never asked for AI).
     */
    val fallbackReason: String? = null,
)

/**
 * One per-source row of the scan report (`runNativeSync` in `core/ffi.rs`).
 *
 * `status` is exactly what the core reports - "ran", "skipped" or "failed" -
 * and `detail` carries the skip reason or the error string verbatim. The UI
 * must not translate a skipped source into a success.
 */
data class SyncSourceReportModel(
    val name: String,
    val status: String,
    val detail: String? = null,
    val found: Int = 0,
    val runId: String? = null,
)

/**
 * The honest outcome of one on-device scan run: what each source did, what
 * was found, and the core's own truthful notes. An empty scan says so.
 */
data class SyncReportModel(
    val success: Boolean = false,
    val totalNew: Int = 0,
    val totalUpdated: Int = 0,
    val notes: List<String> = emptyList(),
    val perSource: List<SyncSourceReportModel> = emptyList(),
    val discoveredTeamsCount: Int = 0,
    /**
     * A07 cancellation: the core aborted the fetch and persisted NOTHING.
     * A cancelled report is not a success and not a failure — the UI says
     * exactly what happened ("nothing was saved") instead of either.
     */
    val cancelled: Boolean = false,
)

/**
 * The Google Calendar push report (`pushNativeGcal`). `needsScope` marks a
 * 401/403 refusal - nothing was marked as synced.
 */
data class GcalPushReportModel(
    val success: Boolean = false,
    val created: Int = 0,
    val updated: Int = 0,
    val totalPushable: Int = 0,
    val failedIds: List<String> = emptyList(),
    val skippedUndated: Int = 0,
    val needsScope: Boolean = false,
    val message: String? = null,
)

/** The additive-merge counters the Drive restore reports (`backup.rs`). */
data class DriveBackupMergeReportModel(
    val assessmentsReplaced: Int = 0,
    val assessmentsKeptNewer: Int = 0,
    val topicsMerged: Int = 0,
    val gradesMerged: Int = 0,
    val eventsUpserted: Int = 0,
    val feedsUpserted: Int = 0,
    val scheduleReplaced: Boolean = false,
)

/**
 * The Drive restore outcome: `found: false` is the honest "no backup exists
 * yet" state, never a fabricated success.
 */
data class DriveBackupResultModel(
    val found: Boolean = false,
    val mergeReport: DriveBackupMergeReportModel? = null,
)
