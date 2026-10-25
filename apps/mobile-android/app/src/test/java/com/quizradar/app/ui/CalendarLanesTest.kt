package com.quizradar.app.ui

import com.quizradar.app.ui.calendar.CalendarLaneItem
import com.quizradar.app.ui.calendar.CalendarLanes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private data class TestLaneItem(
    override val id: String,
    override val topPx: Int,
    override val heightPx: Int,
    override var laneIndex: Int = 0,
    override var laneCount: Int = 1,
) : CalendarLaneItem

class CalendarLanesTest {
    @Test
    fun computeBlockPosition_enforces_minimum_duration_and_bounds() {
        // 09:00 to 10:30 starting at 08:00 with 60px/hr
        val pos = CalendarLanes.computeBlockPosition("09:00", "10:30", startHour = 8, endHour = 21, hourHeight = 60)
        // 1 hour after start -> top = 60 + 1 = 61
        assertEquals(61, pos.topPx)
        // 1.5 hours duration -> height = 90 - 3 = 87
        assertEquals(87, pos.heightPx)

        // Super short event (10 minutes) clamped to 45 mins (0.75h * 60 = 45 - 3 = 42)
        val shortPos = CalendarLanes.computeBlockPosition("09:00", "09:10", startHour = 8, endHour = 21, hourHeight = 60)
        assertEquals(42, shortPos.heightPx)
    }

    @Test
    fun assignOverlapLanes_packs_non_overlapping_items_into_single_lane() {
        val item1 = TestLaneItem("1", topPx = 60, heightPx = 50)
        val item2 = TestLaneItem("2", topPx = 120, heightPx = 50)

        val packed = CalendarLanes.assignOverlapLanes(listOf(item1, item2))
        assertEquals(1, packed[0].laneCount)
        assertEquals(0, packed[0].laneIndex)
        assertEquals(1, packed[1].laneCount)
        assertEquals(0, packed[1].laneIndex)
    }

    @Test
    fun assignOverlapLanes_packs_overlapping_items_into_distinct_lanes() {
        // Two events happening at the same time: 09:00 - 10:30
        val item1 = TestLaneItem("1", topPx = 60, heightPx = 90)
        val item2 = TestLaneItem("2", topPx = 65, heightPx = 80)

        val packed = CalendarLanes.assignOverlapLanes(listOf(item1, item2))
        assertEquals(2, packed[0].laneCount)
        assertEquals(2, packed[1].laneCount)
        assertTrue("Items must have different lane indices", packed[0].laneIndex != packed[1].laneIndex)
    }
}
