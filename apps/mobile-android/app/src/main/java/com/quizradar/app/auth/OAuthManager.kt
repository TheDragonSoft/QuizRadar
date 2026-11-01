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
    ) {
        pendingProvider = provider
        pendingVerifier = verifier
        pendingState = state
        pendingRedirectUri = redirectUri
    }

    /**
     * True when a real client id is in place.
     *
     * The open-source build ships placeholder ids: a Google Android client id
     * must be registered for the app's package name + SHA-1, and an Azure app
     * id must exist for the Teams channel. Starting the browser flow with a
     * placeholder can only fail at the provider, so the UI checks this first
     * and says the truth instead of opening a tab that dies on "client id not
     * found".
     */
    fun isGoogleClientConfigured(): Boolean = googleClientId.isNotBlank() && googleClientId != DEFAULT_GOOGLE_CLIENT_ID

    fun isMicrosoftClientConfigured(): Boolean = microsoftClientId.isNotBlank() && microsoftClientId != DEFAULT_MICROSOFT_CLIENT_ID

    fun startGoogleLogin(
        context: Context,
        engine: QuizRadarEngine,
        redirectUri: String = GOOGLE_REDIRECT_URI,
    ): String {
        val payloadJson = engine.buildGoogleAuthUrl(googleClientId, redirectUri)
        val obj = JSONObject(payloadJson)
        val url = obj.getString("url")
        pendingProvider = "google"
        pendingVerifier = obj.getString("verifier")
        pendingState = obj.getString("state")
        pendingRedirectUri = redirectUri
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
        pendingProvider = "microsoft"
        pendingVerifier = obj.getString("verifier")
        pendingState = obj.getString("state")
        pendingRedirectUri = redirectUri
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

        if (uri.host == "pair") {
            return OAuthRedirectResult.Error(
                "Desktop LAN pairing is disabled in QuizRadar v5 zero-server mode. Use Backup Export / Import instead.",
            )
        }

        if (uri.host != "oauth") {
            return OAuthRedirectResult.Error("Unsupported URI host: ${uri.host}")
        }

        val path = uri.path?.removePrefix("/") ?: ""
        if (path == "cancelled" || uri.getQueryParameter("error") != null) {
            val reason =
                uri.getQueryParameter("error_description")
                    ?: uri.getQueryParameter("error")
                    ?: "Sign-in cancelled"
            clearPendingState()
            return OAuthRedirectResult.Cancelled(reason)
        }

        val provider =
            when (path) {
                "google" -> "google"
                "microsoft" -> "microsoft"
                else -> return OAuthRedirectResult.Error("Unsupported OAuth path: $path")
            }

        val returnedState = uri.getQueryParameter("state")
        if (returnedState == null || returnedState != pendingState) {
            clearPendingState()
            return OAuthRedirectResult.Error("OAuth state mismatch or expired session")
        }

        val code =
            uri.getQueryParameter("code")
                ?: return OAuthRedirectResult.Error("Missing authorization code in redirect")

        val verifier =
            pendingVerifier
                ?: return OAuthRedirectResult.Error("Missing PKCE code verifier")

        val redirectUri =
            pendingRedirectUri
                ?: if (provider == "google") GOOGLE_REDIRECT_URI else MICROSOFT_REDIRECT_URI

        val clientId = if (provider == "google") googleClientId else microsoftClientId

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
                if (refreshToken != null) {
                    engine.tokenProvider.setGoogleRefreshToken(refreshToken)
                }
            } else {
                engine.tokenProvider.setMicrosoftAccessToken(accessToken)
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

    fun clearPendingState() {
        pendingProvider = null
        pendingVerifier = null
        pendingState = null
        pendingRedirectUri = null
    }

    companion object {
        const val GOOGLE_REDIRECT_URI = "com.quizradar.app://oauth/google"
        const val MICROSOFT_REDIRECT_URI = "com.quizradar.app://oauth/microsoft"
        const val DEFAULT_GOOGLE_CLIENT_ID = "quizradar-android-public.apps.googleusercontent.com"
        const val DEFAULT_MICROSOFT_CLIENT_ID = "quizradar-android-public-ms"
    }
}
