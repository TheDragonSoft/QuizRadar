package com.quizradar.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairSyncCodecTest {
    @Test
    fun roundTripsBackupPayloadViaDeflateRawBase64Url() {
        val sample =
            """{"schema_version":1,"client_device_id":"quizradar-android","updated_at":"2026-11-16T22:00:00Z","schedule":{"courses":[{"id":"CSE241","name":"Data Structures","color":"#1a73e8"}],"slots":[]},"assessments":[{"id":"a1","course_id":"CSE241","title":"Midterm 1","assessment_type":"Midterm Exam","date_iso":"2026-11-24","topics":["Trees","Graphs"]}],"completed_topics":{"a1::h1234":true},"grades":{},"custom_events":[],"feeds":[]}"""

        val link = PairSyncCodec.encode(sample)
        assertTrue(link.startsWith(PairSyncCodec.PREFIX))

        val decoded = PairSyncCodec.decode(link)
        assertEquals(sample, decoded)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsEmptyInput() {
        PairSyncCodec.decode("")
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonQuizRadarUrl() {
        PairSyncCodec.decode("https://example.com/foo")
    }
}
