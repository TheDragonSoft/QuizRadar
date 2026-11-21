package com.quizradar.app.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.quizradar.app.BuildConfig
import com.quizradar.app.core.QuizRadarEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Result of processing a deep-link callback from an OAuth provider or pairing action.
 */
sealed class OAuthRedirectResult {
    data class Success(val provider: String) : OAuthRedirectResult()

    data class Cancelled(val message: String) : OAuthRedirectResult()

    data class Pairing(val url: String?, val pin: String?) : OAuthRedirectResult()

    data class Error(val error: String) : OAuthRedirectResult()
}

/**
 * Native Android PKCE OAuth manager using custom scheme redirects (`com.quizradar.app://oauth/...`).
 * Eliminates the v4 loopback server and Foreground Service completely.
 */
class OAuthManager(
    var googleClientId: String = DEFAULT_GOOGLE_CLIENT_ID,
    var microsoftClientId: String = resolveMicrosoftClientId(null),
    /**
     * When wired, the pending PKCE transaction (provider/state/verifier/
     * redirect) is persisted encrypted and consumed once, so a callback
     * arriving after an Activity recreation or process death still validates
     * (audit A04). Null keeps the pre-persistence behavior: pending state in
     * memory only (unit tests, store-less managers).
     */
    private val transactionStore: OAuthTransactionStore? = null,
) {
    var pendingProvider: String? = null
        private set
    var pendingVerifier: String? = null
        private set
    var pendingState: String? = null
        private set
    var pendingRedirectUri: String? = null
        private set

    fun setPendingStateForTest(
        provider: String,
        verifier: String,
        state: String,
        redirectUri: String,
        clientId: String = "",
    ) {
        pendingProvider = provider
        pendingVerifier = verifier
        pendingState = state
        pendingRedirectUri = redirectUri
        transactionStore?.save(
            PendingOAuthTransaction(provider, verifier, state, redirectUri, System.currentTimeMillis(), clientId),
        )
    }

    private fun rememberPending(
        provider: String,
        verifier: String,
        state: String,
        redirectUri: String,
    ) {
        pendingProvider = provider
        pendingVerifier = verifier
        pendingState = state
        pendingRedirectUri = redirectUri
        // The id the sign-in STARTED with: the callback can arrive before the
        // config store has been read again, and the exchange must use the
        // initiating id, never the id loaded at callback time.
        val clientId = if (provider == "google") googleClientId else microsoftClientId
        transactionStore?.save(
            PendingOAuthTransaction(provider, verifier, state, redirectUri, System.currentTimeMillis(), clientId),
        )
    }

    /**
     * True when a real, usable client id is in place.
     *
     * The build ships the maintainer's Google client id (public identifier —
     * it appears in every authorize URL), so Google sign-in works out of the
     * box. A user-supplied id (Settings → Sources) wins over it, and the
     * legacy placeholder ids older builds saved are still refused honestly.
     */
    fun isGoogleClientConfigured(): Boolean = googleClientId.isNotBlank() && googleClientId !in LEGACY_PLACEHOLDER_GOOGLE_CLIENT_IDS

    fun isMicrosoftClientConfigured(): Boolean = isUsableMicrosoftClientId(microsoftClientId)

    fun startGoogleLogin(
        context: Context,
        engine: QuizRadarEngine,
        redirectUri: String = GOOGLE_REDIRECT_URI,
    ): String {
        val payloadJson = engine.buildGoogleAuthUrl(googleClientId, redirectUri)
        val obj = JSONObject(payloadJson)
        val url = obj.getString("url")
        rememberPending("google", obj.getString("verifier"), obj.getString("state"), redirectUri)
        launchBrowser(context, url)
        return url
    }

    fun startMicrosoftLogin(
        context: Context,
        engine: QuizRadarEngine,
        redirectUri: String = MICROSOFT_REDIRECT_URI,
    ): String {
        val payloadJson = engine.buildMicrosoftAuthUrl(microsoftClientId, redirectUri)
        val obj = JSONObject(payloadJson)
        val url = obj.getString("url")
        rememberPending("microsoft", obj.getString("verifier"), obj.getString("state"), redirectUri)
        launchBrowser(context, url)
        return url
    }

    private fun launchBrowser(
        context: Context,
        url: String,
    ) {
        try {
            val customTabsIntent =
                CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .build()
            customTabsIntent.launchUrl(context, Uri.parse(url))
        } catch (_: Exception) {
            val browserIntent =
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            context.startActivity(browserIntent)
        }
    }

    suspend fun handleRedirect(
        uri: Uri,
        engine: QuizRadarEngine,
        tokenEndpointOverride: String? = null,
        userInfoEndpointOverride: String? = null,
    ): OAuthRedirectResult {
        if (uri.scheme != "com.quizradar.app") {
            return OAuthRedirectResult.Error("Unsupported URI scheme: ${uri.scheme}")
        }

        if (uri.host == "pair" || uri.path?.removePrefix("/") == "pair") {
            return OAuthRedirectResult.Error(
                "Desktop LAN pairing is disabled in QuizRadar v5 zero-server mode. Use Backup Export / Import instead.",
            )
        }

        // Support both RFC 3986 with-authority (com.quizradar.app://oauth/...)
        // and direct package path without authority (com.quizradar.app:/oauth/...)
        // required by Google OAuth 2.0 custom scheme policy.
        val rawPath = uri.path?.removePrefix("/") ?: ""
        val route =
            when {
                uri.host == "oauth" -> rawPath
                uri.host.isNullOrBlank() && rawPath.startsWith("oauth/") -> rawPath.removePrefix("oauth/")
                else -> return OAuthRedirectResult.Error("Unsupported URI host: ${uri.host}")
            }

        if (route == "cancelled" || uri.getQueryParameter("error") != null) {
            val reason =
                uri.getQueryParameter("error_description")
                    ?: uri.getQueryParameter("error")
                    ?: "Sign-in cancelled"
            clearPendingState()
            return OAuthRedirectResult.Cancelled(reason)
        }

        val provider =
            when (route) {
                "google" -> "google"
                "microsoft" -> "microsoft"
                else -> return OAuthRedirectResult.Error("Unsupported OAuth path: $route")
            }

        // Audit A04: resolve the pending transaction. A wired transaction
        // store is authoritative - its persisted copy survives Activity
        // recreation and process death, expires after 15 minutes, and is
        // CONSUMED on read (single-use; a replayed callback finds nothing).
        // Without a store the in-memory fields are used (unit tests).
        val pending =
            if (transactionStore != null) {
                transactionStore.load()
            } else {
                pendingState?.let {
                    PendingOAuthTransaction(
                        provider = pendingProvider ?: "",
                        verifier = pendingVerifier ?: "",
                        state = it,
                        redirectUri = pendingRedirectUri ?: "",
                        createdAtMs = 0L,
                    )
                }
            }
        if (pending == null) {
            clearPendingState()
            return OAuthRedirectResult.Error("OAuth state mismatch or expired session")
        }
        if (pending.provider != provider) {
            clearPendingState()
            return OAuthRedirectResult.Error(
                "OAuth provider mismatch: callback for $provider but session started for ${pending.provider}",
            )
        }

        // The stored redirect is AUTHORITATIVE: the callback must match the
        // scheme and path the sign-in started with, not merely any
        // com.quizradar.app OAuth route.
        val redirectUri =
            pending.redirectUri.takeIf { it.isNotBlank() }
                ?: (if (provider == "google") GOOGLE_REDIRECT_URI else MICROSOFT_REDIRECT_URI)
        if (!callbackMatchesRedirect(uri, redirectUri)) {
            clearPendingState()
            return OAuthRedirectResult.Error(
                "OAuth redirect mismatch: callback does not match the redirect the session started with",
            )
        }

        val returnedState = uri.getQueryParameter("state")
        if (returnedState == null || returnedState != pending.state) {
            clearPendingState()
            return OAuthRedirectResult.Error("OAuth state mismatch or expired session")
        }

        val code =
            uri.getQueryParameter("code")
                ?: run {
                    clearPendingState()
                    return OAuthRedirectResult.Error("Missing authorization code in redirect")
                }

        val verifier =
            pending.verifier.takeIf { it.isNotBlank() }
                ?: run {
                    clearPendingState()
                    return OAuthRedirectResult.Error("Missing PKCE code verifier")
                }

        // The initiating client id, persisted with the transaction: a custom
        // (BYO) id must be used even when the callback races the config load
        // and the manager still holds the default id. Transactions saved by
        // older builds without an id fall back to the manager's current one.
        val clientId =
            pending.clientId.takeIf { it.isNotBlank() }
                ?: (if (provider == "google") googleClientId else microsoftClientId)

        return try {
            val exchangeJson =
                engine.exchangeOAuthCode(
                    provider = provider,
                    clientId = clientId,
                    code = code,
                    redirectUri = redirectUri,
                    codeVerifier = verifier,
                    tokenEndpointOverride = tokenEndpointOverride,
                )
            val tokens = JSONObject(exchangeJson)
            // A blank access_token (provider error body with HTTP 200, or a
            // mangled response) must fail the flow, not poison the token
            // store with an unusable credential.
            val accessToken = tokens.optString("access_token")
            if (accessToken.isBlank()) {
                clearPendingState()
                val hint =
                    tokens.optString("error_description", "").ifBlank {
                        tokens.optString("error", "no access_token in the response")
                    }
                return OAuthRedirectResult.Error("Token exchange failed: $hint")
            }
            val refreshToken = tokens.optString("refresh_token").takeIf { it.isNotBlank() }
            val expiresInSec = tokens.optLong("expires_in", -1L).takeIf { it > 0 }

            if (provider == "google") {
                engine.tokenProvider.setGoogleAccessToken(accessToken)
                engine.tokenProvider.setGoogleAccessTokenIssuedAtMs(System.currentTimeMillis())
                engine.tokenProvider.setGoogleAccessTokenExpiresInSec(expiresInSec)
                if (refreshToken != null) {
                    engine.tokenProvider.setGoogleRefreshToken(refreshToken)
                }
            } else {
                engine.tokenProvider.setMicrosoftAccessToken(accessToken)
                engine.tokenProvider.setMicrosoftAccessTokenIssuedAtMs(System.currentTimeMillis())
                engine.tokenProvider.setMicrosoftAccessTokenExpiresInSec(expiresInSec)
                if (refreshToken != null) {
                    engine.tokenProvider.setMicrosoftRefreshToken(refreshToken)
                }
            }
            if (tokenEndpointOverride == null || userInfoEndpointOverride != null) {
                hydrateSignedInProfile(
                    provider = provider,
                    accessToken = accessToken,
                    engine = engine,
                    userInfoEndpointOverride = userInfoEndpointOverride,
                )
            }
            clearPendingState()
            OAuthRedirectResult.Success(provider)
        } catch (e: Exception) {
            clearPendingState()
            OAuthRedirectResult.Error("Token exchange failed: ${e.message}")
        }
    }

    /**
     * True when the callback URI carries the same scheme and normalized
     * host/path as the redirect the session started with (query parameters
     * ignored). Both Google's single-slash `package:/path` form and the
     * RFC-3986 with-authority `package://host/path` form normalize to the
     * same shape, so both deliveries validate against one stored redirect.
     */
    private fun callbackMatchesRedirect(
        callback: Uri,
        redirectUri: String,
    ): Boolean {
        val redirect = Uri.parse(redirectUri)
        if (callback.scheme != redirect.scheme) return false
        return normalizeRoute(callback) == normalizeRoute(redirect)
    }

    /** Normalizes a URI to its host + path route, slash-insensitive. */
    private fun normalizeRoute(uri: Uri): String {
        val host = uri.host.orEmpty().lowercase()
        val path = uri.path.orEmpty().removePrefix("/").lowercase()
        return if (host.isEmpty()) path else "$host/$path"
    }

    private suspend fun hydrateSignedInProfile(
        provider: String,
        accessToken: String,
        engine: QuizRadarEngine,
        userInfoEndpointOverride: String?,
    ) {
        val targetUrl =
            userInfoEndpointOverride
                ?: if (provider == "google") {
                    GOOGLE_USERINFO_URL
                } else {
                    MICROSOFT_ME_URL
                }
        val parsed =
            withContext(Dispatchers.IO) {
                fetchUserProfileJson(targetUrl, accessToken)
            } ?: return
        if (provider == "google") {
            parsed.optString("email").trim().takeIf { it.isNotEmpty() }?.let { email ->
                engine.setConfigString("user_email", email)
            }
            parsed.optString("name").trim().takeIf { it.isNotEmpty() }?.let { name ->
                engine.setConfigString("user_name", name)
            }
            parsed.optString("picture").trim().takeIf { it.isNotEmpty() }?.let { picture ->
                engine.setConfigString("user_picture", picture)
            }
        } else {
            parsed.optString("displayName").trim().takeIf { it.isNotEmpty() }?.let { name ->
                engine.setConfigString("teams_account_name", name)
            }
            val email =
                parsed.optString("mail").trim().ifBlank {
                    parsed.optString("userPrincipalName").trim()
                }
            if (email.isNotEmpty()) {
                engine.setConfigString("teams_account_email", email)
            }
        }
    }

    private fun fetchUserProfileJson(
        targetUrl: String,
        accessToken: String,
    ): JSONObject? =
        runCatching {
            val uri = Uri.parse(targetUrl)
            val scheme = uri.scheme?.lowercase()
            val host = uri.host?.lowercase()
            val isAllowedProd =
                scheme == "https" &&
                    (host == "www.googleapis.com" || host == "graph.microsoft.com")
            val isAllowedLoopback =
                scheme == "http" &&
                    (host == "127.0.0.1" || host == "localhost" || host == "::1")
            if (!isAllowedProd && !isAllowedLoopback) return@runCatching null

            val conn = (URL(targetUrl).openConnection() as? HttpURLConnection) ?: return@runCatching null
            try {
                conn.requestMethod = "GET"
                conn.connectTimeout = 5_000
                conn.readTimeout = 5_000
                conn.setRequestProperty("Authorization", "Bearer $accessToken")
                conn.setRequestProperty("Accept", "application/json")
                if (conn.responseCode !in 200..299) return@runCatching null
                val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                JSONObject(body)
            } finally {
                conn.disconnect()
            }
        }.getOrNull()

    fun clearPendingState() {
        pendingProvider = null
        pendingVerifier = null
        pendingState = null
        pendingRedirectUri = null
        transactionStore?.clear()
    }

    companion object {
        /**
         * The effective Google client id (audit A03): the stored override
         * (Settings -> Sources) when usable, otherwise the shipped public
         * client id - a blank or legacy-placeholder override no longer kills
         * sign-in or silent refresh. Login and the core-facing token refresh
         * (EngineFfiTokens) resolve through this one rule.
         */
        fun resolveGoogleClientId(stored: String?): String =
            stored?.trim()?.takeIf {
                it.isNotEmpty() && it !in LEGACY_PLACEHOLDER_GOOGLE_CLIENT_IDS
            } ?: DEFAULT_GOOGLE_CLIENT_ID

        /**
         * True when [candidate] is a usable user-configured Microsoft client ID
         * (non-blank, no whitespace, not a legacy or all-zero placeholder).
         */
        fun isUsableMicrosoftClientId(candidate: String?): Boolean {
            val trimmed = candidate?.trim().orEmpty()
            if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return false
            if (trimmed in LEGACY_PLACEHOLDER_MICROSOFT_CLIENT_IDS) return false
            if (trimmed.equals("00000000-0000-0000-0000-000000000000", ignoreCase = true)) {
                return false
            }
            return true
        }

        /**
         * True when [candidate] is a well-formed Microsoft Entra Application
         * (client) GUID and not an all-zero or legacy placeholder string.
         */
        fun isValidMicrosoftClientId(candidate: String?): Boolean {
            val trimmed = candidate?.trim().orEmpty()
            return isUsableMicrosoftClientId(trimmed) && MICROSOFT_GUID_REGEX.matches(trimmed)
        }

        /**
         * The effective Microsoft Entra Application (client) ID:
         *  1. a usable user-supplied override (Settings -> Sources),
         *  2. the build-time multi-tenant first-party GUID ([BuildConfig.MICROSOFT_CLIENT_ID]),
         *  3. [DEFAULT_MICROSOFT_CLIENT_ID] (unconfigured placeholder when no GUID is bundled).
         */
        fun resolveMicrosoftClientId(
            stored: String?,
            bundledOverride: String = BuildConfig.MICROSOFT_CLIENT_ID,
        ): String {
            val userOverride = stored?.trim().orEmpty()
            if (isUsableMicrosoftClientId(userOverride)) return userOverride
            val bundled = bundledOverride.trim()
            if (isValidMicrosoftClientId(bundled)) return bundled
            return DEFAULT_MICROSOFT_CLIENT_ID
        }

        /**
         * Google OAuth 2.0 policy requires native Android custom schemes to be
         * formatted as `package_name:/path` without an authority/host (single slash `:/`).
         * Double slash (`://`) is rejected by Google with `Error 400: invalid_request`.
         */
        const val GOOGLE_REDIRECT_URI = "com.quizradar.app:/oauth/google"
        const val MICROSOFT_REDIRECT_URI = "com.quizradar.app://oauth/microsoft"
        const val GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
        const val MICROSOFT_ME_URL = "https://graph.microsoft.com/v1.0/me"

        /**
         * The maintainer's Google OAuth client id (project
         * `quizradar-513903`). A client id is a public identifier — it appears
         * in every authorize URL — so it ships; a user-supplied id
         * (Settings → Sources) wins over it. No client secret ships: the Android
         * flow is a PKCE public client.
         */
        const val DEFAULT_GOOGLE_CLIENT_ID =
            "438181858687-gubqi1nr6epph2gic9osjvbctg4e0mo4.apps.googleusercontent.com"

        /**
         * Sentinel used when neither a build-time first-party Entra GUID
         * (`QUIZRADAR_MICROSOFT_CLIENT_ID`) nor a user override in Settings is set.
         */
        const val DEFAULT_MICROSOFT_CLIENT_ID = "quizradar-android-public-ms"

        /** Ids older placeholder builds may have saved; still refused. */
        val LEGACY_PLACEHOLDER_GOOGLE_CLIENT_IDS =
            setOf("quizradar-android-public.apps.googleusercontent.com")

        val LEGACY_PLACEHOLDER_MICROSOFT_CLIENT_IDS =
            setOf(DEFAULT_MICROSOFT_CLIENT_ID)

        private val MICROSOFT_GUID_REGEX =
            Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }
}
