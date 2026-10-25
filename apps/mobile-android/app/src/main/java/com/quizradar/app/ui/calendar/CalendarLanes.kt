package com.quizradar.app.ui.calendar

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

const val START_HOUR = 8
const val END_HOUR = 21 // 08:00 to 21:00 (13 hours)
const val HOUR_HEIGHT_DP = 64

interface CalendarLaneItem {
    val id: String
    val topPx: Int
    val heightPx: Int
    var laneIndex: Int
    var laneCount: Int
}

data class BlockPosition(val topPx: Int, val heightPx: Int)

object CalendarLanes {
    fun computeBlockPosition(
        startHHMM: String?,
        endHHMM: String?,
        startHour: Int = START_HOUR,
        endHour: Int = END_HOUR,
        hourHeight: Int = HOUR_HEIGHT_DP,
    ): BlockPosition {
        val startParts = (startHHMM ?: "09:00").split(":")
        val endParts = (endHHMM ?: "10:30").split(":")

        val sh = startParts.getOrNull(0)?.toIntOrNull() ?: 9
        val sm = startParts.getOrNull(1)?.toIntOrNull() ?: 0
        val eh = endParts.getOrNull(0)?.toIntOrNull() ?: (sh + 1)
        val em = endParts.getOrNull(1)?.toIntOrNull() ?: (sm + 30)

        val startHours = max(startHour.toDouble(), sh + sm / 60.0)
        val endHours = min((endHour + 1).toDouble(), eh + em / 60.0)
        val durationHours = max(0.75, endHours - startHours)

        val topPx = ((startHours - startHour) * hourHeight).roundToInt() + 1
        val heightPx = (durationHours * hourHeight).roundToInt() - 3
        return BlockPosition(topPx = topPx, heightPx = max(24, heightPx))
    }

    fun <T : CalendarLaneItem> assignOverlapLanes(items: List<T>): List<T> {
        if (items.isEmpty()) return items

        val sorted =
            items.sortedWith(
                compareBy<T> { it.topPx }.thenByDescending { it.heightPx },
            )

        var cluster = mutableListOf<T>()
        var clusterEnd = -1

        fun flushCluster(group: List<T>) {
            if (group.isEmpty()) return
            val lanes = mutableListOf<Int>()

            group.forEach { item ->
                var placedLane = -1
                for (i in lanes.indices) {
                    if (lanes[i] <= item.topPx + 2) {
                        placedLane = i
                        lanes[i] = item.topPx + item.heightPx
                        break
                    }
                }
                if (placedLane == -1) {
                    placedLane = lanes.size
                    lanes.add(item.topPx + item.heightPx)
                }
                item.laneIndex = placedLane
            }

            val totalLanes = lanes.size
            group.forEach { item ->
                item.laneCount = totalLanes
            }
        }

        sorted.forEach { item ->
            val itemBottom = item.topPx + item.heightPx
            if (cluster.isEmpty() || item.topPx < clusterEnd - 2) {
                cluster.add(item)
                clusterEnd = max(clusterEnd, itemBottom)
            } else {
                flushCluster(cluster)
                cluster = mutableListOf(item)
                clusterEnd = itemBottom
            }
        }

        flushCluster(cluster)
        return sorted
    }
}
