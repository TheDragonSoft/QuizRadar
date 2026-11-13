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

    // A device-to-device restore ships the encrypted prefs WITHOUT the
    // Keystore master key — `create` then throws (AEADBadTagException family)
    // at launch. That is a crash loop. The unreadable file is dropped and
    // rebuilt empty: the user re-signs in, the app still starts.
    private val prefs: SharedPreferences =
        try {
            EncryptedSharedPreferences.create(
                context,
                "quizradar_secure_tokens",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (_: Exception) {
            context.deleteSharedPreferences("quizradar_secure_tokens")
            EncryptedSharedPreferences.create(
                context,
                "quizradar_secure_tokens",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }

    @Volatile
    private var memoryGoogleAccessToken: String? = null

    @Volatile
    private var memoryMicrosoftAccessToken: String? = null

    @Volatile
    private var memoryGoogleAccessTokenExpiresInSec: Long? = null

    @Volatile
    private var memoryMicrosoftAccessTokenExpiresInSec: Long? = null

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

    // The access tokens themselves stay memory-only; only the (non-secret)
    // issuance timestamps persist, so a fresh EngineFfiTokens wrapper — or a
    // fresh process — knows the token's real age instead of guessing from
    // when it was first served.
    override fun getGoogleAccessTokenIssuedAtMs(): Long? = prefs.getLong("google_access_issued_at_ms", 0L).takeIf { it != 0L }

    override fun setGoogleAccessTokenIssuedAtMs(issuedAtMs: Long?) {
        prefs.edit().apply {
            if (issuedAtMs != null) putLong("google_access_issued_at_ms", issuedAtMs) else remove("google_access_issued_at_ms")
            apply()
        }
    }

    override fun getMicrosoftAccessTokenIssuedAtMs(): Long? = prefs.getLong("microsoft_access_issued_at_ms", 0L).takeIf { it != 0L }

    override fun setMicrosoftAccessTokenIssuedAtMs(issuedAtMs: Long?) {
        prefs.edit().apply {
            if (issuedAtMs != null) putLong("microsoft_access_issued_at_ms", issuedAtMs) else remove("microsoft_access_issued_at_ms")
            apply()
        }
    }

    // The provider-returned expires_in stays MEMORY-ONLY with the token: a
    // fresh process conservatively assumes the fixed TTL until the next
    // refresh records the real lifetime again.
    override fun getGoogleAccessTokenExpiresInSec(): Long? = memoryGoogleAccessTokenExpiresInSec

    override fun setGoogleAccessTokenExpiresInSec(expiresInSec: Long?) {
        memoryGoogleAccessTokenExpiresInSec = expiresInSec
    }

    override fun getMicrosoftAccessTokenExpiresInSec(): Long? = memoryMicrosoftAccessTokenExpiresInSec

    override fun setMicrosoftAccessTokenExpiresInSec(expiresInSec: Long?) {
        memoryMicrosoftAccessTokenExpiresInSec = expiresInSec
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
        memoryGoogleAccessTokenExpiresInSec = null
        memoryMicrosoftAccessTokenExpiresInSec = null
        prefs.edit().clear().apply()
    }
}
