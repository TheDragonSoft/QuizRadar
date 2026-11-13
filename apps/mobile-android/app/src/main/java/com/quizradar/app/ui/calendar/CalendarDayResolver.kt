package com.quizradar.app.ui.calendar

import com.quizradar.app.model.AssessmentModel
import com.quizradar.app.model.CustomEventModel
import com.quizradar.app.model.ScheduleSlotModel
import java.time.LocalDate

/**
 * The three kinds of thing that can appear on a calendar day.
 *
 * They are a FILTER, not a decoration: the user can hide a layer, and the
 * hidden layer disappears from the grid AND from the agenda (both read the
 * same resolved day).
 */
enum class CalendarLayer {
    CLASSES,
    ASSESSMENTS,
    CUSTOM_EVENTS,
}

/**
 * Which courses and which layers the calendar shows right now.
 *
 * An empty [courseIds] / [layers] means "everything" - the default view must
 * never hide data the user did not ask to hide.
 */
data class CalendarFilter(
    val courseIds: Set<String> = emptySet(),
    val layers: Set<CalendarLayer> = emptySet(),
) {
    val showsEveryCourse: Boolean get() = courseIds.isEmpty()

    val showsEveryLayer: Boolean get() = layers.isEmpty()

    /**
     * A course filter is strict: an item that belongs to no course (a custom
     * event without a course code) is not "in" any course, so it is hidden
     * while a course filter is on. The chip row shows the count so the user
     * can always see why a row disappeared.
     */
    fun showsCourse(courseId: String?): Boolean =
        showsEveryCourse ||
            courseId != null && courseIds.any { it.equals(courseId, ignoreCase = true) }

    fun showsLayer(layer: CalendarLayer): Boolean = showsEveryLayer || layer in layers
}

/**
 * Everything that happens on ONE date, already filtered.
 *
 * The week grid, the 3-day window and the agenda list all read this exact
 * shape, so the three views can never disagree about what is on a day.
 */
data class CalendarDayContents(
    val date: LocalDate,
    val slots: List<ScheduleSlotModel>,
    val assessments: List<AssessmentModel>,
    val customEvents: List<CustomEventModel>,
) {
    val totalCount: Int get() = slots.size + assessments.size + customEvents.size

    val isEmpty: Boolean get() = totalCount == 0
}

/** The kind of a rendered block, so a tap can be routed to the right action. */
enum class CalendarBlockKind {
    MERGED_EXAM,
    CLASS_SLOT,
    STANDALONE_EXAM,
    CUSTOM_EVENT,
}

/**
 * A block in the week grid.
 *
 * [laneIndex] / [laneCount] are mutated by [CalendarLanes.assignOverlapLanes]
 * to place overlapping blocks side by side.
 */
data class CalendarBlock(
    override val id: String,
    override val topPx: Int,
    override val heightPx: Int,
    override var laneIndex: Int = 0,
    override var laneCount: Int = 1,
    val kind: CalendarBlockKind,
    val title: String,
    val courseId: String?,
    val displayTime: String,
    val room: String?,
    val group: String?,
    val type: String?,
    val assessmentId: String?,
) : CalendarLaneItem

/**
 * THE one resolver for "what is on this date".
 *
 * Before this existed the screen answered that question three times, three
 * different ways:
 *  - the week grid matched the day AND the alternating-week parity
 *    (`WeekParityHelper.slotMatchesDate`),
 *  - the agenda matched the day name only - so a `week_b` class showed up in
 *    an `week_a` week - and it compared "Monday" against a "Mon" slot, so the
 *    agenda lost every class whose slot day was abbreviated (audit A09),
 *  - the 3-day window re-derived the days on its own.
 *
 * Every view now resolves through [resolve], which is the single place that
 * knows about days, week parity and filters.
 */
object CalendarDayResolver {
    /**
     * Resolves one date against the whole snapshot data.
     *
     * The result is sorted by start time so the grid, the agenda and the
     * 3-day window render the same order.
     */
    fun resolve(
        date: LocalDate,
        slots: List<ScheduleSlotModel>,
        assessments: List<AssessmentModel>,
        customEvents: List<CustomEventModel>,
        filter: CalendarFilter = CalendarFilter(),
    ): CalendarDayContents =
        CalendarDayContents(
            date = date,
            slots =
                slots
                    .filter { WeekParityHelper.slotMatchesDate(it, date) }
                    .filter { filter.showsCourse(it.courseId) }
                    .filter { filter.showsLayer(CalendarLayer.CLASSES) }
                    .sortedBy { it.startTime },
            assessments =
                assessments
                    .filter { it.dateIso == date }
                    .filter { filter.showsCourse(it.courseId) }
                    .filter { filter.showsLayer(CalendarLayer.ASSESSMENTS) }
                    .sortedBy { it.startTime ?: "00:00" },
            customEvents =
                customEvents
                    .filter { it.dateIso == date }
                    .filter { filter.showsCourse(it.courseId) }
                    .filter { filter.showsLayer(CalendarLayer.CUSTOM_EVENTS) }
                    .sortedBy { it.startTime ?: "00:00" },
        )

    /**
     * Builds the drawable blocks of a day.
     *
     * A class slot and an exam are ONE block only when they share the course
     * AND the start time; every other pair stays two blocks (no class is ever
     * dropped).
     */
    fun buildBlocks(contents: CalendarDayContents): List<CalendarBlock> {
        val rawBlocks = mutableListOf<CalendarBlock>()

        val mergedSlotByExamId = mutableMapOf<String, ScheduleSlotModel>()
        val mergedSlotIds = mutableSetOf<String>()

        contents.slots.forEach { slot ->
            val matchingExam =
                contents.assessments.firstOrNull { exam ->
                    // One exam absorbs one slot: a second slot with the same
                    // course and start time keeps its own block instead of
                    // vanishing.
                    !mergedSlotByExamId.containsKey(exam.id) &&
                        shouldMergeExamWithSlot(
                            exam.courseId,
                            exam.startTime,
                            slot.courseId,
                            slot.startTime,
                        )
                }
            if (matchingExam != null) {
                mergedSlotByExamId[matchingExam.id] = slot
                mergedSlotIds.add(slot.id)
            }
        }

        contents.assessments.forEach { exam ->
            val mergedSlot = mergedSlotByExamId[exam.id]
            // The merged block keeps the SLOT's clock range (web parity) so
            // the class length is not lost.
            val position =
                CalendarLanes.computeBlockPosition(
                    mergedSlot?.startTime ?: exam.startTime,
                    mergedSlot?.endTime ?: exam.endTime,
                )
            rawBlocks.add(
                CalendarBlock(
                    id = exam.id,
                    topPx = position.topPx,
                    heightPx = position.heightPx,
                    kind =
                        if (mergedSlot != null) {
                            CalendarBlockKind.MERGED_EXAM
                        } else {
                            CalendarBlockKind.STANDALONE_EXAM
                        },
                    title = exam.title,
                    courseId = exam.courseId,
                    displayTime = exam.displayTime ?: "All Day",
                    room = mergedSlot?.room ?: exam.room,
                    group = exam.group,
                    type = exam.assessmentType,
                    assessmentId = exam.id,
                ),
            )
        }

        contents.slots.forEach { slot ->
            if (slot.id !in mergedSlotIds) {
                val position = CalendarLanes.computeBlockPosition(slot.startTime, slot.endTime)
                rawBlocks.add(
                    CalendarBlock(
                        id = slot.id,
                        topPx = position.topPx,
                        heightPx = position.heightPx,
                        kind = CalendarBlockKind.CLASS_SLOT,
                        title =
                            listOfNotNull(
                                slot.courseName.ifBlank { null },
                                slot.type.ifBlank { null },
                            ).joinToString(" "),
                        courseId = slot.courseId,
                        displayTime = slot.displayTime ?: "${slot.startTime}–${slot.endTime}",
                        room = slot.room,
                        group = slot.group,
                        type = slot.type.ifBlank { null },
                        assessmentId = null,
                    ),
                )
            }
        }

        contents.customEvents.forEach { event ->
            val position = CalendarLanes.computeBlockPosition(event.startTime, event.endTime)
            rawBlocks.add(
                CalendarBlock(
                    id = event.id,
                    topPx = position.topPx,
                    heightPx = position.heightPx,
                    kind = CalendarBlockKind.CUSTOM_EVENT,
                    title = event.title,
                    courseId = event.courseId,
                    displayTime = formatCustomEventTime(event.startTime, event.endTime),
                    room = event.room,
                    group = null,
                    type = event.eventType,
                    assessmentId = null,
                ),
            )
        }

        return CalendarLanes.assignOverlapLanes(rawBlocks)
    }

    /**
     * Merge rule for the week grid: a class slot and an exam are the SAME
     * block only when they share the course AND the start time (web parity -
     * `apps/web/src/views/CalendarView.tsx`).
     *
     * Merging on the course alone deleted every class of that course on that
     * day: a 09:00 lecture and a 16:00 exam are two different blocks, and the
     * lecture must still render.
     */
    fun shouldMergeExamWithSlot(
        examCourseId: String?,
        examStartTime: String?,
        slotCourseId: String?,
        slotStartTime: String?,
    ): Boolean {
        val examCourse = examCourseId?.trim().orEmpty()
        val slotCourse = slotCourseId?.trim().orEmpty()
        if (examCourse.isEmpty() || slotCourse.isEmpty()) return false
        if (!examCourse.equals(slotCourse, ignoreCase = true)) return false

        val examStart = examStartTime?.trim().orEmpty()
        val slotStart = slotStartTime?.trim().orEmpty()
        // No known time on either side: there is nothing proving they are the
        // same block, so both stay separate (never guess a merge).
        if (examStart.isEmpty() || slotStart.isEmpty()) return false
        return normalizeClockTime(examStart) == normalizeClockTime(slotStart)
    }

    /**
     * Honest time label for a custom calendar event: the real clock range
     * when the event has one, the em dash when it has none. The old label
     * printed an empty "–" pair for a time-less event, which read like
     * broken data.
     */
    fun formatCustomEventTime(
        startTime: String?,
        endTime: String?,
    ): String {
        val start = startTime?.trim()?.takeIf { it.isNotEmpty() }
        val end = endTime?.trim()?.takeIf { it.isNotEmpty() }
        return when {
            start != null && end != null -> "$start–$end"
            start != null -> start
            end != null -> "Until $end"
            else -> "—"
        }
    }

    /** "09:00" and "9:00" are the same clock time; anything else stays as-is. */
    private fun normalizeClockTime(value: String): String {
        val parts = value.split(":")
        val hours = parts.getOrNull(0)?.trim()?.toIntOrNull()
        if (hours == null) return value.trim()
        val minutes = parts.getOrNull(1)?.trim()?.toIntOrNull() ?: 0
        return "%02d:%02d".format(hours, minutes)
    }
}
