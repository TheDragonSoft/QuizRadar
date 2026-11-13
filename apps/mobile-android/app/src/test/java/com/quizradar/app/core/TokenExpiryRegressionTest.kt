package com.quizradar.app.core

import com.quizradar.app.auth.OAuthManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Regression coverage for audit A03: token lifetime is anchored on the
 * issuance timestamp stored WITH the token (not on when some instance first
 * served it), honors the provider's real `expires_in` when the response
 * carries one, and the silent refresh resolves the effective Google client
 * id through the one central fallback rule.
 */
@RunWith(RobolectricTestRunner::class)
class TokenExpiryRegressionTest {
    private fun googleCapability() = FfiProviderCapability.GOOGLE_GMAIL_READ

    @Test
    fun aBlankStoredOverrideRefreshesWithTheShippedDefaultClient() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var usedClientId: String? = null
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                // The ViewModel wires the RAW config value: a default-id user
                // has a blank stored override here.
                clientIds = OAuthClientIds(google = { "" }),
                refreshGrant = { _, _, clientId ->
                    usedClientId = clientId
                    """{"access_token": "fresh-1"}"""
                },
            )

        assertEquals("fresh-1", provider.bearerToken(googleCapability()))
        assertEquals(
            "a blank override falls back to the shipped public client id",
            OAuthManager.DEFAULT_GOOGLE_CLIENT_ID,
            usedClientId,
        )
    }

    @Test
    fun aLegacyPlaceholderOverrideAlsoFallsBackToTheShippedDefaultClient() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var usedClientId: String? = null
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { OAuthManager.LEGACY_PLACEHOLDER_GOOGLE_CLIENT_IDS.first() }),
                refreshGrant = { _, _, clientId ->
                    usedClientId = clientId
                    """{"access_token": "fresh-1"}"""
                },
            )

        assertEquals("fresh-1", provider.bearerToken(googleCapability()))
        assertEquals(OAuthManager.DEFAULT_GOOGLE_CLIENT_ID, usedClientId)
    }

    @Test
    fun theNoIdsSentinelStillRefusesToGuess() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0
        val provider =
            EngineFfiTokens(tokens, google = true, refreshGrant = { _, _, _ ->
                grantCalls += 1
                null
            })

        assertNull(
            "OAuthClientIds.EMPTY means no config was ever read - refuse, do not guess",
            provider.bearerToken(googleCapability()),
        )
        assertEquals(0, grantCalls)
    }

    @Test
    fun anOldTokenIsRefreshedByANewWrapperInsteadOfBeingTreatedAsNewlyIssued() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleAccessToken("stale-token")
        // Issued well past the TTL, BEFORE this wrapper existed - the audit's
        // "old nonblank token treated as newly issued" bug.
        tokens.setGoogleAccessTokenIssuedAtMs(System.currentTimeMillis() - 2 * EngineFfiTokens.ACCESS_TOKEN_TTL_MS)
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0
        val wrapper =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ ->
                    grantCalls += 1
                    """{"access_token": "fresh-1"}"""
                },
            )

        assertEquals("fresh-1", wrapper.bearerToken(googleCapability()))
        assertEquals(1, grantCalls)
    }

    @Test
    fun theStoreTimestampAnchorsTtlAcrossFreshWrappers() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0

        fun newWrapper(): EngineFfiTokens =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ ->
                    grantCalls += 1
                    """{"access_token": "fresh-$grantCalls"}"""
                },
            )

        val first = newWrapper()
        assertEquals("fresh-1", first.bearerToken(googleCapability()))
        assertEquals(1, grantCalls)

        // A second wrapper (a new core operation, a new process section) sees
        // the same token with its stored issuance stamp - still fresh, no
        // second round trip.
        val second = newWrapper()
        assertEquals("fresh-1", second.bearerToken(googleCapability()))
        assertEquals("inside the TTL the stamp, not instance age, decides", 1, grantCalls)

        // Once the stamp ages past the TTL, the next wrapper refreshes.
        tokens.setGoogleAccessTokenIssuedAtMs(
            System.currentTimeMillis() - EngineFfiTokens.ACCESS_TOKEN_TTL_MS - 1000L,
        )
        val third = newWrapper()
        assertNotEquals("stale by the store stamp must not be re-served", "fresh-1", third.bearerToken(googleCapability()))
        assertEquals(2, grantCalls)
    }

    @Test
    fun aFutureIssuanceStampIsStaleNotEternallyFresh() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleAccessToken("clock-skewed-token")
        // Device clock rolled back after issuance: the stamp is IN THE FUTURE.
        // `now - issuedAt` would go negative and call it fresh forever.
        tokens.setGoogleAccessTokenIssuedAtMs(System.currentTimeMillis() + 30L * 60L * 1000L)
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ ->
                    grantCalls += 1
                    """{"access_token": "fresh-1"}"""
                },
            )

        assertEquals("fresh-1", provider.bearerToken(googleCapability()))
        assertEquals("a future stamp must be refreshed, never served as fresh", 1, grantCalls)
    }

    @Test
    fun aRealExpiresInBoundsTheTokenLifeBelowTheConservativeTtl() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        var grantCalls = 0
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ ->
                    grantCalls += 1
                    """{"access_token": "short-lived-$grantCalls", "expires_in": 60}"""
                },
            )

        assertEquals("short-lived-1", provider.bearerToken(googleCapability()))
        assertEquals(1, grantCalls)
        assertEquals(
            "the granted lifetime is recorded with the token (memory-only)",
            60L,
            tokens.getGoogleAccessTokenExpiresInSec(),
        )

        // Fresh immediately after issuance - no second round trip.
        assertEquals("short-lived-1", provider.bearerToken(googleCapability()))
        assertEquals(1, grantCalls)

        // Past the 60s granted lifetime (aged beyond the floor margin) the
        // token is stale even though the conservative 45-minute TTL says
        // otherwise.
        tokens.setGoogleAccessTokenIssuedAtMs(System.currentTimeMillis() - 2L * 60L * 1000L)
        assertEquals("short-lived-2", provider.bearerToken(googleCapability()))
        assertEquals(2, grantCalls)
    }

    @Test
    fun aTokenWithoutATimestampIsTreatedConservativelyButHonestly() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleAccessToken("unstamped-token")
        tokens.setGoogleRefreshToken("refresh-1")

        // Age unknown: prefer a silent refresh when it is possible.
        var grantCalls = 0
        val refreshing =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ ->
                    grantCalls += 1
                    """{"access_token": "fresh-1"}"""
                },
            )
        assertEquals("fresh-1", refreshing.bearerToken(googleCapability()))
        assertEquals(1, grantCalls)

        // When the refresh is impossible the remembered token is still served
        // as best effort - the core's 401 reports the truth; a fabricated
        // null would pretend no credential existed.
        tokens.setGoogleAccessToken("unstamped-token")
        tokens.setGoogleAccessTokenIssuedAtMs(null)
        val failing =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ -> null },
            )
        assertEquals("unstamped-token", failing.bearerToken(googleCapability()))
    }

    @Test
    fun aRefreshedTokenIsStampedAndRotationsPersist() {
        val tokens = MemoryTokenStore()
        tokens.setGoogleRefreshToken("refresh-1")
        val provider =
            EngineFfiTokens(
                tokens,
                google = true,
                clientIds = OAuthClientIds(google = { "client-id" }),
                refreshGrant = { _, _, _ -> """{"access_token": "fresh-1", "refresh_token": "rotated-1"}""" },
            )

        assertEquals("fresh-1", provider.bearerToken(googleCapability()))
        assertEquals("the fresh token's issuance is stamped in the store", true, tokens.getGoogleAccessTokenIssuedAtMs() != null)
        assertEquals("rotated-1", tokens.getGoogleRefreshToken())

        // The Microsoft side stamps too.
        tokens.setMicrosoftRefreshToken("ms-refresh-1")
        val ms =
            EngineFfiTokens(
                tokens,
                google = false,
                clientIds = OAuthClientIds(microsoft = { "azure-id" }),
                refreshGrant = { _, _, _ -> """{"access_token": "ms-fresh-1"}""" },
            )
        assertEquals("ms-fresh-1", ms.bearerToken(FfiProviderCapability.MICROSOFT_MAIL_READ))
        assertEquals(true, tokens.getMicrosoftAccessTokenIssuedAtMs() != null)
    }
}
