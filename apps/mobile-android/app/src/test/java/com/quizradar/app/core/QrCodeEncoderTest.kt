package com.quizradar.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QrCodeEncoderTest {
    @Test
    fun computesStandardVersionCapacities() {
        assertEquals(19, QrCodeEncoder.getDataCodewordCapacity(1))
        assertEquals(17, QrCodeEncoder.getByteCapacity(1))
        assertEquals(2956, QrCodeEncoder.getDataCodewordCapacity(40))
        assertEquals(QrCodeEncoder.MAX_QR_BYTE_CAPACITY, QrCodeEncoder.getByteCapacity(40))
    }

    @Test
    fun encodesQuizRadarPairLinkIntoValidIsoMatrix() {
        val sample =
            """{"schema_version":1,"client_device_id":"quizradar-android",""" +
                """"updated_at":"2026-11-16T22:00:00Z","schedule":{"courses":[],"slots":[]},""" +
                """"assessments":[],"completed_topics":{},"grades":{},"custom_events":[],"feeds":[]}"""
        val link = PairSyncCodec.encode(sample)
        val qr = QrCodeEncoder.encode(link)

        assertTrue(qr.version >= 1)
        assertEquals(qr.version * 4 + 17, qr.size)
        assertTrue(qr.get(0, 0))
        assertTrue(qr.get(6, 0))
        assertTrue(qr.get(0, 6))
        assertTrue(qr.get(6, 6))
        assertTrue(qr.get(3, 3))
        assertFalse(qr.get(7, 7))
        assertTrue(qr.get(8, qr.size - 8))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsPayloadExceedingMaxCapacity() {
        val tooLarge = "x".repeat(QrCodeEncoder.MAX_QR_BYTE_CAPACITY + 1)
        QrCodeEncoder.encode(tooLarge)
    }
}
