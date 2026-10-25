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

    fun clearAll()
}

/**
 * In-memory token provider for unit tests and local mock harnesses.
 */
class MemoryTokenStore : TokenProvider {
    private val tokens = mutableMapOf<String, String>()
    private var memoryGoogleAccessToken: String? = null
    private var memoryMicrosoftAccessToken: String? = null

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

    override fun getGeminiApiKey(): String? = tokens["gemini_api_key"]

    override fun setGeminiApiKey(key: String?) {
        if (key != null) tokens["gemini_api_key"] = key else tokens.remove("gemini_api_key")
    }

    override fun clearAll() {
        tokens.clear()
        memoryGoogleAccessToken = null
        memoryMicrosoftAccessToken = null
    }
}
