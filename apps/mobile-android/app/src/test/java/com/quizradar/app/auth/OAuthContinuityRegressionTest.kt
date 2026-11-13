package com.quizradar.app.auth

import android.content.Context
import android.net.Uri
import com.quizradar.app.core.MemoryTokenStore
import com.quizradar.app.core.QuizRadarEngine
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.net.ServerSocket

/**
 * Regression coverage for audit A04: the pending PKCE transaction survives
 * Activity recreation and process death through the encrypted
 * [OAuthTransactionStore], is validated (provider/state/verifier/redirect/
 * client-id), expires after its window, and is consumed once.
 */
@RunWith(RobolectricTestRunner::class)
class OAuthContinuityRegressionTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    /** Robolectric has no real Keystore; the transaction logic is identical either way. */
    private fun newTransactionStore() =
        OAuthTransactionStore(context) { ctx ->
            ctx.getSharedPreferences("quizradar_oauth_txn_test", Context.MODE_PRIVATE)
        }

    private fun newManager(store: OAuthTransactionStore) = OAuthManager(transactionStore = store)

    private fun googleVerifier() = "v-12345678901234567890123456789012345"

    @Test
    fun aTransactionSurvivesRecreationAndProcessDeathAndValidatesTheCallback() =
        runBlocking {
            val tokenStore = MemoryTokenStore()
            val engine = QuizRadarEngine.createInMemory(tokenStore)

            // The sign-in starts on the pre-recreation manager.
            val before = newManager(newTransactionStore())
            before.setPendingStateForTest(
                provider = "google",
                verifier = "test-verifier-12345678901234567890123456789012345",
                state = "state-survives-1",
                redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
            )

            // "Recreation"/process death: brand-new manager AND store over the
            // same persisted file - the in-memory fields are gone.
            val after = newManager(newTransactionStore())
            assertTrue("the fresh manager starts with no in-memory pending state", after.pendingState == null)

            val (mockPort, serverSocket) = startMockTokenServer()
            try {
                val result =
                    after.handleRedirect(
                        Uri.parse("com.quizradar.app:/oauth/google?code=auth-code-1&state=state-survives-1"),
                        engine,
                        tokenEndpointOverride = "http://127.0.0.1:$mockPort/token",
                    )
                assertTrue("callback must validate after recreation: $result", result is OAuthRedirectResult.Success)
                assertEquals("google", (result as OAuthRedirectResult.Success).provider)
                assertNotNull("the exchanged access token is stored", tokenStore.getGoogleAccessToken())
                assertNotNull(
                    "the fresh access token carries its issuance stamp (audit A03 tie-in)",
                    tokenStore.getGoogleAccessTokenIssuedAtMs(),
                )
            } finally {
                serverSocket.close()
            }
        }

    @Test
    fun aRecoveredTransactionExchangesWithTheInitiatingClientId() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val before = newManager(newTransactionStore())
            before.setPendingStateForTest(
                provider = "google",
                verifier = googleVerifier(),
                state = "state-custom-id-1",
                redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
                clientId = "custom-byo-id",
            )

            // The fresh manager never read the config: it still holds the
            // DEFAULT id. The persisted initiating id must win the exchange -
            // Google would reject a default-id exchange for a BYO session.
            val after = newManager(newTransactionStore())
            var requestBody = ""
            val (mockPort, serverSocket) = startMockTokenServer { requestBody = it }
            try {
                val result =
                    after.handleRedirect(
                        Uri.parse("com.quizradar.app:/oauth/google?code=c&state=state-custom-id-1"),
                        engine,
                        tokenEndpointOverride = "http://127.0.0.1:$mockPort/token",
                    )
                assertTrue("the persisted client id must let the callback validate: $result", result is OAuthRedirectResult.Success)
                assertTrue(
                    "the exchange must use the initiating client id, got body: $requestBody",
                    requestBody.contains("client_id=custom-byo-id"),
                )
            } finally {
                serverSocket.close()
            }
        }

    @Test
    fun aRecoveredTransactionRejectsAStateMismatch() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val before = newManager(newTransactionStore())
            before.setPendingStateForTest(
                "google",
                googleVerifier(),
                "state-real-1",
                OAuthManager.GOOGLE_REDIRECT_URI,
            )

            val after = newManager(newTransactionStore())
            val result =
                after.handleRedirect(
                    Uri.parse("com.quizradar.app:/oauth/google?code=c&state=state-forged-9"),
                    engine,
                )
            assertTrue(result is OAuthRedirectResult.Error)
            assertTrue((result as OAuthRedirectResult.Error).error.contains("state mismatch"))
        }

    @Test
    fun aRecoveredTransactionRejectsAProviderMismatch() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val before = newManager(newTransactionStore())
            before.setPendingStateForTest(
                "google",
                googleVerifier(),
                "state-real-2",
                OAuthManager.GOOGLE_REDIRECT_URI,
            )

            val after = newManager(newTransactionStore())
            val result =
                after.handleRedirect(
                    Uri.parse("com.quizradar.app://oauth/microsoft?code=c&state=state-real-2"),
                    engine,
                )
            assertTrue(result is OAuthRedirectResult.Error)
            assertTrue(
                "a google session must not complete via a microsoft callback",
                (result as OAuthRedirectResult.Error).error.contains("provider mismatch"),
            )
        }

    @Test
    fun aCallbackNotMatchingTheStoredRedirectIsRejected() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val before = newManager(newTransactionStore())
            before.setPendingStateForTest(
                "google",
                googleVerifier(),
                "state-redirect-1",
                // A session started against a differently-pathed redirect: the
                // stored redirect is authoritative, so the standard route must
                // not validate against it.
                "com.quizradar.app:/oauth2/google",
            )

            val after = newManager(newTransactionStore())
            val result =
                after.handleRedirect(
                    Uri.parse("com.quizradar.app:/oauth/google?code=c&state=state-redirect-1"),
                    engine,
                )
            assertTrue(result is OAuthRedirectResult.Error)
            assertTrue(
                "the callback must match the redirect the session started with",
                (result as OAuthRedirectResult.Error).error.contains("redirect mismatch"),
            )
        }

    @Test
    fun anExpiredTransactionIsDroppedInsteadOfValidated() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val store = newTransactionStore()
            store.save(
                PendingOAuthTransaction(
                    provider = "google",
                    verifier = googleVerifier(),
                    state = "state-old-1",
                    redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
                    createdAtMs = System.currentTimeMillis() - 16L * 60L * 1000L,
                ),
            )

            val manager = newManager(store)
            val result =
                manager.handleRedirect(
                    Uri.parse("com.quizradar.app:/oauth/google?code=c&state=state-old-1"),
                    engine,
                )
            assertTrue("a transaction past its 15-minute window must not validate", result is OAuthRedirectResult.Error)
            assertTrue((result as OAuthRedirectResult.Error).error.contains("expired session"))
        }

    @Test
    fun aFutureStampedTransactionIsDroppedInsteadOfValidated() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            val store = newTransactionStore()
            store.save(
                PendingOAuthTransaction(
                    provider = "google",
                    verifier = googleVerifier(),
                    state = "state-future-1",
                    redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
                    // Device clock rolled back after save: the stamp is in the
                    // future and would otherwise keep the window open forever.
                    createdAtMs = System.currentTimeMillis() + 30L * 60L * 1000L,
                ),
            )

            val manager = newManager(store)
            val result =
                manager.handleRedirect(
                    Uri.parse("com.quizradar.app:/oauth/google?code=c&state=state-future-1"),
                    engine,
                )
            assertTrue("a future-stamped transaction must not validate", result is OAuthRedirectResult.Error)
            assertTrue((result as OAuthRedirectResult.Error).error.contains("expired session"))
        }

    @Test
    fun aMalformedStoredTransactionIsDroppedInsteadOfValidated() =
        runBlocking {
            val engine = QuizRadarEngine.createInMemory(MemoryTokenStore())
            // Corrupt the persisted payload behind the store's back (partial
            // write / restore damage): an unreadable transaction must fail
            // the callback, not validate against half a session.
            val prefs = context.getSharedPreferences("quizradar_oauth_txn_test", Context.MODE_PRIVATE)
            prefs.edit().putString("pending_transaction", "{not valid json").commit()

            val manager = newManager(newTransactionStore())
            val result =
                manager.handleRedirect(
                    Uri.parse("com.quizradar.app:/oauth/google?code=c&state=anything"),
                    engine,
                )
            assertTrue("a malformed transaction must not validate", result is OAuthRedirectResult.Error)
        }

    @Test
    fun aValidatedTransactionIsConsumedOnce() =
        runBlocking {
            val tokenStore = MemoryTokenStore()
            val engine = QuizRadarEngine.createInMemory(tokenStore)
            val before = newManager(newTransactionStore())
            before.setPendingStateForTest(
                "google",
                googleVerifier(),
                "state-once-1",
                OAuthManager.GOOGLE_REDIRECT_URI,
            )

            val after = newManager(newTransactionStore())
            val (mockPort, serverSocket) = startMockTokenServer()
            try {
                val first =
                    after.handleRedirect(
                        Uri.parse("com.quizradar.app:/oauth/google?code=code-1&state=state-once-1"),
                        engine,
                        tokenEndpointOverride = "http://127.0.0.1:$mockPort/token",
                    )
                assertTrue("first delivery must succeed: $first", first is OAuthRedirectResult.Success)

                val replay =
                    after.handleRedirect(
                        Uri.parse("com.quizradar.app:/oauth/google?code=code-1&state=state-once-1"),
                        engine,
                    )
                assertTrue("the consumed transaction must not validate twice", replay is OAuthRedirectResult.Error)
                assertTrue((replay as OAuthRedirectResult.Error).error.contains("expired session"))
            } finally {
                serverSocket.close()
            }
        }

    /** The same mock token endpoint pattern the existing OAuthFlowTest uses. */
    private fun startMockTokenServer(onRequestBody: (String) -> Unit = {}): Pair<Int, ServerSocket> {
        val server = ServerSocket(0)
        Thread {
            try {
                val socket = server.accept()
                val reader = socket.getInputStream().bufferedReader()
                var contentLength = 0
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                    if (line.lowercase().startsWith("content-length:")) {
                        contentLength = line.substringAfter(':').trim().toIntOrNull() ?: 0
                    }
                }
                // Read exactly Content-Length chars: reading to EOF would
                // deadlock - the client keeps the connection open awaiting
                // the response.
                if (contentLength > 0) {
                    val bodyChars = CharArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val n = reader.read(bodyChars, read, contentLength - read)
                        if (n < 0) break
                        read += n
                    }
                    onRequestBody(String(bodyChars, 0, read))
                }
                val responseBody =
                    """
                    {
                        "access_token": "mock-access-token-1",
                        "token_type": "Bearer",
                        "expires_in": 3600,
                        "refresh_token": "mock-refresh-token-1"
                    }
                    """.trimIndent()
                val bytes = responseBody.toByteArray(Charsets.UTF_8)
                val header =
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                socket.getOutputStream().apply {
                    write(header.toByteArray(Charsets.UTF_8))
                    write(bytes)
                    flush()
                }
                socket.close()
            } catch (_: Exception) {
            }
        }.start()
        return server.localPort to server
    }
}
