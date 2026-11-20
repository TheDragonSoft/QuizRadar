package com.quizradar.app.core

/**
 * Thin Android facade over Rust `core::sync::pair` (UniFFI).
 *
 * All raw-DEFLATE framing, two-stage `BackupPayload` compaction, and link
 * validation live once in pure Rust `core/src/sync/pair.rs` — zero regex
 * scanning or duplicated compaction logic in Kotlin.
 */
object PairSyncCodec {
    const val PREFIX = "quizradar://pair?d="

    data class QrEncodeResult(
        val link: String,
        val compacted: Boolean,
        val fitsQr: Boolean,
    )

    fun encode(payloadJson: String): String = encodePairSyncLink(payloadJson)

    fun encodeForQr(
        payloadJson: String,
        maxLinkBytes: Int = QrCodeEncoder.MAX_QR_BYTE_CAPACITY,
    ): QrEncodeResult {
        val raw =
            try {
                encodePairSyncQr(payloadJson, maxLinkBytes.coerceAtLeast(1).toUInt())
            } catch (e: QuizRadarFfiException) {
                throw IllegalArgumentException(e.message ?: "QR pair encoding failed", e)
            }
        return QrEncodeResult(
            link = unescapeJsonString(extractRawJsonString(raw, "link")),
            compacted = extractJsonBoolean(raw, "compacted"),
            fitsQr = extractJsonBoolean(raw, "fits_qr"),
        )
    }

    fun compactPayloadIfNeeded(
        payloadJson: String,
        maxLinkBytes: Int = QrCodeEncoder.MAX_QR_BYTE_CAPACITY,
    ): Pair<String, Boolean> {
        val raw =
            try {
                compactPairSyncPayload(payloadJson, maxLinkBytes.coerceAtLeast(1).toUInt())
            } catch (e: QuizRadarFfiException) {
                throw IllegalArgumentException(e.message ?: "Pair compaction failed", e)
            }
        val json = unescapeJsonString(extractRawJsonString(raw, "json"))
        val compacted = extractJsonBoolean(raw, "compacted")
        return Pair(json, compacted)
    }

    fun decode(rawInput: String): String =
        try {
            decodePairSyncLink(rawInput)
        } catch (e: QuizRadarFfiException) {
            throw IllegalArgumentException(e.message ?: "Invalid sync link", e)
        }

    private fun extractJsonBoolean(
        json: String,
        key: String,
    ): Boolean {
        val match =
            Regex(""""$key"\s*:\s*(true|false)""").find(json)
                ?: throw IllegalStateException("Missing boolean field '$key' in sync JSON.")
        return match.groupValues[1] == "true"
    }

    private fun extractRawJsonString(
        json: String,
        key: String,
    ): String {
        val marker = "\"$key\":\""
        val startIdx = json.indexOf(marker)
        require(startIdx >= 0) { "Missing string field '$key' in sync JSON." }
        var i = startIdx + marker.length
        val contentStart = i
        while (i < json.length) {
            when (json[i]) {
                '\\' -> i += 2
                '"' -> return json.substring(contentStart, i)
                else -> i++
            }
        }
        throw IllegalStateException("Unterminated string field '$key' in sync JSON.")
    }

    private fun unescapeJsonString(raw: String): String {
        val out = StringBuilder(raw.length)
        var i = 0
        while (i < raw.length) {
            val c = raw[i]
            if (c != '\\' || i + 1 >= raw.length) {
                out.append(c)
                i++
                continue
            }
            when (val esc = raw[i + 1]) {
                '"' -> {
                    out.append('"')
                    i += 2
                }
                '\\' -> {
                    out.append('\\')
                    i += 2
                }
                '/' -> {
                    out.append('/')
                    i += 2
                }
                'b' -> {
                    out.append('\b')
                    i += 2
                }
                'f' -> {
                    out.append('\u000C')
                    i += 2
                }
                'n' -> {
                    out.append('\n')
                    i += 2
                }
                'r' -> {
                    out.append('\r')
                    i += 2
                }
                't' -> {
                    out.append('\t')
                    i += 2
                }
                'u' -> {
                    if (i + 6 <= raw.length) {
                        val code = raw.substring(i + 2, i + 6).toInt(16)
                        out.append(code.toChar())
                        i += 6
                    } else {
                        out.append(c)
                        i++
                    }
                }
                else -> {
                    out.append(esc)
                    i += 2
                }
            }
        }
        return out.toString()
    }
}
