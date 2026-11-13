package com.quizradar.app.auth

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.quizradar.app.core.QuizRadarEngine
import org.json.JSONObject

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
    var microsoftClientId: String = DEFAULT_MICROSOFT_CLIENT_ID,
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

    fun isMicrosoftClientConfigured(): Boolean = microsoftClientId.isNotBlank() && microsoftClientId != DEFAULT_MICROSOFT_CLIENT_ID

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

            if (provider == "google") {
                engine.tokenProvider.setGoogleAccessToken(accessToken)
                engine.tokenProvider.setGoogleAccessTokenIssuedAtMs(System.currentTimeMillis())
                if (refreshToken != null) {
                    engine.tokenProvider.setGoogleRefreshToken(refreshToken)
                }
            } else {
                engine.tokenProvider.setMicrosoftAccessToken(accessToken)
                engine.tokenProvider.setMicrosoftAccessTokenIssuedAtMs(System.currentTimeMillis())
                if (refreshToken != null) {
                    engine.tokenProvider.setMicrosoftRefreshToken(refreshToken)
                }
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
         * Google OAuth 2.0 policy requires native Android custom schemes to be
         * formatted as `package_name:/path` without an authority/host (single slash `:/`).
         * Double slash (`://`) is rejected by Google with `Error 400: invalid_request`.
         */
        const val GOOGLE_REDIRECT_URI = "com.quizradar.app:/oauth/google"
        const val MICROSOFT_REDIRECT_URI = "com.quizradar.app://oauth/microsoft"

        /**
         * The maintainer's Google OAuth client id (project
         * `quizradar-513903`). A client id is a public identifier — it appears
         * in every authorize URL — so it ships; a user-supplied id
         * (Settings → Sources) wins over it. No client secret ships: the Android
         * flow is a PKCE public client.
         */
        const val DEFAULT_GOOGLE_CLIENT_ID =
            "438181858687-gubqi1nr6epph2gic9osjvbctg4e0mo4.apps.googleusercontent.com"

        /** Microsoft sign-in still needs the user's own Azure app id. */
        const val DEFAULT_MICROSOFT_CLIENT_ID = "quizradar-android-public-ms"

        /** Ids older placeholder builds may have saved; still refused. */
        val LEGACY_PLACEHOLDER_GOOGLE_CLIENT_IDS =
            setOf("quizradar-android-public.apps.googleusercontent.com")
    }
}
