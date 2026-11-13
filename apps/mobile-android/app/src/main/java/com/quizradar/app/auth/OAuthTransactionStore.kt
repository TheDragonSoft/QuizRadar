package com.quizradar.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * A pending PKCE OAuth transaction: exactly what the provider callback must
 * be validated against, nothing more.
 *
 * [clientId] is the OAuth client id the sign-in STARTED with. The callback
 * may arrive before the config store has been read (Activity recreation
 * racing the config collection), so the exchange must use the initiating id
 * - never whatever id happens to be loaded at callback time.
 */
data class PendingOAuthTransaction(
    val provider: String,
    val verifier: String,
    val state: String,
    val redirectUri: String,
    val createdAtMs: Long,
    val clientId: String = "",
) {
    fun toJson(): String =
        JSONObject()
            .put("provider", provider)
            .put("verifier", verifier)
            .put("state", state)
            .put("redirectUri", redirectUri)
            .put("createdAtMs", createdAtMs)
            .put("clientId", clientId)
            .toString()

    companion object {
        /** Malformed JSON or a missing field returns null - rejected on load. */
        fun fromJson(json: String): PendingOAuthTransaction? =
            runCatching {
                val obj = JSONObject(json)
                PendingOAuthTransaction(
                    provider = obj.getString("provider"),
                    verifier = obj.getString("verifier"),
                    state = obj.getString("state"),
                    redirectUri = obj.getString("redirectUri"),
                    createdAtMs = obj.getLong("createdAtMs"),
                    clientId = obj.optString("clientId"),
                )
            }.getOrNull()
    }
}

/**
 * Encrypted storage for the PENDING OAuth transaction (audit A04).
 *
 * The provider/state/PKCE-verifier/redirect/client-id previously lived only
 * in fields of the Activity-owned [OAuthManager]; an Activity recreation or
 * process reclamation while the browser was open lost them and every
 * legitimate callback failed "state mismatch". This store persists the
 * transaction in EncryptedSharedPreferences (AES-256, Android Keystore
 * master key - hardware backing is device-dependent and not relied upon) so
 * the callback survives both, while keeping the verifier out of any
 * saveable/restorable UI state (Bundle, `rememberSaveable`).
 *
 * Rules (AGENTS §8):
 * - single-use: [load] CONSUMES the transaction DURABLY (a synchronous
 *   commit, before any network exchange) - a replayed callback finds nothing
 *   and fails honestly,
 * - short-lived: a transaction older than [TRANSACTION_TTL_MS] (15 minutes,
 *   the same window the authorize URL's state was minted for) is dropped,
 *   and so is one stamped in the future (device clock rolled back),
 * - the same delete-and-rebuild resilience as [com.quizradar.app.core.EncryptedTokenStore]:
 *   a device-to-device restore ships the ciphertext without the Keystore
 *   key, so an unreadable file is dropped and rebuilt empty.
 */
class OAuthTransactionStore(
    context: Context,
    /**
     * Overridable for unit tests (Robolectric has no real Keystore): builds
     * the backing prefs. Production uses EncryptedSharedPreferences.
     */
    private val prefsFactory: (Context) -> SharedPreferences = ::encryptedPrefs,
) {
    private val prefs: SharedPreferences =
        try {
            prefsFactory(context)
        } catch (_: Exception) {
            context.deleteSharedPreferences(PREFS_NAME)
            prefsFactory(context)
        }

    /**
     * Persists (or replaces) the pending transaction, committed synchronously
     * so it is on disk before the browser opens. There is at most one: a
     * second sign-in start simply supersedes the first.
     */
    fun save(transaction: PendingOAuthTransaction) {
        synchronized(LOCK) {
            prefs.edit().putString(KEY_PENDING, transaction.toJson()).commit()
        }
    }

    /**
     * Returns the pending transaction, or null when none is stored, the
     * stored one is malformed JSON, or it is expired/future-stamped (all
     * dropped on read).
     *
     * CONSUMES on read: the transaction is removed with a synchronous commit
     * BEFORE the caller starts the token exchange, so a replayed or duplicated
     * callback can never be validated twice. Guarded by a process-wide lock:
     * two store instances (e.g. two Activity instances) cannot both consume
     * the same transaction.
     */
    fun load(nowMs: Long = System.currentTimeMillis()): PendingOAuthTransaction? =
        synchronized(LOCK) {
            val raw = prefs.getString(KEY_PENDING, null) ?: return null
            prefs.edit().remove(KEY_PENDING).commit()
            val transaction = PendingOAuthTransaction.fromJson(raw) ?: return null
            if (nowMs < transaction.createdAtMs || nowMs - transaction.createdAtMs > TRANSACTION_TTL_MS) return null
            transaction
        }

    /** Drops any pending transaction without reading it. */
    fun clear() {
        synchronized(LOCK) {
            prefs.edit().remove(KEY_PENDING).apply()
        }
    }

    private companion object {
        const val PREFS_NAME = "quizradar_oauth_txn"
        const val KEY_PENDING = "pending_transaction"

        /**
         * The authorize URL's state is minted as single-use with a 15-minute
         * window (AGENTS §8); the stored transaction must not outlive it.
         */
        const val TRANSACTION_TTL_MS = 15L * 60L * 1000L

        /**
         * One lock for every store instance in the process: consume-on-read
         * is atomic ACROSS instances, not just within one.
         */
        private val LOCK = Any()

        /** The production backing store: keystore-encrypted prefs. */
        fun encryptedPrefs(context: Context): SharedPreferences =
            EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
    }
}
