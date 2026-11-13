package com.quizradar.app.core

/**
 * Interface for secure token and credential access on Android.
 * Refresh tokens and API keys are persisted securely in EncryptedSharedPreferences;
 * short-lived (1-hour) access tokens are kept strictly in-memory.
 */
interface TokenProvider {
    fun getGoogleRefreshToken(): String?

    fun setGoogleRefreshToken(token: String?)

    fun getGoogleAccessToken(): String?

    fun setGoogleAccessToken(token: String?)

    fun getMicrosoftRefreshToken(): String?

    fun setMicrosoftRefreshToken(token: String?)

    fun getMicrosoftAccessToken(): String?

    fun setMicrosoftAccessToken(token: String?)

    fun getGeminiApiKey(): String?

    fun setGeminiApiKey(key: String?)

    /**
     * When the current Google access token was issued (epoch millis), or null
     * when the store does not know. Null is the "no timestamp recorded" state
     * (a token written by an older build, or by a caller that did not stamp
     * it) — callers must treat a null as "age unknown" and be conservative.
     *
     * Default no-op implementations keep test fakes and lightweight stores
     * source-compatible: only stores that can persist the stamp override them.
     */
    fun getGoogleAccessTokenIssuedAtMs(): Long? = null

    fun setGoogleAccessTokenIssuedAtMs(issuedAtMs: Long?) {}

    fun getMicrosoftAccessTokenIssuedAtMs(): Long? = null

    fun setMicrosoftAccessTokenIssuedAtMs(issuedAtMs: Long?) {}

    /**
     * The `expires_in` (seconds) the provider returned with the current
     * access token, or null when it was absent from the response. Callers
     * fall back to the conservative fixed TTL when this is null.
     *
     * MEMORY-ONLY like the token itself (AGENTS §3): a fresh process falls
     * back to the conservative TTL until the next refresh. The default no-ops
     * again keep test fakes source-compatible.
     */
    fun getGoogleAccessTokenExpiresInSec(): Long? = null

    fun setGoogleAccessTokenExpiresInSec(expiresInSec: Long?) {}

    fun getMicrosoftAccessTokenExpiresInSec(): Long? = null

    fun setMicrosoftAccessTokenExpiresInSec(expiresInSec: Long?) {}

    fun clearAll()
}

/**
 * In-memory token provider for unit tests and local mock harnesses.
 */
class MemoryTokenStore : TokenProvider {
    private val tokens = mutableMapOf<String, String>()
    private var memoryGoogleAccessToken: String? = null
    private var memoryMicrosoftAccessToken: String? = null
    private var memoryGoogleAccessTokenIssuedAtMs: Long? = null
    private var memoryMicrosoftAccessTokenIssuedAtMs: Long? = null
    private var memoryGoogleAccessTokenExpiresInSec: Long? = null
    private var memoryMicrosoftAccessTokenExpiresInSec: Long? = null

    override fun getGoogleRefreshToken(): String? = tokens["google_refresh_token"]

    override fun setGoogleRefreshToken(token: String?) {
        if (token != null) tokens["google_refresh_token"] = token else tokens.remove("google_refresh_token")
    }

    override fun getGoogleAccessToken(): String? = memoryGoogleAccessToken

    override fun setGoogleAccessToken(token: String?) {
        memoryGoogleAccessToken = token
    }

    override fun getMicrosoftRefreshToken(): String? = tokens["microsoft_refresh_token"]

    override fun setMicrosoftRefreshToken(token: String?) {
        if (token != null) tokens["microsoft_refresh_token"] = token else tokens.remove("microsoft_refresh_token")
    }

    override fun getMicrosoftAccessToken(): String? = memoryMicrosoftAccessToken

    override fun setMicrosoftAccessToken(token: String?) {
        memoryMicrosoftAccessToken = token
    }

    override fun getGoogleAccessTokenIssuedAtMs(): Long? = memoryGoogleAccessTokenIssuedAtMs

    override fun setGoogleAccessTokenIssuedAtMs(issuedAtMs: Long?) {
        memoryGoogleAccessTokenIssuedAtMs = issuedAtMs
    }

    override fun getMicrosoftAccessTokenIssuedAtMs(): Long? = memoryMicrosoftAccessTokenIssuedAtMs

    override fun setMicrosoftAccessTokenIssuedAtMs(issuedAtMs: Long?) {
        memoryMicrosoftAccessTokenIssuedAtMs = issuedAtMs
    }

    override fun getGoogleAccessTokenExpiresInSec(): Long? = memoryGoogleAccessTokenExpiresInSec

    override fun setGoogleAccessTokenExpiresInSec(expiresInSec: Long?) {
        memoryGoogleAccessTokenExpiresInSec = expiresInSec
    }

    override fun getMicrosoftAccessTokenExpiresInSec(): Long? = memoryMicrosoftAccessTokenExpiresInSec

    override fun setMicrosoftAccessTokenExpiresInSec(expiresInSec: Long?) {
        memoryMicrosoftAccessTokenExpiresInSec = expiresInSec
    }

    override fun getGeminiApiKey(): String? = tokens["gemini_api_key"]

    override fun setGeminiApiKey(key: String?) {
        if (key != null) tokens["gemini_api_key"] = key else tokens.remove("gemini_api_key")
    }

    override fun clearAll() {
        tokens.clear()
        memoryGoogleAccessToken = null
        memoryMicrosoftAccessToken = null
        memoryGoogleAccessTokenIssuedAtMs = null
        memoryMicrosoftAccessTokenIssuedAtMs = null
        memoryGoogleAccessTokenExpiresInSec = null
        memoryMicrosoftAccessTokenExpiresInSec = null
    }
}
