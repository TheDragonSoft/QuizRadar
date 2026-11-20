package com.quizradar.app.core

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.zip.Deflater
import java.util.zip.Inflater

/**
 * Serverless Peer Sync codec (`quizradar://pair?d=<base64url-deflate-raw>`).
 *
 * Wire-compatible with Web/Desktop `pairSync.ts` (`CompressionStream("deflate-raw")`).
 * Carries only `BackupPayload` JSON (structurally token-free).
 */
object PairSyncCodec {
    const val PREFIX = "quizradar://pair?d="

    private val LOSSLESS_STRIP_KEYS = setOf("google_cal_url", "conflict_warning", "display_time")
    private val VERBOSE_STRIP_KEYS =
        setOf("google_cal_url", "conflict_warning", "display_time", "raw_text", "ai_study_plan")
    private val TRUNCATE_KEYS = setOf("snippet", "notes", "ai_inference_note")

    data class QrEncodeResult(
        val link: String,
        val compacted: Boolean,
        val fitsQr: Boolean,
    )

    fun encode(payloadJson: String): String {
        val raw = payloadJson.toByteArray(StandardCharsets.UTF_8)
        val deflater = Deflater(Deflater.BEST_COMPRESSION, true)
        deflater.setInput(raw)
        deflater.finish()
        val out = ByteArrayOutputStream(raw.size)
        val buffer = ByteArray(4096)
        while (!deflater.finished()) {
            val count = deflater.deflate(buffer)
            if (count == 0) break
            out.write(buffer, 0, count)
        }
        deflater.end()
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(out.toByteArray())
        return "$PREFIX$encoded"
    }

    /**
     * Encodes `payloadJson` into a `quizradar://pair?d=...` link suitable for QR pairing,
     * applying two-stage compaction only when the full link exceeds `maxLinkBytes`
     * (ISO/IEC 18004 QR Version 40-L capacity = 2,953 bytes):
     *
     * 1. Lossless pass: strips `null`-valued optional fields and recomputable derived fields
     *    (`google_cal_url`, `conflict_warning`, `display_time`).
     * 2. Verbose trim pass (if still oversize): strips `raw_text` / `ai_study_plan` and
     *    truncates long `snippet` / `notes` / `ai_inference_note` strings (> 160 chars).
     */
    fun encodeForQr(
        payloadJson: String,
        maxLinkBytes: Int = QrCodeEncoder.MAX_QR_BYTE_CAPACITY,
    ): QrEncodeResult {
        val fullLink = encode(payloadJson)
        if (fullLink.toByteArray(StandardCharsets.UTF_8).size <= maxLinkBytes) {
            return QrEncodeResult(link = fullLink, compacted = false, fitsQr = true)
        }
        val losslessJson =
            compactJsonPayload(
                json = payloadJson,
                stripKeys = LOSSLESS_STRIP_KEYS,
                truncateKeys = emptySet(),
                stripNullFields = true,
            )
        val losslessLink = encode(losslessJson)
        if (losslessLink.toByteArray(StandardCharsets.UTF_8).size <= maxLinkBytes) {
            return QrEncodeResult(link = losslessLink, compacted = true, fitsQr = true)
        }
        val compactJson =
            compactJsonPayload(
                json = losslessJson,
                stripKeys = VERBOSE_STRIP_KEYS,
                truncateKeys = TRUNCATE_KEYS,
                stripNullFields = true,
            )
        val compactLink = encode(compactJson)
        val fits = compactLink.toByteArray(StandardCharsets.UTF_8).size <= maxLinkBytes
        return QrEncodeResult(link = compactLink, compacted = true, fitsQr = fits)
    }

    /**
     * Compacts `payloadJson` when the full compressed `quizradar://pair?d=...` link exceeds
     * `maxLinkBytes` (ISO/IEC 18004 QR Version 40-L capacity = 2,953 bytes).
     *
     * Returns `(compactedOrOriginalJson, wasCompacted)`.
     */
    fun compactPayloadIfNeeded(
        payloadJson: String,
        maxLinkBytes: Int = QrCodeEncoder.MAX_QR_BYTE_CAPACITY,
    ): Pair<String, Boolean> {
        val fullLink = encode(payloadJson)
        if (fullLink.toByteArray(StandardCharsets.UTF_8).size <= maxLinkBytes) {
            return Pair(payloadJson, false)
        }
        val losslessJson =
            compactJsonPayload(
                json = payloadJson,
                stripKeys = LOSSLESS_STRIP_KEYS,
                truncateKeys = emptySet(),
                stripNullFields = true,
            )
        if (encode(losslessJson).toByteArray(StandardCharsets.UTF_8).size <= maxLinkBytes) {
            return Pair(losslessJson, true)
        }
        val compactJson =
            compactJsonPayload(
                json = losslessJson,
                stripKeys = VERBOSE_STRIP_KEYS,
                truncateKeys = TRUNCATE_KEYS,
                stripNullFields = true,
            )
        return Pair(compactJson, true)
    }

    private fun compactJsonPayload(
        json: String,
        stripKeys: Set<String>,
        truncateKeys: Set<String>,
        stripNullFields: Boolean,
    ): String {
        val out = StringBuilder(json.length)
        var i = 0
        while (i < json.length) {
            val ch = json[i]
            if (ch != '"') {
                out.append(ch)
                i++
                continue
            }

            val closeQuote = findJsonStringEnd(json, i)
            if (closeQuote == -1) {
                out.append(json, i, json.length)
                break
            }

            val afterQuote = skipWhitespace(json, closeQuote + 1)
            if (afterQuote >= json.length || json[afterQuote] != ':') {
                out.append(json, i, closeQuote + 1)
                i = closeQuote + 1
                continue
            }

            val key = json.substring(i + 1, closeQuote)
            val afterColon = skipWhitespace(json, afterQuote + 1)

            val shouldStrip =
                afterColon < json.length &&
                    (key in stripKeys || (stripNullFields && isNullLiteral(json, afterColon)))

            if (shouldStrip) {
                val valEnd = skipJsonValue(json, afterColon)
                val afterVal = skipWhitespace(json, valEnd)
                if (afterVal < json.length && json[afterVal] == ',') {
                    i = afterVal + 1
                } else {
                    while (out.isNotEmpty() && out[out.length - 1].isWhitespace()) {
                        out.setLength(out.length - 1)
                    }
                    if (out.isNotEmpty() && out[out.length - 1] == ',') {
                        out.setLength(out.length - 1)
                    }
                    i = valEnd
                }
                continue
            }

            if (key in truncateKeys && afterColon < json.length && json[afterColon] == '"') {
                val valClose = findJsonStringEnd(json, afterColon)
                if (valClose != -1) {
                    val contentLen = valClose - (afterColon + 1)
                    if (contentLen > 160) {
                        out.append(json, i, afterColon + 1)
                        val truncated = truncateJsonStringContent(json, afterColon + 1, valClose)
                        out.append(truncated)
                        out.append('"')
                        i = valClose + 1
                        continue
                    }
                }
            }

            out.append(json, i, afterQuote + 1)
            i = afterQuote + 1
        }
        return out.toString()
    }

    private fun isNullLiteral(
        s: String,
        start: Int,
    ): Boolean {
        if (!s.startsWith("null", start)) return false
        val end = start + 4
        return end >= s.length || s[end] == ',' || s[end] == '}' || s[end] == ']' || s[end].isWhitespace()
    }

    private fun findJsonStringEnd(
        s: String,
        openQuoteIdx: Int,
    ): Int {
        var i = openQuoteIdx + 1
        while (i < s.length) {
            when (s[i]) {
                '\\' -> i += 2
                '"' -> return i
                else -> i++
            }
        }
        return -1
    }

    private fun skipWhitespace(
        s: String,
        start: Int,
    ): Int {
        var i = start
        while (i < s.length && s[i].isWhitespace()) {
            i++
        }
        return i
    }

    private fun skipJsonValue(
        s: String,
        start: Int,
    ): Int {
        if (start >= s.length) return s.length
        return when (s[start]) {
            '"' -> {
                val end = findJsonStringEnd(s, start)
                if (end == -1) s.length else end + 1
            }
            '{', '[' -> {
                var depth = 0
                var i = start
                while (i < s.length) {
                    when (s[i]) {
                        '"' -> {
                            val end = findJsonStringEnd(s, i)
                            i = if (end == -1) s.length else end + 1
                        }
                        '{', '[' -> {
                            depth++
                            i++
                        }
                        '}', ']' -> {
                            depth--
                            i++
                            if (depth == 0) return i
                        }
                        else -> i++
                    }
                }
                s.length
            }
            else -> {
                var i = start
                while (i < s.length && s[i] != ',' && s[i] != '}' && s[i] != ']' && !s[i].isWhitespace()) {
                    i++
                }
                i
            }
        }
    }

    private fun isHighSurrogateEscape(
        s: String,
        idx: Int,
        contentEnd: Int,
    ): Boolean {
        if (idx + 6 > contentEnd || s[idx] != '\\' || s[idx + 1] != 'u') return false
        val codeUnit = s.substring(idx + 2, idx + 6).toIntOrNull(16) ?: return false
        return codeUnit in 0xD800..0xDBFF
    }

    private fun truncateJsonStringContent(
        s: String,
        contentStart: Int,
        contentEnd: Int,
    ): String {
        val maxPrefixLen = 157
        val limit = minOf(contentStart + maxPrefixLen, contentEnd)
        var i = contentStart
        while (i < limit) {
            val c = s[i]
            val step =
                if (c == '\\') {
                    if (i + 1 < contentEnd && s[i + 1] == 'u') {
                        if (isHighSurrogateEscape(s, i, contentEnd) && i + 12 <= contentEnd &&
                            s[i + 6] == '\\' && s[i + 7] == 'u'
                        ) {
                            12
                        } else {
                            6
                        }
                    } else {
                        2
                    }
                } else if (Character.isHighSurrogate(c)) {
                    2
                } else {
                    1
                }
            if (i + step > limit) break
            i += step
        }
        return "${s.substring(contentStart, i)}..."
    }

    fun extractParam(rawInput: String): String {
        val trimmed = rawInput.trim()
        require(trimmed.isNotEmpty()) { "Paste a quizradar://pair?d=... sync link first." }
        if (trimmed.startsWith("quizradar://") || trimmed.startsWith("com.quizradar.app://")) {
            val qIdx = trimmed.indexOf('?')
            require(qIdx != -1) { "Invalid sync link: missing ?d= payload." }
            val query = trimmed.substring(qIdx + 1)
            val param =
                query.split('&')
                    .firstOrNull { it.startsWith("d=") }
                    ?.substringAfter("d=")
                    ?.trim()
            require(!param.isNullOrEmpty()) { "Invalid sync link: missing ?d= payload." }
            return param
        }
        require(trimmed.matches(Regex("^[A-Za-z0-9_-]+$"))) {
            "Unrecognized sync link format. Expected quizradar://pair?d=..."
        }
        return trimmed
    }

    fun decode(rawInput: String): String {
        val token = extractParam(rawInput)
        val compressed = Base64.getUrlDecoder().decode(token)
        val inflater = Inflater(true)
        inflater.setInput(compressed)
        val out = ByteArrayOutputStream(compressed.size * 2)
        val buffer = ByteArray(4096)
        try {
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0) {
                    if (inflater.needsInput() || inflater.needsDictionary()) break
                } else {
                    out.write(buffer, 0, count)
                }
            }
        } finally {
            inflater.end()
        }
        val json = out.toString(StandardCharsets.UTF_8.name())
        require(json.contains("\"assessments\"") && json.contains("\"schedule\"")) {
            "Sync link is not a valid QuizRadar sync payload."
        }
        return json
    }
}
