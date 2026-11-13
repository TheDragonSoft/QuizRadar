package com.quizradar.app.core

import android.util.Log
import com.quizradar.app.auth.OAuthManager
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
 * A refresh grant resolves the Google client id through
 * [googleRefreshClientId]: a stored override (Settings -> Sources) wins, a
 * blank one falls back to the shipped public client id. Microsoft keeps its
 * honest placeholder - a refresh there still needs the user's own Azure app
 * id, and returns null (an honestly skipped source) without one.
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

    /**
     * Serves the Google access token if it is verifiably still inside its
     * TTL. The TTL anchor is the ISSUANCE timestamp recorded in the token
     * store — not the moment this instance first saw the token — so a token
     * issued an hour ago stays stale across fresh wrappers and fresh
     * processes (audit A03).
     */
    private fun googleBearer(): String? {
        val memory = tokens.getGoogleAccessToken()
        if (!memory.isNullOrBlank()) {
            when (tokens.getGoogleAccessTokenIssuedAtMs()) {
                null -> {
                    // Age unknown (token written by an older build or without
                    // a stamp). Conservative: prefer a silent refresh; when
                    // that is impossible, serve the remembered token and let
                    // the core's 401 report honestly if it is truly dead.
                    return refreshAndStore(google = true) ?: memory
                }
                else ->
                    if (
                        tokenStillFresh(
                            tokens.getGoogleAccessTokenIssuedAtMs(),
                            accessTokenTtlMs(tokens.getGoogleAccessTokenExpiresInSec()),
                        )
                    ) {
                        return memory
                    }
            }
        }
        // Absent (process restart while only the refresh token persisted) or
        // past its TTL: silent refresh, then serve the fresh token.
        return refreshAndStore(google = true)
    }

    private fun microsoftBearer(): String? {
        val memory = tokens.getMicrosoftAccessToken()
        if (!memory.isNullOrBlank()) {
            when (tokens.getMicrosoftAccessTokenIssuedAtMs()) {
                null ->
                    return refreshAndStore(google = false) ?: memory
                else ->
                    if (
                        tokenStillFresh(
                            tokens.getMicrosoftAccessTokenIssuedAtMs(),
                            accessTokenTtlMs(tokens.getMicrosoftAccessTokenExpiresInSec()),
                        )
                    ) {
                        return memory
                    }
            }
        }
        return refreshAndStore(google = false)
    }

    /**
     * True only when the token carries a real issuance stamp that is NOT in
     * the future and lies inside its lifetime. A future stamp (device clock
     * rolled back after issuance) is treated as stale, never as eternally
     * fresh.
     */
    private fun tokenStillFresh(
        issuedAtMs: Long?,
        ttlMs: Long,
    ): Boolean {
        if (issuedAtMs == null || issuedAtMs < 0L) return false
        val now = nowMs()
        if (issuedAtMs > now) return false
        return now - issuedAtMs < ttlMs
    }

    /**
     * The access token's usable lifetime: the provider's actual `expires_in`
     * with a safety margin when the response carried one, the conservative
     * fixed TTL only when it did not. Negative/zero lifetimes are floored so
     * a degenerate `expires_in` cannot flip-flop the freshness check.
     */
    private fun accessTokenTtlMs(expiresInSec: Long?): Long =
        expiresInSec
            ?.takeIf { it > 0 }
            ?.let { maxOf(it * 1000L - TTL_SAFETY_MARGIN_MS, MIN_ACCESS_TOKEN_TTL_MS) }
            ?: ACCESS_TOKEN_TTL_MS

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
        val clientId = if (google) googleRefreshClientId() else clientIds.microsoftClientId()
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
        // The real lifetime the provider granted; null keeps the conservative
        // fixed TTL as the honest fallback when the field is absent.
        val expiresInSec = json.optLong("expires_in", -1L).takeIf { it > 0 }
        if (google) {
            tokens.setGoogleAccessToken(accessToken)
            tokens.setGoogleAccessTokenIssuedAtMs(nowMs())
            tokens.setGoogleAccessTokenExpiresInSec(expiresInSec)
            if (newRefresh != null) tokens.setGoogleRefreshToken(newRefresh)
        } else {
            tokens.setMicrosoftAccessToken(accessToken)
            tokens.setMicrosoftAccessTokenIssuedAtMs(nowMs())
            tokens.setMicrosoftAccessTokenExpiresInSec(expiresInSec)
            if (newRefresh != null) tokens.setMicrosoftRefreshToken(newRefresh)
        }
        return accessToken
    }

    /**
     * The effective Google client id for a silent refresh (audit A03).
     *
     * Resolution order:
     *  1. the stored override, when it is usable (non-blank, not a legacy
     *     placeholder id);
     *  2. the shipped maintainer client id (a public identifier, AGENTS §3.2
     *     amendment) - but ONLY when ids were actually wired in, i.e. the
     *     holder is not the [OAuthClientIds.EMPTY] sentinel. The sentinel
     *     means "no config was ever read", and a refresh without a real
     *     client id must refuse instead of guessing.
     */
    private fun googleRefreshClientId(): String? {
        val stored = clientIds.googleClientId()
        if (stored != null && stored !in OAuthManager.LEGACY_PLACEHOLDER_GOOGLE_CLIENT_IDS) return stored
        return if (clientIds !== OAuthClientIds.EMPTY) OAuthManager.DEFAULT_GOOGLE_CLIENT_ID else null
    }

    private fun nowMs(): Long = System.currentTimeMillis()

    companion object {
        /**
         * The conservative access-token TTL used when the provider response
         * carried no `expires_in`: the typical 1h Google lifetime with a
         * 15-minute safety margin. Past 45 minutes a served token is treated
         * as stale and refreshed lazily, so a scan never enters with a token
         * the provider is about to reject.
         */
        internal const val ACCESS_TOKEN_TTL_MS = 45L * 60L * 1000L

        /** The margin subtracted from a real `expires_in` before use. */
        internal const val TTL_SAFETY_MARGIN_MS = 15L * 60L * 1000L

        /** Floor for a real `expires_in` lifetime after the margin. */
        internal const val MIN_ACCESS_TOKEN_TTL_MS = 60L * 1000L

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
