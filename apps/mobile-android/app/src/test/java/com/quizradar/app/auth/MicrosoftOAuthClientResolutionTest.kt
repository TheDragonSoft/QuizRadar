package com.quizradar.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MicrosoftOAuthClientResolutionTest {
    private val sampleBundledGuid = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
    private val sampleCustomGuid = "a1b2c3d4-e5f6-4789-abcd-0123456789ef"

    @Test
    fun guidValidatorAcceptsRealGuidsAndRejectsPlaceholders() {
        assertTrue(OAuthManager.isValidMicrosoftClientId(sampleBundledGuid))
        assertTrue(OAuthManager.isValidMicrosoftClientId("  $sampleCustomGuid  "))
        assertFalse(OAuthManager.isValidMicrosoftClientId(null))
        assertFalse(OAuthManager.isValidMicrosoftClientId(""))
        assertFalse(OAuthManager.isValidMicrosoftClientId(OAuthManager.DEFAULT_MICROSOFT_CLIENT_ID))
        assertFalse(OAuthManager.isValidMicrosoftClientId("00000000-0000-0000-0000-000000000000"))
        assertFalse(OAuthManager.isValidMicrosoftClientId("not-a-guid"))
    }

    @Test
    fun resolutionPrefersValidUserOverrideThenBundledMultiTenantGuid() {
        assertEquals(
            sampleCustomGuid,
            OAuthManager.resolveMicrosoftClientId(sampleCustomGuid, sampleBundledGuid),
        )
        assertEquals(
            sampleBundledGuid,
            OAuthManager.resolveMicrosoftClientId("   ", sampleBundledGuid),
        )
        assertEquals(
            sampleBundledGuid,
            OAuthManager.resolveMicrosoftClientId(
                OAuthManager.DEFAULT_MICROSOFT_CLIENT_ID,
                sampleBundledGuid,
            ),
        )
        assertEquals(
            OAuthManager.DEFAULT_MICROSOFT_CLIENT_ID,
            OAuthManager.resolveMicrosoftClientId(null, ""),
        )
    }

    @Test
    fun isMicrosoftClientConfiguredReflectsValidMultiTenantGuid() {
        val unconfigured = OAuthManager(microsoftClientId = OAuthManager.DEFAULT_MICROSOFT_CLIENT_ID)
        assertFalse(unconfigured.isMicrosoftClientConfigured())

        val configured = OAuthManager(microsoftClientId = sampleBundledGuid)
        assertTrue(configured.isMicrosoftClientConfigured())
    }
}
