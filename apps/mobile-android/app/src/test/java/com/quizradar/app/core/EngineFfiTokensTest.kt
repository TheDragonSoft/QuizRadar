package com.quizradar.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class EngineFfiTokensTest {
    private fun googleCaps() =
        listOf(
            FfiProviderCapability.GOOGLE_GMAIL_READ,
            FfiProviderCapability.GOOGLE_USER_PROFILE,
            FfiProviderCapability.GOOGLE_CALENDAR_EVENTS,
            FfiProviderCapability.GOOGLE_DRIVE_APPDATA,
            FfiProviderCapability.GOOGLE_CLASSROOM_READ,
        )

    @Test
    fun servesTheInMemoryAccessTokenForItsOwnProvider() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleAccessToken("access-1")
        val provider = EngineFfiTokens(tokens, google = true)

        googleCaps().forEach { capability ->
            assertEquals("access-1", provider.bearerToken(capability))
        }
    }

    @Test
    fun neverAnswersACapabilityOfTheOtherProvider() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleAccessToken("access-1")
        tokens.setMicrosoftAccessToken("ms-access-1")

        val googleSide = EngineFfiTokens(tokens, google = true)
        assertNull(googleSide.bearerToken(FfiProviderCapability.MICROSOFT_MAIL_READ))
        assertNull(googleSide.bearerToken(FfiProviderCapability.MICROSOFT_SIGN_IN))

        val microsoftSide = EngineFfiTokens(tokens, google = false)
        microsoftCaps().forEach { capability ->
            assertEquals("ms-access-1", microsoftSide.bearerToken(capability))
        }
        assertNull(microsoftSide.bearerToken(FfiProviderCapability.GOOGLE_GMAIL_READ))
    }

    @Test
    fun noTokenAtAllIsAnHonestNull() {
        val tokens = MemoryTokenStore()
        val provider = EngineFfiTokens(tokens, google = true)

        assertNull(provider.bearerToken(FfiProviderCapability.GOOGLE_GMAIL_READ))
    }

    @Test
    fun silentRefreshWithoutAClientIdRefusesInsteadOfGuessing() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0
        val provider =
            EngineFfiTokens(tokens, google = true, refreshGrant = { _, _, _ ->
                grantCalls += 1
                """{"access_token": "fresh-1"}"""
            })

        assertNull("no client id configured - no refresh, honest null", provider.bearerToken(FfiProviderCapability.GOOGLE_GMAIL_READ))
        assertEquals(0, grantCalls)
    }

    @Test
    fun silentRefreshRunsWhenTheMemoryTokenIsAbsentAndStoresTheResult() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { provider_, refreshToken, clientId ->
                    grantCalls += 1
                    assertEquals("google", provider_)
                    assertEquals("refresh-1", refreshToken)
                    assertEquals("client-id", clientId)
                    """{"access_token": "fresh-1", "refresh_token": "rotated-1"}"""
                },
            )

        assertEquals("fresh-1", provider.bearerToken(FfiProviderCapability.GOOGLE_DRIVE_APPDATA))
        assertEquals(1, grantCalls)
        assertEquals("the fresh token lands in the store for the next ask", "fresh-1", tokens.getGoogleAccessToken())
        assertEquals("a rotated refresh token is persisted", "rotated-1", tokens.getGoogleRefreshToken())

        // The second ask inside the TTL reuses the stored token - no round trip.
        assertEquals("fresh-1", provider.bearerToken(FfiProviderCapability.GOOGLE_CLASSROOM_READ))
        assertEquals(1, grantCalls)
    }

    @Test
    fun aFailedRefreshReturnsNullAndNeverFabricatesAToken() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ -> null },
            )

        assertNull(provider.bearerToken(FfiProviderCapability.GOOGLE_GMAIL_READ))
        assertNull("a failed refresh must not poison the store", tokens.getGoogleAccessToken())
    }

    @Test
    fun aMicrosoftRefreshUsesTheMicrosoftClientId() {
        val tokens = MemoryTokenStore()
        tokens.setMicrosoftRefreshToken("ms-refresh-1")
        var usedClientId: String? = null
        val provider =
            EngineFfiTokens(
                tokens,
                google = false,
                clientIds = OAuthClientIds(microsoft = { "azure-id" }),
                refreshGrant = { provider_, _, clientId ->
                    usedClientId = clientId
                    assertEquals("microsoft", provider_)
                    """{"access_token": "ms-fresh-1"}"""
                },
            )

        assertEquals("ms-fresh-1", provider.bearerToken(FfiProviderCapability.MICROSOFT_MAIL_READ))
        assertEquals("azure-id", usedClientId)
    }

    @Test
    fun theClientIdsHolderTrimsAndEmpties() {
        val ids = OAuthClientIds(google = { "  abc.apps.googleusercontent.com  " }, microsoft = { "   " })
        assertEquals("abc.apps.googleusercontent.com", ids.googleClientId())
        assertNull("a blank id is the honest not-configured state", ids.microsoftClientId())
    }

    private fun microsoftCaps() =
        listOf(
            FfiProviderCapability.MICROSOFT_OFFLINE_ACCESS,
            FfiProviderCapability.MICROSOFT_USER_PROFILE,
            FfiProviderCapability.MICROSOFT_MAIL_READ,
            FfiProviderCapability.MICROSOFT_CALENDARS_READ,
            FfiProviderCapability.MICROSOFT_SIGN_IN,
        )
}
