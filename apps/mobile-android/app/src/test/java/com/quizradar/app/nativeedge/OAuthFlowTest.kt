package com.quizradar.app.nativeedge

import android.net.Uri
import com.quizradar.app.auth.OAuthManager
import com.quizradar.app.auth.OAuthRedirectResult
import com.quizradar.app.core.MemoryTokenStore
import com.quizradar.app.core.QuizRadarEngine
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.ServerSocket

@RunWith(RobolectricTestRunner::class)
class OAuthFlowTest {
    private lateinit var engine: QuizRadarEngine
    private lateinit var tokenStore: MemoryTokenStore
    private lateinit var oauthManager: OAuthManager
    private var serverSocket: ServerSocket? = null

    @Before
    fun setup() {
        tokenStore = MemoryTokenStore()
        engine = QuizRadarEngine.createInMemory(tokenStore)
        oauthManager = OAuthManager()
    }

    @After
    fun tearDown() {
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
    }

    @Test
    fun testGoogleUrlGenerationContainsCustomSchemeAndPkce() {
        val json = engine.buildGoogleAuthUrl("test-client-id", OAuthManager.GOOGLE_REDIRECT_URI)
        val obj = org.json.JSONObject(json)
        val url = obj.getString("url")
        val verifier = obj.getString("verifier")
        val state = obj.getString("state")

        assertTrue("URL must point to Google", url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"))
        assertTrue("Must include redirect_uri", url.contains("redirect_uri=com.quizradar.app%3A%2Foauth%2Fgoogle"))
        assertTrue("Must include client_id", url.contains("client_id=test-client-id"))
        assertTrue("Must include code_challenge", url.contains("code_challenge="))
        assertTrue("Must include state", url.contains("state=$state"))
        assertTrue("Must include gmail scope", url.contains("gmail.readonly"))
        assertTrue("Verifier must be 43-128 chars", verifier.length in 43..128)
    }

    @Test
    fun testStateMismatchReturnsError() =
        runBlocking {
            oauthManager.setPendingStateForTest(
                provider = "google",
                verifier = "test-verifier-12345678901234567890123456789012345",
                state = "expected-state-abc",
                redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
            )

            val uri = Uri.parse("com.quizradar.app://oauth/google?code=valid-code&state=wrong-state-xyz")
            val result = oauthManager.handleRedirect(uri, engine)

            assertTrue("State mismatch must yield Error", result is OAuthRedirectResult.Error)
            val err = (result as OAuthRedirectResult.Error).error
            assertTrue(err.contains("state mismatch"))
        }

    @Test
    fun testCancelledUrlReturnsCancelledResult() =
        runBlocking {
            oauthManager.setPendingStateForTest(
                provider = "google",
                verifier = "test-verifier-12345678901234567890123456789012345",
                state = "state-123",
                redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
            )

            val uri = Uri.parse("com.quizradar.app://oauth/cancelled?error=access_denied&error_description=User%20declined")
            val result = oauthManager.handleRedirect(uri, engine)

            assertTrue("Must yield Cancelled result", result is OAuthRedirectResult.Cancelled)
            val cancelled = result as OAuthRedirectResult.Cancelled
            assertEquals("User declined", cancelled.message)
        }

    @Test
    fun testPairingDeepLinkReturnsDisabledError() =
        runBlocking {
            val uri = Uri.parse("com.quizradar.app://pair?url=http%3A%2F%2F192.168.1.15%3A8000&pin=482910")
            val result = oauthManager.handleRedirect(uri, engine)

            assertTrue("Must yield Error result", result is OAuthRedirectResult.Error)
            val err = (result as OAuthRedirectResult.Error).error
            assertTrue(err.contains("Desktop LAN pairing is disabled"))
        }

    @Test
    fun testTokenExchangeAgainstMockServerPersistsTokens() =
        runBlocking {
            val server = ServerSocket(0)
            serverSocket = server
            val port = server.localPort

            Thread {
                try {
                    val socket = server.accept()
                    val reader = socket.getInputStream().bufferedReader()
                    while (true) {
                        val line = reader.readLine()
                        if (line.isNullOrEmpty()) break
                    }

                    val responseBody =
                        """
                        {
                            "access_token": "mock-access-token-98765",
                            "token_type": "Bearer",
                            "expires_in": 3600,
                            "refresh_token": "mock-refresh-token-54321"
                        }
                        """.trimIndent()
                    val bytes = responseBody.toByteArray(Charsets.UTF_8)
                    val header =
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                    val out = socket.getOutputStream()
                    out.write(header.toByteArray(Charsets.UTF_8))
                    out.write(bytes)
                    out.flush()
                    socket.close()
                } catch (_: Exception) {
                }
            }.start()

            val mockEndpoint = "http://127.0.0.1:$port/token"
            val testVerifier = "test-verifier-12345678901234567890123456789012345"
            val testState = "state-good-123"

            oauthManager.setPendingStateForTest(
                provider = "google",
                verifier = testVerifier,
                state = testState,
                redirectUri = OAuthManager.GOOGLE_REDIRECT_URI,
            )

            val callbackUri = Uri.parse("com.quizradar.app:/oauth/google?code=auth-code-112233&state=$testState")
            val result = oauthManager.handleRedirect(callbackUri, engine, tokenEndpointOverride = mockEndpoint)

            assertTrue("Token exchange must succeed: $result", result is OAuthRedirectResult.Success)
            assertEquals("google", (result as OAuthRedirectResult.Success).provider)

            // Verify tokens stored securely in TokenProvider
            assertEquals("mock-access-token-98765", tokenStore.getGoogleAccessToken())
            assertEquals("mock-refresh-token-54321", tokenStore.getGoogleRefreshToken())
        }

    @Test
    fun testHandleRedirectSupportsBothSingleAndDoubleSlashSchemes() =
        runBlocking {
            oauthManager.setPendingStateForTest("google", "v1", "s1", OAuthManager.GOOGLE_REDIRECT_URI)
            val res1 = oauthManager.handleRedirect(Uri.parse("com.quizradar.app:/oauth/google?code=c1&state=bad"), engine)
            assertTrue(
                "Single slash routes to provider and checks state",
                res1 is OAuthRedirectResult.Error && (res1 as OAuthRedirectResult.Error).error.contains("state mismatch"),
            )

            oauthManager.setPendingStateForTest("google", "v1", "s1", OAuthManager.GOOGLE_REDIRECT_URI)
            val res2 = oauthManager.handleRedirect(Uri.parse("com.quizradar.app://oauth/google?code=c1&state=bad"), engine)
            assertTrue(
                "Double slash routes to provider and checks state",
                res2 is OAuthRedirectResult.Error && (res2 as OAuthRedirectResult.Error).error.contains("state mismatch"),
            )

            oauthManager.setPendingStateForTest("microsoft", "v1", "s1", OAuthManager.MICROSOFT_REDIRECT_URI)
            val res3 = oauthManager.handleRedirect(Uri.parse("com.quizradar.app://oauth/microsoft?code=c1&state=bad"), engine)
            assertTrue(
                "Microsoft double slash routes to provider and checks state",
                res3 is OAuthRedirectResult.Error && (res3 as OAuthRedirectResult.Error).error.contains("state mismatch"),
            )
        }
}
