package com.quizradar.app.core

import android.util.Log
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * The OAuth client ids the core-facing token provider needs for the silent
 * refresh grant.
 *
 * Both ids live in the config store (`google_client_id`, `teams_client_id`,
 * Settings -> Sources). The [QuizRadarEngine] caches them when the ViewModel
 * or the background worker loads the config, because [FfiTokenProvider.bearerToken]
 * is a synchronous callback - it cannot suspend to read the store.
 */
class OAuthClientIds(
    private val google: () -> String? = { null },
    private val microsoft: () -> String? = { null },
) {
    fun googleClientId(): String? = google()?.trim()?.takeIf { it.isNotEmpty() }

    fun microsoftClientId(): String? = microsoft()?.trim()?.takeIf { it.isNotEmpty() }

    companion object {
        val EMPTY = OAuthClientIds()
    }
}

/**
 * The shell half of the UniFFI [FfiTokenProvider] callback (`core/ffi.rs`):
 * serves the Google or Microsoft access token to the Rust scan/push/backup
 * calls over the EXISTING token plumbing.
 *
 * - The 1-hour access token stays strictly in memory (AGENTS §3): it is read
 *   through [TokenProvider.getGoogleAccessToken] / [getMicrosoftAccessToken],
 *   which are in-memory fields on both real and test stores.
 * - When the in-memory token is absent or past its TTL, the provider does a
 *   blocking refresh grant over HTTPS with the persisted refresh token - the
 *   "silent refresh" the core doc asks for. The result is written back into
 *   the token store (memory access token, persisted refresh token on
 *   rotation), so the next call - possibly from another source run of the
 *   same scan - reuses it without another round trip.
 * - No token and no way to get one: `null`. The core treats that as the
 *   honest "no token" failure and reports the source as skipped/failed.
 *
 * A refresh grant can only succeed when the user's own OAuth client id is
 * configured (Settings -> Sources); without it the provider returns null and
 * the scan reports the source honestly instead of guessing a client.
 *
 * @param google true -> serve Google capabilities; false -> Microsoft.
 *   A capability of the other provider is answered with null (the core never
 *   asks for it through this instance, but the mapping stays total).
 */
class EngineFfiTokens(
    private val tokens: TokenProvider,
    private val google: Boolean,
    private val clientIds: OAuthClientIds = OAuthClientIds.EMPTY,
    /**
     * Overridable for tests: performs the blocking refresh grant and returns
     * the full token JSON (access_token/refresh_token/expires_in) or null.
     * The production implementation posts the standard refresh grant to the
     * provider's token endpoint.
     */
    private val refreshGrant: (provider: String, refreshToken: String, clientId: String) -> String? =
        ::defaultRefreshGrant,
) : FfiTokenProvider {
    /** Value we last served and when we FIRST served it (TTL anchor). */
    private var servedGoogleToken: Pair<String, Long>? = null
    private var servedMicrosoftToken: Pair<String, Long>? = null

    override fun bearerToken(capability: FfiProviderCapability): String? {
        val forGoogle =
            when (capability) {
                FfiProviderCapability.GOOGLE_GMAIL_READ,
                FfiProviderCapability.GOOGLE_USER_PROFILE,
                FfiProviderCapability.GOOGLE_CALENDAR_EVENTS,
                FfiProviderCapability.GOOGLE_DRIVE_APPDATA,
                FfiProviderCapability.GOOGLE_CLASSROOM_READ,
                -> true
                else -> false
            }
        if (forGoogle != google) return null
        return if (google) googleBearer() else microsoftBearer()
    }

    private fun googleBearer(): String? {
        val memory = tokens.getGoogleAccessToken()
        val served = servedGoogleToken
        if (!memory.isNullOrBlank() && (served == null || served.first != memory)) {
            // Fresh from a sign-in this session - serve as-is.
            servedGoogleToken = memory to nowMs()
            return memory
        }
        if (memory != null && served != null && served.first == memory && nowMs() - served.second < ACCESS_TOKEN_TTL_MS) {
            // Same token inside its TTL - reuse, no refresh round trip.
            return memory
        }
        // Absent (process restart while tokens persisted) or past the TTL:
        // silent refresh, then serve the fresh token.
        return refreshAndStore(google = true)
    }

    private fun microsoftBearer(): String? {
        val memory = tokens.getMicrosoftAccessToken()
        val served = servedMicrosoftToken
        if (!memory.isNullOrBlank() && (served == null || served.first != memory)) {
            servedMicrosoftToken = memory to nowMs()
            return memory
        }
        if (memory != null && served != null && served.first == memory && nowMs() - served.second < ACCESS_TOKEN_TTL_MS) {
            return memory
        }
        return refreshAndStore(google = false)
    }

    /**
     * Runs one refresh grant and stores the outcome. Returns the fresh access
     * token, or null when there is no refresh token, no client id, or the
     * provider refused (revoked grant, offline, provider error). A failure is
     * NEVER retried inside the same scan more than once per ask - the core
     * re-asking after a 401 simply re-enters here.
     */
    private fun refreshAndStore(google: Boolean): String? {
        val provider = if (google) "google" else "microsoft"
        val refreshToken =
            if (google) tokens.getGoogleRefreshToken() else tokens.getMicrosoftRefreshToken()
        if (refreshToken.isNullOrBlank()) return null
        val clientId = if (google) clientIds.googleClientId() else clientIds.microsoftClientId()
        if (clientId.isNullOrBlank()) return null
        val body =
            try {
                refreshGrant(provider, refreshToken, clientId)
            } catch (_: Exception) {
                null
            } ?: return null
        val json = runCatching { org.json.JSONObject(body) }.getOrNull() ?: return null
        val accessToken = json.optString("access_token").takeIf { it.isNotBlank() } ?: return null
        val newRefresh = json.optString("refresh_token").takeIf { it.isNotBlank() }
        if (google) {
            tokens.setGoogleAccessToken(accessToken)
            if (newRefresh != null) tokens.setGoogleRefreshToken(newRefresh)
            servedGoogleToken = accessToken to nowMs()
        } else {
            tokens.setMicrosoftAccessToken(accessToken)
            if (newRefresh != null) tokens.setMicrosoftRefreshToken(newRefresh)
            servedMicrosoftToken = accessToken to nowMs()
        }
        return accessToken
    }

    private fun nowMs(): Long = System.currentTimeMillis()

    companion object {
        /**
         * The 1h access-token TTL with a safety margin: past 45 minutes a
         * served token is treated as stale and refreshed lazily, so a scan
         * never enters with a token the provider is about to reject.
         */
        internal const val ACCESS_TOKEN_TTL_MS = 45L * 60L * 1000L

        private const val TAG = "EngineFfiTokens"

        private const val GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
        private const val MICROSOFT_TOKEN_URL =
            "https://login.microsoftonline.com/common/oauth2/v2.0/token"

        /**
         * The production refresh grant: a blocking HTTPS form POST. The
         * refresh token and the returned access token travel only in the
         * request/response bodies - never into a log line or an error string
         * (AGENTS §3/§8). A public-client refresh grant needs no secret:
         * Google Android clients and Azure public clients both accept
         * `client_id` alone.
         */
        internal fun defaultRefreshGrant(
            provider: String,
            refreshToken: String,
            clientId: String,
        ): String? {
            val endpoint =
                when (provider) {
                    "google" -> GOOGLE_TOKEN_URL
                    "microsoft" -> MICROSOFT_TOKEN_URL
                    else -> return null
                }
            val form =
                buildString {
                    append("grant_type=").append(URLEncoder.encode("refresh_token", "UTF-8"))
                    append("&refresh_token=").append(URLEncoder.encode(refreshToken, "UTF-8"))
                    append("&client_id=").append(URLEncoder.encode(clientId, "UTF-8"))
                }
            return try {
                val conn = URL(endpoint).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                conn.outputStream.use { it.write(form.toByteArray()) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() }
                if (code in 200..299) {
                    text
                } else {
                    // The body may echo the error description but never a
                    // secret; still, do not surface it - a scan note gets the
                    // honest "token refresh failed" instead.
                    Log.w(TAG, "Token refresh failed with HTTP $code")
                    null
                }
            } catch (e: IOException) {
                Log.w(TAG, "Token refresh failed: network error")
                null
            }
        }
    }
}
