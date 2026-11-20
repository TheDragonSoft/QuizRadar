package com.quizradar.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
class LanPairClientTest {
    private val validToken = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 0x11 })
    private val validFp = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 0x42 })

    @Test
    fun parsesAndValidatesPrivateLanPairingUri() {
        val uri = "quizradar://lan?h=192.168.1.42&p=51823&t=$validToken&fp=$validFp&v=1"
        val parsed = LanPairClient.parseAndValidate(uri)
        assertEquals("192.168.1.42", parsed.host)
        assertEquals(51823, parsed.port)
        assertEquals(validToken, parsed.token)
        assertEquals(validFp, parsed.fingerprintB64Url)
        assertEquals(1, parsed.version)
    }

    @Test
    fun rejectsPublicInternetHostForSsrfProtection() {
        val publicUri = "quizradar://lan?h=8.8.8.8&p=51823&t=$validToken&fp=$validFp&v=1"
        assertThrows(QuizRadarFfiException::class.java) {
            LanPairClient.parseAndValidate(publicUri)
        }
    }

    @Test
    fun rejectsMalformedFingerprintOrShortToken() {
        val badTokenUri = "quizradar://lan?h=192.168.1.42&p=51823&t=short&fp=$validFp&v=1"
        assertThrows(QuizRadarFfiException::class.java) {
            LanPairClient.parseAndValidate(badTokenUri)
        }
        val badFpUri = "quizradar://lan?h=192.168.1.42&p=51823&t=$validToken&fp=short&v=1"
        assertThrows(QuizRadarFfiException::class.java) {
            LanPairClient.parseAndValidate(badFpUri)
        }
    }
}
