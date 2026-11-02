package com.quizradar.app.model

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

object QuizRadarJsonParser {
    private fun optDate(
        obj: JSONObject,
        key: String,
    ): LocalDate? {
        if (!obj.has(key) || obj.isNull(key)) return null
        val str = obj.optString(key, "")
        if (str.isBlank()) return null
        return try {
            LocalDate.parse(str)
        } catch (_: Exception) {
            null
        }
    }

    private fun optDouble(
        obj: JSONObject,
        key: String,
    ): Double? {
        if (!obj.has(key) || obj.isNull(key)) return null
        val d = obj.optDouble(key, Double.NaN)
        return if (d.isNaN()) null else d
    }

    private fun optFloat(
        obj: JSONObject,
        key: String,
    ): Float? {
        if (!obj.has(key) || obj.isNull(key)) return null
        val d = obj.optDouble(key, Double.NaN)
        return if (d.isNaN()) null else d.toFloat()
    }

    private fun optString(
        obj: JSONObject,
        key: String,
    ): String? {
        if (!obj.has(key) || obj.isNull(key)) return null
        val str = obj.optString(key, "")
        return if (str.isBlank()) null else str
    }

    private fun toStringList(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        val list = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            list.add(arr.optString(i, ""))
        }
        return list
    }

    fun parseCourse(obj: JSONObject): CourseModel {
        return CourseModel(
            id = obj.getString("id"),
            name = obj.getString("name"),
            color = optString(obj, "color"),
        )
    }

    fun parseSlot(obj: JSONObject): ScheduleSlotModel {
        return ScheduleSlotModel(
            id = obj.optString("id", ""),
            day = obj.optString("day", ""),
            courseId = obj.optString("course_id", ""),
            courseName = obj.optString("course_name", ""),
            type = obj.optString("type", ""),
            startTime = obj.optString("start_time", ""),
            endTime = obj.optString("end_time", ""),
            displayTime = optString(obj, "display_time"),
            room = optString(obj, "room"),
            instructor = optString(obj, "instructor"),
            group = optString(obj, "group"),
        )
    }

    fun parseSchedule(obj: JSONObject?): ScheduleDataModel {
        if (obj == null) return ScheduleDataModel()
        val coursesArr = obj.optJSONArray("courses")
        val courses = ArrayList<CourseModel>()
        if (coursesArr != null) {
            for (i in 0 until coursesArr.length()) {
                courses.add(parseCourse(coursesArr.getJSONObject(i)))
            }
        }
        val slotsArr = obj.optJSONArray("slots")
        val slots = ArrayList<ScheduleSlotModel>()
        if (slotsArr != null) {
            for (i in 0 until slotsArr.length()) {
                slots.add(parseSlot(slotsArr.getJSONObject(i)))
            }
        }
        return ScheduleDataModel(
            semester = optString(obj, "semester"),
            courses = courses,
            slots = slots,
        )
    }

    /**
     * The AI timetable-image extraction payload:
     * `{"schedule": {…}, "dropped_courses": n, "dropped_slots": n}`.
     */
    fun parseExtractedTimetable(jsonStr: String): ExtractedTimetableModel {
        val root = JSONObject(jsonStr)
        val schedule = parseSchedule(root.optJSONObject("schedule"))
        return ExtractedTimetableModel(
            schedule = schedule,
            droppedCourses = root.optInt("dropped_courses", 0),
            droppedSlots = root.optInt("dropped_slots", 0),
        )
    }

    fun parseCustomEvent(obj: JSONObject): CustomEventModel {
        return CustomEventModel(
            id = obj.getString("id"),
            title = obj.getString("title"),
            courseId = optString(obj, "course_id"),
            eventType = optString(obj, "event_type"),
            dateIso = optDate(obj, "date"),
            startTime = optString(obj, "start_time"),
            endTime = optString(obj, "end_time"),
            room = optString(obj, "room"),
            notes = optString(obj, "notes"),
            color = optString(obj, "color"),
        )
    }

    fun parseFeed(obj: JSONObject): FeedConfigModel {
        return FeedConfigModel(
            url = obj.getString("url"),
            label = obj.optString("label", ""),
            enabled = obj.optBoolean("enabled", true),
        )
    }

    fun parseGradeRecord(obj: JSONObject): GradeRecordModel {
        return GradeRecordModel(
            achievedScore = optDouble(obj, "achieved_score"),
            maxScore = optDouble(obj, "max_score"),
            weightagePercent = optDouble(obj, "weightage_percent"),
            updatedAt = optString(obj, "updated_at"),
        )
    }

    fun parseAssessment(obj: JSONObject): AssessmentModel {
        return AssessmentModel(
            id = obj.getString("id"),
            title = obj.getString("title"),
            courseId = optString(obj, "course_id"),
            courseName = optString(obj, "course_name"),
            assessmentType = obj.optString("assessment_type", "Class Quiz"),
            dateIso = optDate(obj, "date_iso"),
            dayName = optString(obj, "day_name"),
            startTime = optString(obj, "start_time"),
            endTime = optString(obj, "end_time"),
            displayTime = optString(obj, "display_time"),
            room = optString(obj, "room"),
            instructor = optString(obj, "instructor"),
            group = optString(obj, "group"),
            isUpcoming = obj.optBoolean("is_upcoming", true),
            daysUntil = if (obj.has("days_until") && !obj.isNull("days_until")) obj.getInt("days_until") else null,
            urgencyLevel = obj.optString("urgency_level", "normal"),
            priorityScore = obj.optInt("priority_score", 50),
            topics = toStringList(obj.optJSONArray("topics")),
            warnings = toStringList(obj.optJSONArray("warnings")),
            source = obj.optString("source", "Gmail"),
            achievedScore = optDouble(obj, "achieved_score"),
            maxScore = optDouble(obj, "max_score"),
            weightagePercent = optDouble(obj, "weightage_percent"),
            eLearningUrl = optString(obj, "e_learning_url"),
            isGcalSynced = obj.optBoolean("gcal_synced", false),
            gcalEventId = optString(obj, "gcal_event_id"),
            conflictWarning = optString(obj, "conflict_warning"),
        )
    }

    fun parseTopicCheckItem(obj: JSONObject): TopicCheckItemModel {
        return TopicCheckItemModel(
            key = obj.getString("key"),
            topic = obj.getString("topic"),
            completed = obj.optBoolean("completed", false),
        )
    }

    fun parseStudyRecommendation(obj: JSONObject): StudyRecommendationModel {
        val topicsArr = obj.optJSONArray("topics")
        val topics = ArrayList<TopicCheckItemModel>()
        if (topicsArr != null) {
            for (i in 0 until topicsArr.length()) {
                topics.add(parseTopicCheckItem(topicsArr.getJSONObject(i)))
            }
        }
        return StudyRecommendationModel(
            assessmentId = obj.getString("assessment_id"),
            courseId = optString(obj, "course_id"),
            courseName = optString(obj, "course_name"),
            title = obj.getString("title"),
            assessmentType = obj.optString("assessment_type", "Class Quiz"),
            dateIso = optDate(obj, "date_iso"),
            displayTime = optString(obj, "display_time"),
            daysUntil = if (obj.has("days_until") && !obj.isNull("days_until")) obj.getInt("days_until") else null,
            urgencyBadge = optString(obj, "urgency_badge"),
            priorityScore = obj.optInt("priority_score", 50),
            whyStudyNow = obj.optString("why_study_now", ""),
            aiStudyPlan = optString(obj, "ai_study_plan"),
            topics = topics,
            warnings = toStringList(obj.optJSONArray("warnings")),
            color = optString(obj, "color"),
            progressPercent = obj.optInt("progress_percent", 100),
        )
    }

    fun parseConflictAlert(obj: JSONObject): ConflictAlertModel {
        val severityStr = obj.optString("severity", "warning").lowercase()
        val severity = if (severityStr.contains("critical")) ConflictSeverity.CRITICAL else ConflictSeverity.WARNING
        return ConflictAlertModel(
            assessmentIdA = obj.getString("assessment_id_a"),
            assessmentIdB = obj.getString("assessment_id_b"),
            titleA = obj.optString("title_a", ""),
            titleB = obj.optString("title_b", ""),
            courseA = optString(obj, "course_a"),
            courseB = optString(obj, "course_b"),
            dateA = optDate(obj, "date_a") ?: LocalDate.now(),
            dateB = optDate(obj, "date_b") ?: LocalDate.now(),
            gapHours = obj.optInt("gap_hours", 26),
            severity = severity,
            message = obj.optString("message", ""),
            isMitigated = obj.optBoolean("is_mitigated", false),
        )
    }

    fun parseDashboardSummary(obj: JSONObject): DashboardSummaryModel {
        val refDate = optDate(obj, "reference_date") ?: LocalDate.now()
        val nextUp = if (obj.has("next_up") && !obj.isNull("next_up")) parseAssessment(obj.getJSONObject("next_up")) else null

        val upcomingArr = obj.optJSONArray("upcoming_this_week")
        val upcomingThisWeek = ArrayList<AssessmentModel>()
        if (upcomingArr != null) {
            for (i in 0 until upcomingArr.length()) {
                upcomingThisWeek.add(parseAssessment(upcomingArr.getJSONObject(i)))
            }
        }

        val allArr = obj.optJSONArray("all_upcoming")
        val allUpcoming = ArrayList<AssessmentModel>()
        if (allArr != null) {
            for (i in 0 until allArr.length()) {
                allUpcoming.add(parseAssessment(allArr.getJSONObject(i)))
            }
        }

        val typeCountsObj = obj.optJSONObject("exam_type_counts")
        val examTypeCounts = HashMap<String, Int>()
        if (typeCountsObj != null) {
            val keys = typeCountsObj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                examTypeCounts[k] = typeCountsObj.optInt(k, 0)
            }
        }

        val recsArr = obj.optJSONArray("study_recommendations")
        val studyRecs = ArrayList<StudyRecommendationModel>()
        if (recsArr != null) {
            for (i in 0 until recsArr.length()) {
                studyRecs.add(parseStudyRecommendation(recsArr.getJSONObject(i)))
            }
        }

        val alertsArr = obj.optJSONArray("conflict_alerts")
        val alerts = ArrayList<ConflictAlertModel>()
        if (alertsArr != null) {
            for (i in 0 until alertsArr.length()) {
                alerts.add(parseConflictAlert(alertsArr.getJSONObject(i)))
            }
        }

        val sourcesObj = obj.optJSONObject("sources_count")
        val sourcesCount = HashMap<String, Int>()
        if (sourcesObj != null) {
            val keys = sourcesObj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                sourcesCount[k] = sourcesObj.optInt(k, 0)
            }
        }

        return DashboardSummaryModel(
            referenceDate = refDate,
            nextUp = nextUp,
            upcomingThisWeek = upcomingThisWeek,
            allUpcoming = allUpcoming,
            examTypeCounts = examTypeCounts,
            studyRecommendations = studyRecs,
            totalTopicsCount = obj.optInt("total_topics_count", 0),
            completedTopicsCount = obj.optInt("completed_topics_count", 0),
            readinessPercent = obj.optInt("readiness_percent", 100),
            conflictAlerts = alerts,
            sourcesCount = sourcesCount,
        )
    }

    fun parseDailyStudyTask(obj: JSONObject): DailyStudyTaskModel {
        return DailyStudyTaskModel(
            id = obj.getString("id"),
            key = obj.getString("key"),
            assessmentId = obj.getString("assessment_id"),
            courseId = optString(obj, "course_id"),
            courseName = optString(obj, "course_name"),
            assessmentTitle = obj.getString("assessment_title"),
            assessmentType = obj.optString("assessment_type", "Class Quiz"),
            topic = obj.getString("topic"),
            dayOffset = obj.optInt("day_offset", 0),
            targetDateIso = optDate(obj, "target_date_iso") ?: LocalDate.now(),
            displayDay = obj.optString("display_day", ""),
            priorityRank = obj.optInt("priority_rank", 50),
            urgency = obj.optString("urgency", "normal"),
            estimatedHours = optFloat(obj, "estimated_hours"),
            aiReasoning = obj.optString("ai_reasoning", ""),
            completed = obj.optBoolean("completed", false),
            color = optString(obj, "color"),
            daysUntilAssessment = obj.optInt("days_until_assessment", 0),
            assessmentDateIso = optDate(obj, "assessment_date_iso") ?: LocalDate.now(),
        )
    }

    fun parseDailyStudyDayGroup(obj: JSONObject): DailyStudyDayGroupModel {
        val tasksArr = obj.optJSONArray("tasks")
        val tasks = ArrayList<DailyStudyTaskModel>()
        if (tasksArr != null) {
            for (i in 0 until tasksArr.length()) {
                tasks.add(parseDailyStudyTask(tasksArr.getJSONObject(i)))
            }
        }
        return DailyStudyDayGroupModel(
            dayOffset = obj.optInt("day_offset", 0),
            dateIso = optDate(obj, "date_iso") ?: LocalDate.now(),
            displayDay = obj.optString("display_day", ""),
            isToday = obj.optBoolean("is_today", false),
            totalEstimatedHours = optFloat(obj, "total_estimated_hours"),
            tasks = tasks,
        )
    }

    fun parseExamReadinessCard(obj: JSONObject): ExamReadinessCardModel {
        return ExamReadinessCardModel(
            assessmentId = obj.getString("assessment_id"),
            courseId = optString(obj, "course_id"),
            courseName = optString(obj, "course_name"),
            title = obj.getString("title"),
            assessmentType = obj.optString("assessment_type", "Class Quiz"),
            dateIso = optDate(obj, "date_iso") ?: LocalDate.now(),
            displayDate = optString(obj, "display_date"),
            daysUntil = obj.optInt("days_until", 0),
            readinessPercent = obj.optInt("readiness_percent", 100),
            completedCount = obj.optInt("completed_count", 0),
            totalCount = obj.optInt("total_count", 0),
            priorityScore = obj.optInt("priority_score", 50),
            color = optString(obj, "color"),
            recommendedFocus = obj.optString("recommended_focus", ""),
        )
    }

    fun parseStudyTasksPayload(obj: JSONObject): StudyTasksPayloadModel {
        val daysArr = obj.optJSONArray("days")
        val days = ArrayList<DailyStudyDayGroupModel>()
        if (daysArr != null) {
            for (i in 0 until daysArr.length()) {
                days.add(parseDailyStudyDayGroup(daysArr.getJSONObject(i)))
            }
        }

        val cardsArr = obj.optJSONArray("readiness_cards")
        val cards = ArrayList<ExamReadinessCardModel>()
        if (cardsArr != null) {
            for (i in 0 until cardsArr.length()) {
                cards.add(parseExamReadinessCard(cardsArr.getJSONObject(i)))
            }
        }

        return StudyTasksPayloadModel(
            days = days,
            readinessCards = cards,
            totalTasks = obj.optInt("total_tasks", 0),
            pendingTasks = obj.optInt("pending_tasks", 0),
            completedTasks = obj.optInt("completed_tasks", 0),
            totalHours = optFloat(obj, "total_hours"),
            aiGenerated = obj.optBoolean("ai_generated", false),
        )
    }

    /**
     * The core computes the per-assessment conflict chip while it builds the
     * dashboard summary, so the chip lands on `derived.dashboard.all_upcoming`
     * - not on the stored radar list the timeline rows read. Copy that same
     * value over (no second derivation, no new claim) so a clashing
     * assessment really renders its conflict chip.
     */
    private fun withConflictWarnings(
        assessments: List<AssessmentModel>,
        dashboard: DashboardSummaryModel,
    ): List<AssessmentModel> {
        val warnings =
            dashboard.allUpcoming
                .mapNotNull { assessment ->
                    val warning = assessment.conflictWarning?.trim()
                    if (warning.isNullOrEmpty()) null else assessment.id to warning
                }.toMap()
        if (warnings.isEmpty()) return assessments
        return assessments.map { assessment ->
            val warning = warnings[assessment.id]
            if (warning == null) assessment else assessment.copy(conflictWarning = warning)
        }
    }

    fun parseAppSnapshot(jsonStr: String): AppSnapshotModel {
        val root = JSONObject(jsonStr)

        val assessmentsArr = root.optJSONArray("assessments")
        val assessments = ArrayList<AssessmentModel>()
        if (assessmentsArr != null) {
            for (i in 0 until assessmentsArr.length()) {
                assessments.add(parseAssessment(assessmentsArr.getJSONObject(i)))
            }
        }

        val schedule = parseSchedule(root.optJSONObject("schedule"))

        val topicsObj = root.optJSONObject("completed_topics")
        val completedTopics = HashMap<String, Boolean>()
        if (topicsObj != null) {
            val keys = topicsObj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                completedTopics[k] = topicsObj.optBoolean(k, false)
            }
        }

        val eventsArr = root.optJSONArray("custom_events")
        val customEvents = ArrayList<CustomEventModel>()
        if (eventsArr != null) {
            for (i in 0 until eventsArr.length()) {
                customEvents.add(parseCustomEvent(eventsArr.getJSONObject(i)))
            }
        }

        val feedsArr = root.optJSONArray("feeds")
        val feeds = ArrayList<FeedConfigModel>()
        if (feedsArr != null) {
            for (i in 0 until feedsArr.length()) {
                feeds.add(parseFeed(feedsArr.getJSONObject(i)))
            }
        }

        val gradesObj = root.optJSONObject("grades")
        val grades = HashMap<String, GradeRecordModel>()
        if (gradesObj != null) {
            val keys = gradesObj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                grades[k] = parseGradeRecord(gradesObj.getJSONObject(k))
            }
        }

        val derived = root.getJSONObject("derived")
        val dashboard = parseDashboardSummary(derived.getJSONObject("dashboard"))
        val tasks = parseStudyTasksPayload(derived.getJSONObject("tasks"))

        return AppSnapshotModel(
            assessments = withConflictWarnings(assessments, dashboard),
            schedule = schedule,
            completedTopics = completedTopics,
            customEvents = customEvents,
            feeds = feeds,
            grades = grades,
            dashboard = dashboard,
            tasks = tasks,
        )
    }

    fun parsePracticeQuiz(jsonStr: String): PracticeQuizModel {
        val root = JSONObject(jsonStr)
        val questionsArr = root.optJSONArray("questions")
        val questions = ArrayList<PracticeQuestionModel>()
        if (questionsArr != null) {
            for (i in 0 until questionsArr.length()) {
                val qObj = questionsArr.getJSONObject(i)
                questions.add(
                    PracticeQuestionModel(
                        id = qObj.optString("id", "q$i"),
                        question = qObj.optString("question", ""),
                        options = toStringList(qObj.optJSONArray("options")),
                        correctIndex = qObj.optInt("correct_index", qObj.optInt("correctIndex", 0)),
                        explanation = optString(qObj, "explanation"),
                    ),
                )
            }
        }
        return PracticeQuizModel(
            assessmentId = root.optString("assessment_id", root.optString("assessmentId", "")),
            assessmentTitle = root.optString("assessment_title", root.optString("assessmentTitle", "Practice Quiz")),
            authoredLocally = root.optBoolean("authored_locally", root.optBoolean("authoredLocally", true)),
            generatedByAi = root.optBoolean("generated_by_ai", root.optBoolean("generatedByAi", false)),
            questions = questions,
        )
    }
}
