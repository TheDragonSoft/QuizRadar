package com.quizradar.app.core

import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.X509TrustManager

/**
 * Pinned-TLS client for ephemeral Desktop LAN HTTPS pairing (`quizradar://lan?...`).
 *
 * Security guarantees:
 * - URI validation (private/link-local/loopback IPv4 only, port >= 1024, >=32-char token,
 *   32-byte SHA-256 cert fingerprint) runs inside Rust `core` (`parseLanPairUri`).
 * - TLS verification pins the exact leaf certificate SHA-256 from the scanned QR code
 *   (constant-time `MessageDigest.isEqual`), preventing MITM on campus Wi-Fi while keeping
 *   `android:usesCleartextTraffic="false"` strictly intact.
 * - Exchanges data-only `BackupPayload` JSON (zero tokens/credentials).
 */
object LanPairClient {
    data class ParsedLanUri(
        val host: String,
        val port: Int,
        val token: String,
        val fingerprintB64Url: String,
        val version: Int,
    )

    data class LanExchangeResult(
        val desktopPayloadJson: String,
        val desktopAssessmentsReplaced: Int,
    )

    fun parseAndValidate(uri: String): ParsedLanUri {
        val rawJson = parseLanPairUri(uri)
        val obj = JSONObject(rawJson)
        return ParsedLanUri(
            host = obj.getString("host"),
            port = obj.getInt("port"),
            token = obj.getString("token"),
            fingerprintB64Url = obj.getString("fingerprint_b64url"),
            version = obj.optInt("version", 1),
        )
    }

    fun exchange(
        uri: String,
        localPayloadJson: String,
        connectTimeoutMs: Int = 8_000,
        readTimeoutMs: Int = 20_000,
    ): LanExchangeResult {
        val parsed = parseAndValidate(uri)
        val expectedFp = Base64.getUrlDecoder().decode(parsed.fingerprintB64Url)
        require(expectedFp.size == 32) { "Invalid TLS certificate fingerprint length." }

        val trustManager =
            object : X509TrustManager {
                override fun checkClientTrusted(
                    chain: Array<out X509Certificate>?,
                    authType: String?,
                ) {
                    throw CertificateException("Client auth not supported.")
                }

                override fun checkServerTrusted(
                    chain: Array<out X509Certificate>?,
                    authType: String?,
                ) {
                    val leaf =
                        chain?.firstOrNull()
                            ?: throw CertificateException("Desktop presented no TLS certificate.")
                    val actual = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
                    if (!MessageDigest.isEqual(actual, expectedFp)) {
                        throw CertificateException("Desktop TLS certificate fingerprint mismatch.")
                    }
                }

                override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            }

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf(trustManager), SecureRandom())

        val endpoint = URL("https://${parsed.host}:${parsed.port}/pair")
        val conn = (endpoint.openConnection() as HttpsURLConnection)
        try {
            conn.sslSocketFactory = sslContext.socketFactory
            conn.hostnameVerifier = HostnameVerifier { hostname, _ -> hostname == parsed.host }
            conn.requestMethod = "POST"
            conn.connectTimeout = connectTimeoutMs
            conn.readTimeout = readTimeoutMs
            conn.doOutput = true
            conn.setRequestProperty("Authorization", "Bearer ${parsed.token}")
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")

            val bodyBytes = localPayloadJson.toByteArray(StandardCharsets.UTF_8)
            conn.setFixedLengthStreamingMode(bodyBytes.size)
            conn.outputStream.use { out ->
                out.write(bodyBytes)
                out.flush()
            }

            val code = conn.responseCode
            if (code == 401) {
                throw IOException(
                    "Wi-Fi sync token was rejected or expired. Start a fresh Wi-Fi Sync session on Desktop.",
                )
            }
            if (code !in 200..299) {
                val errText =
                    conn.errorStream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }
                        ?.take(200)
                        .orEmpty()
                throw IOException("Desktop rejected Wi-Fi sync (HTTP $code): $errText")
            }

            val responseText =
                conn.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            val root = JSONObject(responseText)
            val payloadObj = root.getJSONObject("payload")
            val reportObj = root.optJSONObject("mergeReport")
            val desktopReplaced = reportObj?.optInt("assessments_replaced", 0) ?: 0
            return LanExchangeResult(
                desktopPayloadJson = payloadObj.toString(),
                desktopAssessmentsReplaced = desktopReplaced,
            )
        } catch (e: SSLException) {
            throw IOException(
                "Desktop TLS certificate fingerprint did not match the QR code. Re-open Wi-Fi Sync on Desktop and scan a fresh QR.",
                e,
            )
        } catch (e: SocketTimeoutException) {
            throw IOException(
                "Could not reach Desktop on local Wi-Fi (${parsed.host}:${parsed.port}). " +
                    "Campus Wi-Fi may block device-to-device traffic — try a mobile hotspot " +
                    "or Offline QR / Sync Link instead.",
                e,
            )
        } catch (e: ConnectException) {
            throw IOException(
                "Could not connect to Desktop at ${parsed.host}:${parsed.port}. " +
                    "Make sure Wi-Fi Sync is open on Desktop and both devices share the same Wi-Fi/hotspot.",
                e,
            )
        } catch (e: UnknownHostException) {
            throw IOException(
                "Unable to resolve Desktop LAN host ${parsed.host}.",
                e,
            )
        } finally {
            conn.disconnect()
        }
    }
}
