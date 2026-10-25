package com.quizradar.app.core

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Android Keystore-backed EncryptedSharedPreferences implementation of TokenProvider.
 * Encrypts refresh tokens and BYOK API keys with AES-256 at app-private scope.
 */
class EncryptedTokenStore(context: Context) : TokenProvider {
    private val masterKey: MasterKey =
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

    private val prefs: SharedPreferences =
        EncryptedSharedPreferences.create(
            context,
            "quizradar_secure_tokens",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    @Volatile
    private var memoryGoogleAccessToken: String? = null

    @Volatile
    private var memoryMicrosoftAccessToken: String? = null

    override fun getGoogleRefreshToken(): String? = prefs.getString("google_refresh_token", null)

    override fun setGoogleRefreshToken(token: String?) {
        prefs.edit().apply {
            if (token != null) {
                putString("google_refresh_token", token)
            } else {
                remove("google_refresh_token")
            }
            apply()
        }
    }

    override fun getGoogleAccessToken(): String? = memoryGoogleAccessToken

    override fun setGoogleAccessToken(token: String?) {
        memoryGoogleAccessToken = token
    }

    override fun getMicrosoftRefreshToken(): String? = prefs.getString("microsoft_refresh_token", null)

    override fun setMicrosoftRefreshToken(token: String?) {
        prefs.edit().apply {
            if (token != null) {
                putString("microsoft_refresh_token", token)
            } else {
                remove("microsoft_refresh_token")
            }
            apply()
        }
    }

    override fun getMicrosoftAccessToken(): String? = memoryMicrosoftAccessToken

    override fun setMicrosoftAccessToken(token: String?) {
        memoryMicrosoftAccessToken = token
    }

    override fun getGeminiApiKey(): String? = prefs.getString("gemini_api_key", null)

    override fun setGeminiApiKey(key: String?) {
        prefs.edit().apply {
            if (key != null) {
                putString("gemini_api_key", key)
            } else {
                remove("gemini_api_key")
            }
            apply()
        }
    }

    override fun clearAll() {
        memoryGoogleAccessToken = null
        memoryMicrosoftAccessToken = null
        prefs.edit().clear().apply()
    }
}
