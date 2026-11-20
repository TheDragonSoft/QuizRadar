package com.quizradar.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairSyncCodecTest {
    /**
     * Strict recursive-descent JSON syntax validator (plain JVM, no Android org.json stub).
     * Guarantees compaction never emits malformed JSON (e.g., dangling commas or unescaped quotes).
     */
    private fun assertValidJson(json: String) {
        var i = 0

        fun skipWs() {
            while (i < json.length && json[i] in charArrayOf(' ', '\t', '\n', '\r')) i++
        }

        fun parseString() {
            assertTrue("Expected '\"' at $i in $json", i < json.length && json[i] == '"')
            i++
            while (i < json.length) {
                when (val ch = json[i]) {
                    '"' -> {
                        i++
                        return
                    }
                    '\\' -> {
                        i++
                        assertTrue("Truncated escape at $i", i < json.length)
                        when (json[i]) {
                            '"', '\\', '/', 'b', 'f', 'n', 'r', 't' -> i++
                            'u' -> {
                                assertTrue("Truncated unicode escape at $i", i + 4 < json.length)
                                val hex = json.substring(i + 1, i + 5)
                                assertTrue("Invalid hex escape \\u$hex", hex.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' })
                                i += 5
                            }
                            else -> throw AssertionError("Invalid escape \\${json[i]} at $i")
                        }
                    }
                    else -> {
                        assertTrue("Unescaped control char ${ch.code} at $i", ch.code >= 0x20)
                        i++
                    }
                }
            }
            throw AssertionError("Unterminated JSON string in $json")
        }

        lateinit var parseValue: () -> Unit
        parseValue = {
            skipWs()
            assertTrue("Unexpected EOF at $i", i < json.length)
            when (json[i]) {
                '"' -> parseString()
                '{' -> {
                    i++
                    skipWs()
                    if (i < json.length && json[i] == '}') {
                        i++
                    } else {
                        while (true) {
                            skipWs()
                            parseString()
                            skipWs()
                            assertTrue("Expected ':' at $i in $json", i < json.length && json[i] == ':')
                            i++
                            parseValue()
                            skipWs()
                            assertTrue("Expected ',' or '}' at $i in $json", i < json.length)
                            if (json[i] == ',') {
                                i++
                            } else if (json[i] == '}') {
                                i++
                                break
                            } else {
                                throw AssertionError("Unexpected '${json[i]}' at $i in $json")
                            }
                        }
                    }
                }
                '[' -> {
                    i++
                    skipWs()
                    if (i < json.length && json[i] == ']') {
                        i++
                    } else {
                        while (true) {
                            parseValue()
                            skipWs()
                            assertTrue("Expected ',' or ']' at $i in $json", i < json.length)
                            if (json[i] == ',') {
                                i++
                            } else if (json[i] == ']') {
                                i++
                                break
                            } else {
                                throw AssertionError("Unexpected '${json[i]}' at $i in $json")
                            }
                        }
                    }
                }
                't' -> {
                    assertTrue(json.startsWith("true", i))
                    i += 4
                }
                'f' -> {
                    assertTrue(json.startsWith("false", i))
                    i += 5
                }
                'n' -> {
                    assertTrue(json.startsWith("null", i))
                    i += 4
                }
                else -> {
                    val start = i
                    if (json[i] == '-') i++
                    while (i < json.length && json[i].isDigit()) i++
                    if (i < json.length && json[i] == '.') {
                        i++
                        while (i < json.length && json[i].isDigit()) i++
                    }
                    if (i < json.length && (json[i] == 'e' || json[i] == 'E')) {
                        i++
                        if (i < json.length && (json[i] == '+' || json[i] == '-')) i++
                        while (i < json.length && json[i].isDigit()) i++
                    }
                    assertTrue("Invalid token at $start in $json", i > start)
                }
            }
        }

        parseValue()
        skipWs()
        assertEquals("Trailing garbage at $i in $json", json.length, i)
    }

    @Test
    fun roundTripsBackupPayloadViaDeflateRawBase64Url() {
        val sample =
            """{"schema_version":1,"client_device_id":"quizradar-android",""" +
                """"updated_at":"2026-11-16T22:00:00Z","schedule":{"courses":[""" +
                """{"id":"CSE241","name":"Data Structures","color":"#1a73e8"}],"slots":[]},""" +
                """"assessments":[{"id":"a1","course_id":"CSE241","title":"Midterm 1",""" +
                """"assessment_type":"Midterm Exam","date_iso":"2026-11-24",""" +
                """"topics":["Trees","Graphs"]}],"completed_topics":{"a1::h1234":true},""" +
                """"grades":{},"custom_events":[],"feeds":[]}"""

        val link = PairSyncCodec.encode(sample)
        assertTrue(link.startsWith(PairSyncCodec.PREFIX))

        val decoded = PairSyncCodec.decode(link)
        assertEquals(sample, decoded)
        assertValidJson(decoded)
    }

    @Test
    fun compactsVerboseRawTextWhenLinkExceedsThreshold() {
        val rawBody = " verbose-announcement ".repeat(250)
        val sample =
            """{"schema_version":1,"client_device_id":"quizradar-android",""" +
                """"updated_at":"2026-11-16T22:00:00Z","schedule":{"courses":[],"slots":[]},""" +
                """"assessments":[{"id":"a1","course_id":"CSE241","raw_text":"$rawBody","title":"Quiz 1"}],""" +
                """"completed_topics":{},"grades":{},"custom_events":[],"feeds":[]}"""

        val (compacted, wasCompacted) = PairSyncCodec.compactPayloadIfNeeded(sample, maxLinkBytes = 120)
        assertTrue(wasCompacted)
        assertValidJson(compacted)
        assertFalse(compacted.contains("raw_text"))
        val decoded = PairSyncCodec.decode(PairSyncCodec.encode(compacted))
        assertTrue(decoded.contains("Quiz 1"))
    }

    @Test
    fun compactsTrailingRawTextAndEscapedLongSnippetsCleanly() {
        val longSnippet = ("line\\n\\\"quote\\\" \\uD83D\\uDE00 ").repeat(20)
        val rawBody = "trailing-verbose-body ".repeat(250)
        val sample =
            """{"schema_version":1,"client_device_id":"quizradar-android",""" +
                """"updated_at":"2026-11-16T22:00:00Z","schedule":{"courses":[],"slots":[]},""" +
                """"assessments":[{"id":"a1","course_id":"CSE241","title":"Quiz 2",""" +
                """"snippet":"$longSnippet","raw_text":"$rawBody"}],""" +
                """"completed_topics":{},"grades":{},"custom_events":[],"feeds":[]}"""

        val (compacted, wasCompacted) = PairSyncCodec.compactPayloadIfNeeded(sample, maxLinkBytes = 120)
        assertTrue(wasCompacted)
        assertValidJson(compacted)
        assertFalse(compacted.contains("raw_text"))
        assertFalse(compacted.contains(",}"))
        assertFalse(compacted.contains(""""snippet":"snippet":"""))
        val decoded = PairSyncCodec.decode(PairSyncCodec.encode(compacted))
        assertTrue(decoded.contains("Quiz 2"))
        assertTrue(decoded.contains("..."))
    }

    @Test
    fun compactsRealBackupPayloadFieldsInTwoStagesAndKeepsValidJson() {
        val studyPlan = "Review chapter 4 trees, heaps, and graph traversal. ".repeat(15)
        val inference = "Inferred from instructor announcement posted Monday morning. ".repeat(8)
        val eventNotes = "Bring calculator, formula sheet, and lab printout. ".repeat(8)
        val calUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Midterm&details=" + "x".repeat(300)
        val sample =
            """{"schema_version":1,"client_device_id":"quizradar-android",""" +
                """"updated_at":"2026-11-16T22:00:00Z","schedule":{"semester":null,"courses":[],"slots":[]},""" +
                """"assessments":[{"id":"a1","course_id":"CSE241","title":"Midterm 1",""" +
                """"room":null,"group":null,"display_time":"Sun Oct 18 9:00 AM",""" +
                """"conflict_warning":"Within 48h of Quiz 2","google_cal_url":"$calUrl",""" +
                """"ai_study_plan":"$studyPlan","ai_inference_note":"$inference"}],""" +
                """"completed_topics":{},"grades":{},"custom_events":[{"id":"ev1","title":"Prep",""" +
                """"room":null,"notes":"$eventNotes"}],"feeds":[]}"""

        // Stage 2: tight threshold strips ai_study_plan and truncates ai_inference_note & custom_events[].notes
        val (compacted, wasCompacted) = PairSyncCodec.compactPayloadIfNeeded(sample, maxLinkBytes = 120)
        assertTrue(wasCompacted)
        assertValidJson(compacted)
        assertFalse(compacted.contains("google_cal_url"))
        assertFalse(compacted.contains("conflict_warning"))
        assertFalse(compacted.contains("display_time"))
        assertFalse(compacted.contains("ai_study_plan"))
        assertFalse(compacted.contains("\"room\":null"))
        assertFalse(compacted.contains("\"semester\":null"))
        assertTrue(compacted.contains("Midterm 1"))
        assertTrue(compacted.contains("..."))

        // Stage 1: threshold between lossless and full preserves ai_study_plan while dropping derived/nulls
        val fullLen = PairSyncCodec.encode(sample).toByteArray().size
        val encoded = PairSyncCodec.encodeForQr(sample, maxLinkBytes = fullLen - 1)
        assertTrue(encoded.compacted)
        assertTrue(encoded.fitsQr)
        val decodedLossless = PairSyncCodec.decode(encoded.link)
        assertValidJson(decodedLossless)
        assertFalse(decodedLossless.contains("google_cal_url"))
        assertTrue(decodedLossless.contains("ai_study_plan"))
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
